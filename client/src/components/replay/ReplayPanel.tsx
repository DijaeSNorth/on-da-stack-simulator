/**
 * ReplayPanel.tsx
 *
 * Lightweight replay viewer — modal overlay.
 *
 * Features:
 *   - Scrubber slider (seek to any action)
 *   - Step forward / backward buttons
 *   - Play / Pause auto-advance
 *   - Action list grouped by turn/phase (scrolls to current)
 *   - Saved replays list (load, delete, export JSON, import JSON)
 *   - Player life totals at current step
 *
 * Intentionally read-only — never writes to the live game store.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  loadReplaysFromStorage, deleteReplayFromStorage, saveReplayToStorage,
  exportReplayAsJSON, importReplayFromJSON,
  getActionsUpTo, groupActionsByTurn, describeAction,
  formatDuration, ACTION_COLORS,
  type Replay,
} from '../../engine/replayEngine';
import type { ActionRecord } from '../../types/game';

// ─── Phase labels ─────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw',
  main1: 'Main 1', combat: 'Combat', main2: 'Main 2', end: 'End',
  cleanup: 'Cleanup',
};

// ─── Main ReplayPanel ─────────────────────────────────────────────────────────

export function ReplayPanel() {
  const store = useGameStore();
  const { ui } = store;

  const [replays, setReplays] = useState<Replay[]>([]);
  const [activeReplay, setActiveReplay] = useState<Replay | null>(null);
  const [cursor, setCursor] = useState(0);       // current action index
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);       // ms per step
  const [view, setView] = useState<'list' | 'viewer'>('list');
  const [importError, setImportError] = useState('');

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const actionListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refresh saved replays list
  const refreshReplays = useCallback(() => {
    setReplays(loadReplaysFromStorage());
  }, []);

  useEffect(() => {
    if (ui.replayOpen) refreshReplays();
  }, [ui.replayOpen, refreshReplays]);

  // Auto-play interval
  useEffect(() => {
    if (playing && activeReplay) {
      intervalRef.current = setInterval(() => {
        setCursor(prev => {
          const next = prev + 1;
          if (next >= activeReplay.actionLog.length) {
            setPlaying(false);
            return prev;
          }
          return next;
        });
      }, speed);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, speed, activeReplay]);

  // Scroll action list to current item
  useEffect(() => {
    const el = document.getElementById(`replay-action-${cursor}`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursor]);

  if (!ui.replayOpen) return null;

  function close() {
    store.setReplayOpen(false);
    setPlaying(false);
    setActiveReplay(null);
    setView('list');
  }

  function openReplay(replay: Replay) {
    setActiveReplay(replay);
    setCursor(0);
    setPlaying(false);
    setView('viewer');
  }

  function deleteReplay(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    deleteReplayFromStorage(id);
    refreshReplays();
  }

  function exportReplay(replay: Replay, e: React.MouseEvent) {
    e.stopPropagation();
    const json = exportReplayAsJSON(replay);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `replay-${replay.meta.name.replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    setImportError('');
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const json = ev.target?.result as string;
      const replay = importReplayFromJSON(json);
      if (!replay) { setImportError('Invalid replay file.'); return; }
      // Save and open immediately
      saveReplayToStorage(replay);
      refreshReplays();
      openReplay(replay);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const maxCursor = activeReplay ? activeReplay.actionLog.length - 1 : 0;
  const visibleActions = activeReplay ? getActionsUpTo(activeReplay, cursor) : [];
  const grouped = groupActionsByTurn(visibleActions);

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="replay-backdrop"
        onClick={close}
        style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(2px)' }}
      />

      {/* Panel */}
      <div
        data-testid="replay-panel"
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10001,
          width: 720, maxWidth: 'calc(100vw - 32px)',
          height: 560, maxHeight: 'calc(100vh - 80px)',
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 12,
          boxShadow: '0 40px 120px rgba(0,0,0,0.9)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid #1e293b',
          flexShrink: 0,
        }}>
          {view === 'viewer' && activeReplay && (
            <button
              data-testid="replay-back-btn"
              onClick={() => { setView('list'); setPlaying(false); }}
              style={iconBtnStyle}
            >←</button>
          )}
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
              {view === 'list' ? 'Replays' : activeReplay?.meta.name}
            </span>
            {view === 'viewer' && activeReplay && (
              <span style={{ fontSize: 10, color: '#475569', marginLeft: 8 }}>
                {activeReplay.meta.playerNames.join(' · ')} · {activeReplay.meta.turnCount} turns · {formatDuration(activeReplay.meta.durationMs)}
              </span>
            )}
          </div>
          <button data-testid="replay-close-btn" onClick={close} style={iconBtnStyle}>×</button>
        </div>

        {/* Body */}
        {view === 'list' ? (
          <ReplayListView
            replays={replays}
            onOpen={openReplay}
            onDelete={deleteReplay}
            onExport={exportReplay}
            onImport={() => fileInputRef.current?.click()}
            importError={importError}
          />
        ) : activeReplay ? (
          <ReplayViewerView
            replay={activeReplay}
            cursor={cursor}
            setCursor={setCursor}
            playing={playing}
            setPlaying={setPlaying}
            speed={speed}
            setSpeed={setSpeed}
            maxCursor={maxCursor}
            grouped={grouped}
            actionListRef={actionListRef}
            onExport={e => exportReplay(activeReplay, e)}
          />
        ) : null}

        {/* Hidden file input for import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          style={{ display: 'none' }}
        />
      </div>
    </>
  );
}

// ─── Replay List View ─────────────────────────────────────────────────────────

function ReplayListView({
  replays, onOpen, onDelete, onExport, onImport, importError,
}: {
  replays: Replay[];
  onOpen: (r: Replay) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  onExport: (r: Replay, e: React.MouseEvent) => void;
  onImport: () => void;
  importError: string;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          data-testid="replay-import-btn"
          onClick={onImport}
          style={pillBtnStyle('#1e3a5f', '#60a5fa')}
        >
          Import JSON
        </button>
        {importError && <span style={{ fontSize: 11, color: '#f87171' }}>{importError}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#334155' }}>
          {replays.length}/10 saved
        </span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {replays.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#334155', fontSize: 13 }}>
            No replays saved yet.
            <br />
            <span style={{ fontSize: 11, marginTop: 6, display: 'block' }}>
              Use the Save Replay button in the top bar during or after a game.
            </span>
          </div>
        ) : replays.map(r => (
          <div
            key={r.meta.id}
            data-testid={`replay-item-${r.meta.id}`}
            onClick={() => onOpen(r)}
            style={{
              padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid #1e293b', background: '#0a0f1a',
              marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12,
              transition: 'border-color 0.1s',
            }}
            onMouseOver={e => (e.currentTarget.style.borderColor = '#334155')}
            onMouseOut={e => (e.currentTarget.style.borderColor = '#1e293b')}
          >
            {/* Replay icon */}
            <div style={{ fontSize: 20, flexShrink: 0 }}>⏺</div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.meta.name}
              </div>
              <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                {r.meta.playerNames.join(', ')} · {r.meta.turnCount} turns · {r.meta.actionCount} actions · {formatDuration(r.meta.durationMs)}
              </div>
              <div style={{ fontSize: 9, color: '#334155', marginTop: 1 }}>
                Saved {new Date(r.meta.savedAt).toLocaleString()}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button
                data-testid={`replay-export-${r.meta.id}`}
                onClick={e => onExport(r, e)}
                title="Export as JSON"
                style={{ ...iconBtnStyle, fontSize: 11 }}
              >↓</button>
              <button
                data-testid={`replay-delete-${r.meta.id}`}
                onClick={e => onDelete(r.meta.id, e)}
                title="Delete"
                style={{ ...iconBtnStyle, fontSize: 11, color: '#f87171' }}
              >✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Replay Viewer View ───────────────────────────────────────────────────────

function ReplayViewerView({
  replay, cursor, setCursor, playing, setPlaying,
  speed, setSpeed, maxCursor, grouped, actionListRef, onExport,
}: {
  replay: Replay;
  cursor: number;
  setCursor: (n: number) => void;
  playing: boolean;
  setPlaying: (b: boolean) => void;
  speed: number;
  setSpeed: (n: number) => void;
  maxCursor: number;
  grouped: ReturnType<typeof groupActionsByTurn>;
  actionListRef: React.RefObject<HTMLDivElement>;
  onExport: (e: React.MouseEvent) => void;
}) {
  const currentAction = replay.actionLog[cursor];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Transport controls */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid #1e293b',
        flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {/* Scrubber */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: '#475569', minWidth: 32, textAlign: 'right', fontFamily: 'monospace' }}>
            {cursor + 1}
          </span>
          <input
            data-testid="replay-scrubber"
            type="range"
            min={0}
            max={maxCursor}
            value={cursor}
            onChange={e => { setPlaying(false); setCursor(Number(e.target.value)); }}
            style={{ flex: 1, accentColor: '#7c3aed', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 10, color: '#475569', minWidth: 32, fontFamily: 'monospace' }}>
            {maxCursor + 1}
          </span>
        </div>

        {/* Buttons row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Step backward */}
          <button
            data-testid="replay-step-back"
            onClick={() => { setPlaying(false); setCursor(Math.max(0, cursor - 1)); }}
            disabled={cursor === 0}
            style={transportBtnStyle(cursor === 0)}
            title="Previous action"
          >⏮</button>

          {/* Play/Pause */}
          <button
            data-testid="replay-play-pause"
            onClick={() => setPlaying(!playing)}
            disabled={cursor >= maxCursor}
            style={transportBtnStyle(cursor >= maxCursor, '#7c3aed')}
            title={playing ? 'Pause' : 'Play'}
          >{playing ? '⏸' : '▶'}</button>

          {/* Step forward */}
          <button
            data-testid="replay-step-forward"
            onClick={() => { setPlaying(false); setCursor(Math.min(maxCursor, cursor + 1)); }}
            disabled={cursor >= maxCursor}
            style={transportBtnStyle(cursor >= maxCursor)}
            title="Next action"
          >⏭</button>

          {/* Jump to start / end */}
          <button data-testid="replay-jump-start" onClick={() => { setPlaying(false); setCursor(0); }} style={{ ...transportBtnStyle(cursor === 0), fontSize: 9 }} title="Jump to start">|◀</button>
          <button data-testid="replay-jump-end" onClick={() => { setPlaying(false); setCursor(maxCursor); }} style={{ ...transportBtnStyle(cursor >= maxCursor), fontSize: 9 }} title="Jump to end">▶|</button>

          {/* Speed */}
          <select
            data-testid="replay-speed"
            value={speed}
            onChange={e => setSpeed(Number(e.target.value))}
            style={{
              background: '#1e293b', border: '1px solid #334155', borderRadius: 4,
              color: '#94a3b8', fontSize: 10, padding: '2px 4px', cursor: 'pointer',
              marginLeft: 4,
            }}
          >
            <option value={1500}>0.5×</option>
            <option value={800}>1×</option>
            <option value={400}>2×</option>
            <option value={150}>5×</option>
          </select>

          <div style={{ flex: 1 }} />

          {/* Current action tag */}
          {currentAction && (
            <span style={{
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
              background: `${ACTION_COLORS[currentAction.actionType] ?? '#334155'}22`,
              color: ACTION_COLORS[currentAction.actionType] ?? '#64748b',
              border: `1px solid ${ACTION_COLORS[currentAction.actionType] ?? '#334155'}44`,
            }}>
              {currentAction.actionType}
            </span>
          )}

          {/* Export */}
          <button onClick={onExport} style={{ ...iconBtnStyle, fontSize: 11 }} title="Export JSON">↓</button>
        </div>

        {/* Current action description */}
        {currentAction && (
          <div style={{
            fontSize: 11, color: '#94a3b8',
            background: '#0a0f1a', borderRadius: 6,
            padding: '5px 10px', border: '1px solid #1e293b',
          }}>
            <span style={{ color: '#475569', marginRight: 6 }}>
              T{currentAction.turn} {PHASE_LABEL[currentAction.phase] ?? currentAction.phase}
            </span>
            {describeAction(currentAction)}
          </div>
        )}
      </div>

      {/* Action log */}
      <div
        ref={actionListRef}
        style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}
      >
        {grouped.map(group => (
          <div key={`${group.turn}-${group.phase}`} style={{ marginBottom: 8 }}>
            {/* Turn / phase header */}
            <div style={{
              fontSize: 9, fontWeight: 700, color: '#334155',
              textTransform: 'uppercase', letterSpacing: 1,
              padding: '2px 0', marginBottom: 3,
            }}>
              Turn {group.turn} — {PHASE_LABEL[group.phase] ?? group.phase}
            </div>

            {group.actions.map(action => {
              const globalIndex = replay.actionLog.indexOf(action);
              const isCurrent = globalIndex === cursor;
              const isPast = globalIndex < cursor;
              const color = ACTION_COLORS[action.actionType] ?? '#475569';

              return (
                <div
                  key={action.id}
                  id={`replay-action-${globalIndex}`}
                  data-testid={`replay-action-row-${globalIndex}`}
                  onClick={() => { setPlaying(false); setCursor(globalIndex); }}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8,
                    padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                    background: isCurrent ? '#1e1b4b' : 'transparent',
                    borderLeft: `2px solid ${isCurrent ? '#7c3aed' : 'transparent'}`,
                    opacity: isPast || isCurrent ? 1 : 0.35,
                    transition: 'background 0.1s',
                  }}
                >
                  {/* Color pip */}
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: color, flexShrink: 0, marginTop: 4,
                  }} />

                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 11, color: isCurrent ? '#e2e8f0' : '#94a3b8' }}>
                      {describeAction(action)}
                    </span>
                    {action.flags.length > 0 && (
                      <span style={{ fontSize: 9, color: '#fcd34d', marginLeft: 4 }}>
                        ⚠ {action.flags.length}
                      </span>
                    )}
                  </div>

                  {/* Index */}
                  <span style={{ fontSize: 9, color: '#334155', flexShrink: 0, fontFamily: 'monospace' }}>
                    {globalIndex + 1}
                  </span>
                </div>
              );
            })}
          </div>
        ))}

        {grouped.length === 0 && (
          <div style={{ padding: '20px', textAlign: 'center', color: '#334155', fontSize: 12 }}>
            No actions recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Micro styles ─────────────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 6,
  border: '1px solid #1e293b', background: 'transparent',
  color: '#64748b', cursor: 'pointer', fontSize: 14,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function pillBtnStyle(bg: string, color: string): React.CSSProperties {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${color}44`,
    background: bg, color,
  };
}

function transportBtnStyle(disabled: boolean, accent?: string): React.CSSProperties {
  return {
    width: 28, height: 28, borderRadius: 6, fontSize: 13,
    border: `1px solid ${disabled ? '#1e293b' : (accent ? `${accent}66` : '#334155')}`,
    background: disabled ? 'transparent' : (accent ? `${accent}18` : '#1e293b'),
    color: disabled ? '#334155' : (accent ?? '#94a3b8'),
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.1s',
  };
}
