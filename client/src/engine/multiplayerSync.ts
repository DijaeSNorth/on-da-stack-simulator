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

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RoomPresence {
  peerId: string;
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
  | 'migrating'
  | 'error';

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

// ─── Internal state ───────────────────────────────────────────────────────────

let _peer: Peer | null = null;
let _roomCode: string | null = null;
let _peerId: string | null = null;
let _isHost = false;
let _status: SyncStatus = 'disconnected';
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let _migrationTimer: ReturnType<typeof setTimeout> | null = null;

// Host-side: map of peerId → DataConnection for each joiner
const _connections: Map<string, DataConnection> = new Map();

// Joiner-side: single connection to host
let _hostConn: DataConnection | null = null;
let _latestGame: GameState | null = null;

// Presence table — host owns the authoritative copy; joiners mirror it
const _peers: Map<string, RoomPresence> = new Map();

// Callbacks registered by the store
let _onGameUpdate: ((game: GameState) => void) | null = null;
let _onPresenceUpdate: ((players: Record<string, RoomPresence>) => void) | null = null;
let _onStatusChange: ((status: SyncStatus) => void) | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setStatus(s: SyncStatus) {
  _status = s;
  _onStatusChange?.(s);
}

function broadcastPresence() {
  if (!_isHost) return;
  const payload = Object.fromEntries(_peers);
  for (const conn of _connections.values()) {
    if (conn.open) {
      conn.send({ type: 'PRESENCE_BROADCAST', payload });
    }
  }
  _onPresenceUpdate?.(payload);
}

function generateRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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
  if (!playerHasLoadedDeck(remotePlayer)) return null;

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

function applyIncomingGameFromPeer(conn: DataConnection, game: GameState): void {
  const mergedDeckState = _latestGame
    ? mergeRemoteSeatDeckState(_latestGame, game, _peers.get(conn.peer))
    : null;
  const nextGame = mergedDeckState
    ?? (!_latestGame || game.lastUpdatedAt > _latestGame.lastUpdatedAt ? game : null);

  if (!nextGame) return;
  _latestGame = nextGame;
  _onGameUpdate?.(nextGame);
  broadcastState(nextGame);
}

export function initMultiplayer(
  onGameUpdate: (game: GameState) => void,
  onPresenceUpdate: (players: Record<string, RoomPresence>) => void,
  onStatusChange: (status: SyncStatus) => void,
): void {
  _onGameUpdate = onGameUpdate;
  _onPresenceUpdate = onPresenceUpdate;
  _onStatusChange = onStatusChange;
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getRoomCode(): string | null { return _roomCode; }
export function getPeerId(): string | null   { return _peerId; }
export function getIsHost(): boolean         { return _isHost; }
export function getSyncStatus(): SyncStatus  { return _status; }

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

function attachHostConnectionHandlers(peer: Peer): void {
  peer.on('connection', (conn: DataConnection) => {
    _connections.set(conn.peer, conn);

    conn.on('open', () => {
      if (_latestGame) conn.send({ type: 'GAME_STATE', payload: _latestGame });
      broadcastPresence();
    });

    conn.on('data', (raw: unknown) => {
      const msg = raw as { type: string; payload?: unknown };
      if (msg.type === 'PRESENCE') {
        const presence = msg.payload as RoomPresence;
        pruneStaleDuplicatePresence(presence);
        const assignment = autoAssignSeat(presence);

        _peers.set(presence.peerId, {
          ...presence,
          isHostPeer: false,
          isSpectator: assignment.isSpectator,
          seatIndex: assignment.seatIndex,
          online: true,
          lastSeen: Date.now(),
        });

        broadcastPresence();
      }
      if (msg.type === 'LEAVE_ROOM') {
        _peers.delete(conn.peer);
        _connections.delete(conn.peer);
        conn.close();
        broadcastPresence();
      }
      if (msg.type === 'GAME_STATE') {
        const game = msg.payload as GameState;
        applyIncomingGameFromPeer(conn, game);
      }
      if (msg.type === 'PING') {
        const payload = msg.payload as { sentAt?: number } | undefined;
        conn.send({ type: 'PONG', payload: { sentAt: payload?.sentAt ?? Date.now() } });
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
      const p = _peers.get(conn.peer);
      if (p) _peers.set(conn.peer, { ...p, online: false });
      _connections.delete(conn.peer);
      broadcastPresence();
    });

    conn.on('error', () => {
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
  if (_hostConn) { _hostConn.close(); _hostConn = null; }
  _connections.clear();
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
      if (conn.open) conn.send({ type: 'HOST_MIGRATION', payload: notice });
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

  conn.on('open', () => {
    conn.send({
      type: 'PRESENCE',
      payload: {
        ...(self ?? {}),
        peerId: _peerId!,
        online: true,
        lastSeen: Date.now(),
      },
    });
    setStatus('joined');
    _startHeartbeat();
  });

  conn.on('data', (raw: unknown) => handleJoinerMessage(conn, raw));
  conn.on('close', () => startHostMigration('host-disconnected'));
  conn.on('error', () => startHostMigration('host-disconnected'));
}

function handleJoinerMessage(conn: DataConnection, raw: unknown): void {
  const msg = raw as { type: string; payload?: unknown };

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

  if (msg.type === 'GAME_STATE') {
    _latestGame = msg.payload as GameState;
    if (_latestGame) _onGameUpdate?.(_latestGame);
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
    conn.send({ type: 'PONG', payload: { sentAt: payload?.sentAt ?? Date.now() } });
  }
}

// ─── Create Room (host) ───────────────────────────────────────────────────────

export async function createRoom(
  _initialGame: GameState,
  hostPresence: Omit<RoomPresence, 'online' | 'lastSeen'>,
): Promise<string> {
  setStatus('connecting');
  _isHost = true;
  _latestGame = _initialGame;
  _connections.clear();
  _peers.clear();

  const code = generateRoomCode();
  _roomCode = code;
  _peerId = hostPresence.peerId;

  // Register our own presence
  _peers.set(_peerId, {
    ...hostPresence,
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
      setStatus('error');
      reject(err);
    });

    // Accept incoming connections from joiners
    peer.on('connection', (conn: DataConnection) => {
      _connections.set(conn.peer, conn);

      conn.on('open', () => {
        if (_latestGame) conn.send({ type: 'GAME_STATE', payload: _latestGame });
        broadcastPresence();
      });

      conn.on('data', (raw: unknown) => {
        const msg = raw as { type: string; payload: unknown };
        if (msg.type === 'PRESENCE') {
          const presence = msg.payload as RoomPresence;
          pruneStaleDuplicatePresence(presence);
          const assignment = autoAssignSeat(presence);

          _peers.set(presence.peerId, {
            ...presence,
            isHostPeer: false,
            isSpectator: assignment.isSpectator,
            seatIndex: assignment.seatIndex,
            online: true,
            lastSeen: Date.now(),
          });

          broadcastPresence();
        }
        if (msg.type === 'LEAVE_ROOM') {
          _peers.delete(conn.peer);
          _connections.delete(conn.peer);
          conn.close();
          broadcastPresence();
        }
        if (msg.type === 'GAME_STATE') {
          const game = msg.payload as GameState;
          applyIncomingGameFromPeer(conn, game);
        }
        if (msg.type === 'PING') {
          const payload = msg.payload as { sentAt?: number } | undefined;
          conn.send({ type: 'PONG', payload: { sentAt: payload?.sentAt ?? Date.now() } });
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
        const p = _peers.get(conn.peer);
        if (p) _peers.set(conn.peer, { ...p, online: false });
        _connections.delete(conn.peer);
        broadcastPresence();
      });

      conn.on('error', () => {
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
): Promise<{ game: GameState | null; hostId: string; isSpectator: boolean; seatIndex: number }> {
  setStatus('connecting');
  _isHost = false;
  _roomCode = code.toUpperCase().trim();
  _peerId = presence.peerId;
  _peers.clear();

  return new Promise((resolve, reject) => {
    const peer = new Peer(PEER_CONFIG);
    _peer = peer;
    let receivedGame: GameState | null = null;

    const timeout = setTimeout(() => {
      peer.destroy();
      setStatus('error');
      reject(new Error(`Could not reach room ${_roomCode}. Check the code and try again.`));
    }, CONNECT_TIMEOUT_MS);

    peer.on('open', () => {
      const conn = peer.connect(hostPeerId(_roomCode!), {
        reliable: true,
        serialization: 'json',
      });
      _hostConn = conn;

      conn.on('open', () => {
        clearTimeout(timeout);
        // Send our presence to the host
        conn.send({ type: 'PRESENCE', payload: { ...presence, online: true, lastSeen: Date.now() } });
      });

      conn.on('data', (raw: unknown) => {
        const msg = raw as { type: string; payload: unknown };

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
          // We detect our own spectator status from what the host assigned us
          const myEntry = players[_peerId!];
          if (!myEntry) return;
          const isSpectator = myEntry?.isSpectator ?? false;
          const assignedSeatIndex = myEntry?.seatIndex ?? presence.seatIndex;

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
              isSpectator,
              seatIndex: assignedSeatIndex,
            });
          }
        }

        if (msg.type === 'GAME_STATE') {
          _latestGame = msg.payload as GameState;
          receivedGame = _latestGame;
          _onGameUpdate?.(_latestGame);
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
          conn.send({ type: 'PONG', payload: { sentAt: payload?.sentAt ?? Date.now() } });
        }
      });

      conn.on('close', () => {
        startHostMigration('host-disconnected');
      });

      conn.on('error', (err: Error) => {
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
        setStatus('error');
        reject(new Error(`Room ${_roomCode} not found. Check the code and try again.`));
      } else {
        setStatus('error');
        reject(err);
      }
    });
  });
}

// ─── Broadcast state (host → all joiners) ─────────────────────────────────────

export function broadcastState(game: GameState): void {
  _latestGame = game;
  const msg = { type: 'GAME_STATE', payload: game };
  if (!_isHost) {
    if (_hostConn?.open) _hostConn.send(msg);
    return;
  }
  for (const conn of _connections.values()) {
    if (conn.open) {
      conn.send(msg);
    }
  }
}

// ─── Update presence (joiner → host) ─────────────────────────────────────────

export function updatePresence(fields: Partial<RoomPresence>): void {
  if (_isHost) {
    // Host updates its own presence locally
    const existing = _peers.get(_peerId!) ?? {} as RoomPresence;
    _peers.set(_peerId!, { ...existing, ...fields, lastSeen: Date.now(), online: true });
    broadcastPresence();
  } else {
    // Joiner sends updated presence to host
    if (_hostConn?.open) {
      const existing = _peers.get(_peerId!) ?? {} as RoomPresence;
      _hostConn.send({
        type: 'PRESENCE',
        payload: { ...existing, ...fields, lastSeen: Date.now(), online: true },
      });
    }
  }
}

// ─── Leave ────────────────────────────────────────────────────────────────────

export function kickPeer(peerId: string, reason = 'Removed by host.'): boolean {
  if (!_isHost || !_peerId || peerId === _peerId) return false;
  const hadPresence = _peers.delete(peerId);
  const conn = _connections.get(peerId);
  if (conn?.open) {
    conn.send({ type: 'KICKED', payload: { reason } });
    conn.close();
  }
  _connections.delete(peerId);
  broadcastPresence();
  return hadPresence || Boolean(conn);
}

export function requestHostMigrationBeforeLeave(): boolean {
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
    if (conn.open) conn.send({ type: 'HOST_MIGRATION', payload: notice });
  }
  broadcastPresence();
  return true;
}

export function leaveRoom(notifyHost = true): void {
  _stopHeartbeat();
  if (_migrationTimer) { clearTimeout(_migrationTimer); _migrationTimer = null; }
  if (notifyHost && !_isHost && _peerId && _hostConn?.open) {
    _hostConn.send({ type: 'LEAVE_ROOM', payload: { peerId: _peerId } });
  }
  if (_hostConn) { _hostConn.close(); _hostConn = null; }
  for (const conn of _connections.values()) conn.close();
  _connections.clear();
  _peers.clear();
  if (_peer) { _peer.destroy(); _peer = null; }
  _latestGame = null;
  _roomCode = null;
  _peerId = null;
  _isHost = false;
  _onPresenceUpdate?.({});
  setStatus('disconnected');
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────
// Keeps NAT mappings alive so connections don't drop on idle games.

function _startHeartbeat() {
  _stopHeartbeat();
  _heartbeatTimer = setInterval(() => {
    const ping = { type: 'PING', payload: { sentAt: Date.now() } };
    if (_isHost) {
      for (const conn of _connections.values()) {
        if (conn.open) conn.send(ping);
      }
    } else {
      if (_hostConn?.open) _hostConn.send(ping);
      else startHostMigration('host-disconnected');
    }
  }, HEARTBEAT_MS);
}

function _stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}
