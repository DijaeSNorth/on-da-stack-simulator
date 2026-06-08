/**
 * Multiplayer deck sync regression checks.
 *
 * Run with: npx tsx tests/multiplayer-deck-sync.test.ts
 */

import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import { compactPresenceForRelay, generateFirebaseRoomCode, mergeRemoteSeatDeckState, resolveIncomingPeerGameState, type RoomPresence } from '../client/src/engine/multiplayerSync';
import type { CardDefinition, CardState, GameState } from '../client/src/types/game';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function presence(peerId: string, seatIndex: number, isSpectator = false): RoomPresence {
  return {
    peerId,
    name: peerId,
    color: '#3b82f6',
    seatIndex,
    isSpectator,
    online: true,
    lastSeen: Date.now(),
  };
}

function makeDef(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    manaCost: { raw: '{1}', cmc: 1, generic: 1 },
    cmc: 1,
    typeLine: 'Artifact',
    superTypes: [],
    cardTypes: ['Artifact'],
    subTypes: [],
    oracleText: '',
    colors: [],
    colorIdentity: [],
    keywords: [],
    legalities: {},
    isDoubleFaced: false,
  };
}

function makeGame(playerCount: 2 | 3 | 4, updatedAt: number): GameState {
  const config = createDefaultGameConfig(playerCount);
  const game = createEmptyGameState(config);
  const colors = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e'];
  const players = Array.from({ length: playerCount }, (_, index) =>
    createPlayer(`p${index + 1}`, index === 0 ? 'Host' : `Guest ${index}`, index, colors[index], config)
  );
  return {
    ...game,
    players,
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
    lastUpdatedAt: updatedAt,
  };
}

function loadSeatDeck(game: GameState, seatIndex: number, deckId: string, card: CardState): GameState {
  return {
    ...game,
    cards: { ...game.cards, [card.instanceId]: card },
    definitions: { ...game.definitions, [card.definitionId]: card.definition },
    players: game.players.map((player, index) => index === seatIndex ? {
      ...player,
      deckId,
      library: [card.instanceId],
    } : player),
  };
}

for (const playerCount of [2, 3, 4] as const) {
  const hostDeckCards = Array.from({ length: playerCount }, (_, index) =>
    createCardState(makeDef(`old-seat-${playerCount}-${index}`, `Old Seat ${index + 1} Rock`), `p${index + 1}`, 'library')
  );
  const remoteDeckCards = Array.from({ length: playerCount }, (_, index) =>
    createCardState(makeDef(`remote-seat-${playerCount}-${index}`, `Remote Seat ${index + 1} Rock`), `remote-p${index + 1}`, 'library')
  );

  let hostGame = makeGame(playerCount, 10_000);
  for (let seatIndex = 0; seatIndex < playerCount; seatIndex += 1) {
    hostGame = loadSeatDeck(hostGame, seatIndex, `old-deck-seat-${seatIndex + 1}`, hostDeckCards[seatIndex]);
  }

  for (let targetSeat = 1; targetSeat < playerCount; targetSeat += 1) {
    const remoteGame = {
      ...makeGame(playerCount, 1_000),
      players: makeGame(playerCount, 1_000).players.map((player, index) => index === targetSeat ? {
        ...player,
        id: `remote-p${targetSeat + 1}`,
        deckId: `new-deck-seat-${targetSeat + 1}`,
        library: [remoteDeckCards[targetSeat].instanceId],
      } : player),
      cards: { [remoteDeckCards[targetSeat].instanceId]: remoteDeckCards[targetSeat] },
      definitions: { [remoteDeckCards[targetSeat].definitionId]: remoteDeckCards[targetSeat].definition },
    };

    const merged = mergeRemoteSeatDeckState(hostGame, remoteGame, presence(`peer-seat-${targetSeat + 1}`, targetSeat));
    assert(merged !== null, `expected ${playerCount}p seat ${targetSeat + 1} deck to merge even when snapshot is older`);
    assert(merged!.players[targetSeat].id === `p${targetSeat + 1}`, `expected ${playerCount}p seat ${targetSeat + 1} player id to stay authoritative`);
    assert(merged!.players[targetSeat].deckId === `new-deck-seat-${targetSeat + 1}`, `expected ${playerCount}p seat ${targetSeat + 1} deck id to update`);
    assert(merged!.players[targetSeat].library[0] === remoteDeckCards[targetSeat].instanceId, `expected ${playerCount}p seat ${targetSeat + 1} library to update`);
    assert(merged!.cards[remoteDeckCards[targetSeat].instanceId].ownerId === `p${targetSeat + 1}`, `expected ${playerCount}p seat ${targetSeat + 1} cards to remap to host player id`);
    assert(!merged!.cards[hostDeckCards[targetSeat].instanceId], `expected ${playerCount}p seat ${targetSeat + 1} stale deck cards to be replaced`);

    for (let otherSeat = 0; otherSeat < playerCount; otherSeat += 1) {
      if (otherSeat === targetSeat) continue;
      assert(merged!.players[otherSeat].deckId === `old-deck-seat-${otherSeat + 1}`, `expected ${playerCount}p seat ${otherSeat + 1} deck to remain unchanged`);
      assert(merged!.players[otherSeat].library[0] === hostDeckCards[otherSeat].instanceId, `expected ${playerCount}p seat ${otherSeat + 1} library to remain unchanged`);
      assert(merged!.cards[hostDeckCards[otherSeat].instanceId].ownerId === `p${otherSeat + 1}`, `expected ${playerCount}p seat ${otherSeat + 1} cards to remain in state`);
    }
  }
}

const spectatorMerge = mergeRemoteSeatDeckState(makeGame(4, 10_000), makeGame(4, 1_000), presence('spectator-peer', -1, true));
assert(spectatorMerge === null, 'expected spectator game snapshots not to merge deck state');

const lobbyHostGame = makeGame(4, 1_000);
const lobbyRemoteWithoutDeck = makeGame(4, 2_000);
const ignoredLobbySnapshot = resolveIncomingPeerGameState(lobbyHostGame, lobbyRemoteWithoutDeck, presence('peer-seat-2', 1));
assert(ignoredLobbySnapshot === null, 'expected host lobby to ignore newer whole-game snapshots that do not contain a sender deck merge');

const playingHostGame = { ...makeGame(4, 1_000), status: 'playing' as const };
const playingRemoteGame = { ...makeGame(4, 2_000), status: 'playing' as const };
const acceptedPlayingSnapshot = resolveIncomingPeerGameState(playingHostGame, playingRemoteGame, presence('peer-seat-2', 1));
assert(acceptedPlayingSnapshot === playingRemoteGame, 'expected active gameplay to keep accepting newer snapshots for player actions');

for (let i = 0; i < 100; i += 1) {
  const code = generateFirebaseRoomCode();
  assert(code.length === 12, 'expected Firebase fallback room codes to be longer than PeerJS room codes');
  assert(/^F[A-Z2-9]{11}$/.test(code), `expected Firebase fallback room code to use the relay-safe alphabet: ${code}`);
}

const compactPresence = compactPresenceForRelay({
  ...presence('peer-with-avatar', 99),
  name: 'A very long player name that should be clamped before Firebase relay writes',
  color: 'not-a-color',
  avatarInitial: 'LONG',
  avatarImage: { source: 'upload', url: 'data:image/png;base64,abc', byteSize: 10, label: 'Upload' },
  connectionQuality: { rttMs: 25000, score: 9999, samples: 999, updatedAt: Date.now() },
});
assert(compactPresence.name.length <= 40, 'expected Firebase relay presence names to be length-limited');
assert(compactPresence.color === '#3b82f6', 'expected Firebase relay presence to normalize invalid colors');
assert(compactPresence.avatarInitial === 'LON', 'expected Firebase relay presence initials to be clamped');
assert(compactPresence.avatarImage === undefined, 'expected Firebase relay presence to omit uploaded avatar data');
assert(compactPresence.seatIndex === 5, 'expected Firebase relay presence seats to be clamped to supported seats');
assert(compactPresence.connectionQuality?.score === 1000, 'expected Firebase relay presence quality score to be bounded');

console.log('PASS multiplayer deck sync merges only the sending player seat for 2-4 players');
