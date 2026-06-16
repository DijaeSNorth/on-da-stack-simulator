import { useMemo, useState } from 'react';
import { generateReplayReviewJson, generateReplayReviewMarkdown } from '../../engine/replayReviewExport';
import { exportReplayReview, getReplayReviewId, REPLAY_REVIEW_STORAGE_COPY } from '../../engine/replayReviewStorage';
import { useGameStore } from '../../store/gameStore';
import type { ReplayBookmarkType, ReplayReviewNoteType } from '../../types/replay';

const NOTE_TYPES: ReplayReviewNoteType[] = [
  'general',
  'mistake',
  'good_play',
  'rules_question',
  'deck_issue',
  'combat_decision',
  'mulligan_decision',
  'mana_issue',
  'highlight',
  'content_clip',
];

const BOOKMARK_TYPES: ReplayBookmarkType[] = ['custom', 'turning_point', 'combat', 'combo', 'mistake', 'highlight', 'rules'];

export function ReplayReviewPanel() {
  const replay = useGameStore(s => s.replay);
  const addNote = useGameStore(s => s.addReplayNote);
  const updateNote = useGameStore(s => s.updateReplayNote);
  const deleteNote = useGameStore(s => s.deleteReplayNote);
  const addBookmark = useGameStore(s => s.addReplayBookmark);
  const deleteBookmark = useGameStore(s => s.deleteReplayBookmark);
  const jumpToAction = useGameStore(s => s.replayJumpToAction);
  const jumpToBookmark = useGameStore(s => s.jumpToReplayBookmark);
  const [noteType, setNoteType] = useState<ReplayReviewNoteType>('general');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteTags, setNoteTags] = useState('');
  const [bookmarkType, setBookmarkType] = useState<ReplayBookmarkType>('custom');
  const [bookmarkLabel, setBookmarkLabel] = useState('');
  const [filterType, setFilterType] = useState<'all' | ReplayReviewNoteType>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [exportStatus, setExportStatus] = useState('');

  const currentActionIndex = replay?.currentActionIndex ?? -1;
  const currentNotes = replay?.reviewNotes.filter(note => note.actionIndex === currentActionIndex) ?? [];
  const currentBookmarks = replay?.bookmarks.filter(bookmark => bookmark.actionIndex === currentActionIndex) ?? [];
  const visibleNotes = useMemo(() => {
    if (!replay) return [];
    const normalizedTag = tagFilter.trim().toLowerCase();
    return replay.reviewNotes
      .filter(note => filterType === 'all' || note.type === filterType)
      .filter(note => !normalizedTag || note.tags.some(tag => tag.toLowerCase().includes(normalizedTag)))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [filterType, replay, tagFilter]);

  if (!replay) return null;

  const replayFile = replay.replayFile;
  const replayId = getReplayReviewId(replayFile);
  const reviewNotes = replay.reviewNotes;
  const bookmarks = replay.bookmarks;
  const actionLabel = currentActionIndex >= 0 ? `Action ${currentActionIndex + 1}` : 'Initial State';

  function addCurrentNote() {
    if (!noteBody.trim()) return;
    addNote(currentActionIndex, {
      type: noteType,
      title: noteTitle,
      body: noteBody,
      tags: parseTags(noteTags),
    });
    setNoteTitle('');
    setNoteBody('');
    setNoteTags('');
  }

  function addCurrentBookmark() {
    const fallback = currentActionIndex >= 0 ? `Action ${currentActionIndex + 1}` : 'Initial State';
    addBookmark(currentActionIndex, {
      type: bookmarkType,
      label: bookmarkLabel.trim() || fallback,
      color: bookmarkColor(bookmarkType),
    });
    setBookmarkLabel('');
  }

  function exportReview() {
    const payload = exportReplayReview(replayId);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `on-da-stack-review-${replayFile.gameId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copySummary() {
    const text = generateReplayReviewMarkdown(replayFile, reviewNotes, bookmarks);
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setExportStatus('Clipboard is not available in this browser.');
      return;
    }
    await navigator.clipboard.writeText(text);
    setExportStatus('Markdown summary copied.');
  }

  function downloadSummary(format: 'markdown' | 'json') {
    const text = format === 'markdown'
      ? generateReplayReviewMarkdown(replayFile, reviewNotes, bookmarks)
      : generateReplayReviewJson(replayFile, reviewNotes, bookmarks);
    const blob = new Blob([text], { type: format === 'markdown' ? 'text/markdown' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `on-da-stack-review-summary-${replayFile.gameId}.${format === 'markdown' ? 'md' : 'json'}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportStatus(`${format === 'markdown' ? 'Markdown' : 'JSON'} summary downloaded.`);
  }

  return (
    <div data-testid="replay-review-panel" style={{ borderTop: '1px solid #1e293b', paddingTop: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong style={{ color: '#e2e8f0', fontSize: 11 }}>Replay Review</strong>
        <button type="button" data-testid="replay-review-export" onClick={exportReview} style={smallButtonStyle}>Export Review</button>
      </div>
      <div style={{ color: '#64748b', fontSize: 9, lineHeight: 1.35 }}>{REPLAY_REVIEW_STORAGE_COPY}</div>
      <div style={{ color: '#fcd34d', fontSize: 9, lineHeight: 1.35 }}>Review exports include your notes. Review before sharing.</div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <button type="button" data-testid="replay-review-copy-summary" onClick={() => void copySummary()} style={smallButtonStyle}>Copy Summary</button>
        <button type="button" data-testid="replay-review-download-md" onClick={() => downloadSummary('markdown')} style={smallButtonStyle}>Download Markdown</button>
        <button type="button" data-testid="replay-review-download-json" onClick={() => downloadSummary('json')} style={smallButtonStyle}>Download JSON</button>
      </div>
      {exportStatus && <div style={{ color: '#93c5fd', fontSize: 9 }}>{exportStatus}</div>}

      <div data-testid="replay-current-review-items" style={panelBoxStyle}>
        <div style={sectionTitleStyle}>{actionLabel}</div>
        <div style={{ color: '#94a3b8' }}>Attached: {currentNotes.length} note{currentNotes.length === 1 ? '' : 's'} / {currentBookmarks.length} bookmark{currentBookmarks.length === 1 ? '' : 's'}</div>
        {currentNotes.map(note => <div key={note.noteId} style={inlineItemStyle}>Note: {note.title || note.type.replace(/_/g, ' ')}</div>)}
        {currentBookmarks.map(bookmark => <div key={bookmark.bookmarkId} style={inlineItemStyle}>Bookmark: {bookmark.label}</div>)}
      </div>

      <div style={panelBoxStyle}>
        <div style={sectionTitleStyle}>Add Note at Current Action</div>
        <select value={noteType} onChange={event => setNoteType(event.target.value as ReplayReviewNoteType)} style={inputStyle}>
          {NOTE_TYPES.map(type => <option key={type} value={type}>{labelize(type)}</option>)}
        </select>
        <input value={noteTitle} onChange={event => setNoteTitle(event.target.value)} placeholder="Optional title" style={inputStyle} />
        <textarea value={noteBody} onChange={event => setNoteBody(event.target.value)} placeholder="Write review note..." rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        <input value={noteTags} onChange={event => setNoteTags(event.target.value)} placeholder="Tags, comma-separated" style={inputStyle} />
        <button type="button" data-testid="replay-add-note" onClick={addCurrentNote} disabled={!noteBody.trim()} style={primaryButtonStyle}>Add Note at Current Action</button>
      </div>

      <div style={panelBoxStyle}>
        <div style={sectionTitleStyle}>Add Bookmark at Current Action</div>
        <select value={bookmarkType} onChange={event => setBookmarkType(event.target.value as ReplayBookmarkType)} style={inputStyle}>
          {BOOKMARK_TYPES.map(type => <option key={type} value={type}>{labelize(type)}</option>)}
        </select>
        <input value={bookmarkLabel} onChange={event => setBookmarkLabel(event.target.value)} placeholder="Bookmark label" style={inputStyle} />
        <button type="button" data-testid="replay-add-bookmark" onClick={addCurrentBookmark} style={primaryButtonStyle}>Add Bookmark at Current Action</button>
      </div>

      <div style={panelBoxStyle}>
        <div style={sectionTitleStyle}>Notes</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
          <select value={filterType} onChange={event => setFilterType(event.target.value as 'all' | ReplayReviewNoteType)} style={inputStyle}>
            <option value="all">All Types</option>
            {NOTE_TYPES.map(type => <option key={type} value={type}>{labelize(type)}</option>)}
          </select>
          <input value={tagFilter} onChange={event => setTagFilter(event.target.value)} placeholder="Filter tag" style={inputStyle} />
        </div>
        {visibleNotes.length === 0 ? (
          <div style={{ color: '#475569', fontSize: 10 }}>No notes match this review view.</div>
        ) : visibleNotes.map(note => (
          <button key={note.noteId} type="button" onClick={() => jumpToAction(note.actionIndex)} style={reviewRowStyle}>
            <span style={{ color: '#bfdbfe', fontWeight: 900 }}>{note.title || labelize(note.type)}</span>
            <span style={{ color: '#64748b' }}>Action {note.actionIndex + 1} / T{note.turnNumber ?? '-'}</span>
            <span>{note.body}</span>
            {note.tags.length > 0 && <span style={{ color: '#2dd4bf' }}>{note.tags.join(', ')}</span>}
            <span style={{ display: 'flex', gap: 5 }}>
              <button type="button" onClick={event => {
                event.stopPropagation();
                updateNote(note.noteId, { title: note.title ? undefined : labelize(note.type) });
              }} style={miniButtonStyle}>Toggle Title</button>
              <button type="button" onClick={event => {
                event.stopPropagation();
                deleteNote(note.noteId);
              }} style={miniButtonStyle}>Delete</button>
            </span>
          </button>
        ))}
      </div>

      <div style={panelBoxStyle}>
        <div style={sectionTitleStyle}>Bookmarks</div>
        {replay.bookmarks.length === 0 ? (
          <div style={{ color: '#475569', fontSize: 10 }}>No bookmarks yet.</div>
        ) : replay.bookmarks.map(bookmark => (
          <button key={bookmark.bookmarkId} type="button" data-testid={`replay-bookmark-${bookmark.bookmarkId}`} onClick={() => jumpToBookmark(bookmark.bookmarkId)} style={reviewRowStyle}>
            <span style={{ color: bookmark.color ?? '#fcd34d', fontWeight: 900 }}>{bookmark.label}</span>
            <span style={{ color: '#64748b' }}>{labelize(bookmark.type)} / Action {bookmark.actionIndex + 1}</span>
            <span>
              <button type="button" onClick={event => {
                event.stopPropagation();
                deleteBookmark(bookmark.bookmarkId);
              }} style={miniButtonStyle}>Delete</button>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function parseTags(value: string): string[] {
  return value.split(',').map(tag => tag.trim()).filter(Boolean);
}

function labelize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function bookmarkColor(type: ReplayBookmarkType): string {
  if (type === 'mistake' || type === 'rules') return '#facc15';
  if (type === 'combat') return '#ef4444';
  if (type === 'combo') return '#a78bfa';
  if (type === 'highlight') return '#2dd4bf';
  return '#60a5fa';
}

const panelBoxStyle = {
  border: '1px solid #1e293b',
  background: 'rgba(2,6,23,0.38)',
  borderRadius: 6,
  padding: 8,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
};

const sectionTitleStyle = {
  color: '#e2e8f0',
  fontSize: 10,
  fontWeight: 900,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
};

const inputStyle = {
  background: '#020617',
  border: '1px solid #334155',
  borderRadius: 5,
  color: '#cbd5e1',
  fontSize: 10,
  padding: '5px 7px',
};

const primaryButtonStyle = {
  border: '1px solid #14532d',
  background: '#12351f',
  color: '#bbf7d0',
  borderRadius: 5,
  padding: '6px 8px',
  fontSize: 10,
  fontWeight: 900,
  cursor: 'pointer',
};

const smallButtonStyle = {
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#94a3b8',
  borderRadius: 5,
  padding: '4px 6px',
  fontSize: 9,
  cursor: 'pointer',
};

const miniButtonStyle = {
  ...smallButtonStyle,
  padding: '2px 5px',
};

const reviewRowStyle = {
  border: '1px solid #1e293b',
  background: 'rgba(15,23,42,0.72)',
  color: '#cbd5e1',
  borderRadius: 5,
  padding: '6px 7px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 3,
  textAlign: 'left' as const,
  fontSize: 10,
  cursor: 'pointer',
};

const inlineItemStyle = {
  color: '#cbd5e1',
  fontSize: 10,
};
