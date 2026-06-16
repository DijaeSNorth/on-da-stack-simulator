import assert from 'node:assert/strict';
import { applyHostAuthoritativeGameActionRequest, useGameStore } from '../client/src/store/gameStore';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import {
  canCastCommander,
  getCommanderCastDisabledReason,
  getCommanderCastSuggestions,
  getCommanderCastCount,
  getCommanderTax,
  getCommanderTotalCost,
  getCommanderZoneCards,
  getPlayerCommanders,
} from '../client/src/engine/commanderCasting';
import { createReplayFileFromGame, getReplayTimelineMarkers } from '../client/src/engine/replayEngine';
import type { CardDefinition, GameState } from '../client/src/types/game';
import type { RoomPresence } from '../client/src/engine/multiplayerSync';

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

const commanderDef: CardDefinition = {
  id: 'test-commander',
  name: 'Alela, Test Commander',
  manaCost: { raw: '{1}{W}{U}{B}', cmc: 4, generic: 1, W: 1, U: 1, B: 1 },
  cmc: 4,
  typeLine: 'Legendary Creature - Faerie Warlock',
  superTypes: ['Legendary'],
  cardTypes: ['Creature'],
  subTypes: ['Faerie', 'Warlock'],
  oracleText: 'Flying',
  colors: ['W', 'U', 'B'],
  colorIdentity: ['W', 'U', 'B'],
  keywords: ['Flying'],
  legalities: {},
  power: '2',
  toughness: '3',
  isDoubleFaced: false,
};

const partnerDef: CardDefinition = {
  ...commanderDef,
  id: 'partner-commander',
  name: 'Tana, Test Partner',
  manaCost: { raw: '{2}{R}{G}', cmc: 4, generic: 2, R: 1, G: 1 },
  colors: ['R', 'G'],
  colorIdentity: ['R', 'G'],
};

function makeCommanderGame(twoCommanders = false): { game: GameState; commanderId: string; partnerId?: string } {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Player 1', 0, '#3b82f6', config);
  const p2 = createPlayer('p2', 'Player 2', 1, '#ef4444', config);
  const commander = createCardState(commanderDef, 'p1', 'command', true);
  const partner = createCardState(partnerDef, 'p1', 'command', true);
  return {
    commanderId: commander.instanceId,
    partnerId: twoCommanders ? partner.instanceId : undefined,
    game: {
      ...base,
      status: 'playing',
      players: [
        { ...p1, commanders: twoCommanders ? [commander.instanceId, partner.instanceId] : [commander.instanceId], commandZone: twoCommanders ? [commander.instanceId, partner.instanceId] : [commander.instanceId] },
        p2,
      ],
      cards: twoCommanders
        ? { [commander.instanceId]: commander, [partner.instanceId]: partner }
        : { [commander.instanceId]: commander },
      definitions: twoCommanders
        ? { [commander.definitionId]: commander.definition, [partner.definitionId]: partner.definition }
        : { [commander.definitionId]: commander.definition },
      activePlayerId: 'p1',
      priorityPlayerId: 'p1',
      phase: 'main1',
    },
  };
}

let fixture = makeCommanderGame();
assert.equal(getPlayerCommanders(fixture.game, 'p1').length, 1, 'getPlayerCommanders returns one commander');
assert.equal(getCommanderZoneCards(fixture.game, 'p1').length, 1, 'getCommanderZoneCards returns command-zone commander');
assert.equal(getCommanderTax(fixture.game, 'p1', fixture.commanderId), 0, 'commander tax starts at 0');
assert.equal(getCommanderCastCount(fixture.game, 'p1', fixture.commanderId), 0, 'commander cast count starts at 0');
assert.equal(getCommanderTotalCost(fixture.game.cards[fixture.commanderId], 2), '{1}{W}{U}{B} + {2}', 'total cost shows base cost plus tax');
assert(canCastCommander(fixture.game, 'p1', fixture.commanderId), 'commander should be castable during own main phase');

const partnerFixture = makeCommanderGame(true);
assert.equal(getPlayerCommanders(partnerFixture.game, 'p1').length, 2, 'getPlayerCommanders returns two commanders');

useGameStore.setState(state => ({
  ...state,
  game: fixture.game,
  localPlayerId: 'p1',
  multiplayer: { ...state.multiplayer, status: 'disconnected', isSpectator: false },
  ui: { ...state.ui, judgeMode: false, screen: 'game' },
}));
assert(useGameStore.getState().castCommanderFromCommandZone('p1', fixture.commanderId), 'castCommanderFromCommandZone succeeds');
let state = useGameStore.getState();
assert.equal(state.game.cards[fixture.commanderId].zone, 'stack', 'commander moves out of command zone to stack');
assert.equal(getCommanderCastCount(state.game, 'p1', fixture.commanderId), 1, 'commander cast count increments');
assert.equal(getCommanderTax(state.game, 'p1', fixture.commanderId), 2, 'commander tax increases by 2 after cast');
assert(state.game.actionLog.at(-1)?.description.includes('Commander tax is +0'), 'commander cast action logs tax');

useGameStore.setState(current => ({
  ...current,
  game: partnerFixture.game,
  localPlayerId: 'p1',
  multiplayer: { ...current.multiplayer, status: 'disconnected', isSpectator: false },
}));
assert(useGameStore.getState().castCommanderFromCommandZone('p1', partnerFixture.commanderId), 'first partner casts');
state = useGameStore.getState();
assert.equal(getCommanderTax(state.game, 'p1', partnerFixture.commanderId), 2, 'first partner tax increments');
assert.equal(getCommanderTax(state.game, 'p1', partnerFixture.partnerId!), 0, 'second partner tax remains independent');

const graveFixture = makeCommanderGame();
const graveCommander = { ...graveFixture.game.cards[graveFixture.commanderId], zone: 'graveyard' as const };
const graveGame: GameState = {
  ...graveFixture.game,
  cards: { [graveFixture.commanderId]: graveCommander },
  players: graveFixture.game.players.map(player => player.id === 'p1'
    ? { ...player, commandZone: [], graveyard: [graveFixture.commanderId], commanderCastCount: { [graveFixture.commanderId]: 2 } }
    : player),
};
useGameStore.setState(current => ({
  ...current,
  game: graveGame,
  localPlayerId: 'p1',
  multiplayer: { ...current.multiplayer, status: 'disconnected', isSpectator: false },
}));
assert(useGameStore.getState().moveCommanderToCommandZone('p1', graveFixture.commanderId, 'graveyard'), 'move commander to command zone succeeds');
state = useGameStore.getState();
assert.equal(state.game.cards[graveFixture.commanderId].zone, 'command', 'commander moves to command zone');
assert.equal(getCommanderTax(state.game, 'p1', graveFixture.commanderId), 4, 'moving commander does not increase tax');

const opponentFixture = makeCommanderGame();
useGameStore.setState(current => ({
  ...current,
  game: opponentFixture.game,
  localPlayerId: 'p2',
  multiplayer: {
    ...current.multiplayer,
    status: 'joined',
    isHost: false,
    isSpectator: false,
    peerId: 'peer-local',
    peers: { host: makePresence('host', 0), 'peer-local': makePresence('peer-local', 1) },
  },
  ui: { ...current.ui, judgeMode: false },
}));
assert(!useGameStore.getState().castCommanderFromCommandZone('p1', opponentFixture.commanderId), 'joiner cannot cast host commander');
assert.equal(useGameStore.getState().game.cards[opponentFixture.commanderId].zone, 'command', 'blocked opponent commander cast does not mutate');
assert.equal(
  getCommanderCastDisabledReason(opponentFixture.game, 'p2', opponentFixture.commanderId),
  'You can only cast your own commander.',
  'disabled reason is friendly and accurate',
);

const hostFixture = makeCommanderGame();
const p2Commander = createCardState({ ...commanderDef, id: 'p2-commander', name: 'Guest Commander' }, 'p2', 'command', true);
const hostGame: GameState = {
  ...hostFixture.game,
  activePlayerId: 'p2',
  priorityPlayerId: 'p2',
  cards: { ...hostFixture.game.cards, [p2Commander.instanceId]: p2Commander },
  players: hostFixture.game.players.map(player => player.id === 'p2'
    ? { ...player, commanders: [p2Commander.instanceId], commandZone: [p2Commander.instanceId] }
    : player),
};
useGameStore.setState(current => ({
  ...current,
  game: hostGame,
  localPlayerId: 'p1',
  multiplayer: {
    ...current.multiplayer,
    status: 'host',
    isHost: true,
    isSpectator: false,
    peerId: 'host',
    peers: { host: makePresence('host', 0), 'peer-local': makePresence('peer-local', 1) },
  },
  ui: { ...current.ui, judgeMode: false },
}));
assert(!useGameStore.getState().castCommanderFromCommandZone('p2', p2Commander.instanceId), 'host player cannot cast joiner commander locally');
assert(
  applyHostAuthoritativeGameActionRequest(
    { actionSeq: 1, actionType: 'castCommanderFromCommandZone', params: { playerId: 'p2', commanderInstanceId: p2Commander.instanceId } },
    makePresence('peer-local', 1),
  ),
  'joiner commander cast can be replayed through host-authoritative path',
);
state = useGameStore.getState();
assert.equal(state.game.cards[p2Commander.instanceId].zone, 'stack', 'host replay moves joiner commander to stack');
assert.equal(getCommanderTax(state.game, 'p2', p2Commander.instanceId), 2, 'commander tax syncs in game state');

const suggestionFixture = makeCommanderGame();
assert(
  getCommanderCastSuggestions(suggestionFixture.game, 'p1').some(suggestion => suggestion.message.includes('You can cast')),
  'castable commander suggestion appears',
);
assert(
  getCommanderCastSuggestions(graveGame, 'p1').some(suggestion => suggestion.message.includes('move') && suggestion.message.includes('command zone')),
  'move-to-command suggestion appears',
);

const replayFile = createReplayFileFromGame(useGameStore.getState().game, { includePrivateZones: true, includeFinalSnapshot: true, redacted: false });
const markers = getReplayTimelineMarkers(replayFile);
assert(markers.some(marker => marker.label.includes('Guest Commander') && marker.label.includes('Commander tax')), 'replay marker includes commander name and tax');
const publicReplayFile = createReplayFileFromGame(useGameStore.getState().game, { includePrivateZones: false, includeFinalSnapshot: true, redacted: true });
assert(!publicReplayFile.privacy.includesPrivateZones, 'public replay does not expose private zones');

console.log('commander-casting tests passed');
