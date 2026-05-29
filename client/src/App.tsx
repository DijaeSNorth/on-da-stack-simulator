import { useGameStore } from './store/gameStore';
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

export default function App() {
  const ui = useGameStore(s => s.ui);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100vw',
      height: '100vh',
      background: '#0d1117',
      overflow: 'hidden',
      fontFamily: '"Inter", "SF Pro Display", system-ui, sans-serif',
    }}>
      {/* Lobby overlay */}
      {ui.lobbyOpen && <LobbyScreen />}

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
    </div>
  );
}

function CollapseHandle({ side }: { side: 'left' | 'right' }) {
  const store = useGameStore();

  return (
    <button
      onClick={side === 'left' ? store.toggleLeftPanel : store.toggleRightPanel}
      style={{
        width: 16,
        background: '#0f172a',
        border: 'none',
        borderRight: side === 'left' ? '1px solid #1e293b' : 'none',
        borderLeft: side === 'right' ? '1px solid #1e293b' : 'none',
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
