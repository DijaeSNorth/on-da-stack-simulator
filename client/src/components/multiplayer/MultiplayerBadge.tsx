/**
 * MultiplayerBadge.tsx
 *
 * Persistent in-game indicator mounted in TopBar.
 * Shows: room code, online peer count, ping indicator.
 * Click → opens the Lobby to the Multiplayer tab.
 */

import { useGameStore } from '../../store/gameStore';

export function MultiplayerBadge() {
  const store = useGameStore();
  const { multiplayer } = store;

  const connected = multiplayer.status === 'host' || multiplayer.status === 'joined' || multiplayer.status === 'migrating';
  if (!connected) return null;

  const peers = Object.values(multiplayer.peers);
  const onlineCount = peers.filter(p => p.online).length;
  const isHost = multiplayer.status === 'host';
  const isMigrating = multiplayer.status === 'migrating';
  const isSpectator = multiplayer.isSpectator;

  const borderColor = isMigrating ? '#92400e' : isSpectator ? '#4c1d95' : isHost ? '#166534' : '#1e3a5f';
  const bgColor     = isMigrating ? '#2b1708' : isSpectator ? '#1a0a2e' : isHost ? '#0f2d1a' : '#0f1a2d';
  const textColor   = isMigrating ? '#fbbf24' : isSpectator ? '#a78bfa' : isHost ? '#4ade80' : '#60a5fa';

  return (
    <button
      data-testid="multiplayer-badge"
      onClick={() => store.setLobbyOpen(true)}
      title={`Room ${multiplayer.roomCode} — ${onlineCount} peer${onlineCount !== 1 ? 's' : ''} online${isSpectator ? ' (spectating)' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${borderColor}`,
        background: bgColor,
        color: textColor,
        fontSize: 11, fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {/* Pulse dot */}
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: textColor,
        display: 'inline-block',
        animation: 'mpPulse 2s ease-in-out infinite',
      }} />

      {/* Spectator eye or room code */}
      {isSpectator && <span style={{ fontSize: 10 }}>👁</span>}
      <span style={{ fontFamily: 'monospace', letterSpacing: 1 }}>
        {multiplayer.roomCode}
      </span>

      {/* Peer count */}
      <span style={{
        background: 'rgba(255,255,255,0.1)',
        borderRadius: 4, padding: '0 4px',
        fontSize: 9, fontWeight: 700,
      }}>
        {onlineCount}
      </span>

      <style>{`
        @keyframes mpPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </button>
  );
}
