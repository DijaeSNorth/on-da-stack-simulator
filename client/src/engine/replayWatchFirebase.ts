import {
  child,
  get,
  off,
  onDisconnect,
  onValue,
  ref,
  set,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { getFirebaseAuthUid, getFirebaseDatabase } from '../config/firebase';
import type {
  ReplayWatchComment,
  ReplaySession,
  ReplayWatchPartyPlayback,
  ReplayWatchViewer,
} from '../types/replay';
import { createWatchPlaybackFromReplay } from './replayWatchParty';

const WATCH_ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const WATCH_COMMENT_TTL_MS = 6 * 60 * 60 * 1000;

export interface ReplayWatchRoomControl {
  watchRoomCode: string;
  hostUid: string;
  replayId: string;
  replayTitle: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  playback: ReplayWatchPartyPlayback;
}

export interface ReplayWatchJoinResult {
  control: ReplayWatchRoomControl;
  viewer: ReplayWatchViewer;
}

function now(): number {
  return Date.now();
}

function watchRoomPath(watchRoomCode: string): string {
  return `watchRooms/${watchRoomCode.toUpperCase()}`;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => stripUndefined(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripUndefined(entryValue)]),
    ) as T;
  }
  return value;
}

export function createReplayWatchRoomCode(seed = Math.random()): string {
  const value = Math.floor(seed * 36 ** 5).toString(36).toUpperCase().padStart(5, '0');
  return `W${value}`.slice(0, 6);
}

export function getReplayWatchReplayId(replay: Pick<ReplaySession, 'replayFile'>): string {
  return `${replay.replayFile.gameId}:${replay.replayFile.exportedAt}`;
}

export function buildReplayWatchRoomControl(
  replay: Pick<ReplaySession, 'replayFile' | 'currentActionIndex' | 'status' | 'speed' | 'animationMode'>,
  watchRoomCode: string,
  hostUid: string,
  currentTime = now(),
): ReplayWatchRoomControl {
  return {
    watchRoomCode: watchRoomCode.toUpperCase(),
    hostUid,
    replayId: getReplayWatchReplayId(replay),
    replayTitle: replay.replayFile.gameName || replay.replayFile.gameId,
    createdAt: currentTime,
    updatedAt: currentTime,
    expiresAt: currentTime + WATCH_ROOM_TTL_MS,
    playback: createWatchPlaybackFromReplay(replay, currentTime, hostUid),
  };
}

export function buildReplayWatchViewer(
  viewerId: string,
  displayName: string,
  role: ReplayWatchViewer['role'] = 'viewer',
  currentTime = now(),
): ReplayWatchViewer {
  return {
    viewerId,
    displayName,
    role,
    online: true,
    lastSeen: currentTime,
  };
}

export function createReplayWatchCommentId(seed = Math.random(), currentTime = now()): string {
  const suffix = Math.floor(seed * 36 ** 6).toString(36).toUpperCase().padStart(6, '0');
  return `c_${currentTime}_${suffix}`;
}

export function buildReplayWatchComment(
  comment: Omit<ReplayWatchComment, 'commentId' | 'createdAt' | 'expiresAt'> & {
    commentId?: string;
    createdAt?: number;
    expiresAt?: number;
  },
  currentTime = now(),
): ReplayWatchComment {
  const createdAt = comment.createdAt ?? currentTime;
  return {
    commentId: comment.commentId?.trim() ? comment.commentId : createReplayWatchCommentId(undefined, createdAt),
    watchRoomCode: comment.watchRoomCode.toUpperCase(),
    actionIndex: comment.actionIndex,
    viewerId: comment.viewerId,
    displayName: comment.displayName.trim() || 'Viewer',
    createdAt,
    expiresAt: comment.expiresAt ?? createdAt + WATCH_COMMENT_TTL_MS,
    body: comment.body.trim().slice(0, 500),
    type: comment.type,
  };
}

export function sanitizeReplayWatchFirebasePayload<T>(value: T): T {
  return stripUndefined(value);
}

export function controlContainsPrivateReplayData(control: ReplayWatchRoomControl): boolean {
  const payload = JSON.stringify(control);
  return /\b(initialGameState|finalGameState|actionLog|cards|definitions|hand|library|sideboard|maybeboard|privateZones|ReplayFile)\b/.test(payload);
}

export function canWriteReplayWatchControl(
  existingControl: ReplayWatchRoomControl | null,
  authUid: string,
  nextControl: ReplayWatchRoomControl,
): boolean {
  if (!authUid) return false;
  if (!existingControl) return nextControl.hostUid === authUid;
  return existingControl.hostUid === authUid;
}

export function canWriteReplayWatchViewer(
  viewerIdPath: string,
  authUid: string,
  viewer: ReplayWatchViewer,
): boolean {
  return Boolean(authUid) && viewerIdPath === authUid && viewer.viewerId === authUid;
}

export function canWriteReplayWatchComment(
  authUid: string,
  comment: ReplayWatchComment,
): boolean {
  return Boolean(authUid)
    && comment.viewerId === authUid
    && Boolean(comment.watchRoomCode)
    && comment.actionIndex >= -1
    && ['comment', 'question', 'reaction'].includes(comment.type)
    && comment.body.trim().length > 0;
}

export async function createFirebaseReplayWatchRoom(
  replay: ReplaySession,
  displayName = 'Host',
): Promise<ReplayWatchRoomControl | null> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const hostUid = await getFirebaseAuthUid();
  if (!hostUid) return null;
  const watchRoomCode = createReplayWatchRoomCode();
  const createdAt = now();
  const control = buildReplayWatchRoomControl(replay, watchRoomCode, hostUid, createdAt);
  const viewer = buildReplayWatchViewer(hostUid, displayName, 'host', createdAt);
  const updates: Record<string, unknown> = {
    [`${watchRoomPath(watchRoomCode)}/control`]: control,
    [`${watchRoomPath(watchRoomCode)}/viewers/${hostUid}`]: viewer,
  };
  await update(ref(db), sanitizeReplayWatchFirebasePayload(updates));
  const viewerRef = ref(db, `${watchRoomPath(watchRoomCode)}/viewers/${hostUid}`);
  await onDisconnect(viewerRef).update({ online: false, lastSeen: now() });
  return control;
}

export async function joinFirebaseReplayWatchRoom(
  watchRoomCode: string,
  displayName = 'Viewer',
): Promise<ReplayWatchJoinResult | null> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const viewerId = await getFirebaseAuthUid();
  if (!viewerId) return null;
  const code = watchRoomCode.toUpperCase();
  const controlSnapshot = await get(child(ref(db), `${watchRoomPath(code)}/control`));
  if (!controlSnapshot.exists()) return null;
  const control = controlSnapshot.val() as ReplayWatchRoomControl;
  const viewer = buildReplayWatchViewer(viewerId, displayName, 'viewer', now());
  const viewerRef = ref(db, `${watchRoomPath(code)}/viewers/${viewerId}`);
  await set(viewerRef, sanitizeReplayWatchFirebasePayload(viewer));
  await onDisconnect(viewerRef).update({ online: false, lastSeen: now() });
  return { control, viewer };
}

export async function writeReplayWatchPlayback(
  watchRoomCode: string,
  playback: ReplayWatchPartyPlayback,
): Promise<void> {
  const db = getFirebaseDatabase();
  if (!db) return;
  const authUid = await getFirebaseAuthUid();
  if (!authUid) return;
  await update(ref(db, `${watchRoomPath(watchRoomCode)}/control`), sanitizeReplayWatchFirebasePayload({
    playback: { ...playback, controlledBy: playback.controlledBy ?? authUid, updatedAt: playback.updatedAt || now() },
    updatedAt: now(),
  }));
}

export function listenReplayWatchControl(
  watchRoomCode: string,
  onControl: (control: ReplayWatchRoomControl | null) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  if (!db) return () => {};
  const controlRef = ref(db, `${watchRoomPath(watchRoomCode)}/control`);
  onValue(controlRef, snapshot => {
    onControl(snapshot.val() as ReplayWatchRoomControl | null);
  });
  return () => off(controlRef);
}

export async function writeReplayWatchComment(
  watchRoomCode: string,
  comment: Omit<ReplayWatchComment, 'commentId' | 'watchRoomCode' | 'viewerId' | 'createdAt' | 'expiresAt'> & {
    commentId?: string;
    viewerId?: string;
    createdAt?: number;
    expiresAt?: number;
  },
): Promise<ReplayWatchComment | null> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const authUid = await getFirebaseAuthUid();
  if (!authUid) return null;
  const payload = buildReplayWatchComment({
    ...comment,
    watchRoomCode,
    viewerId: authUid,
  });
  if (!canWriteReplayWatchComment(authUid, payload)) return null;
  await set(ref(db, `${watchRoomPath(watchRoomCode)}/comments/${payload.commentId}`), sanitizeReplayWatchFirebasePayload(payload));
  return payload;
}

export function listenReplayWatchComments(
  watchRoomCode: string,
  onComments: (comments: ReplayWatchComment[]) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  if (!db) return () => {};
  const commentsRef = ref(db, `${watchRoomPath(watchRoomCode)}/comments`);
  onValue(commentsRef, snapshot => {
    const value = snapshot.val() as Record<string, ReplayWatchComment> | null;
    onComments(Object.values(value ?? {}).sort((a, b) => a.createdAt - b.createdAt));
  });
  return () => off(commentsRef);
}
