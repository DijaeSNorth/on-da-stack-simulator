/**
 * Lobby creation -> deck load -> start regression checks.
 *
 * Run with: npx tsx tests/lobby-flow.test.ts
 */

import { useGameStore } from '../client/src/store/gameStore';
import { importDecklist, loadDecksFromStorage, loadFavoriteDeckIds, saveDeck, toggleFavoriteDeck } from '../client/src/engine/deckImport';
import { canStartCommanderTable, getTableDeckStatus } from '../client/src/engine/lobbyReadiness';
import type { RoomPresence } from '../client/src/engine/multiplayerSync';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
};

function mockScryfallCard(name: string): Record<string, unknown> {
  const isCommander = /captain|sage/i.test(name);
  const isLand = /forest|island|command tower|reliquary tower/i.test(name);
  const isInstant = /counterspell|lightning bolt/i.test(name);
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    oracle_id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-oracle`,
    name,
    mana_cost: isLand ? '' : '{1}',
    cmc: isLand ? 0 : 1,
    type_line: isCommander ? 'Legendary Creature - Test' : isLand ? 'Land' : isInstant ? 'Instant' : 'Artifact',
    oracle_text: '',
    colors: isLand ? [] : ['G'],
    color_identity: ['G'],
    keywords: [],
    legalities: { commander: 'legal' },
  };
}

function presence(peerId: string, name: string, seatIndex: number): RoomPresence {
  return {
    peerId,
    name,
    color: seatIndex === 0 ? '#3b82f6' : '#ef4444',
    seatIndex,
    isSpectator: false,
    online: true,
    lastSeen: Date.now(),
  };
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url);
  if (target.includes('/cards/collection')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { identifiers?: { name?: string }[] };
    const names = (body.identifiers ?? []).map(item => item.name).filter((name): name is string => Boolean(name));
    return new Response(JSON.stringify({ data: names.map(mockScryfallCard), not_found: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (target.includes('/cards/named')) {
    const fuzzyName = new URL(target).searchParams.get('fuzzy') ?? 'Unknown Card';
    return new Response(JSON.stringify(mockScryfallCard(fuzzyName)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

try {
  storage.clear();

  const hostImport = await importDecklist([
    'Commander',
    '1 Test Captain',
    '',
    'Deck',
    '10 Forest',
    '1 Sol Ring',
    '1 Counterspell',
  ].join('\n'), 'Imported Host Deck');

  const favoriteImport = await importDecklist([
    'Commander',
    '1 Test Sage',
    '',
    'Deck',
    '10 Island',
    '1 Command Tower',
    '1 Lightning Bolt',
  ].join('\n'), 'Favorite Guest Deck');

  saveDeck(hostImport.deck);
  saveDeck(favoriteImport.deck);
  toggleFavoriteDeck(favoriteImport.deck.id);
  const savedDecks = loadDecksFromStorage();
  const favoriteDeck = savedDecks.find(deck => loadFavoriteDeckIds().includes(deck.id));
  assert(favoriteDeck?.name === 'Favorite Guest Deck', 'expected favorite deck to be available for lobby loading');

  const store = useGameStore.getState();
  store.initGame({ ...store.game.config, playerCount: 2, startingLife: 40 }, [
    { id: 'p1', name: 'Host', color: '#3b82f6' },
    { id: 'p2', name: 'Guest', color: '#ef4444' },
  ]);
  await useGameStore.getState().loadDeck('p1', hostImport.deck);
  await useGameStore.getState().loadDeck('p2', favoriteDeck);

  const game = useGameStore.getState().game;
  const peers: Record<string, RoomPresence> = {
    host: presence('host', 'Host', 0),
    guest: presence('guest', 'Guest', 1),
  };
  const seats = [
    { id: 'p1', name: 'Host', deckId: hostImport.deck.id },
    { id: 'p2', name: 'Guest', deckId: favoriteDeck.id },
  ];
  const statuses = getTableDeckStatus({
    peers,
    playerCount: 2,
    seats,
    gamePlayers: game.players,
    savedDecks,
  });
  assert(statuses.every(status => status.ready), 'expected both seats to be deck-ready before start');
  assert(statuses.some(status => status.deckName === 'Imported Host Deck'), 'expected imported deck name in lobby readiness');
  assert(statuses.some(status => status.deckName === 'Favorite Guest Deck'), 'expected favorite deck name in lobby readiness');

  const startGate = canStartCommanderTable({
    isHost: true,
    peers,
    playerCount: 2,
    seats,
    gamePlayers: game.players,
    savedDecks,
  });
  assert(startGate.canStart, 'expected host to be able to start after both decks are loaded');

  useGameStore.getState().startGame();
  const started = useGameStore.getState().game;
  assert(started.status === 'playing', 'expected game to start');
  assert(started.players.every(player => player.life === 40), 'expected Commander table life totals to start at 40');
  assert(started.players.every(player => player.hand.length === 7), 'expected each player to draw an opening hand');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS lobby flow imports, favorites, readiness, and starts at 40 life');
