import { useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  clearRecentReplayImports,
  importReplayCandidate,
  loadRecentReplayImports,
  saveRecentReplayImport,
  type ReplayImportSummary,
} from '../../engine/replayFileUtils';
import type { ReplayFile } from '../../types/replay';
import { ReplayExportModal } from './ReplayExportModal';

interface ReplayImportDropzoneProps {
  compact?: boolean;
}

export function ReplayImportDropzone({ compact = false }: ReplayImportDropzoneProps) {
  const loadReplayFile = useGameStore(s => s.loadReplayFile);
  const game = useGameStore(s => s.game);
  const [pendingReplay, setPendingReplay] = useState<ReplayFile | null>(null);
  const [summary, setSummary] = useState<ReplayImportSummary | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [recent, setRecent] = useState<ReplayImportSummary[]>(() => loadRecentReplayImports());
  const [exportOpen, setExportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    setLoading(true);
    setErrors([]);
    setWarnings([]);
    setPendingReplay(null);
    setSummary(null);
    try {
      const result = await importReplayCandidate(file, {
        currentAppVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
      });
      setErrors(result.errors);
      setWarnings(result.warnings);
      if (result.ok && result.replayFile && result.summary) {
        setPendingReplay(result.replayFile);
        setSummary(result.summary);
      }
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Replay file could not be read.']);
    } finally {
      setLoading(false);
      setDragging(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function loadPendingReplay() {
    if (!pendingReplay || !summary) return;
    const ok = await loadReplayFile(pendingReplay);
    if (ok) setRecent(saveRecentReplayImport(summary));
  }

  const hasExportableGame = game.actionLog.length > 0;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: compact ? 10 : 14,
      border: '1px solid #243241',
      borderRadius: 8,
      background: 'rgba(8,13,17,0.76)',
    }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        data-testid="replay-file-input"
        onChange={event => void handleFile(event.target.files?.[0] ?? null)}
        style={{ display: 'none' }}
      />
      <div
        data-testid="replay-import-dropzone"
        onDragOver={event => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault();
          void handleFile(event.dataTransfer.files?.[0] ?? null);
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
        }}
        style={{
          border: `1px dashed ${dragging ? '#60a5fa' : '#334155'}`,
          background: dragging ? 'rgba(59,130,246,0.14)' : 'rgba(15,23,42,0.72)',
          color: '#bfdbfe',
          borderRadius: 8,
          padding: compact ? 12 : 18,
          textAlign: 'center',
          cursor: loading ? 'wait' : 'pointer',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 900 }}>{loading ? 'Reading Replay...' : 'Import Replay'}</div>
        <div style={{ color: '#64748b', fontSize: 10, marginTop: 4 }}>Drop a .json replay here or click to choose a file.</div>
      </div>

      {errors.length > 0 && (
        <div data-testid="replay-load-error" style={messageStyle('#fca5a5', '#7f1d1d')}>
          {errors.map(error => <div key={error}>{error}</div>)}
        </div>
      )}
      {warnings.length > 0 && (
        <div data-testid="replay-import-warnings" style={messageStyle('#fcd34d', '#78350f')}>
          {warnings.map(warning => <div key={warning}>{warning}</div>)}
        </div>
      )}

      {summary && (
        <div data-testid="replay-file-summary" style={{
          border: '1px solid #1e293b',
          background: 'rgba(2,6,23,0.52)',
          borderRadius: 8,
          padding: 10,
          fontSize: 10,
          color: '#94a3b8',
          lineHeight: 1.55,
        }}>
          <div style={{ color: '#e2e8f0', fontWeight: 900, fontSize: 12 }}>{summary.gameName || summary.gameId}</div>
          <div>Game ID: {summary.gameId}</div>
          <div>Exported: {summary.exportedDate}</div>
          <div>Players: {summary.players.join(' / ') || 'Unknown'}</div>
          <div>Actions: {summary.actionCount} / Turns: {summary.estimatedTurnCount}</div>
          <div>Replay: {summary.replayVersion} / App: {summary.appVersion || 'unknown'} / Commit: {summary.buildCommit || 'unknown'}</div>
          <div>Ruleset: {summary.rulesetVersion || 'unknown'} / Privacy: {summary.privacyMode} / Warnings: {summary.warningsCount}</div>
          <button
            type="button"
            data-testid="start-imported-replay"
            onClick={() => void loadPendingReplay()}
            disabled={!pendingReplay || loading}
            style={{
              marginTop: 9,
              width: '100%',
              border: '1px solid #14532d',
              background: '#12351f',
              color: '#bbf7d0',
              borderRadius: 6,
              padding: '8px 10px',
              fontSize: 10,
              fontWeight: 900,
              cursor: pendingReplay && !loading ? 'pointer' : 'not-allowed',
            }}
          >
            Start Replay
          </button>
        </div>
      )}

      <div style={{
        borderTop: '1px solid #1e293b',
        paddingTop: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 900 }}>Export Current Game</div>
          <button
            type="button"
            data-testid="open-replay-export-modal"
            onClick={() => setExportOpen(true)}
            disabled={!hasExportableGame}
            style={{
              border: '1px solid #92400e',
              background: hasExportableGame ? '#332511' : '#1e293b',
              color: hasExportableGame ? '#fde68a' : '#475569',
              borderRadius: 5,
              padding: '5px 8px',
              fontSize: 9,
              fontWeight: 900,
              cursor: hasExportableGame ? 'pointer' : 'not-allowed',
            }}
          >
            Export Replay
          </button>
        </div>
        {!hasExportableGame && <div style={{ color: '#475569', fontSize: 10 }}>No current action log is available to export.</div>}
      </div>

      {recent.length > 0 && (
        <div data-testid="recent-replay-imports" style={{ borderTop: '1px solid #1e293b', paddingTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 900 }}>Recent Local Replays</div>
            <button
              type="button"
              data-testid="clear-recent-replays"
              onClick={() => {
                clearRecentReplayImports();
                setRecent([]);
              }}
              style={{ border: '1px solid #334155', background: '#0f172a', color: '#94a3b8', borderRadius: 5, padding: '3px 6px', fontSize: 9, cursor: 'pointer' }}
            >
              Clear Recent Replays
            </button>
          </div>
          {recent.map(item => (
            <div key={`${item.gameId}-${item.exportedAt}-${item.fileName ?? ''}`} style={{ color: '#64748b', fontSize: 10, lineHeight: 1.45 }}>
              <span style={{ color: '#94a3b8' }}>{item.gameName || item.gameId}</span> / {item.actionCount} actions / {item.privacyMode}
            </div>
          ))}
        </div>
      )}

      <ReplayExportModal open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}

function messageStyle(color: string, border: string) {
  return {
    color,
    border: `1px solid ${border}`,
    background: 'rgba(15,23,42,0.72)',
    borderRadius: 6,
    padding: '7px 8px',
    fontSize: 10,
    lineHeight: 1.4,
  };
}
