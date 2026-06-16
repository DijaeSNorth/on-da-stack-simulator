/**
 * Simple multiplayer lobby UI copy/CTA regression checks.
 *
 * Run with: npx tsx tests/simple-lobby-ui.test.ts
 */

import { getFriendlyDeckLabel, getLocalPlayerCtaLabel } from '../client/src/components/multiplayer/MultiplayerPanel';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(getFriendlyDeckLabel('none') === 'Needs Deck', 'expected missing deck to use friendly copy');
assert(getFriendlyDeckLabel('submitted') === 'Checking Deck', 'expected submitted deck to use friendly copy');
assert(getFriendlyDeckLabel('valid') === 'Deck Checked', 'expected valid deck to use friendly copy');
assert(getFriendlyDeckLabel('rejected') === 'Deck Rejected', 'expected rejected deck to use friendly copy');

assert(
  getLocalPlayerCtaLabel({
    connected: true,
    isHost: false,
    localDeckStatus: 'none',
    localReady: false,
    joinerCanEnterStartedGame: false,
    joinerNeedsGamePatch: false,
  }) === 'Choose Deck',
  'expected connected player without a deck to choose deck',
);

assert(
  getLocalPlayerCtaLabel({
    connected: true,
    isHost: false,
    localDeckStatus: 'valid',
    localReady: false,
    joinerCanEnterStartedGame: false,
    joinerNeedsGamePatch: false,
  }) === 'Mark Ready',
  'expected valid local deck to enable ready CTA',
);

assert(
  getLocalPlayerCtaLabel({
    connected: true,
    isHost: false,
    localDeckStatus: 'valid',
    localReady: true,
    joinerCanEnterStartedGame: false,
    joinerNeedsGamePatch: false,
  }) === 'Ready - waiting for host',
  'expected ready joiner to avoid old Waiting for Host to Start copy',
);

assert(
  getLocalPlayerCtaLabel({
    connected: true,
    isHost: false,
    localDeckStatus: 'valid',
    localReady: true,
    joinerCanEnterStartedGame: true,
    joinerNeedsGamePatch: false,
  }) === 'Enter Game',
  'expected started-game fallback to expose Enter Game',
);

assert(
  getLocalPlayerCtaLabel({
    connected: true,
    isHost: false,
    localDeckStatus: 'valid',
    localReady: true,
    joinerCanEnterStartedGame: false,
    joinerNeedsGamePatch: true,
  }) === 'Sync From Host',
  'expected missing patch fallback to expose Sync From Host',
);

console.log('PASS simple multiplayer lobby UI copy and CTA helpers');
