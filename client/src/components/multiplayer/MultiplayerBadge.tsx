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

  const connected = multiplayer.status === 'host' || multiplayer.status === 'joined';
  if (!connected) return null;

  const peers = Object.values(multiplayer.peers);
  const onlineCount = peers.filter(p => p.online).length;
  const isHost = multiplayer.status === 'host';

  return (
    <button
      data-testid="multiplayer-badge"
      onClick={() => store.setLobbyOpen(true)}
      title={`Room ${multiplayer.roomCode} — ${onlineCount} player${onlineCount !== 1 ? 's' : ''} online`}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${isHost ? '#166534' : '#1e3a5f'}`,
        background: isHost ? '#0f2d1a' : '#0f1a2d',
        color: isHost ? '#4ade80' : '#60a5fa',
        fontSize: 11, fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {/* Pulse dot */}
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: isHost ? '#4ade80' : '#60a5fa',
        display: 'inline-block',
        animation: 'mpPulse 2s ease-in-out infinite',
      }} />

      {/* Room code */}
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
