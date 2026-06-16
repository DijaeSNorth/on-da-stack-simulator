import { BACKPRESSURE_LIMITS } from './backpressureQueue';

export type ConnectionQuality = 'excellent' | 'good' | 'degraded' | 'critical' | 'offline';

export interface ConnectionHealth {
  quality: ConnectionQuality;
  rttMs: number | null;
  missedPongs: number;
  lastPingAt: number | null;
  lastPongAt: number | null;
  dataChannelOpen: boolean;
  bufferedAmount: number;
  chunkTimeouts: number;
  sendFailures: number;
  resendCount: number;
  firebaseRecoveryAvailable: boolean;
  updatedAt: number;
  reasons: string[];
}

export interface ConnectionHealthSeed {
  now?: number;
  dataChannelOpen?: boolean;
  firebaseRecoveryAvailable?: boolean;
}

export function createInitialConnectionHealth(seed: ConnectionHealthSeed = {}): ConnectionHealth {
  const now = seed.now ?? Date.now();
  return computeConnectionHealth({
    quality: 'offline',
    rttMs: null,
    missedPongs: 0,
    lastPingAt: null,
    lastPongAt: null,
    dataChannelOpen: seed.dataChannelOpen ?? false,
    bufferedAmount: 0,
    chunkTimeouts: 0,
    sendFailures: 0,
    resendCount: 0,
    firebaseRecoveryAvailable: seed.firebaseRecoveryAvailable ?? false,
    updatedAt: now,
    reasons: [],
  });
}

export function computeConnectionHealth(health: ConnectionHealth): ConnectionHealth {
  const reasons: string[] = [];
  let quality: ConnectionQuality = 'excellent';

  if (!health.dataChannelOpen) {
    quality = 'offline';
    reasons.push('data channel closed');
  } else if (
    health.bufferedAmount >= BACKPRESSURE_LIMITS.criticalBufferedAmount ||
    health.missedPongs >= 3 ||
    health.sendFailures >= 3 ||
    health.chunkTimeouts >= 2
  ) {
    quality = 'critical';
    if (health.bufferedAmount >= BACKPRESSURE_LIMITS.criticalBufferedAmount) reasons.push('critical send buffer');
    if (health.missedPongs >= 3) reasons.push('missed heartbeats');
    if (health.sendFailures >= 3) reasons.push('send failures');
    if (health.chunkTimeouts >= 2) reasons.push('repeated chunk timeouts');
  } else if (
    health.bufferedAmount >= BACKPRESSURE_LIMITS.highBufferedAmount ||
    health.missedPongs > 0 ||
    health.sendFailures > 0 ||
    health.chunkTimeouts > 0 ||
    (health.rttMs ?? 0) >= 500
  ) {
    quality = 'degraded';
    if (health.bufferedAmount >= BACKPRESSURE_LIMITS.highBufferedAmount) reasons.push('high send buffer');
    if (health.missedPongs > 0) reasons.push('missed heartbeat');
    if (health.sendFailures > 0) reasons.push('send failure');
    if (health.chunkTimeouts > 0) reasons.push('chunk timeout');
    if ((health.rttMs ?? 0) >= 500) reasons.push('high latency');
  } else if (
    health.bufferedAmount >= BACKPRESSURE_LIMITS.warningBytes ||
    (health.rttMs ?? 0) >= 150
  ) {
    quality = 'good';
    if (health.bufferedAmount >= BACKPRESSURE_LIMITS.warningBytes) reasons.push('send buffer rising');
    if ((health.rttMs ?? 0) >= 150) reasons.push('moderate latency');
  }

  return {
    ...health,
    quality,
    reasons,
  };
}

export function markConnectionPing(health: ConnectionHealth, now = Date.now()): ConnectionHealth {
  return computeConnectionHealth({
    ...health,
    lastPingAt: now,
    updatedAt: now,
  });
}

export function updateConnectionFromPong(
  health: ConnectionHealth,
  rttMs: number,
  now = Date.now(),
): ConnectionHealth {
  const nextRtt = Number.isFinite(rttMs) ? Math.max(0, Math.round(rttMs)) : health.rttMs;
  return computeConnectionHealth({
    ...health,
    rttMs: nextRtt,
    missedPongs: 0,
    lastPongAt: now,
    dataChannelOpen: true,
    updatedAt: now,
  });
}

export function markConnectionMissedPong(health: ConnectionHealth, now = Date.now()): ConnectionHealth {
  return computeConnectionHealth({
    ...health,
    missedPongs: health.missedPongs + 1,
    updatedAt: now,
  });
}

export function updateConnectionBuffer(
  health: ConnectionHealth,
  bufferedAmount: number,
  dataChannelOpen = health.dataChannelOpen,
  now = Date.now(),
): ConnectionHealth {
  return computeConnectionHealth({
    ...health,
    bufferedAmount: Number.isFinite(bufferedAmount) ? Math.max(0, Math.round(bufferedAmount)) : health.bufferedAmount,
    dataChannelOpen,
    updatedAt: now,
  });
}

export function markConnectionSendFailure(health: ConnectionHealth, now = Date.now()): ConnectionHealth {
  return computeConnectionHealth({
    ...health,
    sendFailures: health.sendFailures + 1,
    updatedAt: now,
  });
}

export function markConnectionChunkTimeout(
  health: ConnectionHealth,
  options: { resendRequested?: boolean; now?: number } = {},
): ConnectionHealth {
  const now = options.now ?? Date.now();
  return computeConnectionHealth({
    ...health,
    chunkTimeouts: health.chunkTimeouts + 1,
    resendCount: health.resendCount + (options.resendRequested ? 1 : 0),
    updatedAt: now,
  });
}

export function updateConnectionChannel(
  health: ConnectionHealth,
  dataChannelOpen: boolean,
  now = Date.now(),
): ConnectionHealth {
  return computeConnectionHealth({
    ...health,
    dataChannelOpen,
    updatedAt: now,
  });
}

export function updateFirebaseRecoveryAvailability(
  health: ConnectionHealth,
  firebaseRecoveryAvailable: boolean,
  now = Date.now(),
): ConnectionHealth {
  return computeConnectionHealth({
    ...health,
    firebaseRecoveryAvailable,
    updatedAt: now,
  });
}

export function selectWorstConnectionHealth(healths: ConnectionHealth[], fallback = createInitialConnectionHealth()): ConnectionHealth {
  if (healths.length === 0) return fallback;
  return [...healths].sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality) || b.bufferedAmount - a.bufferedAmount)[0];
}

function qualityRank(quality: ConnectionQuality): number {
  switch (quality) {
    case 'offline': return 5;
    case 'critical': return 4;
    case 'degraded': return 3;
    case 'good': return 2;
    case 'excellent': return 1;
  }
}
