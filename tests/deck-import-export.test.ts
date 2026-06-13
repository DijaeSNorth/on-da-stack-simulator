import { importDecklist, saveDeck, loadDecksFromStorage, deleteDeck } from '../client/src/engine/deckImport';
import { exportDeckJsonText, exportDeckText, importDeckFromJsonExport } from '../client/src/engine/deckImportExport';
import { validateCommanderDraft } from '../client/src/engine/soloDeckBuilder';
import type { Deck } from '../client/src/types/game';

let passed = 0;
let failed = 0;
let chain = Promise.resolve();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void | Promise<void>): void {
  chain = chain.then(async () => {
    try {
      await fn();
      console.log(`PASS ${name}`);
      passed += 1;
    } catch (error) {
      console.error(`FAIL ${name}`);
      console.error(error);
      failed += 1;
    }
  });
}

function installLocalStorage(): void {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
}

function makeDeck(id = 'deck-export-test'): Deck {
  return {
    id,
    name: 'Export Test Deck',
    format: 'commander',
    commanders: ['Atraxa, Praetors\' Voice'],
    cards: [
      { name: 'Atraxa, Praetors\' Voice', count: 1 },
      { name: 'Forest', count: 99 },
    ],
    sideboard: [],
    maybeboard: [],
    colorIdentity: ['W', 'U', 'B', 'G'],
    importedAt: 1_700_000_000_000,
  };
}

installLocalStorage();

test('Import text deck works', async () => {
  const result = await importDecklist(
    [
      'Commander',
      '1 Atraxa, Praetors\' Voice',
      '',
      'Deck',
      '99 Forest',
    ].join('\n'),
    'Imported Text Deck',
    undefined,
    undefined,
    undefined,
    { allowBannedCards: true },
  );
  assert(result.deck.name === 'Imported Text Deck', 'expected imported deck name');
  assert(result.deck.commanders.includes('Atraxa, Praetors\' Voice'), 'expected commander parsed');
  assert(result.cardCount === 100, `expected 100 cards, got ${result.cardCount}`);
});

test('Export text deck includes Commander and Deck sections', () => {
  const text = exportDeckText(makeDeck());
  assert(text.includes('Commander\n1 Atraxa, Praetors\' Voice'), 'expected Commander section');
  assert(text.includes('\nDeck\n'), 'expected Deck section');
  assert(text.includes('99 Forest'), 'expected main deck line');
});

test('Export JSON can reimport', () => {
  const deck = makeDeck();
  const json = exportDeckJsonText(deck, validateCommanderDraft(deck));
  const imported = importDeckFromJsonExport(json, 'Fallback');
  assert(imported, 'expected JSON import to return deck');
  assert(imported.name === deck.name, 'expected name preserved');
  assert(imported.commanders[0] === deck.commanders[0], 'expected commander preserved');
  assert(imported.cards.some(card => card.name === 'Forest' && card.count === 99), 'expected cards preserved');
});

test('Save and load local deck works', () => {
  localStorage.clear();
  const deck = makeDeck('local-save');
  saveDeck(deck);
  const loaded = loadDecksFromStorage();
  assert(loaded.some(item => item.id === deck.id), 'expected saved deck loaded from localStorage');
});

test('Delete local deck works', () => {
  localStorage.clear();
  const deck = makeDeck('local-delete');
  saveDeck(deck);
  deleteDeck(deck.id);
  const loaded = loadDecksFromStorage();
  assert(!loaded.some(item => item.id === deck.id), 'expected deck deleted from localStorage');
});

test('Invalid deck shows validation errors', () => {
  const invalid: Deck = {
    ...makeDeck('invalid-deck'),
    commanders: [],
    cards: [{ name: 'Forest', count: 20 }],
  };
  const validation = validateCommanderDraft(invalid);
  assert(!validation.valid, 'expected invalid deck');
  assert(validation.errors.length > 0, 'expected validation errors');
});

test('Deck export excludes Firebase and private room data', () => {
  const json = exportDeckJsonText(makeDeck());
  const lower = json.toLowerCase();
  assert(!lower.includes('firebase'), 'expected no Firebase data');
  assert(!lower.includes('room'), 'expected no room data');
  assert(!lower.includes('peer'), 'expected no PeerJS data');
  assert(!lower.includes('auth'), 'expected no auth data');
});

void chain.then(() => {
  console.log(`\nDeck import/export tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
