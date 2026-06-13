import { useGameStore } from '../client/src/store/gameStore';
import {
  adjustDeckEntry,
  createBlankDeck,
  filterDeckBuilderRows,
  getDeckBuilderRows,
  getGroupedDeckBuilderRows,
  markDeckCommander,
  setDeckEntryCount,
  unmarkDeckCommander,
  upsertCustomCard,
  validateCommanderDraft,
} from '../client/src/engine/soloDeckBuilder';
import { createDefaultGameConfig, createEmptyGameState } from '../client/src/engine/gameEngine';
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

function resetStore(): void {
  const initial = useGameStore.getInitialState();
  useGameStore.setState({
    ...initial,
    game: createEmptyGameState(createDefaultGameConfig(1)),
    ui: { ...initial.ui, screen: 'lobby', lobbyOpen: true, soloModeTab: 'builder' },
    decks: [],
    soloDeckLab: {},
    localPlayerId: '',
  });
}

function metadata(name: string, typeLine: string, colorIdentity: CustomCardDefinition['colorIdentity'] = [], oracleText = ''): CustomCardDefinition {
  return {
    id: `custom-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    typeLine,
    oracleText,
    colorIdentity,
    colors: colorIdentity,
    cmc: typeLine.includes('Land') ? 0 : 2,
  };
}

function commanderDeck(mainCount: number, commanders: string[], partner = false): Deck {
  let deck = createBlankDeck('Validation Deck');
  for (const commander of commanders) {
    deck = markDeckCommander(deck, commander);
    deck = upsertCustomCard(deck, metadata(commander, 'Legendary Creature - Human', ['G'], partner ? 'Partner' : ''));
  }
  deck = setDeckEntryCount(deck, 'main', 'Forest', mainCount);
  deck = upsertCustomCard(deck, metadata('Forest', 'Basic Land - Forest', []));
  deck = { ...deck, colorIdentity: ['G'] };
  return deck;
}

test('add card increases count', () => {
  let deck = createBlankDeck('Add Test');
  deck = adjustDeckEntry(deck, 'main', 'Sol Ring', 1);
  assert(deck.cards.reduce((sum, card) => sum + card.count, 0) === 1, 'expected one card after add');
});

test('remove card decreases count', () => {
  let deck = createBlankDeck('Remove Test');
  deck = setDeckEntryCount(deck, 'main', 'Sol Ring', 2);
  deck = adjustDeckEntry(deck, 'main', 'Sol Ring', -1);
  assert(deck.cards.find(card => card.name === 'Sol Ring')?.count === 1, 'expected one Sol Ring after decrement');
});

test('commander section updates', () => {
  let deck = createBlankDeck('Commander Test');
  deck = markDeckCommander(deck, 'Muldrotha, the Gravetide');
  assert(deck.commanders.includes('Muldrotha, the Gravetide'), 'expected commander to be marked');
  assert(getDeckBuilderRows(deck).some(row => row.section === 'commander'), 'expected commander row');
  deck = unmarkDeckCommander(deck, 'Muldrotha, the Gravetide');
  assert(deck.commanders.length === 0, 'expected commander to be unmarked');
  assert(deck.cards.some(card => card.name === 'Muldrotha, the Gravetide'), 'expected unmarked commander to remain as a main deck card');
});

test('99 main plus 1 commander validates as 100 total', () => {
  const deck = commanderDeck(99, ['Ezuri, Renegade Leader']);
  const result = validateCommanderDraft(deck);
  assert(result.valid, `expected valid 100-card commander deck, got ${result.errors.join(' ')}`);
});

test('98 main plus 2 commanders validates if pair rule allows', () => {
  const deck = commanderDeck(98, ['Partner One', 'Partner Two'], true);
  const result = validateCommanderDraft(deck);
  assert(result.valid, `expected partner pair to validate, got ${result.errors.join(' ')}`);
});

test('duplicate nonbasic warning/error works', () => {
  let deck = commanderDeck(97, ['Ezuri, Renegade Leader']);
  deck = setDeckEntryCount(deck, 'main', 'Sol Ring', 2);
  const result = validateCommanderDraft(deck);
  assert(result.errors.some(error => error.includes('Sol Ring') && error.includes('singleton')), 'expected duplicate nonbasic singleton error');
});

test('basic land duplicates allowed', () => {
  const deck = commanderDeck(99, ['Ezuri, Renegade Leader']);
  const result = validateCommanderDraft(deck);
  assert(!result.errors.some(error => error.includes('Forest') && error.includes('singleton')), 'expected basic duplicate to be allowed');
});

test('search filters decklist', () => {
  let deck = commanderDeck(98, ['Ezuri, Renegade Leader']);
  deck = setDeckEntryCount(deck, 'main', 'Sol Ring', 1);
  const rows = filterDeckBuilderRows(getDeckBuilderRows(deck), 'sol');
  assert(rows.length === 1 && rows[0].name === 'Sol Ring', 'expected search to return only Sol Ring');
});

test('group by type works', () => {
  let deck = commanderDeck(98, ['Ezuri, Renegade Leader']);
  deck = setDeckEntryCount(deck, 'main', 'Sol Ring', 1);
  deck = upsertCustomCard(deck, metadata('Sol Ring', 'Artifact', []));
  const groups = getGroupedDeckBuilderRows(deck, 'type');
  assert(groups.some(group => group.label === 'Artifact' && group.rows.some(row => row.name === 'Sol Ring')), 'expected artifact group with Sol Ring');
});

test('unsaved changes flag updates', () => {
  resetStore();
  let deck = createBlankDeck('Unsaved Test');
  useGameStore.getState().setSoloDraftDeck(deck, { unsaved: true });
  assert(useGameStore.getState().soloDeckLab.unsavedChanges === true, 'expected draft edit to mark unsaved changes');
  deck = adjustDeckEntry(deck, 'main', 'Forest', 1);
  useGameStore.getState().setSoloDraftDeck(deck, { unsaved: true });
  assert(useGameStore.getState().soloDeckLab.lastValidation?.cardCount === 1, 'expected validation to update after edit');
});

console.log(`\nSolo builder tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
