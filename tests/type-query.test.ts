/**
 * Type query helper checks.
 *
 * Run with: npx tsx tests/type-query.test.ts
 */

import {
  createCardState,
  getCreatureTypes,
  getEffectiveCreatureTypes,
  hasCardType,
  hasCreatureType,
  hasSubtype,
  isChangeling,
} from '../client/src/engine/gameEngine';
import type { CardDefinition } from '../client/src/types/game';

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
  typeLine: 'Creature - Human Warrior',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Human', 'Warrior'],
  oracleText: '',
  colors: [],
  colorIdentity: [],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '2',
  toughness: '2',
};

test('Changeling card has Goblin, Elf, Warrior, and other creature types', () => {
  const card = createCardState({
    ...baseDef,
    id: 'changeling',
    name: 'Changeling',
    typeLine: 'Creature - Shapeshifter',
    subTypes: ['Shapeshifter'],
    oracleText: 'Changeling',
    keywords: ['Changeling'],
  }, 'p1');

  assert(isChangeling(card), 'expected changeling detection');
  assert(hasCreatureType(card, 'Goblin'), 'expected Goblin type');
  assert(hasCreatureType(card, 'Elf'), 'expected Elf type');
  assert(hasCreatureType(card, 'Warrior'), 'expected Warrior type');
  assert(getEffectiveCreatureTypes(card).includes('Goblin'), 'expected effective all-types list');
});

test('Noncreature Kindred card can have creature subtype', () => {
  const card = createCardState({
    ...baseDef,
    id: 'kindred-goblin',
    name: 'Kindred Goblin Spell',
    typeLine: 'Kindred Sorcery - Goblin',
    cardTypes: ['Kindred', 'Sorcery'],
    subTypes: ['Goblin'],
    power: undefined,
    toughness: undefined,
  }, 'p1');

  assert(hasCardType(card, 'Kindred'), 'expected Kindred type');
  assert(hasSubtype(card, 'Goblin'), 'expected Goblin subtype');
  assert(hasCreatureType(card, 'Goblin'), 'expected Kindred creature subtype query');
});

test('Normal creature returns parsed creature types', () => {
  const card = createCardState(baseDef, 'p1');
  const types = getCreatureTypes(card);

  assert(types.includes('Human'), 'expected Human');
  assert(types.includes('Warrior'), 'expected Warrior');
  assert(!types.includes('Shrine'), 'expected noncreature subtype excluded');
});

test('Type helper detects Artifact Enchantment and Land from metadata and typeLine', () => {
  const card = createCardState({
    ...baseDef,
    id: 'artifact-enchantment-land',
    name: 'Mixed Permanent',
    typeLine: 'Artifact Enchantment Land',
    cardTypes: [],
    subTypes: [],
    power: undefined,
    toughness: undefined,
  }, 'p1');

  assert(hasCardType(card, 'Artifact'), 'expected Artifact');
  assert(hasCardType(card, 'Enchantment'), 'expected Enchantment');
  assert(hasCardType(card, 'Land'), 'expected Land');
});

test('Unknown type line returns safe empty subtype array', () => {
  const card = createCardState({
    ...baseDef,
    id: 'unknown-type',
    name: 'Unknown Type',
    typeLine: 'Mystery Object',
    cardTypes: [],
    subTypes: [],
    power: undefined,
    toughness: undefined,
  }, 'p1');

  assert(getCreatureTypes(card).length === 0, 'expected no creature types');
  assert(getEffectiveCreatureTypes(card).length === 0, 'expected no effective creature types');
  assert(!hasSubtype(card, 'Goblin'), 'expected missing subtype false');
});

console.log(`\nType query tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
