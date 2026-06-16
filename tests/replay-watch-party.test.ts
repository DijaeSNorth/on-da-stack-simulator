import { createReplayFileFromGame } from '../client/src/engine/replayEngine';
import { useGameStore } from '../client/src/store/gameStore';
import type { ActionRecord, GameState } from '../client/src/types/game';
import type { ReplayFile, ReplayWatchPartyPlayback } from '../client/src/types/replay';

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

function makeAction(game: GameState, id: string, turn: number): ActionRecord {
  return {
    id,
    turn,
    phase: 'main1',
    playerId: game.players[0]?.id ?? 'p1',
    actionType: 'CHANGE_LIFE',
    timestamp: 1000 + turn,
    description: `Watch action ${id}`,
    affectedObjects: [],
    data: { playerId: game.players[1]?.id ?? 'p2', delta: -1 },
    flags: [],
    undone: false,
  };
}

function makeReplayFile(actionCount = 4): ReplayFile {
  if (useGameStore.getState().game.players.length < 2) {
    useGameStore.getState().initGame(useGameStore.getState().game.config, [
      { id: 'p1', name: 'Player A', color: '#3b82f6' },
      { id: 'p2', name: 'Player B', color: '#ef4444' },
    ]);
  }
  const game = useGameStore.getState().game;
  return {
    ...createReplayFileFromGame(game, {
      includePrivateZones: false,
      includeFinalSnapshot: false,
      redacted: true,
    }),
    replayVersion: '2.0.0',
    actionLog: Array.from({ length: actionCount }, (_, index) => makeAction(game, `w${index + 1}`, index + 1)),
  };
}

async function loadReplay(): Promise<void> {
  await useGameStore.getState().loadReplayFile(makeReplayFile());
}

function playback(actionIndex: number): ReplayWatchPartyPlayback {
  return {
    actionIndex,
    status: 'paused',
    speed: 1,
    animationMode: 'simple',
    updatedAt: Date.now(),
    controlledBy: 'presenter',
  };
}

async function main(): Promise<void> {
  await test('create watch party sets host role', async () => {
    await loadReplay();
    useGameStore.getState().createLocalWatchParty();
    const watch = useGameStore.getState().replay?.watchParty;
    assert(watch?.role === 'host', `expected host role, got ${watch?.role}`);
    assert((watch?.viewers.length ?? 0) >= 1, 'expected local host viewer');
  });

  await test('viewer following presenter applies action index', async () => {
    await loadReplay();
    useGameStore.getState().joinLocalWatchPartyPreview();
    useGameStore.getState().followPresenter();
    useGameStore.getState().applyPresenterPlaybackState(playback(2));
    assert(useGameStore.getState().replay?.currentActionIndex === 2, `expected action 2, got ${useGameStore.getState().replay?.currentActionIndex}`);
  });

  await test('free scrub does not auto-apply presenter action index', async () => {
    await loadReplay();
    useGameStore.getState().joinLocalWatchPartyPreview();
    useGameStore.getState().replayJumpToAction(0);
    useGameStore.getState().pauseFollowing();
    useGameStore.getState().applyPresenterPlaybackState(playback(3));
    const replay = useGameStore.getState().replay;
    assert(replay?.currentActionIndex === 0, `expected free scrub to stay at 0, got ${replay?.currentActionIndex}`);
    assert(replay?.watchParty.playback.actionIndex === 3, 'expected presenter state to be recorded locally');
  });

  await test('leaving clears watch state', async () => {
    await loadReplay();
    useGameStore.getState().createLocalWatchParty();
    useGameStore.getState().leaveWatchParty();
    const watch = useGameStore.getState().replay?.watchParty;
    assert(watch?.role === 'none', `expected none role, got ${watch?.role}`);
    assert((watch?.viewers.length ?? 0) === 0, 'expected viewers cleared');
  });

  console.log(`\nReplay watch party tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
