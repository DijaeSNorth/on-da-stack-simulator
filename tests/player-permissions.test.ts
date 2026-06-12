/**
 * Player permission regression checks.
 *
 * Run with: npx tsx tests/player-permissions.test.ts
 */

import { canControlPlayer } from '../client/src/engine/playerPermissions';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(canControlPlayer('p1', 'p2', 'disconnected', false), 'offline sandbox should allow controlling all players');
assert(canControlPlayer('p1', 'p2', 'connecting', false), 'setup/connecting state should allow local setup edits');
assert(canControlPlayer('p1', 'p1', 'host', false), 'host should control their own assigned player');
assert(!canControlPlayer('p1', 'p2', 'host', false), 'host should not control another seated player without judge mode');
assert(canControlPlayer('p2', 'p2', 'joined', false), 'joiner should control their own assigned player');
assert(!canControlPlayer('p2', 'p1', 'joined', false), 'joiner should not control another player');
assert(!canControlPlayer('p2', 'p2', 'spectator', false), 'spectator should not control players');
assert(canControlPlayer('p2', 'p1', 'spectator', true), 'judge mode should override player restrictions');

console.log('PASS player permissions enforce assigned seats in multiplayer');
