import { createReplayFileFromGame } from '../client/src/engine/replayEngine';
import { useGameStore } from '../client/src/store/gameStore';
import type { ActionRecord, GameState } from '../client/src/types/game';
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

function makeAction(game: GameState, id: string, delta: number): ActionRecord {
  return {
    id,
    turn: 1,
    phase: 'main1',
    playerId: game.players[0]?.id ?? 'p1',
    actionType: 'CHANGE_LIFE',
    timestamp: Date.now(),
    description: `Life ${delta}`,
    affectedObjects: [],
    data: { playerId: game.players[0]?.id ?? 'p1', delta },
    flags: [],
    undone: false,
  };
}

function makeReplayFile(actionCount = 2): ReplayFile {
  if (useGameStore.getState().game.players.length === 0) {
    useGameStore.getState().initGame(useGameStore.getState().game.config, [
      { id: 'p1', name: 'Player A', color: '#3b82f6' },
      { id: 'p2', name: 'Player B', color: '#ef4444' },
    ]);
  }
  const game = useGameStore.getState().game;
  return {
    ...createReplayFileFromGame(game, {
      includePrivateZones: true,
      includeFinalSnapshot: false,
      redacted: false,
    }),
    replayVersion: '2.0.0',
    actionLog: Array.from({ length: actionCount }, (_, index) => makeAction(game, `r${index + 1}`, index % 2 === 0 ? -2 : 2)),
  };
}

async function main(): Promise<void> {
  await test('loadReplayFile enters replay screen', async () => {
    const ok = await useGameStore.getState().loadReplayFile(makeReplayFile());
    const state = useGameStore.getState();
    assert(ok, 'expected loadReplayFile to accept valid ReplayFile');
    assert(state.ui.screen === 'replay', `expected replay screen, got ${state.ui.screen}`);
    assert(state.replay?.currentActionIndex === -1, 'expected replay to start before first action');
  });

  await test('scrubbing timeline jumps replay action index', () => {
    useGameStore.getState().replayJumpToAction(1);
    const state = useGameStore.getState();
    assert(state.replay?.currentActionIndex === 1, `expected action index 1, got ${state.replay?.currentActionIndex}`);
  });

  await test('replay mode disables normal priority action updates', () => {
    const before = useGameStore.getState().game.lastUpdatedAt;
    useGameStore.getState().passPriority();
    const after = useGameStore.getState().game.lastUpdatedAt;
    assert(after === before, 'expected passPriority to be ignored during replay');
  });

  await test('loading long replay generates checkpoints', async () => {
    await useGameStore.getState().loadReplayFile(makeReplayFile(30));
    const replay = useGameStore.getState().replay;
    assert((replay?.checkpoints?.length ?? 0) > 0, 'expected checkpoints for long replay');
    assert(replay?.checkpointInterval === 25, `expected interval 25, got ${replay?.checkpointInterval}`);
  });

  await test('scrubbing with checkpoints clears pending animations', () => {
    useGameStore.getState().replaySetAnimationMode('simple');
    useGameStore.getState().replayStepForward();
    assert((useGameStore.getState().replay?.currentAnimations.length ?? 0) > 0, 'expected animation before checkpoint scrub');
    useGameStore.getState().replayJumpToAction(20);
    assert((useGameStore.getState().replay?.currentAnimations.length ?? 0) === 0, 'expected checkpoint scrub to clear animations');
  });

  await test('animation mode and speed persist after checkpoint jump', () => {
    useGameStore.getState().replaySetAnimationMode('dramatic');
    useGameStore.getState().replaySetAnimationSpeed(2);
    useGameStore.getState().replayJumpToAction(29);
    const replay = useGameStore.getState().replay;
    assert(replay?.animationMode === 'dramatic', `expected dramatic mode, got ${replay?.animationMode}`);
    assert(replay?.animationSpeed === 2, `expected animation speed 2, got ${replay?.animationSpeed}`);
  });

  await test('exitReplay restores non-replay screen', () => {
    useGameStore.getState().exitReplay();
    assert(useGameStore.getState().ui.screen !== 'replay', 'expected exitReplay to leave replay screen');
  });

  console.log(`\nReplay mode tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
