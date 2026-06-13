/**
 * Multiplayer role store regression checks.
 *
 * Run with: npx tsx tests/multiplayer-role-store.test.ts
 */

import { applyHostAuthoritativeGameActionRequest, ensureGameHasSeatsForPresence, resolveLocalPlayerIdFromPresence, syncGamePlayerMetadataFromPresence, useGameStore } from '../client/src/store/gameStore';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import { sanitizeGameStateForPlayer } from '../client/src/engine/multiplayerProtocol';
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

function makeTokenStackSyncGame(): { game: GameState; tokenIds: string[] } {
  const game = makeGame();
  const tokenDef: CardDefinition = {
    ...testDef,
    id: 'sync-goblin-token',
    name: 'Goblin Token',
    typeLine: 'Token Creature - Goblin',
    power: '1',
    toughness: '1',
  };
  const tokenIds: string[] = [];
  const cards: GameState['cards'] = {};
  for (let index = 0; index < 4; index += 1) {
    const token = createCardState(tokenDef, 'p2', 'battlefield', false, true);
    token.instanceId = `sync-goblin-${index}`;
    token.controllerId = 'p2';
    token.summoningSick = false;
    cards[token.instanceId] = token;
    tokenIds.push(token.instanceId);
  }
  return {
    tokenIds,
    game: {
    ...game,
    status: 'playing',
    activePlayerId: 'p2',
    priorityPlayerId: 'p2',
    phase: 'combat',
    cards,
    definitions: { [tokenDef.id]: tokenDef },
    players: game.players.map(player => player.id === 'p2' ? { ...player, battlefield: tokenIds } : player),
    },
  };
}

function makeSneakSyncGame(): { game: GameState; attackerId: string; sneakId: string } {
  const game = makeGame();
  const attacker = createCardState(
    { ...testDef, id: 'sync-sneak-return', name: 'Returning Raider', power: '2', toughness: '2' },
    'p2',
    'battlefield',
  );
  attacker.instanceId = 'sync-sneak-return';
  attacker.controllerId = 'p2';
  attacker.summoningSick = false;
  attacker.combatRole = 'attacker';
  const sneakCard = createCardState(
    { ...testDef, id: 'sync-sneak-card', name: 'Sneak Ambusher', oracleText: 'Sneak {1}{R}', power: '3', toughness: '1' },
    'p2',
    'hand',
  );
  sneakCard.instanceId = 'sync-sneak-card';
  return {
    attackerId: attacker.instanceId,
    sneakId: sneakCard.instanceId,
    game: {
      ...game,
      status: 'playing',
      activePlayerId: 'p2',
      priorityPlayerId: 'p2',
      phase: 'declareBlockers',
      cards: {
        [attacker.instanceId]: attacker,
        [sneakCard.instanceId]: sneakCard,
      },
      definitions: {
        [attacker.definition.id]: attacker.definition,
        [sneakCard.definition.id]: sneakCard.definition,
      },
      players: game.players.map(player => {
        if (player.id === 'p2') return { ...player, battlefield: [attacker.instanceId], hand: [sneakCard.instanceId] };
        return player;
      }),
      combat: {
        ...game.combat,
        active: true,
        combatPhase: 'declareBlockers',
        phase: 'declareBlockers',
        attackingPlayerId: 'p2',
        defendingPlayerIds: ['p1'],
        attackers: [{ instanceId: attacker.instanceId, targetPlayerId: 'p1', targets: [] }],
        attackAssignments: [{
          assignmentId: 'sync-sneak-attack',
          controllerId: 'p2',
          attackerIds: [attacker.instanceId],
          sourceName: attacker.name,
          count: 1,
          isTokenStack: false,
          attackTarget: { type: 'player', playerId: 'p1' },
          tappedOnDeclare: true,
          legal: true,
          legalityWarnings: [],
        }],
      },
    },
  };
}

function makePreviewSyncGame(): { game: GameState; attackerId: string; privateId: string } {
  const game = makeGame();
  const attacker = createCardState(
    { ...testDef, id: 'sync-preview-attacker', name: 'Preview Attacker', power: '3', toughness: '3' },
    'p2',
    'battlefield',
  );
  attacker.instanceId = 'sync-preview-attacker';
  attacker.controllerId = 'p2';
  attacker.combatRole = 'attacker';
  const privateCard = createCardState({ ...testDef, id: 'sync-private-card', name: 'Hidden Plan' }, 'p2', 'hand');
  privateCard.instanceId = 'sync-private-card';
  return {
    attackerId: attacker.instanceId,
    privateId: privateCard.instanceId,
    game: {
      ...game,
      status: 'playing',
      activePlayerId: 'p2',
      phase: 'combat',
      cards: {
        [attacker.instanceId]: attacker,
        [privateCard.instanceId]: privateCard,
      },
      definitions: {
        [attacker.definition.id]: attacker.definition,
        [privateCard.definition.id]: privateCard.definition,
      },
      players: game.players.map(player => {
        if (player.id === 'p2') return { ...player, battlefield: [attacker.instanceId], hand: [privateCard.instanceId] };
        return player;
      }),
      combat: {
        ...game.combat,
        active: true,
        phase: 'declareBlockers',
        attackingPlayerId: 'p2',
        defendingPlayerIds: ['p1'],
        attackAssignments: [{
          assignmentId: 'sync-preview-attack',
          controllerId: 'p2',
          attackerIds: [attacker.instanceId],
          sourceName: attacker.name,
          count: 1,
          isTokenStack: false,
          attackTarget: { type: 'player', playerId: 'p1' },
          tappedOnDeclare: true,
          legal: true,
          legalityWarnings: [],
        }],
      },
    },
  };
}

function makeExilePermissionSyncGame(): { game: GameState; exiledId: string } {
  const game = makeGame();
  const exiled = createCardState(
    { ...testDef, id: 'sync-exiled-card', name: 'Airbended Bear', power: '2', toughness: '2' },
    'p1',
    'exile',
  );
  exiled.instanceId = 'sync-exiled-card';
  exiled.exilePermission = {
    ownerId: 'p1',
    sourceMechanic: 'airbend',
    alternativeCost: '{2}',
    timing: 'normal',
    expires: 'never',
    createdAtTurn: game.turnNumber,
  };
  return {
    exiledId: exiled.instanceId,
    game: {
      ...game,
      status: 'playing',
      cards: { [exiled.instanceId]: exiled },
      definitions: { [exiled.definition.id]: exiled.definition },
      players: game.players.map(player => {
        if (player.id === 'p1') return { ...player, exile: [exiled.instanceId] };
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
useGameStore.getState().moveCardToZone(syncFixture.hostHandId, 'battlefield', 'p2');
permissionState = useGameStore.getState();
assert(permissionState.game.cards[syncFixture.hostHandId].zone === 'hand', 'joiner should not directly move opponent private card');
assert(!permissionState.game.players[1].battlefield.includes(syncFixture.hostHandId), 'opponent private card should not appear on joiner battlefield');

const sneakFixture = makeSneakSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: sneakFixture.game,
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
    { actionSeq: 2, actionType: 'castWithSneak', params: { cardId: sneakFixture.sneakId, returnedAttackerId: sneakFixture.attackerId } },
    makePresence('peer-local', 1),
  ),
  'host should replay joiner Sneak action from actor private hand',
);
permissionState = useGameStore.getState();
assert(permissionState.game.cards[sneakFixture.attackerId].zone === 'hand', 'Sneak return attacker should move to owner hand');
assert(permissionState.game.cards[sneakFixture.sneakId].zone === 'battlefield', 'Sneak card should enter battlefield through host replay');
assert(permissionState.game.cards[sneakFixture.sneakId].combatRole === 'attacker', 'Sneak creature should be attacking after host replay');

const tokenFixture = makeTokenStackSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: tokenFixture.game,
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
    {
      actionSeq: 3,
      actionType: 'declareTokenStackAttack',
      params: {
        playerId: 'p2',
        sourceGroupId: 'sync-goblin-stack',
        attackerIds: tokenFixture.tokenIds,
        assignments: [{ count: 2, attackTarget: { type: 'player', playerId: 'p1' } }],
      },
    },
    makePresence('peer-local', 1),
  ),
  'host should replay token stack attack action',
);
permissionState = useGameStore.getState();
assert(
  permissionState.game.combat.attackAssignments.some(assignment => assignment.isTokenStack && assignment.count === 2 && assignment.controllerId === 'p2'),
  'token stack attack assignment should be represented in multiplayer game state',
);
assert(tokenFixture.tokenIds.slice(0, 2).every(id => permissionState.game.cards[id].combatRole === 'attacker'), 'selected token IDs should become attackers');
assert(permissionState.game.combat.attackers.length >= 2, 'legacy combat attackers should update for token stack compatibility');

const overrideFixture = makeTokenStackSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: overrideFixture.game,
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
    {
      actionSeq: 4,
      actionType: 'setPowerToughnessOverride',
      params: { instanceIds: [overrideFixture.tokenIds[0]], power: '7', toughness: '7', expires: 'manual', reason: 'sync test' },
    },
    makePresence('peer-local', 1),
  ),
  'host should replay P/T override action',
);
const overridePublicState = sanitizeGameStateForPlayer(useGameStore.getState().game, 'p1');
assert(overridePublicState.cards[overrideFixture.tokenIds[0]].powerToughnessOverride?.power === '7', 'P/T override should survive sanitized game state patch');

const previewFixture = makePreviewSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: previewFixture.game,
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
    { actionSeq: 5, actionType: 'generateCombatPreview', params: {} },
    makePresence('peer-local', 1),
  ),
  'host should replay combat preview generation',
);
const previewPublicState = sanitizeGameStateForPlayer(useGameStore.getState().game, 'p1');
assert(previewPublicState.combat.damagePreview, 'combat preview should be present in sanitized game state');
assert(!previewPublicState.cards[previewFixture.privateId], 'combat preview patch should not expose opponent private card objects');
assert(!JSON.stringify(previewPublicState.combat.damagePreview).includes(previewFixture.privateId), 'combat preview should not reference private card IDs');

let exileFixture = makeExilePermissionSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: exileFixture.game,
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
  !applyHostAuthoritativeGameActionRequest(
    { actionSeq: 6, actionType: 'castExiledWithPermission', params: { instanceId: exileFixture.exiledId } },
    makePresence('peer-local', 1),
  ),
  'non-owner joiner should not cast another player airbended card from exile',
);
permissionState = useGameStore.getState();
assert(permissionState.game.cards[exileFixture.exiledId].zone === 'exile', 'rejected exile cast should leave card in exile');
assert(permissionState.game.cards[exileFixture.exiledId].exilePermission, 'rejected exile cast should preserve permission');

exileFixture = makeExilePermissionSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: exileFixture.game,
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
    { actionSeq: 7, actionType: 'castExiledWithPermission', params: { instanceId: exileFixture.exiledId } },
    makePresence('host', 0),
  ),
  'owner should cast their airbended card from exile through host replay',
);
permissionState = useGameStore.getState();
assert(permissionState.game.cards[exileFixture.exiledId].zone === 'battlefield', 'owner exile cast should move permanent to battlefield');
assert(!permissionState.game.cards[exileFixture.exiledId].exilePermission, 'owner exile cast should clear permission');
assert(permissionState.game.actionLog.at(-1)?.data.mechanicId === 'airbend', 'owner exile cast should log source mechanic');

exileFixture = makeExilePermissionSyncGame();
useGameStore.setState(state => ({
  ...state,
  game: exileFixture.game,
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
  ui: { ...state.ui, judgeMode: true },
}));
assert(
  applyHostAuthoritativeGameActionRequest(
    { actionSeq: 8, actionType: 'castExiledWithPermission', params: { instanceId: exileFixture.exiledId } },
    makePresence('peer-local', 1),
  ),
  'judge mode should allow non-owner exile cast through host replay',
);
permissionState = useGameStore.getState();
assert(permissionState.game.cards[exileFixture.exiledId].zone === 'battlefield', 'judge exile cast should move permanent to battlefield');
assert(permissionState.game.cards[exileFixture.exiledId].controllerId === 'p2', 'judge exile cast should use acting player as controller');

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
