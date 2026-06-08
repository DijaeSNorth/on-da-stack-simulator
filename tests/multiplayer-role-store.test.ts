/**
 * Multiplayer role store regression checks.
 *
 * Run with: npx tsx tests/multiplayer-role-store.test.ts
 */

import { ensureGameHasSeatsForPresence, resolveLocalPlayerIdFromPresence, syncGamePlayerMetadataFromPresence, useGameStore } from '../client/src/store/gameStore';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import type { CardDefinition, GameState } from '../client/src/types/game';
import type { RoomPresence } from '../client/src/engine/multiplayerSync';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function makePresence(peerId: string, seatIndex: number, isSpectator = false): RoomPresence {
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

function makeGame(): GameState {
  const config = createDefaultGameConfig(2);
  const game = createEmptyGameState(config);
  const players = [
    createPlayer('p1', 'Player 1', 0, '#3b82f6', config),
    createPlayer('p2', 'Player 2', 1, '#ef4444', config),
  ];
  return {
    ...game,
    players,
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
  };
}

useGameStore.setState(state => ({
  ...state,
  game: makeGame(),
  localPlayerId: 'p2',
  multiplayer: {
    ...state.multiplayer,
    status: 'joined',
    roomCode: 'ABC123',
    peerId: 'peer-local',
    isHost: false,
    isSpectator: false,
    peers: {
      host: makePresence('host', 0),
      'peer-local': makePresence('peer-local', 1),
    },
    configured: true,
  },
}));

useGameStore.getState().updateMultiplayerPresence({ isSpectator: true, seatIndex: -1 });
let state = useGameStore.getState();
assert(state.multiplayer.isSpectator, 'expected local multiplayer flag to switch to spectator');
assert(state.multiplayer.peers['peer-local'].isSpectator, 'expected local presence to switch to spectator');
assert(state.multiplayer.peers['peer-local'].seatIndex === -1, 'expected spectator to release their seat');
assert(state.localPlayerId === '', 'expected spectator to have no local player id');

useGameStore.getState().updateMultiplayerPresence({ isSpectator: false, seatIndex: 1 });
state = useGameStore.getState();
assert(!state.multiplayer.isSpectator, 'expected local multiplayer flag to switch back to player');
assert(!state.multiplayer.peers['peer-local'].isSpectator, 'expected local presence to switch back to player');
assert(state.multiplayer.peers['peer-local'].seatIndex === 1, 'expected player role to claim selected seat');
assert(state.localPlayerId === 'p2', 'expected player role to resolve the selected game player id');

const baseSyncGame = makeGame();
const syncedGame = syncGamePlayerMetadataFromPresence({
  ...baseSyncGame,
  players: baseSyncGame.players.map((player, index) => index === 1 ? {
    ...player,
    deckId: 'deck-guest',
    library: ['card-1'],
  } : player),
}, {
  host: { ...makePresence('host', 0), name: 'Host Profile', color: '#22c55e' },
  guest: { ...makePresence('guest', 1), name: 'Guest Profile', color: '#f59e0b', avatarInitial: 'G' },
});
assert(syncedGame.players[1].id === 'p2', 'presence sync must preserve the authoritative seat player id');
assert(syncedGame.players[1].deckId === 'deck-guest', 'presence sync must preserve loaded deck state');
assert(syncedGame.players[1].library.length === 1, 'presence sync must preserve loaded library');
assert(syncedGame.players[1].name === 'Guest Profile', 'presence sync should update seat display name');
assert(syncedGame.players[1].color === '#f59e0b', 'presence sync should update seat color');
assert(syncedGame.lastUpdatedAt === baseSyncGame.lastUpdatedAt, 'presence sync should not change the game clock');
assert(
  resolveLocalPlayerIdFromPresence(syncedGame, {
    host: makePresence('host', 0),
    'peer-local': makePresence('peer-local', 1),
  }, 'peer-local', 'stale-local-id') === 'p2',
  'remote host snapshots must resolve the joiner local player id from the assigned seat',
);
assert(
  resolveLocalPlayerIdFromPresence(syncedGame, {
    spectator: makePresence('spectator', -1, true),
  }, 'spectator', 'stale-local-id') === '',
  'spectator remote snapshots must not keep a stale local player id',
);

const emptyJoinerGame = createEmptyGameState(createDefaultGameConfig(2));
const joinerPeers = {
  host: makePresence('host', 0),
  'peer-local': makePresence('peer-local', 1),
};
const materializedJoinerGame = ensureGameHasSeatsForPresence(emptyJoinerGame, joinerPeers);
assert(materializedJoinerGame.players.length === 2, 'joiner presence must create local table seats before the host snapshot arrives');
assert(materializedJoinerGame.players[0].name === 'host', 'host should stay in seat 1 when materializing joiner seats');
assert(materializedJoinerGame.players[1].name === 'peer-local', 'joiner should stay in seat 2 when materializing joiner seats');
assert(
  resolveLocalPlayerIdFromPresence(materializedJoinerGame, joinerPeers, 'peer-local') === materializedJoinerGame.players[1].id,
  'joiner deck loading must target the assigned seat 2 player before host has loaded a deck',
);

const testDef: CardDefinition = {
  id: 'test-card',
  name: 'Test Creature',
  manaCost: { raw: '{1}{G}', cmc: 2, generic: 1, G: 1 },
  cmc: 2,
  typeLine: 'Creature - Test',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Test'],
  oracleText: '',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: [],
  legalities: {},
};
const loadedGame = makeGame();
const card = createCardState(testDef, 'p2', 'library');
useGameStore.setState(state => ({
  ...state,
  game: {
    ...loadedGame,
    cards: { [card.instanceId]: card },
    players: loadedGame.players.map(player => player.id === 'p2' ? {
      ...player,
      deckId: 'deck-p2',
      library: [card.instanceId],
    } : player),
    stack: [{ id: 'stack-1', type: 'spell', sourceInstanceId: card.instanceId, sourceName: card.definition.name, controllerId: 'p2', text: 'Test spell', timestamp: Date.now() }],
    triggerQueue: [{ id: 'trigger-1', sourceInstanceId: card.instanceId, sourceName: card.definition.name, controllerId: 'p2', text: 'Test trigger', triggerType: 'cast', acknowledged: false, missed: false, timestamp: Date.now() }],
  },
}));
useGameStore.getState().clearLoadedDeck('p2');
const cleared = useGameStore.getState().game;
const clearedPlayer = cleared.players.find(player => player.id === 'p2');
assert(clearedPlayer?.deckId === undefined, 'deck toggle off should clear player deck id');
assert(clearedPlayer?.library.length === 0, 'deck toggle off should clear loaded library');
assert(!cleared.cards[card.instanceId], 'deck toggle off should remove loaded card instances');
assert(cleared.stack.length === 0, 'deck toggle off should remove stack objects from unloaded cards');
assert(cleared.triggerQueue.length === 0, 'deck toggle off should remove queued triggers from unloaded cards');

console.log('PASS multiplayer role switching, presence sync, and deck usage toggle clearing');
