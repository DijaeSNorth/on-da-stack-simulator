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

export function getTableDeckStatus({
  peers,
  playerCount,
  seats,
  gamePlayers,
  savedDecks,
}: {
  peers: Record<string, RoomPresence>;
  playerCount: number;
  seats: LobbySeat[];
  gamePlayers: Player[];
  savedDecks: Deck[];
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
    const hasAssignedSavedDeck = Boolean(assignedDeck);
    const deckId = loadedPlayer?.deckId ?? seat?.deckId;
    const deckName = loadedDeck?.name ?? assignedDeck?.name ?? (hasLoadedDeck ? 'Loaded deck' : undefined);
    return {
      peer,
      seat,
      player: loadedPlayer,
      deckId,
      deckName,
      ready: hasLoadedDeck || hasAssignedSavedDeck,
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
}: {
  isHost: boolean;
  peers: Record<string, RoomPresence>;
  playerCount: number;
  seats: LobbySeat[];
  gamePlayers: Player[];
  savedDecks: Deck[];
  minimumPlayers?: number;
}): { canStart: boolean; occupiedCount: number; missingDeckPlayers: string[] } {
  const statuses = getTableDeckStatus({ peers, playerCount, seats, gamePlayers, savedDecks });
  const missingDeckPlayers = statuses
    .filter(status => !status.ready)
    .map(status => status.peer.name);
  const occupiedCount = statuses.length;
  return {
    canStart: isHost && occupiedCount >= minimumPlayers && missingDeckPlayers.length === 0,
    occupiedCount,
    missingDeckPlayers,
  };
}
