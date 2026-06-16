import type {
  ReplayAnimationMode,
  ReplaySession,
  ReplaySpeed,
  ReplayWatchPartyPlayback,
  ReplayWatchPartyRole,
  ReplayWatchPartyState,
  ReplayWatchPartySyncMode,
  ReplayWatchViewer,
} from '../types/replay';

export const LOCAL_WATCH_PARTY_PREVIEW_CODE = 'LOCAL-PREVIEW';

export const DEFAULT_REPLAY_WATCH_PARTY_STATE: ReplayWatchPartyState = {
  role: 'none',
  syncMode: 'free_scrub',
  playback: {
    actionIndex: -1,
    status: 'paused',
    speed: 1,
    animationMode: 'off',
    updatedAt: 0,
  },
  viewers: [],
};

function localViewer(role: Exclude<ReplayWatchPartyRole, 'none'>, displayName: string, now: number): ReplayWatchViewer {
  return {
    viewerId: `local-${role}`,
    displayName,
    role,
    online: true,
    lastSeen: now,
  };
}

export function replaySpeedToWatchSpeed(speed: ReplaySpeed): number {
  return speed === 'instant' ? 999 : speed;
}

export function watchSpeedToReplaySpeed(speed: number): ReplaySpeed {
  if (speed === 0.5) return 0.5;
  if (speed === 2) return 2;
  if (speed === 999) return 'instant';
  return 1;
}

export function createWatchPlaybackFromReplay(
  replay: Pick<ReplaySession, 'currentActionIndex' | 'status' | 'speed' | 'animationMode'>,
  now = Date.now(),
  controlledBy?: string,
): ReplayWatchPartyPlayback {
  return {
    actionIndex: replay.currentActionIndex,
    status: replay.status === 'playing' ? 'playing' : 'paused',
    speed: replaySpeedToWatchSpeed(replay.speed),
    animationMode: replay.animationMode,
    updatedAt: now,
    controlledBy,
  };
}

export function createLocalWatchPartyState(
  replay: Pick<ReplaySession, 'currentActionIndex' | 'status' | 'speed' | 'animationMode'>,
  displayName = 'Host',
  now = Date.now(),
): ReplayWatchPartyState {
  return {
    watchRoomCode: LOCAL_WATCH_PARTY_PREVIEW_CODE,
    role: 'host',
    syncMode: 'presenter_sync',
    playback: createWatchPlaybackFromReplay(replay, now, 'local-host'),
    viewers: [localViewer('host', displayName, now)],
  };
}

export function joinLocalWatchPartyPreviewState(
  replay: Pick<ReplaySession, 'currentActionIndex' | 'status' | 'speed' | 'animationMode'>,
  displayName = 'Viewer',
  now = Date.now(),
): ReplayWatchPartyState {
  return {
    watchRoomCode: LOCAL_WATCH_PARTY_PREVIEW_CODE,
    role: 'viewer',
    syncMode: 'presenter_sync',
    playback: createWatchPlaybackFromReplay(replay, now, 'local-presenter'),
    viewers: [
      localViewer('presenter', 'Local Presenter', now),
      localViewer('viewer', displayName, now),
    ],
  };
}

export function leaveWatchPartyState(): ReplayWatchPartyState {
  return {
    ...DEFAULT_REPLAY_WATCH_PARTY_STATE,
    playback: { ...DEFAULT_REPLAY_WATCH_PARTY_STATE.playback },
    viewers: [],
  };
}

export function setWatchPartyRoleState(
  state: ReplayWatchPartyState,
  role: ReplayWatchPartyRole,
  displayName = 'Local Viewer',
  now = Date.now(),
): ReplayWatchPartyState {
  if (role === 'none') return leaveWatchPartyState();
  const existing = state.viewers.find(viewer => viewer.viewerId.startsWith('local-'));
  const viewer: ReplayWatchViewer = {
    viewerId: existing?.viewerId ?? `local-${role}`,
    displayName: existing?.displayName ?? displayName,
    role,
    online: true,
    lastSeen: now,
  };
  return {
    ...state,
    role,
    viewers: [viewer, ...state.viewers.filter(item => item.viewerId !== viewer.viewerId)],
  };
}

export function setWatchPartySyncModeState(
  state: ReplayWatchPartyState,
  syncMode: ReplayWatchPartySyncMode,
): ReplayWatchPartyState {
  return { ...state, syncMode };
}

export function recordPresenterPlaybackState(
  state: ReplayWatchPartyState,
  playback: ReplayWatchPartyPlayback,
): ReplayWatchPartyState {
  return {
    ...state,
    playback: { ...playback },
  };
}

export function shouldApplyPresenterPlayback(state: ReplayWatchPartyState): boolean {
  return state.role === 'viewer' && state.syncMode === 'presenter_sync';
}

export function normalizeWatchAnimationMode(mode: ReplayAnimationMode): ReplayAnimationMode {
  return mode === 'dramatic' ? 'dramatic' : mode === 'simple' ? 'simple' : 'off';
}
