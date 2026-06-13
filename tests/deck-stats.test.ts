import { analyzeDeck } from '../client/src/engine/deckStats';
import { createBlankDeck, markDeckCommander, setDeckEntryCount, upsertCustomCard } from '../client/src/engine/soloDeckBuilder';
import type { CustomCardDefinition, Deck } from '../client/src/types/game';

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

function card(name: string, typeLine: string, cmc?: number, colorIdentity: CustomCardDefinition['colorIdentity'] = [], oracleText = ''): CustomCardDefinition {
  return {
    id: `test-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    typeLine,
    cardTypes: typeLine.split(/[-—]/)[0].split(/\s+/).filter(type => ['Creature', 'Land', 'Artifact', 'Enchantment', 'Planeswalker', 'Instant', 'Sorcery', 'Battle'].includes(type)) as CustomCardDefinition['cardTypes'],
    cmc,
    colorIdentity,
    colors: colorIdentity,
    oracleText,
  };
}

function baseDeck(): Deck {
  let deck = createBlankDeck('Stats Test');
  deck = markDeckCommander(deck, 'Ezuri, Renegade Leader');
  deck = upsertCustomCard(deck, card('Ezuri, Renegade Leader', 'Legendary Creature - Elf Warrior', 3, ['G']));
  return { ...deck, colorIdentity: ['G'] };
}

test('land count works', () => {
  let deck = baseDeck();
  deck = setDeckEntryCount(deck, 'main', 'Forest', 37);
  deck = upsertCustomCard(deck, card('Forest', 'Basic Land - Forest', 0, []));
  const stats = analyzeDeck(deck);
  assert(stats.landCount === 37, `expected 37 lands, got ${stats.landCount}`);
});

test('creature count works', () => {
  let deck = baseDeck();
  deck = setDeckEntryCount(deck, 'main', 'Llanowar Elves', 1);
  deck = upsertCustomCard(deck, card('Llanowar Elves', 'Creature - Elf Druid', 1, ['G']));
  const stats = analyzeDeck(deck);
  assert(stats.creatureCount === 2, `expected commander plus Llanowar Elves as 2 creatures, got ${stats.creatureCount}`);
});

test('mana curve groups cards', () => {
  let deck = baseDeck();
  deck = setDeckEntryCount(deck, 'main', 'Sol Ring', 1);
  deck = setDeckEntryCount(deck, 'main', 'Cultivate', 1);
  deck = upsertCustomCard(deck, card('Sol Ring', 'Artifact', 1, [], '{T}: Add {C}{C}.'));
  deck = upsertCustomCard(deck, card('Cultivate', 'Sorcery', 3, ['G'], 'Search your library for up to two basic land cards.'));
  const stats = analyzeDeck(deck);
  assert(stats.manaCurve['1'] === 1, `expected one MV 1 card, got ${stats.manaCurve['1']}`);
  assert(stats.manaCurve['3'] === 2, `expected commander plus Cultivate at MV 3, got ${stats.manaCurve['3']}`);
});

test('average mana value excludes lands', () => {
  let deck = baseDeck();
  deck = setDeckEntryCount(deck, 'main', 'Forest', 20);
  deck = setDeckEntryCount(deck, 'main', 'Sol Ring', 1);
  deck = setDeckEntryCount(deck, 'main', 'Cultivate', 1);
  deck = upsertCustomCard(deck, card('Forest', 'Basic Land - Forest', 0, []));
  deck = upsertCustomCard(deck, card('Sol Ring', 'Artifact', 1, [], '{T}: Add {C}{C}.'));
  deck = upsertCustomCard(deck, card('Cultivate', 'Sorcery', 3, ['G']));
  const stats = analyzeDeck(deck);
  assert(Math.abs(stats.averageManaValue - 7 / 3) < 0.001, `expected average MV 2.333 excluding lands, got ${stats.averageManaValue}`);
});

test('unknown MV does not crash', () => {
  let deck = baseDeck();
  deck = setDeckEntryCount(deck, 'main', 'Mystery Spell', 1);
  const stats = analyzeDeck(deck);
  assert(stats.manaCurve.unknown === 1, `expected one unknown MV card, got ${stats.manaCurve.unknown}`);
  assert(stats.warnings.some(warning => warning.includes('unknown mana value')), 'expected unknown mana value warning');
});

test('color distribution works', () => {
  let deck = baseDeck();
  deck = setDeckEntryCount(deck, 'main', 'Growth Spiral', 1);
  deck = setDeckEntryCount(deck, 'main', 'Lightning Bolt', 2);
  deck = upsertCustomCard(deck, card('Growth Spiral', 'Instant', 2, ['G', 'U']));
  deck = upsertCustomCard(deck, card('Lightning Bolt', 'Instant', 1, ['R']));
  const stats = analyzeDeck(deck);
  assert(stats.colorDistribution.G === 2, `expected G count commander plus Growth Spiral = 2, got ${stats.colorDistribution.G}`);
  assert(stats.colorDistribution.U === 1, `expected U count 1, got ${stats.colorDistribution.U}`);
  assert(stats.colorDistribution.R === 2, `expected R count 2, got ${stats.colorDistribution.R}`);
});

test('stats panel handles empty deck', () => {
  const stats = analyzeDeck(createBlankDeck('Empty'));
  assert(stats.totalCards === 0, 'expected empty total');
  assert(stats.landCount === 0, 'expected empty lands');
  assert(stats.averageManaValue === 0, 'expected empty average MV');
});

console.log(`\nDeck stats tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
