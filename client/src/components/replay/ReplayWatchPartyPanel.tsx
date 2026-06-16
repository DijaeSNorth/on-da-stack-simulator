import { useEffect, useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  listenReplayWatchComments,
  writeReplayWatchComment,
} from '../../engine/replayWatchFirebase';
import {
  LOCAL_WATCH_PARTY_PREVIEW_CODE,
} from '../../engine/replayWatchParty';
import type {
  ReplayWatchComment,
  ReplayWatchPartyRole,
  ReplayWatchPartySyncMode,
} from '../../types/replay';

const ROLE_OPTIONS: ReplayWatchPartyRole[] = ['host', 'presenter', 'viewer'];
const SYNC_OPTIONS: ReplayWatchPartySyncMode[] = ['presenter_sync', 'free_scrub'];
const REACTIONS = ['nice', 'mistake', 'question', 'hype', 'rules'] as const;

function labelize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

export function ReplayWatchPartyPanel() {
  const replay = useGameStore(s => s.replay);
  const createLocalWatchParty = useGameStore(s => s.createLocalWatchParty);
  const joinLocalWatchPartyPreview = useGameStore(s => s.joinLocalWatchPartyPreview);
  const createFirebaseWatchPartyRoom = useGameStore(s => s.createFirebaseWatchPartyRoom);
  const joinFirebaseWatchPartyRoom = useGameStore(s => s.joinFirebaseWatchPartyRoom);
  const leaveWatchParty = useGameStore(s => s.leaveWatchParty);
  const setRole = useGameStore(s => s.setWatchPartyRole);
  const setSyncMode = useGameStore(s => s.setWatchPartySyncMode);
  const followPresenter = useGameStore(s => s.followPresenter);
  const pauseFollowing = useGameStore(s => s.pauseFollowing);
  const replayJumpToAction = useGameStore(s => s.replayJumpToAction);
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState('');
  const [comments, setComments] = useState<ReplayWatchComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentType, setCommentType] = useState<ReplayWatchComment['type']>('comment');

  const watch = replay?.watchParty;
  const currentActionIndex = replay?.currentActionIndex ?? -1;
  const active = Boolean(watch && watch.role !== 'none');
  const firebaseRoomActive = active
    && Boolean(watch?.watchRoomCode)
    && watch?.watchRoomCode !== LOCAL_WATCH_PARTY_PREVIEW_CODE;
  const currentActionComments = useMemo(
    () => comments.filter(comment => comment.actionIndex === currentActionIndex),
    [comments, currentActionIndex],
  );
  const displayName = watch?.viewers.find(viewer => viewer.role === watch.role)?.displayName
    ?? watch?.viewers[0]?.displayName
    ?? 'Viewer';

  useEffect(() => {
    if (!firebaseRoomActive || !watch?.watchRoomCode) {
      setComments([]);
      return undefined;
    }
    return listenReplayWatchComments(watch.watchRoomCode, setComments);
  }, [firebaseRoomActive, watch?.watchRoomCode]);

  if (!replay || !watch) return null;

  const handleCreateWatchParty = async () => {
    const code = await createFirebaseWatchPartyRoom();
    if (code) {
      setStatus(`Watch room ${code} created.`);
      return;
    }
    createLocalWatchParty();
    setStatus('Firebase unavailable. Created local preview watch party.');
  };

  const handleJoinWatchParty = async () => {
    const code = joinCode.trim();
    if (!code) {
      joinLocalWatchPartyPreview();
      setStatus('Joined local preview watch party.');
      return;
    }
    const joined = await joinFirebaseWatchPartyRoom(code);
    if (joined) {
      setStatus(`Joined watch room ${code.toUpperCase()}.`);
      return;
    }
    joinLocalWatchPartyPreview();
    setStatus('Could not join watch room. Using local preview.');
  };

  const handleAddComment = async (type: ReplayWatchComment['type'], body: string) => {
    if (!firebaseRoomActive || !watch.watchRoomCode) {
      setStatus('Create or join a Firebase watch room to comment.');
      return;
    }
    const trimmed = body.trim();
    if (!trimmed) {
      setStatus('Comment text is required.');
      return;
    }
    const saved = await writeReplayWatchComment(watch.watchRoomCode, {
      actionIndex: replay.currentActionIndex,
      displayName,
      body: trimmed,
      type,
    });
    if (!saved) {
      setStatus('Could not save comment.');
      return;
    }
    setCommentBody('');
    setStatus(`Added ${type === 'reaction' ? 'reaction' : type} at action ${replay.currentActionIndex + 1}.`);
  };

  return (
    <div data-testid="replay-watch-party-panel" style={{
      borderTop: '1px solid #1e293b',
      paddingTop: 9,
      display: 'flex',
      flexDirection: 'column',
      gap: 7,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong style={{ color: '#e2e8f0', fontSize: 11 }}>Watch Party</strong>
        <span data-testid="watch-party-role" style={{ color: active ? '#bbf7d0' : '#64748b', fontSize: 10, fontWeight: 900 }}>
          {labelize(watch.role)}
        </span>
      </div>
      <div style={{ color: '#64748b', fontSize: 9, lineHeight: 1.35 }}>
        Firebase-backed control room. Replay files stay local; only playback, metadata, viewer presence, and comments are written.
      </div>
      <div style={{ color: '#64748b', fontSize: 9, lineHeight: 1.35 }}>
        Watch party comments are temporary and may be cleaned up.
      </div>
      <input
        data-testid="watch-party-room-code-input"
        aria-label="Watch room code"
        value={joinCode}
        onChange={event => setJoinCode(event.target.value)}
        placeholder="Watch room code"
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <button type="button" data-testid="watch-party-create" onClick={handleCreateWatchParty} style={buttonStyle}>Create Watch Party</button>
        <button type="button" data-testid="watch-party-join" onClick={handleJoinWatchParty} style={buttonStyle}>Join Watch Party</button>
        <button type="button" data-testid="watch-party-follow" onClick={followPresenter} disabled={!active} style={buttonStyle}>Follow Presenter</button>
        <button type="button" data-testid="watch-party-pause-following" onClick={pauseFollowing} disabled={!active} style={buttonStyle}>Pause Following</button>
        <button type="button" data-testid="watch-party-leave" onClick={leaveWatchParty} disabled={!active} style={dangerButtonStyle}>Leave</button>
      </div>
      {status && (
        <div data-testid="watch-party-status" style={{ color: '#93c5fd', fontSize: 9 }}>
          {status}
        </div>
      )}
      {active && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <label style={labelStyle}>
              Role
              <select
                data-testid="watch-party-role-select"
                value={watch.role === 'none' ? 'viewer' : watch.role}
                onChange={event => setRole(event.target.value as ReplayWatchPartyRole)}
                style={selectStyle}
              >
                {ROLE_OPTIONS.map(role => <option key={role} value={role}>{labelize(role)}</option>)}
              </select>
            </label>
            <label style={labelStyle}>
              Sync Mode
              <select
                data-testid="watch-party-sync-mode"
                value={watch.syncMode}
                onChange={event => setSyncMode(event.target.value as ReplayWatchPartySyncMode)}
                style={selectStyle}
              >
                {SYNC_OPTIONS.map(mode => <option key={mode} value={mode}>{labelize(mode)}</option>)}
              </select>
            </label>
          </div>
          <div data-testid="watch-party-sync-summary" style={{ color: '#94a3b8', fontSize: 10, lineHeight: 1.45 }}>
            Room: {watch.watchRoomCode ?? 'local'} / Sync: {labelize(watch.syncMode)} / Presenter action: {watch.playback.actionIndex + 1}
          </div>
          <div style={{ color: '#475569', fontSize: 9 }}>
            Viewers: {watch.viewers.length ? watch.viewers.map(viewer => `${viewer.displayName} (${labelize(viewer.role)})`).join(', ') : 'None'}
          </div>
          <div style={{ borderTop: '1px solid #1e293b', paddingTop: 7, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong style={{ color: '#e2e8f0', fontSize: 10 }}>Comments & Reactions</strong>
            <div style={{ color: '#64748b', fontSize: 9 }}>
              Current action: {replay.currentActionIndex + 1}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 5 }}>
              <input
                data-testid="watch-party-comment-input"
                aria-label="Watch party comment"
                value={commentBody}
                onChange={event => setCommentBody(event.target.value)}
                placeholder="Add a comment at current action"
                style={inputStyle}
              />
              <select
                data-testid="watch-party-comment-type"
                value={commentType}
                onChange={event => setCommentType(event.target.value as ReplayWatchComment['type'])}
                style={selectStyle}
              >
                <option value="comment">Comment</option>
                <option value="question">Question</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <button
                type="button"
                data-testid="watch-party-add-comment"
                onClick={() => void handleAddComment(commentType, commentBody)}
                disabled={!firebaseRoomActive}
                style={buttonStyle}
              >
                Add Comment
              </button>
              {REACTIONS.map(reaction => (
                <button
                  key={reaction}
                  type="button"
                  data-testid={`watch-party-reaction-${reaction}`}
                  onClick={() => void handleAddComment('reaction', reaction)}
                  disabled={!firebaseRoomActive}
                  style={buttonStyle}
                >
                  {labelize(reaction)}
                </button>
              ))}
            </div>
            <div data-testid="watch-party-current-comments" style={commentListStyle}>
              <strong style={{ color: '#94a3b8' }}>This action</strong>
              {currentActionComments.length === 0 ? (
                <span style={{ color: '#475569' }}>No comments yet.</span>
              ) : currentActionComments.map(comment => (
                <button
                  key={comment.commentId}
                  type="button"
                  onClick={() => replayJumpToAction(comment.actionIndex)}
                  style={commentButtonStyle}
                >
                  {labelize(comment.type)} / {comment.displayName}: {comment.body}
                </button>
              ))}
            </div>
            <div data-testid="watch-party-all-comments" style={commentListStyle}>
              <strong style={{ color: '#94a3b8' }}>All comments</strong>
              {comments.length === 0 ? (
                <span style={{ color: '#475569' }}>No watch party comments.</span>
              ) : comments.map(comment => (
                <button
                  key={comment.commentId}
                  type="button"
                  onClick={() => replayJumpToAction(comment.actionIndex)}
                  style={commentButtonStyle}
                >
                  Action {comment.actionIndex + 1} / {labelize(comment.type)} / {comment.displayName}: {comment.body}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const buttonStyle = {
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#cbd5e1',
  borderRadius: 5,
  padding: '5px 7px',
  fontSize: 9,
  fontWeight: 900,
  cursor: 'pointer',
};

const dangerButtonStyle = {
  ...buttonStyle,
  borderColor: '#7f1d1d',
  color: '#fca5a5',
};

const inputStyle = {
  background: '#020617',
  color: '#cbd5e1',
  border: '1px solid #334155',
  borderRadius: 5,
  padding: '6px 7px',
  fontSize: 10,
};

const labelStyle = {
  color: '#64748b',
  fontSize: 9,
  fontWeight: 900,
  textTransform: 'uppercase' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
};

const selectStyle = {
  background: '#020617',
  color: '#cbd5e1',
  border: '1px solid #334155',
  borderRadius: 5,
  padding: '5px 6px',
  fontSize: 10,
};

const commentListStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  maxHeight: 120,
  overflowY: 'auto' as const,
  border: '1px solid #1e293b',
  borderRadius: 5,
  padding: 6,
  fontSize: 9,
};

const commentButtonStyle = {
  border: '1px solid #1e293b',
  background: '#020617',
  color: '#cbd5e1',
  borderRadius: 4,
  padding: '4px 5px',
  fontSize: 9,
  textAlign: 'left' as const,
  cursor: 'pointer',
};
