import {
  REVIEW_EXPORT_WARNING,
  generateReplayReviewJson,
  generateReplayReviewMarkdown,
} from '../client/src/engine/replayReviewExport';
import type { ActionRecord, GameState, Player } from '../client/src/types/game';
import type { ReplayBookmark, ReplayFile, ReplayReviewNote } from '../client/src/types/replay';

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

function action(id: string, actionType: ActionRecord['actionType'], description: string, turn = 1): ActionRecord {
  return {
    id,
    turn,
    phase: 'main1',
    playerId: 'p1',
    actionType,
    timestamp: 1000 + turn,
    description,
    affectedObjects: [],
    data: {},
    flags: [],
    undone: false,
  };
}

function game(): GameState {
  return {
    id: 'summary-game',
    rulesetVersion: 'test',
    config: { playerCount: 2, format: 'commander', startingLife: 40, useCommanderDamage: true, useInfect: true, startingHandSize: 7, maxMulligans: 7, commanderTaxEnabled: true, houseRules: [], timerEnabled: false },
    players: [player('p1', 'Player A'), player('p2', 'Player B')],
    cards: {},
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

function replayFile(privateReplay = false): ReplayFile {
  const base = game();
  return {
    replayVersion: '2.0.0',
    exportedAt: 1234,
    gameId: base.id,
    gameName: 'Summary Replay',
    rulesetVersion: base.rulesetVersion,
    mode: 'solo',
    players: base.players.map(p => ({ playerId: p.id, displayName: p.name, seatIndex: p.seatIndex })),
    initialGameState: base,
    actionLog: [
      action('a1', 'CAST_SPELL', 'Player A cast Secret Dragon', 1),
      action('a2', 'CHANGE_LIFE', 'Player B lost 3 life', 2),
    ],
    privacy: privateReplay ? { includesPrivateZones: true } : { includesPrivateZones: false, redactedPlayers: ['p1'] },
  };
}

function notes(): ReplayReviewNote[] {
  return [
    { noteId: 'n1', replayId: 'r1', actionIndex: 0, turnNumber: 1, createdAt: 1, type: 'rules_question', title: 'Stack timing', body: 'Can this be responded to?', tags: ['rules'] },
    { noteId: 'n2', replayId: 'r1', actionIndex: 1, turnNumber: 2, createdAt: 2, type: 'deck_issue', body: 'Curve was too high.', tags: ['mana'] },
    { noteId: 'n3', replayId: 'r1', actionIndex: 1, turnNumber: 2, createdAt: 3, type: 'combat_decision', body: 'Attack sequencing mattered.', tags: [] },
    { noteId: 'n4', replayId: 'r1', actionIndex: 0, turnNumber: 1, createdAt: 4, type: 'content_clip', body: 'Clip this turn.', tags: [] },
  ];
}

function bookmarks(): ReplayBookmark[] {
  return [
    { bookmarkId: 'b1', replayId: 'r1', actionIndex: 0, turnNumber: 1, createdAt: 1, label: 'Opening pivot', type: 'turning_point' },
  ];
}

test('markdown export includes bookmarks', () => {
  const markdown = generateReplayReviewMarkdown(replayFile(), notes(), bookmarks());
  assert(markdown.includes('## Bookmarks') && markdown.includes('Opening pivot'), 'expected bookmark in markdown');
});

test('markdown export groups notes by type', () => {
  const markdown = generateReplayReviewMarkdown(replayFile(), notes(), bookmarks());
  assert(markdown.includes('### Rules Question') && markdown.includes('### Deck Issue'), 'expected grouped note headings');
});

test('JSON export is valid', () => {
  const parsed = JSON.parse(generateReplayReviewJson(replayFile(), notes(), bookmarks())) as { gameId?: string; notesByType?: unknown };
  assert(parsed.gameId === 'summary-game' && Boolean(parsed.notesByType), 'expected valid summary JSON');
});

test('public redacted export avoids hidden auto-generated card names', () => {
  const markdown = generateReplayReviewMarkdown(replayFile(false), [], bookmarks(), [0]);
  assert(!markdown.includes('Secret Dragon'), 'expected public summary to hide auto-generated hidden card name');
  assert(markdown.includes('Player A cast a spell'), 'expected safe public action label');
});

test('export warning text is available', () => {
  assert(REVIEW_EXPORT_WARNING.includes('Review exports include your notes'), 'expected export warning text');
});

console.log(`\nReplay review export tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
