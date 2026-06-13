/**
 * multiplayerSync.ts  —  WebRTC P2P transport via PeerJS
 *
 * Architecture:
 *  HOST  — creates a PeerJS peer whose ID IS the room code.
 *          Accepts incoming DataConnections from joiners.
 *          Receives presence updates, broadcasts authoritative GameState back.
 *
 *  JOINER — creates a PeerJS peer with a random ID.
 *           Connects to the host peer (whose ID = room code).
 *           Sends its own presence; receives game state + all peer presence.
 *
 * No server stores game state. PeerJS's free cloud broker only exchanges the
 * WebRTC handshake (~200 bytes) then gets out of the way. All game data flows
 * directly browser-to-browser over encrypted DataChannels.
 *
 * AWS SWAP GUIDE:
 *  Replace `new Peer(id, PEER_CONFIG)` with a Peer pointed at your own
 *  PeerServer (or SFU). The rest of the codebase is untouched.
 *
 * Message envelope shape:
 *   { type: 'PRESENCE', payload: RoomPresence }
 *   { type: 'GAME_STATE', payload: GameState }
 *   { type: 'PRESENCE_BROADCAST', payload: Record<string, RoomPresence> }
 *   { type: 'HOST_MIGRATION', payload: HostMigrationNotice }
 *   { type: 'LEAVE_ROOM', payload: { peerId: string } }
 *   { type: 'KICKED', payload: { reason: string } }
 *   { type: 'PING', payload: { sentAt: number } }
 *   { type: 'PONG', payload: { sentAt: number } }
 */

import Peer, { type DataConnection } from 'peerjs';
import type { CardState, GameState, Player, PlayerAvatarImage } from '../types/game';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  canHostStartFromLobby,
  createDeckSubmission,
  createPrivatePlayerState,
  createPublicGameState,
  createStartGamePrepare,
  makeMultiplayerMessage,
  publicDeckSummary,
  sanitizeGameStateForPlayer,
  validateDeckSubmission,
  validateMultiplayerMessage,
  type DeckSubmission,
  type GameActionRequestPayload,
  type GameStatePatchPayload,
  type LobbyPlayer,
  type LobbyState,
  type MultiplayerMessage,
  type MultiplayerMessageType,
  type PlayerIdentity,
  type PublicGameState,
  type StartGameAckPayload,
  type StartGamePreparePayload,
  type SubmittedDeckPublicSummary,
} from './multiplayerProtocol';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoomPresence {
  playerId: string;
  peerId: string;
  sessionId: string;
  name: string;
  color: string;
  avatarInitial?: string;
  avatarStyle?: 'solid' | 'gradient' | 'outline';
  avatarImage?: PlayerAvatarImage;
  seatIndex: number;   // -1 = spectator
  isSpectator: boolean;
  isHostPeer?: boolean;
  online: boolean;
  lastSeen: number;
  connectionQuality?: ConnectionQuality;
  deck?: RoomDeckSummary;
  deckStatus?: 'none' | 'submitted' | 'valid' | 'rejected';
  ready?: boolean;
}

export interface RoomDeckSummary {
  id: string;
  name: string;
  cardCount: number;
  commanders: string[];
  deckHash?: string;
  status?: 'none' | 'submitted' | 'valid' | 'rejected';
  errors?: string[];
  warnings?: string[];
}

export interface ConnectionQuality {
  rttMs: number;
  score: number;
  samples: number;
  updatedAt: number;
}

interface HostMigrationNotice {
  candidatePeerId: string;
  reason: 'host-disconnected' | 'host-quality';
  roomCode: string;
  game: GameState | null;
  peers: Record<string, RoomPresence>;
}

export interface StartGamePrepare {
  id: string;
  hostPeerId: string;
  gameId: string;
  playerList: StartGamePreparePayload['playerList'];
  deckHashes: Record<string, string>;
  turnOrder: string[];
  requiredPeerIds: string[];
  createdAt: number;
  deadline: number;
  deadlineAt: number;
  game?: GameState;
}

export interface StartGameAck {
  id: string;
  gameId?: string;
  playerId: string;
  peerId: string;
  sessionId?: string;
  seatIndex: number;
  deckId?: string;
  deckHash?: string;
  ready: boolean;
  reason?: string;
  receivedAt: number;
}

export interface StartGameCommit {
  id: string;
  gameId?: string;
  game: GameState;
  publicGameState?: PublicGameState;
  fallback: boolean;
  missingPeerIds: string[];
  committedAt: number;
}

export interface RoomMeta {
  roomCode: string;
  hostId: string;
  createdAt: number;
  players: Record<string, RoomPresence>;
}

export interface JoinRoomResult {
  game: GameState | null;
  hostId: string;
  peerId: string;
  peers: Record<string, RoomPresence>;
  isSpectator: boolean;
  seatIndex: number;
}

export type SyncStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'host'
  | 'joined'
  | 'migrating'
  | 'error';

export interface FirebaseRelayHealth {
  configured: boolean;
  active: boolean;
  roomCode: string | null;
  transportMode: 'peerjs' | 'firebase';
  pollIntervalMs: number;
  lastPollAt: number | null;
  consecutivePollErrors: number;
  lastPollError: string | null;
  lastSnapshotAt: number | null;
  lastSnapshotAgeMs: number | null;
}

// ─── PeerJS config ────────────────────────────────────────────────────────────
// Uses the free PeerJS cloud broker for signaling only.
// Replace host/port/path for self-hosted PeerServer or AWS.
const PEER_CONFIG = {
  debug: 0,  // 0 = silent, 1 = errors, 2 = warnings, 3 = all
};

// Room code prefix so host peer IDs don't collide with random peer IDs
const ROOM_PREFIX = 'mtgsim-';

// How long a joiner waits for the host to accept the connection (ms)
const CONNECT_TIMEOUT_MS = 12000;

// Heartbeat interval to keep DataChannels alive through NAT (ms)
const HEARTBEAT_MS = 20000;
const HOST_MIGRATION_DELAY_MS = 1800;
const DATA_CHANNEL_LOW_WATER_BYTES = 64 * 1024;
const DATA_CHANNEL_HIGH_WATER_BYTES = 256 * 1024;
const FIREBASE_POLL_MS = 1800;
const FIREBASE_POLL_MS_MAX = 12000;
const FIREBASE_FETCH_TIMEOUT_MS = 6000;
const FIREBASE_RETRY_MAX_ATTEMPTS = 2;
const FIREBASE_RETRY_BASE_DELAY_MS = 650;
const FIREBASE_ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const FIREBASE_MAX_GAME_STATE_BYTES = 900 * 1024;
const FIREBASE_ROOM_CODE_LENGTH = 12;
const MAX_RELAY_NAME_LENGTH = 40;
const MAX_RELAY_INITIAL_LENGTH = 3;
const MAX_RELAY_DECK_NAME_LENGTH = 80;
const MAX_RELAY_COMMANDER_NAME_LENGTH = 80;
const DECK_SUBMISSION_FALLBACK_MS = 3000;

// ─── Internal state ───────────────────────────────────────────────────────────

let _peer: Peer | null = null;
let _roomCode: string | null = null;
let _peerId: string | null = null;
let _playerId: string | null = null;
let _sessionId: string | null = null;
let _isHost = false;
let _status: SyncStatus = 'disconnected';
let _transportMode: 'peerjs' | 'firebase' = 'peerjs';
let _messageSeq = 0;
let _gamePatchSeq = 0;
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _migrationTimer: ReturnType<typeof setTimeout> | null = null;
let _firebasePollTimer: ReturnType<typeof setTimeout> | null = null;
let _deckSubmissionFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let _lastLocalDeckSubmission: DeckSubmission | null = null;
let _deckSubmissionFallbackUsed = false;
let _firebaseErrorStreak = 0;
let _firebaseLastPollError: string | null = null;
let _firebaseLastPollAt = 0;
let _firebaseLastSnapshotAt = 0;
let _firebasePollDelayMs = FIREBASE_POLL_MS;
let _firebasePollInFlight = false;

// Host-side: map of peerId → DataConnection for each joiner
const _connections: Map<string, DataConnection> = new Map();

// Joiner-side: single connection to host
let _hostConn: DataConnection | null = null;
let _latestGame: GameState | null = null;
const _pendingStateMessages: Map<string, SyncMessage> = new Map();
const _bufferDrainHandlers: Map<string, () => void> = new Map();
const _connectionHealthHandlers: Map<string, () => void> = new Map();
const _firebaseSeenMessages: Map<string, number> = new Map();

// Presence table — host owns the authoritative copy; joiners mirror it
const _peers: Map<string, RoomPresence> = new Map();
const _deckSubmissions: Map<string, DeckSubmission> = new Map();
const _lastActionSeqByPlayer: Map<string, number> = new Map();
let _lobbyState: LobbyState | null = null;

// Callbacks registered by the store
let _onGameUpdate: ((game: GameState) => void) | null = null;
let _onPresenceUpdate: ((players: Record<string, RoomPresence>) => void) | null = null;
let _onStatusChange: ((status: SyncStatus) => void) | null = null;
let _onStartPrepare: ((prepare: StartGamePrepare) => void) | null = null;
let _onStartAck: ((ack: StartGameAck) => void) | null = null;
let _onStartCommit: ((commit: StartGameCommit) => void) | null = null;
let _onLobbyUpdate: ((lobby: LobbyState) => void) | null = null;
let _onDeckSubmitted: ((submission: DeckSubmission, presence: RoomPresence) => void | Promise<void>) | null = null;
let _onGameActionRequest: ((request: GameActionRequestPayload, presence: RoomPresence) => void) | null = null;

function debugMultiplayer(event: string, data?: Record<string, unknown>): void {
  console.debug(`[multiplayer] ${event}`, data ?? {});
}

type SyncMessage =
  | { type: 'PRESENCE'; payload: RoomPresence }
  | { type: 'GAME_STATE'; payload: GameState }
  | { type: 'PRESENCE_BROADCAST'; payload: Record<string, RoomPresence> }
  | { type: 'LOBBY_STATE'; payload: LobbyState }
  | { type: 'DECK_SUBMITTED'; payload: DeckSubmission }
  | { type: 'DECK_VALIDATED'; payload: SubmittedDeckPublicSummary }
  | { type: 'DECK_REJECTED'; payload: SubmittedDeckPublicSummary }
  | { type: 'PLAYER_READY_CHANGED'; payload: { playerId: string; ready: boolean } }
  | { type: 'GAME_STATE_PATCH'; payload: GameStatePatchPayload }
  | { type: 'GAME_STATE_PATCH_REQUEST'; payload: { reason: string; sentAt: number } }
  | { type: 'GAME_ACTION_REQUEST'; payload: GameActionRequestPayload }
  | { type: 'HOST_MIGRATION'; payload: HostMigrationNotice }
  | { type: 'LEAVE_ROOM'; payload: { peerId: string } }
  | { type: 'KICKED'; payload: { reason: string } }
  | { type: 'START_GAME_PREPARE'; payload: StartGamePrepare }
  | { type: 'START_GAME_ACK'; payload: StartGameAck }
  | { type: 'START_GAME_COMMIT'; payload: StartGameCommit }
  | { type: 'PING'; payload: { sentAt: number } }
  | { type: 'PONG'; payload: { sentAt: number } };

interface FirebaseRoomRelay {
  hostId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  game: GameState | null;
  peers: Record<string, RoomPresence>;
  lobby?: LobbyState;
  messages?: Record<string, { updatedAt: number; message: MultiplayerMessage }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(s: SyncStatus) {
  _status = s;
  _onStatusChange?.(s);
}

function parseSyncMessage(raw: unknown): SyncMessage | null {
  const validation = validateMultiplayerMessage(raw, _roomCode ?? undefined);
  if (!validation.ok || !validation.message) {
    const summary = summarizeRawMessage(raw);
    debugMultiplayer('message validation failed', {
      rawType: summary.type,
      rawProtocolVersion: summary.protocolVersion,
      rawRoomId: summary.roomId,
      expectedRoomId: _roomCode ?? undefined,
      rawPlayerId: summary.playerId,
      rawPeerId: summary.peerId,
      reason: validation.reason,
    });
    return null;
  }
  return {
    type: validation.message.type,
    payload: validation.message.payload,
  } as SyncMessage;
}

function summarizeRawMessage(raw: unknown): {
  type?: unknown;
  protocolVersion?: unknown;
  roomId?: unknown;
  playerId?: unknown;
  peerId?: unknown;
} {
  if (!raw || typeof raw !== 'object') return {};
  const message = raw as Partial<MultiplayerMessage>;
  return {
    type: message.type,
    protocolVersion: message.protocolVersion,
    roomId: message.roomId,
    playerId: message.playerId,
    peerId: message.peerId,
  };
}

export function canonicalizeJoinPresence(
  peerId: string,
  presence: Omit<RoomPresence, 'online' | 'lastSeen'>,
): Omit<RoomPresence, 'online' | 'lastSeen'> {
  return { ...presence, peerId, playerId: presence.playerId, sessionId: presence.sessionId };
}

function getDataChannel(conn: DataConnection): RTCDataChannel | undefined {
  return (conn as DataConnection & { dataChannel?: RTCDataChannel }).dataChannel;
}

function getConnectionDebugInfo(conn: DataConnection): {
  connOpen: boolean;
  dataChannelReadyState?: RTCDataChannelState;
  bufferedAmount?: number;
} {
  const dataChannel = getDataChannel(conn);
  return {
    connOpen: conn.open,
    dataChannelReadyState: dataChannel?.readyState,
    bufferedAmount: dataChannel?.bufferedAmount,
  };
}

function logConnectionState(event: string, conn: DataConnection, extra: Record<string, unknown> = {}): void {
  debugMultiplayer(event, {
    peerId: conn.peer,
    ...getConnectionDebugInfo(conn),
    ...extra,
  });
}

function cleanupConnection(conn: DataConnection): void {
  _pendingStateMessages.delete(conn.peer);
  const dataChannel = getDataChannel(conn);
  const bufferDrain = _bufferDrainHandlers.get(conn.peer);
  if (dataChannel && bufferDrain) {
    dataChannel.removeEventListener?.('bufferedamountlow', bufferDrain);
  }
  _bufferDrainHandlers.delete(conn.peer);

  const healthCleanup = _connectionHealthHandlers.get(conn.peer);
  healthCleanup?.();
  _connectionHealthHandlers.delete(conn.peer);
}

function flushPendingStateMessage(conn: DataConnection): void {
  const pending = _pendingStateMessages.get(conn.peer);
  if (!pending || !conn.open) return;

  const dataChannel = getDataChannel(conn);
  if (dataChannel && dataChannel.readyState !== 'open') return;
  if (dataChannel && dataChannel.bufferedAmount > DATA_CHANNEL_LOW_WATER_BYTES) return;

  _pendingStateMessages.delete(conn.peer);
  try {
    conn.send(pending);
  } catch {
    _pendingStateMessages.set(conn.peer, pending);
  }
}

function watchBufferedStateDrain(conn: DataConnection): void {
  const dataChannel = getDataChannel(conn);
  if (!dataChannel || _bufferDrainHandlers.has(conn.peer)) return;
  dataChannel.bufferedAmountLowThreshold = DATA_CHANNEL_LOW_WATER_BYTES;
  const handler = () => flushPendingStateMessage(conn);
  dataChannel.addEventListener?.('bufferedamountlow', handler);
  _bufferDrainHandlers.set(conn.peer, handler);
}

function envelopeMessage(msg: SyncMessage, peerOverride?: string): MultiplayerMessage<MultiplayerMessageType, unknown> | null {
  if (!_roomCode || !_playerId || !_sessionId) return null;
  return makeMultiplayerMessage({
    roomId: _roomCode,
    playerId: _playerId,
    peerId: peerOverride ?? _peerId ?? 'pending-peer',
    sessionId: _sessionId,
    type: msg.type,
    payload: msg.payload,
    seq: _messageSeq++,
    sentAt: Date.now(),
  });
}

function sendMessage(conn: DataConnection, msg: SyncMessage, options: { coalesceState?: boolean } = {}): boolean {
  if (!conn.open) return false;
  const dataChannel = getDataChannel(conn);
  if (dataChannel && dataChannel.readyState !== 'open') return false;
  const envelope = envelopeMessage(msg);
  if (!envelope) return false;

  if (options.coalesceState && dataChannel && dataChannel.bufferedAmount > DATA_CHANNEL_HIGH_WATER_BYTES) {
    _pendingStateMessages.set(conn.peer, msg);
    watchBufferedStateDrain(conn);
    return false;
  }

  try {
    conn.send(envelope);
    return true;
  } catch {
    if (options.coalesceState) {
      _pendingStateMessages.set(conn.peer, msg);
      watchBufferedStateDrain(conn);
    }
    return false;
  }
}

function watchPeerConnection(conn: DataConnection, onLost: () => void): void {
  const pc = (conn as DataConnection & { peerConnection?: RTCPeerConnection }).peerConnection;
  if (!pc || _connectionHealthHandlers.has(conn.peer)) return;

  const handleStateChange = () => {
    if (
      pc.connectionState === 'failed' ||
      pc.connectionState === 'closed' ||
      pc.iceConnectionState === 'failed' ||
      pc.iceConnectionState === 'closed'
    ) {
      onLost();
    }
  };
  pc.addEventListener?.('connectionstatechange', handleStateChange);
  pc.addEventListener?.('iceconnectionstatechange', handleStateChange);
  _connectionHealthHandlers.set(conn.peer, () => {
    pc.removeEventListener?.('connectionstatechange', handleStateChange);
    pc.removeEventListener?.('iceconnectionstatechange', handleStateChange);
  });
}

function markPeerOffline(conn: DataConnection): void {
  const p = _peers.get(conn.peer);
  if (p) _peers.set(conn.peer, { ...p, online: false, lastSeen: Date.now() });
  cleanupConnection(conn);
  _connections.delete(conn.peer);
  broadcastPresence();
  broadcastLobbyState();
}

function removePeerFromHostLobby(peerId: string, removePresence = true): RoomPresence | null {
  const presence = _peers.get(peerId);
  if (!presence) return null;

  _deckSubmissions.delete(presence.playerId);
  if (_latestGame) {
    const nextGame = clearHostSeatDeckState(_latestGame, presence);
    if (nextGame) {
      _latestGame = nextGame;
      _onGameUpdate?.(nextGame);
    }
  }

  if (removePresence) {
    _peers.delete(peerId);
  } else {
    _peers.set(peerId, {
      ...presence,
      deck: undefined,
      deckStatus: 'none',
      ready: false,
      online: false,
      lastSeen: Date.now(),
    });
  }

  return presence;
}

function cleanupAllConnections(): void {
  for (const conn of _connections.values()) cleanupConnection(conn);
  if (_hostConn) cleanupConnection(_hostConn);
  _connections.clear();
  _pendingStateMessages.clear();
  _bufferDrainHandlers.clear();
  _connectionHealthHandlers.clear();
}

function getEnvValue(name: string): string | undefined {
  return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name];
}

function getFirebaseDatabaseUrl(): string | null {
  const raw = getEnvValue('VITE_FIREBASE_RTDB_URL') || getEnvValue('VITE_FIREBASE_DATABASE_URL');
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

function firebaseFallbackExplicitlyEnabled(): boolean {
  return getEnvValue('VITE_ENABLE_FIREBASE_FALLBACK') === 'true';
}

function firebaseUrl(path: string): string {
  const base = getFirebaseDatabaseUrl();
  if (!base) throw new Error('Firebase fallback is not configured. Set VITE_FIREBASE_RTDB_URL.');
  const normalizedPath = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return `${base}/${normalizedPath}.json`;
}

function estimatedJsonBytes(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

function assertFirebaseGameSize(game: GameState | null): void {
  if (!game) return;
  const bytes = estimatedJsonBytes(game);
  if (bytes > FIREBASE_MAX_GAME_STATE_BYTES) {
    throw new Error('Firebase fallback game state is too large for relay sync.');
  }
}

function clampText(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return (text || fallback).slice(0, maxLength);
}

function normalizeRelayColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#3b82f6';
}

function compactDeckSummaryForRelay(deck: RoomDeckSummary | undefined): RoomDeckSummary | undefined {
  if (!deck?.id) return undefined;
  return {
    id: clampText(deck.id, '', 120),
    name: clampText(deck.name, 'Loaded deck', MAX_RELAY_DECK_NAME_LENGTH),
    cardCount: Number.isFinite(deck.cardCount) ? Math.max(0, Math.min(500, Math.round(deck.cardCount))) : 0,
    commanders: Array.isArray(deck.commanders)
      ? deck.commanders.slice(0, 2).map(name => clampText(name, '', MAX_RELAY_COMMANDER_NAME_LENGTH)).filter(Boolean)
      : [],
    deckHash: deck.deckHash ? clampText(deck.deckHash, '', 80) : undefined,
    status: deck.status,
    errors: Array.isArray(deck.errors) ? deck.errors.slice(0, 6).map(error => clampText(error, '', 160)) : undefined,
    warnings: Array.isArray(deck.warnings) ? deck.warnings.slice(0, 4).map(warning => clampText(warning, '', 120)) : undefined,
  };
}

export function compactPresenceForRelay(presence: RoomPresence): RoomPresence {
  return {
    playerId: clampText(presence.playerId, crypto.randomUUID(), 120),
    peerId: clampText(presence.peerId, crypto.randomUUID(), 80),
    sessionId: clampText(presence.sessionId, crypto.randomUUID(), 120),
    name: clampText(presence.name, 'Player', MAX_RELAY_NAME_LENGTH),
    color: normalizeRelayColor(presence.color),
    avatarInitial: presence.avatarInitial
      ? clampText(presence.avatarInitial, '', MAX_RELAY_INITIAL_LENGTH)
      : undefined,
    avatarStyle: ['solid', 'gradient', 'outline'].includes(presence.avatarStyle ?? '')
      ? presence.avatarStyle
      : undefined,
    avatarImage: presence.avatarImage?.source === 'card' && presence.avatarImage.url.length < 500
      ? presence.avatarImage
      : undefined,
    seatIndex: Number.isInteger(presence.seatIndex) ? Math.max(-1, Math.min(5, presence.seatIndex)) : -1,
    isSpectator: Boolean(presence.isSpectator),
    isHostPeer: Boolean(presence.isHostPeer),
    online: Boolean(presence.online),
    lastSeen: Number.isFinite(presence.lastSeen) ? presence.lastSeen : Date.now(),
    connectionQuality: presence.connectionQuality && Number.isFinite(presence.connectionQuality.rttMs)
      ? {
        rttMs: Math.max(0, Math.min(10_000, Math.round(presence.connectionQuality.rttMs))),
        score: Math.max(0, Math.min(1000, Math.round(presence.connectionQuality.score))),
        samples: Math.max(0, Math.min(20, Math.round(presence.connectionQuality.samples))),
        updatedAt: Number.isFinite(presence.connectionQuality.updatedAt)
          ? presence.connectionQuality.updatedAt
          : Date.now(),
      }
      : undefined,
    deck: compactDeckSummaryForRelay(presence.deck),
    deckStatus: presence.deckStatus ?? (presence.deck ? 'valid' : 'none'),
    ready: Boolean(presence.ready),
  };
}

function compactPeersForRelay(peers: Record<string, RoomPresence>): Record<string, RoomPresence> {
  return Object.fromEntries(
    Object.entries(peers).map(([peerId, presence]) => [peerId, compactPresenceForRelay(presence)]),
  );
}

function presenceToLobbyPlayer(presence: RoomPresence): LobbyPlayer {
  return {
    playerId: presence.playerId,
    peerId: presence.peerId,
    sessionId: presence.sessionId,
    name: presence.name,
    color: presence.color,
    avatarInitial: presence.avatarInitial,
    avatarStyle: presence.avatarStyle,
    avatarImage: presence.avatarImage,
    seatIndex: presence.isSpectator ? -1 : presence.seatIndex,
    isSpectator: presence.isSpectator,
    isHost: Boolean(presence.isHostPeer),
    connected: presence.online,
    ready: Boolean(presence.ready),
    deckStatus: presence.deckStatus ?? (presence.deck ? 'valid' : 'none'),
    lastSeen: presence.lastSeen,
  };
}

function buildLobbyState(status: LobbyState['status'] = _latestGame?.status === 'playing' ? 'playing' : 'lobby'): LobbyState | null {
  if (!_roomCode) return null;
  const hostPeerId = [..._peers.values()].find(presence => presence.isHostPeer)?.peerId ?? _peerId ?? '';
  return {
    roomId: _roomCode,
    roomCode: _roomCode,
    hostPeerId,
    players: Object.fromEntries([..._peers.values()].map(presence => [presence.playerId, presenceToLobbyPlayer(presence)])),
    submittedDecks: {},
    minPlayers: 2,
    maxPlayers: 6,
    status,
    updatedAt: Date.now(),
  };
}

function refreshLobbyState(status?: LobbyState['status']): LobbyState | null {
  const base = buildLobbyState(status);
  if (!base) return null;
  const submittedDecks: LobbyState['submittedDecks'] = {};
  for (const presence of _peers.values()) {
    if (!presence.deck) continue;
    submittedDecks[presence.playerId] = {
      playerId: presence.playerId,
      deckId: presence.deck.id,
      deckName: presence.deck.name,
      commanderNames: presence.deck.commanders,
      cardCount: presence.deck.cardCount,
      deckHash: presence.deck.deckHash ?? '',
      status: presence.deck.status ?? presence.deckStatus ?? 'none',
      errors: presence.deck.errors ?? [],
      warnings: presence.deck.warnings ?? [],
    };
  }
  _lobbyState = { ...base, submittedDecks };
  _onLobbyUpdate?.(_lobbyState);
  return _lobbyState;
}

function broadcastLobbyState(status?: LobbyState['status']): void {
  const lobby = refreshLobbyState(status);
  if (!lobby) return;
  if (lobby.status === 'playing') {
    debugMultiplayer('host broadcasting lobby.status playing', {
      roomCode: lobby.roomCode,
      playerCount: Object.keys(lobby.players).length,
    });
  }
  const msg: SyncMessage = { type: 'LOBBY_STATE', payload: lobby };
  if (_transportMode === 'firebase') {
    void writeFirebaseRoomSnapshot();
    return;
  }
  if (!_isHost) return;
  for (const conn of _connections.values()) {
    if (conn.open) sendMessage(conn, msg);
  }
}

function isConnectedNonHostSeatedPeer(conn: DataConnection): boolean {
  const presence = _peers.get(conn.peer);
  return Boolean(
    conn.open &&
    presence &&
    !presence.isHostPeer &&
    !presence.isSpectator &&
    presence.seatIndex >= 0
  );
}

function logStartCommitConnectionGate(conn: DataConnection, attempt: number): boolean {
  const presence = _peers.get(conn.peer);
  const eligible = isConnectedNonHostSeatedPeer(conn);
  debugMultiplayer('host start delivery peer gate', {
    attempt,
    connPeer: conn.peer,
    connOpen: conn.open,
    presenceExists: Boolean(presence),
    presenceOnline: presence?.online,
    presencePlayerId: presence?.playerId,
    presencePeerId: presence?.peerId,
    presenceSeatIndex: presence?.seatIndex,
    presenceIsSpectator: presence?.isSpectator,
    isConnectedNonHostSeatedPeer: eligible,
  });
  return eligible;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSelfPresenceFromPeers(
  peers: Record<string, RoomPresence>,
  playerId: string,
  sessionId: string,
  preferredPeerId?: string,
): { peerId: string; presence: RoomPresence } | null {
  const preferred = preferredPeerId ? peers[preferredPeerId] : undefined;
  if (preferredPeerId && preferred && preferred.playerId === playerId && preferred.sessionId === sessionId) {
    return { peerId: preferredPeerId, presence: preferred };
  }

  const matchedEntries = Object.entries(peers)
    .filter(([, presence]) => presence.playerId === playerId && presence.sessionId === sessionId);
  if (matchedEntries.length === 0) return null;

  const fallback = matchedEntries.find(([peerId]) => peerId === preferredPeerId)
    ?? matchedEntries.find(([, presence]) => !presence.isSpectator)
    ?? matchedEntries[0];

  return fallback ? { peerId: fallback[0], presence: fallback[1] } : null;
}

function clamp(ms: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, ms));
}

function retryDelay(attempt: number): number {
  const exponential = FIREBASE_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  const jitter = 0.85 + Math.random() * 0.3;
  return clamp(Math.round(exponential * jitter), FIREBASE_RETRY_BASE_DELAY_MS, FIREBASE_POLL_MS_MAX);
}

function nextFirebasePollDelayMs(): number {
  if (_firebaseErrorStreak === 0) return FIREBASE_POLL_MS;
  const exp = FIREBASE_POLL_MS * 2 ** Math.max(0, _firebaseErrorStreak - 1);
  const jitter = 0.85 + Math.random() * 0.3;
  return clamp(Math.round(exp * jitter), FIREBASE_POLL_MS, FIREBASE_POLL_MS_MAX);
}

async function firebaseRequest<T>(path: string, method: 'GET' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown, attempt = 0): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIREBASE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(firebaseUrl(path), {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Firebase fallback ${method} failed (${response.status})`);
    }
    if (method === 'DELETE') return null as T;
    const text = await response.text();
    return text ? JSON.parse(text) as T : null as T;
  } catch (error: unknown) {
    if (attempt >= FIREBASE_RETRY_MAX_ATTEMPTS) {
      throw error instanceof Error ? error : new Error('Firebase request failed');
    }
    if (error instanceof Error && error.name === 'AbortError') {
      await sleep(retryDelay(attempt + 1));
      return firebaseRequest(path, method, body, attempt + 1);
    }
    if (error instanceof TypeError || error instanceof DOMException) {
      await sleep(retryDelay(attempt + 1));
      return firebaseRequest(path, method, body, attempt + 1);
    }
    await sleep(retryDelay(attempt + 1));
    return firebaseRequest(path, method, body, attempt + 1);
  } finally {
    clearTimeout(timeout);
  }
}

function firebaseRoomPath(code = _roomCode): string {
  if (!code) throw new Error('No room code is active.');
  return `onDaStackRooms/${code.toUpperCase()}`;
}

export function isFirebaseFallbackConfigured(): boolean {
  return firebaseFallbackExplicitlyEnabled() && Boolean(getFirebaseDatabaseUrl());
}

function stopFirebasePolling(): void {
  if (_firebasePollTimer) {
    clearTimeout(_firebasePollTimer);
    _firebasePollTimer = null;
  }
  _firebasePollInFlight = false;
  _firebasePollDelayMs = FIREBASE_POLL_MS;
  _firebaseLastPollError = null;
}

function startFirebasePolling(): void {
  stopFirebasePolling();
  _transportMode = 'firebase';
  _firebasePollDelayMs = FIREBASE_POLL_MS;
  _firebaseErrorStreak = 0;
  _firebaseLastPollError = null;
  _firebaseLastPollAt = Date.now();
  void pollFirebaseRoom();
}

function scheduleFirebasePoll(delayMs: number): void {
  if (_transportMode !== 'firebase' || !_roomCode) return;
  if (_firebasePollTimer) clearTimeout(_firebasePollTimer);
  _firebasePollInFlight = false;
  _firebasePollDelayMs = delayMs;
  _firebasePollTimer = setTimeout(() => {
    if (_transportMode !== 'firebase' || !_roomCode || _firebasePollInFlight) return;
    _firebasePollInFlight = true;
    void pollFirebaseRoom();
  }, delayMs);
}

async function writeFirebaseRoomSnapshot(): Promise<void> {
  if (_transportMode !== 'firebase' || !_roomCode) return;
  assertFirebaseGameSize(_latestGame);
  await firebaseRequest(firebaseRoomPath(), 'PATCH', {
    hostId: _peers.get(_peerId ?? '')?.isHostPeer ? _peerId : undefined,
    game: _latestGame,
    peers: compactPeersForRelay(Object.fromEntries(_peers)),
    lobby: refreshLobbyState() ?? undefined,
    updatedAt: Date.now(),
    expiresAt: Date.now() + FIREBASE_ROOM_TTL_MS,
  });
  _firebaseLastSnapshotAt = Date.now();
}

async function writeFirebasePeerPresence(presence: RoomPresence): Promise<void> {
  if (_transportMode !== 'firebase' || !_roomCode) return;
  await firebaseRequest(`${firebaseRoomPath()}/peers/${presence.peerId}`, 'PUT', compactPresenceForRelay(presence));
}

async function writeFirebaseMessage(message: SyncMessage): Promise<void> {
  if (_transportMode !== 'firebase' || !_roomCode || !_peerId) return;
  if (message.type === 'GAME_STATE') assertFirebaseGameSize(message.payload);
  const envelope = envelopeMessage(message);
  if (!envelope) return;
  await firebaseRequest(`${firebaseRoomPath()}/messages/${_peerId}`, 'PUT', {
    updatedAt: Date.now(),
    message: envelope,
  });
}

function applyFirebasePeers(peers: Record<string, RoomPresence>): void {
  const compactPeers = compactPeersForRelay(peers);
  replacePeers(compactPeers);
  _onPresenceUpdate?.(compactPeers);
}

function applyFirebaseGameFromPeer(peerId: string, game: GameState): boolean {
  const nextGame = resolveIncomingPeerGameState(_latestGame, game, _peers.get(peerId));
  if (!nextGame) return false;
  _latestGame = nextGame;
  _onGameUpdate?.(nextGame);
  reconcilePeerDeckSummaryFromGame(peerId, nextGame);
  return true;
}

async function migrateFirebaseHostBeforeLeave(): Promise<void> {
  if (_transportMode !== 'firebase' || !_roomCode || !_peerId || !_isHost) return;
  const candidates = Object.fromEntries(
    [..._peers.entries()].filter(([peerId, presence]) =>
      peerId !== _peerId && presence.online && !presence.isSpectator && presence.seatIndex >= 0
    ),
  );
  const candidate = chooseMigrationHost(candidates);
  const peers = Object.fromEntries(
    [..._peers.entries()].map(([peerId, presence]) => [
      peerId,
      compactPresenceForRelay({
        ...presence,
        isHostPeer: peerId === candidate?.peerId,
        online: peerId === _peerId ? false : presence.online,
        lastSeen: Date.now(),
      }),
    ]),
  );
  await firebaseRequest(firebaseRoomPath(), 'PATCH', {
    hostId: candidate?.peerId ?? '',
    peers,
    updatedAt: Date.now(),
    expiresAt: Date.now() + FIREBASE_ROOM_TTL_MS,
  });
}

async function pollFirebaseRoom(): Promise<void> {
  if (_transportMode !== 'firebase' || !_roomCode) return;
  const now = Date.now();
  try {
    const room = await firebaseRequest<FirebaseRoomRelay | null>(firebaseRoomPath(), 'GET');
    _firebaseErrorStreak = 0;
    _firebaseLastPollError = null;
    _firebaseLastPollAt = now;
    if (!room) {
      if (!_isHost) setStatus('error');
      scheduleFirebasePoll(nextFirebasePollDelayMs());
      return;
    }
    if (room.expiresAt && room.expiresAt < Date.now()) {
      setStatus('error');
      scheduleFirebasePoll(nextFirebasePollDelayMs());
      return;
    }

    applyFirebasePeers(room.peers ?? {});

    if (!_isHost && room.hostId === _peerId) {
      _isHost = true;
      setStatus('host');
    }

    if (_isHost) {
      let changed = false;
      for (const [peerId, entry] of Object.entries(room.messages ?? {})) {
        if (peerId === _peerId || !entry?.message) continue;
        const parsed = validateMultiplayerMessage(entry.message, _roomCode ?? undefined);
        if (!parsed.ok || !parsed.message) continue;
        const seenAt = _firebaseSeenMessages.get(peerId) ?? 0;
        if ((entry.updatedAt ?? 0) <= seenAt) continue;
        _firebaseSeenMessages.set(peerId, entry.updatedAt ?? Date.now());
        if (parsed.message.type === 'GAME_STATE') {
          changed = applyFirebaseGameFromPeer(peerId, parsed.message.payload as GameState) || changed;
        }
        if (parsed.message.type === 'DECK_SUBMITTED') {
          const presence = _peers.get(peerId);
          if (presence) handleDeckSubmitted(parsed.message.payload as DeckSubmission, presence);
          changed = true;
        }
        if (parsed.message.type === 'PLAYER_READY_CHANGED') {
          const payload = parsed.message.payload as { playerId: string; ready: boolean };
          applyReadyChange(payload.playerId, payload.ready);
          changed = true;
        }
        if (parsed.message.type === 'GAME_STATE_PATCH_REQUEST') {
          debugMultiplayer('host received GAME_STATE_PATCH_REQUEST', {
            peerId,
            reason: (parsed.message.payload as { reason?: string }).reason,
          });
          if (_latestGame && _lobbyState?.status === 'playing') {
            _latestGame = { ..._latestGame, status: 'playing' };
          }
          if (_latestGame) {
          debugMultiplayer('host sending GAME_STATE_PATCH', {
              gameId: _latestGame.id,
              gameStatus: _latestGame.status,
              peerId,
            });
          }
          changed = true;
        }
        if (parsed.message.type === 'START_GAME_ACK') {
          _onStartAck?.(parsed.message.payload as StartGameAck);
        }
        if (parsed.message.type === 'LEAVE_ROOM') {
          if (removePeerFromHostLobby(peerId)) changed = true;
        }
      }
      if (changed) await writeFirebaseRoomSnapshot();
      scheduleFirebasePoll(nextFirebasePollDelayMs());
      return;
    }

    const self = _peerId ? room.peers?.[_peerId] : undefined;
    if (self && (self as RoomPresence & { kicked?: boolean }).kicked) {
      leaveRoom(false);
      return;
    }
    if (room.game) {
      _latestGame = room.game;
      debugMultiplayer('joiner received GAME_STATE_PATCH status', {
        gameId: _latestGame.id,
        gameStatus: _latestGame.status,
      });
      _onGameUpdate?.(room.game);
    }
    if (room.lobby) {
      _lobbyState = room.lobby;
      debugMultiplayer('joiner received LOBBY_STATE status', {
        roomCode: _lobbyState.roomCode,
        lobbyStatus: _lobbyState.status,
      });
      _onLobbyUpdate?.(room.lobby);
    }
    scheduleFirebasePoll(nextFirebasePollDelayMs());
  } catch (error: unknown) {
    _firebaseErrorStreak += 1;
    _firebaseLastPollError = error instanceof Error ? error.message : 'Unknown Firebase polling error';
    _firebaseLastPollAt = Date.now();
    if (!_isHost && _firebaseErrorStreak >= 3) setStatus('error');
    scheduleFirebasePoll(nextFirebasePollDelayMs());
  }
}

async function createFirebaseRoom(
  initialGame: GameState,
  hostPresence: Omit<RoomPresence, 'online' | 'lastSeen'>,
): Promise<string> {
  const code = generateFirebaseRoomCode();
  _transportMode = 'firebase';
  _isHost = true;
  _roomCode = code;
  _peerId = hostPresence.peerId;
  _playerId = hostPresence.playerId;
  _sessionId = hostPresence.sessionId;
  _latestGame = initialGame;
  _peers.clear();
  _deckSubmissions.clear();
  _firebaseSeenMessages.clear();
  const presence: RoomPresence = {
    ...hostPresence,
    isHostPeer: true,
    online: true,
    lastSeen: Date.now(),
  };
  _peers.set(_peerId, presence);
  assertFirebaseGameSize(initialGame);
  await firebaseRequest(firebaseRoomPath(code), 'PUT', {
    hostId: _peerId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + FIREBASE_ROOM_TTL_MS,
    game: initialGame,
    peers: compactPeersForRelay(Object.fromEntries(_peers)),
    lobby: refreshLobbyState() ?? undefined,
    messages: {},
  } satisfies FirebaseRoomRelay);
  setStatus('host');
  startFirebasePolling();
  return code;
}

async function joinFirebaseRoom(
  code: string,
  presence: Omit<RoomPresence, 'online' | 'lastSeen'>,
): Promise<JoinRoomResult> {
  const roomCode = code.toUpperCase().trim();
  const room = await firebaseRequest<FirebaseRoomRelay | null>(firebaseRoomPath(roomCode), 'GET');
  if (!room) throw new Error(`Room ${roomCode} not found in Firebase fallback.`);
  if (room.expiresAt && room.expiresAt < Date.now()) throw new Error(`Room ${roomCode} expired in Firebase fallback.`);

  _transportMode = 'firebase';
  _isHost = false;
  _roomCode = roomCode;
  _peerId = presence.peerId;
  _playerId = presence.playerId;
  _sessionId = presence.sessionId;
  _latestGame = room.game;
  _firebaseSeenMessages.clear();
  replacePeers(room.peers ?? {});
  if (room.lobby) {
    _lobbyState = room.lobby;
    _onLobbyUpdate?.(room.lobby);
  }

  const assignment = chooseAutomaticSeat(room.peers ?? {}, room.game?.config.playerCount ?? 0, presence as RoomPresence);
  const finalPresence: RoomPresence = {
    ...presence,
    isHostPeer: false,
    isSpectator: assignment.isSpectator,
    seatIndex: assignment.seatIndex,
    online: true,
    lastSeen: Date.now(),
  };
  _peers.set(_peerId, finalPresence);
  await writeFirebasePeerPresence(finalPresence);
  const peers = Object.fromEntries(_peers);
  setStatus('joined');
  startFirebasePolling();
  return {
    game: room.game,
    hostId: room.hostId,
    peerId: _peerId,
    peers,
    isSpectator: assignment.isSpectator,
    seatIndex: assignment.seatIndex,
  };
}

function broadcastPresence() {
  if (!_isHost) return;
  const payload = Object.fromEntries(_peers);
  for (const conn of _connections.values()) {
    sendMessage(conn, { type: 'PRESENCE_BROADCAST', payload });
  }
  _onPresenceUpdate?.(payload);
  broadcastLobbyState();
}

function generateRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function generateFirebaseRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'F';
  const bytes = new Uint8Array(FIREBASE_ROOM_CODE_LENGTH - 1);
  crypto.getRandomValues(bytes);
  for (const value of bytes) {
    code += chars[value % chars.length];
  }
  return code;
}

function hostPeerId(code: string): string {
  return `${ROOM_PREFIX}${code}`;
}

function migratedHostPeerId(code: string, candidatePeerId: string): string {
  return `${ROOM_PREFIX}${code}-host-${candidatePeerId.slice(0, 12)}`;
}

function scoreForRtt(rttMs: number): number {
  if (!Number.isFinite(rttMs)) return 0;
  return Math.max(0, Math.round(1000 - Math.min(rttMs, 1000)));
}

function updatePeerQuality(peerId: string, rttMs: number): void {
  const existing = _peers.get(peerId);
  if (!existing) return;
  const previous = existing.connectionQuality;
  const samples = Math.min((previous?.samples ?? 0) + 1, 20);
  const smoothed = previous
    ? Math.round((previous.rttMs * (samples - 1) + rttMs) / samples)
    : Math.round(rttMs);
  _peers.set(peerId, {
    ...existing,
    lastSeen: Date.now(),
    connectionQuality: {
      rttMs: smoothed,
      score: scoreForRtt(smoothed),
      samples,
      updatedAt: Date.now(),
    },
  });
}

function markKnownHostOffline(): void {
  for (const [peerId, presence] of _peers.entries()) {
    if (presence.isHostPeer) {
      _peers.set(peerId, { ...presence, online: false, lastSeen: Date.now() });
    }
  }
}

function presenceIdentityKey(presence: Pick<RoomPresence, 'name'>): string {
  return presence.name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function pruneDuplicatePeerPresence(
  peers: Record<string, RoomPresence>,
  incoming: Pick<RoomPresence, 'peerId' | 'name'>,
): Record<string, RoomPresence> {
  const incomingKey = presenceIdentityKey(incoming);
  if (!incomingKey) return peers;
  return Object.fromEntries(
    Object.entries(peers).filter(([peerId, presence]) => (
      peerId === incoming.peerId ||
      presence.online ||
      presenceIdentityKey(presence) !== incomingKey
    )),
  );
}

function replacePeers(nextPeers: Record<string, RoomPresence>): void {
  _peers.clear();
  for (const [peerId, presence] of Object.entries(nextPeers)) {
    _peers.set(peerId, presence);
  }
}

function pruneStaleDuplicatePresence(incoming: RoomPresence): void {
  replacePeers(pruneDuplicatePeerPresence(Object.fromEntries(_peers), incoming));
}

function isTerminalDeckStatus(status?: RoomPresence['deckStatus']): boolean {
  return status === 'valid' || status === 'rejected';
}

export function mergePresenceWithHostDeckAuthority(existing: RoomPresence | undefined, incoming: RoomPresence): RoomPresence {
  const incomingStatus = incoming.deckStatus ?? incoming.deck?.status;
  if (!existing || !isTerminalDeckStatus(existing.deckStatus ?? existing.deck?.status)) {
    if (!isTerminalDeckStatus(incomingStatus)) return incoming;
    return {
      ...incoming,
      deck: incoming.deck ? { ...incoming.deck, status: 'submitted' } : incoming.deck,
      deckStatus: incoming.deck ? 'submitted' : 'none',
      ready: false,
    };
  }
  return {
    ...incoming,
    deck: existing.deck,
    deckStatus: existing.deckStatus ?? existing.deck?.status,
    ready: existing.ready,
  };
}

function upsertPresenceFromPeer(incoming: RoomPresence, assignment: { isSpectator: boolean; seatIndex: number }): RoomPresence {
  const existingForPeer = _peers.get(incoming.peerId);
  const authoritativeIncoming = mergePresenceWithHostDeckAuthority(existingForPeer, incoming);
  for (const [peerId, existing] of _peers.entries()) {
    const sameIdentity = existing.playerId === authoritativeIncoming.playerId
      && existing.sessionId === authoritativeIncoming.sessionId;
    if (!sameIdentity || peerId === authoritativeIncoming.peerId) continue;
    if (existing.isHostPeer && !authoritativeIncoming.isHostPeer) {
      continue;
    }
    _peers.delete(peerId);
    const oldConn = _connections.get(peerId);
    if (oldConn) cleanupConnection(oldConn);
    _connections.delete(peerId);
    const preservedSeat = existing.isSpectator ? -1 : existing.seatIndex;
    const mergedIncoming = mergePresenceWithHostDeckAuthority(existing, authoritativeIncoming);
    const next: RoomPresence = {
      ...existing,
      ...mergedIncoming,
      peerId: authoritativeIncoming.peerId,
      isHostPeer: false,
      isSpectator: authoritativeIncoming.isSpectator,
      seatIndex: authoritativeIncoming.isSpectator ? -1 : preservedSeat,
      online: true,
      lastSeen: Date.now(),
      ready: isTerminalDeckStatus(existing.deckStatus ?? existing.deck?.status) ? existing.ready : mergedIncoming.ready,
      deck: isTerminalDeckStatus(existing.deckStatus ?? existing.deck?.status) ? existing.deck : existing.deck ?? mergedIncoming.deck,
      deckStatus: isTerminalDeckStatus(existing.deckStatus ?? existing.deck?.status) ? existing.deckStatus : existing.deckStatus ?? mergedIncoming.deckStatus,
    };
    _peers.set(authoritativeIncoming.peerId, next);
    return next;
  }

  const next: RoomPresence = {
    ...authoritativeIncoming,
    isHostPeer: false,
    isSpectator: assignment.isSpectator,
    seatIndex: assignment.seatIndex,
    online: true,
    lastSeen: Date.now(),
    ready: Boolean(authoritativeIncoming.ready),
    deckStatus: authoritativeIncoming.deckStatus ?? (authoritativeIncoming.deck ? 'valid' : 'none'),
  };
  _peers.set(authoritativeIncoming.peerId, next);
  return next;
}

export function chooseMigrationHost(
  peers: Record<string, RoomPresence>,
  currentPeerId?: string | null,
): RoomPresence | null {
  const candidates = Object.values(peers)
    .filter(peer => peer.online && !peer.isSpectator && peer.seatIndex >= 0);
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    const scoreDelta = (b.connectionQuality?.score ?? 0) - (a.connectionQuality?.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    const selfDelta = Number(b.peerId === currentPeerId) - Number(a.peerId === currentPeerId);
    if (selfDelta !== 0) return selfDelta;
    const seatDelta = a.seatIndex - b.seatIndex;
    if (seatDelta !== 0) return seatDelta;
    return a.peerId.localeCompare(b.peerId);
  })[0];
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function playerHasLoadedDeck(player?: Player): boolean {
  return Boolean(player?.deckId && ((player.library?.length ?? 0) > 0 || (player.commandZone?.length ?? 0) > 0));
}

function summarizePlayerDeckFromGame(game: GameState, player: Player, existing?: RoomDeckSummary): RoomDeckSummary | undefined {
  if (!playerHasLoadedDeck(player) || !player.deckId) return undefined;
  return {
    id: player.deckId,
    name: existing?.id === player.deckId ? existing.name : 'Loaded deck',
    cardCount: player.library.length + player.commandZone.length,
    commanders: player.commandZone
      .map(instanceId => game.cards[instanceId]?.definition.name)
      .filter((name): name is string => Boolean(name))
      .slice(0, 2),
  };
}

function reconcilePeerDeckSummaryFromGame(peerId: string, game: GameState): boolean {
  const presence = _peers.get(peerId);
  if (!presence || presence.isSpectator || presence.seatIndex < 0) return false;
  const player = game.players[presence.seatIndex];
  if (!player) return false;
  const deck = summarizePlayerDeckFromGame(game, player, presence.deck);
  if (
    presence.deck?.id === deck?.id &&
    presence.deck?.name === deck?.name &&
    presence.deck?.cardCount === deck?.cardCount &&
    (presence.deck?.commanders ?? []).join('|') === (deck?.commanders ?? []).join('|')
  ) {
    return false;
  }
  _peers.set(peerId, { ...presence, deck, lastSeen: Date.now() });
  _onPresenceUpdate?.(Object.fromEntries(_peers));
  return true;
}

export function clearHostSeatDeckState(hostGame: GameState, presence: RoomPresence): GameState | null {
  if (hostGame.status !== 'lobby') return null;
  const hostPlayer = hostGame.players[presence.seatIndex];
  if (!hostPlayer || !playerHasLoadedDeck(hostPlayer)) return null;

  const ownedCardIds = new Set([
    ...hostPlayer.library,
    ...hostPlayer.hand,
    ...hostPlayer.battlefield,
    ...hostPlayer.graveyard,
    ...hostPlayer.exile,
    ...hostPlayer.sideboard,
    ...hostPlayer.maybeboard,
    ...hostPlayer.commandZone,
    ...hostPlayer.commanders,
  ]);
  const cards = Object.fromEntries(
    Object.entries(hostGame.cards).filter(([id, card]) => (
      !ownedCardIds.has(id) &&
      card.ownerId !== hostPlayer.id &&
      card.controllerId !== hostPlayer.id
    )),
  );
  const players = hostGame.players.map((player, index) => index === presence.seatIndex ? {
    ...hostPlayer,
    deckId: undefined,
    commanders: [],
    commanderDamage: {},
    commanderCastCount: {},
    hand: [],
    library: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    sideboard: [],
    maybeboard: [],
    commandZone: [],
  } : player);

  return {
    ...hostGame,
    players,
    cards,
    stack: hostGame.stack.filter(item => !ownedCardIds.has(item.sourceInstanceId ?? '')),
    triggerQueue: hostGame.triggerQueue.filter(trigger => !ownedCardIds.has(trigger.sourceInstanceId ?? '')),
    lastUpdatedAt: Date.now(),
  };
}

function remapCardOwner(card: CardState, remotePlayerId: string, hostPlayerId: string): CardState {
  if (remotePlayerId === hostPlayerId) return card;
  return {
    ...card,
    ownerId: card.ownerId === remotePlayerId ? hostPlayerId : card.ownerId,
    controllerId: card.controllerId === remotePlayerId ? hostPlayerId : card.controllerId,
  };
}

export function mergeRemoteSeatDeckState(
  hostGame: GameState,
  remoteGame: GameState,
  presence?: RoomPresence,
): GameState | null {
  if (!presence || presence.isSpectator || presence.seatIndex < 0) return null;

  const hostPlayer = hostGame.players[presence.seatIndex];
  if (!hostPlayer) return null;

  const remotePlayer = remoteGame.players.find(player => player.id === hostPlayer.id)
    ?? remoteGame.players[presence.seatIndex];
  if (!playerHasLoadedDeck(remotePlayer)) return clearHostSeatDeckState(hostGame, presence);

  const remotePlayerId = remotePlayer.id;
  const hostPlayerId = hostPlayer.id;
  const remoteOwnedCards = Object.fromEntries(
    Object.entries(remoteGame.cards)
      .filter(([, card]) => card.ownerId === remotePlayerId || card.controllerId === remotePlayerId)
      .map(([id, card]) => [id, remapCardOwner(card, remotePlayerId, hostPlayerId)]),
  );
  const hostCardsWithoutSeatDeck = Object.fromEntries(
    Object.entries(hostGame.cards)
      .filter(([, card]) => card.ownerId !== hostPlayerId && card.controllerId !== hostPlayerId),
  );

  const players = hostGame.players.map((player, index) => index === presence.seatIndex ? {
    ...hostPlayer,
    deckId: remotePlayer.deckId,
    commanders: [...remotePlayer.commanders],
    commanderDamage: { ...remotePlayer.commanderDamage },
    commanderCastCount: { ...remotePlayer.commanderCastCount },
    hand: [...remotePlayer.hand],
    library: [...remotePlayer.library],
    battlefield: [...remotePlayer.battlefield],
    graveyard: [...remotePlayer.graveyard],
    exile: [...remotePlayer.exile],
    sideboard: [...remotePlayer.sideboard],
    maybeboard: [...remotePlayer.maybeboard],
    commandZone: [...remotePlayer.commandZone],
  } : player);

  return {
    ...hostGame,
    players,
    cards: { ...hostCardsWithoutSeatDeck, ...remoteOwnedCards },
    definitions: { ...hostGame.definitions, ...remoteGame.definitions },
    lastUpdatedAt: Date.now(),
  };
}

export function resolveIncomingPeerGameState(
  hostGame: GameState | null,
  remoteGame: GameState,
  presence?: RoomPresence,
): GameState | null {
  if (!hostGame) return remoteGame;
  const mergedDeckState = mergeRemoteSeatDeckState(hostGame, remoteGame, presence);
  if (mergedDeckState) return mergedDeckState;
  if (hostGame.status === 'lobby') return null;
  return remoteGame.lastUpdatedAt > hostGame.lastUpdatedAt ? remoteGame : null;
}

function applyIncomingGameFromPeer(conn: DataConnection, game: GameState): void {
  const nextGame = resolveIncomingPeerGameState(_latestGame, game, _peers.get(conn.peer));

  if (!nextGame) return;
  _latestGame = nextGame;
  _onGameUpdate?.(nextGame);
  const presenceChanged = reconcilePeerDeckSummaryFromGame(conn.peer, nextGame);
  if (presenceChanged) broadcastPresence();
  broadcastState(nextGame);
}

export function initMultiplayer(
  onGameUpdate: (game: GameState) => void,
  onPresenceUpdate: (players: Record<string, RoomPresence>) => void,
  onStatusChange: (status: SyncStatus) => void,
  onStartPrepare?: (prepare: StartGamePrepare) => void,
  onStartAck?: (ack: StartGameAck) => void,
  onStartCommit?: (commit: StartGameCommit) => void,
  onLobbyUpdate?: (lobby: LobbyState) => void,
  onDeckSubmitted?: (submission: DeckSubmission, presence: RoomPresence) => void | Promise<void>,
  onGameActionRequest?: (request: GameActionRequestPayload, presence: RoomPresence) => void,
): void {
  _onGameUpdate = onGameUpdate;
  _onPresenceUpdate = onPresenceUpdate;
  _onStatusChange = onStatusChange;
  _onStartPrepare = onStartPrepare ?? null;
  _onStartAck = onStartAck ?? null;
  _onStartCommit = onStartCommit ?? null;
  _onLobbyUpdate = onLobbyUpdate ?? null;
  _onDeckSubmitted = onDeckSubmitted ?? null;
  _onGameActionRequest = onGameActionRequest ?? null;
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getRoomCode(): string | null { return _roomCode; }
export function getPeerId(): string | null   { return _peerId; }
export function getPlayerId(): string | null { return _playerId; }
export function getSessionId(): string | null { return _sessionId; }
export function getIsHost(): boolean         { return _isHost; }
export function getTransportMode(): 'peerjs' | 'firebase' { return _transportMode; }
export function getFirebaseRelayHealth(): FirebaseRelayHealth {
  return {
    configured: isFirebaseFallbackConfigured(),
    active: _transportMode === 'firebase' && _firebasePollTimer !== null,
    roomCode: _roomCode,
    transportMode: _transportMode,
    pollIntervalMs: _firebasePollDelayMs,
    lastPollAt: _firebaseLastPollAt || null,
    consecutivePollErrors: _firebaseErrorStreak,
    lastPollError: _firebaseLastPollError,
    lastSnapshotAt: _firebaseLastSnapshotAt || null,
    lastSnapshotAgeMs: _firebaseLastSnapshotAt ? Date.now() - _firebaseLastSnapshotAt : null,
  };
}
export function getSyncStatus(): SyncStatus  { return _status; }
export function getLobbyState(): LobbyState | null { return _lobbyState; }

/** Always true — P2P needs no env vars or server config */
export function isConfigured(): boolean { return true; }

export function chooseAutomaticSeat(
  peers: Record<string, RoomPresence>,
  seatCount: number,
  presence: RoomPresence,
): { isSpectator: boolean; seatIndex: number } {
  if (presence.isSpectator) return { isSpectator: true, seatIndex: -1 };

  const takenSeats = new Set(
    Object.values(peers)
      .filter(p => p.online && !p.isSpectator && p.peerId !== presence.peerId && p.seatIndex >= 0)
      .map(p => p.seatIndex),
  );
  const resolvedSeatCount = seatCount > 0 ? seatCount : Math.max(0, ...takenSeats) + 1;
  const seatIndex = Array.from({ length: resolvedSeatCount }, (_, index) => index)
    .find(index => !takenSeats.has(index));

  return typeof seatIndex === 'number'
    ? { isSpectator: false, seatIndex }
    : { isSpectator: true, seatIndex: -1 };
}

function autoAssignSeat(presence: RoomPresence): { isSpectator: boolean; seatIndex: number } {
  return chooseAutomaticSeat(Object.fromEntries(_peers), _latestGame?.config.playerCount ?? 0, presence);
}

function handleDeckSubmitted(submission: DeckSubmission, presence: RoomPresence): SubmittedDeckPublicSummary {
  const authoritativePresence = _peers.get(presence.peerId) ?? presence;
  if (submission.playerId !== authoritativePresence.playerId) {
    const rejected = publicDeckSummary({ ...submission, playerId: authoritativePresence.playerId }, 'rejected', [], ['Deck submission player id did not match the connection identity.']);
    sendDeckValidationToPeer(authoritativePresence.peerId, rejected, false);
    return rejected;
  }

  _deckSubmissions.set(submission.playerId, submission);
  const validation = validateDeckSubmission(submission);
  const status = validation.valid ? 'valid' : 'rejected';
  const summary = publicDeckSummary(submission, status, validation.warnings, validation.errors);
  _peers.set(authoritativePresence.peerId, {
    ...authoritativePresence,
    deck: {
      id: summary.deckId,
      name: summary.deckName,
      cardCount: summary.cardCount,
      commanders: summary.commanderNames,
      deckHash: summary.deckHash,
      status,
      errors: summary.errors,
      warnings: summary.warnings,
    },
    deckStatus: status,
    ready: validation.valid ? authoritativePresence.ready : false,
    lastSeen: Date.now(),
  });
  void _onDeckSubmitted?.(submission, _peers.get(authoritativePresence.peerId)!);
  sendDeckValidationToPeer(authoritativePresence.peerId, summary, validation.valid);
  broadcastPresence();
  broadcastLobbyState();
  return summary;
}

function sendDeckValidationToPeer(peerId: string, summary: SubmittedDeckPublicSummary, valid: boolean): void {
  const msg: SyncMessage = { type: valid ? 'DECK_VALIDATED' : 'DECK_REJECTED', payload: summary };
  if (_transportMode === 'firebase') {
    if (_isHost) void writeFirebaseRoomSnapshot();
    return;
  }
  const conn = _connections.get(peerId);
  if (conn?.open) sendMessage(conn, msg);
}

function clearDeckSubmissionFallback(): void {
  if (_deckSubmissionFallbackTimer) {
    clearTimeout(_deckSubmissionFallbackTimer);
    _deckSubmissionFallbackTimer = null;
  }
}

function sendDeckSubmissionToHost(submission: DeckSubmission): void {
  const msg: SyncMessage = { type: 'DECK_SUBMITTED', payload: submission };
  if (_transportMode === 'firebase') {
    void writeFirebaseMessage(msg);
  } else if (_hostConn?.open) {
    sendMessage(_hostConn, msg);
  }
}

export function requestGameStatePatch(reason = 'manual-resync'): boolean {
  if (_isHost || !_playerId || !_peerId) return false;
  const msg: SyncMessage = {
    type: 'GAME_STATE_PATCH_REQUEST',
    payload: { reason, sentAt: Date.now() },
  };
  if (_transportMode === 'firebase') {
    void writeFirebaseMessage(msg);
    return true;
  }
  if (_hostConn?.open) {
    sendMessage(_hostConn, msg);
    return true;
  }
  return false;
}

function requestFreshGameStatePatch(reason: string): void {
  requestGameStatePatch(reason);
}

function scheduleDeckSubmissionFallback(submission: DeckSubmission): void {
  clearDeckSubmissionFallback();
  if (_isHost) return;
  _lastLocalDeckSubmission = submission;
  _deckSubmissionFallbackUsed = false;
  _deckSubmissionFallbackTimer = setTimeout(() => {
    _deckSubmissionFallbackTimer = null;
    if (_isHost || _deckSubmissionFallbackUsed || !_lastLocalDeckSubmission || !_peerId) return;
    const self = _peers.get(_peerId);
    const status = self?.deckStatus ?? self?.deck?.status;
    if (status !== 'submitted') return;
    _deckSubmissionFallbackUsed = true;
    sendDeckSubmissionToHost(_lastLocalDeckSubmission);
  }, DECK_SUBMISSION_FALLBACK_MS);
}

function applyReadyChange(playerId: string, ready: boolean): boolean {
  const entry = [..._peers.entries()].find(([, presence]) => presence.playerId === playerId);
  if (!entry) return false;
  const [peerId, presence] = entry;
  const canReady = ready ? presence.deckStatus === 'valid' || presence.deck?.status === 'valid' : true;
  _peers.set(peerId, {
    ...presence,
    ready: canReady ? ready : false,
    lastSeen: Date.now(),
  });
  broadcastPresence();
  broadcastLobbyState();
  return canReady;
}

function handleGameActionRequest(request: GameActionRequestPayload, presence: RoomPresence): void {
  const lastSeq = _lastActionSeqByPlayer.get(presence.playerId) ?? -1;
  if (!Number.isInteger(request.actionSeq) || request.actionSeq <= lastSeq) return;
  _lastActionSeqByPlayer.set(presence.playerId, request.actionSeq);
  _onGameActionRequest?.(request, presence);
}

function attachHostConnectionHandlers(peer: Peer): void {
  peer.on('connection', (conn: DataConnection) => {
    _connections.set(conn.peer, conn);
    watchPeerConnection(conn, () => markPeerOffline(conn));

    conn.on('open', () => {
      const lobby = refreshLobbyState();
      if (lobby) sendMessage(conn, { type: 'LOBBY_STATE', payload: lobby });
      if (_latestGame?.status === 'playing') {
        sendSanitizedGamePatch(conn);
      }
      broadcastPresence();
    });

    conn.on('data', (raw: unknown) => {
      const msg = parseSyncMessage(raw);
      if (!msg) return;
      if (msg.type === 'PRESENCE') {
        const presence = msg.payload as RoomPresence;
        pruneStaleDuplicatePresence(presence);
        const assignment = autoAssignSeat(presence);
        upsertPresenceFromPeer(presence, assignment);
        broadcastPresence();
        broadcastLobbyState();
        sendSanitizedGamePatch(conn);
      }
      if (msg.type === 'LEAVE_ROOM') {
        cleanupConnection(conn);
        removePeerFromHostLobby(conn.peer);
        _connections.delete(conn.peer);
        conn.close();
        broadcastPresence();
        broadcastLobbyState();
      }
      if (msg.type === 'GAME_STATE') {
        // Legacy full-state messages from joiners are intentionally ignored.
      }
      if (msg.type === 'DECK_SUBMITTED') {
        const presence = _peers.get(conn.peer);
        if (presence) handleDeckSubmitted(msg.payload as DeckSubmission, presence);
      }
      if (msg.type === 'PLAYER_READY_CHANGED') {
        const payload = msg.payload as { playerId: string; ready: boolean };
        applyReadyChange(payload.playerId, payload.ready);
      }
      if (msg.type === 'GAME_ACTION_REQUEST') {
        const presence = _peers.get(conn.peer);
        if (presence) handleGameActionRequest(msg.payload as GameActionRequestPayload, presence);
      }
      if (msg.type === 'GAME_STATE_PATCH_REQUEST') {
        debugMultiplayer('host received GAME_STATE_PATCH_REQUEST', {
          peerId: conn.peer,
          reason: (msg.payload as { reason?: string }).reason,
        });
        const patchGame = _latestGame && _lobbyState?.status === 'playing'
          ? { ..._latestGame, status: 'playing' as const }
          : _latestGame;
        sendSanitizedGamePatch(conn, patchGame, { coalesceState: false });
      }
      if (msg.type === 'START_GAME_ACK') {
        debugMultiplayer('host receiving START_GAME_ACK', {
          id: (msg.payload as StartGameAck).id,
          playerId: (msg.payload as StartGameAck).playerId,
          peerId: (msg.payload as StartGameAck).peerId,
          ready: (msg.payload as StartGameAck).ready,
          reason: (msg.payload as StartGameAck).reason,
        });
        _onStartAck?.(msg.payload as StartGameAck);
      }
      if (msg.type === 'PING') {
        const payload = msg.payload as { sentAt?: number } | undefined;
        sendMessage(conn, { type: 'PONG', payload: { sentAt: payload?.sentAt ?? Date.now() } });
      }
      if (msg.type === 'PONG') {
        const payload = msg.payload as { sentAt?: number } | undefined;
        if (typeof payload?.sentAt === 'number') {
          updatePeerQuality(conn.peer, Date.now() - payload.sentAt);
          broadcastPresence();
        }
      }
    });

    conn.on('close', () => {
      markPeerOffline(conn);
    });

    conn.on('error', () => {
      cleanupConnection(conn);
      _connections.delete(conn.peer);
    });
  });
}

function startHostMigration(reason: HostMigrationNotice['reason'] = 'host-disconnected'): void {
  if (_isHost || !_roomCode || !_peerId) return;
  if (_migrationTimer) return;
  setStatus('migrating');
  markKnownHostOffline();

  _migrationTimer = setTimeout(() => {
    _migrationTimer = null;
    const peerRecord = Object.fromEntries(_peers);
    const candidate = chooseMigrationHost(peerRecord, _peerId);
    if (!candidate) {
      setStatus('disconnected');
      return;
    }
    if (candidate.peerId === _peerId) {
      becomeMigratedHost(reason);
    } else {
      connectToMigratedHost(candidate.peerId);
    }
  }, HOST_MIGRATION_DELAY_MS);
}

function becomeMigratedHost(reason: HostMigrationNotice['reason']): void {
  if (!_roomCode || !_peerId) return;
  _isHost = true;
  _stopHeartbeat();
  if (_hostConn) { cleanupConnection(_hostConn); _hostConn.close(); _hostConn = null; }
  cleanupAllConnections();
  if (_peer) { _peer.destroy(); _peer = null; }

  for (const [peerId, presence] of _peers.entries()) {
    _peers.set(peerId, { ...presence, isHostPeer: peerId === _peerId });
  }
  const self = _peers.get(_peerId);
  if (self) _peers.set(_peerId, { ...self, isHostPeer: true, online: true, lastSeen: Date.now() });

  const peer = new Peer(migratedHostPeerId(_roomCode, _peerId), PEER_CONFIG);
  _peer = peer;
  attachHostConnectionHandlers(peer);

  peer.on('open', () => {
    setStatus('host');
    const notice: HostMigrationNotice = {
      candidatePeerId: _peerId!,
      reason,
      roomCode: _roomCode!,
      game: _latestGame,
      peers: Object.fromEntries(_peers),
    };
    for (const conn of _connections.values()) {
      sendMessage(conn, { type: 'HOST_MIGRATION', payload: notice });
    }
    broadcastPresence();
    if (_latestGame) broadcastState(_latestGame);
    _startHeartbeat();
  });

  peer.on('error', () => {
    setStatus('error');
  });
}

function connectToMigratedHost(candidatePeerId: string): void {
  if (!_peer || !_roomCode || !_peerId) return;
  const self = _peers.get(_peerId);
  const conn = _peer.connect(migratedHostPeerId(_roomCode, candidatePeerId), {
    reliable: true,
    serialization: 'json',
  });
  _hostConn = conn;
  watchPeerConnection(conn, () => startHostMigration('host-disconnected'));

  conn.on('open', () => {
    const presence: RoomPresence = {
      playerId: self?.playerId ?? _playerId!,
      peerId: _peerId!,
      sessionId: self?.sessionId ?? _sessionId!,
      name: self?.name ?? 'Player',
      color: self?.color ?? '#3b82f6',
      avatarInitial: self?.avatarInitial,
      avatarStyle: self?.avatarStyle,
      avatarImage: self?.avatarImage,
      seatIndex: self?.seatIndex ?? -1,
      isSpectator: self?.isSpectator ?? true,
      isHostPeer: false,
      connectionQuality: self?.connectionQuality,
      online: true,
      lastSeen: Date.now(),
    };
    sendMessage(conn, {
      type: 'PRESENCE',
      payload: presence,
    });
    setStatus('joined');
    _startHeartbeat();
  });

  conn.on('data', (raw: unknown) => handleJoinerMessage(conn, raw));
  conn.on('close', () => {
    cleanupConnection(conn);
    startHostMigration('host-disconnected');
  });
  conn.on('error', () => {
    cleanupConnection(conn);
    startHostMigration('host-disconnected');
  });
}

function handleJoinerMessage(conn: DataConnection, raw: unknown): void {
  const summary = summarizeRawMessage(raw);
  debugMultiplayer('joiner raw data received', {
    rawType: summary.type,
    rawProtocolVersion: summary.protocolVersion,
    rawRoomId: summary.roomId,
  });
  const msg = parseSyncMessage(raw);
  if (!msg) return;

  if (msg.type === 'KICKED') {
    leaveRoom(false);
    return;
  }

  if (msg.type === 'PRESENCE_BROADCAST') {
    const players = msg.payload as Record<string, RoomPresence>;
    _peers.clear();
    for (const [peerId, presence] of Object.entries(players)) {
      _peers.set(peerId, presence);
    }
    _onPresenceUpdate?.(players);
  }

  if (msg.type === 'LOBBY_STATE') {
    _lobbyState = msg.payload as LobbyState;
    debugMultiplayer('joiner received LOBBY_STATE status', {
      roomCode: _lobbyState.roomCode,
      lobbyStatus: _lobbyState.status,
    });
    _onLobbyUpdate?.(_lobbyState);
    if (_lobbyState.status === 'playing' && _latestGame?.status !== 'playing') {
      debugMultiplayer('joiner received playing LOBBY_STATE without playing game; requesting patch', {
        roomCode: _lobbyState.roomCode,
      });
      requestFreshGameStatePatch('lobby-playing-without-game');
    }
  }

  if (msg.type === 'DECK_VALIDATED' || msg.type === 'DECK_REJECTED') {
    const summary = msg.payload as SubmittedDeckPublicSummary;
    const self = _peerId ? _peers.get(_peerId) : undefined;
    if (self && self.playerId === summary.playerId) {
      _peers.set(self.peerId, {
        ...self,
        deckStatus: summary.status,
        ready: summary.status === 'valid' ? self.ready : false,
        deck: {
          id: summary.deckId,
          name: summary.deckName,
          cardCount: summary.cardCount,
          commanders: summary.commanderNames,
          deckHash: summary.deckHash,
          status: summary.status,
          errors: summary.errors,
          warnings: summary.warnings,
        },
        lastSeen: Date.now(),
      });
      if (summary.status === 'valid' || summary.status === 'rejected') {
        clearDeckSubmissionFallback();
        _lastLocalDeckSubmission = null;
      }
      _onPresenceUpdate?.(Object.fromEntries(_peers));
    }
  }

  if (msg.type === 'GAME_STATE') {
    _latestGame = msg.payload as GameState;
    if (_latestGame) _onGameUpdate?.(_latestGame);
  }

  if (msg.type === 'GAME_STATE_PATCH') {
    const patch = msg.payload as GameStatePatchPayload;
    if (patch.sanitizedGame) {
      _latestGame = patch.sanitizedGame;
      debugMultiplayer('joiner received GAME_STATE_PATCH status', {
        gameId: _latestGame.id,
        gameStatus: _latestGame.status,
        seq: patch.seq,
      });
      if (_latestGame.status === 'playing' && _lobbyState) {
        _lobbyState = { ..._lobbyState, status: 'playing', updatedAt: Date.now() };
        _onLobbyUpdate?.(_lobbyState);
      }
      _onGameUpdate?.(patch.sanitizedGame);
    }
  }

  if (msg.type === 'START_GAME_PREPARE') {
    debugMultiplayer('joiner receiving START_GAME_PREPARE', {
      id: (msg.payload as StartGamePrepare).id,
      requiredPeerIds: (msg.payload as StartGamePrepare).requiredPeerIds,
    });
    _onStartPrepare?.(msg.payload as StartGamePrepare);
  }

  if (msg.type === 'START_GAME_COMMIT') {
    const commit = msg.payload as StartGameCommit;
    debugMultiplayer('joiner received START_GAME_COMMIT', {
      id: commit.id,
      gameId: commit.gameId ?? commit.game.id,
      status: commit.game.status,
    });
    _latestGame = { ...commit.game, status: 'playing' };
    if (_latestGame.status === 'playing' && _lobbyState) {
      _lobbyState = { ..._lobbyState, status: 'playing', updatedAt: Date.now() };
      _onLobbyUpdate?.(_lobbyState);
    }
    _onStartCommit?.({ ...commit, game: _latestGame });
  }

  if (msg.type === 'HOST_MIGRATION') {
    const notice = msg.payload as HostMigrationNotice;
    _latestGame = notice.game;
    _peers.clear();
    for (const [peerId, presence] of Object.entries(notice.peers)) {
      _peers.set(peerId, presence);
    }
    if (notice.candidatePeerId === _peerId) {
      becomeMigratedHost(notice.reason);
    } else {
      connectToMigratedHost(notice.candidatePeerId);
    }
  }

  if (msg.type === 'PONG') {
    const payload = msg.payload as { sentAt?: number } | undefined;
    if (typeof payload?.sentAt === 'number' && _peerId) {
      updatePeerQuality(_peerId, Date.now() - payload.sentAt);
      updatePresence({ connectionQuality: _peers.get(_peerId)?.connectionQuality });
    }
  }

  if (msg.type === 'PING') {
    const payload = msg.payload as { sentAt?: number } | undefined;
    sendMessage(conn, { type: 'PONG', payload: { sentAt: payload?.sentAt ?? Date.now() } });
  }
}

// ─── Create Room (host) ───────────────────────────────────────────────────────

export async function createRoom(
  _initialGame: GameState,
  hostPresence: Omit<RoomPresence, 'online' | 'lastSeen'>,
): Promise<string> {
  setStatus('connecting');
  _transportMode = 'peerjs';
  _isHost = true;
  _latestGame = _initialGame;
  cleanupAllConnections();
  _peers.clear();

  const code = generateRoomCode();
  _roomCode = code;
  _peerId = hostPeerId(code);
  _playerId = hostPresence.playerId;
  _sessionId = hostPresence.sessionId;
  _messageSeq = 0;
  _gamePatchSeq = 0;
  _deckSubmissions.clear();
  _lastActionSeqByPlayer.clear();

  // Register our own presence
  _peers.set(_peerId, {
    ...hostPresence,
    peerId: _peerId,
    isHostPeer: true,
    isSpectator: hostPresence.isSpectator,
    online: true,
      lastSeen: Date.now(),
    });

  return new Promise((resolve, reject) => {
    // Host peer ID = room code so joiners can connect directly
    const peer = new Peer(hostPeerId(code), PEER_CONFIG);
    _peer = peer;

    peer.on('open', () => {
      setStatus('host');
      broadcastPresence();
      broadcastLobbyState();
      _startHeartbeat();
      resolve(code);
    });

    peer.on('error', (err: Error) => {
      // ID taken = code collision, retry with a new one (rare)
      if ((err as any).type === 'unavailable-id') {
        peer.destroy();
        createRoom(_initialGame, hostPresence).then(resolve).catch(reject);
        return;
      }
      if (isFirebaseFallbackConfigured()) {
        peer.destroy();
        createFirebaseRoom(_initialGame, hostPresence).then(resolve).catch(reject);
        return;
      }
      setStatus('error');
      reject(err);
    });

    // Accept incoming connections from joiners
    peer.on('connection', (conn: DataConnection) => {
      _connections.set(conn.peer, conn);
      watchPeerConnection(conn, () => markPeerOffline(conn));

      conn.on('open', () => {
        logConnectionState('host conn open', conn);
        const lobby = refreshLobbyState();
        if (lobby) sendMessage(conn, { type: 'LOBBY_STATE', payload: lobby });
        if (_latestGame?.status === 'playing') {
          sendSanitizedGamePatch(conn);
        }
        broadcastPresence();
      });

      conn.on('data', (raw: unknown) => {
        const msg = parseSyncMessage(raw);
        if (!msg) return;
        if (msg.type === 'PRESENCE') {
          const presence = msg.payload as RoomPresence;
          pruneStaleDuplicatePresence(presence);
          const assignment = autoAssignSeat(presence);
          upsertPresenceFromPeer(presence, assignment);
          broadcastPresence();
          broadcastLobbyState();
          sendSanitizedGamePatch(conn);
        }
        if (msg.type === 'LEAVE_ROOM') {
          cleanupConnection(conn);
          removePeerFromHostLobby(conn.peer);
          _connections.delete(conn.peer);
          conn.close();
          broadcastPresence();
          broadcastLobbyState();
        }
        if (msg.type === 'GAME_STATE') {
          // Legacy full-state messages from joiners are intentionally ignored.
        }
        if (msg.type === 'DECK_SUBMITTED') {
          const presence = _peers.get(conn.peer);
          if (presence) handleDeckSubmitted(msg.payload as DeckSubmission, presence);
        }
        if (msg.type === 'PLAYER_READY_CHANGED') {
          const payload = msg.payload as { playerId: string; ready: boolean };
          applyReadyChange(payload.playerId, payload.ready);
        }
        if (msg.type === 'GAME_ACTION_REQUEST') {
          const presence = _peers.get(conn.peer);
          if (presence) handleGameActionRequest(msg.payload as GameActionRequestPayload, presence);
        }
        if (msg.type === 'GAME_STATE_PATCH_REQUEST') {
          debugMultiplayer('host received GAME_STATE_PATCH_REQUEST', {
            peerId: conn.peer,
            reason: (msg.payload as { reason?: string }).reason,
          });
          const patchGame = _latestGame && _lobbyState?.status === 'playing'
            ? { ..._latestGame, status: 'playing' as const }
            : _latestGame;
          sendSanitizedGamePatch(conn, patchGame, { coalesceState: false });
        }
        if (msg.type === 'START_GAME_ACK') {
          debugMultiplayer('host receiving START_GAME_ACK', {
            id: (msg.payload as StartGameAck).id,
            playerId: (msg.payload as StartGameAck).playerId,
            peerId: (msg.payload as StartGameAck).peerId,
            ready: (msg.payload as StartGameAck).ready,
            reason: (msg.payload as StartGameAck).reason,
          });
          _onStartAck?.(msg.payload as StartGameAck);
        }
        if (msg.type === 'PING') {
          const payload = msg.payload as { sentAt?: number } | undefined;
          sendMessage(conn, { type: 'PONG', payload: { sentAt: payload?.sentAt ?? Date.now() } });
        }
        if (msg.type === 'PONG') {
          const payload = msg.payload as { sentAt?: number } | undefined;
          if (typeof payload?.sentAt === 'number') {
            updatePeerQuality(conn.peer, Date.now() - payload.sentAt);
            broadcastPresence();
          }
        }
      });

      conn.on('close', () => {
        logConnectionState('host conn close', conn);
        markPeerOffline(conn);
      });

      conn.on('error', (err: Error) => {
        logConnectionState('host conn error', conn, {
          error: err.message,
        });
        cleanupConnection(conn);
        _connections.delete(conn.peer);
      });
    });

    peer.on('disconnected', () => {
      // PeerJS auto-reconnects to broker; game data channels stay open
      peer.reconnect();
    });
  });
}

// ─── Join Room (non-host) ─────────────────────────────────────────────────────

export async function joinRoom(
  code: string,
  presence: Omit<RoomPresence, 'online' | 'lastSeen'>,
): Promise<JoinRoomResult> {
  setStatus('connecting');
  _transportMode = 'peerjs';
  _isHost = false;
  _roomCode = code.toUpperCase().trim();
  _peerId = presence.peerId;
  _playerId = presence.playerId;
  _sessionId = presence.sessionId;
  _messageSeq = 0;
  _peers.clear();

  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_CONFIG);
    _peer = peer;
    let receivedGame: GameState | null = null;

    const timeout = setTimeout(() => {
      peer.destroy();
      if (isFirebaseFallbackConfigured()) {
        joinFirebaseRoom(_roomCode!, { ...presence, peerId: _peerId ?? presence.peerId }).then(resolve).catch(reject);
      } else {
        setStatus('error');
        reject(new Error(`Could not reach room ${_roomCode}. Check the code and try again.`));
      }
    }, CONNECT_TIMEOUT_MS);

    peer.on('open', () => {
      _peerId = peer.id;
      const actualPresence = canonicalizeJoinPresence(peer.id, presence);
      const conn = peer.connect(hostPeerId(_roomCode!), {
        reliable: true,
        serialization: 'json',
      });
      _hostConn = conn;
      watchPeerConnection(conn, () => startHostMigration('host-disconnected'));

      conn.on('open', () => {
        logConnectionState('joiner conn open', conn);
        clearTimeout(timeout);
        // Send our presence to the host
        sendMessage(conn, { type: 'PRESENCE', payload: { ...actualPresence, online: true, lastSeen: Date.now() } });
      });

      conn.on('data', (raw: unknown) => {
        const summary = summarizeRawMessage(raw);
        debugMultiplayer('joiner raw data received', {
          rawType: summary.type,
          rawProtocolVersion: summary.protocolVersion,
          rawRoomId: summary.roomId,
        });
        const msg = parseSyncMessage(raw);
        if (!msg) return;

        if (msg.type === 'KICKED') {
          clearTimeout(timeout);
          const payload = msg.payload as { reason?: string } | undefined;
          const reason = payload?.reason || 'You were removed from the lobby by the host.';
          leaveRoom(false);
          if ((conn as any)._joinResolved !== true) {
            reject(new Error(reason));
          }
          return;
        }

        if (msg.type === 'HOST_MIGRATION') {
          handleJoinerMessage(conn, raw);
          return;
        }

        if (msg.type === 'PRESENCE_BROADCAST') {
          const players = msg.payload as Record<string, RoomPresence>;
          _peers.clear();
          for (const [peerId, presence] of Object.entries(players)) {
            _peers.set(peerId, presence);
          }
          _onPresenceUpdate?.(players);

          // First PRESENCE_BROADCAST resolves the join promise
          // We detect our own spectator status from what the host assigned us.
          // Resolve by identity if peer ID has shifted.
          if (!actualPresence.sessionId) return;
          const selfEntry = resolveSelfPresenceFromPeers(players, actualPresence.playerId, actualPresence.sessionId, _peerId ?? undefined);
          if (!selfEntry) return;
          if (selfEntry.peerId !== _peerId) {
            _peerId = selfEntry.peerId;
          }
          const myEntry = selfEntry.presence;
          const isSpectator = myEntry?.isSpectator ?? false;
          const assignedSeatIndex = myEntry?.seatIndex ?? actualPresence.seatIndex;

          // We don't get a full GameState here yet — the host will
          // broadcastState() on the next game action. Resolve with empty
          // game placeholder; the store already has a game state from lobby.
          if ((conn as any)._joinResolved !== true) {
            (conn as any)._joinResolved = true;
            setStatus('joined');
            _startHeartbeat();
            resolve({
              game: receivedGame,
              hostId: hostPeerId(_roomCode!),
              peerId: _peerId!,
              peers: players,
              isSpectator,
              seatIndex: assignedSeatIndex,
            });
          }
        }

        if (msg.type === 'LOBBY_STATE') {
          _lobbyState = msg.payload as LobbyState;
          debugMultiplayer('joiner received LOBBY_STATE status', {
            roomCode: _lobbyState.roomCode,
            lobbyStatus: _lobbyState.status,
          });
          _onLobbyUpdate?.(_lobbyState);
          if (_lobbyState.status === 'playing' && _latestGame?.status !== 'playing') {
            debugMultiplayer('joiner received playing LOBBY_STATE without playing game; requesting patch', {
              roomCode: _lobbyState.roomCode,
            });
            requestFreshGameStatePatch('lobby-playing-without-game');
          }
        }

        if (msg.type === 'GAME_STATE') {
          _latestGame = msg.payload as GameState;
          receivedGame = _latestGame;
          _onGameUpdate?.(_latestGame);
        }

        if (msg.type === 'GAME_STATE_PATCH') {
          const patch = msg.payload as GameStatePatchPayload;
          if (patch.sanitizedGame) {
            _latestGame = patch.sanitizedGame;
            receivedGame = _latestGame;
            debugMultiplayer('joiner received GAME_STATE_PATCH status', {
              gameId: _latestGame.id,
              gameStatus: _latestGame.status,
              seq: patch.seq,
            });
            if (_latestGame.status === 'playing' && _lobbyState) {
              _lobbyState = { ..._lobbyState, status: 'playing', updatedAt: Date.now() };
              _onLobbyUpdate?.(_lobbyState);
            }
            _onGameUpdate?.(_latestGame);
          }
        }

        if (msg.type === 'DECK_VALIDATED' || msg.type === 'DECK_REJECTED') {
          handleJoinerMessage(conn, raw);
        }

        if (msg.type === 'START_GAME_PREPARE') {
          debugMultiplayer('joiner receiving START_GAME_PREPARE', {
            id: (msg.payload as StartGamePrepare).id,
            requiredPeerIds: (msg.payload as StartGamePrepare).requiredPeerIds,
          });
          _onStartPrepare?.(msg.payload as StartGamePrepare);
        }

        if (msg.type === 'START_GAME_COMMIT') {
          const commit = msg.payload as StartGameCommit;
          debugMultiplayer('joiner received START_GAME_COMMIT', {
            id: commit.id,
            gameId: commit.gameId ?? commit.game.id,
            status: commit.game.status,
          });
          _latestGame = { ...commit.game, status: 'playing' };
          if (_latestGame.status === 'playing' && _lobbyState) {
            _lobbyState = { ..._lobbyState, status: 'playing', updatedAt: Date.now() };
            _onLobbyUpdate?.(_lobbyState);
          }
          _onStartCommit?.({ ...commit, game: _latestGame });
        }

        if (msg.type === 'PONG') {
          const payload = msg.payload as { sentAt?: number } | undefined;
          if (typeof payload?.sentAt === 'number' && _peerId) {
            updatePeerQuality(_peerId, Date.now() - payload.sentAt);
            updatePresence({ connectionQuality: _peers.get(_peerId)?.connectionQuality });
          }
        }

        if (msg.type === 'PING') {
          const payload = msg.payload as { sentAt?: number } | undefined;
          sendMessage(conn, { type: 'PONG', payload: { sentAt: payload?.sentAt ?? Date.now() } });
        }
      });

      conn.on('close', () => {
        logConnectionState('joiner conn close', conn);
        cleanupConnection(conn);
        startHostMigration('host-disconnected');
      });

      conn.on('error', (err: Error) => {
        logConnectionState('joiner conn error', conn, {
          error: err.message,
        });
        cleanupConnection(conn);
        clearTimeout(timeout);
        if ((conn as any)._joinResolved === true) {
          startHostMigration('host-disconnected');
        } else {
          setStatus('error');
          reject(new Error(`Connection error: ${err.message}`));
        }
      });
    });

    peer.on('error', (err: Error) => {
      clearTimeout(timeout);
      const type = (err as any).type;
      if (type === 'peer-unavailable') {
        if (isFirebaseFallbackConfigured()) {
          peer.destroy();
          joinFirebaseRoom(_roomCode!, presence).then(resolve).catch(reject);
        } else {
          setStatus('error');
          reject(new Error(`Room ${_roomCode} not found. Check the code and try again.`));
        }
      } else {
        setStatus('error');
        reject(err);
      }
    });
  });
}

// ─── Broadcast state (host → all joiners) ─────────────────────────────────────

export function sendStartGamePrepare(prepare: StartGamePrepare): void {
  if (!_isHost) return;
  if (_transportMode === 'firebase') {
    return;
  }
  debugMultiplayer('host sending START_GAME_PREPARE', {
    id: prepare.id,
    requiredPeerIds: prepare.requiredPeerIds,
    players: prepare.playerList.map(player => ({ playerId: player.playerId, peerId: player.peerId, seatIndex: player.seatIndex })),
  });
  const msg: SyncMessage = { type: 'START_GAME_PREPARE', payload: prepare };
  for (const conn of _connections.values()) {
    const presence = _peers.get(conn.peer);
    const candidate = Boolean(conn.open && presence && !presence.isSpectator && presence.seatIndex >= 0);
    let sent = false;
    if (candidate) sent = sendMessage(conn, msg);
    debugMultiplayer('host START_GAME_PREPARE candidate', {
      peerId: conn.peer,
      presenceExists: Boolean(presence),
      presencePlayerId: presence?.playerId,
      presencePeerId: presence?.peerId,
      presenceSeatIndex: presence?.seatIndex,
      presenceIsSpectator: presence?.isSpectator,
      candidate,
      sent,
      ...getConnectionDebugInfo(conn),
    });
  }
}

export function sendStartGameAck(ack: StartGameAck): void {
  debugMultiplayer('joiner sending START_GAME_ACK', {
    id: ack.id,
    playerId: ack.playerId,
    peerId: ack.peerId,
    ready: ack.ready,
    reason: ack.reason,
  });
  const msg: SyncMessage = { type: 'START_GAME_ACK', payload: ack };
  if (_transportMode === 'firebase') {
    void writeFirebaseMessage(msg);
    return;
  }
  if (_hostConn?.open) sendMessage(_hostConn, msg);
}

export function sendStartGameCommit(commit: StartGameCommit): void {
  const playingGame: GameState = { ...commit.game, status: 'playing' };
  const playingCommit: StartGameCommit = {
    ...commit,
    gameId: commit.gameId ?? playingGame.id,
    game: playingGame,
  };
  _latestGame = playingGame;
  if (_transportMode === 'firebase') {
    if (_isHost) {
      broadcastLobbyState('playing');
      void writeFirebaseRoomSnapshot();
    }
    return;
  }
  if (!_isHost) return;
  sendStartGameCommitBurst(playingCommit, playingGame, 0);
}

function sendStartGameCommitBurst(commit: StartGameCommit, playingGame: GameState, attempt: number): void {
  if (!_isHost) return;
  broadcastLobbyState('playing');
  for (const conn of _connections.values()) {
    if (logStartCommitConnectionGate(conn, attempt)) {
      sendStartGameCommitToConnection(conn, commit, playingGame, attempt);
    }
  }
  const hasOpenConnections = [..._connections.values()].some(conn => isConnectedNonHostSeatedPeer(conn));
  if (attempt < 5 && hasOpenConnections) {
    globalThis.setTimeout(() => sendStartGameCommitBurst(commit, playingGame, attempt + 1), 500);
  }
}

function sendStartGameCommitToConnection(
  conn: DataConnection,
  commit: StartGameCommit,
  playingGame: GameState,
  attempt: number,
): void {
    const presence = _peers.get(conn.peer);
    if (!isConnectedNonHostSeatedPeer(conn) || !presence) return;
    const viewerGamePlayerId = playingGame.players[presence.seatIndex]?.id;
    if (!viewerGamePlayerId) return;
    const payload: StartGameCommit = {
      ...commit,
      gameId: commit.gameId ?? playingGame.id,
      publicGameState: createPublicGameState(playingGame),
      game: sanitizeGameStateForPlayer(playingGame, viewerGamePlayerId),
    };
    const commitSent = sendMessage(conn, { type: 'START_GAME_COMMIT', payload });
    const patchSent = sendMessage(conn, {
      type: 'GAME_STATE_PATCH',
      payload: createGamePatchForPlayer(playingGame, viewerGamePlayerId),
    });
    debugMultiplayer('host start delivery send results', {
      peerId: presence.peerId,
      playerId: presence.playerId,
      viewerGamePlayerId,
      seatIndex: presence.seatIndex,
      attempt,
      commitSent,
      patchSent,
      gameStatus: playingGame.status,
      ...getConnectionDebugInfo(conn),
    });
}

function createGamePatchForPlayer(game: GameState, playerId: string): GameStatePatchPayload {
  return {
    seq: ++_gamePatchSeq,
    publicGameState: createPublicGameState(game),
    privatePlayerState: createPrivatePlayerState(game, playerId),
    sanitizedGame: sanitizeGameStateForPlayer(game, playerId),
  };
}

function sendSanitizedGamePatch(
  conn: DataConnection,
  game = _latestGame,
  options: { coalesceState?: boolean } = { coalesceState: true },
): void {
  if (!game) return;
  const patchGame: GameState = game.status === 'playing' || _lobbyState?.status === 'playing'
    ? { ...game, status: 'playing' }
    : game;
  if (patchGame.status !== 'playing') {
    debugMultiplayer('host skipped GAME_STATE_PATCH before game start', {
      gameId: patchGame.id,
      gameStatus: patchGame.status,
      peerId: conn.peer,
    });
    return;
  }
  const presence = _peers.get(conn.peer);
  if (!presence) return;
  const viewerGamePlayerId = presence.seatIndex >= 0 ? patchGame.players[presence.seatIndex]?.id : undefined;
  if (!viewerGamePlayerId) return;
  debugMultiplayer('host sending GAME_STATE_PATCH', {
    gameId: patchGame.id,
    gameStatus: patchGame.status,
    peerId: presence.peerId,
    playerId: presence.playerId,
    viewerGamePlayerId,
  });
  sendMessage(conn, {
    type: 'GAME_STATE_PATCH',
    payload: createGamePatchForPlayer(patchGame, viewerGamePlayerId),
  }, { coalesceState: options.coalesceState ?? true });
}

export function broadcastState(game: GameState): void {
  _latestGame = game;
  if (_transportMode === 'firebase') {
    if (_isHost) {
      void writeFirebaseRoomSnapshot();
    }
    return;
  }
  if (!_isHost) {
    // Joined clients request actions; they do not broadcast full GameState.
    return;
  }
  for (const conn of _connections.values()) {
    sendSanitizedGamePatch(conn, game);
  }
}

export function submitDeckToHost(deck: Parameters<typeof createDeckSubmission>[0]): DeckSubmission | null {
  if (!_playerId || !_peerId || !_sessionId) return null;
  const submission = createDeckSubmission(deck, _playerId);
  const self = _peers.get(_peerId);
  if (_isHost && self) {
    handleDeckSubmitted(submission, self);
    return submission;
  }
  _lastLocalDeckSubmission = submission;
  sendDeckSubmissionToHost(submission);
  scheduleDeckSubmissionFallback(submission);
  return submission;
}

export function setLocalPlayerReady(ready: boolean): boolean {
  if (!_playerId || !_peerId) return false;
  if (_isHost) return applyReadyChange(_playerId, ready);
  const msg: SyncMessage = { type: 'PLAYER_READY_CHANGED', payload: { playerId: _playerId, ready } };
  if (_transportMode === 'firebase') {
    void writeFirebaseMessage(msg);
  } else if (_hostConn?.open) {
    sendMessage(_hostConn, msg);
  }
  const existing = _peers.get(_peerId);
  if (existing) {
    _peers.set(_peerId, { ...existing, ready, lastSeen: Date.now() });
    _onPresenceUpdate?.(Object.fromEntries(_peers));
  }
  return true;
}

export function sendGameActionRequest(actionType: string, params: Record<string, unknown> = {}): boolean {
  if (!_playerId || _isHost || !_hostConn?.open) return false;
  const actionSeq = (_lastActionSeqByPlayer.get(_playerId) ?? 0) + 1;
  _lastActionSeqByPlayer.set(_playerId, actionSeq);
  sendMessage(_hostConn, {
    type: 'GAME_ACTION_REQUEST',
    payload: { actionSeq, actionType, params },
  });
  return true;
}

// ─── Update presence (joiner → host) ─────────────────────────────────────────

export function updatePresence(fields: Partial<RoomPresence>): void {
  if (_isHost) {
    // Host updates its own presence locally
    const existing = _peers.get(_peerId!) ?? {} as RoomPresence;
    _peers.set(_peerId!, { ...existing, ...fields, lastSeen: Date.now(), online: true });
    if (_transportMode === 'firebase') {
      void writeFirebaseRoomSnapshot();
      return;
    }
    broadcastPresence();
  } else {
    // Joiner sends updated presence to host
    if (_transportMode === 'firebase') {
      const existing = _peers.get(_peerId!) ?? {} as RoomPresence;
      const next = { ...existing, ...fields, lastSeen: Date.now(), online: true } as RoomPresence;
      _peers.set(_peerId!, next);
      void writeFirebasePeerPresence(next);
      return;
    }
    if (_hostConn?.open) {
      const existing = _peers.get(_peerId!) ?? {} as RoomPresence;
      sendMessage(_hostConn, {
        type: 'PRESENCE',
        payload: { ...existing, ...fields, lastSeen: Date.now(), online: true },
      });
    }
  }
}

// ─── Leave ────────────────────────────────────────────────────────────────────

export function kickPeer(peerId: string, reason = 'Removed by host.'): boolean {
  if (!_isHost || !_peerId || peerId === _peerId) return false;
  const hadPresence = Boolean(removePeerFromHostLobby(peerId));
  if (_transportMode === 'firebase') {
    void firebaseRequest(`${firebaseRoomPath()}/peers/${peerId}`, 'PATCH', {
      online: false,
      kicked: true,
      kickReason: reason,
      lastSeen: Date.now(),
    });
    void writeFirebaseRoomSnapshot();
    return hadPresence;
  }
  const conn = _connections.get(peerId);
  if (conn?.open) {
    sendMessage(conn, { type: 'KICKED', payload: { reason } });
    conn.close();
  }
  if (conn) cleanupConnection(conn);
  _connections.delete(peerId);
  broadcastPresence();
  broadcastLobbyState();
  return hadPresence || Boolean(conn);
}

export function requestHostMigrationBeforeLeave(): boolean {
  if (_transportMode === 'firebase') return false;
  if (!_isHost || !_roomCode || !_peerId) return false;
  const candidates = Object.fromEntries(
    [..._peers.entries()].filter(([peerId, presence]) =>
      peerId !== _peerId && presence.online && !presence.isSpectator && presence.seatIndex >= 0
    )
  );
  const candidate = chooseMigrationHost(candidates);
  if (!candidate) return false;

  for (const [peerId, presence] of _peers.entries()) {
    _peers.set(peerId, {
      ...presence,
      isHostPeer: peerId === candidate.peerId,
      online: peerId === _peerId ? false : presence.online,
      lastSeen: Date.now(),
    });
  }

  const notice: HostMigrationNotice = {
    candidatePeerId: candidate.peerId,
    reason: 'host-disconnected',
    roomCode: _roomCode,
    game: _latestGame,
    peers: Object.fromEntries(_peers),
  };

  for (const conn of _connections.values()) {
    sendMessage(conn, { type: 'HOST_MIGRATION', payload: notice });
  }
  broadcastPresence();
  return true;
}

export function leaveRoom(notifyHost = true): void {
  _stopHeartbeat();
  stopFirebasePolling();
  if (_migrationTimer) { clearTimeout(_migrationTimer); _migrationTimer = null; }
  clearDeckSubmissionFallback();
  _lastLocalDeckSubmission = null;
  _deckSubmissionFallbackUsed = false;
  if (_transportMode === 'firebase' && _roomCode && _peerId) {
    const peerPath = `${firebaseRoomPath()}/peers/${_peerId}`;
    if (_isHost) {
      void migrateFirebaseHostBeforeLeave();
    }
    if (notifyHost && !_isHost) {
      void writeFirebaseMessage({ type: 'LEAVE_ROOM', payload: { peerId: _peerId } });
    }
    void firebaseRequest(peerPath, 'PATCH', { online: false, lastSeen: Date.now() });
  }
  if (notifyHost && !_isHost && _peerId && _hostConn?.open) {
    sendMessage(_hostConn, { type: 'LEAVE_ROOM', payload: { peerId: _peerId } });
  }
  if (_hostConn) { cleanupConnection(_hostConn); _hostConn.close(); _hostConn = null; }
  for (const conn of _connections.values()) conn.close();
  cleanupAllConnections();
  _peers.clear();
  if (_peer) { _peer.destroy(); _peer = null; }
  _latestGame = null;
  _roomCode = null;
  _peerId = null;
  _isHost = false;
  _transportMode = 'peerjs';
  _firebaseSeenMessages.clear();
  _onPresenceUpdate?.({});
  setStatus('disconnected');
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────
// Keeps NAT mappings alive so connections don't drop on idle games.

function _startHeartbeat() {
  _stopHeartbeat();
  _heartbeatTimer = setInterval(() => {
    const ping: SyncMessage = { type: 'PING', payload: { sentAt: Date.now() } };
    if (_isHost) {
      for (const conn of _connections.values()) {
        sendMessage(conn, ping);
      }
    } else {
      if (_hostConn?.open) sendMessage(_hostConn, ping);
      else startHostMigration('host-disconnected');
    }
  }, HEARTBEAT_MS);
}

function _stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}
