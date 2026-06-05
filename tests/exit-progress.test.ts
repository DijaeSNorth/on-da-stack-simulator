/**
 * Exit progress snapshot regression checks.
 *
 * Run with: npx tsx tests/exit-progress.test.ts
 */

import {
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
} from '../client/src/engine/gameEngine';
import {
  createExitProgressSnapshot,
  loadExitProgressSnapshots,
  saveExitProgressSnapshot,
} from '../client/src/engine/exitProgress';
import type { CardDefinition, Deck } from '../client/src/types/game';

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
};

if (!(globalThis as any).crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => `exit-${Math.random().toString(16).slice(2)}` },
    configurable: true,
  });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const testCard: CardDefinition = {
  id: 'test-card',
  name: 'Exit Test Card',
  cmc: 1,
  typeLine: 'Creature - Test',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Test'],
  oracleText: '',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '1',
  toughness: '1',
};

function makeDeck(id: string, name: string): Deck {
  return {
    id,
    name,
    format: 'commander',
    commanders: ['Exit Commander'],
    cards: [{ name: 'Exit Commander', count: 1 }, { name: 'Forest', count: 99 }],
    sideboard: [],
    maybeboard: [],
    colorIdentity: ['G'],
    importedAt: 1,
  };
}

storage.clear();

const config = createDefaultGameConfig(2);
const player = {
  ...createPlayer('p1', 'Exit Tester', 0, '#22c55e', config),
  deckId: 'deck-1',
  library: [
    createCardState(testCard, 'p1', 'library'),
    createCardState({ ...testCard, id: 'test-card-2' }, 'p1', 'library'),
  ],
  hand: [createCardState({ ...testCard, id: 'test-card-3' }, 'p1', 'hand')],
  commandZone: [createCardState({ ...testCard, id: 'test-card-4' }, 'p1', 'command', true)],
};
const game = {
  ...createEmptyGameState(config),
  players: [player],
  turn: 4,
  phase: 'combat' as const,
  actionLog: [
    { id: 'a1', timestamp: 1, playerId: 'p1', action: 'test', description: 'Test action' },
  ],
};

const snapshot = createExitProgressSnapshot(game, [makeDeck('deck-1', 'Exit Combo Lab')]);
assert(snapshot.turn === 4, 'expected snapshot to keep the turn number');
assert(snapshot.phase === 'combat', 'expected snapshot to keep the phase');
assert(snapshot.actionCount === 1, 'expected snapshot to count replay actions');
assert(snapshot.deckSummaries[0].deckName === 'Exit Combo Lab', 'expected saved deck names to resolve');
assert(snapshot.deckSummaries[0].libraryCount === 2, 'expected library count to be saved');
assert(snapshot.deckSummaries[0].handCount === 1, 'expected hand count to be saved');
assert(snapshot.deckSummaries[0].commandZoneCount === 1, 'expected command-zone count to be saved');

for (let index = 0; index < 7; index++) {
  saveExitProgressSnapshot({
    ...snapshot,
    id: `snapshot-${index}`,
    savedAt: index,
    turn: index + 1,
  });
}

const saved = loadExitProgressSnapshots();
assert(saved.length === 5, `expected exit progress storage to keep 5 snapshots, got ${saved.length}`);
assert(saved.map(item => item.id).join(',') === 'snapshot-6,snapshot-5,snapshot-4,snapshot-3,snapshot-2', 'expected newest exit snapshots first');

console.log('PASS exit progress snapshots capture deck state and keep the latest 5 exits');
