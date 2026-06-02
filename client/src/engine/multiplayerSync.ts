/**
 * multiplayerSync.ts
 *
 * Thin Firebase Realtime Database transport layer for multiplayer testing.
 *
 * Architecture:
 *  - Host creates a room → generates a 6-char room code → writes initial GameState
 *  - Joiners connect by code → receive state → pick a seat
 *  - Every GameState mutation is pushed via `broadcastState()`
 *  - All clients listen via `subscribeToRoom()` and call set({ game }) on change
 *
 * AWS SWAP GUIDE (when ready):
 *  Replace initFirebase / broadcastState / subscribeToRoom / updatePresence
 *  with API Gateway WebSocket equivalents. The rest of the codebase is untouched.
 *
 * Room data shape in Firebase:
 *   /rooms/{roomCode}/
 *     game:      GameState (JSON)
 *     players:   { [peerId]: { name, color, seatIndex, online, lastSeen } }
 *     hostId:    string
 *     createdAt: number
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getDatabase, ref, set as fbSet, get, onValue,
  serverTimestamp, onDisconnect, update, off,
  type Database, type Unsubscribe,
} from 'firebase/database';
import type { GameState } from '../types/game';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoomPresence {
  peerId: string;
  name: string;
  color: string;
  seatIndex: number;      // which player seat this peer controls
  online: boolean;
  lastSeen: number;
}

export interface RoomMeta {
  roomCode: string;
  hostId: string;
  createdAt: number;
  players: Record<string, RoomPresence>;
}

export type SyncStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'host'
  | 'joined'
  | 'error';

// ─── Internal state ───────────────────────────────────────────────────────────

let _app: FirebaseApp | null = null;
let _db: Database | null = null;
let _roomCode: string | null = null;
let _peerId: string | null = null;
let _isHost = false;
let _gameUnsubscribe: (() => void) | null = null;
let _presenceUnsubscribe: (() => void) | null = null;
let _status: SyncStatus = 'disconnected';

// Callbacks registered by the store
let _onGameUpdate: ((game: GameState) => void) | null = null;
let _onPresenceUpdate: ((players: Record<string, RoomPresence>) => void) | null = null;
let _onStatusChange: ((status: SyncStatus) => void) | null = null;

// ─── Firebase config ──────────────────────────────────────────────────────────
// These are public read/write credentials for a testing-only Firebase project.
// They are intentionally client-side safe (Firebase Security Rules restrict
// access to room paths only). Replace with your own project before production.
// For AWS swap: replace this entire block with AWS config.

const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            ?? '',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        ?? '',
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL       ?? '',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         ?? '',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             ?? '',
};

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initMultiplayer(
  onGameUpdate: (game: GameState) => void,
  onPresenceUpdate: (players: Record<string, RoomPresence>) => void,
  onStatusChange: (status: SyncStatus) => void,
): void {
  _onGameUpdate = onGameUpdate;
  _onPresenceUpdate = onPresenceUpdate;
  _onStatusChange = onStatusChange;
}

function setStatus(s: SyncStatus) {
  _status = s;
  _onStatusChange?.(s);
}

function getDb(): Database {
  if (!_app) {
    _app = initializeApp(FIREBASE_CONFIG);
    _db = getDatabase(_app);
  }
  return _db!;
}

// ─── Room code helpers ────────────────────────────────────────────────────────

function generateRoomCode(): string {
  // 6 uppercase alphanumeric chars — easy to share verbally
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function getRoomCode(): string | null { return _roomCode; }
export function getPeerId(): string | null   { return _peerId; }
export function getIsHost(): boolean          { return _isHost; }
export function getSyncStatus(): SyncStatus   { return _status; }

export function isConfigured(): boolean {
  return !!(FIREBASE_CONFIG.databaseURL);
}

// ─── Create Room (host) ───────────────────────────────────────────────────────

export async function createRoom(
  initialGame: GameState,
  hostPresence: Omit<RoomPresence, 'online' | 'lastSeen'>,
): Promise<string> {
  setStatus('connecting');
  const db = getDb();
  _peerId = hostPresence.peerId;
  _isHost = true;

  let code = generateRoomCode();
  // Ensure uniqueness (retry once on collision)
  const existing = await get(ref(db, `rooms/${code}/hostId`));
  if (existing.exists()) code = generateRoomCode();

  _roomCode = code;

  // Write initial state
  await fbSet(ref(db, `rooms/${code}`), {
    game: sanitizeForFirebase(initialGame),
    hostId: _peerId,
    createdAt: Date.now(),
    players: {
      [_peerId!]: { ...hostPresence, online: true, lastSeen: Date.now() },
    },
  });

  // Set up presence disconnect cleanup
  const presenceRef = ref(db, `rooms/${code}/players/${_peerId}/online`);
  onDisconnect(presenceRef).set(false);

  _subscribeToRoom(code);
  setStatus('host');
  return code;
}

// ─── Join Room (non-host) ─────────────────────────────────────────────────────

export async function joinRoom(
  code: string,
  presence: Omit<RoomPresence, 'online' | 'lastSeen'>,
): Promise<{ game: GameState; hostId: string }> {
  setStatus('connecting');
  const db = getDb();
  const upperCode = code.toUpperCase().trim();
  _peerId = presence.peerId;
  _isHost = false;
  _roomCode = upperCode;

  // Check room exists
  const snap = await get(ref(db, `rooms/${upperCode}`));
  if (!snap.exists()) {
    setStatus('error');
    throw new Error(`Room ${upperCode} not found. Double-check the code.`);
  }

  const roomData = snap.val();

  // Write own presence
  await update(ref(db, `rooms/${upperCode}/players/${_peerId}`), {
    ...presence, online: true, lastSeen: Date.now(),
  });

  const presenceRef = ref(db, `rooms/${upperCode}/players/${_peerId}/online`);
  onDisconnect(presenceRef).set(false);

  _subscribeToRoom(upperCode);
  setStatus('joined');

  return {
    game: roomData.game as GameState,
    hostId: roomData.hostId as string,
  };
}

// ─── Broadcast state (call after every store mutation) ────────────────────────

export function broadcastState(game: GameState): void {
  if (!_db || !_roomCode) return;
  // Fire-and-forget — update only the game node, don't overwrite presence
  fbSet(ref(_db, `rooms/${_roomCode}/game`), sanitizeForFirebase(game)).catch(console.error);
}

// ─── Subscribe ────────────────────────────────────────────────────────────────

function _subscribeToRoom(code: string): void {
  const db = getDb();

  // Unsubscribe existing listeners
  if (_gameUnsubscribe) { _gameUnsubscribe(); _gameUnsubscribe = null; }
  if (_presenceUnsubscribe) { _presenceUnsubscribe(); _presenceUnsubscribe = null; }

  // Listen to game state changes
  const gameRef = ref(db, `rooms/${code}/game`);
  const gameOff = onValue(gameRef, (snap) => {
    if (!snap.exists()) return;
    const game = snap.val() as GameState;
    _onGameUpdate?.(game);
  });
  _gameUnsubscribe = () => off(gameRef, 'value', gameOff as any);

  // Listen to presence changes
  const presRef = ref(db, `rooms/${code}/players`);
  const presOff = onValue(presRef, (snap) => {
    if (!snap.exists()) return;
    const players = snap.val() as Record<string, RoomPresence>;
    _onPresenceUpdate?.(players);
  });
  _presenceUnsubscribe = () => off(presRef, 'value', presOff as any);
}

// ─── Update presence (heartbeat) ─────────────────────────────────────────────

export function updatePresence(fields: Partial<RoomPresence>): void {
  if (!_db || !_roomCode || !_peerId) return;
  update(ref(_db, `rooms/${_roomCode}/players/${_peerId}`), {
    ...fields,
    lastSeen: Date.now(),
    online: true,
  }).catch(console.error);
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

export function leaveRoom(): void {
  if (_db && _roomCode && _peerId) {
    update(ref(_db, `rooms/${_roomCode}/players/${_peerId}`), { online: false })
      .catch(console.error);
  }
  if (_gameUnsubscribe) { _gameUnsubscribe(); _gameUnsubscribe = null; }
  if (_presenceUnsubscribe) { _presenceUnsubscribe(); _presenceUnsubscribe = null; }
  _roomCode = null;
  _peerId = null;
  _isHost = false;
  setStatus('disconnected');
}

// ─── Firebase serialization ───────────────────────────────────────────────────
// Firebase rejects `undefined` values. Strip them recursively.

function sanitizeForFirebase(obj: unknown): unknown {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirebase);
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, sanitizeForFirebase(v)])
  );
}
