/**
 * Banned-card Rule Zero checks.
 *
 * Run with: npx tsx tests/banned-house-rule.test.ts
 */

import { useGameStore } from '../client/src/store/gameStore';
import { createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import type { Deck } from '../client/src/types/game';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mockScryfallCard(name: string): Record<string, unknown> {
  const banned = name === 'Chaos Orb';
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    oracle_id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-oracle`,
    name,
    mana_cost: '{1}',
    cmc: 1,
    type_line: banned ? 'Artifact' : 'Creature - Test',
    oracle_text: '',
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { commander: banned ? 'banned' : 'legal' },
  };
}

function makeDeck(): Deck {
  return {
    id: 'deck-banned-test',
    name: 'Banned Test Deck',
    format: 'commander',
    commanders: [],
    cards: [
      { name: 'Chaos Orb', count: 1 },
      { name: 'Test Creature', count: 1 },
    ],
    sideboard: [],
    maybeboard: [],
    colorIdentity: [],
    importedAt: 1,
  };
}

function resetStore(allowBannedCards = false): void {
  const config = {
    ...createDefaultGameConfig(2),
    houseRules: allowBannedCards
      ? [{
          id: 'allow_banned_cards',
          name: 'Allow Banned Cards',
          description: 'Decks may include cards normally banned in Commander',
          votes: { p1: true, p2: true },
          approved: true,
          appliesTo: 'all' as const,
        }]
      : [],
  };
  const players = [
    createPlayer('p1', 'Player 1', 0, '#3b82f6', config),
    createPlayer('p2', 'Player 2', 1, '#ef4444', config),
  ];
  useGameStore.setState(state => ({
    ...state,
    game: {
      ...createEmptyGameState(config),
      players,
      activePlayerId: 'p1',
      priorityPlayerId: 'p1',
    },
    ui: {
      ...state.ui,
      screen: 'game',
      assistantMessages: [],
      rightPanelOpen: false,
      rightPanelTab: 'assistant',
      judgeMode: true,
    },
  }));
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
  return new Response('{}', { status: 404 });
}) as typeof fetch;

try {
  resetStore(false);
  await useGameStore.getState().loadDeck('p1', makeDeck());
  let state = useGameStore.getState();
  let player = state.game.players.find(item => item.id === 'p1');
  assert(player?.library.length === 2, 'expected deck with banned card to still load');
  assert(state.ui.assistantMessages.some(message =>
    message.label === 'Flagged' &&
    message.text.includes('Player 1 loaded banned Commander card') &&
    message.text.includes('Chaos Orb')
  ), 'expected assistant to flag banned card when Allow Banned Cards is off');

  resetStore(true);
  await useGameStore.getState().loadDeck('p1', makeDeck());
  state = useGameStore.getState();
  player = state.game.players.find(item => item.id === 'p1');
  assert(player?.library.length === 2, 'expected deck with banned card to still load when allowed');
  assert(state.ui.assistantMessages.every(message => !message.text.includes('loaded banned Commander card')), 'expected Allow Banned Cards to suppress banned-card assistant flag');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS banned cards are flagged without blocking deck loading');
