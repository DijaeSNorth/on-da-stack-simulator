import { createReplayFileFromGame, getReplayTimelineMarkers } from '../client/src/engine/replayEngine';
import {
  exportReplayReview,
  getReplayReviewId,
  loadReplayReview,
  saveReplayReview,
} from '../client/src/engine/replayReviewStorage';
import { useGameStore } from '../client/src/store/gameStore';
import type { ActionRecord, CardDefinition, CardState, GameState, Player } from '../client/src/types/game';
import type { ReplayBookmark, ReplayReviewNote } from '../client/src/types/replay';

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

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
});

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
    hand: id === 'p1' ? ['hidden-card'] : [],
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

function action(id: string, turn = 1): ActionRecord {
  return {
    id,
    turn,
    phase: 'main1',
    playerId: 'p1',
    actionType: 'CHANGE_LIFE',
    timestamp: 1000 + turn,
    description: `Action ${id}`,
    affectedObjects: [],
    data: { playerId: 'p2', delta: -1 },
    flags: [],
    undone: false,
  };
}

function game(): GameState {
  const hidden: CardState = {
    instanceId: 'hidden-card',
    definitionId: 'secret-card',
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
    id: 'review-game',
    rulesetVersion: 'test',
    config: { playerCount: 2, format: 'commander', startingLife: 40, useCommanderDamage: true, useInfect: true, startingHandSize: 7, maxMulligans: 7, commanderTaxEnabled: true, houseRules: [], timerEnabled: false },
    players: [player('p1', 'Player A'), player('p2', 'Player B')],
    cards: { [hidden.instanceId]: hidden },
    definitions: { [hidden.definitionId]: hidden.definition },
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

function replayFile() {
  const base = game();
  return {
    ...createReplayFileFromGame(base, { includePrivateZones: false, includeFinalSnapshot: false, redacted: true }, { gameName: 'Review Replay' }),
    exportedAt: 1234,
    actionLog: [action('a1', 1), action('a2', 2), action('a3', 3)],
  };
}

async function loadReplay(): Promise<void> {
  localStorage.clear();
  await useGameStore.getState().loadReplayFile(replayFile());
}

async function main(): Promise<void> {
  await test('add note to current action', async () => {
    await loadReplay();
    useGameStore.getState().replayJumpToAction(1);
    useGameStore.getState().addReplayNote(1, { type: 'mistake', body: 'Missed attack line.', tags: ['combat'] });
    const note = useGameStore.getState().replay?.reviewNotes[0];
    assert(note?.actionIndex === 1 && note.type === 'mistake', 'expected note at current action');
  });

  await test('add bookmark to current action', async () => {
    await loadReplay();
    useGameStore.getState().replayJumpToAction(2);
    useGameStore.getState().addReplayBookmark(2, { type: 'turning_point', label: 'Pivot turn' });
    const bookmark = useGameStore.getState().replay?.bookmarks[0];
    assert(bookmark?.actionIndex === 2 && bookmark.label === 'Pivot turn', 'expected bookmark at current action');
  });

  await test('clicking bookmark jumps to action', async () => {
    await loadReplay();
    useGameStore.getState().addReplayBookmark(2, { type: 'highlight', label: 'Jump target' });
    const bookmarkId = useGameStore.getState().replay?.bookmarks[0]?.bookmarkId ?? '';
    useGameStore.getState().replayJumpToAction(0);
    useGameStore.getState().jumpToReplayBookmark(bookmarkId);
    assert(useGameStore.getState().replay?.currentActionIndex === 2, 'expected bookmark jump to action 2');
  });

  await test('notes persist in localStorage', async () => {
    await loadReplay();
    const replay = useGameStore.getState().replay;
    assert(Boolean(replay), 'expected replay');
    useGameStore.getState().addReplayNote(0, { type: 'general', body: 'Saved note.', tags: ['saved'] });
    const stored = loadReplayReview(getReplayReviewId(replay!.replayFile));
    assert(stored.notes[0]?.body === 'Saved note.', 'expected persisted note');
  });

  await test('corrupt localStorage does not crash', () => {
    localStorage.setItem('on-da-stack-replay-review-v1', '{bad');
    const review = loadReplayReview('missing');
    assert(review.notes.length === 0 && review.bookmarks.length === 0, 'expected empty review after corrupt storage');
  });

  await test('export review JSON works', () => {
    const note: ReplayReviewNote = {
      noteId: 'n1',
      replayId: 'r1',
      actionIndex: 0,
      createdAt: 1,
      type: 'general',
      body: 'Exported.',
      tags: [],
    };
    const bookmark: ReplayBookmark = {
      bookmarkId: 'b1',
      replayId: 'r1',
      actionIndex: 1,
      createdAt: 2,
      label: 'Bookmark',
      type: 'custom',
    };
    saveReplayReview('r1', [note], [bookmark]);
    const exported = exportReplayReview('r1');
    assert(exported.notes.length === 1 && exported.bookmarks.length === 1, 'expected exported review contents');
  });

  await test('public redacted replay does not auto-fill hidden card names', async () => {
    await loadReplay();
    useGameStore.getState().addReplayNote(0, { type: 'general', body: 'Public note.', tags: [] });
    useGameStore.getState().addReplayBookmark(0, { type: 'custom', label: 'Action 1' });
    const raw = JSON.stringify({
      notes: useGameStore.getState().replay?.reviewNotes,
      bookmarks: useGameStore.getState().replay?.bookmarks,
    });
    assert(!raw.includes('Secret Dragon'), 'expected no hidden card name in auto-created review data');
  });

  await test('timeline markers include bookmarks and notes', async () => {
    await loadReplay();
    useGameStore.getState().addReplayNote(0, { type: 'rules_question', body: 'Rules?', tags: [] });
    useGameStore.getState().addReplayBookmark(1, { type: 'rules', label: 'Rules point' });
    const next = useGameStore.getState().replay!;
    const markers = getReplayTimelineMarkers(next.replayFile, next.checkpoints, {
      notes: next.reviewNotes,
      bookmarks: next.bookmarks,
    });
    assert(markers.some(marker => marker.type === 'note'), 'expected note marker');
    assert(markers.some(marker => marker.type === 'bookmark'), 'expected bookmark marker');
  });

  console.log(`\nReplay review tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
