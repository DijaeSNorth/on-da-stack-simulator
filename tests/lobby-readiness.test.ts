/**
 * Lobby readiness regression checks.
 *
 * Run with: npx tsx tests/lobby-readiness.test.ts
 */

import {
  canStartCommanderTable,
  getTableDeckStatus,
  resolveLocalDeckSeatTarget,
  resolveSeatPlayerId,
} from '../client/src/engine/lobbyReadiness';
import { createDefaultGameConfig, createPlayer } from '../client/src/engine/gameEngine';
import type { Deck } from '../client/src/types/game';
import type { RoomPresence } from '../client/src/engine/multiplayerSync';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function presence(peerId: string, name: string, seatIndex: number, isSpectator = false): RoomPresence {
  return {
    peerId,
    name,
    color: seatIndex === 0 ? '#3b82f6' : '#ef4444',
    seatIndex,
    isSpectator,
    online: true,
    lastSeen: Date.now(),
  };
}

const config = createDefaultGameConfig(2);
const hostPlayer = {
  ...createPlayer('game-host-player', 'Host', 0, '#3b82f6', config),
  deckId: 'host-deck',
  library: ['host-card-1'],
};
const guestPlayer = {
  ...createPlayer('game-guest-player', 'Guest', 1, '#ef4444', config),
  deckId: 'guest-deck',
  commandZone: ['guest-commander-1'],
};
const savedDeck: Deck = {
  id: 'saved-deck',
  name: 'Saved Deck',
  format: 'commander',
  commanders: ['Commander'],
  cards: [{ name: 'Commander', count: 1 }],
  sideboard: [],
  maybeboard: [],
  colorIdentity: [],
  importedAt: Date.now(),
};

const staleLocalSeats = [
  { id: 'local-seat-0', name: 'Host seat' },
  { id: 'local-seat-1', name: 'Guest seat' },
];

const peers: Record<string, RoomPresence> = {
  host: presence('host', 'Host', 0),
  guest: presence('guest', 'Guest', 1),
  spectator: presence('spectator', 'Spectator', -1, true),
};

assert(
  resolveSeatPlayerId(1, [hostPlayer, guestPlayer], staleLocalSeats) === 'game-guest-player',
  'expected seat resolution to prefer the authoritative game player id',
);

const guestDeckTarget = resolveLocalDeckSeatTarget({
  peerId: 'guest',
  peers,
  gamePlayers: [hostPlayer, guestPlayer],
  seats: staleLocalSeats,
});
assert(guestDeckTarget.assigned, 'expected seated joiner deck target to be assigned');
assert(guestDeckTarget.seatIndex === 1, 'expected seated joiner deck target to use seat 2');
assert(guestDeckTarget.playerId === 'game-guest-player', 'expected seated joiner deck target to use the authoritative seat player id');

const hostDeckTarget = resolveLocalDeckSeatTarget({
  peerId: 'host',
  peers,
  gamePlayers: [hostPlayer, guestPlayer],
  seats: staleLocalSeats,
});
assert(hostDeckTarget.playerId === 'game-host-player', 'expected host deck target to stay on seat 1');

const spectatorDeckTarget = resolveLocalDeckSeatTarget({
  peerId: 'spectator',
  peers,
  gamePlayers: [hostPlayer, guestPlayer],
  seats: staleLocalSeats,
});
assert(!spectatorDeckTarget.assigned && spectatorDeckTarget.reason === 'spectator', 'expected spectators to have no deck assignment target');

const pendingDeckTarget = resolveLocalDeckSeatTarget({
  peerId: 'pending',
  peers: { pending: { ...presence('pending', 'Pending', -1), isSpectator: false } },
  gamePlayers: [hostPlayer, guestPlayer],
  seats: staleLocalSeats,
});
assert(!pendingDeckTarget.assigned && pendingDeckTarget.reason === 'seat_pending', 'expected pending seat assignment to block deck targeting');

const ready = canStartCommanderTable({
  isHost: true,
  peers,
  playerCount: 2,
  seats: staleLocalSeats,
  gamePlayers: [hostPlayer, guestPlayer],
  savedDecks: [],
});
assert(ready.canStart, 'expected host to start when both seated authoritative players have loaded decks');
assert(ready.occupiedCount === 2, 'expected spectator to be ignored by occupied player count');

const readyWithActualDeckSync = canStartCommanderTable({
  isHost: true,
  peers,
  playerCount: 2,
  seats: staleLocalSeats,
  gamePlayers: [hostPlayer, guestPlayer],
  savedDecks: [],
  requireLoadedGameDecks: true,
});
assert(readyWithActualDeckSync.canStart, 'expected host to start when actual synced card state exists for every seated player');

const syncWindowNow = 10_000;
const recentlyChangedPeers: Record<string, RoomPresence> = {
  host: { ...presence('host', 'Host', 0), lastSeen: syncWindowNow - 400 },
  guest: { ...presence('guest', 'Guest', 1), lastSeen: syncWindowNow - 300 },
};
const waitingForSyncWindow = canStartCommanderTable({
  isHost: true,
  peers: recentlyChangedPeers,
  playerCount: 2,
  seats: staleLocalSeats,
  gamePlayers: [hostPlayer, guestPlayer],
  savedDecks: [],
  requireLoadedGameDecks: true,
  stabilizationMs: 2_000,
  now: syncWindowNow,
  lastGameUpdateAt: syncWindowNow - 250,
});
assert(!waitingForSyncWindow.canStart, 'expected host start to wait during the final sync stabilization window');
assert(waitingForSyncWindow.waitingForSync, 'expected readiness to expose the connection/deck sync wait state');
assert(waitingForSyncWindow.waitMs === 1750, `expected 1750ms wait, got ${waitingForSyncWindow.waitMs}`);

const afterSyncWindow = canStartCommanderTable({
  isHost: true,
  peers: recentlyChangedPeers,
  playerCount: 2,
  seats: staleLocalSeats,
  gamePlayers: [hostPlayer, guestPlayer],
  savedDecks: [],
  requireLoadedGameDecks: true,
  stabilizationMs: 2_000,
  now: syncWindowNow + 2_000,
  lastGameUpdateAt: syncWindowNow - 250,
});
assert(afterSyncWindow.canStart, 'expected host start after the final sync stabilization window expires');
assert(afterSyncWindow.waitMs === 0, 'expected no remaining wait after sync window expires');

const namedDeckStatuses = getTableDeckStatus({
  peers,
  playerCount: 2,
  seats: staleLocalSeats,
  gamePlayers: [{ ...hostPlayer, deckId: savedDeck.id }, guestPlayer],
  savedDecks: [savedDeck],
});
assert(
  namedDeckStatuses.find(status => status.peer.peerId === 'host')?.deckName === savedDeck.name,
  'expected room readiness status to expose the loaded deck name',
);

const syncedPresenceOnly = getTableDeckStatus({
  peers: {
    host: { ...presence('host', 'Host', 0), deck: { id: 'host-remote-deck', name: 'Host Remote Deck', cardCount: 100, commanders: ['Host Commander'] } },
    guest: { ...presence('guest', 'Guest', 1), deck: { id: 'guest-remote-deck', name: 'Guest Remote Deck', cardCount: 100, commanders: ['Guest Commander'] } },
  },
  playerCount: 2,
  seats: staleLocalSeats,
  gamePlayers: [
    { ...hostPlayer, deckId: undefined, library: [], commandZone: [] },
    { ...guestPlayer, deckId: undefined, library: [], commandZone: [] },
  ],
  savedDecks: [],
});
assert(syncedPresenceOnly.every(status => status.ready), 'expected synced presence deck summaries to mark seats ready without local saved decks');
assert(
  syncedPresenceOnly.find(status => status.peer.peerId === 'guest')?.deckName === 'Guest Remote Deck',
  'expected joiners and host to see synced deck names from presence',
);

const hostWaitingForActualDeckSync = canStartCommanderTable({
  isHost: true,
  peers: {
    host: { ...presence('host', 'Host', 0), deck: { id: 'host-remote-deck', name: 'Host Remote Deck', cardCount: 100, commanders: ['Host Commander'] } },
    guest: { ...presence('guest', 'Guest', 1), deck: { id: 'guest-remote-deck', name: 'Guest Remote Deck', cardCount: 100, commanders: ['Guest Commander'] } },
  },
  playerCount: 2,
  seats: staleLocalSeats,
  gamePlayers: [
    { ...hostPlayer, deckId: undefined, library: [], commandZone: [] },
    { ...guestPlayer, deckId: undefined, library: [], commandZone: [] },
  ],
  savedDecks: [],
  requireLoadedGameDecks: true,
});
assert(!hostWaitingForActualDeckSync.canStart, 'expected host start to wait until actual card state syncs, not only deck summaries');
assert(hostWaitingForActualDeckSync.missingDeckPlayers.includes('Guest'), 'expected host start wait message to name missing joined deck state');

const missingGuest = canStartCommanderTable({
  isHost: true,
  peers,
  playerCount: 2,
  seats: staleLocalSeats,
  gamePlayers: [hostPlayer, { ...guestPlayer, deckId: undefined, commandZone: [] }],
  savedDecks: [],
});
assert(!missingGuest.canStart, 'expected missing guest deck to block start');
assert(missingGuest.missingDeckPlayers.includes('Guest'), 'expected missing deck message to name the seated peer');

const assignedSavedDeck = canStartCommanderTable({
  isHost: true,
  peers,
  playerCount: 2,
  seats: [{ ...staleLocalSeats[0], deckId: savedDeck.id }, { ...staleLocalSeats[1], deckId: savedDeck.id }],
  gamePlayers: [
    { ...hostPlayer, deckId: undefined, library: [], commandZone: [] },
    { ...guestPlayer, deckId: undefined, library: [], commandZone: [] },
  ],
  savedDecks: [savedDeck],
});
assert(assignedSavedDeck.canStart, 'expected assigned saved decks to count as ready before game start');

for (const count of [2, 3, 4] as const) {
  const tableConfig = createDefaultGameConfig(count);
  const tablePlayers = Array.from({ length: count }, (_, index) => ({
    ...createPlayer(`game-player-${index + 1}`, `Player ${index + 1}`, index, index === 0 ? '#3b82f6' : '#ef4444', tableConfig),
    deckId: `deck-${index + 1}`,
    library: [`card-${index + 1}`],
  }));
  const tablePeers = Object.fromEntries(
    tablePlayers.map((player, index) => [
      `peer-${index + 1}`,
      presence(`peer-${index + 1}`, player.name, index),
    ]),
  );
  const tableReady = canStartCommanderTable({
    isHost: true,
    peers: tablePeers,
    playerCount: count,
    seats: tablePlayers.map(player => ({ id: player.id, name: player.name })),
    gamePlayers: tablePlayers,
    savedDecks: [],
  });
  assert(tableReady.canStart, `expected ${count}-player lobby to start when every seated player has a loaded deck`);

  const missingSeatIndex = count - 1;
  const tableMissing = canStartCommanderTable({
    isHost: true,
    peers: tablePeers,
    playerCount: count,
    seats: tablePlayers.map(player => ({ id: player.id, name: player.name })),
    gamePlayers: tablePlayers.map((player, index) => index === missingSeatIndex
      ? { ...player, deckId: undefined, library: [] }
      : player
    ),
    savedDecks: [],
  });
  assert(!tableMissing.canStart, `expected ${count}-player lobby to block start when one seated player has no loaded deck`);
  assert(tableMissing.missingDeckPlayers.includes(`Player ${count}`), `expected ${count}-player lobby to name the missing deck player`);
}

console.log('PASS lobby readiness resolves seated players and ignores spectators');
