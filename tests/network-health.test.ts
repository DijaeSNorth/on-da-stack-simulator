import {
  createInitialConnectionHealth,
  markConnectionChunkTimeout,
  markConnectionMissedPong,
  updateConnectionBuffer,
  updateConnectionChannel,
  updateConnectionFromPong,
} from '../client/src/engine/networkHealth';
import { BACKPRESSURE_LIMITS } from '../client/src/engine/backpressureQueue';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const initial = createInitialConnectionHealth({ now: 1000, dataChannelOpen: true, firebaseRecoveryAvailable: true });
assert(initial.quality === 'excellent', `expected excellent, got ${initial.quality}`);
assert(initial.firebaseRecoveryAvailable, 'expected recovery availability to be tracked');

const pong = updateConnectionFromPong(initial, 88, 1100);
assert(pong.quality === 'excellent', `expected excellent pong, got ${pong.quality}`);
assert(pong.rttMs === 88, 'expected rtt to update from pong');
assert(pong.missedPongs === 0, 'pong should clear missed pongs');

const warningBuffer = updateConnectionBuffer(pong, BACKPRESSURE_LIMITS.warningBytes, true, 1200);
assert(warningBuffer.quality === 'good', `expected good buffer warning, got ${warningBuffer.quality}`);
assert(warningBuffer.reasons.includes('send buffer rising'), 'expected buffer reason');

const degradedBuffer = updateConnectionBuffer(pong, BACKPRESSURE_LIMITS.highBufferedAmount, true, 1300);
assert(degradedBuffer.quality === 'degraded', `expected degraded high buffer, got ${degradedBuffer.quality}`);

let missed = pong;
missed = markConnectionMissedPong(missed, 1400);
assert(missed.quality === 'degraded', `expected degraded after one missed pong, got ${missed.quality}`);
missed = markConnectionMissedPong(missed, 1500);
missed = markConnectionMissedPong(missed, 1600);
assert(missed.quality === 'critical', `expected critical after repeated missed pongs, got ${missed.quality}`);

const firstTimeout = markConnectionChunkTimeout(pong, { resendRequested: true, now: 1700 });
assert(firstTimeout.chunkTimeouts === 1, 'expected chunk timeout count');
assert(firstTimeout.resendCount === 1, 'expected resend count');
assert(firstTimeout.quality === 'degraded', `expected degraded after first chunk timeout, got ${firstTimeout.quality}`);

const secondTimeout = markConnectionChunkTimeout(firstTimeout, { now: 1800 });
assert(secondTimeout.quality === 'critical', `expected critical after repeated chunk timeouts, got ${secondTimeout.quality}`);

const offline = updateConnectionChannel(pong, false, 1900);
assert(offline.quality === 'offline', `expected offline, got ${offline.quality}`);
assert(offline.reasons.includes('data channel closed'), 'expected closed reason');

console.log('PASS network health model classifies RTT, buffer, heartbeat, resend, and offline states');
