import {
  computeAdaptivePerformance,
  computeFrameHealth,
  createInitialFrameHealth,
  type AdaptivePerformanceMode,
} from '../client/src/engine/adaptivePerformance';
import {
  createInitialConnectionHealth,
  updateConnectionBuffer,
  updateConnectionChannel,
  updateConnectionFromPong,
} from '../client/src/engine/networkHealth';
import { BACKPRESSURE_LIMITS } from '../client/src/engine/backpressureQueue';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function perf(mode: AdaptivePerformanceMode, connection = excellent, frame = smooth) {
  return computeAdaptivePerformance(connection, frame, { mode }, 1000);
}

const smooth = createInitialFrameHealth(1000);
const excellent = updateConnectionFromPong(createInitialConnectionHealth({ dataChannelOpen: true }), 70, 1000);

const autoFull = perf('auto');
assert(autoFull.animationQuality === 'full', `expected full auto quality, got ${autoFull.animationQuality}`);
assert(!autoFull.disableReplayDramaticEffects, 'full quality should allow dramatic replay effects');

const degraded = updateConnectionBuffer(excellent, BACKPRESSURE_LIMITS.highBufferedAmount, true, 1100);
const autoReduced = perf('auto', degraded);
assert(autoReduced.animationQuality === 'reduced', `expected reduced on degraded connection, got ${autoReduced.animationQuality}`);
assert(autoReduced.disableReplayDramaticEffects, 'degraded connection should disable dramatic replay effects');

const offline = updateConnectionChannel(excellent, false, 1200);
const autoOff = perf('auto', offline);
assert(autoOff.animationQuality === 'off', `expected off for offline connection, got ${autoOff.animationQuality}`);
assert(autoOff.disableLiveAnimations, 'offline connection should disable live animations');

const busyFrame = computeFrameHealth([16, 24, 28, 35, 22, 27], 1300);
const busyPerf = perf('auto', excellent, busyFrame);
assert(busyPerf.animationQuality === 'reduced', `expected reduced on busy frames, got ${busyPerf.animationQuality}`);

const stressedFrame = computeFrameHealth([52, 54, 60, 70, 48, 55], 1400);
const stressedPerf = perf('auto', excellent, stressedFrame);
assert(stressedPerf.animationQuality === 'off', `expected off on stressed frames, got ${stressedPerf.animationQuality}`);

const reducedMode = perf('reduced');
assert(reducedMode.animationQuality === 'reduced', 'reduced mode should cap animation quality');

const minimalMode = perf('minimal');
assert(minimalMode.animationQuality === 'off', 'minimal mode should turn animations off');

const saveData = computeAdaptivePerformance(excellent, smooth, { mode: 'auto', saveData: true }, 1500);
assert(saveData.animationQuality === 'reduced', 'save-data should start reduced in auto mode');

const fullCapped = perf('full', offline);
assert(fullCapped.animationQuality === 'reduced', 'full mode should still cap under critical/offline stability pressure');

console.log('PASS adaptive performance policy downgrades animations for connection, frame, and user settings');
