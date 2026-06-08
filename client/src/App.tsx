import { useGameStore } from './store/gameStore';
import { Suspense, lazy, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { TopBar } from './components/TopBar';
import { PhaseGuideBar } from './components/PhaseGuideBar';
import { LeftPanel } from './components/panels/LeftPanel';
import { RightPanel } from './components/panels/RightPanel';
import { CommanderTable } from './components/battlefield/CommanderTable';
import { PlayerHand } from './components/hand/PlayerHand';
import { FloatingCardPreview } from './components/cards/CardPreview';
import { CardContextMenu } from './components/cards/CardContextMenu';
import { LobbyScreen } from './components/lobby/LobbyScreen';
import { CommandInput } from './components/command/CommandInput';
import { CommanderCastMoment } from './components/commander/CommanderCastMoment';
import { useIsMobile } from './hooks/use-mobile';

const CardSearchPanel = lazy(() =>
  import('./components/panels/CardSearchPanel').then(module => ({ default: module.CardSearchPanel }))
);
const ReplayPanel = lazy(() =>
  import('./components/replay/ReplayPanel').then(module => ({ default: module.ReplayPanel }))
);
const ProfilePanel = lazy(() =>
  import('./components/profile/ProfilePanel').then(module => ({ default: module.ProfilePanel }))
);
const SoloDeckBuilder = lazy(() =>
  import('./components/deckbuilder/SoloDeckBuilder').then(module => ({ default: module.SoloDeckBuilder }))
);
const ZoneDrawer = lazy(() =>
  import('./components/zones/ZoneDrawer').then(module => ({ default: module.ZoneDrawer }))
);
const PracticeDummyPanel = lazy(() =>
  import('./components/solo/PracticeDummyPanel').then(module => ({ default: module.PracticeDummyPanel }))
);
const TutorialOverlay = lazy(() => import('./components/tutorial/TutorialOverlay'));
const GlobalHelpTooltip = lazy(() =>
  import('./components/tutorial/GlobalHelpTooltip').then(module => ({ default: module.GlobalHelpTooltip }))
);

let multiplayerListenersInitialized = false;

export default function App() {
  const ui = useGameStore(s => s.ui);
  const game = useGameStore(s => s.game);
  const localPlayerId = useGameStore(s => s.localPlayerId);
  const initMultiplayerListeners = useGameStore(s => s.initMultiplayerListeners);
  const setLobbyOpen = useGameStore(s => s.setLobbyOpen);
  const rightPanelOpen = useGameStore(s => s.ui.rightPanelOpen);
  const setPanelSize = useGameStore(s => s.setPanelSize);
  const resetPanelSizes = useGameStore(s => s.resetPanelSizes);
  const toggleRightPanel = useGameStore(s => s.toggleRightPanel);
  const isMobile = useIsMobile();
  const appliedMobileLayout = useRef(false);

  useEffect(() => {
    if (multiplayerListenersInitialized) return;
    multiplayerListenersInitialized = true;
    initMultiplayerListeners();
  }, [initMultiplayerListeners]);

  useEffect(() => {
    if (isMobile && !appliedMobileLayout.current) {
      appliedMobileLayout.current = true;
      if (rightPanelOpen) toggleRightPanel();
    }
  }, [isMobile, rightPanelOpen, toggleRightPanel]);

  useEffect(() => {
    if (game.status === 'playing' && ui.screen !== 'game') {
      console.debug('[multiplayer] App safety switching playing game to game screen', {
        gameId: game.id,
        currentScreen: ui.screen,
      });
      setLobbyOpen(false);
    }
  }, [game.id, game.status, setLobbyOpen, ui.screen]);

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
        <Suspense fallback={null}>
          <ProfilePanel />
          <TutorialOverlay />
          <GlobalHelpTooltip />
        </Suspense>
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
        {ui.leftPanelOpen && (
          <>
            <PanelShell width={ui.panelSizes.left} side="left">
              <LeftPanel />
            </PanelShell>
            <ResizeHandle
              ariaLabel="Resize players panel"
              title="Drag to resize players panel. Double-click to reset panels."
              onResize={delta => setPanelSize('left', ui.panelSizes.left + delta)}
              onReset={resetPanelSizes}
            />
          </>
        )}

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
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative' }}>
            <CommanderTable />
            {game.config.playerCount === 1 && (
              <Suspense fallback={null}>
                <PracticeDummyPanel />
              </Suspense>
            )}
          </div>

          {/* Hand */}
          <PlayerHand />

          {/* NLP Command bar — always visible above hand */}
          <CommandInput />
        </div>

        {/* Right panel */}
        {ui.deckBuilderOpen && game.config.playerCount === 1 && (
          <>
          <ResizeHandle
            ariaLabel="Resize deck lab panel"
            title="Drag to resize deck lab panel. Double-click to reset panels."
            onResize={delta => setPanelSize('deckBuilder', ui.panelSizes.deckBuilder - delta)}
            onReset={resetPanelSizes}
          />
          <div style={{
            width: ui.panelSizes.deckBuilder,
            maxWidth: '55vw',
            minWidth: 0,
            borderLeft: '1px solid #26323a',
            background: '#080d11',
            overflow: 'auto',
            padding: 10,
            flexShrink: 0,
          }}>
            <Suspense fallback={null}>
              <SoloDeckBuilder playerId={localPlayerId || game.players[0]?.id} compact loadLabel="Reload Test Deck" />
            </Suspense>
          </div>
          </>
        )}

        {ui.rightPanelOpen && (
          <>
            <ResizeHandle
              ariaLabel="Resize assistant panel"
              title="Drag to resize assistant panel. Double-click to reset panels."
              onResize={delta => setPanelSize('right', ui.panelSizes.right - delta)}
              onReset={resetPanelSizes}
            />
            <PanelShell width={ui.panelSizes.right} side="right">
              <RightPanel />
            </PanelShell>
          </>
        )}

        {/* Collapsed right panel handle */}
        {!ui.rightPanelOpen && (
          <CollapseHandle side="right" />
        )}
      </div>

      {/* Overlays */}
      <FloatingCardPreview />
      <CommanderCastMoment />
      <CardContextMenu />
      {ui.zoneDrawer && (
        <Suspense fallback={null}>
          <ZoneDrawer />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <CardSearchPanel />
        <ReplayPanel />
        <ProfilePanel />
        <TutorialOverlay />
        <GlobalHelpTooltip />
      </Suspense>
    </div>
  );
}

function PanelShell({ width, side, children }: { width: number; side: 'left' | 'right'; children: ReactNode }) {
  return (
    <div style={{
      width,
      minWidth: 0,
      flexShrink: 0,
      display: 'flex',
      overflow: 'hidden',
      borderRight: side === 'left' ? '1px solid #1e293b' : 'none',
      borderLeft: side === 'right' ? '1px solid #1e293b' : 'none',
    }}>
      {children}
    </div>
  );
}

function ResizeHandle({
  ariaLabel,
  title,
  onResize,
  onReset,
}: {
  ariaLabel: string;
  title: string;
  onResize: (deltaX: number) => void;
  onReset: () => void;
}) {
  const dragRef = useRef<{ startX: number; lastX: number; pointerId: number } | null>(null);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onDoubleClick={onReset}
      onPointerDown={event => {
        dragRef.current = { startX: event.clientX, lastX: event.clientX, pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const delta = event.clientX - drag.lastX;
        drag.lastX = event.clientX;
        if (delta !== 0) onResize(delta);
      }}
      onPointerUp={event => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={event => {
        if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
      }}
      style={{
        width: 14,
        minWidth: 14,
        alignSelf: 'stretch',
        border: 'none',
        borderLeft: '1px solid rgba(148,163,184,0.08)',
        borderRight: '1px solid rgba(148,163,184,0.08)',
        background: 'linear-gradient(90deg, #0b0f12, #10161a, #0b0f12)',
        cursor: 'col-resize',
        touchAction: 'none',
        padding: 0,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <span style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 3,
        height: 38,
        borderRadius: 999,
        background: '#334155',
        boxShadow: '5px 0 0 #26323a, -5px 0 0 #26323a',
        pointerEvents: 'none',
      }} />
    </button>
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
