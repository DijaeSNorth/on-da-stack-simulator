/**
 * Saved deck storage regression checks.
 *
 * Run with: npx tsx tests/deck-storage.test.ts
 */

import {
  loadFavoriteDeckIds,
  loadDecksFromStorage,
  MAX_FAVORITE_DECKS,
  MAX_STORED_DECKS,
  saveDeck,
  saveFavoriteDeckIds,
  saveDecksToStorage,
  toggleFavoriteDeck,
} from '../client/src/engine/deckImport';
import type { Deck } from '../client/src/types/game';

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
};

function makeDeck(id: string, importedAt: number): Deck {
  return {
    id,
    name: `Deck ${id}`,
    format: 'commander',
    commanders: ['Test Commander'],
    cards: [{ name: 'Forest', count: 99 }, { name: 'Test Commander', count: 1 }],
    sideboard: [],
    maybeboard: [],
    colorIdentity: ['G'],
    importedAt,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

storage.clear();

saveDeck(makeDeck('oldest', 100));
saveDeck(makeDeck('middle', 200));
saveDeck(makeDeck('newer', 300));
saveDeck(makeDeck('newest', 400));

let decks = loadDecksFromStorage();
assert(decks.length === MAX_STORED_DECKS, `expected ${MAX_STORED_DECKS} saved decks, got ${decks.length}`);
assert(decks.map(deck => deck.id).join(',') === 'newest,newer,middle', 'expected newest 3 decks to be retained');

saveDeck(makeDeck('middle', 500));
decks = loadDecksFromStorage();
assert(decks.length === MAX_STORED_DECKS, 'expected updating an existing deck to keep the storage cap');
assert(decks[0].id === 'middle', 'expected updated deck to move to the front by importedAt');

saveDecksToStorage([makeDeck('a', 1), makeDeck('b', 2), makeDeck('c', 3), makeDeck('d', 4)]);
decks = loadDecksFromStorage();
assert(decks.length === MAX_STORED_DECKS, 'expected bulk storage writes to enforce the cap');
assert(decks.map(deck => deck.id).join(',') === 'd,c,b', 'expected bulk write to keep newest 3 decks');

storage.clear();

saveDeck(makeDeck('favorite-old', 100));
toggleFavoriteDeck('favorite-old');
saveDeck(makeDeck('new-1', 200));
saveDeck(makeDeck('new-2', 300));
saveDeck(makeDeck('new-3', 400));
decks = loadDecksFromStorage();
assert(decks.length === MAX_STORED_DECKS, 'expected favorite-protected storage to keep the 3-deck cap');
assert(decks.some(deck => deck.id === 'favorite-old'), 'expected favorite deck to persist through newer imports');
assert(loadFavoriteDeckIds().join(',') === 'favorite-old', 'expected favorite deck id to persist separately');

toggleFavoriteDeck('new-3');
const afterTwoFavorites = toggleFavoriteDeck('new-2');
assert(afterTwoFavorites.length === MAX_FAVORITE_DECKS, `expected ${MAX_FAVORITE_DECKS} favorite decks`);
assert(!afterTwoFavorites.includes('new-2'), 'expected third favorite toggle to be ignored at the cap');

toggleFavoriteDeck('favorite-old');
assert(!loadFavoriteDeckIds().includes('favorite-old'), 'expected toggling an existing favorite to remove it');

saveFavoriteDeckIds(['a', 'b', 'c']);
assert(loadFavoriteDeckIds().length === MAX_FAVORITE_DECKS, 'expected explicit favorite saves to enforce the cap');

console.log('PASS saved deck storage is capped at 3 decks with 2 persistent favorites');
