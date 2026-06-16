/**
 * Player-board-focused layout checks.
 *
 * Run with: npx tsx tests/player-board-layout.test.ts
 */

import {
  DEFAULT_BOARD_LAYOUT_PREFERENCES,
  buildBoardInteractionLinks,
  chooseFocusedOpponentId,
  getPlayerBoardLayoutRole,
  getTableViewModeLabel,
  isDragCombatEnabledForBoardLayout,
  normalizeBoardLayoutPreferences,
} from '../client/src/components/battlefield/tableViewUiModel';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer, declareAttacker, declareBlocker } from '../client/src/engine/gameEngine';
import { loadBoardLayoutPreferences, useGameStore } from '../client/src/store/gameStore';
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

const storage: Record<string, string> = {};
(globalThis as typeof globalThis & { localStorage: Storage }).localStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key]; },
  key: (index: number) => Object.keys(storage)[index] ?? null,
  get length() { return Object.keys(storage).length; },
} as Storage;

const creatureDef: CardDefinition = {
  id: 'player-board-creature',
  name: 'Board Bear',
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

function makeGame(): GameState {
  const config = createDefaultGameConfig(3);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Player 1', 0, '#ef4444', config);
  const p2 = createPlayer('p2', 'Player 2', 1, '#3b82f6', config);
  const p3 = createPlayer('p3', 'Player 3', 2, '#22c55e', config);
  return { ...base, players: [p1, p2, p3], activePlayerId: 'p1', priorityPlayerId: 'p1' };
}

function addCreature(game: GameState, ownerId: string): { game: GameState; id: string } {
  const card = { ...createCardState({ ...creatureDef, id: `${creatureDef.id}-${ownerId}` }, ownerId, 'battlefield'), summoningSick: false };
  return {
    id: card.instanceId,
    game: {
      ...game,
      cards: { ...game.cards, [card.instanceId]: card },
      definitions: { ...game.definitions, [card.definition.id]: card.definition },
      players: game.players.map(player => player.id === ownerId ? { ...player, battlefield: [...player.battlefield, card.instanceId] } : player),
    },
  };
}

test('player_focused mode makes local player board primary', () => {
  const game = makeGame();
  const role = getPlayerBoardLayoutRole('p1', 'p1', 'p2', 'player_focused', game);
  assert(role === 'local_primary', `expected local_primary, got ${role}`);
});

test('focused opponent board is visible as focused opponent', () => {
  const game = makeGame();
  assert(chooseFocusedOpponentId(game, 'p2', 'p1') === 'p2', 'expected p2 focused opponent');
  const role = getPlayerBoardLayoutRole('p2', 'p1', 'p2', 'player_focused', game);
  assert(role === 'focused_opponent', `expected focused_opponent, got ${role}`);
});

test('other opponents render compact summaries by role', () => {
  const game = makeGame();
  const role = getPlayerBoardLayoutRole('p3', 'p1', 'p2', 'player_focused', game);
  assert(role === 'compact_opponent', `expected compact opponent, got ${role}`);
});

test('opponent hand and library contents are not exposed by role helpers', () => {
  const base = makeGame();
  const game = {
    ...base,
    players: base.players.map(player => player.id === 'p2' ? { ...player, hand: ['secret-hand-card'], library: ['secret-library-card'] } : player),
  };
  const role = getPlayerBoardLayoutRole('p2', 'p1', 'p2', 'player_focused', game);
  assert(role === 'focused_opponent', 'expected focused opponent role');
  assert(!JSON.stringify(role).includes('secret-hand-card'), 'role must not expose private hand id');
});

test('changing focused opponent updates local UI only', () => {
  const before = makeGame();
  useGameStore.setState(state => ({
    ...state,
    game: before,
    localPlayerId: 'p1',
    ui: { ...state.ui, boardLayoutPreferences: normalizeBoardLayoutPreferences({ focusedOpponentId: 'p2' }), tableViewMode: 'player_focused' },
  }));
  useGameStore.getState().updateBoardLayoutPreferences({ focusedOpponentId: 'p3' });
  const after = useGameStore.getState();
  assert(after.ui.boardLayoutPreferences.focusedOpponentId === 'p3', 'expected p3 preference');
  assert(after.game === before, 'focus preference must not replace game state');
});

test('local board size preference persists in localStorage', () => {
  localStorage.clear();
  useGameStore.getState().updateBoardLayoutPreferences({ localBoardSize: 'full' });
  assert(loadBoardLayoutPreferences().localBoardSize === 'full', 'expected full board size persisted');
});

test('reset layout clears custom layout preferences', () => {
  useGameStore.getState().updateBoardLayoutPreferences({ localBoardSize: 'full', focusedOpponentId: 'p3', editLayoutMode: true });
  useGameStore.getState().resetBoardLayoutPreferences();
  const preferences = useGameStore.getState().ui.boardLayoutPreferences;
  assert(preferences.localBoardSize === DEFAULT_BOARD_LAYOUT_PREFERENCES.localBoardSize, 'expected default size');
  assert(!preferences.focusedOpponentId, 'expected focused opponent cleared');
  assert(!preferences.editLayoutMode, 'expected edit mode off');
});

test('edit board layout mode disables combat dragging', () => {
  const preferences = normalizeBoardLayoutPreferences({ editLayoutMode: true });
  assert(!isDragCombatEnabledForBoardLayout(preferences), 'expected combat drag disabled');
});

test('exiting edit board layout restores combat dragging', () => {
  const preferences = normalizeBoardLayoutPreferences({ editLayoutMode: false });
  assert(isDragCombatEnabledForBoardLayout(preferences), 'expected combat drag enabled');
});

test('collapsed lands and tokens persist locally in preferences', () => {
  const preferences = normalizeBoardLayoutPreferences({ collapsedSectionsByPlayer: { p1: ['lands', 'tokens'] } });
  assert(preferences.collapsedSectionsByPlayer.p1.includes('lands'), 'expected lands collapsed');
  assert(preferences.collapsedSectionsByPlayer.p1.includes('tokens'), 'expected tokens collapsed');
});

test('combat mode emphasizes attacking and defending player boards', () => {
  const setup = addCreature(makeGame(), 'p1');
  const game = declareAttacker(setup.game, setup.id, 'p2');
  assert(getPlayerBoardLayoutRole('p1', 'p1', 'p2', 'combat', game) === 'local_primary', 'expected attacking local primary');
  assert(getPlayerBoardLayoutRole('p2', 'p1', 'p2', 'combat', game) === 'combat_relevant', 'expected defender combat relevant');
  assert(getPlayerBoardLayoutRole('p3', 'p1', 'p2', 'combat', game) === 'compact_opponent', 'expected unrelated compact');
});

test('BoardInteractionOverlay model renders attack assignment between boards', () => {
  const setup = addCreature(makeGame(), 'p1');
  const game = declareAttacker(setup.game, setup.id, 'p2');
  const links = buildBoardInteractionLinks(game);
  assert(links.some(link => link.kind === 'attack' && link.fromPlayerId === 'p1' && link.toPlayerId === 'p2'), 'expected attack link');
});

test('BoardInteractionOverlay model renders block link between boards', () => {
  const attacker = addCreature(makeGame(), 'p1');
  const blocker = addCreature(attacker.game, 'p2');
  const attacked = declareAttacker(blocker.game, attacker.id, 'p2');
  const blocked = declareBlocker(attacked, blocker.id, attacker.id);
  const links = buildBoardInteractionLinks(blocked);
  assert(links.some(link => link.kind === 'block' && link.fromPlayerId === 'p2' && link.toPlayerId === 'p1'), 'expected block link');
});

test('moving or resizing board frame preference does not change card owner controller or zone', () => {
  const setup = addCreature(makeGame(), 'p1');
  useGameStore.setState(state => ({ ...state, game: setup.game, localPlayerId: 'p1' }));
  const before = useGameStore.getState().game.cards[setup.id];
  useGameStore.getState().updateBoardLayoutPreferences({
    freeLayoutPositions: { p1: { x: 10, y: 20, width: 300, height: 200 } },
    localBoardSize: 'full',
  });
  const after = useGameStore.getState().game.cards[setup.id];
  assert(after.ownerId === before.ownerId, 'owner changed');
  assert(after.controllerId === before.controllerId, 'controller changed');
  assert(after.zone === before.zone, 'zone changed');
});

test('table mode label includes player-focused wording', () => {
  assert(getTableViewModeLabel('player_focused') === 'Player-Focused Board View', 'expected player-focused label');
});

console.log(`\nPlayer board layout tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

