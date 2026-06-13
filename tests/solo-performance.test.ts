import {
  createAction,
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
} from '../client/src/engine/gameEngine';
import {
  generateSoloPerformanceReport,
  serializeSoloPerformanceReport,
} from '../client/src/engine/soloPerformanceEngine';
import type {
  ActionRecord,
  CardDefinition,
  CardState,
  CardType,
  Deck,
  GameState,
  SoloTestSession,
  Zone,
} from '../client/src/types/game';

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

function makeGame(turn = 1): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const solo = createPlayer('solo', 'Solo Player', 0, '#22c55e', config);
  const dummy = {
    ...createPlayer('dummy', 'Aggro Dummy', 1, '#dc2626', { ...config, startingLife: 40 }),
    isDummy: true,
    dummyProfile: 'aggro' as const,
    dummyConfig: {
      id: 'dummy',
      name: 'Aggro Dummy',
      profile: 'aggro' as const,
      startingLife: 40,
      autoAttack: true,
      autoBlock: false,
      dummyDeckMode: 'generated' as const,
      dummyDeckArchetype: 'aggro' as const,
      dummyDeckPower: 'low' as const,
      startingHandSize: 7,
      autoPlayLand: true,
      autoCastCreature: true,
    },
  };
  return {
    ...base,
    status: 'playing',
    turn,
    players: [solo, dummy],
    activePlayerId: solo.id,
    priorityPlayerId: solo.id,
  };
}

function makeDeck(): Deck {
  return {
    id: 'performance-deck',
    name: 'Performance Deck',
    format: 'commander',
    commanders: ['Elf Commander'],
    cards: [
      { name: 'Forest', count: 36 },
      { name: 'Low Elf', count: 32 },
      { name: 'Expensive Dragon', count: 32 },
    ],
    sideboard: [],
    maybeboard: [],
    colorIdentity: ['G'],
    importedAt: 1,
    logicFile: {
      deckId: 'performance-deck',
      rules: [],
      replacementEffects: [],
      cardNotes: {},
      triggers: [],
      customCards: [
        { id: 'forest', name: 'Forest', typeLine: 'Basic Land - Forest', cardTypes: ['Land'], cmc: 0, colors: [], colorIdentity: [], oracleText: '' },
        { id: 'low-elf', name: 'Low Elf', typeLine: 'Creature - Elf', cardTypes: ['Creature'], cmc: 2, colors: ['G'], colorIdentity: ['G'], oracleText: '', power: '2', toughness: '2' },
        { id: 'expensive-dragon', name: 'Expensive Dragon', typeLine: 'Creature - Dragon', cardTypes: ['Creature'], cmc: 6, colors: ['G'], colorIdentity: ['G'], oracleText: '', power: '5', toughness: '5' },
      ],
    },
  };
}

function makeDefinition(name: string, cardTypes: CardType[], cmc: number, power?: string, toughness?: string): CardDefinition {
  const typeLine = cardTypes.includes('Land') ? `Basic Land - ${name}` : `${cardTypes.join(' ')} - Test`;
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name,
    cmc,
    typeLine,
    superTypes: cardTypes.includes('Land') ? ['Basic'] : [],
    cardTypes,
    subTypes: [],
    oracleText: '',
    power,
    toughness,
    colors: [],
    colorIdentity: [],
    keywords: [],
    isDoubleFaced: false,
    legalities: {},
  };
}

function addCard(game: GameState, playerId: string, def: CardDefinition, zone: Zone, token = false): { game: GameState; id: string } {
  const created = createCardState(def, playerId, 'library', false, token);
  const card: CardState = { ...created, zone };
  return {
    id: card.instanceId,
    game: {
      ...game,
      definitions: { ...game.definitions, [def.id]: def },
      cards: { ...game.cards, [card.instanceId]: card },
      players: game.players.map(player => player.id === playerId ? addCardToPlayerZone(player, card.instanceId, zone) : player),
    },
  };
}

function addCardToPlayerZone<T extends GameState['players'][number]>(player: T, id: string, zone: Zone): T {
  if (zone === 'hand') return { ...player, hand: [...player.hand, id] };
  if (zone === 'library') return { ...player, library: [...player.library, id] };
  if (zone === 'battlefield') return { ...player, battlefield: [...player.battlefield, id] };
  if (zone === 'graveyard') return { ...player, graveyard: [...player.graveyard, id] };
  if (zone === 'exile') return { ...player, exile: [...player.exile, id] };
  if (zone === 'command') return { ...player, commandZone: [...player.commandZone, id] };
  if (zone === 'sideboard') return { ...player, sideboard: [...player.sideboard, id] };
  if (zone === 'maybeboard') return { ...player, maybeboard: [...player.maybeboard, id] };
  return player;
}

function makeAction(game: GameState, turn: number, playerId: string, type: ActionRecord['actionType'], description: string, affectedObjects: string[] = [], data: Record<string, unknown> = {}): ActionRecord {
  return createAction({ ...game, turn }, playerId, type, description, affectedObjects, data);
}

function makeOpeningSession(): SoloTestSession {
  return {
    id: 'opening-session',
    deckId: 'performance-deck',
    startedAt: 1,
    mode: 'goldfish',
    currentHand: [
      { id: 'forest-1', name: 'Forest', libraryIndex: 0 },
      { id: 'forest-2', name: 'Forest', libraryIndex: 1 },
      { id: 'forest-3', name: 'Forest', libraryIndex: 2 },
      { id: 'elf-1', name: 'Low Elf', libraryIndex: 3 },
      { id: 'dragon-1', name: 'Expensive Dragon', libraryIndex: 4 },
      { id: 'dragon-2', name: 'Expensive Dragon', libraryIndex: 5 },
      { id: 'dragon-3', name: 'Expensive Dragon', libraryIndex: 6 },
    ],
    mulligansTaken: 1,
    cardsToBottom: ['dragon-3'],
    kept: true,
    handHistory: [],
  };
}

test('Goldfish report counts turns and actions', () => {
  const game = makeGame(4);
  const actions = [
    makeAction(game, 1, 'solo', 'GAME_START', 'Game started.'),
    makeAction(game, 2, 'solo', 'DRAW_CARD', 'Solo Player drew 1 card(s)'),
    makeAction(game, 4, 'solo', 'CHANGE_PHASE', 'Turn 4 - Solo Player'),
  ];
  const report = generateSoloPerformanceReport({ ...game, actionLog: actions }, actions, { sessionType: 'goldfish', now: 10 });
  assert(report.turnsPlayed === 4, `expected 4 turns, got ${report.turnsPlayed}`);
  assert(report.actionsCount === 3, `expected 3 actions, got ${report.actionsCount}`);
});

test('Opening hand land count is included when available', () => {
  const report = generateSoloPerformanceReport(makeGame(1), [], {
    deck: makeDeck(),
    session: makeOpeningSession(),
    sessionType: 'goldfish',
  });
  assert(report.openingHand?.landCount === 3, `expected 3 lands, got ${report.openingHand?.landCount}`);
  assert(report.openingHand?.nonlandCount === 4, `expected 4 nonlands, got ${report.openingHand?.nonlandCount}`);
  assert(report.openingHand?.mulligansTaken === 1, 'expected mulligan count');
  assert(report.openingHand?.keptHandSize === 6, 'expected kept hand size after bottoming one card');
});

test('Lands played are counted', () => {
  let game = makeGame(3);
  const forest = addCard(game, 'solo', makeDefinition('Forest', ['Land'], 0), 'battlefield');
  game = forest.game;
  const actions = [
    makeAction(game, 1, 'solo', 'MOVE_CARD', 'Forest played as land', [forest.id]),
    makeAction(game, 2, 'solo', 'MOVE_CARD', 'Forest played as land', [forest.id]),
  ];
  const report = generateSoloPerformanceReport({ ...game, actionLog: actions }, actions, { sessionType: 'goldfish' });
  assert(report.manaDevelopment.landsPlayed === 2, `expected 2 lands, got ${report.manaDevelopment.landsPlayed}`);
  assert(report.manaDevelopment.firstThreeTurnsLandDrops === 2, 'expected first three land drops to count');
});

test('Damage dealt is counted from current life totals', () => {
  const game = {
    ...makeGame(5),
    players: makeGame(5).players.map(player =>
      player.id === 'solo' ? { ...player, life: 35 } :
        player.id === 'dummy' ? { ...player, life: 32 } : player
    ),
  };
  const report = generateSoloPerformanceReport(game, [], { sessionType: 'dummy' });
  assert(report.combat.totalDamageDealt === 8, `expected 8 dealt, got ${report.combat.totalDamageDealt}`);
  assert(report.combat.totalDamageTaken === 5, `expected 5 taken, got ${report.combat.totalDamageTaken}`);
});

test('Dummy profile appears in dummy report', () => {
  const report = generateSoloPerformanceReport(makeGame(2), [], { sessionType: 'dummy' });
  assert(report.dummy?.profile === 'aggro', `expected aggro profile, got ${report.dummy?.profile}`);
  assert(report.dummy?.archetype === 'aggro', `expected aggro archetype, got ${report.dummy?.archetype}`);
});

test('Suggestions appear for missed land drops', () => {
  const report = generateSoloPerformanceReport(makeGame(3), [], { sessionType: 'goldfish' });
  assert(report.suggestions.includes('Opening mana may be inconsistent.'), 'expected opening mana suggestion');
  assert(report.suggestions.includes('Consider reviewing land count or ramp.'), 'expected land count/ramp suggestion');
});

test('Suggestions appear for slow board development', () => {
  const game = {
    ...makeGame(4),
    players: makeGame(4).players.map(player => player.id === 'solo' ? { ...player, hand: ['a', 'b', 'c', 'd', 'e', 'f'] } : player),
  };
  const report = generateSoloPerformanceReport(game, [], { sessionType: 'goldfish' });
  assert(report.suggestions.includes('Early board presence may be light.'), 'expected board presence suggestion');
  assert(report.suggestions.includes('Deck may have too many expensive or situational cards.'), 'expected hand-size/board suggestion');
});

test('Missing data produces warnings, not crashes', () => {
  const report = generateSoloPerformanceReport(makeGame(1), [], { sessionType: 'goldfish' });
  assert(report.warnings.length > 0, 'expected warnings');
  assert(report.actionsCount === 0, 'expected zero action count');
});

test('Report export JSON is valid', () => {
  const report = generateSoloPerformanceReport(makeGame(1), [], { sessionType: 'goldfish', now: 123 });
  const parsed = JSON.parse(serializeSoloPerformanceReport(report)) as { id?: string; generatedAt?: number };
  assert(parsed.id === report.id, 'expected serialized report id');
  assert(parsed.generatedAt === 123, 'expected serialized generatedAt');
});

void chain.then(() => {
  console.log(`\nSolo performance tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
