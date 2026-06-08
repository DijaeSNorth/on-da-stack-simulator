/**
 * Lobby readiness regression checks.
 *
 * Run with: npx tsx tests/lobby-readiness.test.ts
 */

import { canStartCommanderTable, getTableDeckStatus, resolveSeatPlayerId } from '../client/src/engine/lobbyReadiness';
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

console.log('PASS lobby readiness resolves seated players and ignores spectators');
