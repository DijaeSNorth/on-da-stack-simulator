import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { createExitProgressSnapshot, saveExitProgressSnapshot } from '../../engine/exitProgress';
import { requestHostMigrationBeforeLeave } from '../../engine/multiplayerSync';

interface ExitGameModalProps {
  open: boolean;
  onClose: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function ExitGameModal({ open, onClose }: ExitGameModalProps) {
  const store = useGameStore();
  const [saveReplay, setSaveReplay] = useState(true);
  const [saveProgress, setSaveProgress] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastSaved, setLastSaved] = useState<string[]>([]);

  const replayAvailable = store.game.actionLog.length > 0;
  const deckInfoAvailable = store.game.players.some(player => player.deckId || player.library.length > 0 || player.commandZone.length > 0);
  const isCommanderHost = store.game.config.format === 'commander' && store.multiplayer.status === 'host';
  const connected = store.multiplayer.status === 'host' || store.multiplayer.status === 'joined' || store.multiplayer.status === 'migrating';

  const exitSummary = useMemo(() => {
    const pieces = [`Turn ${store.game.turn}`, store.game.phase, `${store.game.actionLog.length} actions`];
    if (connected) pieces.push(store.multiplayer.status === 'host' ? 'hosting' : 'connected');
    return pieces.join(' | ');
  }, [connected, store.game.actionLog.length, store.game.phase, store.game.turn, store.multiplayer.status]);

  if (!open) return null;

  async function confirmExit() {
    setBusy(true);
    const saved: string[] = [];
    try {
      if (saveReplay && replayAvailable) {
        store.saveReplay(`Exit Replay - Turn ${store.game.turn}`);
        saved.push('Replay saved');
      }
      if (saveProgress && deckInfoAvailable) {
        saveExitProgressSnapshot(createExitProgressSnapshot(store.game, store.decks));
        saved.push('Deck/game progress saved');
      }
      if (isCommanderHost) {
        const migrationStarted = requestHostMigrationBeforeLeave();
        if (migrationStarted) {
          saved.push('Host migration started');
          await delay(1400);
        }
      }
      if (connected) store.leaveMultiplayerRoom();
      store.setLobbyOpen(true);
      setLastSaved(saved.length ? saved : ['Exited without saving optional items']);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        onClick={busy ? undefined : onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 40000 }}
      />
      <div
        data-testid="exit-game-modal"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 420,
          maxWidth: 'calc(100vw - 28px)',
          background: '#0b0f12',
          border: '1px solid #334155',
          borderRadius: 8,
          boxShadow: '0 30px 90px rgba(0,0,0,0.8)',
          zIndex: 40001,
          color: '#e2e8f0',
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>Exit Game</div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>{exitSummary}</div>

        <label style={optionStyle(!replayAvailable)}>
          <input
            type="checkbox"
            checked={saveReplay && replayAvailable}
            disabled={!replayAvailable || busy}
            onChange={event => setSaveReplay(event.target.checked)}
          />
          <span>Save replay log</span>
        </label>

        <label style={optionStyle(!deckInfoAvailable)}>
          <input
            type="checkbox"
            checked={saveProgress && deckInfoAvailable}
            disabled={!deckInfoAvailable || busy}
            onChange={event => setSaveProgress(event.target.checked)}
          />
          <span>Save deck and board progress summary</span>
        </label>

        {isCommanderHost && (
          <div style={{
            marginTop: 10,
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid #92400e',
            background: '#2b1708',
            color: '#fbbf24',
            fontSize: 11,
            lineHeight: 1.4,
          }}>
            You are the Commander host. Exiting will start host migration before disconnecting.
          </div>
        )}

        {lastSaved.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 10, color: '#86efac' }}>{lastSaved.join(' | ')}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={buttonStyle('#1e293b', '#94a3b8')}>
            Cancel
          </button>
          <button data-testid="btn-confirm-exit-game" onClick={confirmExit} disabled={busy} style={buttonStyle('#7f1d1d', '#fecaca')}>
            {busy ? 'Exiting...' : 'Exit'}
          </button>
        </div>
      </div>
    </>
  );
}

function optionStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    padding: '7px 0',
    color: disabled ? '#475569' : '#cbd5e1',
    fontSize: 12,
  };
}

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    background,
    color,
    border: '1px solid #334155',
    borderRadius: 6,
    padding: '7px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
  };
}
