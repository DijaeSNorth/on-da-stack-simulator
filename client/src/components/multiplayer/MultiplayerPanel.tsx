/**
 * MultiplayerPanel.tsx
 *
 * Rendered inside LobbyScreen as a tab.
 * Lets the host create a room and joiners enter a code.
 *
 * Two modes:
 *  HOST  — creates room, gets a 6-char code to share
 *  JOIN  — enters a code, picks an open seat
 */

import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getActiveProfile } from '../../engine/profileStorage';
import { PlayerAvatar } from '../profile/PlayerAvatar';
import type { PlayerAvatarImage } from '../../types/game';

const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

type Mode = 'idle' | 'host' | 'join';

interface MultiplayerPanelProps {
  seatCount?: number;
  seats?: { id: string; name: string }[];
  onPrepareRoom?: () => void;
  onExitRoom?: () => void;
}

export function MultiplayerPanel({ seatCount: configuredSeatCount, seats: configuredSeats, onPrepareRoom, onExitRoom }: MultiplayerPanelProps) {
  const store = useGameStore();
  const { multiplayer, game } = store;

  const [mode, setMode] = useState<Mode>('idle');
  const [peerName, setPeerName] = useState('');
  const [peerColor, setPeerColor] = useState(DEFAULT_COLORS[0]);
  const [avatarInitial, setAvatarInitial] = useState<string | undefined>();
  const [avatarStyle, setAvatarStyle] = useState<'solid' | 'gradient' | 'outline' | undefined>();
  const [avatarImage, setAvatarImage] = useState<PlayerAvatarImage | undefined>();
  const [seatIndex, setSeatIndex] = useState(0);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const connected = multiplayer.status === 'host' || multiplayer.status === 'joined' || multiplayer.status === 'migrating';
  const isHost = multiplayer.status === 'host';
  const isMigrating = multiplayer.status === 'migrating';
  const isSpectator = multiplayer.isSpectator;

  // Init listeners once
  useEffect(() => {
    store.initMultiplayerListeners();
  }, []);

  function applyActiveProfile() {
    const profile = getActiveProfile();
    if (!profile) return;
    setPeerName(profile.displayName);
    setPeerColor(profile.color);
    setAvatarInitial(profile.avatarInitial);
    setAvatarStyle(profile.avatarStyle);
    setAvatarImage(profile.avatarImage);
  }

  useEffect(() => {
    applyActiveProfile();
  }, []);

  async function handleCreateRoom() {
    setError('');
    if (!peerName.trim()) { setError('Enter your name first.'); return; }
    setBusy(true);
    try {
      onPrepareRoom?.();
      await store.createMultiplayerRoom(peerName.trim(), peerColor, seatIndex, {
        initial: avatarInitial,
        style: avatarStyle,
        image: avatarImage,
      });
    } catch (e: any) {
      setError(e.message ?? 'Failed to create room');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinRoom() {
    setError('');
    if (!peerName.trim()) { setError('Enter your name first.'); return; }
    if (!joinCode.trim()) { setError('Enter the room code.'); return; }
    setBusy(true);
    try {
      await store.joinMultiplayerRoom(joinCode.trim(), peerName.trim(), peerColor, seatIndex, {
        initial: avatarInitial,
        style: avatarStyle,
        image: avatarImage,
      });
    } catch (e: any) {
      setError(e.message ?? 'Failed to join room');
    } finally {
      setBusy(false);
    }
  }

  function handleLeave() {
    if (onExitRoom) {
      onExitRoom();
      return;
    }
    store.leaveMultiplayerRoom();
    setMode('idle');
    setJoinCode('');
    setError('');
  }

  function copyCode() {
    navigator.clipboard.writeText(multiplayer.roomCode ?? '').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const peers = Object.values(multiplayer.peers);
  const takenSeats = new Set(peers.map(p => p.seatIndex));
  const seatCount = configuredSeatCount ?? game.config.playerCount ?? game.players.length ?? 4;
  const seats = configuredSeats ?? Array.from({ length: seatCount }, (_, i) => ({
    id: game.players[i]?.id ?? `seat-${i}`,
    name: game.players[i]?.name ?? `Seat ${i + 1}`,
  }));

  // ─── Connected state ──────────────────────────────────────────────────────

  if (connected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Room code */}
        <div style={{
          background: isHost ? '#0f2d1a' : '#0f1a2d',
          border: `1px solid ${isHost ? '#166534' : '#1e3a5f'}`,
          borderRadius: 10, padding: '16px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
              {isHost ? 'Room Code (share this)' : 'Connected to Room'}
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 6, color: isHost ? '#4ade80' : '#60a5fa', fontFamily: 'monospace' }}>
              {multiplayer.roomCode}
            </div>
          </div>
          {isHost && (
            <button
              data-testid="btn-copy-room-code"
              data-help-title="Copy Room Code"
              data-help-body="Copies the six-character room code so the host can share it with players who are joining."
              data-help-placement="bottom"
              onClick={copyCode}
              style={{
                padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
                border: '1px solid #166534',
                background: copied ? '#166534' : 'transparent',
                color: copied ? '#4ade80' : '#64748b',
                fontSize: 12, fontWeight: 600,
                transition: 'all 0.15s',
              }}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          )}
        </div>

        {/* Players in room */}
        <div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Players in Room ({peers.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {peers.length === 0 ? (
              <div style={{ color: '#334155', fontSize: 12 }}>Waiting for players to join…</div>
            ) : peers.map(p => (
              <div
                key={p.peerId}
                data-testid={`peer-presence-${p.peerId}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderRadius: 8,
                  background: '#1e293b', border: '1px solid #334155',
                }}
              >
                {/* Online indicator */}
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: p.online ? '#4ade80' : '#475569',
                  flexShrink: 0,
                }} />
                {/* Color swatch */}
                <PlayerAvatar
                  name={p.name}
                  color={p.color}
                  initial={p.avatarInitial ?? p.name.slice(0, 1)}
                  styleMode={p.avatarStyle}
                  image={p.avatarImage}
                  size={28}
                />
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: '#475569', marginLeft: 8 }}>
                    {p.isSpectator ? '👁 Spectating' : `Seat ${p.seatIndex + 1}`}
                  </span>
                  {p.connectionQuality && (
                    <span style={{ fontSize: 9, color: '#64748b', marginLeft: 6 }}>
                      {p.connectionQuality.rttMs}ms
                    </span>
                  )}
                  {p.peerId === multiplayer.peerId && (
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#1e3a5f', color: '#60a5fa', marginLeft: 6 }}>YOU</span>
                  )}
                </div>
                {isHost && p.peerId === multiplayer.peerId && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#166534', color: '#4ade80' }}>HOST</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Status */}
        <div style={{
          fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: isSpectator ? '#a78bfa' : '#4ade80' }} />
          {isMigrating
            ? 'Host migration in progress - reconnecting to the strongest available player.'
            : isHost
            ? 'Hosting — game state syncs to all joined players in real time.'
            : isSpectator
              ? 'Spectating — lobby was full when you joined. You can see all game data.'
              : 'Joined — receiving live game state from host.'
          }
        </div>

        {/* Leave */}
        <button
          data-testid="btn-leave-room"
          data-help-title="Leave Room"
          data-help-body="Opens the exit flow. If you are host, the app will try to migrate host duties to the strongest connected player."
          data-help-placement="top"
          onClick={handleLeave}
          style={{
            padding: '8px 16px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid #7f1d1d', background: 'transparent',
            color: '#f87171', fontSize: 12, fontWeight: 600, alignSelf: 'flex-start',
          }}
        >
          Leave Room
        </button>
      </div>
    );
  }

  // ─── Idle / mode selection ────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Mode picker */}
      {mode === 'idle' && (
        <>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
            Start a room and share the code with your playgroup, or enter a code to join an existing game.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              data-testid="btn-mode-host"
              data-help-title="Create Room"
              data-help-body="Creates a peer-to-peer Commander lobby and gives you a room code to share. You choose the seat count, then players join themselves."
              data-help-placement="bottom"
              onClick={() => setMode('host')}
              style={modeBtnStyle('#0f2d1a', '#166534', '#4ade80')}
            >
              Create Room
            </button>
            <button
              data-testid="btn-mode-join"
              data-help-title="Join Room"
              data-help-body="Join a friend's room with their code, pick an open seat, and apply your own player profile."
              data-help-placement="bottom"
              onClick={() => setMode('join')}
              style={modeBtnStyle('#0f1a2d', '#1e3a5f', '#60a5fa')}
            >
              Join Room
            </button>
          </div>
        </>
      )}

      {/* Host form */}
      {mode === 'host' && (
        <>
          <NameColorRow
            name={peerName} setName={setPeerName}
            color={peerColor} setColor={setPeerColor}
            avatarInitial={avatarInitial}
            avatarStyle={avatarStyle}
            avatarImage={avatarImage}
            onOpenProfile={() => store.setProfileOpen(true)}
            onApplyProfile={applyActiveProfile}
          />
          <SeatPicker
            players={seats}
            selected={seatIndex}
            onSelect={setSeatIndex}
            takenSeats={new Set()}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <ActionButton
              testId="btn-create-room"
              onClick={handleCreateRoom}
              busy={busy}
              label="Create Room"
              accent="#4ade80"
            />
            <button onClick={() => setMode('idle')} style={cancelBtnStyle}>Back</button>
          </div>
          {error && <ErrorMsg msg={error} />}
        </>
      )}

      {/* Join form */}
      {mode === 'join' && (
        <>
          <NameColorRow
            name={peerName} setName={setPeerName}
            color={peerColor} setColor={setPeerColor}
            avatarInitial={avatarInitial}
            avatarStyle={avatarStyle}
            avatarImage={avatarImage}
            onOpenProfile={() => store.setProfileOpen(true)}
            onApplyProfile={applyActiveProfile}
          />
          <div>
            <label style={labelStyle}>Room Code</label>
            <input
              data-testid="input-room-code"
              type="text"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              maxLength={6}
              style={{
                ...inputStyle,
                fontFamily: 'monospace', fontSize: 20, letterSpacing: 6,
                textTransform: 'uppercase',
              }}
            />
          </div>
          <SeatPicker
            players={seats}
            selected={seatIndex}
            onSelect={setSeatIndex}
            takenSeats={takenSeats}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <ActionButton
              testId="btn-join-room"
              onClick={handleJoinRoom}
              busy={busy}
              label="Join Room"
              accent="#60a5fa"
            />
            <button onClick={() => setMode('idle')} style={cancelBtnStyle}>Back</button>
          </div>
          {error && <ErrorMsg msg={error} />}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function NameColorRow({
  name, setName, color, setColor,
  avatarInitial, avatarStyle, avatarImage,
  onOpenProfile, onApplyProfile,
}: {
  name: string; setName: (v: string) => void;
  color: string; setColor: (v: string) => void;
  avatarInitial?: string;
  avatarStyle?: 'solid' | 'gradient' | 'outline';
  avatarImage?: PlayerAvatarImage;
  onOpenProfile: () => void;
  onApplyProfile: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <PlayerAvatar
        name={name || 'Player'}
        color={color}
        initial={avatarInitial ?? name.slice(0, 1)}
        styleMode={avatarStyle}
        image={avatarImage}
        size={42}
        square
      />
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>Your Name</label>
        <input
          data-testid="input-peer-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Player name"
          maxLength={24}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>Color</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {DEFAULT_COLORS.map(c => (
            <div
              key={c}
              data-testid={`color-swatch-${c}`}
              onClick={() => setColor(c)}
              style={{
                width: 24, height: 24, borderRadius: 4, background: c,
                cursor: 'pointer',
                border: color === c ? '2px solid #fff' : '2px solid transparent',
                transition: 'border 0.1s',
              }}
            />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          type="button"
          onClick={onOpenProfile}
          data-help-title="Edit Profile"
          data-help-body="Open your saved profile to update your display name, avatar, color, or image before hosting or joining."
          data-help-placement="top"
          style={{ ...cancelBtnStyle, padding: '7px 10px', fontSize: 11 }}
        >
          Edit Profile
        </button>
        <button
          type="button"
          onClick={onApplyProfile}
          data-help-title="Apply Profile"
          data-help-body="Copies your saved profile into this room form so the table uses your latest identity."
          data-help-placement="top"
          style={{ ...cancelBtnStyle, padding: '7px 10px', fontSize: 11, color: '#93c5fd' }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

function SeatPicker({ players, selected, onSelect, takenSeats }: {
  players: { id: string; name: string }[];
  selected: number;
  onSelect: (i: number) => void;
  takenSeats: Set<number>;
}) {
  if (players.length === 0) return null;
  return (
    <div>
      <label style={labelStyle}>Your Seat</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {players.map((p, i) => {
          const taken = takenSeats.has(i);
          return (
            <button
              key={p.id}
              data-testid={`seat-btn-${i}`}
              data-help-title={taken ? 'Seat Taken' : 'Choose Seat'}
              data-help-body={taken ? 'Another player already claimed this seat.' : 'Select the seat you want to occupy when the game starts.'}
              data-help-placement="top"
              disabled={taken}
              onClick={() => !taken && onSelect(i)}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                borderRadius: 6, cursor: taken ? 'not-allowed' : 'pointer',
                border: '1px solid',
                borderColor: selected === i ? '#7c3aed' : taken ? '#1e293b' : '#334155',
                background: selected === i ? '#4c1d9522' : 'transparent',
                color: selected === i ? '#a78bfa' : taken ? '#334155' : '#64748b',
                opacity: taken ? 0.5 : 1,
              }}
            >
              {i + 1} — {p.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ActionButton({ testId, onClick, busy, label, accent }: {
  testId: string; onClick: () => void; busy: boolean; label: string; accent: string;
}) {
  return (
    <button
      data-testid={testId}
      data-help-title={label}
      data-help-body={label === 'Create Room' ? 'Creates the room with your selected profile and seat, then prepares the table for joined players.' : 'Connects to the room code using your selected profile and seat.'}
      data-help-placement="top"
      onClick={onClick}
      disabled={busy}
      style={{
        padding: '8px 18px', borderRadius: 6, cursor: busy ? 'wait' : 'pointer',
        border: `1px solid ${accent}44`,
        background: `${accent}18`, color: accent,
        fontSize: 13, fontWeight: 700,
        opacity: busy ? 0.6 : 1,
        transition: 'all 0.15s',
      }}
    >
      {busy ? '…' : label}
    </button>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div style={{
      fontSize: 12, color: '#f87171',
      background: '#450a0a', borderRadius: 6, padding: '6px 10px',
      border: '1px solid #7f1d1d',
    }}>
      {msg}
    </div>
  );
}

// ─── Shared micro-styles ──────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, color: '#64748b',
  fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: '#1e293b', border: '1px solid #334155',
  borderRadius: 6, padding: '7px 10px',
  color: '#e2e8f0', fontSize: 13, outline: 'none',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid #334155', background: 'transparent',
  color: '#64748b', fontSize: 13,
};

function modeBtnStyle(bg: string, border: string, color: string): React.CSSProperties {
  return {
    flex: 1, padding: '14px 20px', borderRadius: 8, cursor: 'pointer',
    border: `1px solid ${border}`, background: bg, color,
    fontSize: 13, fontWeight: 700, transition: 'all 0.15s',
  };
}
