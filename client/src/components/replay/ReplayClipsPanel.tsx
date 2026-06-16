import { useState } from 'react';
import { getReplayClipDuration } from '../../engine/replayEngine';
import { useGameStore } from '../../store/gameStore';

interface ReplayClipsPanelProps {
  variant?: 'side' | 'overlay';
}

export function ReplayClipsPanel({ variant = 'side' }: ReplayClipsPanelProps) {
  const replay = useGameStore(s => s.replay);
  const markStart = useGameStore(s => s.markReplayClipStart);
  const markEnd = useGameStore(s => s.markReplayClipEnd);
  const saveClip = useGameStore(s => s.saveReplayClip);
  const playClip = useGameStore(s => s.playReplayClip);
  const jumpToClip = useGameStore(s => s.jumpToReplayClip);
  const exportClipMetadata = useGameStore(s => s.exportReplayClipMetadata);
  const copyClipSummary = useGameStore(s => s.copyReplayClipSummary);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('');

  if (!replay) return null;
  const replayFile = replay.replayFile;

  const draftStart = replay.clipDraft?.startActionIndex;
  const draftEnd = replay.clipDraft?.endActionIndex;
  const rangeValid = title.trim()
    && draftStart !== undefined
    && draftEnd !== undefined
    && draftStart <= draftEnd
    && draftStart >= 0
    && draftEnd < replay.replayFile.actionLog.length;

  function handleSaveClip() {
    const saved = saveClip({
      title,
      tags: parseTags(tags),
      description,
    });
    if (!saved) {
      setStatus('Clip requires a title and a valid start/end range.');
      return;
    }
    setTitle('');
    setTags('');
    setDescription('');
    setStatus('Clip saved.');
  }

  function downloadClip(clipId: string) {
    const json = exportClipMetadata(clipId);
    if (!json) {
      setStatus('Clip metadata export failed.');
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `on-da-stack-clip-${replayFile.gameId}-${clipId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Clip metadata exported.');
  }

  async function copySummary(clipId: string) {
    const copied = await copyClipSummary(clipId);
    setStatus(copied ? 'Clip summary copied.' : 'Clipboard is not available.');
  }

  return (
    <div data-testid="replay-clips-panel" style={variant === 'overlay' ? overlayStyle : panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong style={{ color: '#e2e8f0', fontSize: 11 }}>Highlight Clips</strong>
        <span style={{ color: '#64748b', fontSize: 9 }}>{replay.clips.length} saved</span>
      </div>
      <div style={{ color: '#64748b', fontSize: 9, lineHeight: 1.35 }}>
        Clip titles are user-entered. Public/redacted clips do not auto-fill hidden card names.
      </div>
      <div style={boxStyle}>
        <div style={sectionTitleStyle}>Create Clip</div>
        <div style={{ color: '#94a3b8', fontSize: 10 }}>
          Current action: {replay.currentActionIndex + 1}
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <button type="button" data-testid="replay-clip-mark-start" onClick={markStart} style={smallButtonStyle}>Mark Clip Start</button>
          <button type="button" data-testid="replay-clip-mark-end" onClick={markEnd} style={smallButtonStyle}>Mark Clip End</button>
        </div>
        <div style={{ color: rangeValid ? '#bbf7d0' : '#fcd34d', fontSize: 9 }}>
          Range: {draftStart !== undefined ? draftStart + 1 : '-'} to {draftEnd !== undefined ? draftEnd + 1 : '-'}
        </div>
        <input
          data-testid="replay-clip-title"
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="Clip title"
          style={inputStyle}
        />
        <input
          data-testid="replay-clip-tags"
          value={tags}
          onChange={event => setTags(event.target.value)}
          placeholder="Tags, comma-separated"
          style={inputStyle}
        />
        <textarea
          value={description}
          onChange={event => setDescription(event.target.value)}
          placeholder="Optional description"
          rows={2}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
        <button
          type="button"
          data-testid="replay-clip-save"
          onClick={handleSaveClip}
          disabled={!rangeValid}
          style={primaryButtonStyle}
        >
          Save Clip
        </button>
      </div>
      {status && <div style={{ color: '#93c5fd', fontSize: 9 }}>{status}</div>}
      <div style={boxStyle}>
        <div style={sectionTitleStyle}>Saved Clips</div>
        {replay.clips.length === 0 ? (
          <div style={{ color: '#475569', fontSize: 10 }}>No highlight clips yet.</div>
        ) : replay.clips.map(clip => {
          const duration = getReplayClipDuration(replayFile, clip);
          return (
            <div key={clip.clipId} data-testid={`replay-clip-${clip.clipId}`} style={clipRowStyle}>
              <button type="button" onClick={() => jumpToClip(clip.clipId)} style={clipTitleButtonStyle}>
                {clip.title}
              </button>
              <div style={{ color: '#64748b' }}>
                Actions {clip.startActionIndex + 1}-{clip.endActionIndex + 1} / {duration.actionCount} actions / {duration.turnCount} turns
              </div>
              {clip.tags.length > 0 && <div style={{ color: '#2dd4bf' }}>{clip.tags.join(', ')}</div>}
              {clip.description && <div style={{ color: '#94a3b8' }}>{clip.description}</div>}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                <button type="button" data-testid={`replay-clip-play-${clip.clipId}`} onClick={() => playClip(clip.clipId)} style={miniButtonStyle}>Play Clip</button>
                <button type="button" data-testid={`replay-clip-jump-${clip.clipId}`} onClick={() => jumpToClip(clip.clipId)} style={miniButtonStyle}>Jump to Clip</button>
                <button type="button" data-testid={`replay-clip-export-${clip.clipId}`} onClick={() => downloadClip(clip.clipId)} style={miniButtonStyle}>Export Metadata JSON</button>
                <button type="button" data-testid={`replay-clip-copy-${clip.clipId}`} onClick={() => void copySummary(clip.clipId)} style={miniButtonStyle}>Copy Clip Summary</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function parseTags(value: string): string[] {
  return value.split(',').map(tag => tag.trim()).filter(Boolean);
}

const panelStyle = {
  borderTop: '1px solid #1e293b',
  paddingTop: 9,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
};

const overlayStyle = {
  ...panelStyle,
  position: 'absolute' as const,
  right: 16,
  bottom: 16,
  zIndex: 120,
  width: 340,
  maxHeight: '56vh',
  overflowY: 'auto' as const,
  border: '1px solid rgba(100,116,139,0.38)',
  borderRadius: 12,
  background: 'rgba(2,6,23,0.86)',
  padding: 10,
  backdropFilter: 'blur(10px)',
};

const boxStyle = {
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

const smallButtonStyle = {
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#94a3b8',
  borderRadius: 5,
  padding: '4px 6px',
  fontSize: 9,
  cursor: 'pointer',
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

const miniButtonStyle = {
  ...smallButtonStyle,
  padding: '2px 5px',
};

const clipRowStyle = {
  border: '1px solid #1e293b',
  background: 'rgba(15,23,42,0.72)',
  color: '#cbd5e1',
  borderRadius: 5,
  padding: '6px 7px',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  fontSize: 10,
};

const clipTitleButtonStyle = {
  border: 'none',
  background: 'transparent',
  color: '#bfdbfe',
  padding: 0,
  fontSize: 11,
  fontWeight: 900,
  textAlign: 'left' as const,
  cursor: 'pointer',
};
