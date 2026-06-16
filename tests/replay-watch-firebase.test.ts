import { readFileSync } from 'node:fs';
import {
  buildReplayWatchRoomControl,
  buildReplayWatchViewer,
  canWriteReplayWatchControl,
  canWriteReplayWatchViewer,
  controlContainsPrivateReplayData,
  sanitizeReplayWatchFirebasePayload,
} from '../client/src/engine/replayWatchFirebase';
import { createReplayFileFromGame } from '../client/src/engine/replayEngine';
import { useGameStore } from '../client/src/store/gameStore';
import type { ActionRecord, GameState } from '../client/src/types/game';
import type { ReplayFile, ReplaySession, ReplayWatchPartyPlayback } from '../client/src/types/replay';

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
    description: `Watch Firebase action ${id}`,
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
    actionLog: Array.from({ length: actionCount }, (_, index) => makeAction(game, `wf${index + 1}`, index + 1)),
  };
}

async function loadReplay(actionCount = 4): Promise<ReplaySession> {
  const loaded = await useGameStore.getState().loadReplayFile(makeReplayFile(actionCount));
  assert(loaded, 'expected replay file to load');
  const replay = useGameStore.getState().replay;
  assert(Boolean(replay), 'expected replay session');
  return replay as ReplaySession;
}

function playback(actionIndex: number): ReplayWatchPartyPlayback {
  return {
    actionIndex,
    status: 'paused',
    speed: 1,
    animationMode: 'simple',
    updatedAt: 1234,
    controlledBy: 'host-uid',
  };
}

async function main(): Promise<void> {
  await test('host can create watch room control payload', async () => {
    const replay = await loadReplay();
    const control = buildReplayWatchRoomControl(replay, 'WROOM1', 'host-uid', 1000);
    assert(control.watchRoomCode === 'WROOM1', `expected WROOM1, got ${control.watchRoomCode}`);
    assert(control.hostUid === 'host-uid', `expected host uid, got ${control.hostUid}`);
    assert(control.replayId.includes(replay.replayFile.gameId), 'expected replay id to include game id');
    assert(control.playback.actionIndex === replay.currentActionIndex, 'expected playback action to mirror replay');
  });

  await test('viewer can join watch room presence payload', () => {
    const viewer = buildReplayWatchViewer('viewer-uid', 'Viewer One', 'viewer', 2000);
    assert(viewer.viewerId === 'viewer-uid', `expected viewer uid, got ${viewer.viewerId}`);
    assert(viewer.role === 'viewer', `expected viewer role, got ${viewer.role}`);
    assert(viewer.online, 'expected viewer to be online');
  });

  await test('viewer can read playback state from control payload', async () => {
    const replay = await loadReplay();
    const control = buildReplayWatchRoomControl(replay, 'WROOM2', 'host-uid', 3000);
    assert(control.playback.status === 'paused', `expected paused, got ${control.playback.status}`);
    assert(control.playback.speed === 1, `expected speed 1, got ${control.playback.speed}`);
  });

  await test('non-host cannot write control', async () => {
    const replay = await loadReplay();
    const existing = buildReplayWatchRoomControl(replay, 'WROOM3', 'host-uid', 4000);
    const next = { ...existing, updatedAt: 5000, playback: playback(2) };
    assert(canWriteReplayWatchControl(existing, 'host-uid', next), 'expected host to write control');
    assert(!canWriteReplayWatchControl(existing, 'viewer-uid', next), 'expected viewer write to be denied');
  });

  await test('viewer can write own presence only', () => {
    const viewer = buildReplayWatchViewer('viewer-uid', 'Viewer One', 'viewer', 6000);
    assert(canWriteReplayWatchViewer('viewer-uid', 'viewer-uid', viewer), 'expected own presence write');
    assert(!canWriteReplayWatchViewer('other-viewer', 'viewer-uid', viewer), 'expected other path to be denied');
    assert(!canWriteReplayWatchViewer('viewer-uid', 'other-viewer', viewer), 'expected other auth uid to be denied');
  });

  await test('playback update applies locally for following viewer', async () => {
    await loadReplay(5);
    useGameStore.getState().joinLocalWatchPartyPreview();
    useGameStore.getState().followPresenter();
    useGameStore.getState().applyPresenterPlaybackState(playback(3));
    const replay = useGameStore.getState().replay;
    assert(replay?.currentActionIndex === 3, `expected action 3, got ${replay?.currentActionIndex}`);
    assert(replay?.watchParty.playback.actionIndex === 3, 'expected presenter playback recorded');
  });

  await test('control payload does not include private replay data', async () => {
    const replay = await loadReplay();
    const replayWithPrivateData = {
      ...replay,
      replayFile: {
        ...replay.replayFile,
        initialGameState: {
          ...replay.replayFile.initialGameState,
          privateZones: {
            hand: ['Secret Combo Piece'],
            library: ['Hidden Library Top'],
          },
        } as ReplayFile['initialGameState'] & Record<string, unknown>,
        actionLog: [
          ...replay.replayFile.actionLog,
          { ...makeAction(ensureGame(), 'secret', 99), description: 'Secret Combo Piece moved in hidden zone' },
        ],
      },
    } as ReplaySession;
    const control = buildReplayWatchRoomControl(replayWithPrivateData, 'WROOM4', 'host-uid', 7000);
    const payload = JSON.stringify(sanitizeReplayWatchFirebasePayload(control));
    assert(!payload.includes('Secret Combo Piece'), 'expected hidden card name to stay out of control payload');
    assert(!payload.includes('Hidden Library Top'), 'expected library order to stay out of control payload');
    assert(!controlContainsPrivateReplayData(control), 'expected private-data detector to pass control payload');
  });

  await test('RTDB rules are scoped for watch rooms', () => {
    const rules = JSON.parse(readFileSync('database.rules.json', 'utf8'));
    const watchRooms = rules.rules.watchRooms;
    assert(Boolean(watchRooms), 'expected watchRooms rules');
    assert(watchRooms.$watchRoomCode['.read'] === false, 'expected no broad watch room read');
    assert(watchRooms.$watchRoomCode['.write'] === false, 'expected no broad watch room write');
    assert(String(watchRooms.$watchRoomCode.control['.write']).includes('hostUid'), 'expected host-scoped control writes');
    assert(String(watchRooms.$watchRoomCode.control['.validate']).includes("!newData.hasChild('actionLog')"), 'expected actionLog to be rejected');
    assert(String(watchRooms.$watchRoomCode.viewers.$viewerId['.write']).includes('$viewerId === auth.uid'), 'expected own presence writes only');
  });

  console.log(`\nReplay watch Firebase tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
