/**
 * Multiplayer start delivery regression checks.
 *
 * Run with: npx tsx tests/multiplayer-start-delivery.test.ts
 */

import type { DataConnection } from 'peerjs';
import {
  __multiplayerSyncTest,
  sendStartGameCommit,
  type RoomPresence,
} from '../client/src/engine/multiplayerSync';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import type { CardDefinition, GameState } from '../client/src/types/game';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function presence(peerId: string, playerId: string, seatIndex: number, isHostPeer = false): RoomPresence {
  return {
    playerId,
    peerId,
    sessionId: `session-${peerId}`,
    name: peerId,
    color: seatIndex === 0 ? '#3b82f6' : '#ef4444',
    seatIndex,
    isSpectator: false,
    isHostPeer,
    online: true,
    lastSeen: Date.now(),
    deckStatus: 'valid',
    ready: true,
  };
}

function fakeConnection(peerId: string, sent: unknown[]): DataConnection {
  return {
    peer: peerId,
    open: true,
    send(message: unknown) {
      sent.push(message);
    },
  } as DataConnection;
}

const vanilla: CardDefinition = {
  id: 'private-test-card',
  name: 'Private Test Card',
  cmc: 1,
  typeLine: 'Creature - Test',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Test'],
  oracleText: '',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '1',
  toughness: '1',
};

function gameWithPrivateHands(): GameState {
  const config = createDefaultGameConfig(2);
  const p1 = createPlayer('game-host', 'Host', 0, '#3b82f6', config);
  const p2 = createPlayer('game-guest', 'Guest', 1, '#ef4444', config);
  const hostCard = createCardState({ ...vanilla, id: 'host-private', name: 'Host Private' }, p1.id, 'hand');
  const guestCard = createCardState({ ...vanilla, id: 'guest-private', name: 'Guest Private' }, p2.id, 'hand');
  return {
    ...createEmptyGameState(config),
    status: 'lobby',
    players: [
      { ...p1, hand: [hostCard.instanceId] },
      { ...p2, hand: [guestCard.instanceId] },
    ],
    cards: {
      [hostCard.instanceId]: hostCard,
      [guestCard.instanceId]: guestCard,
    },
    activePlayerId: p1.id,
    priorityPlayerId: p1.id,
  };
}

function messageTypes(sent: unknown[]): string[] {
  return sent.map(message => (message as { type?: string }).type).filter(Boolean) as string[];
}

function payloadOf<T>(sent: unknown[], type: string): T {
  const envelope = sent.find(message => (message as { type?: string }).type === type) as { payload?: T } | undefined;
  assert(Boolean(envelope?.payload), `expected ${type} payload`);
  return envelope!.payload as T;
}

async function main(): Promise<void> {
  const sent: unknown[] = [];
  const game = gameWithPrivateHands();
  const guestConn = fakeConnection('guest-peer', sent);
  __multiplayerSyncTest.seedHostState({
    roomCode: 'ROOMSTART',
    hostPeerId: 'host-peer',
    playerId: 'player-host',
    sessionId: 'session-host',
    game,
    peers: [
      presence('host-peer', 'player-host', 0, true),
      presence('guest-peer', 'player-guest', 1),
    ],
    connections: [guestConn],
  });

  sendStartGameCommit({
    id: 'start-1',
    game,
    fallback: false,
    missingPeerIds: [],
    committedAt: Date.now(),
  });
  await wait(25);

  const types = messageTypes(sent);
  assert(types.includes('LOBBY_STATE'), 'expected host to send LOBBY_STATE during start commit');
  assert(types.includes('START_GAME_COMMIT'), 'expected host to send START_GAME_COMMIT during start commit');
  assert(!types.includes('GAME_STATE_PATCH'), 'expected no duplicate GAME_STATE_PATCH when START_GAME_COMMIT sends successfully');
  assert(
    types.indexOf('START_GAME_COMMIT') < types.indexOf('LOBBY_STATE'),
    'expected START_GAME_COMMIT to be sent before playing LOBBY_STATE',
  );

  const lobby = payloadOf<{ status: string }>(sent, 'LOBBY_STATE');
  assert(lobby.status === 'playing', `expected playing lobby state, got ${lobby.status}`);
  const commit = payloadOf<{ game: GameState }>(sent, 'START_GAME_COMMIT');
  assert(commit.game.status === 'playing', `expected playing commit game, got ${commit.game.status}`);
  assert(commit.game.players[0].hand[0].startsWith('hidden-hand-game-host'), 'expected host hand to be hidden from guest');
  assert(commit.game.players[1].hand[0] && !commit.game.players[1].hand[0].startsWith('hidden-hand'), 'expected guest hand to remain visible to guest');

  const lateSent: unknown[] = [];
  const lateConn = fakeConnection('late-guest-peer', lateSent);
  __multiplayerSyncTest.seedHostState({
    roomCode: 'ROOMLATE',
    hostPeerId: 'host-peer',
    playerId: 'player-host',
    sessionId: 'session-host',
    game,
    peers: [presence('host-peer', 'player-host', 0, true)],
    connections: [lateConn],
  });
  sendStartGameCommit({
    id: 'start-late',
    game,
    fallback: true,
    missingPeerIds: ['late-guest-peer'],
    committedAt: Date.now(),
  });
  await wait(25);
  assert(messageTypes(lateSent).includes('LOBBY_STATE'), 'expected late joiner to receive playing lobby even before presence');
  assert(!messageTypes(lateSent).includes('START_GAME_COMMIT'), 'expected no commit before the host knows late joiner presence');

  __multiplayerSyncTest.upsertPresence(presence('late-guest-peer', 'player-guest', 1));
  __multiplayerSyncTest.replayStartedGameSnapshot('late-guest-peer', 'presence-after-start-test');
  assert(messageTypes(lateSent).includes('START_GAME_COMMIT'), 'expected start replay after late presence is known');
  assert(!messageTypes(lateSent).includes('GAME_STATE_PATCH'), 'expected no duplicate patch replay when commit replay succeeds');

  __multiplayerSyncTest.reset();
  console.log('PASS multiplayer start delivery sends commit before playing lobby and replays after late presence');
}

main().catch(error => {
  __multiplayerSyncTest.reset();
  console.error(error);
  process.exit(1);
});
