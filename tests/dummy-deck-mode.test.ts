import { useGameStore } from '../client/src/store/gameStore';
import {
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
} from '../client/src/engine/gameEngine';
import {
  addDummyOpponentToGame,
  advanceDummyTurn,
  createGeneratedDummyDeck,
} from '../client/src/engine/dummyOpponentEngine';
import type { Deck, GameState } from '../client/src/types/game';

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

function makeGame(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const solo = createPlayer('solo', 'Solo Player', 0, '#22c55e', config);
  solo.isActive = true;
  solo.hasPriority = true;
  return {
    ...base,
    status: 'playing',
    players: [solo],
    activePlayerId: solo.id,
    priorityPlayerId: solo.id,
  };
}

function countByType(game: GameState, playerId: string, type: string): number {
  const player = game.players.find(current => current.id === playerId);
  return player?.battlefield.filter(id => game.cards[id]?.definition.cardTypes.includes(type)).length ?? 0;
}

function makeDeck(): Deck {
  return {
    id: 'dummy-deck-mode-solo-deck',
    name: 'Dummy Deck Mode Solo Deck',
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
      deckId: 'dummy-deck-mode-solo-deck',
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

function resetStore(multiplayerStatus: 'disconnected' | 'host' = 'disconnected'): void {
  const initial = useGameStore.getInitialState();
  useGameStore.setState({
    ...initial,
    game: createEmptyGameState(createDefaultGameConfig(1)),
    ui: { ...initial.ui, screen: 'lobby', lobbyOpen: true, soloModeTab: 'dummy' },
    decks: [],
    soloDeckLab: {},
    multiplayer: {
      ...initial.multiplayer,
      status: multiplayerStatus,
      peerId: multiplayerStatus === 'host' ? 'peer-host' : null,
      playerId: multiplayerStatus === 'host' ? 'host-player' : null,
      sessionId: multiplayerStatus === 'host' ? 'session-host' : null,
      peers: {},
      lobby: null,
      startHandshake: null,
    },
    localPlayerId: '',
  });
}

test('Generated aggro dummy deck has lands and creatures', () => {
  const deck = createGeneratedDummyDeck('aggro', 'aggro', 'low');
  assert(deck.cards.some(card => card.name.includes('Land') && card.count > 0), 'expected lands');
  assert(deck.cards.some(card => /Attacker|Brawler|Charger/.test(card.name) && card.count > 0), 'expected creatures');
});

test('Dummy with generated deck draws starting hand', () => {
  const added = addDummyOpponentToGame(makeGame(), {
    id: 'dummy-generated-hand',
    name: 'Generated Hand Dummy',
    profile: 'aggro',
    startingLife: 40,
    dummyDeckMode: 'generated',
    dummyDeckArchetype: 'aggro',
    startingHandSize: 7,
  });
  const dummy = added.state.players.find(player => player.id === 'dummy-generated-hand');
  assert(dummy?.hand.length === 7, `expected hand 7, got ${dummy?.hand.length}`);
  assert((dummy?.library.length ?? 0) > 0, 'expected remaining library');
});

test('Dummy turn draws a card', () => {
  const added = addDummyOpponentToGame(makeGame(), {
    id: 'dummy-draw',
    name: 'Draw Dummy',
    profile: 'aggro',
    startingLife: 40,
    dummyDeckMode: 'generated',
    startingHandSize: 0,
    autoPlayLand: false,
    autoCastCreature: false,
    autoAttack: false,
  });
  const before = added.state.players.find(player => player.id === 'dummy-draw')!;
  const advanced = advanceDummyTurn(added.state, 'dummy-draw');
  const after = advanced.players.find(player => player.id === 'dummy-draw')!;
  assert(after.hand.length === before.hand.length + 1, 'expected hand +1');
  assert(after.library.length === before.library.length - 1, 'expected library -1');
});

test('Dummy plays a land if available', () => {
  const added = addDummyOpponentToGame(makeGame(), {
    id: 'dummy-land',
    name: 'Land Dummy',
    profile: 'aggro',
    startingLife: 40,
    dummyDeckMode: 'generated',
    startingHandSize: 7,
    autoPlayLand: true,
    autoCastCreature: false,
    autoAttack: false,
  });
  const advanced = advanceDummyTurn(added.state, 'dummy-land');
  assert(countByType(advanced, 'dummy-land', 'Land') >= 1, 'expected land on battlefield');
});

test('Dummy casts simple creature if enough lands/mana', () => {
  const added = addDummyOpponentToGame(makeGame(), {
    id: 'dummy-cast',
    name: 'Cast Dummy',
    profile: 'aggro',
    startingLife: 40,
    dummyDeckMode: 'generated',
    dummyDeckArchetype: 'aggro',
    startingHandSize: 7,
    autoPlayLand: true,
    autoCastCreature: true,
    autoAttack: false,
  });
  const advanced = advanceDummyTurn(added.state, 'dummy-cast');
  assert(countByType(advanced, 'dummy-cast', 'Creature') >= 1, 'expected creature on battlefield');
});

test('Aggro dummy attacks with eligible creatures', () => {
  const added = addDummyOpponentToGame(makeGame(), {
    id: 'dummy-attack',
    name: 'Attack Dummy',
    profile: 'aggro',
    startingLife: 40,
    dummyDeckMode: 'generated',
    dummyDeckArchetype: 'aggro',
    startingHandSize: 7,
    autoPlayLand: true,
    autoCastCreature: true,
    autoAttack: true,
  });
  const first = advanceDummyTurn(added.state, 'dummy-attack');
  const second = advanceDummyTurn(first, 'dummy-attack');
  assert(second.combat.attackers.some(attacker => attacker.targetPlayerId === 'solo'), 'expected aggro attacker targeting solo player');
});

test('Dummy deck mode none preserves old behavior', () => {
  const added = addDummyOpponentToGame(makeGame(), {
    id: 'dummy-none',
    name: 'No Deck Dummy',
    profile: 'blocker',
    startingLife: 40,
    startingBlockers: 1,
    dummyDeckMode: 'none',
  });
  const dummy = added.state.players.find(player => player.id === 'dummy-none')!;
  assert(dummy.hand.length === 0, 'expected empty hand');
  assert(dummy.library.length === 0, 'expected empty library');
  assert(dummy.battlefield.length === 1, 'expected old blocker setup preserved');
});

test('Dummy deck actions are logged', () => {
  const added = addDummyOpponentToGame(makeGame(), {
    id: 'dummy-log',
    name: 'Log Dummy',
    profile: 'aggro',
    startingLife: 40,
    dummyDeckMode: 'generated',
    startingHandSize: 7,
  });
  const advanced = advanceDummyTurn(added.state, 'dummy-log');
  assert(advanced.actionLog.some(action => action.data.dummyDeckAction === true), 'expected dummy deck action logs');
});

test('Dummy deck mode remains Solo-only', async () => {
  resetStore('host');
  useGameStore.getState().loadSoloDeck(makeDeck());
  const restore = mockFetch();
  try {
    const started = await useGameStore.getState().startSoloDummyPracticeGame([
      { id: 'dummy-host-blocked', name: 'Blocked Dummy', profile: 'aggro', startingLife: 40, dummyDeckMode: 'generated' },
    ], { player: { id: 'solo', name: 'Solo Player', color: '#22c55e' } });
    assert(!started, 'expected dummy practice blocked while multiplayer host');
    assert(useGameStore.getState().multiplayer.status === 'host', 'expected multiplayer status unchanged');
  } finally {
    restore();
  }
});

test('Dummy deck mode does not write Firebase data', async () => {
  resetStore('disconnected');
  useGameStore.getState().loadSoloDeck(makeDeck());
  const restore = mockFetch();
  try {
    const started = await useGameStore.getState().startSoloDummyPracticeGame([
      { id: 'dummy-recovery-clean', name: 'Recovery Clean Dummy', profile: 'aggro', startingLife: 40, dummyDeckMode: 'generated' },
    ], { player: { id: 'solo', name: 'Solo Player', color: '#22c55e' } });
    assert(started, 'expected dummy practice started');
    const logText = JSON.stringify(useGameStore.getState().game.actionLog).toLowerCase();
    assert(!logText.includes('firebase'), 'expected no Firebase data in action log');
    assert(useGameStore.getState().multiplayer.status === 'disconnected', 'expected disconnected multiplayer');
  } finally {
    restore();
  }
});

void chain.then(() => {
  console.log(`\nDummy deck mode tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
