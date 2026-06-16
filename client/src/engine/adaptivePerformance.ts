import type { ConnectionHealth } from './networkHealth';

export type AnimationQuality = 'full' | 'reduced' | 'off';
export type AdaptivePerformanceMode = 'auto' | 'full' | 'reduced' | 'minimal';
export type FrameHealthQuality = 'smooth' | 'busy' | 'stressed';

export interface FrameHealth {
  averageFrameMs: number;
  longFrameCount: number;
  quality: FrameHealthQuality;
  updatedAt: number;
}

export interface AdaptivePerformanceState {
  mode: AdaptivePerformanceMode;
  animationQuality: AnimationQuality;
  disableLiveAnimations: boolean;
  disableReplayDramaticEffects: boolean;
  compactMode: boolean;
  reason: string;
  updatedAt: number;
}

export interface AdaptiveUserSettings {
  mode?: AdaptivePerformanceMode;
  saveData?: boolean;
  slowConnection?: boolean;
  prefersReducedMotion?: boolean;
  hidden?: boolean;
}

interface FrameMonitorOptions {
  sampleSize?: number;
  updateEveryMs?: number;
  now?: () => number;
}

export function createInitialFrameHealth(now = Date.now()): FrameHealth {
  return {
    averageFrameMs: 16.7,
    longFrameCount: 0,
    quality: 'smooth',
    updatedAt: now,
  };
}

export function createInitialAdaptivePerformance(
  mode: AdaptivePerformanceMode = 'auto',
  now = Date.now(),
): AdaptivePerformanceState {
  return {
    mode,
    animationQuality: 'full',
    disableLiveAnimations: false,
    disableReplayDramaticEffects: false,
    compactMode: false,
    reason: 'normal',
    updatedAt: now,
  };
}

export function classifyFrameHealth(averageFrameMs: number, longFrameCount: number): FrameHealthQuality {
  if (averageFrameMs >= 34 || longFrameCount >= 5) return 'stressed';
  if (averageFrameMs >= 24 || longFrameCount >= 2) return 'busy';
  return 'smooth';
}

export function computeFrameHealth(samples: number[], now = Date.now()): FrameHealth {
  const valid = samples.filter(sample => Number.isFinite(sample) && sample > 0);
  const averageFrameMs = valid.length
    ? valid.reduce((sum, sample) => sum + sample, 0) / valid.length
    : 16.7;
  const longFrameCount = valid.filter(sample => sample >= 50).length;
  return {
    averageFrameMs: Math.round(averageFrameMs * 10) / 10,
    longFrameCount,
    quality: classifyFrameHealth(averageFrameMs, longFrameCount),
    updatedAt: now,
  };
}

export function computeAdaptivePerformance(
  connectionHealth: ConnectionHealth | null | undefined,
  frameHealth: FrameHealth | null | undefined,
  userSettings: AdaptiveUserSettings = {},
  now = Date.now(),
): AdaptivePerformanceState {
  const mode = userSettings.mode ?? 'auto';
  const reasons: string[] = [];
  const connectionQuality = connectionHealth?.quality ?? 'offline';
  const frameQuality = frameHealth?.quality ?? 'smooth';
  let animationQuality: AnimationQuality = 'full';

  if (mode === 'minimal') {
    animationQuality = 'off';
    reasons.push('minimal mode');
  } else if (mode === 'reduced') {
    animationQuality = 'reduced';
    reasons.push('reduced mode');
  } else if (mode === 'full') {
    animationQuality = connectionQuality === 'critical' || connectionQuality === 'offline' || frameQuality === 'stressed'
      ? 'reduced'
      : 'full';
    if (animationQuality === 'reduced') reasons.push('full mode capped by stability');
  } else {
    if (connectionQuality === 'critical' || connectionQuality === 'offline') {
      animationQuality = 'off';
      reasons.push(connectionQuality === 'offline' ? 'offline' : 'critical connection');
    } else if (frameQuality === 'stressed') {
      animationQuality = 'off';
      reasons.push('stressed frame rate');
    } else if (
      connectionQuality === 'degraded' ||
      frameQuality === 'busy' ||
      userSettings.saveData ||
      userSettings.slowConnection ||
      userSettings.prefersReducedMotion
    ) {
      animationQuality = 'reduced';
      if (connectionQuality === 'degraded') reasons.push('degraded connection');
      if (frameQuality === 'busy') reasons.push('busy frame rate');
      if (userSettings.saveData) reasons.push('save-data');
      if (userSettings.slowConnection) reasons.push('slow connection');
      if (userSettings.prefersReducedMotion) reasons.push('reduced motion');
    }
  }

  if (userSettings.hidden && animationQuality !== 'off') {
    animationQuality = 'reduced';
    reasons.push('background tab');
  }

  return {
    mode,
    animationQuality,
    disableLiveAnimations: animationQuality === 'off' || connectionQuality === 'critical' || connectionQuality === 'offline' || frameQuality === 'stressed',
    disableReplayDramaticEffects: animationQuality !== 'full' || Boolean(userSettings.hidden),
    compactMode: animationQuality !== 'full' || frameQuality !== 'smooth',
    reason: reasons.length ? reasons.join(', ') : 'normal',
    updatedAt: now,
  };
}

export function detectAdaptiveUserSettings(mode: AdaptivePerformanceMode): AdaptiveUserSettings {
  const connection = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
    : undefined;
  const effectiveType = connection?.effectiveType ?? '';
  return {
    mode,
    saveData: Boolean(connection?.saveData),
    slowConnection: effectiveType === 'slow-2g' || effectiveType === '2g',
    prefersReducedMotion: typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
  };
}

export function scheduleIdleWork(fn: () => void, timeout = 1000): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback?.(id);
  }
  const timer = globalThis.setTimeout(fn, Math.max(0, timeout));
  return () => globalThis.clearTimeout(timer);
}

export function startFrameHealthMonitor(
  onUpdate: (health: FrameHealth) => void,
  options: FrameMonitorOptions = {},
): () => void {
  if (
    typeof window === 'undefined' ||
    typeof window.requestAnimationFrame !== 'function' ||
    typeof window.cancelAnimationFrame !== 'function'
  ) {
    return () => {};
  }

  const sampleSize = Math.max(10, options.sampleSize ?? 45);
  const updateEveryMs = Math.max(250, options.updateEveryMs ?? 1000);
  const now = options.now ?? (() => performance.now());
  const samples: number[] = [];
  let frame = 0;
  let lastFrameAt = now();
  let lastUpdateAt = lastFrameAt;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      lastFrameAt = now();
      frame = window.requestAnimationFrame(tick);
      return;
    }

    const current = now();
    const frameMs = current - lastFrameAt;
    lastFrameAt = current;
    if (frameMs > 0 && frameMs < 1000) {
      samples.push(frameMs);
      if (samples.length > sampleSize) samples.shift();
    }

    if (current - lastUpdateAt >= updateEveryMs && samples.length > 0) {
      lastUpdateAt = current;
      onUpdate(computeFrameHealth(samples));
    }

    frame = window.requestAnimationFrame(tick);
  };

  frame = window.requestAnimationFrame(tick);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
  };
}
