/**
 * Automatic lobby seat assignment regression checks.
 *
 * Run with: npx tsx tests/automatic-seat-assignment.test.ts
 */

import { canonicalizeJoinPresence, chooseAutomaticSeat, pruneDuplicatePeerPresence, type RoomPresence } from '../client/src/engine/multiplayerSync';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function presence(peerId: string, seatIndex: number, isSpectator = false, online = true): RoomPresence {
  return {
    peerId,
    name: peerId,
    color: '#3b82f6',
    seatIndex,
    isSpectator,
    online,
    lastSeen: Date.now(),
  };
}

const peers: Record<string, RoomPresence> = {
  host: presence('host', 0),
  seatTwo: presence('seatTwo', 2),
  spectator: presence('spectator', -1, true),
  offlineSeatOne: presence('offlineSeatOne', 1, false, false),
};

const fillsLowestOpen = chooseAutomaticSeat(peers, 4, presence('newPlayer', 0));
assert(!fillsLowestOpen.isSpectator, 'expected player request to become a player');
assert(fillsLowestOpen.seatIndex === 1, 'expected automatic assignment to fill the lowest open seat');

const spectator = chooseAutomaticSeat(peers, 4, presence('newSpectator', -1, true));
assert(spectator.isSpectator, 'expected spectator request to stay spectator');
assert(spectator.seatIndex === -1, 'expected spectator to have no seat');

const temporaryJoinPresence = presence('temporary-local-id', 0);
const canonicalJoinPresence = canonicalizeJoinPresence('peerjs-connection-id', temporaryJoinPresence);
assert(canonicalJoinPresence.peerId === 'peerjs-connection-id', 'expected joiner presence to use the canonical PeerJS connection id');
assert(canonicalJoinPresence.seatIndex === temporaryJoinPresence.seatIndex, 'expected canonical presence to preserve requested role/seat data');

const fullTable = chooseAutomaticSeat({
  seat0: presence('seat0', 0),
  seat1: presence('seat1', 1),
}, 2, presence('latePlayer', 0));
assert(fullTable.isSpectator, 'expected full table player request to become spectator');
assert(fullTable.seatIndex === -1, 'expected full table player request to have no seat');

const duplicatePeers: Record<string, RoomPresence> = {
  oldOfflineAlex: { ...presence('oldOfflineAlex', 1, false, false), name: 'Alex' },
  onlineAlex: { ...presence('onlineAlex', 2), name: 'Alex' },
  offlineSam: { ...presence('offlineSam', 3, false, false), name: 'Sam' },
};
const pruned = pruneDuplicatePeerPresence(duplicatePeers, { ...presence('newAlex', 0), name: 'Alex' });
assert(!pruned.oldOfflineAlex, 'expected old offline duplicate with same player name to be removed');
assert(pruned.onlineAlex, 'expected online player with same name to be preserved');
assert(pruned.offlineSam, 'expected unrelated offline player to be preserved');

console.log('PASS automatic seat assignment fills open seats, handles full tables, and prunes stale duplicate rejoins');
