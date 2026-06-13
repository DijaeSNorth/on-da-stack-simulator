import {
  buildActionLogViewModel,
  inferActionCategory,
  type ActionLogFilter,
} from '../client/src/components/panels/actionLogUiModel';
import type { ActionRecord, CardDefinition, CardState, Player } from '../client/src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

const players: Player[] = [
  {
    id: 'p1',
    name: 'Player A',
    color: '#3b82f6',
    seatIndex: 0,
    life: 40,
    mulliganCount: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 },
    commanderDamage: {},
    poisonCounters: 0,
    energyCounters: 0,
    experienceCounters: 0,
    commanderCastCount: {},
    commanders: [],
    isReady: true,
    isActive: true,
    hasPriority: true,
    hand: [],
    library: [],
    graveyard: [],
    exile: [],
    sideboard: [],
    maybeboard: [],
    commandZone: [],
    battlefield: [],
    connected: true,
    isSpectator: false,
    settings: {
      assistantMode: 'ON',
      assistantVerbosity: 'normal',
      showTriggerReminders: true,
      showStackExplanations: true,
      coachingLevel: 'advanced',
      isJudgeMode: false,
    },
  },
  {
    id: 'p2',
    name: 'Player B',
    color: '#ef4444',
    seatIndex: 1,
    life: 40,
    mulliganCount: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 },
    commanderDamage: {},
    poisonCounters: 0,
    energyCounters: 0,
    experienceCounters: 0,
    commanderCastCount: {},
    commanders: [],
    isReady: true,
    isActive: false,
    hasPriority: false,
    hand: [],
    library: [],
    graveyard: [],
    exile: [],
    sideboard: [],
    maybeboard: [],
    commandZone: [],
    battlefield: [],
    connected: true,
    isSpectator: false,
    settings: {
      assistantMode: 'ON',
      assistantVerbosity: 'normal',
      showTriggerReminders: true,
      showStackExplanations: true,
      coachingLevel: 'advanced',
      isJudgeMode: false,
    },
  },
];

const solRing: CardDefinition = {
  id: 'sol-ring',
  name: 'Sol Ring',
  cmc: 1,
  typeLine: 'Artifact',
  superTypes: [],
  cardTypes: ['Artifact'],
  subTypes: [],
  oracleText: '{T}: Add {C}{C}.',
  colors: [],
  colorIdentity: ['C'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
};

const cards: Record<string, CardState> = {
  c1: {
    instanceId: 'c1',
    definitionId: 'sol-ring',
    definition: solRing,
    zone: 'battlefield',
    ownerId: 'p1',
    controllerId: 'p1',
    tapped: false,
    faceDown: false,
    transformed: false,
    phased: false,
    counters: [],
    attachments: [],
    markedForDamage: 0,
    summoningSick: false,
    token: false,
    copy: false,
    notes: '',
    exilePermanent: false,
    combatRole: 'none',
    combatDamageAssigned: 0,
  },
};

function action(id: string, turn: number, playerId: string, actionType: ActionRecord['actionType'], description: string, affectedObjects: string[] = []): ActionRecord {
  return {
    id,
    turn,
    phase: 'main1',
    playerId,
    actionType,
    timestamp: 1000 + Number(id.replace(/\D/g, '') || 0),
    description,
    affectedObjects,
    data: {},
    flags: [],
    undone: false,
  };
}

const actions: ActionRecord[] = [
  action('a1', 1, 'p1', 'CAST_SPELL', 'Player A cast Sol Ring.', ['c1']),
  action('a2', 1, 'p2', 'DECLARE_ATTACKER', 'Player B attacked Player A with 10 Goblins.'),
  action('a3', 2, 'p1', 'OTHER', 'Firebending added {R}{R}.'),
  action('a4', 2, 'p1', 'DRAW_CARD', 'Player A cracked Clue and drew a card.'),
  action('a5', 2, 'p1', 'MOVE_CARD', 'Player A moved Sol Ring to graveyard.', ['c1']),
];

function view(filter: ActionLogFilter = 'all', query = '', groupByTurn = false) {
  return buildActionLogViewModel(actions, { players, cards, filter, query, groupByTurn, currentTurn: 2 });
}

test('combat action appears under combat filter', () => {
  const result = view('combat');
  assert(result.visibleCount === 1, `expected 1 combat action, got ${result.visibleCount}`);
  assert(result.rows[0].action.id === 'a2', 'expected attack action in combat filter');
});

test('mechanic action appears under mechanic filter', () => {
  assert(inferActionCategory(actions[2]) === 'mechanic', 'expected Firebending log to infer mechanic category');
  const result = view('mechanic');
  assert(result.visibleCount === 1 && result.rows[0].action.id === 'a3', 'expected mechanic filter to include Firebending');
});

test('search finds card and player text', () => {
  const byCard = view('all', 'Sol Ring');
  const byPlayer = view('all', 'Player B');
  assert(byCard.visibleCount >= 1 && byCard.rows.some(row => row.action.id === 'a1'), 'expected Sol Ring search to include cast action');
  assert(byPlayer.visibleCount === 1 && byPlayer.rows[0].action.id === 'a2', 'expected Player B search to find attack action');
});

test('group by turn works', () => {
  const result = view('all', '', true);
  assert(result.groups.length === 2, `expected 2 turn groups, got ${result.groups.length}`);
  assert(result.groups[0].label === 'Current Turn (2)', `expected current turn first, got ${result.groups[0].label}`);
  assert(result.groups[0].actions.length === 3, 'expected three current-turn actions');
});

test('draw filter isolates draw actions', () => {
  const result = view('draws');
  assert(result.visibleCount === 1 && result.rows[0].action.id === 'a4', 'expected draw filter to isolate clue draw');
});

test('filtering combat actions preserves original actionIndex', () => {
  const result = view('combat');
  assert(result.rows[0].action.id === 'a2', 'expected combat row');
  assert(result.rows[0].actionIndex === 1, `expected original action index 1, got ${result.rows[0].actionIndex}`);
});

test('clicking filtered action can jump to original action index', () => {
  const result = view('zone-changes');
  const jumpedIndex = result.rows[0].actionIndex;
  assert(jumpedIndex === 4, `expected zone-change row to jump to original index 4, got ${jumpedIndex}`);
});

console.log(`\nAction log UI tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
