import { useGameStore } from '../../store/gameStore';
import type { Phase, Player } from '../../types/game';

const PHASE_LABELS: Record<Phase, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main 1',
  beginningOfCombat: 'Begin Combat',
  declareAttackers: 'Attackers',
  declareBlockers: 'Blockers',
  combatDamage: 'Damage',
  endOfCombat: 'End Combat',
  main2: 'Main 2',
  endStep: 'End Step',
  cleanup: 'Cleanup',
};

function getCommanderDanger(player: Player) {
  const highest = Object.values(player.commanderDamage).reduce((max, value) => Math.max(max, value), 0);
  if (highest >= 21) return { label: 'Lethal commander damage', color: '#f87171' };
  if (highest >= 16) return { label: `${highest} commander damage`, color: '#f59e0b' };
  return null;
}

export function TableStatusDock() {
  const store = useGameStore();
  const { game, ui } = store;
  const activePlayer = game.players.find(p => p.id === game.activePlayerId);
  const priorityPlayer = game.players.find(p => p.id === game.priorityPlayerId);
  const pendingTriggers = game.triggerQueue.filter(t => !t.acknowledged).length;
  const stackCount = game.stack.length;

  return (
    <div
      data-testid="table-status-dock"
      style={{
        width: 'min(100%, 620px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        border: '1px solid rgba(148,163,184,0.14)',
        borderRadius: 8,
        background: 'linear-gradient(180deg, rgba(15,23,42,0.78), rgba(2,6,23,0.54))',
        boxShadow: '0 18px 46px rgba(0,0,0,0.28)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 120 }}>
          <div style={labelStyle}>Turn</div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>
            {game.turn}
          </div>
        </div>
        <StatusMetric label="Phase" value={PHASE_LABELS[game.phase]} color="#93c5fd" />
        <StatusMetric label="Active" value={activePlayer?.name ?? '-'} color={activePlayer?.color ?? '#94a3b8'} />
        <StatusMetric label="Priority" value={priorityPlayer?.name ?? '-'} color={priorityPlayer?.color ?? '#94a3b8'} />
        <button
          data-testid="dock-stack-button"
          onClick={() => store.setRightPanelTab('stack')}
          style={dockButtonStyle(stackCount > 0 ? '#1e3a5f' : '#0f172a', stackCount > 0 ? '#93c5fd' : '#64748b')}
        >
          Stack {stackCount}
        </button>
        <button
          data-testid="dock-trigger-button"
          onClick={() => store.setRightPanelTab('triggers')}
          style={dockButtonStyle(pendingTriggers > 0 ? '#78350f' : '#0f172a', pendingTriggers > 0 ? '#fcd34d' : '#64748b')}
        >
          Triggers {pendingTriggers}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))', gap: 6 }}>
        {game.players.map(player => {
          const commanderDanger = getCommanderDanger(player);
          const focused = ui.focusedPlayerId === player.id;
          return (
            <button
              key={player.id}
              data-testid={`dock-player-${player.id}`}
              onClick={() => store.setFocusedPlayer(focused ? null : player.id)}
              style={{
                display: 'grid',
                gap: 5,
                minHeight: 68,
                padding: '8px 9px',
                textAlign: 'left',
                border: `1px solid ${focused ? player.color : `${player.color}55`}`,
                borderLeft: `4px solid ${player.color}`,
                borderRadius: 7,
                background: focused ? `${player.color}22` : 'rgba(15,23,42,0.58)',
                color: '#e2e8f0',
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {player.name}
                </span>
                <span style={{ color: player.life <= 10 ? '#f87171' : '#86efac', fontSize: 18, fontWeight: 900 }}>
                  {player.life}
                </span>
              </span>
              <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', color: '#64748b', fontSize: 9, fontWeight: 700 }}>
                <span>Hand {player.hand.length}</span>
                <span>Lib {player.library.length}</span>
                <span>GY {player.graveyard.length}</span>
                {player.poisonCounters > 0 && <span style={{ color: '#86efac' }}>Poison {player.poisonCounters}</span>}
              </span>
              {commanderDanger && (
                <span style={{ color: commanderDanger.color, fontSize: 9, fontWeight: 800 }}>
                  {commanderDanger.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ minWidth: 86 }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ color, fontSize: 12, fontWeight: 800, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
    </div>
  );
}

function dockButtonStyle(background: string, color: string): React.CSSProperties {
  return {
    minHeight: 28,
    padding: '4px 10px',
    border: '1px solid rgba(148,163,184,0.18)',
    borderRadius: 6,
    background,
    color,
    fontSize: 10,
    fontWeight: 800,
    cursor: 'pointer',
  };
}

const labelStyle: React.CSSProperties = {
  marginBottom: 3,
  color: '#475569',
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
