/**
 * Multiplayer deck sync regression checks.
 *
 * Run with: npx tsx tests/multiplayer-deck-sync.test.ts
 */

import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import { mergeRemoteSeatDeckState, type RoomPresence } from '../client/src/engine/multiplayerSync';
import type { CardDefinition, GameState } from '../client/src/types/game';

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

function makeGame(updatedAt: number): GameState {
  const config = createDefaultGameConfig(2);
  const game = createEmptyGameState(config);
  const players = [
    createPlayer('p1', 'Host', 0, '#3b82f6', config),
    createPlayer('p2', 'Guest', 1, '#ef4444', config),
  ];
  return {
    ...game,
    players,
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
    lastUpdatedAt: updatedAt,
  };
}

const hostCard = createCardState(makeDef('host-def', 'Host Rock'), 'p1', 'library');
const staleGuestCard = createCardState(makeDef('old-guest-def', 'Old Guest Rock'), 'p2', 'library');
const remoteGuestCard = createCardState(makeDef('guest-def', 'Guest Rock'), 'remote-p2', 'library');

const hostGame: GameState = {
  ...makeGame(10_000),
  cards: {
    [hostCard.instanceId]: hostCard,
    [staleGuestCard.instanceId]: staleGuestCard,
  },
  definitions: {
    [hostCard.definitionId]: hostCard.definition,
    [staleGuestCard.definitionId]: staleGuestCard.definition,
  },
  players: makeGame(10_000).players.map(player => {
    if (player.id === 'p1') {
      return { ...player, deckId: 'host-deck', library: [hostCard.instanceId] };
    }
    return { ...player, deckId: 'old-guest-deck', library: [staleGuestCard.instanceId] };
  }),
};

const remoteGame: GameState = {
  ...makeGame(1_000),
  cards: { [remoteGuestCard.instanceId]: remoteGuestCard },
  definitions: { [remoteGuestCard.definitionId]: remoteGuestCard.definition },
  players: [
    { ...makeGame(1_000).players[0] },
    {
      ...makeGame(1_000).players[1],
      id: 'remote-p2',
      deckId: 'guest-deck',
      library: [remoteGuestCard.instanceId],
    },
  ],
};

const merged = mergeRemoteSeatDeckState(hostGame, remoteGame, presence('guest-peer', 1));
assert(merged !== null, 'expected a loaded joiner deck to merge even when its snapshot is older');
assert(merged!.players[0].deckId === 'host-deck', 'expected host deck to stay untouched');
assert(merged!.players[0].library[0] === hostCard.instanceId, 'expected host library to stay untouched');
assert(merged!.players[1].id === 'p2', 'expected authoritative host seat player id to be preserved');
assert(merged!.players[1].deckId === 'guest-deck', 'expected guest deck id to update only guest seat');
assert(merged!.players[1].library[0] === remoteGuestCard.instanceId, 'expected guest library to use the remote loaded deck');
assert(!merged!.cards[staleGuestCard.instanceId], 'expected stale guest deck cards to be replaced');
assert(merged!.cards[remoteGuestCard.instanceId].ownerId === 'p2', 'expected remote guest cards to be remapped to the host seat player');
assert(merged!.cards[hostCard.instanceId].ownerId === 'p1', 'expected host cards to remain in state');

const spectatorMerge = mergeRemoteSeatDeckState(hostGame, remoteGame, presence('spectator-peer', -1, true));
assert(spectatorMerge === null, 'expected spectator game snapshots not to merge deck state');

console.log('PASS multiplayer deck sync merges only the sending player seat');
