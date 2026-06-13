/**
 * UI settings checks.
 *
 * Run with: npx tsx tests/ui-settings.test.ts
 */

import { DEFAULT_UI_SETTINGS, loadUISettings, normalizeUISettings, useGameStore } from '../client/src/store/gameStore';
import { buildHandViewModel } from '../client/src/components/hand/handUiModel';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
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

const baseDef: CardDefinition = {
  id: 'ui-settings-card',
  name: 'Settings Bear',
  cmc: 2,
  typeLine: 'Creature - Bear',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Bear'],
  oracleText: 'Trample',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: ['Trample'],
  isDoubleFaced: false,
  legalities: {},
  power: '2',
  toughness: '2',
};

function makeCards(count: number) {
  return Array.from({ length: count }, (_, index) => createCardState({ ...baseDef, id: `settings-${index}`, name: `Settings Bear ${index}` }, 'p1', 'hand'));
}

function makePermissionGame(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Player 1', 0, '#ef4444', config);
  const p2 = createPlayer('p2', 'Player 2', 1, '#3b82f6', config);
  const hidden = createCardState(baseDef, 'p2', 'library');
  return {
    ...base,
    players: [p1, { ...p2, library: [hidden.instanceId] }],
    cards: { [hidden.instanceId]: hidden },
    definitions: { [baseDef.id]: baseDef },
  };
}

test('Settings load default values', () => {
  localStorage.clear();
  const settings = loadUISettings();
  assert(settings.density === DEFAULT_UI_SETTINGS.density, 'expected default density');
  assert(settings.showMechanicBadges, 'expected mechanic badges default on');
  assert(settings.compactHandThreshold === 8, 'expected default hand threshold');
});

test('Settings save to localStorage', () => {
  localStorage.clear();
  useGameStore.getState().updateUISettings({ density: 'detailed', showCombatMath: true, compactHandThreshold: 11 });
  const saved = loadUISettings();
  assert(saved.density === 'detailed', 'expected persisted density');
  assert(saved.compactHandThreshold === 11, 'expected persisted compact threshold');
});

test('Toggling showMechanicBadges affects UI helper state', () => {
  useGameStore.getState().updateUISettings({ showMechanicBadges: false });
  assert(!useGameStore.getState().ui.settings.showMechanicBadges, 'expected badge setting off');
  useGameStore.getState().updateUISettings({ showMechanicBadges: true });
  assert(useGameStore.getState().ui.settings.showMechanicBadges, 'expected badge setting on');
});

test('Compact hand threshold updates display mode', () => {
  const cards = makeCards(10);
  assert(buildHandViewModel(cards, { compactThreshold: 12 }).displayMode === 'normal', '10 cards should be normal at threshold 12');
  assert(buildHandViewModel(cards, { compactThreshold: 8 }).displayMode === 'compact', '10 cards should be compact at threshold 8');
});

test('Judge/detailed density does not bypass private-zone guards by itself', () => {
  useGameStore.setState(state => ({
    ...state,
    game: makePermissionGame(),
    localPlayerId: 'p1',
    multiplayer: { ...state.multiplayer, status: 'host', isSpectator: false },
    ui: { ...state.ui, judgeMode: false, zoneDrawer: null, settings: normalizeUISettings({ ...state.ui.settings, density: 'judge' }) },
  }));
  useGameStore.getState().openZoneDrawer('library', 'p2');
  assert(useGameStore.getState().ui.zoneDrawer === null, 'density judge must not open opponent private library');
});

console.log(`\nUI settings tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
