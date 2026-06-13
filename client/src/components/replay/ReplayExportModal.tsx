import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { formatReplayFileName } from '../../engine/replayFileUtils';

interface ReplayExportModalProps {
  open: boolean;
  onClose: () => void;
}

function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ReplayExportModal({ open, onClose }: ReplayExportModalProps) {
  const exportReplayFile = useGameStore(s => s.exportReplayFile);
  const game = useGameStore(s => s.game);
  const [includeFinalSnapshot, setIncludeFinalSnapshot] = useState(true);
  const [includeAnimationMetadata, setIncludeAnimationMetadata] = useState(false);

  const canExport = game.actionLog.length > 0;
  const summary = useMemo(() => ({
    actions: game.actionLog.length,
    players: game.players.map(player => player.name).join(' / '),
  }), [game.actionLog.length, game.players]);

  if (!open) return null;

  const exportReplay = (privacy: 'public' | 'private') => {
    const replay = exportReplayFile({
      includePrivateZones: privacy === 'private',
      includeFinalSnapshot,
      redacted: privacy === 'public',
      includeAnimationMetadata,
    });
    downloadJson(formatReplayFileName(replay, privacy), replay);
    onClose();
  };

  return (
    <div data-testid="replay-export-modal" role="dialog" aria-modal="true" aria-label="Export replay" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 30000,
      background: 'rgba(2,6,23,0.72)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 18,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        background: '#0b1117',
        border: '1px solid #334155',
        borderRadius: 10,
        boxShadow: '0 18px 60px rgba(0,0,0,0.42)',
        padding: 16,
        color: '#cbd5e1',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#f8fafc' }}>Export Replay</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>{summary.actions} actions / {summary.players || 'No players'}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close replay export modal" style={closeButtonStyle}>Close</button>
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 900, color: '#bfdbfe', fontSize: 12 }}>Public Replay</div>
          <div style={hintStyle}>Redacts hands, libraries, sideboards, maybeboards, private choices, and hidden card labels. Safe to share.</div>
        </div>
        <div style={{ ...cardStyle, borderColor: '#92400e', background: 'rgba(51,37,17,0.42)' }}>
          <div style={{ fontWeight: 900, color: '#fde68a', fontSize: 12 }}>Private Replay</div>
          <div style={hintStyle}>Includes full private zones if available. This may include hidden card information.</div>
        </div>

        <label style={checkStyle}>
          <input type="checkbox" checked={includeFinalSnapshot} onChange={event => setIncludeFinalSnapshot(event.target.checked)} />
          Include final snapshot
        </label>
        <label style={checkStyle}>
          <input type="checkbox" checked={includeAnimationMetadata} onChange={event => setIncludeAnimationMetadata(event.target.checked)} />
          Include animations metadata
        </label>
        <div style={{ fontSize: 10, color: '#64748b', margin: '8px 0 12px' }}>
          App, build, and ruleset metadata are included automatically.
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            type="button"
            data-testid="export-public-replay"
            onClick={() => exportReplay('public')}
            disabled={!canExport}
            style={{ ...exportButtonStyle, background: canExport ? '#0f2f4a' : '#1e293b', color: canExport ? '#bfdbfe' : '#475569' }}
          >
            Export Public Replay
          </button>
          <button
            type="button"
            data-testid="export-private-replay"
            onClick={() => exportReplay('private')}
            disabled={!canExport}
            style={{ ...exportButtonStyle, background: canExport ? '#332511' : '#1e293b', color: canExport ? '#fde68a' : '#475569' }}
          >
            Export Private Replay
          </button>
        </div>
      </div>
    </div>
  );
}

const cardStyle = {
  border: '1px solid #1e3a5f',
  background: 'rgba(15,47,74,0.32)',
  borderRadius: 8,
  padding: 10,
  marginBottom: 8,
};

const hintStyle = {
  color: '#94a3b8',
  fontSize: 10,
  lineHeight: 1.45,
  marginTop: 3,
};

const checkStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  color: '#cbd5e1',
  fontSize: 11,
  marginTop: 8,
};

const exportButtonStyle = {
  border: '1px solid #334155',
  borderRadius: 6,
  padding: '9px 10px',
  fontSize: 10,
  fontWeight: 900,
  cursor: 'pointer',
};

const closeButtonStyle = {
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#94a3b8',
  borderRadius: 5,
  padding: '5px 8px',
  fontSize: 10,
  cursor: 'pointer',
};
