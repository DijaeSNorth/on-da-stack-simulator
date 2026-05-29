import { useGameStore } from '../../store/gameStore';
import { PlayerBattlefield } from './PlayerBattlefield';
import type { Player } from '../../types/game';

// Commander table layouts: players arranged around a virtual table
// Local player (seatIndex 0) always at bottom
// Opponents arranged clockwise from top

function getPlayerLayout(playerCount: number): {
  top?: number[]; left?: number[]; right?: number[]; bottom: number[];
} {
  switch (playerCount) {
    case 2:
      return { top: [1], bottom: [0] };
    case 3:
      return { top: [1, 2], bottom: [0] };
    case 4:
      return { top: [2], left: [1], right: [3], bottom: [0] };
    case 5:
      return { top: [2, 3], left: [1], right: [4], bottom: [0] };
    case 6:
      return { top: [2, 3], left: [1], right: [4], bottom: [0, 5] };
    default:
      return { bottom: [0] };
  }
}

export function CommanderTable() {
  const game = useGameStore(s => s.game);
  const ui = useGameStore(s => s.ui);
  const players = game.players;

  if (players.length === 0) return null;

  const layout = getPlayerLayout(players.length);
  const isActive = (p: Player) => p.id === game.activePlayerId;

  const getPlayers = (indices?: number[]) =>
    (indices || []).map(i => players[i]).filter(Boolean);

  const sectionStyle = (side: 'top' | 'bottom' | 'left' | 'right'): React.CSSProperties => {
    const base: React.CSSProperties = {
      display: 'flex',
      gap: 2,
      flex: 1,
      overflow: 'hidden',
    };

    if (side === 'top' || side === 'bottom') {
      return { ...base, flexDirection: 'row' };
    }
    return { ...base, flexDirection: 'column', maxWidth: '18%', minWidth: 120 };
  };

  const wrapPlayerSlot = (player: Player, isLocal: boolean, compact: boolean) => (
    <div
      key={player.id}
      style={{
        flex: 1,
        background: isActive(player)
          ? `linear-gradient(180deg, ${player.color}15, transparent)`
          : 'rgba(255,255,255,0.02)',
        border: `1px solid ${player.color}33`,
        borderRadius: 8,
        overflow: 'hidden',
        position: 'relative',
        minWidth: 0,
        minHeight: compact ? 80 : 120,
        transition: 'border-color 0.3s',
      }}
    >
      <PlayerBattlefield
        player={player}
        isLocal={isLocal}
        isActive={isActive(player)}
        compact={compact}
      />
    </div>
  );

  const topPlayers = getPlayers(layout.top);
  const leftPlayers = getPlayers(layout.left);
  const rightPlayers = getPlayers(layout.right);
  const bottomPlayers = getPlayers(layout.bottom);

  return (
    <div
      data-testid="commander-table"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        gap: 2,
        boxSizing: 'border-box',
        padding: 4,
        background: '#0d1117',
        backgroundImage: `
          radial-gradient(circle at 50% 50%, rgba(59,130,246,0.03) 0%, transparent 60%),
          repeating-linear-gradient(
            0deg,
            transparent,
            transparent 39px,
            rgba(255,255,255,0.015) 39px,
            rgba(255,255,255,0.015) 40px
          ),
          repeating-linear-gradient(
            90deg,
            transparent,
            transparent 39px,
            rgba(255,255,255,0.015) 39px,
            rgba(255,255,255,0.015) 40px
          )
        `,
      }}
    >
      {/* Top opponents */}
      {topPlayers.length > 0 && (
        <div style={sectionStyle('top')}>
          {topPlayers.map(p => wrapPlayerSlot(p, false, players.length >= 5))}
        </div>
      )}

      {/* Middle row: left + center + right */}
      {(leftPlayers.length > 0 || rightPlayers.length > 0) && (
        <div style={{ display: 'flex', flex: 1, gap: 2, overflow: 'hidden', minHeight: 0 }}>
          {leftPlayers.length > 0 && (
            <div style={sectionStyle('left')}>
              {leftPlayers.map(p => wrapPlayerSlot(p, false, true))}
            </div>
          )}

          {/* Center spacer (shows table surface) */}
          <div style={{
            flex: 1,
            background: 'rgba(255,255,255,0.01)',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              color: '#1e293b',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              userSelect: 'none',
            }}>
              Commander
            </div>
          </div>

          {rightPlayers.length > 0 && (
            <div style={sectionStyle('right')}>
              {rightPlayers.map(p => wrapPlayerSlot(p, false, true))}
            </div>
          )}
        </div>
      )}

      {/* Separator */}
      <div style={{
        height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
        margin: '0 20px',
        flexShrink: 0,
      }} />

      {/* Bottom — local player(s) */}
      <div style={{ ...sectionStyle('bottom'), maxHeight: '42%', flexShrink: 0 }}>
        {bottomPlayers.map(p => wrapPlayerSlot(p, true, false))}
      </div>
    </div>
  );
}
