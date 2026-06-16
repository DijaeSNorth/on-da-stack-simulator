import { buildReplayCreatorViewModel } from '../client/src/components/replay/ReplayCreatorView';
import { createReplayFileFromGame } from '../client/src/engine/replayEngine';
import { useGameStore } from '../client/src/store/gameStore';
import type { ActionRecord, CardDefinition, CardState, GameState, Player } from '../client/src/types/game';
import type { ReplayFile } from '../client/src/types/replay';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

function cardDef(name: string): CardDefinition {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    cmc: 1,
    typeLine: 'Creature',
    superTypes: [],
    cardTypes: ['Creature'],
    subTypes: [],
    oracleText: '',
    colors: [],
    colorIdentity: [],
    keywords: [],
    isDoubleFaced: false,
    legalities: {},
  };
}

function player(id: string, name: string): Player {
  return {
    id,
    name,
    color: id === 'p1' ? '#3b82f6' : '#ef4444',
    seatIndex: id === 'p1' ? 0 : 1,
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
    isActive: id === 'p1',
    hasPriority: id === 'p1',
    hand: id === 'p1' ? ['secret-card'] : [],
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
  };
}

function action(actionType: ActionRecord['actionType'], description: string): ActionRecord {
  return {
    id: `creator-${actionType}`,
    turn: 2,
    phase: 'main1',
    playerId: 'p1',
    actionType,
    timestamp: 1000,
    description,
    affectedObjects: ['secret-card'],
    data: {},
    flags: [],
    undone: false,
  };
}

function game(): GameState {
  const secret: CardState = {
    instanceId: 'secret-card',
    definitionId: 'secret-dragon',
    definition: cardDef('Secret Dragon'),
    zone: 'hand',
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
  };
  return {
    id: 'creator-game-sensitive-id',
    rulesetVersion: 'test',
    config: { playerCount: 2, format: 'commander', startingLife: 40, useCommanderDamage: true, useInfect: true, startingHandSize: 7, maxMulligans: 7, commanderTaxEnabled: true, houseRules: [], timerEnabled: false },
    players: [player('p1', 'Player A'), player('p2', 'Player B')],
    cards: { [secret.instanceId]: secret },
    definitions: { [secret.definitionId]: secret.definition },
    turn: 2,
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
    phase: 'main1',
    stack: [],
    triggerQueue: [],
    actionLog: [],
    assistantFlags: [],
    combat: { active: false, attackingPlayerId: '', attackers: [], blockers: [], attackAssignments: [], blockAssignments: [], combatPhase: 'none', hasMyriad: false, myriadCopies: [] },
    houseRules: [],
    turnTrackers: { spellsWarpedThisTurn: [], cardsAirbendedThisTurn: [], waterbendEventsThisTurn: [], earthbentThisTurn: [] },
    snapshots: {},
    undoPointer: -1,
    createdAt: 1,
    lastUpdatedAt: 1,
    status: 'playing',
  };
}

function replayFile(actionRecord = action('CAST_SPELL', 'Player A cast Secret Dragon')): ReplayFile {
  const base = game();
  return {
    ...createReplayFileFromGame(base, { includePrivateZones: false, includeFinalSnapshot: false, redacted: true }, { gameName: 'Room ABCD firebase-user-123456' }),
    exportedAt: 1234,
    actionLog: [actionRecord],
    privacy: { includesPrivateZones: false, redactedPlayers: ['p1'] },
  };
}

async function loadCreatorReplay(file = replayFile()): Promise<void> {
  await useGameStore.getState().loadReplayFile(file);
  useGameStore.getState().replayJumpToAction(0);
  useGameStore.getState().replaySetViewMode('creator');
}

async function main(): Promise<void> {
  await test('creator view hides debug and private metadata', async () => {
    await loadCreatorReplay();
    const replay = useGameStore.getState().replay;
    assert(Boolean(replay), 'expected replay');
    const model = buildReplayCreatorViewModel(replay!);
    const raw = JSON.stringify(model);
    assert(!raw.includes('creator-game-sensitive-id'), 'expected creator model to omit raw game id');
    assert(!raw.includes('firebase-user-123456'), 'expected creator model to omit firebase/player metadata');
    assert(!raw.includes('Secret Dragon'), 'expected creator model to omit hidden card names in streamer-safe mode');
  });

  await test('creator view shows action caption', async () => {
    await loadCreatorReplay();
    const model = buildReplayCreatorViewModel(useGameStore.getState().replay!);
    assert(model.caption.includes('cast a spell'), `expected safe action caption, got ${model.caption}`);
  });

  await test('streamer-safe mode hides room codes and IDs', async () => {
    await loadCreatorReplay(replayFile(action('OTHER', 'Room ABCD peer abcdef firebase abcdef 123e4567-e89b-12d3-a456-426614174000')));
    const model = buildReplayCreatorViewModel(useGameStore.getState().replay!);
    const raw = JSON.stringify(model);
    assert(!raw.includes('ABCD') && !raw.includes('abcdef') && !raw.includes('123e4567'), `expected hidden sensitive ids, got ${raw}`);
  });

  await test('creator view does not mutate replay state', async () => {
    await loadCreatorReplay();
    const replay = useGameStore.getState().replay!;
    const before = JSON.stringify(replay);
    buildReplayCreatorViewModel(replay);
    const after = JSON.stringify(useGameStore.getState().replay);
    assert(before === after, 'expected creator model build to be pure');
  });

  console.log(`\nReplay creator tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
