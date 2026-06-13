import {
  child,
  get,
  off,
  onDisconnect,
  onValue,
  ref,
  remove,
  set,
  update,
  type DataSnapshot,
  type Unsubscribe,
} from 'firebase/database';
import { getFirebaseDatabase, isFirebaseRecoveryConfigured } from '../config/firebase';
import type { GameState, Player, CardState } from '../types/game';
import {
  type FirebaseActionRelayEntry,
  type FirebasePresenceRole,
  type FirebasePresenceState,
  type FirebasePrivatePlayerSnapshot,
  type FirebasePublicCard,
  type FirebasePublicPlayerSnapshot,
  type FirebasePublicStartSnapshot,
  type FirebaseResyncReason,
  type FirebaseResyncRequest,
  type FirebaseRoomControl,
} from '../types/firebaseMultiplayer';
import { sanitizeGameStateForPlayer } from './multiplayerProtocol';

function now(): number {
  return Date.now();
}

function roomPath(roomCode: string): string {
  return `rooms/${roomCode.toUpperCase()}`;
}

function cardPublicSnapshot(card: CardState): FirebasePublicCard {
  return {
    instanceId: card.instanceId,
    definitionId: card.definitionId,
    name: card.definition.name,
    typeLine: card.definition.typeLine,
    zone: card.zone,
    ownerId: card.ownerId,
    controllerId: card.controllerId,
    tapped: card.tapped,
    faceDown: card.faceDown,
    transformed: card.transformed,
  };
}

function cardsForPlayerZone(game: GameState, player: Player, ids: string[]): FirebasePublicCard[] {
  return ids
    .map(id => game.cards[id])
    .filter((card): card is CardState => Boolean(card))
    .map(cardPublicSnapshot);
}

function commanderNames(game: GameState, player: Player): string[] {
  return player.commanders
    .map(id => game.cards[id]?.definition.name)
    .filter((name): name is string => Boolean(name));
}

export function buildFirebasePublicStartSnapshot(
  game: GameState,
  snapshotId = `${game.id}-${now()}`,
  createdAt = now(),
): FirebasePublicStartSnapshot {
  return {
    snapshotId,
    gameId: game.id,
    status: 'playing',
    players: game.players.map((player): FirebasePublicPlayerSnapshot => ({
      id: player.id,
      name: player.name,
      seatIndex: player.seatIndex,
      life: player.life,
      handCount: player.hand.length,
      libraryCount: player.library.length,
      commanderNames: commanderNames(game, player),
      battlefield: cardsForPlayerZone(game, player, player.battlefield),
      graveyard: cardsForPlayerZone(game, player, player.graveyard),
      exile: cardsForPlayerZone(game, player, player.exile),
      command: cardsForPlayerZone(game, player, player.commandZone),
    })),
    turn: game.turn,
    phase: game.phase,
    actionSeq: game.actionLog.length,
    createdAt,
  };
}

export function buildFirebasePrivateStartSnapshots(
  game: GameState,
  snapshotId: string,
  createdAt = now(),
): Record<string, FirebasePrivatePlayerSnapshot> {
  return Object.fromEntries(game.players.map(player => [player.id, {
    snapshotId,
    gameId: game.id,
    playerId: player.id,
    hand: [...player.hand],
    library: [...player.library],
    sanitizedGame: buildFirebaseRecoveryGameForPlayer(game, player.id),
    createdAt,
  } satisfies FirebasePrivatePlayerSnapshot]));
}

function buildFirebaseRecoveryGameForPlayer(game: GameState, playerId: string): GameState {
  const sanitizedGame = sanitizeGameStateForPlayer(game, playerId);
  const visibleDefinitionIds = new Set(
    Object.values(sanitizedGame.cards).map(card => card.definitionId),
  );
  return {
    ...sanitizedGame,
    definitions: Object.fromEntries(
      Object.entries(sanitizedGame.definitions).filter(([definitionId]) => visibleDefinitionIds.has(definitionId)),
    ),
  };
}

export function buildFirebaseActionRelayPlaceholder(entry: FirebaseActionRelayEntry): FirebaseActionRelayEntry {
  return entry;
}

export function stripFirebaseUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => stripFirebaseUndefined(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, stripFirebaseUndefined(entryValue)]),
    ) as T;
  }
  return value;
}

export async function writeFirebaseRoomControl(control: FirebaseRoomControl): Promise<void> {
  const db = getFirebaseDatabase();
  if (!db) return;
  await set(ref(db, `${roomPath(control.roomCode)}/control`), stripFirebaseUndefined(control));
}

export async function patchFirebaseRoomControl(roomCode: string, patch: Partial<FirebaseRoomControl>): Promise<void> {
  const db = getFirebaseDatabase();
  if (!db) return;
  await update(ref(db, `${roomPath(roomCode)}/control`), stripFirebaseUndefined({ ...patch, updatedAt: now() }));
}

export async function writeFirebasePresence(
  roomCode: string,
  presence: Omit<FirebasePresenceState, 'online' | 'lastSeen'>,
): Promise<() => void> {
  const db = getFirebaseDatabase();
  if (!db) return () => {};
  const presenceRef = ref(db, `${roomPath(roomCode)}/presence/${presence.playerId}`);
  const connectedRef = ref(db, '.info/connected');
  const onlineState: FirebasePresenceState = {
    ...presence,
    online: true,
    connectionState: 'connected',
    lastSeen: now(),
  };
  const offlineState = {
    online: false,
    connectionState: 'disconnected',
    lastSeen: now(),
  };
  await set(presenceRef, onlineState);
  await onDisconnect(presenceRef).update(offlineState);

  const unsubscribe = onValue(connectedRef, snapshot => {
    if (snapshot.val() === true) {
      void set(presenceRef, { ...onlineState, lastSeen: now() });
      void onDisconnect(presenceRef).update({ online: false, connectionState: 'disconnected', lastSeen: now() });
    }
  });

  return () => {
    unsubscribe();
    void onDisconnect(presenceRef).cancel();
    void update(presenceRef, { online: false, connectionState: 'disconnected', lastSeen: now() });
  };
}

export async function writeFirebaseStartSnapshot(
  roomCode: string,
  game: GameState,
  hostPeerId: string,
  startSeq: number,
  privateAliases: Record<string, string> = {},
): Promise<string | null> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const createdAt = now();
  const snapshotId = `${game.id}-${createdAt}`;
  const publicSnapshot = buildFirebasePublicStartSnapshot(game, snapshotId, createdAt);
  const privateSnapshots = buildFirebasePrivateStartSnapshots(game, snapshotId, createdAt);
  const updates: Record<string, unknown> = {
    [`${roomPath(roomCode)}/snapshots/${snapshotId}/public`]: publicSnapshot,
    [`${roomPath(roomCode)}/control`]: {
      roomCode,
      roomId: roomCode,
      hostPeerId,
      status: 'playing',
      startSeq,
      gameId: game.id,
      latestSnapshotId: snapshotId,
      updatedAt: createdAt,
      startedAt: createdAt,
    } satisfies FirebaseRoomControl,
  };
  for (const [playerId, privateSnapshot] of Object.entries(privateSnapshots)) {
    updates[`${roomPath(roomCode)}/snapshots/${snapshotId}/private/${playerId}`] = privateSnapshot;
  }
  for (const [aliasPlayerId, gamePlayerId] of Object.entries(privateAliases)) {
    const privateSnapshot = privateSnapshots[gamePlayerId];
    if (privateSnapshot) {
      updates[`${roomPath(roomCode)}/snapshots/${snapshotId}/private/${aliasPlayerId}`] = {
        ...privateSnapshot,
        playerId: aliasPlayerId,
      };
    }
  }
  await update(ref(db), stripFirebaseUndefined(updates));
  return snapshotId;
}

export function listenFirebaseRoomControl(
  roomCode: string,
  onControl: (control: FirebaseRoomControl | null) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  if (!db) return () => {};
  return onValue(ref(db, `${roomPath(roomCode)}/control`), snapshot => {
    onControl(snapshot.val() as FirebaseRoomControl | null);
  });
}

export function listenFirebaseResyncRequests(
  roomCode: string,
  onRequest: (request: FirebaseResyncRequest) => void,
): Unsubscribe {
  const db = getFirebaseDatabase();
  if (!db) return () => {};
  return onValue(ref(db, `${roomPath(roomCode)}/resyncRequests`), snapshot => {
    const requests = (snapshot.val() ?? {}) as Record<string, FirebaseResyncRequest>;
    for (const request of Object.values(requests)) {
      if (!request.handledAt) onRequest(request);
    }
  });
}

export async function writeFirebaseResyncRequest(
  roomCode: string,
  playerId: string,
  peerId: string,
  reason: FirebaseResyncReason,
): Promise<string | null> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const requestId = `${playerId}-${now()}`;
  const request: FirebaseResyncRequest = {
    requestId,
    playerId,
    peerId,
    reason,
    requestedAt: now(),
  };
  await set(ref(db, `${roomPath(roomCode)}/resyncRequests/${requestId}`), request);
  return requestId;
}

export async function markFirebaseResyncHandled(roomCode: string, requestId: string): Promise<void> {
  const db = getFirebaseDatabase();
  if (!db) return;
  await update(ref(db, `${roomPath(roomCode)}/resyncRequests/${requestId}`), { handledAt: now() });
}

export async function loadFirebaseRecoverySnapshot(
  roomCode: string,
  snapshotId: string,
  playerId: string,
): Promise<FirebasePrivatePlayerSnapshot | null> {
  const db = getFirebaseDatabase();
  if (!db) return null;
  const snapshot = await get(child(ref(db), `${roomPath(roomCode)}/snapshots/${snapshotId}/private/${playerId}`));
  return snapshot.exists() ? snapshot.val() as FirebasePrivatePlayerSnapshot : null;
}

export async function removeFirebasePresence(roomCode: string, playerId: string): Promise<void> {
  const db = getFirebaseDatabase();
  if (!db) return;
  await remove(ref(db, `${roomPath(roomCode)}/presence/${playerId}`));
}

export { isFirebaseRecoveryConfigured };
export type { DataSnapshot };
