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
  getDeckBuilderRows,
  removeCardLogic,
  serializeDeckLogic,
  setCardNote,
  setDeckEntryCount,
  summarizeCardLogic,
  upsertCustomCard,
} from '../client/src/engine/soloDeckBuilder';
import { importDecklist } from '../client/src/engine/deckImport';
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
const visibleRows = getDeckBuilderRows(deck);
const visibleCommanderRows = visibleRows.filter(row => row.name === 'Muldrotha, the Gravetide');
assert(visibleCommanderRows.length === 1, 'expected commander to render only once in deck builder rows');
assert(visibleCommanderRows[0].section === 'commander', 'expected visible commander row to stay in commander section');
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
deck = upsertCustomCard(deck, customCardFromDefinition({
  ...scryfallDef,
  id: 'oracle-sejiri-shelter',
  name: 'Sejiri Shelter // Sejiri Glacier',
  typeLine: 'Instant // Land',
  cardTypes: ['Instant'],
  oracleText: 'Target creature you control gains protection from the color of your choice until end of turn.\n---\nSejiri Glacier enters the battlefield tapped.',
  imageUrlBack: 'https://cards.scryfall.io/normal/back/sejiri.jpg',
  isDoubleFaced: true,
  faces: [
    {
      name: 'Sejiri Shelter',
      manaCost: { raw: '{1}{W}', cmc: 2, W: 1, generic: 1 },
      cmc: 2,
      typeLine: 'Instant',
      superTypes: [],
      cardTypes: ['Instant'],
      subTypes: [],
      oracleText: 'Target creature you control gains protection from the color of your choice until end of turn.',
      colors: ['W'],
      keywords: [],
      imageUrl: 'https://cards.scryfall.io/normal/front/sejiri.jpg',
    },
    {
      name: 'Sejiri Glacier',
      typeLine: 'Land',
      superTypes: [],
      cardTypes: ['Land'],
      subTypes: [],
      oracleText: 'Sejiri Glacier enters the battlefield tapped.',
      colors: [],
      keywords: [],
      imageUrl: 'https://cards.scryfall.io/normal/back/sejiri.jpg',
    },
  ],
}));
const mdfcLogic = deck.logicFile?.customCards.find(card => card.name === 'Sejiri Shelter // Sejiri Glacier');
assert(mdfcLogic?.faces?.[1]?.cardTypes.includes('Land'), 'expected solo card logic to preserve MDFC land face');
deck = upsertCustomCard(deck, customCardFromDefinition({
  ...scryfallDef,
  id: 'oracle-sol-ring',
  name: 'Sol Ring',
  manaCost: { raw: '{1}', cmc: 1, generic: 1 },
  cmc: 1,
  typeLine: 'Artifact',
  cardTypes: ['Artifact'],
  colors: [],
  colorIdentity: [],
  oracleText: '{T}: Add {C}{C}.',
}));
deck = upsertCustomCard(deck, customCardFromDefinition({
  ...scryfallDef,
  id: 'oracle-forest',
  name: 'Forest',
  manaCost: { raw: '', cmc: 0 },
  cmc: 0,
  typeLine: 'Basic Land - Forest',
  cardTypes: ['Land'],
  colors: [],
  colorIdentity: ['G'],
  oracleText: '({T}: Add {G}.)',
}));
deck = setDeckEntryCount(deck, 'main', 'Counterspell', 1);
deck = upsertCustomCard(deck, customCardFromDefinition({
  ...scryfallDef,
  id: 'oracle-counterspell',
  name: 'Counterspell',
  manaCost: { raw: '{U}{U}', cmc: 2, U: 2 },
  cmc: 2,
  typeLine: 'Instant',
  cardTypes: ['Instant'],
  oracleText: 'Counter target spell.',
}));
deck = setDeckEntryCount(deck, 'main', 'Cultivate', 1);
deck = upsertCustomCard(deck, customCardFromDefinition({
  ...scryfallDef,
  id: 'oracle-cultivate',
  name: 'Cultivate',
  manaCost: { raw: '{2}{G}', cmc: 3, G: 1, generic: 2 },
  cmc: 3,
  typeLine: 'Sorcery',
  cardTypes: ['Sorcery'],
  colors: ['G'],
  colorIdentity: ['G'],
  oracleText: 'Search your library for up to two basic land cards.',
}));
assert(summarizeCardLogic(deck, 'Oracle Adept').customCard, 'expected fetched Scryfall card to become visible custom card logic');
const scryfallSerialized = serializeDeckLogic(deck);
assert(scryfallSerialized.includes('card: Oracle Adept | Creature - Human Wizard'), 'expected fetched type line in logic export');
assert(scryfallSerialized.includes('scry 1. / Then investigate.'), 'expected multiline oracle text to serialize safely on one line');
assert(!scryfallSerialized.includes('scry 1.\nThen investigate.'), 'expected logic export not to contain embedded oracle newlines');

const stats = analyzeDeckBuilderStats(deck);
assert(stats.totalCards >= 9, 'expected stats to count deck cards');
assert(stats.creatureCount >= 1, 'expected stats to count fetched/custom creatures');
assert(stats.landCount === 6, 'expected stats to count known lands separately');
assert(stats.artifactCount === 1, 'expected stats to count known artifacts separately');
assert(stats.instantCount === 1, 'expected stats to count known instants separately');
assert(stats.sorceryCount === 1, 'expected stats to count known sorceries separately');
assert(stats.curve[2] >= 1, 'expected stats to include Scryfall mana curve data');
assert(stats.colorPips.U >= 1, 'expected stats to include Scryfall color identity data');

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url);
  const makeCard = (name: string, typeLine: string, colors: string[] = []) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    oracle_id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-oracle`,
    name,
    mana_cost: typeLine.includes('Land') ? '' : '{1}',
    cmc: typeLine.includes('Land') ? 0 : 1,
    type_line: typeLine,
    oracle_text: '',
    colors,
    color_identity: colors,
    keywords: [],
    legalities: { commander: 'legal' },
  });
  const catalog: Record<string, ReturnType<typeof makeCard>> = {
    'Llanowar Elves': makeCard('Llanowar Elves', 'Creature - Elf Druid', ['G']),
    'Forest': makeCard('Forest', 'Basic Land - Forest'),
    'Sol Ring': makeCard('Sol Ring', 'Artifact'),
    'Counterspell': makeCard('Counterspell', 'Instant', ['U']),
    'Cultivate': makeCard('Cultivate', 'Sorcery', ['G']),
  };
  if (target.includes('/cards/collection')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { identifiers?: { name?: string }[] };
    const names = (body.identifiers ?? []).map(item => item.name).filter((name): name is string => Boolean(name));
    return new Response(JSON.stringify({ data: names.map(name => catalog[name]).filter(Boolean), not_found: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

try {
  const imported = await importDecklist([
    'Deck',
    '1 Llanowar Elves',
    '4 Forest',
    '1 Sol Ring',
    '1 Counterspell',
    '1 Cultivate',
  ].join('\n'), 'Captured Type Import', 'solo-builder-test', undefined, undefined, { captureFetchedCardData: true });
  const importedStats = analyzeDeckBuilderStats(imported.deck);
  assert(imported.deck.logicFile?.customCards.length === 5, 'expected solo import to capture fetched Scryfall card metadata');
  assert(importedStats.creatureCount === 1, 'expected imported creature count');
  assert(importedStats.landCount === 4, 'expected imported land count');
  assert(importedStats.artifactCount === 1, 'expected imported artifact count');
  assert(importedStats.instantCount === 1, 'expected imported instant count');
  assert(importedStats.sorceryCount === 1, 'expected imported sorcery count');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS solo deck builder edits cards, sections, and visible card logic');
