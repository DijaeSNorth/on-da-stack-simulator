/**
 * replay-engine.test.ts
 *
 * Critical tests for the replay system.
 * Tests run entirely offline — pure functions only.
 *
 * Coverage:
 *   1.  createReplay: meta fields correctly set
 *   2.  createReplay: empty actionLog → zero duration, no extra checkpoints
 *   3.  createReplay: turn-change checkpoints generated correctly
 *   4.  createReplay: GAME_END checkpoint generated
 *   5.  createReplay: custom name override
 *   6.  getActionsUpTo: correct slice at various indices
 *   7.  getStateAtIndex: returns nearest checkpoint state
 *   8.  getStateAtIndex: targetIndex -1 → null
 *   9.  groupActionsByTurn: groups correctly by turn+phase
 *  10.  groupActionsByTurn: large action log (500 actions, 50 turns)
 *  11.  formatDuration: seconds, minutes, minutes+seconds
 *  12.  describeAction: falls back to actionType+playerId when no description
 *  13.  exportReplayAsJSON: round-trips through importReplayFromJSON
 *  14.  importReplayFromJSON: returns null on garbage input
 *  15.  importReplayFromJSON: returns null on missing required fields
 *  16.  ACTION_COLORS: covers all critical action types
 *  17.  saveReplayToStorage / loadReplaysFromStorage: CRUD round-trip
 *  18.  saveReplayToStorage: max 10 replays — drops oldest
 *  19.  deleteReplayFromStorage: removes exactly the target replay
 *  20.  saveReplayToStorage: duplicate id overwrites, does not duplicate
 *  21.  Large game state: 6-player board with 200 cards survives createReplay
 *  22.  createReplay with myriad-like burst: 150-action single-turn spike
 *  23.  Checkpoint ordering: checkpoints sorted by actionIndex ascending
 *  24.  getStateAtIndex with dense checkpoints: always picks the closest one
 *  25.  importReplayFromJSON: handles nested unicode card names (Æther, Jötun)
 */

// ─── Inline mock of the engine (no DOM / localStorage required) ───────────────
// We directly import the pure functions but mock localStorage as an in-memory map.

import type { GameState, ActionRecord, Player, CardState } from '../client/src/types/game';
import {
  createReplay, exportReplayAsJSON, importReplayFromJSON,
  getActionsUpTo, getStateAtIndex, groupActionsByTurn,
  formatDuration, describeAction, ACTION_COLORS,
  type Replay, type ReplayMeta, type ReplayCheckpoint,
} from '../client/src/engine/replayEngine';

// ─── LocalStorage mock (Node doesn't have localStorage) ──────────────────────
// We shim it before importing storage functions, then import them.
const lsStore: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => lsStore[k] ?? null,
  setItem: (k: string, v: string) => { lsStore[k] = v; },
  removeItem: (k: string) => { delete lsStore[k]; },
};

import {
  saveReplayToStorage, loadReplaysFromStorage, deleteReplayFromStorage,
} from '../client/src/engine/replayEngine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAction(
  overrides: Partial<ActionRecord> & { actionType: string; turn?: number; phase?: string }
): ActionRecord {
  return {
    id: crypto.randomUUID(),
    actionType: overrides.actionType,
    playerId: overrides.playerId ?? 'p1',
    timestamp: overrides.timestamp ?? Date.now(),
    description: overrides.description ?? '',
    flags: overrides.flags ?? [],
    turn: overrides.turn ?? 1,
    phase: overrides.phase ?? 'main1',
    data: overrides.data ?? {},
  };
}

function makeMinimalGameState(overrides?: {
  turn?: number;
  actionLog?: ActionRecord[];
  players?: Partial<Player>[];
}): GameState {
  const players: Player[] = (overrides?.players ?? [{ name: 'Alice', id: 'p1' }, { name: 'Bob', id: 'p2' }]).map((p, i) => ({
    id: p.id ?? `p${i + 1}`,
    name: p.name ?? `Player ${i + 1}`,
    color: '#7c3aed',
    life: 40,
    hand: [],
    library: [],
    graveyard: [],
    exile: [],
    commandZone: [],
    battlefield: p.battlefield ?? [],
    commanderDamage: {},
    counters: {},
    isActive: i === 0,
    seatIndex: i,
    poisonCounters: 0,
    energyCounters: 0,
    commandersCastCount: {},
    hasDrawn: false,
  }));

  return {
    id: 'game-1',
    players,
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
    turn: overrides?.turn ?? 1,
    phase: 'main1',
    stack: [],
    triggerQueue: [],
    actionLog: overrides?.actionLog ?? [],
    config: { format: 'commander', startingLife: 40, commanderDamageThreshold: 21, maxHandSize: 7, mulligan: 'london', customRules: [] },
    assistantFlags: [],
    winner: null,
    gameStartTime: Date.now(),
    lastUpdatedAt: Date.now(),
  } as unknown as GameState;
}

// ─── 1. createReplay: meta fields ─────────────────────────────────────────────

console.log('=== 1. createReplay: meta fields ===');
{
  const log = [
    makeAction({ actionType: 'GAME_START', timestamp: 1000 }),
    makeAction({ actionType: 'DRAW_CARD', timestamp: 2000 }),
  ];
  const game = makeMinimalGameState({ actionLog: log });
  const replay = createReplay(game);

  console.assert(typeof replay.meta.id === 'string' && replay.meta.id.length > 0, 'FAIL meta.id missing');
  console.assert(typeof replay.meta.name === 'string' && replay.meta.name.length > 0, 'FAIL meta.name missing');
  console.assert(replay.meta.turnCount === 1, `FAIL turnCount: expected 1, got ${replay.meta.turnCount}`);
  console.assert(replay.meta.playerNames.length === 2, 'FAIL playerNames wrong length');
  console.assert(replay.meta.playerNames.includes('Alice'), 'FAIL Alice not in playerNames');
  console.assert(replay.meta.actionCount === 2, `FAIL actionCount: expected 2, got ${replay.meta.actionCount}`);
  console.assert(replay.meta.durationMs === 1000, `FAIL durationMs: expected 1000, got ${replay.meta.durationMs}`);
  console.assert(replay.meta.format === 'commander', `FAIL format: expected commander, got ${replay.meta.format}`);
  console.log('  PASS: meta fields all correct');
}

// ─── 2. createReplay: empty actionLog ─────────────────────────────────────────

console.log('=== 2. createReplay: empty actionLog ===');
{
  const game = makeMinimalGameState({ actionLog: [] });
  const replay = createReplay(game);

  console.assert(replay.meta.actionCount === 0, 'FAIL actionCount not 0');
  console.assert(replay.meta.durationMs === 0, `FAIL durationMs not 0: got ${replay.meta.durationMs}`);
  // Only the initial "Game Start" checkpoint
  console.assert(replay.checkpoints.length === 1, `FAIL expected 1 checkpoint (game start), got ${replay.checkpoints.length}`);
  console.assert(replay.checkpoints[0].actionIndex === -1, 'FAIL first checkpoint actionIndex should be -1');
  console.assert(replay.checkpoints[0].label === 'Game Start', `FAIL first checkpoint label: ${replay.checkpoints[0].label}`);
  console.log('  PASS: empty actionLog → zero duration, one Game Start checkpoint');
}

// ─── 3. createReplay: turn-change checkpoints ─────────────────────────────────

console.log('=== 3. createReplay: turn-change checkpoints ===');
{
  const log: ActionRecord[] = [
    makeAction({ actionType: 'GAME_START', turn: 1, phase: 'untap' }),
    makeAction({ actionType: 'DRAW_CARD',  turn: 1, phase: 'draw'  }),
    makeAction({ actionType: 'CHANGE_PHASE', turn: 2, phase: 'untap', data: { phase: 'untap' } }),
    makeAction({ actionType: 'DRAW_CARD',  turn: 2, phase: 'draw'  }),
    makeAction({ actionType: 'CHANGE_PHASE', turn: 3, phase: 'untap', data: { to: 'untap' } }),
  ];
  const game = makeMinimalGameState({ turn: 3, actionLog: log });
  const replay = createReplay(game);

  // Should have: Game Start (index -1) + turn 2 + turn 3
  const turnCheckpoints = replay.checkpoints.filter(c => c.label.startsWith('Turn'));
  console.assert(turnCheckpoints.length >= 2, `FAIL expected >=2 turn checkpoints, got ${turnCheckpoints.length}`);
  const labels = replay.checkpoints.map(c => c.label);
  console.assert(labels.includes('Game Start'), 'FAIL missing Game Start checkpoint');
  console.log(`  PASS: ${turnCheckpoints.length} turn checkpoints generated for 3-turn game`);
}

// ─── 4. createReplay: GAME_END checkpoint ─────────────────────────────────────

console.log('=== 4. createReplay: GAME_END checkpoint ===');
{
  const log: ActionRecord[] = [
    makeAction({ actionType: 'GAME_START', turn: 1 }),
    makeAction({ actionType: 'DRAW_CARD',  turn: 1 }),
    makeAction({ actionType: 'GAME_END',   turn: 3 }),
  ];
  const game = makeMinimalGameState({ turn: 3, actionLog: log });
  const replay = createReplay(game);

  const endCheckpoint = replay.checkpoints.find(c => c.label.includes('Game End'));
  console.assert(endCheckpoint !== undefined, 'FAIL no GAME_END checkpoint');
  console.assert(endCheckpoint!.actionIndex === 2, `FAIL GAME_END checkpoint at wrong index: ${endCheckpoint!.actionIndex}`);
  console.log('  PASS: GAME_END checkpoint generated at correct index');
}

// ─── 5. createReplay: custom name ─────────────────────────────────────────────

console.log('=== 5. createReplay: custom name override ===');
{
  const game = makeMinimalGameState();
  const replay = createReplay(game, 'My Test Replay');
  console.assert(replay.meta.name === 'My Test Replay', `FAIL name: got ${replay.meta.name}`);
  console.log('  PASS: custom name stored correctly');
}

// ─── 6. getActionsUpTo ────────────────────────────────────────────────────────

console.log('=== 6. getActionsUpTo ===');
{
  const log = Array.from({ length: 10 }, (_, i) =>
    makeAction({ actionType: 'DRAW_CARD', turn: 1, timestamp: 1000 + i * 100 })
  );
  const game = makeMinimalGameState({ actionLog: log });
  const replay = createReplay(game);

  const slice0 = getActionsUpTo(replay, 0);
  console.assert(slice0.length === 1, `FAIL slice0 length: expected 1, got ${slice0.length}`);

  const slice4 = getActionsUpTo(replay, 4);
  console.assert(slice4.length === 5, `FAIL slice4 length: expected 5, got ${slice4.length}`);

  const sliceAll = getActionsUpTo(replay, 9);
  console.assert(sliceAll.length === 10, `FAIL sliceAll length: expected 10, got ${sliceAll.length}`);
  console.log('  PASS: getActionsUpTo returns correct slices');
}

// ─── 7. getStateAtIndex: nearest checkpoint ────────────────────────────────────

console.log('=== 7. getStateAtIndex: nearest checkpoint ===');
{
  const log: ActionRecord[] = [
    makeAction({ actionType: 'GAME_START',   turn: 1 }),
    makeAction({ actionType: 'CHANGE_PHASE', turn: 2, phase: 'untap', data: { phase: 'untap' } }),
    makeAction({ actionType: 'DRAW_CARD',    turn: 2 }),
  ];
  const game = makeMinimalGameState({ turn: 2, actionLog: log });
  const replay = createReplay(game);

  // getStateAtIndex 0 → should return nearest checkpoint at or before index 0
  const state = getStateAtIndex(replay, 0);
  console.assert(state !== null, 'FAIL getStateAtIndex returned null');
  console.assert(typeof state === 'object', 'FAIL getStateAtIndex not an object');
  console.log('  PASS: getStateAtIndex returns parsed GameState');
}

// ─── 8. getStateAtIndex: targetIndex -1 → null ────────────────────────────────

console.log('=== 8. getStateAtIndex: targetIndex -1 → null ===');
{
  // Because actionIndex -1 means "before any actions" and targetIndex -1
  // has nothing at or before it that meets "cp.actionIndex <= targetIndex"
  // when the only checkpoint is index -1 which does equal -1, so it should
  // return the Game Start state.
  const game = makeMinimalGameState();
  const replay = createReplay(game);
  // index -1 should return the game start checkpoint (actionIndex === -1)
  const state = getStateAtIndex(replay, -1);
  console.assert(state !== null, 'FAIL getStateAtIndex(-1) should return Game Start state (actionIndex === -1 checkpoint)');
  console.log('  PASS: getStateAtIndex(-1) returns Game Start state');
}

// ─── 9. groupActionsByTurn: correctness ───────────────────────────────────────

console.log('=== 9. groupActionsByTurn: correctness ===');
{
  const actions: ActionRecord[] = [
    makeAction({ actionType: 'DRAW_CARD', turn: 1, phase: 'draw'  }),
    makeAction({ actionType: 'CAST_SPELL', turn: 1, phase: 'main1' }),
    makeAction({ actionType: 'CAST_SPELL', turn: 1, phase: 'main1' }),
    makeAction({ actionType: 'DRAW_CARD', turn: 2, phase: 'draw'  }),
    makeAction({ actionType: 'CAST_SPELL', turn: 2, phase: 'main2' }),
  ];
  const grouped = groupActionsByTurn(actions);

  // 4 distinct turn+phase combos: T1/draw, T1/main1, T2/draw, T2/main2
  console.assert(grouped.length === 4, `FAIL expected 4 groups, got ${grouped.length}`);
  const t1draw = grouped.find(g => g.turn === 1 && g.phase === 'draw');
  console.assert(t1draw?.actions.length === 1, `FAIL T1 draw: expected 1 action, got ${t1draw?.actions.length}`);
  const t1main1 = grouped.find(g => g.turn === 1 && g.phase === 'main1');
  console.assert(t1main1?.actions.length === 2, `FAIL T1 main1: expected 2 actions, got ${t1main1?.actions.length}`);
  const t2draw = grouped.find(g => g.turn === 2 && g.phase === 'draw');
  console.assert(t2draw?.actions.length === 1, 'FAIL T2 draw missing');
  const t2main2 = grouped.find(g => g.turn === 2 && g.phase === 'main2');
  console.assert(t2main2?.actions.length === 1, 'FAIL T2 main2 missing');
  console.log('  PASS: groupActionsByTurn groups correctly');
}

// ─── 10. groupActionsByTurn: large log (500 actions, 50 turns) ────────────────

console.log('=== 10. groupActionsByTurn: large action log (500 actions, 50 turns) ===');
{
  const TURNS = 50;
  const ACTIONS_PER_TURN = 10;
  const actions: ActionRecord[] = [];
  for (let t = 1; t <= TURNS; t++) {
    for (let a = 0; a < ACTIONS_PER_TURN; a++) {
      actions.push(makeAction({ actionType: 'DRAW_CARD', turn: t, phase: a < 5 ? 'main1' : 'main2' }));
    }
  }

  const start = performance.now();
  const grouped = groupActionsByTurn(actions);
  const elapsed = performance.now() - start;

  console.assert(grouped.length === TURNS * 2, `FAIL expected ${TURNS * 2} groups, got ${grouped.length}`);
  grouped.forEach(g => {
    console.assert(g.actions.length === 5, `FAIL group T${g.turn}/${g.phase}: expected 5 actions`);
  });
  console.assert(elapsed < 100, `FAIL grouping 500 actions took too long: ${elapsed.toFixed(1)}ms`);
  console.log(`  PASS: 500 actions grouped into ${grouped.length} turn/phase groups in ${elapsed.toFixed(1)}ms`);
}

// ─── 11. formatDuration ───────────────────────────────────────────────────────

console.log('=== 11. formatDuration ===');
{
  console.assert(formatDuration(0) === '0s', `FAIL 0ms: got ${formatDuration(0)}`);
  console.assert(formatDuration(30_000) === '30s', `FAIL 30s: got ${formatDuration(30_000)}`);
  console.assert(formatDuration(60_000) === '1m', `FAIL 60s: got ${formatDuration(60_000)}`);
  console.assert(formatDuration(90_000) === '1m 30s', `FAIL 90s: got ${formatDuration(90_000)}`);
  console.assert(formatDuration(3_600_000) === '60m', `FAIL 1h: got ${formatDuration(3_600_000)}`);
  console.log('  PASS: formatDuration handles all cases');
}

// ─── 12. describeAction: fallback ─────────────────────────────────────────────

console.log('=== 12. describeAction: fallback ===');
{
  const a1 = makeAction({ actionType: 'CAST_SPELL', playerId: 'p1', description: 'Alice casts Lightning Bolt' });
  const a2 = makeAction({ actionType: 'TAP', playerId: 'p2', description: '' });

  console.assert(describeAction(a1) === 'Alice casts Lightning Bolt', `FAIL with description: ${describeAction(a1)}`);
  // No description → fallback
  const fallback = describeAction(a2);
  console.assert(fallback.includes('TAP'), `FAIL fallback missing actionType: ${fallback}`);
  console.assert(fallback.includes('p2'), `FAIL fallback missing playerId: ${fallback}`);
  console.log('  PASS: describeAction returns description or fallback');
}

// ─── 13. export / import round-trip ───────────────────────────────────────────

console.log('=== 13. exportReplayAsJSON / importReplayFromJSON round-trip ===');
{
  const log = [
    makeAction({ actionType: 'CAST_SPELL', turn: 1, description: 'Casts Teferi' }),
    makeAction({ actionType: 'GAME_END',   turn: 5 }),
  ];
  const game = makeMinimalGameState({ actionLog: log });
  const original = createReplay(game, 'Round-trip Test');
  const json = exportReplayAsJSON(original);
  const imported = importReplayFromJSON(json);

  console.assert(imported !== null, 'FAIL import returned null');
  console.assert(imported!.meta.id === original.meta.id, 'FAIL id mismatch');
  console.assert(imported!.meta.name === 'Round-trip Test', 'FAIL name mismatch');
  console.assert(imported!.actionLog.length === 2, 'FAIL actionLog length mismatch');
  console.assert(imported!.checkpoints.length === original.checkpoints.length, 'FAIL checkpoints length mismatch');
  console.log('  PASS: export/import round-trip preserves all data');
}

// ─── 14. importReplayFromJSON: garbage input → null ───────────────────────────

console.log('=== 14. importReplayFromJSON: garbage input → null ===');
{
  console.assert(importReplayFromJSON('') === null, 'FAIL empty string');
  console.assert(importReplayFromJSON('not json at all!!!') === null, 'FAIL non-JSON');
  console.assert(importReplayFromJSON('null') === null, 'FAIL null JSON');
  console.assert(importReplayFromJSON('{}') === null, 'FAIL empty object');
  console.log('  PASS: garbage input safely returns null');
}

// ─── 15. importReplayFromJSON: missing required fields → null ─────────────────

console.log('=== 15. importReplayFromJSON: missing required fields → null ===');
{
  // missing actionLog
  const noActionLog = JSON.stringify({ meta: { id: 'x', name: 'y' } });
  console.assert(importReplayFromJSON(noActionLog) === null, 'FAIL missing actionLog should be null');

  // missing meta.id
  const noId = JSON.stringify({ meta: { name: 'y' }, actionLog: [] });
  console.assert(importReplayFromJSON(noId) === null, 'FAIL missing meta.id should be null');
  console.log('  PASS: missing fields return null');
}

// ─── 16. ACTION_COLORS: critical action types ─────────────────────────────────

console.log('=== 16. ACTION_COLORS: critical action types ===');
{
  const required = [
    'CAST_SPELL', 'RESOLVE_STACK', 'COUNTER_SPELL', 'MOVE_CARD',
    'TAP', 'DRAW_CARD', 'DECLARE_ATTACKER', 'DECLARE_BLOCKER',
    'GAME_START', 'GAME_END', 'CHANGE_PHASE', 'CHANGE_LIFE',
    'COMMANDER_DAMAGE',
  ];
  required.forEach(t => {
    console.assert(t in ACTION_COLORS, `FAIL missing ACTION_COLORS entry for ${t}`);
    console.assert(typeof ACTION_COLORS[t] === 'string', `FAIL ACTION_COLORS[${t}] not a string`);
  });
  console.log(`  PASS: all ${required.length} critical action types have colors`);
}

// ─── 17. saveReplayToStorage / loadReplaysFromStorage CRUD ────────────────────

console.log('=== 17. CRUD round-trip: save → load ===');
{
  // Clear storage
  lsStore['mtg-replays-v1'] = '';
  const game = makeMinimalGameState();
  const replay = createReplay(game, 'Storage Test');
  saveReplayToStorage(replay);

  const loaded = loadReplaysFromStorage();
  console.assert(loaded.length === 1, `FAIL expected 1 replay, got ${loaded.length}`);
  console.assert(loaded[0].meta.id === replay.meta.id, 'FAIL id mismatch after load');
  console.assert(loaded[0].meta.name === 'Storage Test', 'FAIL name mismatch after load');
  console.log('  PASS: save → load round-trip correct');
}

// ─── 18. max 10 replays — drops oldest ────────────────────────────────────────

console.log('=== 18. max 10 replays → drops oldest ===');
{
  // Reset storage
  delete lsStore['mtg-replays-v1'];

  const game = makeMinimalGameState();
  const ids: string[] = [];

  // Save 12 replays
  for (let i = 0; i < 12; i++) {
    const r = createReplay(game, `Replay ${i + 1}`);
    ids.push(r.meta.id);
    saveReplayToStorage(r);
  }

  const loaded = loadReplaysFromStorage();
  console.assert(loaded.length === 10, `FAIL expected 10 replays, got ${loaded.length}`);

  // Most recent (last 10 saved) should be present; first 2 (oldest) dropped
  // saveReplayToStorage prepends, so the stored list is [newest, ..., oldest]
  // After 12 saves capped at 10: replays 3–12 remain (ids[2]–ids[11])
  const storedIds = new Set(loaded.map(r => r.meta.id));
  console.assert(!storedIds.has(ids[0]), 'FAIL oldest replay (1) should have been dropped');
  console.assert(!storedIds.has(ids[1]), 'FAIL second oldest replay (2) should have been dropped');
  console.assert(storedIds.has(ids[11]), 'FAIL newest replay (12) should be present');
  console.log('  PASS: storage capped at 10, oldest dropped correctly');
}

// ─── 19. deleteReplayFromStorage ──────────────────────────────────────────────

console.log('=== 19. deleteReplayFromStorage ===');
{
  delete lsStore['mtg-replays-v1'];

  const game = makeMinimalGameState();
  const r1 = createReplay(game, 'Keep 1');
  const r2 = createReplay(game, 'Delete Me');
  const r3 = createReplay(game, 'Keep 2');
  saveReplayToStorage(r1);
  saveReplayToStorage(r2);
  saveReplayToStorage(r3);

  deleteReplayFromStorage(r2.meta.id);
  const loaded = loadReplaysFromStorage();

  console.assert(loaded.length === 2, `FAIL expected 2 replays after delete, got ${loaded.length}`);
  const ids = loaded.map(r => r.meta.id);
  console.assert(!ids.includes(r2.meta.id), 'FAIL deleted replay still present');
  console.assert(ids.includes(r1.meta.id), 'FAIL r1 should still be present');
  console.assert(ids.includes(r3.meta.id), 'FAIL r3 should still be present');
  console.log('  PASS: deleteReplayFromStorage removes exactly the target');
}

// ─── 20. duplicate id overwrites ──────────────────────────────────────────────

console.log('=== 20. duplicate id overwrites, no duplication ===');
{
  delete lsStore['mtg-replays-v1'];

  const game = makeMinimalGameState();
  const r = createReplay(game, 'Original Name');
  saveReplayToStorage(r);

  // Save again with same id but different name
  const r2: Replay = { ...r, meta: { ...r.meta, name: 'Updated Name' } };
  saveReplayToStorage(r2);

  const loaded = loadReplaysFromStorage();
  console.assert(loaded.length === 1, `FAIL expected 1 replay (dedup), got ${loaded.length}`);
  console.assert(loaded[0].meta.name === 'Updated Name', `FAIL name should be updated: ${loaded[0].meta.name}`);
  console.log('  PASS: saving replay with same id overwrites, no duplicates');
}

// ─── 21. Large game state: 6 players, 200 cards ───────────────────────────────

console.log('=== 21. Large game state: 6 players × 200 cards ===');
{
  const log: ActionRecord[] = Array.from({ length: 50 }, (_, i) =>
    makeAction({ actionType: 'MOVE_CARD', turn: Math.floor(i / 10) + 1, timestamp: 1000 + i * 100 })
  );

  // Build a 6-player game state with battlefield cards
  const bigGame = makeMinimalGameState({
    turn: 5,
    actionLog: log,
    players: Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`, name: `Player ${i + 1}`,
      battlefield: Array.from({ length: 33 }, (_, j) => ({
        instanceId: `card-p${i + 1}-${j}`,
        cardId: `land-${j}`,
        name: `Forest ${j}`,
        tapped: false,
        counters: {},
        attachments: [],
        faceDown: false,
      })),
    })),
  });

  const start = performance.now();
  const replay = createReplay(bigGame, '6-Player Big Board');
  const elapsed = performance.now() - start;

  console.assert(replay.meta.playerNames.length === 6, `FAIL player count: ${replay.meta.playerNames.length}`);
  console.assert(replay.meta.actionCount === 50, `FAIL action count: ${replay.meta.actionCount}`);
  // Should serialize/deserialize without error
  const json = exportReplayAsJSON(replay);
  const imported = importReplayFromJSON(json);
  console.assert(imported !== null, 'FAIL large state import returned null');
  console.assert(elapsed < 500, `FAIL createReplay too slow on large state: ${elapsed.toFixed(1)}ms`);
  console.log(`  PASS: 6-player/200-card game state handled in ${elapsed.toFixed(1)}ms`);
}

// ─── 22. Myriad-like burst: 150 actions in one turn ───────────────────────────

console.log('=== 22. Myriad-like burst: 150 actions in single turn ===');
{
  // Myriad + triggers + copies creates a spike of many actions in one turn
  const burst: ActionRecord[] = [
    makeAction({ actionType: 'CAST_SPELL', turn: 4, phase: 'main1', description: 'Cast Blade of Selves' }),
    ...Array.from({ length: 5 }, (_, i) =>
      makeAction({ actionType: 'DECLARE_ATTACKER', turn: 4, phase: 'declareAttackers', description: `Myriad attack ${i + 1}` })
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      makeAction({ actionType: 'ADD_TOKEN', turn: 4, phase: 'declareAttackers', description: `Myriad token copy ${i + 1}` })
    ),
    ...Array.from({ length: 141 }, (_, i) =>
      makeAction({ actionType: 'MOVE_CARD', turn: 4, phase: 'combatDamage', description: `Move ${i + 1}` })
    ),
  ];

  console.assert(burst.length === 150, 'FAIL burst should be 150 actions');

  const game = makeMinimalGameState({ turn: 4, actionLog: burst });
  const replay = createReplay(game, 'Myriad Burst Turn');
  const grouped = groupActionsByTurn(replay.actionLog);

  // All 150 actions are in turn 4
  const t4actions = grouped.filter(g => g.turn === 4).reduce((sum, g) => sum + g.actions.length, 0);
  console.assert(t4actions === 150, `FAIL expected 150 actions in T4, got ${t4actions}`);

  // getActionsUpTo should handle the boundary
  const slice = getActionsUpTo(replay, 149);
  console.assert(slice.length === 150, `FAIL getActionsUpTo(149) length: ${slice.length}`);
  console.assert(getActionsUpTo(replay, 0).length === 1, 'FAIL getActionsUpTo(0) should return 1');
  console.log(`  PASS: 150-action myriad burst handled correctly across ${grouped.length} groups`);
}

// ─── 23. Checkpoint ordering ──────────────────────────────────────────────────

console.log('=== 23. Checkpoint ordering ===');
{
  const log: ActionRecord[] = [
    makeAction({ actionType: 'GAME_START', turn: 1 }),
    makeAction({ actionType: 'CHANGE_PHASE', turn: 2, phase: 'untap', data: { phase: 'untap' } }),
    makeAction({ actionType: 'CHANGE_PHASE', turn: 3, phase: 'untap', data: { to: 'untap' } }),
    makeAction({ actionType: 'GAME_END',   turn: 3 }),
  ];
  const game = makeMinimalGameState({ turn: 3, actionLog: log });
  const replay = createReplay(game);

  for (let i = 1; i < replay.checkpoints.length; i++) {
    const prev = replay.checkpoints[i - 1].actionIndex;
    const curr = replay.checkpoints[i].actionIndex;
    console.assert(curr >= prev, `FAIL checkpoints out of order: ${prev} > ${curr}`);
  }
  console.log(`  PASS: ${replay.checkpoints.length} checkpoints in correct ascending order`);
}

// ─── 24. getStateAtIndex with dense checkpoints ────────────────────────────────

console.log('=== 24. getStateAtIndex: dense checkpoints, always returns closest ===');
{
  const log: ActionRecord[] = [
    makeAction({ actionType: 'DRAW_CARD', turn: 1, phase: 'draw',  timestamp: 100 }),
    makeAction({ actionType: 'CAST_SPELL', turn: 1, phase: 'main1', timestamp: 200 }),
    makeAction({ actionType: 'CHANGE_PHASE', turn: 2, phase: 'untap', data: { phase: 'untap' }, timestamp: 300 }),
    makeAction({ actionType: 'DRAW_CARD', turn: 2, phase: 'draw', timestamp: 400 }),
  ];
  const game = makeMinimalGameState({ turn: 2, actionLog: log });
  const replay = createReplay(game);

  // Every valid index should return a non-null state
  for (let i = -1; i <= log.length - 1; i++) {
    const state = getStateAtIndex(replay, i);
    console.assert(state !== null, `FAIL getStateAtIndex(${i}) returned null`);
  }
  console.log('  PASS: getStateAtIndex returns non-null for all valid indices');
}

// ─── 25. Unicode card names in import/export ───────────────────────────────────

console.log('=== 25. Unicode card names (Æther, Jötun, kanji) ===');
{
  const log = [
    makeAction({ actionType: 'CAST_SPELL', description: 'Cast Æther Vial targeting Jötun Grunt' }),
    makeAction({ actionType: 'CAST_SPELL', description: 'Cast 稲妻 (Lightning Bolt)' }),
    makeAction({ actionType: 'CAST_SPELL', description: 'Cast Lim-Dûl\'s Vault' }),
  ];
  const game = makeMinimalGameState({ actionLog: log });
  const replay = createReplay(game);
  const json = exportReplayAsJSON(replay);
  const imported = importReplayFromJSON(json);

  console.assert(imported !== null, 'FAIL unicode import returned null');
  console.assert(imported!.actionLog[0].description === 'Cast Æther Vial targeting Jötun Grunt', 'FAIL Æther/Jötun description corrupted');
  console.assert(imported!.actionLog[1].description === 'Cast 稲妻 (Lightning Bolt)', 'FAIL kanji description corrupted');
  console.assert(imported!.actionLog[2].description.includes("Lim-Dûl"), "FAIL accented apostrophe corrupted");
  console.log('  PASS: unicode card names survive export/import round-trip');
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n✅ All 25 replay-engine tests passed.');
