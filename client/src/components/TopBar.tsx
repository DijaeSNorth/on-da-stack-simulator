import { useGameStore } from '../store/gameStore';

const PHASE_LABELS: Record<string, string> = {
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

export function TopBar() {
  const store = useGameStore();
  const { game, ui } = store;

  const activePlayer = game.players.find(p => p.id === game.activePlayerId);
  const priorityPlayer = game.players.find(p => p.id === game.priorityPlayerId);
  const pendingTriggers = game.triggerQueue.filter(t => !t.acknowledged).length;

  return (
    <div
      data-testid="top-bar"
      style={{
        height: 44,
        background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 16,
        flexShrink: 0,
        zIndex: 100,
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-label="Commander Table">
          <polygon points="16,2 30,28 2,28" stroke="#7c3aed" strokeWidth="2" fill="#1e1b4b" />
          <circle cx="16" cy="18" r="5" fill="#7c3aed" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.05em' }}>
          COMMANDER TABLE
        </span>
      </div>

      <div style={{ width: 1, height: 20, background: '#1e293b' }} />

      {/* Turn & Phase */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: '#475569', fontWeight: 600 }}>
          T{game.turn}
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#e2e8f0',
          background: '#1e293b',
          borderRadius: 4,
          padding: '2px 8px',
        }}>
          {PHASE_LABELS[game.phase] || game.phase}
        </div>
      </div>

      {/* Active player */}
      {activePlayer && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: activePlayer.color,
            boxShadow: `0 0 6px ${activePlayer.color}`,
          }} />
          <span style={{ fontSize: 10, color: '#94a3b8' }}>
            {activePlayer.name}
          </span>
          <span style={{ fontSize: 9, color: '#475569', fontWeight: 600, textTransform: 'uppercase' }}>
            active
          </span>
        </div>
      )}

      {/* Priority */}
      {priorityPlayer && priorityPlayer.id !== game.activePlayerId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#60a5fa',
          }} />
          <span style={{ fontSize: 10, color: '#60a5fa' }}>
            {priorityPlayer.name} has priority
          </span>
        </div>
      )}

      {/* Stack badge */}
      {game.stack.length > 0 && (
        <button
          onClick={() => store.setRightPanelTab('stack')}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: '#1e3a5f', border: '1px solid #3b82f6',
            borderRadius: 4, padding: '2px 8px', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 9, color: '#60a5fa', fontWeight: 700 }}>
            STACK
          </span>
          <span style={{
            background: '#3b82f6', color: '#fff',
            borderRadius: '50%', width: 14, height: 14,
            fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700,
          }}>
            {game.stack.length}
          </span>
        </button>
      )}

      {/* Trigger badge */}
      {pendingTriggers > 0 && (
        <button
          onClick={() => store.setRightPanelTab('triggers')}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: '#78350f', border: '1px solid #f59e0b',
            borderRadius: 4, padding: '2px 8px', cursor: 'pointer', flexShrink: 0,
            animation: 'pulse 1.5s infinite',
          }}
        >
          <span style={{ fontSize: 9, color: '#fcd34d', fontWeight: 700 }}>
            TRIGGERS {pendingTriggers}
          </span>
        </button>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Phase navigation */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
        <button
          data-testid="btn-pass-priority"
          onClick={store.passPriority}
          style={topBtnStyle('#1e293b', '#94a3b8')}
          title="Pass Priority"
        >Pass</button>
        <button
          data-testid="btn-advance-phase-top"
          onClick={store.advancePhase}
          style={topBtnStyle('#1e3a5f', '#93c5fd')}
          title="Next Phase"
        >→ Phase</button>
        <button
          data-testid="btn-advance-turn-top"
          onClick={store.advanceTurn}
          style={topBtnStyle('#2e1065', '#c4b5fd')}
          title="End Turn"
        >End Turn</button>
      </div>

      <div style={{ width: 1, height: 20, background: '#1e293b' }} />

      {/* View toggles */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          data-testid="btn-toggle-left-panel"
          onClick={store.toggleLeftPanel}
          title={ui.leftPanelOpen ? 'Hide players' : 'Show players'}
          style={topBtnStyle(ui.leftPanelOpen ? '#1d4ed822' : 'none', '#64748b')}
        >☰</button>
        <button
          data-testid="btn-toggle-view"
          onClick={store.toggleBattlefieldView}
          title={ui.battlefieldView === 'normal' ? 'Overview' : 'Normal view'}
          style={topBtnStyle(ui.battlefieldView !== 'normal' ? '#1d4ed822' : 'none', '#64748b')}
        >⊞</button>
        <button
          data-testid="btn-toggle-right-panel"
          onClick={store.toggleRightPanel}
          title={ui.rightPanelOpen ? 'Hide assistant' : 'Show assistant'}
          style={topBtnStyle(ui.rightPanelOpen ? '#1d4ed822' : 'none', '#64748b')}
        >⚖</button>
        <button
          data-testid="btn-judge-mode"
          onClick={() => store.setJudgeMode(!ui.judgeMode)}
          title={ui.judgeMode ? 'Exit Judge Mode' : 'Enter Judge Mode'}
          style={topBtnStyle(ui.judgeMode ? '#78350f' : 'none', ui.judgeMode ? '#fcd34d' : '#64748b')}
        >⚜</button>
        <button
          data-testid="btn-open-lobby"
          onClick={() => store.setLobbyOpen(true)}
          style={topBtnStyle('none', '#64748b')}
          title="Lobby / New Game"
        >New</button>
      </div>
    </div>
  );
}

function topBtnStyle(bg: string, color: string): React.CSSProperties {
  return {
    background: bg,
    color,
    border: '1px solid #1e293b',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 10,
    cursor: 'pointer',
    fontWeight: 600,
    lineHeight: 1.4,
  };
}
