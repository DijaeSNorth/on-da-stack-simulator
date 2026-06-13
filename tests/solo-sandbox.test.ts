import { useGameStore } from '../client/src/store/gameStore';
import {
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  getEffectivePowerToughness,
} from '../client/src/engine/gameEngine';
import type { CardDefinition, GameState } from '../client/src/types/game';

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
  id: 'sandbox-bear',
  name: 'Sandbox Bear',
  cmc: 2,
  typeLine: 'Creature - Bear',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Bear'],
  oracleText: '',
  power: '2',
  toughness: '2',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
};

function makeLibraryCard(index: number, ownerId = 'p1') {
  return createCardState(
    {
      ...creatureDef,
      id: `sandbox-card-${ownerId}-${index}`,
      name: `Sandbox Card ${index}`,
    },
    ownerId,
    'library',
  );
}

function makeGame(playerCount = 1, libraryCount = 12): GameState {
  const config = createDefaultGameConfig(playerCount as 1 | 2 | 3 | 4 | 5 | 6);
  const base = createEmptyGameState(config);
  const players = Array.from({ length: playerCount }, (_, index) =>
    createPlayer(`p${index + 1}`, `Player ${index + 1}`, index, `hsl(${index * 80}, 70%, 60%)`, config)
  );
  const cards = Object.fromEntries(
    players.flatMap(player =>
      Array.from({ length: libraryCount }, (_, index) => {
        const card = makeLibraryCard(index, player.id);
        return [card.instanceId, card] as const;
      })
    )
  );
  const nextPlayers = players.map(player => ({
    ...player,
    library: Object.values(cards)
      .filter(card => card.ownerId === player.id)
      .map(card => card.instanceId),
  }));
  return {
    ...base,
    status: 'playing',
    players: nextPlayers,
    cards,
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
  };
}

function addBattlefieldCreature(game: GameState, ownerId = 'p1'): { game: GameState; cardId: string } {
  const card = {
    ...createCardState({ ...creatureDef, id: `sandbox-permanent-${ownerId}`, name: 'Sandbox Permanent' }, ownerId, 'library'),
    zone: 'battlefield' as const,
    summoningSick: false,
  };
  return {
    cardId: card.instanceId,
    game: {
      ...game,
      cards: { ...game.cards, [card.instanceId]: card },
      players: game.players.map(player =>
        player.id === ownerId ? { ...player, battlefield: [...player.battlefield, card.instanceId] } : player
      ),
    },
  };
}

function resetStore(game: GameState, judgeMode = false): void {
  const initial = useGameStore.getInitialState();
  useGameStore.setState({
    ...initial,
    game,
    localPlayerId: 'p1',
    ui: {
      ...initial.ui,
      screen: 'game',
      lobbyOpen: false,
      deckBuilderOpen: true,
      judgeMode,
    },
    multiplayer: {
      ...initial.multiplayer,
      status: 'disconnected',
    },
  });
}

test('sandbox draw X moves cards from library to hand', () => {
  resetStore(makeGame(1, 10));
  const before = useGameStore.getState().game.players[0];
  assert(useGameStore.getState().sandboxDrawCards(3), 'expected draw to succeed');
  const after = useGameStore.getState().game.players[0];
  assert(after.hand.length === before.hand.length + 3, `expected hand +3, got ${after.hand.length}`);
  assert(after.library.length === before.library.length - 3, `expected library -3, got ${after.library.length}`);
});

test('sandbox reveal top X does not remove cards', () => {
  resetStore(makeGame(1, 10));
  const before = useGameStore.getState().game.players[0];
  assert(useGameStore.getState().sandboxRevealTopCards(5), 'expected reveal to succeed');
  const after = useGameStore.getState().game.players[0];
  assert(after.library.length === before.library.length, 'expected library length unchanged');
  assert(after.hand.length === before.hand.length, 'expected hand length unchanged');
  assert(useGameStore.getState().game.actionLog.some(action => action.actionType === 'SEARCH_LIBRARY'), 'expected reveal/search log');
});

test('sandbox shuffle records shuffle action', () => {
  resetStore(makeGame(1, 10));
  assert(useGameStore.getState().sandboxShuffleLibrary(), 'expected shuffle to succeed');
  assert(useGameStore.getState().game.actionLog.some(action => action.actionType === 'SHUFFLE'), 'expected shuffle action log');
});

test('sandbox create token adds battlefield token', () => {
  resetStore(makeGame(1, 10));
  const ids = useGameStore.getState().sandboxCreateToken('Goblin', 2, '1', '1');
  const state = useGameStore.getState();
  assert(ids.length === 2, `expected 2 tokens, got ${ids.length}`);
  assert(ids.every(id => state.game.cards[id]?.token), 'expected created cards to be tokens');
  assert(ids.every(id => state.game.players[0].battlefield.includes(id)), 'expected tokens on battlefield');
});

test('sandbox set life updates solo player life', () => {
  resetStore(makeGame(1, 10));
  assert(useGameStore.getState().sandboxSetLifeTotal(13), 'expected life set to succeed');
  assert(useGameStore.getState().game.players[0].life === 13, 'expected life total 13');
});

test('sandbox counter tool affects effective power and toughness', () => {
  const fixture = addBattlefieldCreature(makeGame(1, 10));
  resetStore(fixture.game);
  assert(useGameStore.getState().sandboxAddCounter(fixture.cardId, '+1/+1', 2), 'expected counter add to succeed');
  const pt = getEffectivePowerToughness(useGameStore.getState().game.cards[fixture.cardId]);
  assert(pt?.power === 4 && pt.toughness === 4, `expected 4/4, got ${pt?.power}/${pt?.toughness}`);
});

test('sandbox actions append to action log', () => {
  resetStore(makeGame(1, 10));
  const before = useGameStore.getState().game.actionLog.length;
  assert(useGameStore.getState().sandboxDrawCards(1), 'expected draw to succeed');
  assert(useGameStore.getState().sandboxAddManaNote('Floating three red for combo test'), 'expected note to succeed');
  const after = useGameStore.getState().game.actionLog.length;
  assert(after >= before + 2, `expected at least two logged actions, got ${after - before}`);
});

test('sandbox unavailable outside Solo mode unless judge mode is enabled', () => {
  const multiplayerLikeGame = makeGame(2, 10);
  resetStore(multiplayerLikeGame, false);
  const before = useGameStore.getState().game.players[0].hand.length;
  assert(!useGameStore.getState().canUseSoloSandboxTools(), 'expected sandbox disabled for non-solo game');
  assert(!useGameStore.getState().sandboxDrawCards(1), 'expected non-solo draw blocked');
  assert(useGameStore.getState().game.players[0].hand.length === before, 'expected blocked draw to leave hand unchanged');

  resetStore(multiplayerLikeGame, true);
  assert(useGameStore.getState().canUseSoloSandboxTools(), 'expected judge mode to enable sandbox tools');
  assert(useGameStore.getState().sandboxDrawCards(1), 'expected judge draw to succeed');
});

void chain.then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
