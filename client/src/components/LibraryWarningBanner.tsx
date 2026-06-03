// ─── LibraryWarningBanner ──────────────────────────────────────────────────────
// In-game floating banner shown when any player has ≤3 cards in library.
// Dismissible per player, reappears when another draw would be fatal.

import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { checkLibraries } from '../engine/safetyChecks';

export function LibraryWarningBanner() {
  const store = useGameStore();
  const { game } = store;

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (game.status !== 'playing') return null;

  const players = game.players.map(p => ({
    id: p.id,
    name: p.name,
    library: p.library,
  }));

  const warnings = checkLibraries(players).filter(w => !dismissed.has(w.playerId));

  if (warnings.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 80,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 9000,
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      pointerEvents: 'none',
    }}>
      {warnings.map(w => (
        <div
          key={w.playerId}
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            background: w.empty ? '#2d0a0a' : '#1c1500',
            border: `1px solid ${w.empty ? '#7f1d1d' : '#78350f'}`,
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.7)',
            minWidth: 280,
            maxWidth: 420,
          }}
        >
          <span style={{ fontSize: 16, flexShrink: 0 }}>{w.empty ? '💀' : '⚠️'}</span>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: w.empty ? '#f87171' : '#fcd34d',
            }}>
              {w.empty
                ? `${w.playerName} — Library is empty`
                : `${w.playerName} — ${w.libraryCount} card${w.libraryCount !== 1 ? 's' : ''} left`}
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
              {w.empty
                ? 'Drawing from an empty library → loses the game (rule 704.5b)'
                : 'Drawing will empty the library next turn'}
            </div>
          </div>
          <button
            onClick={() => setDismissed(prev => new Set([...prev, w.playerId]))}
            style={{
              background: 'none', border: 'none',
              color: '#475569', cursor: 'pointer',
              fontSize: 16, lineHeight: 1, padding: '0 2px',
              flexShrink: 0,
            }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
