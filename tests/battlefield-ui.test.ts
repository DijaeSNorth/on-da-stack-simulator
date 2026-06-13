/**
 * Battlefield UI model checks.
 *
 * Run with: npx tsx tests/battlefield-ui.test.ts
 */

import {
  buildBattlefieldView,
  canBattlefieldCardAttack,
  canBattlefieldCardBlock,
  groupBattlefieldSections,
  type BattlefieldFilterChip,
} from '../client/src/components/battlefield/battlefieldUiModel';
import { createCardState } from '../client/src/engine/gameEngine';
import type { CardDefinition, CardState } from '../client/src/types/game';

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

const baseDef: CardDefinition = {
  id: 'battlefield-base',
  name: 'Battlefield Base',
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
  power: '2',
  toughness: '2',
};

function makeCard(definition: Partial<CardDefinition>, state: Partial<CardState> = {}): CardState {
  const card = createCardState({
    ...baseDef,
    ...definition,
    id: definition.id ?? definition.name ?? baseDef.id,
  }, state.ownerId ?? 'p1', 'battlefield', state.tapped ?? false, state.token ?? false);
  return { ...card, ...state, zone: 'battlefield', definition: { ...card.definition, ...definition } };
}

const land = makeCard({
  id: 'forest-ui',
  name: 'Forest',
  typeLine: 'Basic Land - Forest',
  superTypes: ['Basic'],
  cardTypes: ['Land'],
  subTypes: ['Forest'],
  oracleText: 'Tap: Add G.',
  colors: [],
  colorIdentity: ['G'],
  power: undefined,
  toughness: undefined,
});

const creature = makeCard({
  id: 'bear-ui',
  name: 'Rune Bear',
  typeLine: 'Creature - Bear',
  cardTypes: ['Creature'],
  subTypes: ['Bear'],
  oracleText: 'A reliable blocker.',
  power: '2',
  toughness: '2',
});

const tappedCreature = makeCard({
  id: 'tapped-bear-ui',
  name: 'Tapped Bear',
  typeLine: 'Creature - Bear',
  cardTypes: ['Creature'],
  subTypes: ['Bear'],
  power: '3',
  toughness: '3',
}, { tapped: true });

const token = makeCard({
  id: 'goblin-token-ui',
  name: 'Goblin Token',
  typeLine: 'Token Creature - Goblin',
  cardTypes: ['Creature'],
  subTypes: ['Goblin'],
  colors: ['R'],
  colorIdentity: ['R'],
  power: '1',
  toughness: '1',
}, { token: true });

const artifact = makeCard({
  id: 'sol-ring-ui',
  name: 'Sol Ring',
  typeLine: 'Artifact',
  cardTypes: ['Artifact'],
  subTypes: [],
  oracleText: 'Tap: Add CC.',
  colors: [],
  colorIdentity: ['C'],
  power: undefined,
  toughness: undefined,
});

const allCards = [land, creature, tappedCreature, token, artifact];

test('Lands can be grouped for collapse', () => {
  const sections = groupBattlefieldSections(allCards);
  const lands = sections.find(section => section.key === 'lands');
  assert(lands?.cards.length === 1, 'expected one land section card');
});

test('Tokens can be grouped for collapse', () => {
  const sections = groupBattlefieldSections(allCards);
  const tokens = sections.find(section => section.key === 'tokens');
  assert(tokens?.cards.length === 1, 'expected one token section card');
});

test('Search filters battlefield cards', () => {
  const view = buildBattlefieldView(allCards, { search: 'sol artifact' });
  assert(view.filteredCards.length === 1, `expected one result, got ${view.filteredCards.length}`);
  assert(view.filteredCards[0].instanceId === artifact.instanceId, 'expected Sol Ring result');
});

test('Tapped/untapped filter works', () => {
  const tappedFilters = new Set<BattlefieldFilterChip>(['tapped']);
  const untappedFilters = new Set<BattlefieldFilterChip>(['untapped']);
  assert(buildBattlefieldView(allCards, { filters: tappedFilters }).filteredCards.length === 1, 'expected one tapped card');
  assert(buildBattlefieldView(allCards, { filters: untappedFilters }).filteredCards.length === allCards.length - 1, 'expected all but tapped card');
});

test('Can attack and can block helpers are safe', () => {
  assert(canBattlefieldCardAttack(creature), 'untapped non-sick creature can attack');
  assert(!canBattlefieldCardAttack(tappedCreature), 'tapped creature cannot attack');
  assert(canBattlefieldCardBlock(creature), 'untapped creature can block');
  assert(!canBattlefieldCardBlock(tappedCreature), 'tapped creature cannot block');
});

test('Large battlefield renders as ultra compact without crashing', () => {
  const large = Array.from({ length: 40 }, (_, index) => makeCard({
    id: `large-battlefield-${index}`,
    name: `Large Battlefield ${index}`,
  }));
  const view = buildBattlefieldView(large);
  assert(view.density === 'ultraCompact', `expected ultraCompact, got ${view.density}`);
  assert(view.filteredCards.length === 40, 'expected all large-board cards');
});

test('Threat summary counts board pressure', () => {
  const attacker = { ...creature, instanceId: 'attacker-ui', combatRole: 'attacker' as const };
  const view = buildBattlefieldView([attacker, token, land], { combatActive: true });
  assert(view.summary.totalCreatures === 2, 'expected two creatures including token');
  assert(view.summary.tokenCount === 1, 'expected one token');
  assert(view.summary.attackingPower === 2, 'expected attacking power from attacker');
});

console.log(`\nBattlefield UI tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
