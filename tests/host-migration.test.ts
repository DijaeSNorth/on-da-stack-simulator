/**
 * Host migration regression checks.
 *
 * Run with: npx tsx tests/host-migration.test.ts
 */

import { chooseMigrationHost, type RoomPresence } from '../client/src/engine/multiplayerSync';

function presence(
  peerId: string,
  seatIndex: number,
  score: number,
  online = true,
  isSpectator = false
): RoomPresence {
  return {
    peerId,
    name: peerId,
    color: '#3b82f6',
    seatIndex,
    isSpectator,
    online,
    lastSeen: Date.now(),
    connectionQuality: { rttMs: 1000 - score, score, samples: 3, updatedAt: Date.now() },
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const peers: Record<string, RoomPresence> = {
  weak: presence('weak', 0, 200),
  best: presence('best', 1, 920),
  offline: presence('offline', 2, 999, false),
  spectator: presence('spectator', -1, 1000, true, true),
};

assert(chooseMigrationHost(peers)?.peerId === 'best', 'expected strongest online seated peer to win');

const tied: Record<string, RoomPresence> = {
  seat2: presence('seat2', 2, 500),
  seat0: presence('seat0', 0, 500),
};
assert(chooseMigrationHost(tied)?.peerId === 'seat0', 'expected lower seat to win tied scores');

assert(
  chooseMigrationHost({ spectator: presence('spectator', -1, 1000, true, true) }) === null,
  'expected no migration host when only spectators are present'
);

console.log('PASS host migration elects the best eligible peer');
