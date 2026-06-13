import type { GameState, Phase, Zone } from './game';

export type FirebaseRoomStatus = 'lobby' | 'starting' | 'playing' | 'ended';
export type FirebasePresenceRole = 'host' | 'player' | 'spectator';
export type FirebaseConnectionState = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
export type FirebaseResyncReason = 'joined-late' | 'missed-peerjs-patch' | 'manual-sync' | 'reconnect' | 'chunk-timeout';
export type FirebaseRelayActionStatus = 'pending' | 'accepted' | 'rejected';

export interface FirebaseRoomControl {
  roomCode: string;
  roomId: string;
  hostPeerId: string;
  hostUid?: string;
  status: FirebaseRoomStatus;
  startSeq: number;
  gameId?: string;
  latestSnapshotId?: string;
  updatedAt: number;
  startedAt?: number;
}

export interface FirebasePresenceState {
  playerId: string;
  peerId: string;
  authUid?: string;
  participantToken?: string;
  displayName: string;
  seatIndex: number;
  role: FirebasePresenceRole;
  online: boolean;
  connectionState: FirebaseConnectionState;
  lastSeen: number;
}

export interface FirebaseParticipantState {
  playerId: string;
  peerId: string;
  uid: string;
  token: string;
  role: FirebasePresenceRole;
  seatIndex: number;
  joinedAt: number;
  lastSeen: number;
}

export interface FirebasePublicCard {
  instanceId: string;
  definitionId: string;
  name: string;
  typeLine: string;
  zone: Zone;
  ownerId: string;
  controllerId: string;
  tapped: boolean;
  faceDown: boolean;
  transformed: boolean;
}

export interface FirebasePublicPlayerSnapshot {
  id: string;
  name: string;
  seatIndex: number;
  life: number;
  handCount: number;
  libraryCount: number;
  commanderNames: string[];
  battlefield: FirebasePublicCard[];
  graveyard: FirebasePublicCard[];
  exile: FirebasePublicCard[];
  command: FirebasePublicCard[];
}

export interface FirebasePublicStartSnapshot {
  snapshotId: string;
  gameId: string;
  status: 'playing';
  players: FirebasePublicPlayerSnapshot[];
  turn: number;
  phase: Phase;
  actionSeq: number;
  createdAt: number;
}

export interface FirebasePrivatePlayerSnapshot {
  snapshotId: string;
  gameId: string;
  playerId: string;
  hand: string[];
  library: string[];
  privateChoices?: unknown[];
  sanitizedGame?: GameState;
  createdAt: number;
}

export interface FirebaseResyncRequest {
  requestId: string;
  playerId: string;
  peerId: string;
  authUid?: string;
  reason: FirebaseResyncReason;
  requestedAt: number;
  handledAt?: number;
}

export interface FirebaseActionRelayEntry {
  actionId: string;
  gameId: string;
  playerId: string;
  seq: number;
  actionType: string;
  payload: unknown;
  createdAt: number;
  status: FirebaseRelayActionStatus;
}
