import type { Deck, Player } from '../types/game';
import type { RoomPresence } from './multiplayerSync';

export interface LobbySeat {
  id: string;
  name?: string;
  deckId?: string;
}

export interface TableDeckStatus {
  peer: RoomPresence;
  seat?: LobbySeat;
  player?: Player;
  deckId?: string;
  deckName?: string;
  ready: boolean;
  playerReady: boolean;
  deckStatus: RoomPresence['deckStatus'];
}

export interface LocalDeckSeatTarget {
  assigned: boolean;
  playerId: string;
  seatIndex: number;
  label: string;
  reason?: 'not_connected' | 'spectator' | 'seat_pending' | 'player_pending';
}

export function getSeatedLobbyPeers(
  peers: Record<string, RoomPresence>,
  playerCount: number,
): RoomPresence[] {
  return Object.values(peers)
    .filter(peer => peer.online && !peer.isSpectator && peer.seatIndex >= 0 && peer.seatIndex < playerCount)
    .sort((a, b) => a.seatIndex - b.seatIndex);
}

export function resolveSeatPlayerId(
  seatIndex: number,
  gamePlayers: Pick<Player, 'id'>[],
  seats: LobbySeat[],
): string {
  return gamePlayers[seatIndex]?.id ?? seats[seatIndex]?.id ?? '';
}

export function resolveLocalDeckSeatTarget({
  peerId,
  peers,
  gamePlayers,
  seats,
}: {
  peerId: string | null | undefined;
  peers: Record<string, RoomPresence>;
  gamePlayers: Pick<Player, 'id'>[];
  seats: LobbySeat[];
}): LocalDeckSeatTarget {
  const self = peerId ? peers[peerId] : undefined;
  if (!self) {
    return {
      assigned: false,
      playerId: '',
      seatIndex: -1,
      label: 'Connecting to room...',
      reason: 'not_connected',
    };
  }
  if (self.isSpectator) {
    return {
      assigned: false,
      playerId: '',
      seatIndex: -1,
      label: 'Spectating',
      reason: 'spectator',
    };
  }
  if (self.seatIndex < 0 || !Number.isInteger(self.seatIndex)) {
    return {
      assigned: false,
      playerId: '',
      seatIndex: -1,
      label: 'Assigning seat...',
      reason: 'seat_pending',
    };
  }

  const playerId = resolveSeatPlayerId(self.seatIndex, gamePlayers, seats);
  if (!playerId) {
    return {
      assigned: false,
      playerId: '',
      seatIndex: self.seatIndex,
      label: `Seat ${self.seatIndex + 1} assigned - syncing player data...`,
      reason: 'player_pending',
    };
  }

  return {
    assigned: true,
    playerId,
    seatIndex: self.seatIndex,
    label: `Seat ${self.seatIndex + 1} assigned`,
  };
}

export function getTableDeckStatus({
  peers,
  playerCount,
  seats,
  gamePlayers,
  savedDecks,
  requireLoadedGameDecks = false,
}: {
  peers: Record<string, RoomPresence>;
  playerCount: number;
  seats: LobbySeat[];
  gamePlayers: Player[];
  savedDecks: Deck[];
  requireLoadedGameDecks?: boolean;
}): TableDeckStatus[] {
  return getSeatedLobbyPeers(peers, playerCount).map(peer => {
    const seat = seats[peer.seatIndex];
    const playerId = resolveSeatPlayerId(peer.seatIndex, gamePlayers, seats);
    const loadedPlayer = gamePlayers.find(player => player.id === playerId) ?? gamePlayers[peer.seatIndex];
    const hasLoadedDeck = Boolean(
      loadedPlayer?.deckId &&
      (loadedPlayer.library.length > 0 || loadedPlayer.commandZone.length > 0)
    );
    const loadedDeck = loadedPlayer?.deckId
      ? savedDecks.find(deck => deck.id === loadedPlayer.deckId)
      : undefined;
    const assignedDeck = seat?.deckId
      ? savedDecks.find(deck => deck.id === seat.deckId)
      : undefined;
    const hasSyncedDeck = Boolean(peer.deck?.id);
    const hasValidSubmittedDeck = peer.deckStatus === 'valid' || peer.deck?.status === 'valid';
    const hasAssignedSavedDeck = Boolean(assignedDeck);
    const deckId = loadedPlayer?.deckId ?? peer.deck?.id ?? seat?.deckId;
    const deckName = loadedDeck?.name ?? peer.deck?.name ?? assignedDeck?.name ?? (hasLoadedDeck ? 'Loaded deck' : undefined);
    const deckReady = requireLoadedGameDecks
      ? hasLoadedDeck && hasValidSubmittedDeck
      : hasValidSubmittedDeck || hasLoadedDeck || hasSyncedDeck || hasAssignedSavedDeck;
    return {
      peer,
      seat,
      player: loadedPlayer,
      deckId,
      deckName,
      ready: deckReady,
      playerReady: Boolean(peer.ready),
      deckStatus: peer.deckStatus ?? peer.deck?.status ?? (deckReady ? 'valid' : 'none'),
    };
  });
}

export function canStartCommanderTable({
  isHost,
  peers,
  playerCount,
  seats,
  gamePlayers,
  savedDecks,
  minimumPlayers = 2,
  requireLoadedGameDecks = false,
  stabilizationMs = 0,
  now = Date.now(),
  lastGameUpdateAt = 0,
}: {
  isHost: boolean;
  peers: Record<string, RoomPresence>;
  playerCount: number;
  seats: LobbySeat[];
  gamePlayers: Player[];
  savedDecks: Deck[];
  minimumPlayers?: number;
  requireLoadedGameDecks?: boolean;
  stabilizationMs?: number;
  now?: number;
  lastGameUpdateAt?: number;
}): {
  canStart: boolean;
  occupiedCount: number;
  missingDeckPlayers: string[];
  waitMs: number;
  waitingForSync: boolean;
} {
  const statuses = getTableDeckStatus({ peers, playerCount, seats, gamePlayers, savedDecks, requireLoadedGameDecks });
  const missingDeckPlayers = statuses
    .filter(status => !status.ready)
    .map(status => status.peer.name);
  const notReadyPlayers = statuses
    .filter(status => status.ready && !status.playerReady)
    .map(status => status.peer.name);
  const occupiedCount = statuses.length;
  const latestPeerSeenAt = statuses.reduce(
    (latest, status) => Math.max(latest, status.peer.lastSeen || 0),
    0,
  );
  const latestSyncAt = Math.max(latestPeerSeenAt, lastGameUpdateAt || 0);
  const waitMs = latestSyncAt > 0
    ? Math.max(0, Math.ceil(stabilizationMs - (now - latestSyncAt)))
    : 0;
  const waitingForSync = waitMs > 0 && occupiedCount >= minimumPlayers && missingDeckPlayers.length === 0 && notReadyPlayers.length === 0;
  return {
    canStart: isHost && occupiedCount >= minimumPlayers && occupiedCount <= 6 && missingDeckPlayers.length === 0 && notReadyPlayers.length === 0 && !waitingForSync,
    occupiedCount,
    missingDeckPlayers: [...missingDeckPlayers, ...notReadyPlayers.map(name => `${name} not ready`)],
    waitMs,
    waitingForSync,
  };
}
