import { useGameStore } from '../client/src/store/gameStore';
import {
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  declareAttacker,
  generateCombatDamagePreview,
} from '../client/src/engine/gameEngine';
import {
  addDummyOpponentToGame,
  advanceDummyTurn,
  autoBlockForDummy,
  createDummyOpponent,
} from '../client/src/engine/dummyOpponentEngine';
import type { CardDefinition, Deck, GameState } from '../client/src/types/game';

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

const creatureDef: CardDefinition = {
  id: 'dummy-test-creature',
  name: 'Dummy Test Creature',
  cmc: 3,
  typeLine: 'Creature - Test',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Test'],
  oracleText: '',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '3',
  toughness: '3',
};

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

function addAttacker(game: GameState): { game: GameState; attackerId: string } {
  const card = {
    ...createCardState(creatureDef, 'solo', 'library'),
    zone: 'battlefield' as const,
    summoningSick: false,
  };
  return {
    attackerId: card.instanceId,
    game: {
      ...game,
      cards: { ...game.cards, [card.instanceId]: card },
      definitions: { ...game.definitions, [creatureDef.id]: creatureDef },
      players: game.players.map(player =>
        player.id === 'solo' ? { ...player, battlefield: [...player.battlefield, card.instanceId] } : player
      ),
    },
  };
}

function makeDeck(): Deck {
  return {
    id: 'dummy-practice-deck',
    name: 'Dummy Practice Deck',
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
      deckId: 'dummy-practice-deck',
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

function resetStore(): void {
  const initial = useGameStore.getInitialState();
  useGameStore.setState({
    ...initial,
    game: createEmptyGameState(createDefaultGameConfig(1)),
    ui: { ...initial.ui, screen: 'lobby', lobbyOpen: true, soloModeTab: 'dummy' },
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

test('Create Training Dummy', () => {
  const dummy = createDummyOpponent({ id: 'dummy-training', name: 'Training Dummy', profile: 'training', startingLife: 40 }, 1, createDefaultGameConfig(2));
  assert(dummy.isDummy, 'expected dummy flag');
  assert(dummy.dummyProfile === 'training', 'expected training profile');
  assert(dummy.life === 40, 'expected starting life');
});

test('Create Blocker Dummy with blockers', () => {
  const added = addDummyOpponentToGame(makeGame(), { id: 'dummy-blocker', name: 'Blocker Dummy', profile: 'blocker', startingLife: 30, startingBlockers: 2, autoBlock: true });
  const dummy = added.state.players.find(player => player.id === 'dummy-blocker');
  assert(dummy?.isDummy, 'expected dummy player');
  assert(added.blockerIds.length === 2, `expected 2 blockers, got ${added.blockerIds.length}`);
  assert(added.blockerIds.every(id => added.state.cards[id]?.zone === 'battlefield'), 'expected blockers on battlefield');
});

test('Create Aggro Dummy with pressure config', () => {
  const added = addDummyOpponentToGame(makeGame(), { id: 'dummy-aggro', name: 'Aggro Dummy', profile: 'aggro', startingLife: 30, pressurePerTurn: 2 });
  const advanced = advanceDummyTurn(added.state, 'dummy-aggro');
  const dummy = advanced.players.find(player => player.id === 'dummy-aggro');
  assert(dummy?.dummyConfig?.pressurePerTurn === 2, 'expected pressure config stored');
  assert(dummy.battlefield.length >= 1, 'expected aggro dummy to create pressure creature');
});

test('Create Combo Clock Dummy with combo turn', () => {
  const added = addDummyOpponentToGame({ ...makeGame(), turn: 5 }, { id: 'dummy-combo', name: 'Combo Dummy', profile: 'combo_clock', startingLife: 40, comboTurn: 5 });
  const advanced = advanceDummyTurn(added.state, 'dummy-combo');
  assert(advanced.actionLog.some(action => action.description.includes('wins on turn 5')), 'expected combo clock win log');
});

test('Solo player can attack dummy', () => {
  const added = addDummyOpponentToGame(makeGame(), { id: 'dummy-training', name: 'Training Dummy', profile: 'training', startingLife: 40 });
  const withAttacker = addAttacker(added.state);
  const attacked = declareAttacker(withAttacker.game, withAttacker.attackerId, 'dummy-training');
  assert(attacked.combat.attackers.some(attacker => attacker.targetPlayerId === 'dummy-training'), 'expected attack at dummy');
});

test('Damage preview works against dummy player', () => {
  const added = addDummyOpponentToGame(makeGame(), { id: 'dummy-training', name: 'Training Dummy', profile: 'training', startingLife: 40 });
  const withAttacker = addAttacker(added.state);
  const attacked = declareAttacker(withAttacker.game, withAttacker.attackerId, 'dummy-training');
  const preview = generateCombatDamagePreview(attacked);
  assert(preview.damageToPlayers['dummy-training'] === 3, `expected 3 damage to dummy, got ${preview.damageToPlayers['dummy-training']}`);
});

test('Auto-block assigns a legal blocker', () => {
  const added = addDummyOpponentToGame(makeGame(), { id: 'dummy-blocker', name: 'Blocker Dummy', profile: 'blocker', startingLife: 40, startingBlockers: 1, autoBlock: true });
  const withAttacker = addAttacker(added.state);
  const attacked = declareAttacker(withAttacker.game, withAttacker.attackerId, 'dummy-blocker');
  const blocked = autoBlockForDummy(attacked, 'dummy-blocker');
  assert(blocked.blocked, 'expected auto-block');
  assert(blocked.state.combat.blockers.length === 1, 'expected one blocker assignment');
});

test('Dummy turn advances without crashing', () => {
  const added = addDummyOpponentToGame(makeGame(), { id: 'dummy-training', name: 'Training Dummy', profile: 'training', startingLife: 40 });
  const advanced = advanceDummyTurn(added.state, 'dummy-training');
  assert(advanced.players.length === added.state.players.length, 'expected player count unchanged');
});

test('Dummy actions are logged', () => {
  const added = addDummyOpponentToGame(makeGame(), { id: 'dummy-value', name: 'Value Dummy', profile: 'value', startingLife: 40 });
  const advanced = advanceDummyTurn(added.state, 'dummy-value');
  assert(advanced.actionLog.some(action => action.data.dummyAction === true), 'expected dummy action log');
});

test('Dummy mode does not alter multiplayer status', async () => {
  resetStore();
  useGameStore.getState().loadSoloDeck(makeDeck());
  const before = useGameStore.getState().multiplayer;
  const restore = mockFetch();
  try {
    const started = await useGameStore.getState().startSoloDummyPracticeGame([
      { id: 'dummy-store', name: 'Store Dummy', profile: 'training', startingLife: 40 },
    ], { player: { id: 'solo', name: 'Solo Player', color: '#22c55e' } });
    const after = useGameStore.getState().multiplayer;
    assert(started, 'expected dummy practice start');
    assert(after === before, 'expected multiplayer object unchanged');
    assert(after.status === 'disconnected', 'expected multiplayer disconnected');
  } finally {
    restore();
  }
});

test('Dummy mode does not write Firebase recovery data', async () => {
  resetStore();
  useGameStore.getState().loadSoloDeck(makeDeck());
  const restore = mockFetch();
  try {
    await useGameStore.getState().startSoloDummyPracticeGame([
      { id: 'dummy-recovery-safe', name: 'Recovery Safe Dummy', profile: 'training', startingLife: 40 },
    ], { player: { id: 'solo', name: 'Solo Player', color: '#22c55e' } });
    const state = useGameStore.getState();
    assert(state.multiplayer.status === 'disconnected', 'expected no multiplayer/Firebase recovery path');
    assert(!JSON.stringify(state.game.actionLog).toLowerCase().includes('firebase'), 'expected no Firebase data in dummy action log');
  } finally {
    restore();
  }
});

void chain.then(() => {
  console.log(`\nDummy opponent tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
