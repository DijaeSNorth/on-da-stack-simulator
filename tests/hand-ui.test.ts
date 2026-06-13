/**
 * Large hand UI model checks.
 *
 * Run with: npx tsx tests/hand-ui.test.ts
 */

import {
  buildHandViewModel,
  getHandDisplayMode,
  getHandPrivacyView,
} from '../client/src/components/hand/handUiModel';
import { createCardState } from '../client/src/engine/gameEngine';
import type { CardDefinition, CardState, CardType, ManaColor } from '../client/src/types/game';

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

function card(
  name: string,
  cmc: number,
  cardTypes: CardType[],
  colors: ManaColor[] = [],
  oracleText = '',
): CardState {
  return createCardState({
    ...baseDef,
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    cmc,
    typeLine: cardTypes.join(' '),
    cardTypes,
    subTypes: [],
    oracleText,
    colors,
    colorIdentity: colors,
    power: cardTypes.includes('Creature') ? '2' : undefined,
    toughness: cardTypes.includes('Creature') ? '2' : undefined,
  }, 'p1', 'hand');
}

const forest = card('Forest', 0, ['Land'], ['G']);
const elf = card('Llanowar Elves', 1, ['Creature'], ['G'], '{T}: Add {G}.');
const bolt = card('Lightning Bolt', 1, ['Instant'], ['R'], 'Lightning Bolt deals 3 damage.');
const ring = card('Sol Ring', 1, ['Artifact'], [], '{T}: Add {C}{C}.');
const study = card('Rhystic Study', 3, ['Enchantment'], ['U'], 'Whenever an opponent casts a spell, you may draw a card.');
const walker = card('Jace', 4, ['Planeswalker'], ['U'], '+1: Draw a card.');
const hand = [bolt, study, forest, walker, ring, elf];

test('Owner sees hand cards', () => {
  assert(getHandPrivacyView('p1', 'p1', 'host', false) === 'visible', 'expected owner hand visible');
});

test('Non-owner sees only hand count', () => {
  assert(getHandPrivacyView('p2', 'p1', 'host', false) === 'countOnly', 'expected non-owner count-only hand');
  assert(getHandPrivacyView('p1', 'p1', 'spectator', false) === 'countOnly', 'expected spectator count-only hand');
  assert(getHandPrivacyView('p2', 'p1', 'joined', true) === 'visible', 'expected judge mode inspection');
});

test('Search filters hand cards', () => {
  const view = buildHandViewModel(hand, { search: 'damage' });
  assert(view.filteredCount === 1, `expected one damage card, got ${view.filteredCount}`);
  assert(view.visibleCards[0].instanceId === bolt.instanceId, 'expected Lightning Bolt');
});

test('Sort by mana value changes order', () => {
  const view = buildHandViewModel(hand, { sortMode: 'manaValue' });
  assert(view.visibleCards[0].instanceId === forest.instanceId, 'expected zero-mana Forest first');
  assert(view.visibleCards.at(-1)?.instanceId === walker.instanceId, 'expected highest mana value last');
});

test('Group lands/nonlands by hand buckets', () => {
  const view = buildHandViewModel(hand, { groupMode: 'lands' });
  const lands = view.groups.find(group => group.key === 'lands');
  const creatures = view.groups.find(group => group.key === 'creatures');
  const spells = view.groups.find(group => group.key === 'spells');
  assert(lands?.cards.length === 1 && lands.cards[0].instanceId === forest.instanceId, 'expected land group');
  assert(creatures?.cards.length === 1 && creatures.cards[0].instanceId === elf.instanceId, 'expected creature group');
  assert(spells?.cards.length === 1 && spells.cards[0].instanceId === bolt.instanceId, 'expected instant/sorcery group');
});

test('Pinned card appears in pinned section', () => {
  const view = buildHandViewModel(hand, { pinnedIds: [ring.instanceId] });
  assert(view.pinnedCards.length === 1 && view.pinnedCards[0].instanceId === ring.instanceId, 'expected Sol Ring pinned');
  assert(!view.visibleCards.some(card => card.instanceId === ring.instanceId), 'expected pinned card removed from main visible list');
});

test('Large hand switches to compact/grid mode', () => {
  assert(getHandDisplayMode(7) === 'normal', 'expected 7 cards normal');
  assert(getHandDisplayMode(8) === 'compact', 'expected 8 cards compact');
  assert(getHandDisplayMode(14) === 'compact', 'expected 14 cards compact');
  assert(getHandDisplayMode(15) === 'grid', 'expected 15 cards grid');
});

console.log(`\nHand UI tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
