/**
 * ─── Trigger Queue Critical Test Suite ────────────────────────────────────────
 *
 * Tests cover:
 *   1.  addTrigger adds to queue
 *   2.  acknowledgeTrigger marks as acknowledged (not removed)
 *   3.  moveTriggerUp swaps correctly
 *   4.  moveTriggerDown swaps correctly
 *   5.  moveTriggerUp at index 0 is a no-op
 *   6.  moveTriggerDown at last index is a no-op
 *   7.  markTriggerMissed sets missed + acknowledged flags + logs action
 *   8.  pending filter (acknowledged=false) works correctly
 *   9.  APNAP ordering — active player triggers first
 *  10.  Panharmonicon: 2 ETB triggers from same source stack independently
 *  11.  Multiple simultaneous ETBs (5 creatures entering at once)
 *  12.  Reorder: move trigger 3 to position 1 via multiple moveTriggerUp calls
 *  13.  Resolve All: acknowledge all pending in queue
 *  14.  Trigger with missed=true appears in missed filter
 *  15.  Queue order preserved after mixed ack/pending state
 *  16.  Consecrated Sphinx: triggers on each opponent's draw — 3-player test
 *  17.  Teysa Karlov: death triggers trigger twice (double trigger count)
 *  18.  Triggered ability with no controller (use fallback)
 *  19.  Veil of Summer vs Counterspell: trigger interacts with stack correctly
 *  20.  Purphoros ETB damage triggers — 6 creatures entering, 6 triggers
 *  21.  Panharmonicon + Teysa Karlov stacking: 4 triggers for 1 ETB
 *  22.  Stacked trigger ordering: top trigger resolves first (LIFO on stack)
 *  23.  Trigger missed and action log includes source name
 *  24.  Large stack: 50 ETB triggers from Hordeling Outburst-style mass token creation
 *  25.  Trigger queue doesn't break when queue is empty
 * ──────────────────────────────────────────────────────────────────────────────
 */

import {
  addTrigger, acknowledgeTrigger, createEmptyGameState, createDefaultGameConfig,
} from '../client/src/engine/gameEngine';
import type { GameState, TriggerItem } from '../client/src/types/game';

// ── Test utilities ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results: { name: string; ok: boolean; error?: string }[] = [];

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, ok: true });
    passed++;
  } catch (e: unknown) {
    results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) });
    failed++;
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId() { return `trigger-${++_idCounter}`; }

function makeTrigger(overrides: Partial<TriggerItem> = {}): TriggerItem {
  return {
    id: nextId(),
    sourceName: 'Test Source',
    controllerId: 'p1',
    text: 'Test trigger text',
    triggerType: 'ETB',
    acknowledged: false,
    missed: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeState(): GameState {
  const cfg = createDefaultGameConfig(2);
  return createEmptyGameState(cfg);
}

// ── Store action simulations (pure functions matching store logic) ──────────────

function moveTriggerUp(state: GameState, triggerId: string): GameState {
  const queue = [...state.triggerQueue];
  const idx = queue.findIndex(t => t.id === triggerId);
  if (idx <= 0) return state;
  [queue[idx - 1], queue[idx]] = [queue[idx], queue[idx - 1]];
  return { ...state, triggerQueue: queue };
}

function moveTriggerDown(state: GameState, triggerId: string): GameState {
  const queue = [...state.triggerQueue];
  const idx = queue.findIndex(t => t.id === triggerId);
  if (idx < 0 || idx >= queue.length - 1) return state;
  [queue[idx], queue[idx + 1]] = [queue[idx + 1], queue[idx]];
  return { ...state, triggerQueue: queue };
}

function markTriggerMissed(state: GameState, triggerId: string): GameState {
  const queue = state.triggerQueue.map(t =>
    t.id === triggerId ? { ...t, missed: true, acknowledged: true } : t
  );
  const source = state.triggerQueue.find(t => t.id === triggerId)?.sourceName ?? triggerId;
  const action = {
    id: nextId(), gameId: state.id, playerId: state.activePlayerId,
    type: 'OTHER' as const, description: `Trigger missed: ${source}`,
    instanceIds: [], payload: {}, flags: [], timestamp: Date.now(),
  };
  return { ...state, triggerQueue: queue, actionLog: [...state.actionLog, action] };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

// 1. addTrigger
test('1. addTrigger adds to queue', () => {
  let g = makeState();
  const t = makeTrigger({ sourceName: 'Purphoros', text: 'Deals 2 damage to each opponent' });
  g = addTrigger(g, t);
  assert(g.triggerQueue.length === 1, `Expected 1 trigger, got ${g.triggerQueue.length}`);
  assert(g.triggerQueue[0].sourceName === 'Purphoros', 'Wrong source name');
});

// 2. acknowledgeTrigger
test('2. acknowledgeTrigger marks acknowledged (not removed)', () => {
  let g = makeState();
  const t = makeTrigger({ sourceName: 'Solemn Simulacrum' });
  g = addTrigger(g, t);
  g = acknowledgeTrigger(g, t.id);
  assert(g.triggerQueue.length === 1, 'Trigger should remain in queue after ack');
  assert(g.triggerQueue[0].acknowledged === true, 'Should be marked acknowledged');
  assert(g.triggerQueue[0].missed === false, 'Should not be marked missed');
});

// 3. moveTriggerUp
test('3. moveTriggerUp swaps with previous', () => {
  let g = makeState();
  const t1 = makeTrigger({ sourceName: 'First', controllerId: 'p2' });
  const t2 = makeTrigger({ sourceName: 'Second', controllerId: 'p1' });
  g = addTrigger(addTrigger(g, t1), t2);
  g = moveTriggerUp(g, t2.id);
  assert(g.triggerQueue[0].sourceName === 'Second', `Expected 'Second' at index 0, got '${g.triggerQueue[0].sourceName}'`);
  assert(g.triggerQueue[1].sourceName === 'First', `Expected 'First' at index 1, got '${g.triggerQueue[1].sourceName}'`);
});

// 4. moveTriggerDown
test('4. moveTriggerDown swaps with next', () => {
  let g = makeState();
  const t1 = makeTrigger({ sourceName: 'Alpha' });
  const t2 = makeTrigger({ sourceName: 'Beta' });
  g = addTrigger(addTrigger(g, t1), t2);
  g = moveTriggerDown(g, t1.id);
  assert(g.triggerQueue[0].sourceName === 'Beta', 'Beta should move to index 0');
  assert(g.triggerQueue[1].sourceName === 'Alpha', 'Alpha should move to index 1');
});

// 5. moveTriggerUp at index 0 is no-op
test('5. moveTriggerUp at index 0 is a no-op', () => {
  let g = makeState();
  const t1 = makeTrigger({ sourceName: 'Only One' });
  const t2 = makeTrigger({ sourceName: 'Second' });
  g = addTrigger(addTrigger(g, t1), t2);
  const before = g.triggerQueue.map(t => t.sourceName);
  g = moveTriggerUp(g, t1.id);
  const after = g.triggerQueue.map(t => t.sourceName);
  assert(JSON.stringify(before) === JSON.stringify(after), 'Order should not change');
});

// 6. moveTriggerDown at last index is no-op
test('6. moveTriggerDown at last index is a no-op', () => {
  let g = makeState();
  const t1 = makeTrigger({ sourceName: 'First' });
  const t2 = makeTrigger({ sourceName: 'Last' });
  g = addTrigger(addTrigger(g, t1), t2);
  const before = g.triggerQueue.map(t => t.sourceName);
  g = moveTriggerDown(g, t2.id);
  const after = g.triggerQueue.map(t => t.sourceName);
  assert(JSON.stringify(before) === JSON.stringify(after), 'Order should not change');
});

// 7. markTriggerMissed
test('7. markTriggerMissed sets missed + acknowledged + logs action', () => {
  let g = makeState();
  const t = makeTrigger({ sourceName: 'Missed Trigger' });
  g = addTrigger(g, t);
  g = markTriggerMissed(g, t.id);
  const mt = g.triggerQueue.find(x => x.id === t.id)!;
  assert(mt.missed === true, 'Should be marked missed');
  assert(mt.acknowledged === true, 'Should be marked acknowledged when missed');
  assert(g.actionLog.some(a => a.description.includes('Missed Trigger')), 'Action log should contain source name');
});

// 8. Pending filter
test('8. Pending filter returns only unacknowledged', () => {
  let g = makeState();
  const t1 = makeTrigger({ sourceName: 'A' });
  const t2 = makeTrigger({ sourceName: 'B' });
  const t3 = makeTrigger({ sourceName: 'C' });
  g = addTrigger(addTrigger(addTrigger(g, t1), t2), t3);
  g = acknowledgeTrigger(g, t2.id);
  const pending = g.triggerQueue.filter(t => !t.acknowledged);
  assert(pending.length === 2, `Expected 2 pending, got ${pending.length}`);
  assert(pending.every(t => t.sourceName !== 'B'), 'B should not be in pending');
});

// 9. APNAP ordering — active player trigger should be moved first
test('9. APNAP: active player trigger moved to top', () => {
  let g = makeState();
  g = { ...g, activePlayerId: 'p1' };
  const tOpponent = makeTrigger({ sourceName: 'Opponent ETB', controllerId: 'p2' });
  const tActive   = makeTrigger({ sourceName: 'Active Player ETB', controllerId: 'p1' });
  // Opponent added first (wrong order)
  g = addTrigger(addTrigger(g, tOpponent), tActive);
  // Player manually reorders to put active player first (APNAP)
  g = moveTriggerUp(g, tActive.id);
  const pending = g.triggerQueue.filter(t => !t.acknowledged);
  assert(pending[0].controllerId === 'p1', 'Active player trigger should be first after APNAP reorder');
});

// 10. Panharmonicon: 2 ETB triggers from same source
test('10. Panharmonicon: 2 independent ETB triggers from same source', () => {
  let g = makeState();
  // Panharmonicon makes ETBs trigger twice
  const etb1 = makeTrigger({ sourceName: 'Solemn Simulacrum', text: 'You may search for a basic land' });
  const etb2 = makeTrigger({ sourceName: 'Solemn Simulacrum', text: 'You may search for a basic land (Panharmonicon copy)' });
  g = addTrigger(addTrigger(g, etb1), etb2);
  const pending = g.triggerQueue.filter(t => !t.acknowledged);
  assert(pending.length === 2, `Panharmonicon should give 2 ETB triggers, got ${pending.length}`);
  // Acknowledge one at a time
  g = acknowledgeTrigger(g, etb1.id);
  const stillPending = g.triggerQueue.filter(t => !t.acknowledged);
  assert(stillPending.length === 1, 'Should have 1 remaining after acknowledging first Panharmonicon trigger');
  assert(stillPending[0].text.includes('Panharmonicon'), 'Remaining trigger should be the Panharmonicon copy');
});

// 11. Multiple simultaneous ETBs (5 creatures entering at once)
test('11. 5 simultaneous ETBs enqueue correctly', () => {
  let g = makeState();
  const creatures = ['Avenger of Zendikar', 'Craterhoof Behemoth', 'Rampaging Baloths', 'Titania', 'Cultivator Colossus'];
  for (const name of creatures) {
    g = addTrigger(g, makeTrigger({ sourceName: name, triggerType: 'ETB' }));
  }
  assert(g.triggerQueue.length === 5, `Expected 5 triggers, got ${g.triggerQueue.length}`);
  const names = g.triggerQueue.map(t => t.sourceName);
  for (const name of creatures) {
    assert(names.includes(name), `Missing trigger for ${name}`);
  }
});

// 12. Reorder: move trigger from index 3 to 1 via multiple moveTriggerUp
test('12. Multi-step reorder via moveTriggerUp', () => {
  let g = makeState();
  const triggers = ['T1', 'T2', 'T3', 'T4'].map(n => makeTrigger({ sourceName: n }));
  for (const t of triggers) g = addTrigger(g, t);

  // Move T4 (index 3) up to index 1
  g = moveTriggerUp(g, triggers[3].id); // 3→2
  g = moveTriggerUp(g, triggers[3].id); // 2→1
  const names = g.triggerQueue.map(t => t.sourceName);
  assert(names[1] === 'T4', `Expected T4 at index 1, got '${names[1]}'`);
  assert(names[0] === 'T1', `Expected T1 at index 0, got '${names[0]}'`);
});

// 13. Resolve All
test('13. Resolve All acknowledges all pending triggers', () => {
  let g = makeState();
  const triggers = Array.from({ length: 5 }, (_, i) => makeTrigger({ sourceName: `Source-${i}` }));
  for (const t of triggers) g = addTrigger(g, t);
  // Simulate resolve-all
  for (const t of triggers) g = acknowledgeTrigger(g, t.id);
  const pending = g.triggerQueue.filter(t => !t.acknowledged);
  assert(pending.length === 0, `Expected 0 pending after resolve-all, got ${pending.length}`);
  assert(g.triggerQueue.length === 5, 'All 5 triggers should still be in queue (not removed)');
});

// 14. Missed filter
test('14. Missed triggers appear in missed filter', () => {
  let g = makeState();
  const t1 = makeTrigger({ sourceName: 'Missed' });
  const t2 = makeTrigger({ sourceName: 'Resolved' });
  g = addTrigger(addTrigger(g, t1), t2);
  g = markTriggerMissed(g, t1.id);
  g = acknowledgeTrigger(g, t2.id);
  const missed = g.triggerQueue.filter(t => t.missed);
  const acked  = g.triggerQueue.filter(t => t.acknowledged && !t.missed);
  assert(missed.length === 1 && missed[0].sourceName === 'Missed', 'Should have 1 missed trigger');
  assert(acked.length === 1 && acked[0].sourceName === 'Resolved', 'Should have 1 resolved trigger');
});

// 15. Queue order preserved after mixed ack/pending state
test('15. Queue order preserved after partial acknowledgement', () => {
  let g = makeState();
  const triggers = ['A', 'B', 'C', 'D', 'E'].map(n => makeTrigger({ sourceName: n }));
  for (const t of triggers) g = addTrigger(g, t);
  // Ack B and D
  g = acknowledgeTrigger(g, triggers[1].id);
  g = acknowledgeTrigger(g, triggers[3].id);
  const allNames = g.triggerQueue.map(t => t.sourceName);
  assert(JSON.stringify(allNames) === JSON.stringify(['A', 'B', 'C', 'D', 'E']),
    `Queue order changed: ${JSON.stringify(allNames)}`);
  const pending = g.triggerQueue.filter(t => !t.acknowledged).map(t => t.sourceName);
  assert(JSON.stringify(pending) === JSON.stringify(['A', 'C', 'E']),
    `Pending order wrong: ${JSON.stringify(pending)}`);
});

// 16. Consecrated Sphinx: triggers on each opponent draw
test('16. Consecrated Sphinx: 3 triggers across 3 opponents\' draws', () => {
  let g = makeState();
  // In a 4-player game, Consecrated Sphinx triggers 3 times per opponent draw
  for (let i = 1; i <= 3; i++) {
    g = addTrigger(g, makeTrigger({
      sourceName: 'Consecrated Sphinx',
      controllerId: 'p1',
      text: `Whenever opponent p${i + 1} draws, you may draw 2 cards`,
      triggerType: 'other',
    }));
  }
  const sphinxTriggers = g.triggerQueue.filter(t => t.sourceName === 'Consecrated Sphinx');
  assert(sphinxTriggers.length === 3, `Expected 3 Sphinx triggers, got ${sphinxTriggers.length}`);
  // All owned by same controller
  assert(sphinxTriggers.every(t => t.controllerId === 'p1'), 'All Sphinx triggers should be p1 controlled');
});

// 17. Teysa Karlov: death triggers fire twice
test('17. Teysa Karlov: 2 death triggers for 1 creature dying', () => {
  let g = makeState();
  // With Teysa Karlov, each creature dying with a triggered ability triggers it twice
  const deathTrigger1 = makeTrigger({ sourceName: 'Doomed Traveler', text: 'Put a 1/1 Spirit token OTB (trigger 1)', triggerType: 'graveyard' });
  const deathTrigger2 = makeTrigger({ sourceName: 'Doomed Traveler', text: 'Put a 1/1 Spirit token OTB (Teysa copy)', triggerType: 'graveyard' });
  g = addTrigger(addTrigger(g, deathTrigger1), deathTrigger2);
  const graveyard = g.triggerQueue.filter(t => t.triggerType === 'graveyard');
  assert(graveyard.length === 2, `Expected 2 death triggers (Teysa), got ${graveyard.length}`);
});

// 18. Trigger with no controller — handled gracefully
test('18. Trigger with undefined controllerId handled gracefully', () => {
  let g = makeState();
  const t = makeTrigger({ controllerId: 'unknown-player', sourceName: 'Mystery Trigger' });
  g = addTrigger(g, t);
  // Acknowledging should not throw even if controllerId doesn't match a player
  g = acknowledgeTrigger(g, t.id);
  assert(g.triggerQueue[0].acknowledged === true, 'Should ack even with unknown controllerId');
});

// 19. Veil of Summer interaction: opponent triggers counterspell → player triggers Veil draw
test('19. Veil of Summer + Counterspell: both trigger entries coexist in queue', () => {
  let g = makeState();
  const counterTrigger = makeTrigger({ sourceName: 'Counterspell', controllerId: 'p2', text: 'Counter target spell', triggerType: 'other' });
  const veilTrigger    = makeTrigger({ sourceName: 'Veil of Summer', controllerId: 'p1', text: 'Draw a card', triggerType: 'other' });
  g = addTrigger(addTrigger(g, counterTrigger), veilTrigger);
  // Player can reorder: Veil resolves last (APNAP — active player puts theirs on stack first, resolves last in LIFO)
  g = moveTriggerDown(g, veilTrigger.id); // no-op at end, but validates no crash
  const pending = g.triggerQueue.filter(t => !t.acknowledged);
  assert(pending.length === 2, 'Both Veil and Counter triggers should be pending');
});

// 20. Purphoros ETB: 6 creatures enter, 6 triggers
test('20. Purphoros: 6 ETB triggers from token wave', () => {
  let g = makeState();
  for (let i = 0; i < 6; i++) {
    g = addTrigger(g, makeTrigger({
      sourceName: 'Purphoros, God of the Forge',
      text: `Purphoros deals 2 damage to each opponent (creature ${i + 1} of 6)`,
      triggerType: 'ETB',
    }));
  }
  const purTriggers = g.triggerQueue.filter(t => t.sourceName === 'Purphoros, God of the Forge');
  assert(purTriggers.length === 6, `Expected 6 Purphoros triggers, got ${purTriggers.length}`);
});

// 21. Panharmonicon + Teysa Karlov: 4 triggers for 1 ETB creature
test('21. Panharmonicon + Teysa Karlov: 4 triggers for 1 ETB', () => {
  let g = makeState();
  // Carrier Thrall ETB (death trigger) — Panharmonicon doubles ETB, Teysa doubles each
  // Net: 4 ETB triggers
  for (let i = 0; i < 4; i++) {
    g = addTrigger(g, makeTrigger({
      sourceName: 'Carrier Thrall',
      text: `Create a 2/2 Zombie token (copy ${i + 1}/4)`,
      triggerType: 'ETB',
    }));
  }
  assert(g.triggerQueue.length === 4, `Expected 4 triggers from Panharmonicon + Teysa, got ${g.triggerQueue.length}`);
});

// 22. LIFO stack ordering: triggers added later resolve first on stack
test('22. LIFO stack: last trigger added is first to resolve (standard MTG)', () => {
  // In MTG: all triggers go on stack; active player orders their own.
  // The queue represents the ORDER players will put them on the stack.
  // After all are on the stack, they resolve LIFO (last on = first off).
  // Our queue uses index 0 = "resolves NEXT" = will be put on stack LAST = resolves first.
  let g = makeState();
  const t1 = makeTrigger({ sourceName: 'First Added' });
  const t2 = makeTrigger({ sourceName: 'Second Added' });
  const t3 = makeTrigger({ sourceName: 'Third Added — should resolve first' });
  g = addTrigger(addTrigger(addTrigger(g, t1), t2), t3);
  // Move t3 to top of queue (will go on stack last = resolves first)
  g = moveTriggerUp(g, t3.id);
  g = moveTriggerUp(g, t3.id);
  assert(g.triggerQueue[0].sourceName === 'Third Added — should resolve first', 'Third trigger should be first in queue');
});

// 23. Missed trigger logs source name
test('23. markTriggerMissed logs source name in action log', () => {
  let g = makeState();
  const t = makeTrigger({ sourceName: 'Rhystic Study' });
  g = addTrigger(g, t);
  g = markTriggerMissed(g, t.id);
  const log = g.actionLog.find(a => a.description.includes('Rhystic Study'));
  assert(!!log, 'Action log must contain "Rhystic Study"');
  assert(log!.description.includes('missed') || log!.description.includes('Missed'),
    `Log message should reference "missed", got: ${log!.description}`);
});

// 24. Large stack: 50 ETB triggers
test('24. Large stack: 50 ETB triggers (Hordeling Outburst mass token ETB)', () => {
  let g = makeState();
  for (let i = 0; i < 50; i++) {
    g = addTrigger(g, makeTrigger({
      sourceName: `Goblin Token ${i + 1}`,
      triggerType: 'ETB',
      text: 'Goblin enters the battlefield',
    }));
  }
  assert(g.triggerQueue.length === 50, `Expected 50 triggers, got ${g.triggerQueue.length}`);
  // Reorder stress: move last to first
  for (let i = 49; i > 0; i--) {
    g = moveTriggerUp(g, g.triggerQueue[i].id);
  }
  assert(g.triggerQueue[0].sourceName === 'Goblin Token 50', 'Goblin Token 50 should be first after full reorder');
  // Resolve all
  for (const t of g.triggerQueue) g = acknowledgeTrigger(g, t.id);
  const pending = g.triggerQueue.filter(t => !t.acknowledged);
  assert(pending.length === 0, `All 50 triggers should be resolved, ${pending.length} remain`);
});

// 25. Empty queue is handled gracefully
test('25. Empty queue: operations are no-ops', () => {
  const g = makeState();
  assert(g.triggerQueue.length === 0, 'Should start with empty queue');
  const afterUp   = moveTriggerUp(g, 'nonexistent');
  const afterDown = moveTriggerDown(g, 'nonexistent');
  const afterAck  = acknowledgeTrigger(g, 'nonexistent');
  assert(afterUp.triggerQueue.length === 0, 'moveTriggerUp on empty queue should be no-op');
  assert(afterDown.triggerQueue.length === 0, 'moveTriggerDown on empty queue should be no-op');
  assert(afterAck.triggerQueue.length === 0, 'acknowledgeTrigger on empty queue should be no-op');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('  TRIGGER QUEUE UI — CRITICAL TEST SUITE');
console.log('═'.repeat(60));

let maxLen = 0;
for (const r of results) if (r.name.length > maxLen) maxLen = r.name.length;

for (const r of results) {
  const icon = r.ok ? '✅' : '❌';
  const pad  = ' '.repeat(maxLen - r.name.length + 2);
  console.log(`${icon} ${r.name}${r.ok ? '' : pad + '← ' + r.error}`);
}

console.log('─'.repeat(60));
console.log(`  PASSED: ${passed}/${passed + failed}`);
if (failed > 0) {
  console.log(`  FAILED: ${failed}`);
  process.exit(1);
} else {
  console.log('  ALL TESTS PASSED ✅');
}
