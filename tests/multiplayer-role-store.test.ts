/**
 * Multiplayer role store regression checks.
 *
 * Run with: npx tsx tests/multiplayer-role-store.test.ts
 */

import { applyHostAuthoritativeGameActionRequest, ensureGameHasSeatsForPresence, resolveLocalPlayerIdFromPresence, syncGamePlayerMetadataFromPresence, useGameStore } from '../client/src/store/gameStore';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import { canControlPlayer } from '../client/src/engine/playerPermissions';
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

assert(canControlPlayer('p1', 'p2', 'host', true), 'judge mode should override player control checks');
assert(!canControlPlayer('p1', 'p1', 'spectator', false), 'spectator should not control seated players');
assert(canControlPlayer('p1', 'p1', 'host', false), 'player should control their own seat');
assert(!canControlPlayer('p1', 'p2', 'host', false), 'player should not control another seat');

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

function makePermissionGame(): GameState {
  const game = makeGame();
  const hostHand = createCardState(testDef, 'p1', 'hand');
  const guestHand = createCardState(testDef, 'p2', 'hand');
  const guestLibrary = createCardState(testDef, 'p2', 'library');
  const guestPublic = createCardState(testDef, 'p2', 'graveyard');
  return {
    ...game,
    status: 'playing',
    cards: {
      [hostHand.instanceId]: hostHand,
      [guestHand.instanceId]: guestHand,
      [guestLibrary.instanceId]: guestLibrary,
      [guestPublic.instanceId]: guestPublic,
    },
    players: game.players.map(player => {
      if (player.id === 'p1') return { ...player, hand: [hostHand.instanceId] };
      if (player.id === 'p2') {
        return {
          ...player,
          hand: [guestHand.instanceId],
          library: [guestLibrary.instanceId],
          graveyard: [guestPublic.instanceId],
        };
      }
      return player;
    }),
  };
}

const clueDef: CardDefinition = {
  ...testDef,
  id: 'sync-clue',
  name: 'Sync Clue',
  typeLine: 'Token Artifact - Clue',
  cardTypes: ['Artifact'],
  subTypes: ['Clue'],
  oracleText: '{2}, Sacrifice this artifact: Draw a card.',
  colors: [],
  colorIdentity: [],
  power: undefined,
  toughness: undefined,
};

function makeMechanicSyncGame(): { game: GameState; clueId: string; drawId: string; hostHandId: string } {
  const game = makeGame();
  const clue = { ...createCardState(clueDef, 'p2', 'library', false, true), zone: 'battlefield' as const, summoningSick: false };
  const drawCard = createCardState(testDef, 'p2', 'library');
  const hostHand = createCardState(testDef, 'p1', 'hand');
  return {
    clueId: clue.instanceId,
    drawId: drawCard.instanceId,
    hostHandId: hostHand.instanceId,
    game: {
      ...game,
      status: 'playing',
      cards: {
        [clue.instanceId]: clue,
        [drawCard.instanceId]: drawCard,
        [hostHand.instanceId]: hostHand,
      },
      definitions: {
        [clueDef.id]: clueDef,
        [testDef.id]: testDef,
      },
      players: game.players.map(player => {
        if (player.id === 'p1') return { ...player, hand: [hostHand.instanceId] };
        if (player.id === 'p2') return { ...player, battlefield: [clue.instanceId], library: [drawCard.instanceId] };
        return player;
      }),
    },
  };
}

function setPermissionStore(localPlayerId: string, judgeMode = false): GameState {
  const game = makePermissionGame();
  useGameStore.setState(state => ({
    ...state,
    game,
    localPlayerId,
    multiplayer: {
      ...state.multiplayer,
      status: localPlayerId === 'p1' ? 'host' : 'joined',
      roomCode: 'PERM01',
      peerId: localPlayerId === 'p1' ? 'host' : 'peer-local',
      isHost: localPlayerId === 'p1',
      isSpectator: false,
      peers: {
        host: makePresence('host', 0),
        'peer-local': makePresence('peer-local', 1),
      },
      configured: true,
    },
    ui: { ...state.ui, judgeMode, zoneDrawer: null, cardContextMenu: null },
  }));
  return game;
}

let permissionGame = setPermissionStore('p1');
const guestHandId = permissionGame.players[1].hand[0];
const guestLibraryId = permissionGame.players[1].library[0];
const guestPublicId = permissionGame.players[1].graveyard[0];

useGameStore.getState().openZoneDrawer('hand', 'p2');
assert(useGameStore.getState().ui.zoneDrawer === null, 'host must not open non-host hand contents');
useGameStore.getState().openZoneDrawer('library', 'p2');
assert(useGameStore.getState().ui.zoneDrawer === null, 'host must not open non-host library contents');
useGameStore.getState().openZoneDrawer('graveyard', 'p2');
assert(useGameStore.getState().ui.zoneDrawer?.zone === 'graveyard', 'host can still view non-host public graveyard');

useGameStore.getState().castCard('p2', guestHandId);
let permissionState = useGameStore.getState();
assert(permissionState.game.players[1].hand.includes(guestHandId), 'host must not cast non-host hand card');
assert(permissionState.game.stack.length === 0, 'blocked non-host cast must not add stack objects');

useGameStore.getState().moveCardToZone(guestLibraryId, 'battlefield', 'p1');
permissionState = useGameStore.getState();
assert(permissionState.game.players[1].library.includes(guestLibraryId), 'host must not move non-host library card');
assert(!permissionState.game.players[0].battlefield.includes(guestLibraryId), 'host must not move non-host library card to host battlefield');

permissionGame = setPermissionStore('p2');
const ownHandId = permissionGame.players[1].hand[0];
const ownLibraryId = permissionGame.players[1].library[0];
useGameStore.getState().openZoneDrawer('library', 'p2');
assert(useGameStore.getState().ui.zoneDrawer?.playerId === 'p2', 'non-host can open their own library');
useGameStore.getState().drawCard('p2');
permissionState = useGameStore.getState();
assert(!permissionState.game.players[1].library.includes(ownLibraryId), 'non-host can draw from their own library');
assert(permissionState.game.players[1].hand.includes(ownLibraryId), 'non-host draw moves own library card to hand');
useGameStore.getState().castCard('p2', ownHandId);
permissionState = useGameStore.getState();
assert(!permissionState.game.players[1].hand.includes(ownHandId), 'non-host can cast their own hand card');
assert(permissionState.game.stack.some(item => item.sourceInstanceId === ownHandId), 'non-host own cast adds stack object');

let syncFixture = makeMechanicSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: syncFixture.game,
  localPlayerId: 'p2',
  multiplayer: {
    ...state.multiplayer,
    status: 'joined',
    roomCode: 'SYNC01',
    peerId: 'peer-local',
    isHost: false,
    isSpectator: false,
    peers: {
      host: makePresence('host', 0),
      'peer-local': makePresence('peer-local', 1),
    },
    configured: true,
  },
  ui: { ...state.ui, judgeMode: false },
}));
assert(!useGameStore.getState().activateClue(syncFixture.clueId), 'offline joiner should not apply mechanic action locally without host transport');
permissionState = useGameStore.getState();
assert(permissionState.game.cards[syncFixture.clueId].zone === 'battlefield', 'joiner mechanic request must not mutate local host-authoritative state directly');
assert(permissionState.game.players[1].library.includes(syncFixture.drawId), 'joiner mechanic request must not draw locally before host patch');
assert(permissionState.game.actionLog.length === syncFixture.game.actionLog.length, 'joiner mechanic request must not append local action log');

syncFixture = makeMechanicSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: syncFixture.game,
  localPlayerId: 'p1',
  multiplayer: {
    ...state.multiplayer,
    status: 'host',
    roomCode: 'SYNC01',
    peerId: 'host',
    isHost: true,
    isSpectator: false,
    peers: {
      host: makePresence('host', 0),
      'peer-local': makePresence('peer-local', 1),
    },
    configured: true,
  },
  ui: { ...state.ui, judgeMode: false },
}));
assert(
  applyHostAuthoritativeGameActionRequest(
    { actionSeq: 1, actionType: 'activateClue', params: { instanceId: syncFixture.clueId } },
    makePresence('peer-local', 1),
  ),
  'host should replay joined player mechanic action authoritatively',
);
permissionState = useGameStore.getState();
assert(permissionState.game.cards[syncFixture.clueId].zone === 'graveyard', 'host authoritative Clue activation should move Clue to graveyard');
assert(permissionState.game.players[1].hand.includes(syncFixture.drawId), 'host authoritative Clue activation should draw for joined player');
assert(permissionState.game.actionLog.at(-1)?.data.mechanicId === 'clue', 'host authoritative mechanic action should log mechanic id');

syncFixture = makeMechanicSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: syncFixture.game,
  localPlayerId: 'p2',
  multiplayer: {
    ...state.multiplayer,
    status: 'joined',
    roomCode: 'SYNC01',
    peerId: 'peer-local',
    isHost: false,
    isSpectator: false,
    peers: {
      host: makePresence('host', 0),
      'peer-local': makePresence('peer-local', 1),
    },
    configured: true,
  },
  ui: { ...state.ui, judgeMode: false },
}));
assert(
  !useGameStore.getState().setPowerToughnessOverride([syncFixture.hostHandId], '5', '5', 'manual', 'blocked private-zone test'),
  'joined player must not request or apply private-zone override on another player card',
);
permissionState = useGameStore.getState();
assert(!permissionState.game.cards[syncFixture.hostHandId].powerToughnessOverride, 'private-zone override must remain unset');

permissionGame = setPermissionStore('p1', true);
const judgeLibraryId = permissionGame.players[1].library[0];
useGameStore.getState().openZoneDrawer('library', 'p2');
assert(useGameStore.getState().ui.zoneDrawer?.playerId === 'p2', 'judge mode can open non-host library');
useGameStore.getState().moveCardToZone(judgeLibraryId, 'battlefield', 'p1');
permissionState = useGameStore.getState();
assert(permissionState.game.players[0].battlefield.includes(judgeLibraryId), 'judge mode can move non-host private card for sandbox testing');

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
