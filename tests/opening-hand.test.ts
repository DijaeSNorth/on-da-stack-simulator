import { useGameStore } from '../client/src/store/gameStore';
import { getCardsToBottomRequirement } from '../client/src/engine/openingHand';
import { createDefaultGameConfig, createEmptyGameState } from '../client/src/engine/gameEngine';
import type { Deck } from '../client/src/types/game';

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      pending.push((result as Promise<void>)
        .then(() => {
          console.log(`PASS ${name}`);
          passed++;
        })
        .catch(error => {
          console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
          failed++;
        }));
      return;
    }
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
    ui: { ...initial.ui, screen: 'lobby', lobbyOpen: true, soloModeTab: 'test_hand' },
    decks: [],
    soloDeckLab: {},
    multiplayer: {
      ...initial.multiplayer,
      status: 'disconnected',
      peerId: null,
      playerId: null,
      sessionId: null,
      peers: {},
      lobby: null,
      startHandshake: null,
    },
    localPlayerId: '',
  });
}

function makeDeck(): Deck {
  return {
    id: 'opening-deck',
    name: 'Opening Deck',
    format: 'commander',
    commanders: ['Ezuri, Renegade Leader'],
    cards: [
      { name: 'Ezuri, Renegade Leader', count: 1 },
      { name: 'Forest', count: 99 },
    ],
    sideboard: [],
    maybeboard: [],
    colorIdentity: ['G'],
    importedAt: Date.now(),
    logicFile: {
      deckId: 'opening-deck',
      rules: [],
      replacementEffects: [],
      cardNotes: {},
      triggers: [],
      customCards: [
        {
          id: 'ezuri',
          name: 'Ezuri, Renegade Leader',
          typeLine: 'Legendary Creature - Elf Warrior',
          cardTypes: ['Creature'],
          cmc: 3,
          colors: ['G'],
          colorIdentity: ['G'],
          oracleText: '',
        },
        {
          id: 'forest',
          name: 'Forest',
          typeLine: 'Basic Land - Forest',
          cardTypes: ['Land'],
          cmc: 0,
          colors: [],
          colorIdentity: [],
          oracleText: '({T}: Add {G}.)',
        },
      ],
    },
  };
}

function loadDeck(): void {
  resetStore();
  useGameStore.getState().loadSoloDeck(makeDeck());
}

test('Draw opening hand gives 7 cards', () => {
  loadDeck();
  const ok = useGameStore.getState().drawSoloOpeningHand();
  const session = useGameStore.getState().soloDeckLab.testSession;
  assert(ok, 'expected draw opening hand to succeed');
  assert(session?.currentHand?.length === 7, `expected 7 cards, got ${session?.currentHand?.length ?? 0}`);
});

test('Mulligan increments mulligan count', () => {
  loadDeck();
  useGameStore.getState().drawSoloOpeningHand();
  useGameStore.getState().mulliganSoloOpeningHand();
  const session = useGameStore.getState().soloDeckLab.testSession;
  assert(session?.mulligansTaken === 1, `expected 1 mulligan, got ${session?.mulligansTaken ?? 0}`);
});

test('Second mulligan still draws 7 but requires bottom 2', () => {
  loadDeck();
  useGameStore.getState().drawSoloOpeningHand();
  useGameStore.getState().mulliganSoloOpeningHand();
  useGameStore.getState().mulliganSoloOpeningHand();
  const session = useGameStore.getState().soloDeckLab.testSession;
  assert(session?.currentHand?.length === 7, `expected 7 cards after second mulligan, got ${session?.currentHand?.length ?? 0}`);
  assert(getCardsToBottomRequirement(session) === 2, `expected bottom requirement 2, got ${getCardsToBottomRequirement(session)}`);
});

test('Keep marks hand kept', () => {
  loadDeck();
  useGameStore.getState().drawSoloOpeningHand();
  useGameStore.getState().keepSoloOpeningHand();
  assert(useGameStore.getState().soloDeckLab.testSession?.kept === true, 'expected kept hand');
});

test('New hand resets mulligan count', () => {
  loadDeck();
  useGameStore.getState().drawSoloOpeningHand();
  useGameStore.getState().mulliganSoloOpeningHand();
  useGameStore.getState().newSoloOpeningHand();
  const session = useGameStore.getState().soloDeckLab.testSession;
  assert(session?.mulligansTaken === 0, `expected mulligan reset, got ${session?.mulligansTaken ?? 0}`);
  assert(session?.currentHand?.length === 7, 'expected fresh 7-card hand');
});

test('Empty/no deck state is safe', () => {
  resetStore();
  assert(!useGameStore.getState().drawSoloOpeningHand(), 'expected draw to fail safely without deck');
  assert(!useGameStore.getState().mulliganSoloOpeningHand(), 'expected mulligan to fail safely without deck');
  assert(!useGameStore.getState().keepSoloOpeningHand(), 'expected keep to fail safely without hand');
});

test('Start game from kept hand creates correct hand/library counts', async () => {
  loadDeck();
  useGameStore.getState().drawSoloOpeningHand();
  useGameStore.getState().keepSoloOpeningHand();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url);
    const card = (name: string, typeLine: string, cmc: number, colors: string[] = []) => ({
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      oracle_id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-oracle`,
      name,
      mana_cost: cmc > 0 ? `{${cmc}}` : '',
      cmc,
      type_line: typeLine,
      oracle_text: '',
      colors,
      color_identity: colors,
      keywords: [],
      legalities: { commander: 'legal' },
    });
    if (target.includes('/cards/collection')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { identifiers?: { name?: string }[] };
      const names = (body.identifiers ?? []).map(item => item.name).filter((name): name is string => Boolean(name));
      return new Response(JSON.stringify({
        data: names.map(name => name === 'Forest'
          ? card('Forest', 'Basic Land - Forest', 0)
          : card(name, 'Legendary Creature - Elf Warrior', 3, ['G'])),
        not_found: [],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  try {
    const started = await useGameStore.getState().startSoloGameFromOpeningHand({
      player: { id: 'solo-player', name: 'Solo Player', color: '#22c55e' },
    });
    const state = useGameStore.getState();
    const player = state.game.players.find(p => p.id === 'solo-player');
    assert(started, 'expected game to start from kept hand');
    assert(player?.hand.length === 7, `expected 7 cards in hand, got ${player?.hand.length ?? 0}`);
    assert(player?.library.length === 92, `expected 92 cards in library, got ${player?.library.length ?? 0}`);
    assert(player?.commandZone.length === 1, `expected commander in command zone, got ${player?.commandZone.length ?? 0}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

void Promise.all(pending).then(() => {
  console.log(`\nOpening hand tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
