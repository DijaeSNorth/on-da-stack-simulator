import {
  createReplayClip,
  createReplayFileFromGame,
  generateReplayClipSummary,
  exportReplayClipMetadataJson,
} from '../client/src/engine/replayEngine';
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

function ensureGame(): GameState {
  if (useGameStore.getState().game.players.length < 2) {
    useGameStore.getState().initGame(useGameStore.getState().game.config, [
      { id: 'p1', name: 'Player A', color: '#3b82f6' },
      { id: 'p2', name: 'Player B', color: '#ef4444' },
    ]);
  }
  return useGameStore.getState().game;
}

function makeAction(game: GameState, id: string, turn: number, description?: string): ActionRecord {
  return {
    id,
    turn,
    phase: 'main1',
    playerId: game.players[0]?.id ?? 'p1',
    actionType: 'CHANGE_LIFE',
    timestamp: 1000 + turn,
    description: description ?? `Clip action ${id}`,
    affectedObjects: [],
    data: { playerId: game.players[1]?.id ?? 'p2', delta: -1 },
    flags: [],
    undone: false,
  };
}

function makeReplayFile(actionCount = 5, secretDescription = false): ReplayFile {
  const game = ensureGame();
  return {
    ...createReplayFileFromGame(game, {
      includePrivateZones: false,
      includeFinalSnapshot: false,
      redacted: true,
    }),
    replayVersion: '2.0.0',
    actionLog: Array.from({ length: actionCount }, (_, index) => makeAction(
      game,
      `clip${index + 1}`,
      index + 1,
      secretDescription && index === 1 ? 'Secret Combo Piece was revealed from library' : undefined,
    )),
  };
}

async function loadReplay(actionCount = 5): Promise<void> {
  const loaded = await useGameStore.getState().loadReplayFile(makeReplayFile(actionCount));
  assert(loaded, 'expected replay file to load');
}

async function createStoredClip(): Promise<string> {
  await loadReplay(5);
  useGameStore.getState().replayJumpToAction(1);
  useGameStore.getState().markReplayClipStart();
  useGameStore.getState().replayJumpToAction(3);
  useGameStore.getState().markReplayClipEnd();
  const saved = useGameStore.getState().saveReplayClip({ title: 'Combat swing', tags: ['combat'], description: 'Key sequence' });
  assert(saved, 'expected clip to save');
  const clip = useGameStore.getState().replay?.clips[0];
  assert(Boolean(clip), 'expected saved clip');
  return clip?.clipId ?? '';
}

async function main(): Promise<void> {
  await test('create valid clip', () => {
    const file = makeReplayFile();
    const result = createReplayClip(file, {
      title: 'Key turn',
      startActionIndex: 1,
      endActionIndex: 3,
      tags: ['highlight'],
      createdAt: 1000,
      clipId: 'clip-test',
    });
    assert(Boolean(result.clip), `expected clip, got errors ${result.errors.join(', ')}`);
    assert(result.clip?.startActionIndex === 1, 'expected start index 1');
    assert(result.clip?.endActionIndex === 3, 'expected end index 3');
  });

  await test('reject invalid range', () => {
    const result = createReplayClip(makeReplayFile(), {
      title: 'Bad range',
      startActionIndex: 4,
      endActionIndex: 1,
    });
    assert(!result.clip, 'expected invalid clip to be rejected');
    assert(result.errors.some(error => error.includes('startActionIndex')), 'expected range error');
  });

  await test('play clip jumps to start', async () => {
    const clipId = await createStoredClip();
    useGameStore.getState().replayJumpToAction(4);
    useGameStore.getState().playReplayClip(clipId);
    const replay = useGameStore.getState().replay;
    assert(replay?.currentActionIndex === 1, `expected clip start 1, got ${replay?.currentActionIndex}`);
    assert(replay?.status === 'playing', `expected playing, got ${replay?.status}`);
  });

  await test('clip playback stops at end', async () => {
    const clipId = await createStoredClip();
    useGameStore.getState().playReplayClip(clipId);
    useGameStore.getState().replayStepForward();
    useGameStore.getState().replayStepForward();
    const replay = useGameStore.getState().replay;
    assert(replay?.currentActionIndex === 3, `expected clip end 3, got ${replay?.currentActionIndex}`);
    assert(replay?.status === 'paused', `expected paused at clip end, got ${replay?.status}`);
    assert(!replay?.activeClipId, 'expected active clip to clear');
  });

  await test('export clip metadata works', () => {
    const file = makeReplayFile();
    const clip = createReplayClip(file, {
      title: 'Metadata clip',
      startActionIndex: 0,
      endActionIndex: 2,
      clipId: 'clip-meta',
      createdAt: 2000,
    }).clip;
    assert(Boolean(clip), 'expected clip');
    const parsed = JSON.parse(exportReplayClipMetadataJson(file, clip!));
    assert(parsed.clip.clipId === 'clip-meta', `expected clip-meta, got ${parsed.clip.clipId}`);
    assert(parsed.clip.actionCount === 3, `expected 3 actions, got ${parsed.clip.actionCount}`);
  });

  await test('public/redacted clip summary avoids hidden card names', () => {
    const file = makeReplayFile(4, true);
    const clip = createReplayClip(file, {
      title: 'Safe public highlight',
      startActionIndex: 1,
      endActionIndex: 2,
      clipId: 'clip-safe',
    }).clip;
    assert(Boolean(clip), 'expected clip');
    const summary = generateReplayClipSummary(file, clip!);
    assert(!summary.includes('Secret Combo Piece'), 'expected hidden card name not to be copied from action text');
    assert(!summary.includes('library'), 'expected hidden action label not to be copied');
    assert(summary.includes('Safe public highlight'), 'expected clip title in summary');
  });

  console.log(`\nReplay clip tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
