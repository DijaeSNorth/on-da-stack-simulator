/**
 * Issue report link regression checks.
 *
 * Run with: npx tsx tests/issue-report.test.ts
 */

import { buildIssueReportBody, buildIssueReportUrl } from '../client/src/engine/issueReport';
import { createAction, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import type { GameState, StackObject, TriggerItem } from '../client/src/types/game';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function makeGame(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const players = [
    createPlayer('p1', 'Vial Pilot', 0, '#ef4444', config),
    createPlayer('p2', 'Dredge Pilot', 1, '#3b82f6', config),
  ];
  const stackItem: StackObject = {
    id: 'stack-1',
    type: 'triggered',
    sourceName: 'Vial Smasher the Fierce',
    controllerId: 'p1',
    text: 'Vial Smasher trigger',
    timestamp: Date.now(),
    targetLabels: ['random opponent'],
  };
  const trigger: TriggerItem = {
    id: 'trigger-1',
    sourceName: 'Vial Smasher the Fierce',
    controllerId: 'p1',
    text: 'Whenever you cast your first spell each turn, choose an opponent at random.',
    triggerType: 'cast',
    acknowledged: false,
    missed: false,
    timestamp: Date.now(),
  };
  const game = {
    ...base,
    players,
    activePlayerId: 'p1',
    priorityPlayerId: 'p2',
    turn: 4,
    phase: 'main1' as const,
    stack: [stackItem],
    triggerQueue: [trigger],
  };
  const action = createAction(game, 'p1', 'CAST', 'Cast Treasure Cruise', [], {
    assistantSummary: 'Vial Smasher trigger should be placed on the stack.',
  });
  return { ...game, actionLog: [action] };
}

const game = makeGame();
const judgeMessages = [{
  id: 'judge-1',
  timestamp: Date.now(),
  severity: 'warning',
  label: 'Needs Review',
  text: 'A trigger may have been missed.',
  turn: 4,
  phase: 'main1',
  ruleRef: 'CR 603',
}];

const body = buildIssueReportBody(game, judgeMessages, {
  pageUrl: 'http://localhost:5000/',
  userAgent: 'IssueReportTest/1.0',
  now: new Date('2026-06-06T12:00:00.000Z'),
});

assert(body.includes('## What happened?'), 'expected editable issue prompt');
assert(body.includes('- Turn: 4'), 'expected turn context');
assert(body.includes('- Phase: main1'), 'expected phase context');
assert(body.includes('Vial Pilot'), 'expected player context');
assert(body.includes('Vial Smasher the Fierce'), 'expected stack/trigger context');
assert(body.includes('Cast Treasure Cruise'), 'expected recent action context');
assert(body.includes('A trigger may have been missed.'), 'expected judge note context');
assert(body.includes('http://localhost:5000/'), 'expected page URL context');

const url = buildIssueReportUrl(game, judgeMessages, {
  pageUrl: 'http://localhost:5000/',
  userAgent: 'IssueReportTest/1.0',
  now: new Date('2026-06-06T12:00:00.000Z'),
});
const parsed = new URL(url);
assert(parsed.origin === 'https://github.com', 'expected GitHub issue origin');
assert(parsed.pathname === '/DijaeSNorth/on-da-stack-simulator/issues/new', 'expected repository issue path');
assert(parsed.searchParams.get('labels') === 'bug,player-report', 'expected report labels');
assert(parsed.searchParams.get('title') === 'Gameplay issue: turn 4 main1', 'expected useful issue title');
assert(parsed.searchParams.get('body')?.includes('Vial Smasher the Fierce'), 'expected encoded body context');

console.log('PASS issue report link includes useful GitHub context');
