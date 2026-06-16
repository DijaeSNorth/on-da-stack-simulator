import type { AdaptivePerformanceState, FrameHealth } from '../../engine/adaptivePerformance';
import type { ConnectionHealth } from '../../engine/networkHealth';

interface ConnectionHealthPanelProps {
  health: ConnectionHealth;
  frameHealth: FrameHealth;
  adaptivePerformance: AdaptivePerformanceState;
}

export function connectionHealthStatusLabel(health: ConnectionHealth): string {
  if (health.quality === 'offline' || health.quality === 'critical') {
    return health.firebaseRecoveryAvailable ? 'Recovery Available' : 'Reconnecting';
  }
  if (health.quality === 'degraded') return 'Degraded';
  return 'Good';
}

export function ConnectionHealthPanel({
  health,
  frameHealth,
  adaptivePerformance,
}: ConnectionHealthPanelProps) {
  const statusLabel = connectionHealthStatusLabel(health);
  const color = statusLabel === 'Good'
    ? '#86efac'
    : statusLabel === 'Degraded'
      ? '#fbbf24'
      : '#93c5fd';
  return (
    <details
      data-testid="connection-health-panel"
      style={{
        border: '1px solid #26323a',
        borderRadius: 8,
        background: '#0b1218',
        padding: 10,
      }}
    >
      <summary style={{ cursor: 'pointer', color: '#94a3b8', fontSize: 11, fontWeight: 800 }}>
        Connection health: <span style={{ color }}>{statusLabel}</span>
      </summary>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 8 }}>
        <Metric label="Quality" value={health.quality} />
        <Metric label="RTT" value={health.rttMs === null ? 'n/a' : `${health.rttMs}ms`} />
        <Metric label="Missed pongs" value={String(health.missedPongs)} />
        <Metric label="Buffered" value={`${Math.round(health.bufferedAmount / 1024)}KB`} />
        <Metric label="Chunk timeouts" value={String(health.chunkTimeouts)} />
        <Metric label="Send failures" value={String(health.sendFailures)} />
        <Metric label="Firebase recovery" value={health.firebaseRecoveryAvailable ? 'available' : 'off'} />
        <Metric label="Frame health" value={`${frameHealth.quality} (${frameHealth.averageFrameMs}ms)`} />
        <Metric label="Animation quality" value={adaptivePerformance.animationQuality} />
      </div>
      <div style={{ marginTop: 8, color: '#64748b', fontSize: 10, lineHeight: 1.45 }}>
        Downgrade reason: {adaptivePerformance.reason || health.reasons.join(', ') || 'normal'}
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ color: '#475569', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ color: '#cbd5e1', fontSize: 11, fontWeight: 700, overflowWrap: 'anywhere' }}>
        {value}
      </div>
    </div>
  );
}
