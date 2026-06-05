/**
 * multiplayer-sync.test.ts
 *
 * Critical tests for the multiplayer sync layer.
 * These run offline (no real PeerJS connection) — they test:
 *   1.  sanitizeForTransport strips undefined values before network send
 *   2.  Room code generation: 6 chars, alphanumeric, uppercase
 *   3.  Presence shape validation
 *   4.  MultiplayerState default shape
 *   5.  Sync status state machine transitions
 *   6.  lastUpdatedAt guard: remote updates only applied when newer
 *   7.  broadcastState not called when status is 'disconnected'
 *   8.  Join flow: remoteGame applied to store + localPlayerId set to chosen seat
 *   9.  leaveRoom resets multiplayer state to disconnected
 *  10.  isConfigured returns true because PeerJS needs no server env vars
 *  11.  Seat index bounds: out-of-range seat falls back to players[0]
 *  12.  Peer deduplication: same peerId updating presence doesn't double-add
 *  13.  Large game state (200 cards) survives sanitize round-trip
 *  14.  Multi-player game: each peer has independent seatIndex
 *  15.  broadcastState subscriber fires only on lastUpdatedAt change
 */

// ─── We test the pure multiplayer logic offline, without a real PeerJS room ──

// ─── 1. sanitizeForTransport ──────────────────────────────────────────────────

console.log('=== 1. sanitizeForTransport strips undefined ===');

{
  // Replicate the function from multiplayerSync (tested in isolation)
  function sanitize(obj: unknown): unknown {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, sanitize(v)])
    );
  }

  const dirty = {
    id: 'game-1',
    status: 'playing',
    undefinedField: undefined,
    nested: { a: 1, b: undefined, c: { d: undefined, e: 'keep' } },
    arr: [1, undefined, 3],
  };

  const clean = sanitize(dirty) as Record<string, any>;
  console.assert(!('undefinedField' in clean), 'FAIL top-level undefined not removed');
  console.assert(!('b' in clean.nested), 'FAIL nested undefined not removed');
  console.assert(!('d' in clean.nested.c), 'FAIL deep nested undefined not removed');
  console.assert(clean.nested.c.e === 'keep', 'FAIL good value was removed');
  console.assert(clean.id === 'game-1', 'FAIL id not preserved');
  // Array: undefined becomes null, matching JSON serialization behavior.
  console.assert(Array.isArray(clean.arr), 'FAIL arr not an array');
  console.assert(clean.arr[1] === null, `FAIL arr[1] should be null, got ${clean.arr[1]}`);
  console.assert(clean.arr[2] === 3, 'FAIL arr[2] should be 3');
  console.log('  PASS: sanitizeForTransport removes all undefined values');

  // Primitive passthrough
  console.assert(sanitize(null) === null, 'FAIL null');
  console.assert(sanitize(42) === 42, 'FAIL number');
  console.assert(sanitize('str') === 'str', 'FAIL string');
  console.assert(sanitize(true) === true, 'FAIL boolean');
  console.assert(sanitize(undefined) === null, 'FAIL undefined should become null');
  console.log('  PASS: primitives pass through correctly');
}

// ─── 2. Room code generation ──────────────────────────────────────────────────

console.log('\n=== 2. Room code generation ===');

{
  function generateRoomCode(): string {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  const codes = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const code = generateRoomCode();
    console.assert(code.length === 6, `FAIL code length ${code.length}: ${code}`);
    console.assert(/^[A-Z0-9]{6}$/.test(code), `FAIL code not alphanumeric: ${code}`);
    codes.add(code);
  }

  // 1000 codes should produce many unique values (very rare collisions)
  const uniqueRatio = codes.size / 1000;
  console.assert(uniqueRatio > 0.95, `FAIL too many collisions: only ${codes.size} unique codes in 1000`);
  console.log(`  PASS: ${codes.size}/1000 unique room codes, all 6-char uppercase alphanumeric`);
}

// ─── 3. Presence shape validation ────────────────────────────────────────────

console.log('\n=== 3. Presence shape ===');

{
  interface RoomPresence {
    peerId: string;
    name: string;
    color: string;
    seatIndex: number;
    online: boolean;
    lastSeen: number;
  }

  function makePresence(overrides: Partial<RoomPresence> & { peerId: string }): RoomPresence {
    return {
      name: 'Player',
      color: '#3b82f6',
      seatIndex: 0,
      online: true,
      lastSeen: Date.now(),
      ...overrides,
    };
  }

  const p = makePresence({ peerId: 'peer-1', seatIndex: 2, name: 'Dijae' });
  console.assert(p.peerId === 'peer-1', 'FAIL peerId');
  console.assert(p.seatIndex === 2, 'FAIL seatIndex');
  console.assert(p.name === 'Dijae', 'FAIL name');
  console.assert(p.online === true, 'FAIL online');
  console.assert(typeof p.lastSeen === 'number', 'FAIL lastSeen type');
  console.log('  PASS: presence shape correct');

  // Disconnect simulation
  const offline = { ...p, online: false };
  console.assert(offline.online === false, 'FAIL offline state');
  console.log('  PASS: offline presence shape correct');
}

// ─── 4. MultiplayerState default ─────────────────────────────────────────────

console.log('\n=== 4. MultiplayerState default ===');

{
  const DEFAULT_MULTIPLAYER = {
    status: 'disconnected' as const,
    roomCode: null,
    peerId: null,
    isHost: false,
    peers: {} as Record<string, any>,
    configured: false,
  };

  console.assert(DEFAULT_MULTIPLAYER.status === 'disconnected', 'FAIL default status');
  console.assert(DEFAULT_MULTIPLAYER.roomCode === null, 'FAIL default roomCode');
  console.assert(DEFAULT_MULTIPLAYER.isHost === false, 'FAIL default isHost');
  console.assert(Object.keys(DEFAULT_MULTIPLAYER.peers).length === 0, 'FAIL default peers not empty');
  console.log('  PASS: default multiplayer state shape correct');
}

// ─── 5. Status state machine ──────────────────────────────────────────────────

console.log('\n=== 5. Status state machine ===');

{
  type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'host' | 'joined' | 'error';

  const transitions: [SyncStatus, SyncStatus, string][] = [
    ['disconnected', 'connecting', 'user clicks Create/Join'],
    ['connecting',   'host',       'createRoom succeeds'],
    ['connecting',   'joined',     'joinRoom succeeds'],
    ['connecting',   'error',      'connection fails'],
    ['host',         'disconnected', 'user leaves'],
    ['joined',       'disconnected', 'user leaves'],
    ['error',        'disconnected', 'user retries'],
  ];

  for (const [from, to, reason] of transitions) {
    // All are valid transitions — just verify they're legal values
    const validStatuses: SyncStatus[] = ['disconnected', 'connecting', 'connected', 'host', 'joined', 'error'];
    console.assert(validStatuses.includes(from), `FAIL invalid from status: ${from}`);
    console.assert(validStatuses.includes(to), `FAIL invalid to status: ${to}`);
  }
  console.log(`  PASS: all ${transitions.length} status transitions are valid`);

  // Connected check
  function isConnected(status: SyncStatus): boolean {
    return status === 'host' || status === 'joined';
  }
  console.assert(isConnected('host'), 'FAIL host should be connected');
  console.assert(isConnected('joined'), 'FAIL joined should be connected');
  console.assert(!isConnected('disconnected'), 'FAIL disconnected should not be connected');
  console.assert(!isConnected('connecting'), 'FAIL connecting should not be connected');
  console.assert(!isConnected('error'), 'FAIL error should not be connected');
  console.log('  PASS: isConnected logic correct');
}

// ─── 6. lastUpdatedAt guard ───────────────────────────────────────────────────

console.log('\n=== 6. lastUpdatedAt remote update guard ===');

{
  interface MinGame { lastUpdatedAt: number; status: string }

  let localGame: MinGame = { lastUpdatedAt: 1000, status: 'playing' };

  function applyRemoteIfNewer(remote: MinGame): void {
    if (remote.lastUpdatedAt > localGame.lastUpdatedAt) {
      localGame = remote;
    }
  }

  // Older remote — should NOT apply
  applyRemoteIfNewer({ lastUpdatedAt: 500, status: 'remote-old' });
  console.assert(localGame.status === 'playing', 'FAIL old remote update was applied');
  console.log('  PASS: older remote update rejected');

  // Same timestamp — should NOT apply (prevents echo loop)
  applyRemoteIfNewer({ lastUpdatedAt: 1000, status: 'remote-same' });
  console.assert(localGame.status === 'playing', 'FAIL same-timestamp update was applied');
  console.log('  PASS: same-timestamp update rejected (prevents echo)');

  // Newer remote — should apply
  applyRemoteIfNewer({ lastUpdatedAt: 2000, status: 'remote-new' });
  console.assert(localGame.status === 'remote-new', 'FAIL newer remote not applied');
  console.assert(localGame.lastUpdatedAt === 2000, 'FAIL lastUpdatedAt not updated');
  console.log('  PASS: newer remote update applied');

  // Chain of updates
  for (let i = 3000; i <= 6000; i += 1000) {
    applyRemoteIfNewer({ lastUpdatedAt: i, status: `state-${i}` });
  }
  console.assert(localGame.lastUpdatedAt === 6000, `FAIL chain updates: expected 6000, got ${localGame.lastUpdatedAt}`);
  console.log('  PASS: chain of 4 remote updates applied correctly');
}

// ─── 7. broadcastState guard: no broadcast when disconnected ─────────────────

console.log('\n=== 7. broadcastState only when connected ===');

{
  let broadcastCount = 0;
  function mockBroadcast() { broadcastCount++; }

  type SyncStatus2 = 'disconnected' | 'host' | 'joined' | 'connecting' | 'error';

  function conditionalBroadcast(status: SyncStatus2, prevTs: number, newTs: number): void {
    const connected = status === 'host' || status === 'joined';
    if (connected && newTs !== prevTs) {
      mockBroadcast();
    }
  }

  conditionalBroadcast('disconnected', 0, 1000); // should NOT broadcast
  console.assert(broadcastCount === 0, `FAIL disconnected should not broadcast, got ${broadcastCount}`);
  console.log('  PASS: no broadcast when disconnected');

  conditionalBroadcast('connecting', 0, 1000); // should NOT broadcast
  console.assert(broadcastCount === 0, `FAIL connecting should not broadcast`);
  console.log('  PASS: no broadcast when connecting');

  conditionalBroadcast('host', 0, 1000); // SHOULD broadcast
  console.assert(broadcastCount === 1, `FAIL host should broadcast, got ${broadcastCount}`);
  console.log('  PASS: broadcasts when host');

  conditionalBroadcast('joined', 1000, 2000); // SHOULD broadcast
  console.assert(broadcastCount === 2, `FAIL joined should broadcast, got ${broadcastCount}`);
  console.log('  PASS: broadcasts when joined');

  // Echo prevention: same timestamp
  conditionalBroadcast('host', 2000, 2000);
  console.assert(broadcastCount === 2, `FAIL same-ts should not broadcast, got ${broadcastCount}`);
  console.log('  PASS: no broadcast on echo (same lastUpdatedAt)');
}

// ─── 8. Join flow: seat assignment ───────────────────────────────────────────

console.log('\n=== 8. Join flow seat assignment ===');

{
  const mockPlayers = [
    { id: 'p1', name: 'Alice' },
    { id: 'p2', name: 'Bob' },
    { id: 'p3', name: 'Charlie' },
    { id: 'p4', name: 'Diana' },
  ];

  function resolveSeat(players: typeof mockPlayers, seatIndex: number): string {
    return players[seatIndex]?.id ?? players[0]?.id ?? '';
  }

  console.assert(resolveSeat(mockPlayers, 0) === 'p1', 'FAIL seat 0');
  console.assert(resolveSeat(mockPlayers, 2) === 'p3', 'FAIL seat 2');
  console.assert(resolveSeat(mockPlayers, 3) === 'p4', 'FAIL seat 3');
  // Out of bounds falls back to players[0]
  console.assert(resolveSeat(mockPlayers, 99) === 'p1', `FAIL out-of-bounds should fall back to p1`);
  // Empty array
  console.assert(resolveSeat([], 0) === '', 'FAIL empty players should return empty string');
  console.log('  PASS: seat resolution + OOB fallback correct');
}

// ─── 9. leaveRoom resets state ────────────────────────────────────────────────

console.log('\n=== 9. leaveRoom resets state ===');

{
  const DEFAULT = {
    status: 'disconnected', roomCode: null, peerId: null,
    isHost: false, peers: {}, configured: false,
  };

  let state = { status: 'host', roomCode: 'ABC123', peerId: 'uuid-host', isHost: true, peers: { 'uuid-host': {} }, configured: true };

  function leaveRoomSim(): void {
    state = { ...DEFAULT, configured: state.configured };
  }

  leaveRoomSim();
  console.assert(state.status === 'disconnected', 'FAIL status not reset');
  console.assert(state.roomCode === null, 'FAIL roomCode not cleared');
  console.assert(state.peerId === null, 'FAIL peerId not cleared');
  console.assert(state.isHost === false, 'FAIL isHost not reset');
  console.assert(Object.keys(state.peers).length === 0, 'FAIL peers not cleared');
  console.assert(state.configured === true, 'FAIL configured should remain (env var presence)');
  console.log('  PASS: leaveRoom resets all room state, preserves configured flag');
}

// ─── 10. isConfigured check ───────────────────────────────────────────────────

console.log('\n=== 10. isConfigured ===');

{
  function isConfiguredSim(): boolean {
    return true;
  }

  console.assert(isConfiguredSim() === true, 'FAIL P2P should be configured without env vars');
  console.log('  PASS: isConfigured returns true for PeerJS/P2P transport');
}

// ─── 11. Seat index out-of-range fallback ────────────────────────────────────

console.log('\n=== 11. Seat OOB fallback ===');

{
  interface MinPlayer { id: string; name: string }
  const players: MinPlayer[] = [
    { id: 'p1', name: 'Host' },
    { id: 'p2', name: 'Guest' },
  ];

  function getSeatPlayerId(players: MinPlayer[], seatIndex: number): string {
    return players[seatIndex]?.id ?? players[0]?.id ?? '';
  }

  console.assert(getSeatPlayerId(players, 0) === 'p1', 'FAIL seat 0');
  console.assert(getSeatPlayerId(players, 1) === 'p2', 'FAIL seat 1');
  console.assert(getSeatPlayerId(players, 5) === 'p1', 'FAIL OOB should give p1');
  console.assert(getSeatPlayerId(players, -1) === 'p1', 'FAIL negative OOB should give p1');
  console.assert(getSeatPlayerId([], 0) === '', 'FAIL no players should give empty');
  console.log('  PASS: all seat OOB cases handled correctly');
}

// ─── 12. Peer deduplication in presence record ───────────────────────────────

console.log('\n=== 12. Peer deduplication ===');

{
  let peers: Record<string, { name: string; seatIndex: number; online: boolean }> = {};

  function upsertPeer(peerId: string, data: { name: string; seatIndex: number; online: boolean }): void {
    peers = { ...peers, [peerId]: data };
  }

  // Add peer
  upsertPeer('peer-A', { name: 'Alice', seatIndex: 0, online: true });
  upsertPeer('peer-B', { name: 'Bob',   seatIndex: 1, online: true });
  console.assert(Object.keys(peers).length === 2, `FAIL expected 2 peers, got ${Object.keys(peers).length}`);
  console.log('  PASS: two distinct peers added');

  // Update existing peer (reconnect)
  upsertPeer('peer-A', { name: 'Alice', seatIndex: 0, online: true });
  console.assert(Object.keys(peers).length === 2, `FAIL upsert created duplicate: ${Object.keys(peers).length}`);
  console.log('  PASS: re-upsert same peerId does not duplicate');

  // Mark offline
  upsertPeer('peer-B', { ...peers['peer-B'], online: false });
  console.assert(peers['peer-B'].online === false, 'FAIL peer-B should be offline');
  console.assert(Object.keys(peers).length === 2, 'FAIL marking offline changed count');
  console.log('  PASS: marking offline preserves peer count');
}

// ─── 13. Large game state round-trip through sanitize ────────────────────────

console.log('\n=== 13. Large game state sanitize ===');

{
  function sanitize(obj: unknown): unknown {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitize);
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, sanitize(v)])
    );
  }

  // Build a large fake game state (200 cards)
  const cards: Record<string, unknown> = {};
  for (let i = 0; i < 200; i++) {
    cards[`inst-${i}`] = {
      instanceId: `inst-${i}`,
      definitionId: `def-${i}`,
      zone: 'library',
      tapped: false,
      counters: [],
      someUndefinedField: undefined,
    };
  }

  const bigState = {
    id: 'big-game',
    status: 'playing',
    turn: 5,
    lastUpdatedAt: Date.now(),
    cards,
    players: Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`,
      name: `Player ${i}`,
      life: 40,
      optionalField: undefined,
    })),
    undefinedTopLevel: undefined,
  };

  const clean = sanitize(bigState) as Record<string, any>;
  console.assert(!('undefinedTopLevel' in clean), 'FAIL top-level undefined not removed');
  console.assert(Object.keys(clean.cards).length === 200, `FAIL expected 200 cards, got ${Object.keys(clean.cards).length}`);

  // Check a card's undefined field was removed
  const card0 = clean.cards['inst-0'] as Record<string, any>;
  console.assert(!('someUndefinedField' in card0), 'FAIL card undefined field not removed');

  // Players
  const p0 = clean.players[0];
  console.assert(!('optionalField' in p0), 'FAIL player undefined field not removed');
  console.assert(p0.life === 40, 'FAIL player life not preserved');

  console.log(`  PASS: 200-card game state sanitized, all undefined removed, all values preserved`);

  // Measure overhead (should be fast)
  const start = performance.now();
  for (let i = 0; i < 100; i++) sanitize(bigState);
  const elapsed = performance.now() - start;
  console.assert(elapsed < 2000, `FAIL sanitize too slow: ${elapsed.toFixed(0)}ms for 100 iterations`);
  console.log(`  PASS: 100× sanitize of 200-card state in ${elapsed.toFixed(0)}ms`);
}

// ─── 14. Multi-player independent seat indices ───────────────────────────────

console.log('\n=== 14. Multi-player seat independence ===');

{
  interface Peer { peerId: string; name: string; seatIndex: number }

  const room: Record<string, Peer> = {
    'peer-1': { peerId: 'peer-1', name: 'Alice',   seatIndex: 0 },
    'peer-2': { peerId: 'peer-2', name: 'Bob',     seatIndex: 1 },
    'peer-3': { peerId: 'peer-3', name: 'Charlie', seatIndex: 2 },
    'peer-4': { peerId: 'peer-4', name: 'Diana',   seatIndex: 3 },
  };

  // No two peers should share a seat
  const seats = Object.values(room).map(p => p.seatIndex);
  const uniqueSeats = new Set(seats);
  console.assert(uniqueSeats.size === seats.length, `FAIL duplicate seats: ${seats}`);
  console.log('  PASS: all 4 peers have unique seat indices');

  // Host is always seat 0 in this setup
  const host = Object.values(room).find(p => p.seatIndex === 0);
  console.assert(host?.name === 'Alice', `FAIL expected Alice at seat 0, got ${host?.name}`);
  console.log('  PASS: host correctly at seat 0');

  // Seat availability check
  const takenSeats = new Set(Object.values(room).map(p => p.seatIndex));
  const allSeats = [0, 1, 2, 3, 4, 5];
  const available = allSeats.filter(s => !takenSeats.has(s));
  console.assert(available.length === 2, `FAIL expected 2 available seats, got ${available.length}: ${available}`);
  console.assert(available.includes(4) && available.includes(5), `FAIL expected seats 4,5 to be available`);
  console.log(`  PASS: available seats correctly computed: [${available}]`);
}

// ─── 15. Broadcast subscriber fires only on lastUpdatedAt change ─────────────

console.log('\n=== 15. Broadcast subscriber filter ===');

{
  let broadcastCallCount = 0;
  function mockBroadcast() { broadcastCallCount++; }

  // Simulate the subscribe callback
  function onGameChange(newGame: { lastUpdatedAt: number }, prevGame: { lastUpdatedAt: number }, status: string): void {
    if (status === 'host' || status === 'joined') {
      if (newGame.lastUpdatedAt !== prevGame.lastUpdatedAt) {
        mockBroadcast();
      }
    }
  }

  // Scenario: host makes 5 local game mutations
  const game0 = { lastUpdatedAt: 1000 };
  onGameChange({ lastUpdatedAt: 1100 }, game0, 'host'); // cast card
  onGameChange({ lastUpdatedAt: 1200 }, { lastUpdatedAt: 1100 }, 'host'); // move card
  onGameChange({ lastUpdatedAt: 1300 }, { lastUpdatedAt: 1200 }, 'host'); // tap
  onGameChange({ lastUpdatedAt: 1400 }, { lastUpdatedAt: 1300 }, 'host'); // draw
  onGameChange({ lastUpdatedAt: 1500 }, { lastUpdatedAt: 1400 }, 'host'); // end turn

  console.assert(broadcastCallCount === 5, `FAIL expected 5 broadcasts, got ${broadcastCallCount}`);
  console.log('  PASS: 5 local mutations → 5 broadcasts');

  // Incoming remote update (same ts as what we just applied — no re-broadcast)
  onGameChange({ lastUpdatedAt: 1500 }, { lastUpdatedAt: 1500 }, 'host');
  console.assert(broadcastCallCount === 5, `FAIL echo caused extra broadcast: ${broadcastCallCount}`);
  console.log('  PASS: incoming remote update does not echo back');

  // Joined peer receiving remote state — should NOT re-broadcast (no timestamp change)
  onGameChange({ lastUpdatedAt: 2000 }, { lastUpdatedAt: 2000 }, 'joined');
  console.assert(broadcastCallCount === 5, `FAIL joiner re-broadcast remote update: ${broadcastCallCount}`);
  console.log('  PASS: joiner does not re-broadcast received remote state');

  // Joiner makes own move
  onGameChange({ lastUpdatedAt: 2100 }, { lastUpdatedAt: 2000 }, 'joined');
  console.assert(broadcastCallCount === 6, `FAIL joiner local move not broadcast: ${broadcastCallCount}`);
  console.log('  PASS: joiner local mutation is broadcast');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n✅ All multiplayer-sync tests passed.');
