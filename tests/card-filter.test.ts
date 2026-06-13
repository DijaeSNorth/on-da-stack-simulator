/**
 * Card filter/search helper checks.
 *
 * Run with: npx tsx tests/card-filter.test.ts
 */

import {
  filterCards,
  getCardSearchText,
  groupCards,
  matchesCardSearch,
  sortCards,
} from '../client/src/engine/cardFilter';
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
  id: 'base',
  name: 'Base',
  cmc: 0,
  typeLine: 'Creature - Human',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Human'],
  oracleText: '',
  colors: [],
  colorIdentity: [],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '1',
  toughness: '1',
};

function makeCard(definition: Partial<CardDefinition>, state: Partial<CardState> = {}): CardState {
  const card = createCardState({
    ...baseDef,
    ...definition,
    id: definition.id ?? definition.name ?? baseDef.id,
  }, 'p1', state.zone ?? 'battlefield', state.tapped ?? false, state.token ?? false);
  return { ...card, ...state, definition: { ...card.definition, ...definition } };
}

const elf = makeCard({
  id: 'llanowar-elves',
  name: 'Llanowar Elves',
  cmc: 1,
  typeLine: 'Creature - Elf Druid',
  cardTypes: ['Creature'],
  subTypes: ['Elf', 'Druid'],
  oracleText: '{T}: Add {G}.',
  colors: ['G'],
  colorIdentity: ['G'],
  power: '1',
  toughness: '1',
});

const ring = makeCard({
  id: 'sol-ring',
  name: 'Sol Ring',
  cmc: 1,
  typeLine: 'Artifact',
  cardTypes: ['Artifact'],
  subTypes: [],
  oracleText: '{T}: Add {C}{C}.',
  colors: [],
  colorIdentity: ['C'],
  power: undefined,
  toughness: undefined,
}, { tapped: true });

const bolt = makeCard({
  id: 'lightning-bolt',
  name: 'Lightning Bolt',
  cmc: 1,
  typeLine: 'Instant',
  cardTypes: ['Instant'],
  subTypes: [],
  oracleText: 'Lightning Bolt deals 3 damage to any target.',
  colors: ['R'],
  colorIdentity: ['R'],
  power: undefined,
  toughness: undefined,
}, { zone: 'hand' });

const angel = makeCard({
  id: 'angel-token',
  name: 'Angel Token',
  cmc: 0,
  typeLine: 'Token Creature - Angel',
  cardTypes: ['Creature'],
  subTypes: ['Angel'],
  oracleText: 'Flying',
  colors: ['W'],
  colorIdentity: ['W'],
  keywords: ['Flying'],
  power: '4',
  toughness: '4',
}, { token: true, combatRole: 'attacker', summoningSick: true });

const clue = makeCard({
  id: 'clue-token',
  name: 'Clue',
  cmc: 0,
  typeLine: 'Token Artifact - Clue',
  cardTypes: ['Artifact'],
  subTypes: ['Clue'],
  oracleText: '{2}, Sacrifice this artifact: Draw a card.',
  colors: [],
  colorIdentity: [],
  power: undefined,
  toughness: undefined,
}, { token: true });

const allCards = [elf, ring, bolt, angel, clue];

test('Search by card name', () => {
  assert(matchesCardSearch(elf, 'llanowar'), 'expected name search to match');
  assert(filterCards(allCards, { query: 'sol ring' })[0]?.instanceId === ring.instanceId, 'expected Sol Ring result');
});

test('Search by type line', () => {
  const results = filterCards(allCards, { query: 'elf druid' });
  assert(results.length === 1 && results[0].instanceId === elf.instanceId, 'expected type-line search to find Elf Druid');
});

test('Filter creatures', () => {
  const names = filterCards(allCards, { creature: true }).map(card => card.definition.name);
  assert(names.includes('Llanowar Elves'), 'expected creature filter to include Elf');
  assert(names.includes('Angel Token'), 'expected creature filter to include Angel token');
  assert(!names.includes('Sol Ring'), 'expected creature filter to exclude artifact');
});

test('Filter tapped permanents', () => {
  const tapped = filterCards(allCards, { tapped: true });
  assert(tapped.length === 1 && tapped[0].instanceId === ring.instanceId, 'expected tapped Sol Ring');
});

test('Filter tokens', () => {
  const tokens = filterCards(allCards, { token: true });
  assert(tokens.length === 2, `expected 2 tokens, got ${tokens.length}`);
  assert(tokens.every(card => card.token), 'expected only token cards');
});

test('Sort by mana value', () => {
  const sorted = sortCards([bolt, angel, elf, ring], 'manaValue');
  assert(sorted[0].instanceId === angel.instanceId, 'expected zero-mana token first');
  assert(sorted.slice(1).every(card => card.definition.cmc === 1), 'expected one-mana cards after token');
});

test('Group by type', () => {
  const groups = groupCards(allCards, 'cardType');
  const creatureGroup = groups.find(group => group.key === 'Creature');
  const artifactGroup = groups.find(group => group.key === 'Artifact');
  assert(Boolean(creatureGroup), 'expected Creature group');
  assert(Boolean(artifactGroup), 'expected Artifact group');
  assert(creatureGroup?.cards.length === 2, 'expected two creatures');
});

test('Missing card fields do not crash', () => {
  const broken = {
    instanceId: 'broken',
    definition: { name: 'Mystery Custom', typeLine: 'Mystery Object' },
    counters: undefined,
  } as unknown as CardState;

  assert(matchesCardSearch(broken, 'mystery'), 'expected missing-field card name to be searchable');
  assert(getCardSearchText(broken).includes('mystery'), 'expected safe search text');
  assert(filterCards([broken], { hasCounters: false }).length === 1, 'expected missing counters to behave as no counters');
});

test('Private hidden cards can be represented safely without revealing names/text', () => {
  const hidden = makeCard({
    id: 'secret-card',
    name: 'Secret Combo Piece',
    typeLine: 'Sorcery',
    cardTypes: ['Sorcery'],
    oracleText: 'Win the game.',
    power: undefined,
    toughness: undefined,
  }, { zone: 'hand', faceDown: true });

  const safeText = getCardSearchText(hidden, { revealPrivateDetails: false });
  assert(!safeText.includes('secret'), 'expected hidden search text not to include name');
  assert(!safeText.includes('win the game'), 'expected hidden search text not to include rules text');
  assert(!matchesCardSearch(hidden, 'secret', { revealPrivateDetails: false }), 'expected hidden card not to match private name');
  assert(filterCards([hidden], { query: 'secret', revealPrivateDetails: false }).length === 0, 'expected hidden private filter to reveal no match');
});

console.log(`\nCard filter tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
