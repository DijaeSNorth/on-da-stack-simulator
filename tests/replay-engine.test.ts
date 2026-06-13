import {
  applyReplayToIndex,
  createReplayCheckpoints,
  createReplayCheckpointsWithWarnings,
  createReplayFileFromGame,
  createReplaySession,
  getReplayTimelineMarkers,
  jumpReplayToAction,
  stepReplayBackward,
  stepReplayForward,
  validateReplayFile,
} from '../client/src/engine/replayEngine';
import type { ActionRecord, GameState, Player } from '../client/src/types/game';
import type { ReplayFile } from '../client/src/types/replay';

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

function player(id: string, name: string): Player {
  return {
    id,
    name,
    color: '#3b82f6',
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
  };
}

function action(id: string, type: ActionRecord['actionType'], data: Record<string, unknown> = {}, turn = 1): ActionRecord {
  return {
    id,
    turn,
    phase: type === 'DECLARE_ATTACKER' ? 'declareAttackers' : 'main1',
    playerId: 'p1',
    actionType: type,
    timestamp: 1000 + Number(id.replace(/\D/g, '') || 0),
    description: `${type} ${id}`,
    affectedObjects: [],
    data,
    flags: [],
    undone: false,
  };
}

function game(): GameState {
  const p1 = player('p1', 'Player A');
  const p2 = player('p2', 'Player B');
  return {
    id: 'game-1',
    rulesetVersion: 'test-rules',
    config: {
      playerCount: 2,
      format: 'commander',
      startingLife: 40,
      useCommanderDamage: true,
      useInfect: true,
      startingHandSize: 7,
      maxMulligans: 7,
      commanderTaxEnabled: true,
      houseRules: [],
      timerEnabled: false,
    },
    players: [p1, { ...p2, library: ['hidden-lib'], hand: ['hidden-hand'] }],
    cards: {
      'hidden-lib': { instanceId: 'hidden-lib', definitionId: 'd1', definition: cardDef('Hidden Lib'), zone: 'library', ownerId: 'p2', controllerId: 'p2', tapped: false, faceDown: false, transformed: false, phased: false, counters: [], attachments: [], markedForDamage: 0, summoningSick: false, token: false, copy: false, notes: '', exilePermanent: false, combatRole: 'none', combatDamageAssigned: 0 },
      'hidden-hand': { instanceId: 'hidden-hand', definitionId: 'd2', definition: cardDef('Hidden Hand'), zone: 'hand', ownerId: 'p2', controllerId: 'p2', tapped: false, faceDown: false, transformed: false, phased: false, counters: [], attachments: [], markedForDamage: 0, summoningSick: false, token: false, copy: false, notes: '', exilePermanent: false, combatRole: 'none', combatDamageAssigned: 0 },
    },
    definitions: {},
    turn: 1,
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

function cardDef(name: string) {
  return {
    id: name,
    name,
    cmc: 1,
    typeLine: 'Creature',
    superTypes: [],
    cardTypes: ['Creature' as const],
    subTypes: [],
    oracleText: '',
    colors: [],
    colorIdentity: [],
    keywords: [],
    isDoubleFaced: false,
    legalities: {},
  };
}

function replayFile(overrides: Partial<ReplayFile> = {}): ReplayFile {
  const baseGame = game();
  return {
    replayVersion: '2.0.0',
    exportedAt: 10,
    gameId: baseGame.id,
    gameName: 'Replay Test',
    rulesetVersion: baseGame.rulesetVersion,
    mode: 'solo',
    players: baseGame.players.map(p => ({ playerId: p.id, displayName: p.name, seatIndex: p.seatIndex })),
    initialGameState: baseGame,
    actionLog: [
      action('a1', 'CHANGE_LIFE', { playerId: 'p2', delta: -3 }, 1),
      action('a2', 'CHANGE_PHASE', { to: 'untap' }, 2),
      action('a3', 'DECLARE_ATTACKER', { targetPlayerId: 'p2' }, 2),
    ],
    privacy: { includesPrivateZones: false },
    ...overrides,
  };
}

function longReplayFile(actionCount = 60): ReplayFile {
  const file = replayFile();
  return {
    ...file,
    actionLog: Array.from({ length: actionCount }, (_, index) =>
      action(`life-${index}`, 'CHANGE_LIFE', { playerId: 'p2', delta: -1 }, Math.floor(index / 10) + 1)
    ),
  };
}

test('validateReplayFile accepts valid replay', () => {
  assert(validateReplayFile(replayFile()).ok, 'expected valid replay to pass');
});

test('validateReplayFile rejects missing initialGameState', () => {
  const raw = { ...replayFile(), initialGameState: undefined };
  const result = validateReplayFile(raw);
  assert(!result.ok && result.errors.some(error => error.includes('initialGameState')), 'expected missing initialGameState error');
});

test('validateReplayFile rejects unsupported replayVersion', () => {
  const result = validateReplayFile(replayFile({ replayVersion: '99.0.0' }));
  assert(!result.ok && result.errors.some(error => error.includes('Unsupported replayVersion')), 'expected unsupported version error');
});

test('createReplaySession starts before first action', () => {
  const session = createReplaySession(replayFile());
  assert(session.currentActionIndex === -1, `expected -1, got ${session.currentActionIndex}`);
});

test('step forward advances action index', () => {
  const session = stepReplayForward(createReplaySession(replayFile()));
  assert(session.currentActionIndex === 0, `expected 0, got ${session.currentActionIndex}`);
});

test('step backward returns to previous action index', () => {
  const session = stepReplayBackward(jumpReplayToAction(createReplaySession(replayFile()), 1));
  assert(session.currentActionIndex === 0, `expected 0, got ${session.currentActionIndex}`);
});

test('jump to action reconstructs expected state', () => {
  const session = jumpReplayToAction(createReplaySession(replayFile()), 0);
  const p2 = session.currentGameState.players.find(p => p.id === 'p2');
  assert(p2?.life === 37, `expected p2 at 37, got ${p2?.life}`);
});

test('unsupported action creates warning but does not crash', () => {
  const file = replayFile({ actionLog: [action('x1', 'ROLL_DICE')] });
  const result = applyReplayToIndex(file, 0);
  assert(result.warnings.length === 1, 'expected unsupported warning');
});

test('public export redacts hands and libraries', () => {
  const exported = createReplayFileFromGame(game(), { includePrivateZones: false, includeFinalSnapshot: true, redacted: true });
  assert(!exported.initialGameState.cards['hidden-lib'], 'expected hidden library card redacted');
  assert(exported.initialGameState.players[1].library.length === 1, 'expected library count preserved');
});

test('private export includes hands and libraries', () => {
  const exported = createReplayFileFromGame(game(), { includePrivateZones: true, includeFinalSnapshot: true, redacted: false });
  assert(Boolean(exported.initialGameState.cards['hidden-lib']), 'expected hidden library card included');
  assert(exported.privacy.includesPrivateZones, 'expected privacy marker for private zones');
});

test('timeline markers include turns and combat actions', () => {
  const markers = getReplayTimelineMarkers(replayFile());
  assert(markers.some(marker => marker.type === 'turn'), 'expected turn marker');
  assert(markers.some(marker => marker.type === 'combat'), 'expected combat marker');
});

test('damage action creates damage marker', () => {
  const markers = getReplayTimelineMarkers(replayFile({ actionLog: [action('life', 'CHANGE_LIFE', { playerId: 'p2', delta: -4 })] }));
  assert(markers.some(marker => marker.type === 'damage'), 'expected damage marker');
});

test('unsupported action creates warning marker', () => {
  const markers = getReplayTimelineMarkers(replayFile({ actionLog: [action('dice', 'ROLL_DICE')] }));
  assert(markers.some(marker => marker.type === 'warning'), 'expected warning marker');
});

test('checkpoints create checkpoint markers', () => {
  const file = longReplayFile(30);
  const checkpoints = createReplayCheckpoints(file, 25);
  const markers = getReplayTimelineMarkers(file, checkpoints);
  assert(markers.some(marker => marker.type === 'checkpoint'), 'expected checkpoint marker');
});

test('redacted replay timeline does not expose hidden card names in marker labels', () => {
  const file = replayFile({
    privacy: { includesPrivateZones: false, redactedPlayers: ['p2'] },
    actionLog: [action('secret', 'CAST_SPELL', {}, 1)],
  });
  file.actionLog[0] = { ...file.actionLog[0], description: 'Player B cast Hidden Hand.' };
  const markers = getReplayTimelineMarkers(file);
  assert(!markers.some(marker => marker.label.includes('Hidden Hand')), 'expected redacted marker labels to hide private card name');
});

test('createReplayCheckpoints creates initial checkpoint', () => {
  const checkpoints = createReplayCheckpoints(longReplayFile(), 25);
  assert(checkpoints[0]?.actionIndex === -1, `expected initial checkpoint at -1, got ${checkpoints[0]?.actionIndex}`);
});

test('createReplayCheckpoints creates checkpoint every 25 actions', () => {
  const checkpoints = createReplayCheckpoints(longReplayFile(60), 25);
  const indexes = checkpoints.map(checkpoint => checkpoint.actionIndex);
  assert(indexes.includes(24), `expected checkpoint after action 24, got ${indexes.join(',')}`);
  assert(indexes.includes(49), `expected checkpoint after action 49, got ${indexes.join(',')}`);
  assert(indexes.includes(59), `expected final checkpoint after action 59, got ${indexes.join(',')}`);
});

test('applyReplayToIndex uses nearest checkpoint when supplied', () => {
  const file = longReplayFile(30);
  const checkpoints = createReplayCheckpoints(file, 25);
  const synthetic = checkpoints.map(checkpoint => checkpoint.actionIndex === 24
    ? { ...checkpoint, gameState: { ...checkpoint.gameState, players: checkpoint.gameState.players.map(player => player.id === 'p2' ? { ...player, life: 1 } : player) } }
    : checkpoint);
  const result = applyReplayToIndex(file, 24, synthetic);
  const p2 = result.currentGameState.players.find(player => player.id === 'p2');
  assert(p2?.life === 1, `expected synthetic checkpoint state to be used, got ${p2?.life}`);
});

test('checkpoint jump state matches full rebuild state', () => {
  const file = longReplayFile(60);
  const checkpoints = createReplayCheckpoints(file, 25);
  const full = applyReplayToIndex(file, 57).currentGameState;
  const optimized = applyReplayToIndex(file, 57, checkpoints).currentGameState;
  assert(JSON.stringify(optimized) === JSON.stringify(full), 'expected checkpoint rebuild to match full rebuild');
});

test('unsupported actions create warning but do not crash checkpoint generation', () => {
  const result = createReplayCheckpointsWithWarnings(replayFile({ actionLog: [action('bad', 'ROLL_DICE')] }), 25);
  assert(result.checkpoints.length >= 2, 'expected checkpoint generation to complete');
  assert(result.warnings.length === 1, 'expected unsupported action warning');
});

test('small replay without many actions still works without checkpoints', () => {
  const file = replayFile();
  const result = applyReplayToIndex(file, 1, undefined);
  assert(result.currentGameState.turn === 2, `expected turn 2 after small replay jump, got ${result.currentGameState.turn}`);
});

console.log(`\nReplay engine tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
