import { useMemo, useState } from 'react';
import { getReplayTimelineMarkers } from '../../engine/replayEngine';
import { useGameStore } from '../../store/gameStore';
import type { ActionRecord } from '../../types/game';
import {
  ACTION_LOG_FILTERS,
  buildActionLogViewModel,
  type ActionLogFilter,
} from '../panels/actionLogUiModel';

export function ReplayTimeline() {
  const replay = useGameStore(s => s.replay);
  const jumpToAction = useGameStore(s => s.replayJumpToAction);
  const [filter, setFilter] = useState<ActionLogFilter>('all');
  const [query, setQuery] = useState('');

  const timelineActions = useMemo(() => replay
    ? replay.replayFile.actionLog.map(action => sanitizeReplayAction(action, replay.replayFile.privacy.includesPrivateZones))
    : [],
  [replay]);

  const view = useMemo(() => replay
    ? buildActionLogViewModel(timelineActions, {
      players: replay.currentGameState.players,
      cards: replay.currentGameState.cards,
      filter,
      query,
      groupByTurn: false,
      currentTurn: replay.currentGameState.turn,
    })
    : null,
  [filter, query, replay, timelineActions]);
  const markers = useMemo(() => replay ? getReplayTimelineMarkers(replay.replayFile, replay.checkpoints, {
    notes: replay.reviewNotes,
    bookmarks: replay.bookmarks,
  }) : [], [replay]);

  if (!replay || !view) return null;
  const actionCount = replay.replayFile.actionLog.length;
  const sliderValue = replay.currentActionIndex + 1;
  const currentAction = replay.replayFile.actionLog[replay.currentActionIndex];
  const currentRow = currentAction
    ? buildActionLogViewModel([sanitizeReplayAction(currentAction, replay.replayFile.privacy.includesPrivateZones)], {
      players: replay.currentGameState.players,
      cards: replay.currentGameState.cards,
    }).rows[0]
    : null;
  const currentPlayer = currentAction
    ? replay.currentGameState.players.find(player => player.id === currentAction.playerId)?.name
      ?? replay.replayFile.players.find(player => player.playerId === currentAction.playerId)?.displayName
    : undefined;

  return (
    <div data-testid="replay-timeline" style={{ display: 'flex', flexDirection: 'column', gap: 8, height: '100%', minHeight: 0 }}>
      <div style={{ padding: 10, borderBottom: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'start' }}>
          <div>
            <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 900 }}>
              Action {Math.max(0, replay.currentActionIndex + 1)} / {actionCount}
            </div>
            <div data-testid="replay-current-action-label" style={{ color: '#94a3b8', fontSize: 10, lineHeight: 1.35, marginTop: 2 }}>
              {currentRow ? currentRow.text : actionCount === 0 ? 'No replay actions recorded.' : 'Initial game state'}
            </div>
          </div>
          <div style={{ textAlign: 'right', color: '#64748b', fontSize: 10, lineHeight: 1.45 }}>
            <div>Turn {replay.currentGameState.turn}</div>
            <div>{currentPlayer || 'No active action'}</div>
            {currentRow && <div style={{ color: '#93c5fd', textTransform: 'uppercase', fontWeight: 900 }}>{currentRow.category}</div>}
          </div>
        </div>
        <input
          data-testid="replay-scrubber"
          type="range"
          min={0}
          max={actionCount}
          value={sliderValue}
          onChange={event => jumpToAction(Number(event.target.value) - 1)}
          style={{ width: '100%' }}
          aria-label="Replay action scrubber"
        />
        <div data-testid="replay-marker-strip" style={{ position: 'relative', height: 14, background: '#020617', borderRadius: 999, overflow: 'hidden' }}>
          {markers.map(marker => (
            <button
              key={marker.id}
              type="button"
              data-testid={`replay-marker-${marker.type}`}
              aria-label={`Jump to ${marker.label}`}
              title={`${marker.type}: ${marker.label}`}
              onClick={() => jumpToAction(marker.actionIndex)}
              style={{
                position: 'absolute',
                left: `${actionCount <= 1 ? 0 : (Math.max(0, marker.actionIndex) / Math.max(1, actionCount - 1)) * 100}%`,
                top: marker.type === 'checkpoint' ? 4 : 2,
                width: marker.type === 'turn' ? 4 : marker.type === 'checkpoint' ? 2 : marker.type === 'bookmark' ? 5 : 3,
                height: marker.type === 'checkpoint' ? 6 : marker.type === 'note' ? 8 : 10,
                borderRadius: 2,
                border: 0,
                padding: 0,
                background: markerColor(marker.type),
                opacity: marker.type === 'checkpoint' ? 0.48 : 0.95,
                cursor: 'pointer',
              }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', color: '#475569', fontSize: 9 }}>
          <span>Markers: {markers.length}</span>
          <span>Checkpoints: {replay.checkpoints?.length ?? 0}</span>
          <span>Notes: {replay.reviewNotes.length}</span>
          <span>Bookmarks: {replay.bookmarks.length}</span>
          <span>Warnings: {markers.filter(marker => marker.type === 'warning').length}</span>
          <span>Privacy: {replay.replayFile.privacy.includesPrivateZones ? 'private' : replay.replayFile.privacy.redactedPlayers?.length ? 'redacted' : 'public'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            data-testid="replay-timeline-search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search replay actions"
            style={{ flex: 1, minWidth: 0, background: '#020617', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 5, padding: '5px 7px', fontSize: 10 }}
          />
          <span style={{ color: '#64748b', fontSize: 10, alignSelf: 'center', whiteSpace: 'nowrap' }}>
            {view.visibleCount} / {view.totalCount}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {ACTION_LOG_FILTERS.map(item => (
            <button
              key={item.id}
              data-testid={`replay-filter-${item.id}`}
              type="button"
              onClick={() => setFilter(item.id)}
              style={{
                border: `1px solid ${filter === item.id ? '#60a5fa' : '#334155'}`,
                background: filter === item.id ? 'rgba(59,130,246,0.18)' : '#0f172a',
                color: filter === item.id ? '#bfdbfe' : '#64748b',
                borderRadius: 999,
                padding: '3px 6px',
                fontSize: 8,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {actionCount === 0 && (
          <div data-testid="replay-empty-state" style={{
            padding: 14,
            border: '1px dashed #334155',
            borderRadius: 6,
            color: '#64748b',
            fontSize: 12,
            textAlign: 'center',
          }}>
            This replay has no action log entries.
          </div>
        )}
        {actionCount > 0 && view.rows.length === 0 && (
          <div data-testid="replay-filter-empty-state" style={{
            padding: 14,
            border: '1px dashed #334155',
            borderRadius: 6,
            color: '#64748b',
            fontSize: 12,
            textAlign: 'center',
          }}>
            No actions match the current filters.
          </div>
        )}
        {view.rows.map(row => {
          const index = row.actionIndex;
          const active = index === replay.currentActionIndex;
          return (
            <button
              key={row.action.id}
              data-testid={`replay-action-row-${row.action.id}`}
              aria-label={`Jump to action ${index + 1}: ${row.text}`}
              type="button"
              onClick={() => jumpToAction(index)}
              style={{
                textAlign: 'left',
                border: `1px solid ${active ? '#60a5fa' : '#1e293b'}`,
                background: active ? 'rgba(59,130,246,0.16)' : 'rgba(15,23,42,0.72)',
                color: '#cbd5e1',
                borderRadius: 6,
                padding: '6px 8px',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                <span style={{ color: active ? '#bfdbfe' : '#93c5fd', fontSize: 8, fontWeight: 900, textTransform: 'uppercase' }}>
                  {row.category}
                </span>
                <span style={{ color: '#475569', fontSize: 9 }}>#{index + 1} / T{row.action.turn}</span>
              </div>
              <div style={{ fontSize: 11, lineHeight: 1.35 }}>{row.text}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function markerColor(kind: string): string {
  switch (kind) {
    case 'turn': return '#f8fafc';
    case 'combat': return '#ef4444';
    case 'spell': return '#60a5fa';
    case 'ability': return '#a78bfa';
    case 'damage': return '#f97316';
    case 'zone_change': return '#94a3b8';
    case 'mechanic': return '#2dd4bf';
    case 'warning': return '#facc15';
    case 'checkpoint': return '#64748b';
    case 'note': return '#2dd4bf';
    case 'bookmark': return '#facc15';
    default: return '#64748b';
  }
}

function sanitizeReplayAction(action: ActionRecord, includesPrivateZones: boolean): ActionRecord {
  if (includesPrivateZones) return action;
  const redactedDescription = (() => {
    if (action.actionType === 'CAST_SPELL' || action.actionType === 'CAST') return 'A player cast a spell.';
    if (action.actionType === 'DRAW_CARD') return 'A player drew a card.';
    if (action.actionType === 'MOVE_CARD') return 'A player moved a card.';
    if (action.actionType === 'SEARCH_LIBRARY') return 'A player searched a library.';
    if (action.actionType === 'DISCARD') return 'A player discarded a card.';
    return action.description;
  })();
  return { ...action, description: redactedDescription };
}
