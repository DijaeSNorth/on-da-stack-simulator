import {
  BACKPRESSURE_LIMITS,
  createStringChunks,
  getBackpressureLevel,
  planChunkBurst,
  shouldDropNonessentialSend,
  shouldPauseChunkSend,
} from '../client/src/engine/backpressureQueue';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(BACKPRESSURE_LIMITS.warningBytes === 64_000, 'warning threshold should match brief');
assert(BACKPRESSURE_LIMITS.chunkBytes === 12_000, 'chunk size should match brief');
assert(BACKPRESSURE_LIMITS.maxChunksPerBurst === 8, 'burst size should match brief');
assert(BACKPRESSURE_LIMITS.highBufferedAmount === 512_000, 'high buffer threshold should match brief');
assert(BACKPRESSURE_LIMITS.criticalBufferedAmount === 2_000_000, 'critical buffer threshold should match brief');
assert(BACKPRESSURE_LIMITS.bufferedAmountLowThreshold === 128_000, 'low-water threshold should match brief');

const chunks = createStringChunks('x'.repeat(BACKPRESSURE_LIMITS.chunkBytes * 2 + 5));
assert(chunks.length === 3, `expected 3 chunks, got ${chunks.length}`);
assert(chunks[0].length === BACKPRESSURE_LIMITS.chunkBytes, 'first chunk should use configured size');

const burst = planChunkBurst(20, 0, 0);
assert(burst.endIndexExclusive === 8, `expected first burst to send 8 chunks, got ${burst.endIndexExclusive}`);
assert(!burst.shouldPause, 'open buffer should not pause');

const high = planChunkBurst(20, 8, BACKPRESSURE_LIMITS.highBufferedAmount);
assert(high.shouldPause, 'high buffer should pause chunk sends');
assert(high.endIndexExclusive === 8, 'paused burst should not advance');
assert(shouldPauseChunkSend(BACKPRESSURE_LIMITS.highBufferedAmount), 'high buffer should request pause');

const critical = planChunkBurst(20, 8, BACKPRESSURE_LIMITS.criticalBufferedAmount);
assert(critical.shouldPause, 'critical buffer should pause chunk sends');
assert(critical.shouldDropNonessential, 'critical buffer should drop nonessential sends');
assert(shouldDropNonessentialSend(BACKPRESSURE_LIMITS.criticalBufferedAmount), 'critical buffer should drop nonessential traffic');
assert(getBackpressureLevel(BACKPRESSURE_LIMITS.warningBytes) === 'warning', 'warning threshold should classify as warning');

console.log('PASS backpressure queue helpers preserve chunk size, burst, pause, and critical thresholds');
