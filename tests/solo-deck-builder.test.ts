/**
 * Solo deck builder regression checks.
 *
 * Run with: npx tsx tests/solo-deck-builder.test.ts
 */

import {
  addCardTrigger,
  addReplacement,
  analyzeDeckBuilderStats,
  customCardFromDefinition,
  adjustDeckEntry,
  createBlankDeck,
  removeCardLogic,
  serializeDeckLogic,
  setCardNote,
  setDeckEntryCount,
  summarizeCardLogic,
  upsertCustomCard,
} from '../client/src/engine/soloDeckBuilder';
import type { CardDefinition } from '../client/src/types/game';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

let deck = createBlankDeck('Solo Builder Test');
deck = setDeckEntryCount(deck, 'commander', 'Muldrotha, the Gravetide', 1);
deck = setDeckEntryCount(deck, 'main', 'Sol Ring', 1);
deck = adjustDeckEntry(deck, 'main', 'Forest', 8);
deck = adjustDeckEntry(deck, 'main', 'Forest', -2);
deck = setDeckEntryCount(deck, 'sideboard', 'Nature\'s Claim', 2);

assert(deck.commanders.join(',') === 'Muldrotha, the Gravetide', 'expected commander to be tracked');
assert(deck.cards.some(card => card.name === 'Muldrotha, the Gravetide' && card.count === 1), 'expected commander to also be in deck cards');
assert(deck.cards.some(card => card.name === 'Forest' && card.count === 6), 'expected card count adjustment');
assert(deck.sideboard[0].name === 'Nature\'s Claim', 'expected sideboard entry');

deck = setCardNote(deck, 'Sol Ring', 'Track mana rocks for storm count.');
deck = addCardTrigger(deck, {
  sourceCard: 'Sol Ring',
  event: 'becomes tapped',
  effect: 'gain 1 Focus',
  reminderText: 'Sol Ring tapped: gain 1 Focus.',
});
deck = addReplacement(deck, {
  sourceCard: 'Sol Ring',
  replaces: 'would be destroyed',
  replacement: 'exile it instead',
});
deck = upsertCustomCard(deck, {
  name: 'Stack Lab Adept',
  typeLine: 'Creature - Human Wizard',
  oracleText: 'Whenever you copy a spell, investigate.',
  power: '2',
  toughness: '3',
});

const solRingSummary = summarizeCardLogic(deck, 'Sol Ring');
assert(solRingSummary.note?.includes('storm count'), 'expected card note summary');
assert(solRingSummary.triggers === 1, 'expected trigger summary');
assert(solRingSummary.replacements === 1, 'expected replacement summary');
assert(summarizeCardLogic(deck, 'Stack Lab Adept').customCard, 'expected custom card summary');

const serialized = serializeDeckLogic(deck);
assert(serialized.includes('note: Sol Ring'), 'expected serialized note');
assert(serialized.includes('trigger: Sol Ring'), 'expected serialized trigger');
assert(serialized.includes('replacement: Sol Ring'), 'expected serialized replacement');
assert(serialized.includes('card: Stack Lab Adept'), 'expected serialized custom card');

deck = removeCardLogic(deck, 'Sol Ring', 'triggers');
assert(summarizeCardLogic(deck, 'Sol Ring').triggers === 0, 'expected trigger removal');

const scryfallDef: CardDefinition = {
  id: 'oracle-test-id',
  name: 'Oracle Adept',
  manaCost: { raw: '{1}{U}', cmc: 2, U: 1, generic: 1 },
  cmc: 2,
  typeLine: 'Creature - Human Wizard',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Human', 'Wizard'],
  oracleText: 'Whenever you draw your second card each turn, scry 1.\nThen investigate.',
  power: '2',
  toughness: '2',
  colors: ['U'],
  colorIdentity: ['U'],
  keywords: [],
  imageUrl: 'https://cards.scryfall.io/normal/front/test.jpg',
  isDoubleFaced: false,
  legalities: { commander: 'legal' },
};

deck = setDeckEntryCount(deck, 'main', scryfallDef.name, 1);
deck = upsertCustomCard(deck, customCardFromDefinition(scryfallDef));
assert(summarizeCardLogic(deck, 'Oracle Adept').customCard, 'expected fetched Scryfall card to become visible custom card logic');
const scryfallSerialized = serializeDeckLogic(deck);
assert(scryfallSerialized.includes('card: Oracle Adept | Creature - Human Wizard'), 'expected fetched type line in logic export');
assert(scryfallSerialized.includes('scry 1. / Then investigate.'), 'expected multiline oracle text to serialize safely on one line');
assert(!scryfallSerialized.includes('scry 1.\nThen investigate.'), 'expected logic export not to contain embedded oracle newlines');

const stats = analyzeDeckBuilderStats(deck);
assert(stats.totalCards >= 9, 'expected stats to count deck cards');
assert(stats.creatureCount >= 1, 'expected stats to count fetched/custom creatures');
assert(stats.curve[2] >= 1, 'expected stats to include Scryfall mana curve data');
assert(stats.colorPips.U >= 1, 'expected stats to include Scryfall color identity data');

console.log('PASS solo deck builder edits cards, sections, and visible card logic');
