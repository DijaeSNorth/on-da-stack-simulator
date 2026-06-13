/**
 * Multiplayer table view UI helper checks.
 *
 * Run with: npx tsx tests/table-view-ui.test.ts
 */

import {
  chooseFocusedPlayerId,
  getCombatDefendingPlayerIds,
  getPlayerBoardSummary,
  getTableViewModeLabel,
  isPlayerCombatRelevant,
} from '../client/src/components/battlefield/tableViewUiModel';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer, declareAttacker } from '../client/src/engine/gameEngine';
import { useGameStore } from '../client/src/store/gameStore';
import type { CardDefinition, GameState } from '../client/src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

const creatureDef: CardDefinition = {
  id: 'table-view-creature',
  name: 'Table Bear',
  cmc: 2,
  typeLine: 'Creature - Bear',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Bear'],
  oracleText: '',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '2',
  toughness: '2',
};

const tokenDef: CardDefinition = {
  ...creatureDef,
  id: 'table-view-token',
  name: 'Goblin Token',
  typeLine: 'Token Creature - Goblin',
  subTypes: ['Goblin'],
  colors: ['R'],
  colorIdentity: ['R'],
  power: '1',
  toughness: '1',
};

const landDef: CardDefinition = {
  ...creatureDef,
  id: 'table-view-land',
  name: 'Forest',
  typeLine: 'Basic Land - Forest',
  superTypes: ['Basic'],
  cardTypes: ['Land'],
  subTypes: ['Forest'],
  colors: [],
  colorIdentity: ['G'],
  power: undefined,
  toughness: undefined,
};

function makeGame(playerCount: 2 | 3 | 4 | 5 | 6 = 4): GameState {
  const config = createDefaultGameConfig(playerCount);
  const base = createEmptyGameState(config);
  const players = Array.from({ length: playerCount }, (_, index) => createPlayer(`p${index + 1}`, `Player ${index + 1}`, index, ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6'][index], config));
  return { ...base, players, activePlayerId: 'p1', priorityPlayerId: 'p1' };
}

function addBattlefieldCard(game: GameState, def: CardDefinition, ownerId: string, token = false): GameState {
  const card = { ...createCardState(def, ownerId, 'battlefield', false, token), summoningSick: false };
  return {
    ...game,
    cards: { ...game.cards, [card.instanceId]: card },
    definitions: { ...game.definitions, [def.id]: def },
    players: game.players.map(player => player.id === ownerId ? { ...player, battlefield: [...player.battlefield, card.instanceId] } : player),
  };
}

test('Focused player view sets focusedPlayerId', () => {
  useGameStore.setState(state => ({
    ...state,
    ui: { ...state.ui, tableViewMode: 'table', focusedPlayerId: null },
  }));
  useGameStore.getState().setFocusedPlayer('p3');
  useGameStore.getState().setTableViewMode('focused');
  const state = useGameStore.getState();
  assert(state.ui.focusedPlayerId === 'p3', 'expected focused player id p3');
  assert(state.ui.tableViewMode === 'focused', 'expected focused view mode');
});

test('Compact view renders multiple player summaries via model', () => {
  let game = makeGame(4);
  game = addBattlefieldCard(game, creatureDef, 'p1');
  game = addBattlefieldCard(game, tokenDef, 'p2', true);
  const summaries = game.players.map(player => getPlayerBoardSummary(game, player));
  assert(summaries.length === 4, 'expected four summaries');
  assert(summaries[0].creatures === 1, 'expected p1 creature count');
  assert(summaries[1].tokens === 1, 'expected p2 token count');
});

test('Combat focus activates or can be selected during combat', () => {
  let game = makeGame(2);
  game = addBattlefieldCard(game, creatureDef, 'p1');
  const attackerId = game.players[0].battlefield[0];
  game = declareAttacker(game, attackerId, 'p2');
  assert(isPlayerCombatRelevant(game, 'p1'), 'expected attacker relevant');
  assert(isPlayerCombatRelevant(game, 'p2'), 'expected defender relevant');
  assert(getCombatDefendingPlayerIds(game).has('p2'), 'expected p2 defending id');
});

test('Opponent private zones remain hidden in summaries', () => {
  const game = {
    ...makeGame(2),
    players: makeGame(2).players.map(player => player.id === 'p2' ? { ...player, hand: ['secret-card'], library: ['lib-1', 'lib-2'] } : player),
  };
  const summary = getPlayerBoardSummary(game, game.players[1]);
  assert(summary.handCount === 1, 'expected hand count only');
  assert(summary.libraryCount === 2, 'expected library count only');
  assert(!JSON.stringify(summary).includes('secret-card'), 'summary must not expose private card id');
});

test('Focused fallback chooses requested, local, then first player', () => {
  const game = makeGame(3);
  assert(chooseFocusedPlayerId(game, 'p2', 'p1') === 'p2', 'expected requested focus');
  assert(chooseFocusedPlayerId(game, 'missing', 'p1') === 'p1', 'expected local fallback');
  assert(chooseFocusedPlayerId(game, undefined, undefined) === 'p1', 'expected first player fallback');
  assert(getTableViewModeLabel('compact') === 'Compact Board Grid', 'expected compact label');
});

console.log(`\nTable view UI tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
