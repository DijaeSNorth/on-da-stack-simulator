export const BACKPRESSURE_LIMITS = {
  warningBytes: 64_000,
  chunkBytes: 12_000,
  maxChunksPerBurst: 8,
  highBufferedAmount: 512_000,
  criticalBufferedAmount: 2_000_000,
  bufferedAmountLowThreshold: 128_000,
} as const;

export type BackpressureLevel = 'open' | 'warning' | 'high' | 'critical';

export interface ChunkBurstPlan {
  level: BackpressureLevel;
  startIndex: number;
  endIndexExclusive: number;
  shouldPause: boolean;
  shouldDropNonessential: boolean;
}

export function getBackpressureLevel(bufferedAmount: number): BackpressureLevel {
  const amount = Number.isFinite(bufferedAmount) ? Math.max(0, bufferedAmount) : 0;
  if (amount >= BACKPRESSURE_LIMITS.criticalBufferedAmount) return 'critical';
  if (amount >= BACKPRESSURE_LIMITS.highBufferedAmount) return 'high';
  if (amount >= BACKPRESSURE_LIMITS.warningBytes) return 'warning';
  return 'open';
}

export function shouldDropNonessentialSend(bufferedAmount: number): boolean {
  return getBackpressureLevel(bufferedAmount) === 'critical';
}

export function shouldPauseChunkSend(bufferedAmount: number): boolean {
  const level = getBackpressureLevel(bufferedAmount);
  return level === 'high' || level === 'critical';
}

export function createStringChunks(value: string, chunkBytes = BACKPRESSURE_LIMITS.chunkBytes): string[] {
  if (!value) return [''];
  const size = Math.max(1, Math.round(chunkBytes));
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}

export function planChunkBurst(
  totalChunks: number,
  startIndex: number,
  bufferedAmount: number,
  maxChunksPerBurst = BACKPRESSURE_LIMITS.maxChunksPerBurst,
): ChunkBurstPlan {
  const total = Math.max(0, Math.round(totalChunks));
  const start = Math.max(0, Math.min(total, Math.round(startIndex)));
  const level = getBackpressureLevel(bufferedAmount);
  const shouldPause = level === 'high' || level === 'critical';
  const burstCount = shouldPause ? 0 : Math.max(1, Math.round(maxChunksPerBurst));
  const end = Math.min(total, start + burstCount);
  return {
    level,
    startIndex: start,
    endIndexExclusive: end,
    shouldPause,
    shouldDropNonessential: level === 'critical',
  };
}
