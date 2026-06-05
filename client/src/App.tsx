import { useGameStore } from './store/gameStore';
import { useEffect, useRef } from 'react';
import { TopBar } from './components/TopBar';
import { PhaseGuideBar } from './components/PhaseGuideBar';
import { LeftPanel } from './components/panels/LeftPanel';
import { RightPanel } from './components/panels/RightPanel';
import { CommanderTable } from './components/battlefield/CommanderTable';
import { PlayerHand } from './components/hand/PlayerHand';
import { FloatingCardPreview } from './components/cards/CardPreview';
import { CardContextMenu } from './components/cards/CardContextMenu';
import { ZoneDrawer } from './components/zones/ZoneDrawer';
import { LobbyScreen } from './components/lobby/LobbyScreen';
import { CommandInput } from './components/command/CommandInput';
import { CardSearchPanel } from './components/panels/CardSearchPanel';
import { ReplayPanel } from './components/replay/ReplayPanel';
import { ProfilePanel } from './components/profile/ProfilePanel';
import { WelcomeModal, CoachMark } from './components/tutorial/TutorialOverlay';
import { useIsMobile } from './hooks/use-mobile';

export default function App() {
  const ui = useGameStore(s => s.ui);
  const rightPanelOpen = useGameStore(s => s.ui.rightPanelOpen);
  const toggleRightPanel = useGameStore(s => s.toggleRightPanel);
  const isMobile = useIsMobile();
  const appliedMobileLayout = useRef(false);

  useEffect(() => {
    if (isMobile && !appliedMobileLayout.current) {
      appliedMobileLayout.current = true;
      if (rightPanelOpen) toggleRightPanel();
    }
  }, [isMobile, rightPanelOpen, toggleRightPanel]);

  if (ui.screen === 'lobby') {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        background: '#080d11',
        overflow: 'hidden',
        fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
      }}>
        <LobbyScreen />
        <ProfilePanel />
        <WelcomeModal />
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100vw',
      height: '100vh',
      background: '#080d11',
      overflow: 'hidden',
      fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
    }}>
      {/* Top bar */}
      <TopBar />
      {/* Phase guide bar — player-driven, never auto-advances */}
      <PhaseGuideBar />

      {/* Main area: left panel + battlefield + right panel */}
      <div style={{
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        minHeight: 0,
      }}>
        {/* Left panel */}
        {ui.leftPanelOpen && <LeftPanel />}

        {/* Collapsed left panel handle */}
        {!ui.leftPanelOpen && (
          <CollapseHandle side="left" />
        )}

        {/* Battlefield center */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          position: 'relative',
        }}>
          {/* Battlefield (65-75% of screen) */}
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <CommanderTable />
          </div>

          {/* Hand */}
          <PlayerHand />

          {/* NLP Command bar — always visible above hand */}
          <CommandInput />
        </div>

        {/* Right panel */}
        {ui.rightPanelOpen && <RightPanel />}

        {/* Collapsed right panel handle */}
        {!ui.rightPanelOpen && (
          <CollapseHandle side="right" />
        )}
      </div>

      {/* Overlays */}
      <FloatingCardPreview />
      <CardContextMenu />
      <ZoneDrawer />
      <CardSearchPanel />
      <ReplayPanel />
      <ProfilePanel />
      {/* Tutorial system */}
      <WelcomeModal />
      <CoachMark />
    </div>
  );
}

function CollapseHandle({ side }: { side: 'left' | 'right' }) {
  const store = useGameStore();

  return (
    <button
      aria-label={side === 'left' ? 'Show players panel' : 'Show assistant panel'}
      title={side === 'left' ? 'Show players panel' : 'Show assistant panel'}
      onClick={side === 'left' ? store.toggleLeftPanel : store.toggleRightPanel}
      style={{
        width: 16,
        background: '#0b0f12',
        border: 'none',
        borderRight: side === 'left' ? '1px solid #26323a' : 'none',
        borderLeft: side === 'right' ? '1px solid #26323a' : 'none',
        cursor: 'pointer',
        color: '#475569',
        fontSize: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'color 0.15s',
      }}
      onMouseEnter={e => { (e.target as HTMLElement).style.color = '#94a3b8'; }}
      onMouseLeave={e => { (e.target as HTMLElement).style.color = '#475569'; }}
    >
      {side === 'left' ? '›' : '‹'}
    </button>
  );
}
