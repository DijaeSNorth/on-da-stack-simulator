import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useGameStore } from '../store/gameStore';
import { MultiplayerBadge } from './multiplayer/MultiplayerBadge';
import { useTutorial } from '../store/tutorialStore';
import { TutorialTooltip } from './tutorial/TutorialTooltip';
import { TOOLTIPS } from '../store/tutorialStore';
import { PulseBeacon } from './tutorial/PulseBeacon';
import { getPhaseLabel } from '../engine/phaseMeta';
import { BrandMark } from './branding/BrandMark';
import { PlayerAvatar } from './profile/PlayerAvatar';
import { ExitGameModal } from './exit/ExitGameModal';
import { ReportButton } from './report/ReportButton';
import { TOP_LEVEL_NAV_ITEMS } from './navigation/navigationFlowModel';

export function TopBar() {
  const store = useGameStore();
  const { game, ui } = store;
  const tutorial = useTutorial();
  const [exitOpen, setExitOpen] = useState(false);

  // Global keyboard shortcut: / or Ctrl+F → open card search panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in input/textarea
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === '/' || (e.ctrlKey && e.key === 'f')) {
        e.preventDefault();
        store.setCardSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store]);

  const activePlayer = game.players.find(p => p.id === game.activePlayerId);
  const priorityPlayer = game.players.find(p => p.id === game.priorityPlayerId);
  const pendingTriggers = game.triggerQueue.filter(t => !t.acknowledged).length;
  const handleTopNav = (mode: (typeof TOP_LEVEL_NAV_ITEMS)[number]['id']) => {
    if (mode === 'replayViewer') {
      store.setReplayOpen(true);
      return;
    }
    if (mode === 'settings') {
      store.setUiSettingsOpen(true);
      return;
    }
    store.setLobbyOpen(true);
  };

  return (
    <>
    <div
      data-testid="top-bar"
      style={{
        height: 44,
        background: '#0b0f12',
        borderBottom: '1px solid #26323a',
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
        <BrandMark size={22} compact />
        <span style={{ fontSize: 11, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.04em' }}>
          ON-DA-STACK
        </span>
      </div>

      <div style={{ width: 1, height: 20, background: '#26323a' }} />

      <nav aria-label="Top-level navigation" style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {TOP_LEVEL_NAV_ITEMS.map(item => (
          <button
            key={item.id}
            type="button"
            data-testid={`top-nav-${item.id}`}
            onClick={() => handleTopNav(item.id)}
            style={topBtnStyle('none', '#94a3b8')}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div style={{ width: 1, height: 20, background: '#26323a' }} />

      {/* Turn & Phase */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: '#475569', fontWeight: 600 }}>
          T{game.turn}
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700, color: '#e2e8f0',
          background: '#182127',
          border: '1px solid #26323a',
          borderRadius: 4,
          padding: '2px 8px',
        }}>
          {getPhaseLabel(game.phase)}
        </div>
      </div>

      {/* Active player */}
      {activePlayer && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <PlayerAvatar
            name={activePlayer.name}
            color={activePlayer.color}
            initial={activePlayer.avatarInitial ?? activePlayer.name.slice(0, 1)}
            styleMode={activePlayer.avatarStyle}
            image={activePlayer.avatarImage}
            size={18}
          />
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
            background: '#123642', border: '1px solid #22d3ee',
            borderRadius: 4, padding: '2px 8px', cursor: 'pointer', flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 9, color: '#67e8f9', fontWeight: 700 }}>
            STACK
          </span>
          <span style={{
            background: '#0e7490', color: '#fff',
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
          onClick={() => store.setRightPanelTab('stack')}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: '#78350f', border: '1px solid #f59e0b',
            borderRadius: 4, padding: '2px 8px', cursor: 'pointer', flexShrink: 0,
            animation: 'pulse 1.5s infinite',
          }}
        >
          <span style={{ fontSize: 9, color: '#fcd34d', fontWeight: 700 }}>
            STACK / TRIGGERS {pendingTriggers}
          </span>
        </button>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* View toggles */}
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          data-testid="btn-toggle-left-panel"
          data-help-title="Players Panel"
          data-help-body="Shows life totals, commander icons, quick draw and shuffle actions, graveyards, exile, and turn controls. Hide it when you need more table space."
          data-help-placement="bottom"
          aria-label={ui.leftPanelOpen ? 'Hide players panel' : 'Show players panel'}
          onClick={store.toggleLeftPanel}
          title={ui.leftPanelOpen ? 'Hide players' : 'Show players'}
          style={topBtnStyle(ui.leftPanelOpen ? '#1d4ed822' : 'none', '#64748b')}
        >☰</button>
        <button
          data-testid="btn-toggle-view"
          data-help-title="Battlefield View"
          data-help-body="Switch between normal battlefield view and an overview layout for checking permanents, combat arrows, and table state faster."
          data-help-placement="bottom"
          aria-label={ui.battlefieldView === 'normal' ? 'Switch to battlefield overview' : 'Switch to normal battlefield view'}
          onClick={store.toggleBattlefieldView}
          title={ui.battlefieldView === 'normal' ? 'Overview' : 'Normal view'}
          style={topBtnStyle(ui.battlefieldView !== 'normal' ? '#1d4ed822' : 'none', '#64748b')}
        >⊞</button>
        <button
          data-testid="btn-toggle-right-panel"
          data-help-title="Stack And Judge Panel"
          data-help-body="Opens the right panel. Stack shows spells, abilities, triggers, and the brief turn timeline; Judge / Log reviews actions and possible mistakes."
          data-help-placement="bottom"
          aria-label={ui.rightPanelOpen ? 'Hide assistant panel' : 'Show assistant panel'}
          onClick={store.toggleRightPanel}
          title={ui.rightPanelOpen ? 'Hide assistant' : 'Show assistant'}
          style={topBtnStyle(ui.rightPanelOpen ? '#1d4ed822' : 'none', '#64748b')}
        >⚖</button>
        <button
          data-testid="btn-judge-mode"
          data-help-title="Judge Assistant"
          data-help-body="Toggles advisory judge mode. It flags missed triggers and questionable actions, but it still lets the game continue for practice."
          data-help-placement="bottom"
          aria-label={ui.judgeMode ? 'Exit judge mode' : 'Enter judge mode'}
          onClick={() => store.setJudgeMode(!ui.judgeMode)}
          title={ui.judgeMode ? 'Exit Judge Mode' : 'Enter Judge Mode'}
          style={topBtnStyle(ui.judgeMode ? '#78350f' : 'none', ui.judgeMode ? '#fcd34d' : '#64748b')}
        >⚜</button>
        <button
          data-testid="btn-ui-settings"
          data-help-title="UI Settings"
          data-help-body="Adjust local density, badges, combat math, and large-board display preferences. These settings do not sync to other players."
          data-help-placement="bottom"
          aria-label="Open UI settings"
          onClick={() => store.setUiSettingsOpen(true)}
          title="UI Settings"
          style={topBtnStyle(ui.uiSettingsOpen ? '#1e3a5f' : 'none', ui.uiSettingsOpen ? '#93c5fd' : '#64748b')}
        >UI</button>        <button
          data-testid="btn-card-search"
          data-help-title="Card Search"
          data-help-body="Opens Scryfall-backed lookup for card text and interaction checks while testing."
          data-help-example="/ or Ctrl+F opens search."
          data-help-placement="bottom"
          aria-label="Open card search"
          onClick={() => store.setCardSearchOpen(true)}
          title="Card Search (/ or Ctrl+F)"
          style={topBtnStyle(ui.cardSearchOpen ? '#1e3a5f' : 'none', ui.cardSearchOpen ? '#60a5fa' : '#64748b')}
        >🔍</button>
        <button
          data-testid="btn-replay"
          data-help-title="Replay Viewer"
          data-help-body="Opens replay tools so you can save and play back game logs, review sequencing, and spot missed triggers after a game."
          data-help-placement="bottom"
          aria-label="Open replay panel"
          onClick={() => store.setReplayOpen(true)}
          title="Replay — save & review game history"
          style={topBtnStyle(ui.replayOpen ? '#1e293b' : 'none', ui.replayOpen ? '#a78bfa' : '#64748b')}
        >⏺</button>
        <ReportButton
          variant="topbar"
          defaultType="bug"
          defaultComponent="TopBar"
          label="Report"
        />
        {game.config.playerCount === 1 && (
          <button
            data-testid="btn-deck-lab"
            data-help-title="Deck Lab"
            data-help-body="Opens the side-by-side solo deck builder. Add cards, edit custom logic, save slots, import/export, then load the deck into practice."
            data-help-placement="bottom"
            aria-label={ui.deckBuilderOpen ? 'Hide deck lab' : 'Show deck lab'}
            onClick={() => store.setDeckBuilderOpen(!ui.deckBuilderOpen)}
            title="Deck Lab"
            style={topBtnStyle(ui.deckBuilderOpen ? '#123642' : 'none', ui.deckBuilderOpen ? '#67e8f9' : '#64748b')}
          >Deck Lab</button>
        )}
        <button
          data-testid="btn-profile"
          data-help-title="Player Profile"
          data-help-body="Set your name, avatar, profile image, or card-art identity. In Commander lobbies, players manage their own profile."
          data-help-placement="bottom"
          aria-label="Open player profile"
          onClick={() => store.setProfileOpen(true)}
          title="Player Profile — customize your card"
          style={topBtnStyle(ui.profileOpen ? '#1e3a1e' : 'none', ui.profileOpen ? '#4ade80' : '#64748b')}
        >👤</button>
        <MultiplayerBadge />
        <button
          data-testid="btn-exit-game"
          data-help-title="Exit Game"
          data-help-body="Starts the clean exit flow. You can save replay data, preserve deck progress, and trigger host migration in Commander."
          data-help-placement="bottom"
          aria-label="Exit game"
          onClick={() => setExitOpen(true)}
          style={topBtnStyle('none', '#f87171')}
          title="Exit game"
        >Exit</button>
        <button
          data-testid="btn-open-lobby"
          data-help-title="Lobby And New Game"
          data-help-body="Returns to setup. Pick Deck Lab or Play Online, manage profiles, choose player count, import decks, and start a new session."
          data-help-placement="bottom"
          aria-label="Open lobby for a new game"
          onClick={() => store.setLobbyOpen(true)}
          style={topBtnStyle('none', '#64748b')}
          title="Lobby / New Game"
        >New</button>
        {/* Tutorial / Help */}
        <TutorialTooltip
          content={{ title: 'Tutorial & Tooltips', body: 'Click to toggle player tooltips on/off, or restart the guided walkthrough for new players.', step: 'judge_mode' }}
          placement="bottom"
          alwaysShow
        >
          <button
            data-testid="btn-tutorial"
            data-help-title="Tutorial Help"
            data-help-body="Starts the guided walkthrough or enables tooltips again. Use this whenever a new player wants the table explained."
            data-help-placement="bottom"
            aria-label={tutorial.walkthroughActive ? 'Stop guided tour' : tutorial.enabled ? 'Start guided tour or help' : 'Enable tooltips'}
            onClick={() => {
              if (tutorial.walkthroughActive) {
                tutorial.stopWalkthrough();
              } else if (!tutorial.enabled) {
                tutorial.toggleTooltips();
              } else {
                tutorial.startWalkthrough();
              }
            }}
            title={tutorial.walkthroughActive ? 'Stop tour' : tutorial.enabled ? 'Start tour / help' : 'Enable tooltips'}
            style={{
              ...topBtnStyle(tutorial.walkthroughActive ? '#1d4ed822' : 'none', tutorial.enabled ? '#a78bfa' : '#334155'),
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
          >
            ?
            {!tutorial.hasSeenStep('welcome') && (
              <PulseBeacon step="welcome" style={{ position: 'absolute', top: -3, right: -3, width: 7, height: 7 }} />
            )}
          </button>
        </TutorialTooltip>
        {/* Tooltip toggle (small x) when tooltips are on */}
        {tutorial.enabled && (
          <button
            aria-label="Disable tooltips"
            onClick={tutorial.toggleTooltips}
            title="Disable tooltips"
            style={{ ...topBtnStyle('none', '#334155'), fontSize: 9, padding: '3px 5px' }}
          >
            📖
          </button>
        )}
      </div>
    </div>
    <ExitGameModal open={exitOpen} onClose={() => setExitOpen(false)} />
    </>
  );
}

function topBtnStyle(bg: string, color: string): CSSProperties {
  return {
    background: bg,
    color,
    border: '1px solid #26323a',
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 10,
    cursor: 'pointer',
    fontWeight: 600,
    lineHeight: 1.4,
  };
}

