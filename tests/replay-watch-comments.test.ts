import { readFileSync } from 'node:fs';
import {
  buildReplayWatchComment,
  canWriteReplayWatchComment,
  sanitizeReplayWatchFirebasePayload,
} from '../client/src/engine/replayWatchFirebase';
import { createReplayFileFromGame } from '../client/src/engine/replayEngine';
import { useGameStore } from '../client/src/store/gameStore';
import type { ActionRecord, GameState } from '../client/src/types/game';
import type { ReplayFile, ReplayWatchComment } from '../client/src/types/replay';

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

function makeAction(game: GameState, id: string, turn: number): ActionRecord {
  return {
    id,
    turn,
    phase: 'main1',
    playerId: game.players[0]?.id ?? 'p1',
    actionType: 'CHANGE_LIFE',
    timestamp: 1000 + turn,
    description: `Watch comment action ${id}`,
    affectedObjects: [],
    data: { playerId: game.players[1]?.id ?? 'p2', delta: -1 },
    flags: [],
    undone: false,
  };
}

function makeReplayFile(actionCount = 4): ReplayFile {
  const game = ensureGame();
  return {
    ...createReplayFileFromGame(game, {
      includePrivateZones: false,
      includeFinalSnapshot: false,
      redacted: true,
    }),
    replayVersion: '2.0.0',
    actionLog: Array.from({ length: actionCount }, (_, index) => makeAction(game, `wc${index + 1}`, index + 1)),
  };
}

async function loadReplay(actionCount = 4): Promise<void> {
  const loaded = await useGameStore.getState().loadReplayFile(makeReplayFile(actionCount));
  assert(loaded, 'expected replay file to load');
}

function makeComment(patch: Partial<ReplayWatchComment> = {}): ReplayWatchComment {
  return buildReplayWatchComment({
    commentId: patch.commentId,
    watchRoomCode: patch.watchRoomCode ?? 'WROOM1',
    actionIndex: patch.actionIndex ?? 1,
    viewerId: patch.viewerId ?? 'viewer-uid',
    displayName: patch.displayName ?? 'Viewer One',
    body: patch.body ?? 'Nice timing',
    type: patch.type ?? 'comment',
    createdAt: patch.createdAt,
    expiresAt: patch.expiresAt,
  }, patch.createdAt ?? 1000);
}

async function main(): Promise<void> {
  await test('viewer can add comment', () => {
    const comment = makeComment();
    assert(canWriteReplayWatchComment('viewer-uid', comment), 'expected viewer to write own comment');
    assert(comment.commentId.length > 0, 'expected generated comment id');
    assert(comment.body === 'Nice timing', `expected trimmed body, got ${comment.body}`);
  });

  await test('comment is tied to action index', () => {
    const comment = makeComment({ actionIndex: 3, type: 'question', body: 'Rules question here' });
    assert(comment.actionIndex === 3, `expected action 3, got ${comment.actionIndex}`);
    assert(comment.type === 'question', `expected question, got ${comment.type}`);
  });

  await test('clicking comment jumps to action', async () => {
    await loadReplay(5);
    const comment = makeComment({ actionIndex: 2 });
    useGameStore.getState().replayJumpToAction(comment.actionIndex);
    assert(useGameStore.getState().replay?.currentActionIndex === 2, `expected action 2, got ${useGameStore.getState().replay?.currentActionIndex}`);
  });

  await test('non-auth write denied by rules', () => {
    const comment = makeComment();
    assert(!canWriteReplayWatchComment('', comment), 'expected empty auth uid to be denied');
    assert(!canWriteReplayWatchComment('other-viewer', comment), 'expected mismatched auth uid to be denied');
    const rules = JSON.parse(readFileSync('database.rules.json', 'utf8'));
    const commentsRules = rules.rules.watchRooms.$watchRoomCode.comments;
    assert(String(commentsRules.$commentId['.write']).includes('auth != null'), 'expected auth requirement');
    assert(String(commentsRules.$commentId['.write']).includes("newData.child('viewerId').val() === auth.uid"), 'expected self-write requirement');
    assert(String(commentsRules.$commentId['.validate']).includes("!newData.hasChild('actionLog')"), 'expected replay action log to be rejected');
  });

  await test('public/redacted mode does not auto-fill hidden card names', () => {
    const comment = makeComment({
      type: 'reaction',
      body: 'nice',
      actionIndex: 1,
    });
    const payload = JSON.stringify(sanitizeReplayWatchFirebasePayload(comment));
    assert(!payload.includes('Secret Combo Piece'), 'expected hidden card name not to appear');
    assert(!payload.includes('Hidden Library Top'), 'expected hidden library card not to appear');
    assert(payload.includes('nice'), 'expected reaction body');
  });

  console.log(`\nReplay watch comments tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
