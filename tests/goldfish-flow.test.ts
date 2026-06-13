import { useGameStore } from '../client/src/store/gameStore';
import { createDefaultGameConfig, createEmptyGameState } from '../client/src/engine/gameEngine';
import type { Deck } from '../client/src/types/game';

let passed = 0;
let failed = 0;
let chain = Promise.resolve();

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void | Promise<void>): void {
  chain = chain.then(async () => {
    try {
      await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
  });
}

function resetStore(): void {
  const initial = useGameStore.getInitialState();
  useGameStore.setState({
    ...initial,
    game: createEmptyGameState(createDefaultGameConfig(1)),
    ui: { ...initial.ui, screen: 'lobby', lobbyOpen: true, soloModeTab: 'goldfish' },
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
    id: 'goldfish-deck',
    name: 'Goldfish Deck',
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
      deckId: 'goldfish-deck',
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

function mockFetch(): () => void {
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
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function setupDeck(): void {
  resetStore();
  useGameStore.getState().loadSoloDeck(makeDeck());
}

test('Start goldfish creates solo game', async () => {
  setupDeck();
  const restore = mockFetch();
  try {
    const started = await useGameStore.getState().startSoloGoldfishGame({
      player: { id: 'solo-player', name: 'Solo Player', color: '#22c55e' },
    });
    const state = useGameStore.getState();
    assert(started, 'expected goldfish start to succeed');
    assert(state.game.status === 'playing', 'expected game to be playing');
    assert(state.game.config.playerCount === 1, 'expected one-player game');
    assert(state.soloDeckLab.testSession?.mode === 'goldfish', 'expected goldfish session');
  } finally {
    restore();
  }
});

test('Draw for turn changes hand/library counts', async () => {
  setupDeck();
  const restore = mockFetch();
  try {
    await useGameStore.getState().startSoloGoldfishGame({ player: { id: 'solo-player', name: 'Solo Player', color: '#22c55e' } });
    const before = useGameStore.getState().game.players[0];
    useGameStore.getState().drawCard(before.id, 1);
    const after = useGameStore.getState().game.players[0];
    assert(after.hand.length === before.hand.length + 1, 'expected hand count to increase');
    assert(after.library.length === before.library.length - 1, 'expected library count to decrease');
  } finally {
    restore();
  }
});

test('Next turn increments turn', async () => {
  setupDeck();
  const restore = mockFetch();
  try {
    await useGameStore.getState().startSoloGoldfishGame({ player: { id: 'solo-player', name: 'Solo Player', color: '#22c55e' } });
    useGameStore.getState().advanceTurn();
    assert(useGameStore.getState().game.turn === 2, `expected turn 2, got ${useGameStore.getState().game.turn}`);
  } finally {
    restore();
  }
});

test('Reset returns to fresh test state', async () => {
  setupDeck();
  const restore = mockFetch();
  try {
    await useGameStore.getState().startSoloGoldfishGame({ player: { id: 'solo-player', name: 'Solo Player', color: '#22c55e' } });
    useGameStore.getState().advanceTurn();
    useGameStore.getState().drawCard('solo-player', 1);
    await useGameStore.getState().resetSoloGoldfishGame({ player: { id: 'solo-player', name: 'Solo Player', color: '#22c55e' } });
    const state = useGameStore.getState();
    const player = state.game.players[0];
    assert(state.game.turn === 1, `expected reset turn 1, got ${state.game.turn}`);
    assert(player.hand.length === 7, `expected fresh hand 7, got ${player.hand.length}`);
    assert(player.library.length === 92, `expected fresh library 92, got ${player.library.length}`);
  } finally {
    restore();
  }
});

test('Starting from kept hand preserves that hand', async () => {
  setupDeck();
  useGameStore.getState().drawSoloOpeningHand();
  const keptNames = useGameStore.getState().soloDeckLab.testSession?.currentHand?.map(card => card.name).sort().join('|') ?? '';
  useGameStore.getState().keepSoloOpeningHand();
  const restore = mockFetch();
  try {
    await useGameStore.getState().startSoloGoldfishGame({
      fromKeptHand: true,
      player: { id: 'solo-player', name: 'Solo Player', color: '#22c55e' },
    });
    const state = useGameStore.getState();
    const player = state.game.players[0];
    const actualNames = player.hand.map(id => state.game.cards[id]?.definition.name).sort().join('|');
    assert(actualNames === keptNames, 'expected started game hand to match kept opening hand');
  } finally {
    restore();
  }
});

test('No Firebase/multiplayer status changes', async () => {
  setupDeck();
  const before = useGameStore.getState().multiplayer;
  const restore = mockFetch();
  try {
    await useGameStore.getState().startSoloGoldfishGame({ player: { id: 'solo-player', name: 'Solo Player', color: '#22c55e' } });
    const after = useGameStore.getState().multiplayer;
    assert(after === before, 'expected goldfish start not to replace multiplayer state');
    assert(after.status === 'disconnected', 'expected multiplayer to remain disconnected');
  } finally {
    restore();
  }
});

void chain.then(() => {
  console.log(`\nGoldfish flow tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
