/**
 * Type query helper checks.
 *
 * Run with: npx tsx tests/type-query.test.ts
 */

import {
  createCardState,
  getCardTypes,
  getCreatureTypes,
  getEffectiveCreatureTypes,
  getKindredSubtypes,
  getSubtypes,
  getTypeLine,
  hasCardType,
  hasPrintedPowerToughness,
  hasCreatureType,
  hasSubtype,
  isArtifact,
  isBattle,
  isLegendary,
  isChangeling,
  isClassCard,
  isCreature,
  isEnchantment,
  isKindred,
  isLand,
  isPlaneswalker,
  isSpacecraft,
  isToken,
  isVehicle,
  sharesCreatureType,
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

  assert(getTypeLine(card) === 'Creature - Human Warrior', 'expected raw type line');
  assert(getCardTypes(card).includes('Creature'), 'expected parsed Creature card type');
  assert(getSubtypes(card).includes('Human'), 'expected parsed Human subtype');
  assert(types.includes('Human'), 'expected Human');
  assert(types.includes('Warrior'), 'expected Warrior');
  assert(!types.includes('Shrine'), 'expected noncreature subtype excluded');
});

test('Parses legendary artifact creature type line without treating Legendary as card type', () => {
  const card = createCardState({
    ...baseDef,
    id: 'legendary-artifact-creature',
    name: 'Legendary Artifact Creature',
    typeLine: 'Legendary Artifact Creature — Golem Wizard',
    superTypes: [],
    cardTypes: [],
    subTypes: [],
  }, 'p1');

  assert(isLegendary(card), 'expected legendary detection');
  assert(isArtifact(card), 'expected artifact type');
  assert(isCreature(card), 'expected creature type');
  assert(!hasCardType(card, 'Legendary'), 'expected Legendary not treated as card type');
  assert(hasCreatureType(card, 'Golem'), 'expected Golem creature type');
  assert(hasCreatureType(card, 'Wizard'), 'expected Wizard creature type');
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

test('Missing type line is safe and oracle Changeling still works outside battlefield', () => {
  const card = createCardState({
    ...baseDef,
    id: 'missing-type-changeling',
    name: 'Missing Type Changeling',
    typeLine: undefined as any,
    cardTypes: [],
    subTypes: [],
    oracleText: 'Changeling',
    keywords: [],
    power: undefined,
    toughness: undefined,
  }, 'p1', 'hand');

  assert(getTypeLine(card) === '', 'expected empty type line fallback');
  assert(getCardTypes(card).length === 0, 'expected no card types');
  assert(getSubtypes(card).length === 0, 'expected no subtypes');
  assert(isChangeling(card), 'expected oracle Changeling detection');
  assert(hasCreatureType(card, 'Avatar'), 'expected Changeling has Avatar in hand');
  assert(hasCreatureType(card, 'Elder'), 'expected Changeling has Elder in hand');
});

test('Spacecraft Vehicle Legendary and printed P/T helpers detect metadata and type lines', () => {
  const spacecraft = createCardState({
    ...baseDef,
    id: 'spacecraft-helper',
    name: 'Legendary Spacecraft',
    typeLine: 'Legendary Artifact - Spacecraft',
    superTypes: [],
    cardTypes: ['Artifact'],
    subTypes: [],
    power: '5',
    toughness: '5',
  }, 'p1');
  const vehicle = createCardState({
    ...baseDef,
    id: 'vehicle-helper',
    name: 'Legendary Vehicle',
    typeLine: 'Legendary Artifact - Vehicle',
    superTypes: ['Legendary'],
    cardTypes: ['Artifact'],
    subTypes: ['Vehicle'],
    power: '3',
    toughness: '4',
  }, 'p1');

  assert(isSpacecraft(spacecraft), 'expected Spacecraft helper detection');
  assert(isVehicle(vehicle), 'expected Vehicle helper detection');
  assert(isLegendary(spacecraft), 'expected Legendary detection from typeLine');
  assert(isLegendary(vehicle), 'expected Legendary detection from superTypes');
  assert(hasPrintedPowerToughness(spacecraft), 'expected printed P/T for Spacecraft');
  assert(hasPrintedPowerToughness(vehicle), 'expected printed P/T for Vehicle');
});

test('Class helper detects Class enchantment subtype from type line and metadata', () => {
  const typeLineClass = createCardState({
    ...baseDef,
    id: 'class-type-line',
    name: 'Type Line Class',
    typeLine: 'Enchantment - Class',
    cardTypes: ['Enchantment'],
    subTypes: [],
    power: undefined,
    toughness: undefined,
  }, 'p1');
  const metadataClass = createCardState({
    ...baseDef,
    id: 'class-metadata',
    name: 'Metadata Class',
    typeLine: 'Enchantment',
    cardTypes: ['Enchantment'],
    subTypes: ['Class'],
    power: undefined,
    toughness: undefined,
  }, 'p1');

  assert(isClassCard(typeLineClass), 'expected Class detection from type line');
  assert(isClassCard(metadataClass), 'expected Class detection from subtype metadata');
});

test('Kindred helpers parse noncreature creature subtypes without making card a creature', () => {
  const instant = createCardState({
    ...baseDef,
    id: 'kindred-instant-em-dash',
    name: 'Kindred Goblin Instant',
    typeLine: 'Kindred Instant — Goblin',
    cardTypes: [],
    subTypes: [],
    power: undefined,
    toughness: undefined,
  }, 'p1');
  const enchantment = createCardState({
    ...baseDef,
    id: 'kindred-faerie',
    name: 'Kindred Faerie Enchantment',
    typeLine: 'Kindred Enchantment — Faerie',
    cardTypes: [],
    subTypes: [],
    power: undefined,
    toughness: undefined,
  }, 'p1');

  assert(isKindred(instant), 'expected Kindred Instant');
  assert(hasCardType(instant, 'Instant'), 'expected Instant card type');
  assert(hasSubtype(instant, 'Goblin'), 'expected Goblin subtype');
  assert(hasCreatureType(instant, 'Goblin'), 'expected Goblin creature subtype query');
  assert(!isCreature(instant), 'expected Kindred Instant not creature');
  assert(getKindredSubtypes(instant).includes('Goblin'), 'expected Kindred subtype list');
  assert(isKindred(enchantment), 'expected Kindred Enchantment');
  assert(isEnchantment(enchantment), 'expected Enchantment card type');
  assert(hasSubtype(enchantment, 'Faerie'), 'expected Faerie subtype');
});

test('Permanent and token convenience helpers are safe', () => {
  const land = createCardState({ ...baseDef, id: 'helper-land', name: 'Land', typeLine: 'Land', cardTypes: [], subTypes: [], power: undefined, toughness: undefined }, 'p1');
  const walker = createCardState({ ...baseDef, id: 'helper-walker', name: 'Walker', typeLine: 'Legendary Planeswalker — Jace', cardTypes: [], subTypes: [], power: undefined, toughness: undefined }, 'p1');
  const battle = createCardState({ ...baseDef, id: 'helper-battle', name: 'Battle', typeLine: 'Battle — Siege', cardTypes: [], subTypes: [], power: undefined, toughness: undefined }, 'p1');
  const token = createCardState({ ...baseDef, id: 'helper-token', name: 'Token', typeLine: 'Token Creature — Goblin', cardTypes: [], subTypes: [], power: '1', toughness: '1' }, 'p1', 'battlefield', false, true);

  assert(isLand(land), 'expected land helper');
  assert(isPlaneswalker(walker), 'expected planeswalker helper');
  assert(isBattle(battle), 'expected battle helper');
  assert(isToken(token), 'expected token helper');
});

test('sharesCreatureType handles normal, Kindred, and Changeling cards', () => {
  const goblin = createCardState({ ...baseDef, id: 'share-goblin', name: 'Goblin', typeLine: 'Creature — Goblin Warrior', subTypes: [] }, 'p1');
  const kindredGoblin = createCardState({ ...baseDef, id: 'share-kindred', name: 'Kindred Goblin', typeLine: 'Kindred Instant — Goblin', cardTypes: [], subTypes: [], power: undefined, toughness: undefined }, 'p1');
  const changeling = createCardState({ ...baseDef, id: 'share-changeling', name: 'Changeling', typeLine: 'Creature — Shapeshifter', oracleText: 'Changeling', subTypes: ['Shapeshifter'] }, 'p1');
  const elf = createCardState({ ...baseDef, id: 'share-elf', name: 'Elf', typeLine: 'Creature — Elf', subTypes: [] }, 'p1');

  assert(sharesCreatureType(goblin, kindredGoblin), 'expected Goblin shared with Kindred Goblin');
  assert(sharesCreatureType(changeling, elf), 'expected Changeling shares with Elf');
});

console.log(`\nType query tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
