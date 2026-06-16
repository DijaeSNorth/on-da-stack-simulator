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
import { getFirebaseRelayHealth, getTransportMode } from '../../engine/multiplayerSync';
import { getActiveProfile } from '../../engine/profileStorage';
import { getTableDeckStatus } from '../../engine/lobbyReadiness';
import { PlayerAvatar } from '../profile/PlayerAvatar';
import type { PlayerAvatarImage } from '../../types/game';
import { ReportButton } from '../report/ReportButton';

const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

type Mode = 'idle' | 'host' | 'join';
type LobbyRole = 'player' | 'spectator';

interface MultiplayerPanelProps {
  seatCount?: number;
  seats?: { id: string; name: string; deckId?: string }[];
  onPrepareRoom?: () => void;
  onChooseDeck?: () => void;
  onExitRoom?: () => void;
}

export type SimpleDeckStatus = 'none' | 'submitted' | 'valid' | 'rejected';

export function getFriendlyDeckLabel(status: SimpleDeckStatus | undefined): string {
  if (status === 'valid') return 'Deck Checked';
  if (status === 'submitted') return 'Checking Deck';
  if (status === 'rejected') return 'Deck Rejected';
  return 'Needs Deck';
}

export function getLocalPlayerCtaLabel({
  connected,
  isHost,
  localDeckStatus,
  localReady,
  joinerCanEnterStartedGame,
  joinerNeedsGamePatch,
}: {
  connected: boolean;
  isHost: boolean;
  localDeckStatus: SimpleDeckStatus;
  localReady: boolean;
  joinerCanEnterStartedGame: boolean;
  joinerNeedsGamePatch: boolean;
}): string {
  if (!connected) return isHost ? 'Create Room' : 'Join Room';
  if (joinerCanEnterStartedGame) return 'Enter Game';
  if (joinerNeedsGamePatch) return 'Sync From Host';
  if (localDeckStatus === 'none') return 'Choose Deck';
  if (localDeckStatus === 'submitted') return 'Checking Deck...';
  if (localDeckStatus === 'rejected') return 'Fix Deck';
  if (!localReady) return 'Mark Ready';
  return isHost ? 'Ready' : 'Ready - waiting for host';
}

export function MultiplayerPanel({ seatCount: configuredSeatCount, seats: configuredSeats, onPrepareRoom, onChooseDeck, onExitRoom }: MultiplayerPanelProps) {
  const store = useGameStore();
  const { multiplayer, game } = store;

  const [mode, setMode] = useState<Mode>('idle');
  const [peerName, setPeerName] = useState('');
  const [peerColor, setPeerColor] = useState(DEFAULT_COLORS[0]);
  const [avatarInitial, setAvatarInitial] = useState<string | undefined>();
  const [avatarStyle, setAvatarStyle] = useState<'solid' | 'gradient' | 'outline' | undefined>();
  const [avatarImage, setAvatarImage] = useState<PlayerAvatarImage | undefined>();
  const [role, setRole] = useState<LobbyRole>('player');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [startVoteNow, setStartVoteNow] = useState(Date.now());

  const connected = multiplayer.status === 'host' || multiplayer.status === 'joined' || multiplayer.status === 'migrating';
  const isHost = multiplayer.status === 'host';
  const isMigrating = multiplayer.status === 'migrating';
  const transportMode = getTransportMode();
  const relayHealth = transportMode === 'firebase' ? getFirebaseRelayHealth() : null;
  const relayModeLabel = transportMode === 'firebase'
    ? `Firebase relay (room ${relayHealth?.roomCode ?? '—'})`
    : 'PeerJS/WebRTC';
  const relayStatusLabel = transportMode === 'firebase'
    ? relayHealth?.lastPollError
      ? `Recovery connection needs attention: ${relayHealth.lastPollError}`
      : 'healthy relay'
    : '';
  const connectionStatusLabel = isMigrating
    ? 'Reconnecting'
    : transportMode === 'firebase'
      ? relayHealth?.lastPollError
        ? 'Recovery available'
        : 'Connected - recovery available'
      : connected
        ? 'Connected'
        : busy
          ? 'Syncing'
          : 'Disconnected';

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
      await store.createMultiplayerRoom(peerName.trim(), peerColor, role === 'spectator' ? -1 : 0, {
        initial: avatarInitial,
        style: avatarStyle,
        image: avatarImage,
      }, role === 'spectator');
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
      await store.joinMultiplayerRoom(joinCode.trim().toUpperCase(), peerName.trim(), peerColor, role === 'spectator' ? -1 : 0, {
        initial: avatarInitial,
        style: avatarStyle,
        image: avatarImage,
      }, role === 'spectator');
    } catch (e: any) {
      setError(e.message ?? 'Failed to join room');
    } finally {
      setBusy(false);
    }
  }

  function handleLeave() {
    if (isHost && onExitRoom) {
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

  const peers = Object.values(multiplayer.peers)
    .sort((a, b) => Number(b.online) - Number(a.online) || a.seatIndex - b.seatIndex || a.name.localeCompare(b.name));
  const localPeer = multiplayer.peerId ? multiplayer.peers[multiplayer.peerId] : undefined;
  const isSpectator = localPeer?.isSpectator ?? multiplayer.isSpectator;
  const localPlayerId = localPeer?.playerId;
  const authoritativeDeckSummary = localPlayerId ? multiplayer.lobby?.submittedDecks?.[localPlayerId] : undefined;
  const authoritativeDeckStatus = authoritativeDeckSummary?.status;
  const localDeckStatus = (authoritativeDeckStatus ?? localPeer?.deck?.status ?? localPeer?.deckStatus ?? 'none') as SimpleDeckStatus;
  const localDeckReason = authoritativeDeckSummary?.errors?.join(' ') || localPeer?.deck?.errors?.join(' ') || '';
  const localReady = Boolean(localPeer?.ready);
  const canToggleReady = !isSpectator && localDeckStatus === 'valid';
  const startHandshake = multiplayer.startHandshake;
  const startVoteRequired = startHandshake?.status === 'preparing' || startHandshake?.status === 'waiting';

  useEffect(() => {
    if (!startHandshake) return;
    setStartVoteNow(Date.now());
    const timer = window.setInterval(() => setStartVoteNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startHandshake?.id, startHandshake?.deadlineAt, startHandshake?.status]);

  const canCastStartVote = Boolean(
    !isSpectator &&
    !isHost &&
    startVoteRequired &&
    localPeer &&
    !localPeer.isSpectator &&
    localPeer.seatIndex >= 0 &&
    startHandshake.requiredPeerIds?.includes(localPeer.peerId) &&
    localDeckStatus === 'valid'
  );
  const hasCastStartVote = localPeer ? startHandshake?.ackedPeerIds.includes(localPeer.peerId) : false;
  const remainingStartVotes = startHandshake?.missingPeerIds.length ?? 0;
  const startVoteSecondsRemaining = startHandshake
    ? Math.max(0, Math.ceil((startHandshake.deadlineAt - startVoteNow) / 1000))
    : 0;
  const takenSeats = new Set(
    peers
      .filter(p => p.peerId !== multiplayer.peerId && p.online && !p.isSpectator && p.seatIndex >= 0)
      .map(p => p.seatIndex),
  );
  const missingStartVoteNames = startHandshake
    ? startHandshake.missingPeerIds
      .map(peerId => multiplayer.peers[peerId]?.name ?? 'Unknown player')
      .filter(Boolean)
    : [];
  const startVoteStatusVisible = Boolean(
    startHandshake &&
    (isHost || startVoteRequired || hasCastStartVote)
  );
  const seatCount = configuredSeatCount ?? game.config.playerCount ?? game.players.length ?? 4;
  const seats = configuredSeats ?? Array.from({ length: seatCount }, (_, i) => ({
    id: game.players[i]?.id ?? `seat-${i}`,
    name: game.players[i]?.name ?? `Seat ${i + 1}`,
    deckId: game.players[i]?.deckId,
  }));
  const activeSeatIndex = localPeer && localPeer.seatIndex >= 0 ? localPeer.seatIndex : -1;
  const joinerCanEnterStartedGame = connected && !isHost && game.status === 'playing' && store.ui.screen === 'lobby';
  const joinerNeedsGamePatch = connected && !isHost && multiplayer.lobby?.status === 'playing' && game.status !== 'playing';
  const localPrimaryCtaLabel = getLocalPlayerCtaLabel({
    connected,
    isHost,
    localDeckStatus,
    localReady,
    joinerCanEnterStartedGame,
    joinerNeedsGamePatch,
  });
  const deckStatusByPeer = new Map(
    getTableDeckStatus({
      peers: multiplayer.peers,
      playerCount: seatCount,
      seats,
      gamePlayers: game.players,
      savedDecks: store.decks,
    }).map(status => [status.peer.peerId, status]),
  );

  function firstAvailableSeat(): number {
    const openIndex = seats.findIndex((_, index) => !takenSeats.has(index));
    return openIndex >= 0 ? openIndex : -1;
  }

  function switchToSpectator() {
    setError('');
    store.updateMultiplayerPresence({ isSpectator: true, seatIndex: -1 });
  }

  function switchToPlayer() {
    setError('');
    if (!isSpectator && activeSeatIndex >= 0) return;
    const preferredSeat = firstAvailableSeat();
    if (preferredSeat < 0) {
      setError('No player seats are open. Stay as a spectator until someone leaves or changes role.');
      return;
    }
    store.updateMultiplayerPresence({ isSpectator: false, seatIndex: preferredSeat });
  }

  function kickPeerFromLobby(peerId: string) {
    setError('');
    store.kickMultiplayerPeer(peerId);
  }

  function handlePrimaryPlayerAction() {
    if (joinerCanEnterStartedGame) {
      store.enterGameScreen();
      return;
    }
    if (joinerNeedsGamePatch) {
      store.requestMultiplayerGamePatch('joiner-clicked-sync');
      return;
    }
    if (localDeckStatus === 'none' || localDeckStatus === 'rejected') {
      onChooseDeck?.();
      return;
    }
    if (localDeckStatus === 'valid' && !localReady) {
      store.setMultiplayerReady(true);
    }
  }

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
              {isHost ? 'Room Code' : 'Connected Room'}
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: 6, color: isHost ? '#4ade80' : '#60a5fa', fontFamily: 'monospace' }}>
              {multiplayer.roomCode}
            </div>
            <div style={{ fontSize: 10, marginTop: 4, color: '#64748b' }}>
              {connectionStatusLabel}
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
              {copied ? 'Copied' : 'Copy Invite'}
            </button>
          )}
        </div>

        <LobbyProgressChecklist
          isHost={isHost}
          connected={connected}
          roomCreated={Boolean(multiplayer.roomCode)}
          seatAssigned={Boolean(localPeer && !localPeer.isSpectator && localPeer.seatIndex >= 0)}
          occupiedPlayers={peers.filter(p => p.online && !p.isSpectator && p.seatIndex >= 0).length}
          allDecksChecked={peers.filter(p => p.online && !p.isSpectator).every(p => {
            const summary = multiplayer.lobby?.submittedDecks?.[p.playerId];
            const status = summary?.status ?? p.deckStatus ?? p.deck?.status ?? deckStatusByPeer.get(p.peerId)?.deckStatus ?? 'none';
            return status === 'valid';
          })}
          allPlayersReady={peers.filter(p => p.online && !p.isSpectator).every(p => p.ready)}
          localDeckStatus={localDeckStatus}
          localReady={localReady}
          gameStarted={game.status === 'playing' || multiplayer.lobby?.status === 'playing'}
        />

        {/* Players in room */}
        <div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Players in Room ({peers.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {peers.length === 0 ? (
              <div style={{ color: '#334155', fontSize: 12 }}>Waiting for players to join…</div>
            ) : peers.map(p => (
              (() => {
                const deckStatus = deckStatusByPeer.get(p.peerId);
                const authoritativeSummary = multiplayer.lobby?.submittedDecks?.[p.playerId];
                const statusLabel = authoritativeSummary?.status ?? p.deckStatus ?? p.deck?.status ?? deckStatus?.deckStatus ?? 'none';
                const rejectionText = authoritativeSummary?.errors?.join(' ') || p.deck?.errors?.join(' ') || p.deck?.warnings?.join(' ') || '';
                const deckLabel = p.isSpectator
                  ? 'No deck needed'
                  : statusLabel === 'valid'
                    ? authoritativeSummary?.deckName ?? deckStatus?.deckName ?? p.deck?.name ?? 'Deck valid'
                    : statusLabel === 'submitted'
                      ? `${authoritativeSummary?.deckName ?? deckStatus?.deckName ?? p.deck?.name ?? 'Deck'} submitted`
                      : statusLabel === 'rejected'
                        ? `Rejected: ${rejectionText || 'Deck failed validation'}`
                        : 'none';
                const deckColor = p.isSpectator
                  ? '#64748b'
                  : statusLabel === 'valid'
                    ? '#86efac'
                    : statusLabel === 'rejected'
                      ? '#fca5a5'
                      : statusLabel === 'submitted'
                        ? '#93c5fd'
                        : '#fbbf24';
                return (
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
                  <div
                    title={deckLabel}
                    style={{
                      fontSize: 10,
                      color: deckColor,
                      marginTop: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.isSpectator ? deckLabel : `Deck ${statusLabel}: ${deckLabel}`}
                  </div>
                </div>
                {isHost && p.peerId === multiplayer.peerId && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#166534', color: '#4ade80' }}>HOST</span>
                )}
                {isHost && p.peerId !== multiplayer.peerId && (
                  <button
                    data-testid={`btn-kick-peer-${p.peerId}`}
                    data-help-title="Kick From Lobby"
                    data-help-body="Host-only action. Removes this player or stale entry from the lobby and frees their seat."
                    data-help-placement="top"
                    onClick={() => kickPeerFromLobby(p.peerId)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 5,
                      border: '1px solid #7f1d1d',
                      background: '#2a1014',
                      color: '#fca5a5',
                      cursor: 'pointer',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    Kick
                  </button>
                )}
              </div>
                );
              })()
            ))}
          </div>
        </div>

        {!isSpectator && (
          <button
            type="button"
            data-testid="btn-local-lobby-primary"
            onClick={handlePrimaryPlayerAction}
            disabled={localDeckStatus === 'submitted' || localReady}
            style={{
              width: '100%',
              padding: '11px 12px',
              borderRadius: 8,
              cursor: localDeckStatus === 'submitted' || localReady ? 'default' : 'pointer',
              border: `1px solid ${localReady ? '#22c55e' : localDeckStatus === 'valid' ? '#0f766e' : '#f59e0b'}`,
              background: localReady ? '#113a2b' : localDeckStatus === 'valid' ? '#042f2e' : '#332511',
              color: localReady ? '#bbf7d0' : localDeckStatus === 'valid' ? '#5eead4' : '#fde68a',
              fontSize: 13,
              fontWeight: 900,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {localPrimaryCtaLabel}
          </button>
        )}

        <details style={{
          background: '#0f1720',
          border: '1px solid #26323a',
          borderRadius: 8,
          padding: 12,
        }}>
          <summary style={{ color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
            Advanced multiplayer options
          </summary>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.5 }}>
              Transport: {relayModeLabel}{relayStatusLabel ? ` - ${relayStatusLabel}` : ''}
            </div>

        {/* Player / spectator role */}
        <div style={{
          background: '#0f1720',
          border: '1px solid #26323a',
          borderRadius: 8,
          padding: 12,
        }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Your Lobby Role
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            <button
              data-testid="btn-role-player"
              data-help-title="Player Role"
              data-help-body="Claims one lobby seat. Players need an imported and loaded deck before the host can start Commander mode."
              data-help-placement="top"
              onClick={switchToPlayer}
              style={{
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                border: `1px solid ${!isSpectator ? '#22c55e' : '#334155'}`,
                background: !isSpectator ? '#113a2b' : '#182127',
                color: !isSpectator ? '#bbf7d0' : '#94a3b8',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Player
            </button>
            <button
              data-testid="btn-role-spectator"
              data-help-title="Spectator Role"
              data-help-body="Watches the lobby or game without occupying a seat. Spectators are not counted for deck readiness or start checks."
              data-help-placement="top"
              onClick={switchToSpectator}
              style={{
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                border: `1px solid ${isSpectator ? '#a78bfa' : '#334155'}`,
                background: isSpectator ? '#312e8122' : '#182127',
                color: isSpectator ? '#ddd6fe' : '#94a3b8',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Spectator
            </button>
          </div>
          {!isSpectator ? (
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
              {activeSeatIndex >= 0
                ? `Assigned automatically to Seat ${activeSeatIndex + 1}.`
                : 'Assigning the first open seat...'} The table fills seats automatically when someone joins or switches back to Player.
            </div>
          ) : (
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
              Spectators can watch and review the log, but they do not need a deck and cannot also occupy a player seat.
            </div>
          )}
          {error && <div style={{ marginTop: 8 }}><ErrorMsg msg={error} /></div>}
          {!isSpectator && isHost && (
            <div style={{ marginTop: 10 }}>
              <button
                data-testid="btn-player-ready"
                data-help-title="Ready For Game"
                data-help-body="Marks your seat ready after automatic Commander rules validation accepts your submitted deck. The host cannot start until every seated player is ready."
                data-help-placement="top"
                onClick={() => store.setMultiplayerReady(!localReady)}
                disabled={!canToggleReady}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  cursor: canToggleReady ? 'pointer' : 'not-allowed',
                  border: `1px solid ${localReady ? '#22c55e' : canToggleReady ? '#334155' : '#475569'}`,
                  background: localReady ? '#113a2b' : '#182127',
                  color: localReady ? '#bbf7d0' : canToggleReady ? '#e2e8f0' : '#64748b',
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {localReady ? 'Ready' : localDeckStatus === 'valid' ? 'Mark Ready' : localDeckStatus === 'submitted' ? 'Checking deck...' : localDeckStatus === 'rejected' ? 'Deck needs fixing' : 'Choose Deck'}
              </button>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
                Deck status: {getFriendlyDeckLabel(localDeckStatus)}
                {localDeckStatus === 'submitted' && ' - Checking deck against Commander rules...'}
                {localDeckStatus === 'rejected' && localDeckReason ? ` - ${localDeckReason}` : ''}
              </div>
            </div>
          )}
          {!isSpectator && !isHost && (
            <div style={{ marginTop: 10, fontSize: 10, color: '#64748b', lineHeight: 1.5 }}>
              Deck status: {getFriendlyDeckLabel(localDeckStatus)}
              {localDeckStatus === 'submitted' && ' - Checking deck against Commander rules...'}
              {localDeckStatus === 'rejected' && localDeckReason ? ` - ${localDeckReason}` : ''}
              {localDeckStatus === 'valid' && ' - Deck loaded. Host controls start time; vote to begin when start phase is ready.'}
            </div>
          )}

          {startVoteStatusVisible && (
            <div
              data-testid="start-vote-status"
              style={{
                marginTop: 10,
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#cbd5e1',
                fontSize: 10,
                lineHeight: 1.45,
              }}
            >
              <div style={{ fontWeight: 800, color: '#e2e8f0', marginBottom: 3 }}>
                Start vote: {startHandshake?.ackedPeerIds.length ?? 0} / {startHandshake?.requiredPeerIds.length ?? 0}
              </div>
              {remainingStartVotes > 0 ? (
                <div>
                  Waiting on {missingStartVoteNames.join(', ') || `${remainingStartVotes} player${remainingStartVotes === 1 ? '' : 's'}`}.
                  {' '}Fallback in {startVoteSecondsRemaining}s.
                </div>
              ) : (
                <div>All start votes received. Committing game start.</div>
              )}
            </div>
          )}

          {canCastStartVote && (
            <div style={{ marginTop: 10 }}>
              <button
                data-testid="btn-vote-start"
                data-help-title="Vote Start"
                data-help-body={hasCastStartVote
                  ? `You already voted to start. Waiting on ${remainingStartVotes} remaining player${remainingStartVotes === 1 ? '' : 's'}.`
                  : 'Vote that you are ready and want to begin once all players are seated and deck-ready.'}
                data-help-placement="top"
                onClick={() => store.voteToStartMultiplayerGame()}
                disabled={hasCastStartVote}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  cursor: hasCastStartVote ? 'not-allowed' : 'pointer',
                  border: `1px solid ${hasCastStartVote ? '#14532d' : '#0f766e'}`,
                  background: hasCastStartVote ? '#14532d22' : '#042f2e',
                  color: hasCastStartVote ? '#a7f3d0' : '#5eead4',
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {hasCastStartVote ? 'Start Vote Sent' : 'Vote to Start'}
              </button>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 5 }}>
                {hasCastStartVote
                  ? `Votes received: ${startHandshake?.ackedPeerIds.length ?? 0} / ${startHandshake?.requiredPeerIds.length ?? 0}`
                  : `Waiting for votes from ${startHandshake?.missingPeerIds.length ?? 0} other player${(startHandshake?.missingPeerIds.length ?? 0) === 1 ? '' : 's'}.`}
              </div>
            </div>
          )}
        </div>
          </div>
        </details>

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

        <ReportButton
          defaultType={relayHealth?.lastPollError ? 'multiplayer_connection' : 'multiplayer_desync'}
          defaultTitle={relayHealth?.lastPollError ? 'Multiplayer connection issue' : 'Multiplayer desync report'}
          defaultComponent="MultiplayerPanel"
          defaultActionType="multiplayer"
          label="Report Multiplayer Issue"
        />

        {/* Leave */}
        <button
          data-testid="btn-leave-room"
          data-help-title="Leave Room"
          data-help-body={isHost ? 'Opens the host exit flow and attempts host migration before disconnecting.' : 'Leaves this room and frees your lobby seat.'}
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
            Start with the simple path: Host or Join, choose a deck, ready up, then start the game.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
            <button
              data-testid="btn-mode-host"
              data-help-title="Create Room"
              data-help-body="Creates a peer-to-peer Commander lobby and gives you a room code to share. You choose the seat count, then players join themselves."
              data-help-placement="bottom"
              onClick={() => setMode('host')}
              style={modeBtnStyle('#0f2d1a', '#166534', '#4ade80')}
            >
              <span style={{ display: 'block', fontSize: 10, color: '#86efac', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Host Game</span>
              <span style={{ display: 'block', fontSize: 18 }}>Create Room</span>
              <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Your name - 4 players default</span>
            </button>
            <button
              data-testid="btn-mode-join"
              data-help-title="Join Room"
              data-help-body="Join a friend's room with their code, choose Player or Spectator, and apply your own player profile."
              data-help-placement="bottom"
              onClick={() => setMode('join')}
              style={modeBtnStyle('#0f1a2d', '#1e3a5f', '#60a5fa')}
            >
              <span style={{ display: 'block', fontSize: 10, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Join Game</span>
              <span style={{ display: 'block', fontSize: 18 }}>Join Room</span>
              <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 6 }}>Room code - Player by default</span>
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
          <div style={{ fontSize: 11, color: '#64748b' }}>Player count defaults to 4. Change seats in the lobby setup above if needed.</div>
          <details>
            <summary style={{ color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>Advanced</summary>
            <div style={{ marginTop: 8 }}>
              <RolePicker role={role} onChange={setRole} />
            </div>
          </details>
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
              onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16))}
              placeholder="ABC123"
              maxLength={16}
              style={{
                ...inputStyle,
                fontFamily: 'monospace', fontSize: 18, letterSpacing: 2,
                textTransform: 'uppercase',
              }}
            />
          </div>
          <details>
            <summary style={{ color: '#94a3b8', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>Advanced</summary>
            <div style={{ marginTop: 8 }}>
              <RolePicker role={role} onChange={setRole} />
            </div>
          </details>
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

function RolePicker({ role, onChange }: {
  role: LobbyRole;
  onChange: (role: LobbyRole) => void;
}) {
  return (
    <div>
      <label style={labelStyle}>Your Role</label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button
          type="button"
          data-testid="role-picker-player"
          data-help-title="Join As Player"
          data-help-body="Occupies the first open seat automatically. Players must load a deck before the host can start Commander mode."
          data-help-placement="top"
          onClick={() => onChange('player')}
          style={roleButtonStyle(role === 'player', '#22c55e', '#113a2b', '#bbf7d0')}
        >
          Player
        </button>
        <button
          type="button"
          data-testid="role-picker-spectator"
          data-help-title="Join As Spectator"
          data-help-body="Watches without occupying a seat. Spectators can switch to Player later if a seat is open."
          data-help-placement="top"
          onClick={() => onChange('spectator')}
          style={roleButtonStyle(role === 'spectator', '#a78bfa', '#312e8122', '#ddd6fe')}
        >
          Spectator
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 5, lineHeight: 1.4 }}>
        Seats fill automatically in table order.
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
      data-help-body={label === 'Create Room' ? 'Creates the room with your selected profile and role, then prepares the table for joined players.' : 'Connects to the room code using your selected profile and role.'}
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

function LobbyProgressChecklist({
  isHost,
  connected,
  roomCreated,
  seatAssigned,
  occupiedPlayers,
  allDecksChecked,
  allPlayersReady,
  localDeckStatus,
  localReady,
  gameStarted,
}: {
  isHost: boolean;
  connected: boolean;
  roomCreated: boolean;
  seatAssigned: boolean;
  occupiedPlayers: number;
  allDecksChecked: boolean;
  allPlayersReady: boolean;
  localDeckStatus: SimpleDeckStatus;
  localReady: boolean;
  gameStarted: boolean;
}) {
  const items = isHost
    ? [
      { label: 'Room created', done: roomCreated },
      { label: 'At least 2 players', done: occupiedPlayers >= 2 },
      { label: 'All decks checked', done: allDecksChecked },
      { label: 'All players ready', done: allPlayersReady },
      { label: gameStarted ? 'Game started' : 'Start game', done: gameStarted },
    ]
    : [
      { label: 'Connected', done: connected },
      { label: 'Seat assigned', done: seatAssigned },
      { label: localDeckStatus === 'none' ? 'Choose a deck' : getFriendlyDeckLabel(localDeckStatus), done: localDeckStatus === 'valid' },
      { label: 'Ready', done: localReady },
      { label: gameStarted ? 'Game started' : 'Waiting for host', done: gameStarted },
    ];

  return (
    <div
      data-testid="lobby-progress-checklist"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: 6,
      }}
    >
      {items.map(item => (
        <div
          key={item.label}
          style={{
            border: `1px solid ${item.done ? '#14532d' : '#334155'}`,
            background: item.done ? '#113a2b' : '#111827',
            color: item.done ? '#bbf7d0' : '#94a3b8',
            borderRadius: 7,
            padding: '7px 8px',
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          <span style={{ marginRight: 6 }}>{item.done ? 'Done' : 'Next'}</span>
          {item.label}
        </div>
      ))}
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

function roleButtonStyle(active: boolean, accent: string, activeBg: string, activeColor: string): React.CSSProperties {
  return {
    padding: '7px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    border: `1px solid ${active ? accent : '#334155'}`,
    background: active ? activeBg : '#182127',
    color: active ? activeColor : '#94a3b8',
    fontSize: 12,
    fontWeight: 700,
  };
}
