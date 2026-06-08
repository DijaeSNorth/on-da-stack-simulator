import { useRef, useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  importDecklist,
  parseDeckFilePayload,
  prepareCommanderDeckForUse,
  saveDeck,
  loadFavoriteDeckIds,
  toggleFavoriteDeck,
  MAX_STORED_DECKS,
  MAX_FAVORITE_DECKS,
  type ImportResult,
} from '../../engine/deckImport';
import { MultiplayerPanel } from '../multiplayer/MultiplayerPanel';
import { getActiveProfile } from '../../engine/profileStorage';
import { BrandMark } from '../branding/BrandMark';
import { PlayerAvatar } from '../profile/PlayerAvatar';
import { ExitGameModal } from '../exit/ExitGameModal';
import {
  canStartCommanderTable,
  getSeatedLobbyPeers,
  getTableDeckStatus,
  resolveLocalDeckSeatTarget,
  resolveSeatPlayerId,
} from '../../engine/lobbyReadiness';
import type { Deck, PlayerAvatarImage } from '../../types/game';

interface PlayerSetup {
  id: string;
  name: string;
  color: string;
  avatarInitial?: string;
  avatarStyle?: 'solid' | 'gradient' | 'outline';
  avatarImage?: PlayerAvatarImage;
  deckId?: string;
}

type GameMode = 'solo' | 'table';
type PlayerCount = 1 | 2 | 3 | 4 | 5 | 6;

const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];
const TABLE_START_STABILIZATION_MS = 2200;

function shouldShowDeckImportPanel(mode: GameMode): boolean {
  return mode === 'table';
}

const HOUSE_RULE_PRESETS = [
  { id: 'free_mulligan', name: 'Free Mulligan', description: 'First mulligan is free (no card loss)' },
  { id: 'no_commander_tax', name: 'No Commander Tax', description: 'Commanders don\'t cost more to cast from command zone' },
  { id: 'allow_banned_cards', name: 'Allow Banned Cards', description: 'Decks may include cards normally banned in Commander' },
  { id: 'shared_pool', name: 'Rule Zero Session', description: 'Custom power level agreement in effect' },
];

export function LobbyScreen() {
  const store = useGameStore();
  const [gameMode, setGameMode] = useState<GameMode>('solo');
  const [playerCount, setPlayerCount] = useState<PlayerCount>(1);
  const [players, setPlayers] = useState<PlayerSetup[]>(() =>
    Array.from({ length: 1 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: i === 0 ? 'You' : `Open Seat ${i + 1}`,
      color: DEFAULT_COLORS[i],
    }))
  );
  const [startingLife, setStartingLife] = useState(40);
  const [activePlayerTab, setActivePlayerTab] = useState(0);
  const [deckText, setDeckText] = useState('');
  const [customLogicText, setCustomLogicText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [houseRules, setHouseRules] = useState<Set<string>>(new Set());
  const [favoriteDeckIds, setFavoriteDeckIds] = useState<string[]>(() => loadFavoriteDeckIds());
  const [exitOpen, setExitOpen] = useState(false);
  const [readinessNow, setReadinessNow] = useState(() => Date.now());
  const deckFileInputRef = useRef<HTMLInputElement | null>(null);

  function applyActiveProfileToSeat0() {
    const profile = getActiveProfile();
    if (!profile) return;
    setPlayers(prev => prev.map((p, i) =>
      i === 0 ? {
        ...p,
        name: profile.displayName,
        color: profile.color,
        avatarInitial: profile.avatarInitial,
        avatarStyle: profile.avatarStyle,
        avatarImage: profile.avatarImage,
      } : p
    ));
  }

  // Auto-populate seat 0 from active profile on mount
  useEffect(() => {
    applyActiveProfileToSeat0();
  }, []);

  useEffect(() => {
    const inTableRoom = ['host', 'joined', 'migrating'].includes(store.multiplayer.status);
    const syncedCount = store.game.config.playerCount;
    if (!inTableRoom || syncedCount < 2) return;
    const nextCount = Math.min(6, Math.max(2, syncedCount)) as PlayerCount;
    setGameMode('table');
    setPlayerCount(nextCount);
    setPlayers(prev => Array.from({ length: nextCount }, (_, index) => {
      const gamePlayer = store.game.players[index];
      const existing = prev[index];
      return {
        id: gamePlayer?.id ?? existing?.id ?? crypto.randomUUID(),
        name: gamePlayer?.name ?? existing?.name ?? `Open Seat ${index + 1}`,
        color: gamePlayer?.color ?? existing?.color ?? DEFAULT_COLORS[index],
        avatarInitial: gamePlayer?.avatarInitial ?? existing?.avatarInitial,
        avatarStyle: gamePlayer?.avatarStyle ?? existing?.avatarStyle,
        avatarImage: gamePlayer?.avatarImage ?? existing?.avatarImage,
        deckId: gamePlayer?.deckId,
      };
    }));
  }, [store.multiplayer.status, store.game.config.playerCount, store.game.players]);

  const savedDecks = store.decks;
  const localPresence = store.multiplayer.peerId ? store.multiplayer.peers[store.multiplayer.peerId] : undefined;
  const localSeatIndex = gameMode === 'table' && localPresence && localPresence.seatIndex >= 0 ? localPresence.seatIndex : 0;
  const setupPlayerIndex = gameMode === 'solo' ? activePlayerTab : localSeatIndex;
  const localDeckSeatTarget = gameMode === 'table'
    ? resolveLocalDeckSeatTarget({
      peerId: store.multiplayer.peerId,
      peers: store.multiplayer.peers,
      gamePlayers: store.game.players,
      seats: players,
    })
    : null;
  const localTablePlayerId = localDeckSeatTarget?.assigned ? localDeckSeatTarget.playerId : '';
  const tableDeckControlsEnabled = gameMode !== 'table' || Boolean(localDeckSeatTarget?.assigned);
  const activeSeat = players[setupPlayerIndex] ?? players[0];
  const activeGamePlayer = gameMode === 'table' ? store.game.players[setupPlayerIndex] : undefined;
  const activeSetupPlayer = activeSeat ? {
    ...activeSeat,
    id: activeGamePlayer?.id ?? activeSeat.id,
    deckId: gameMode === 'table' ? activeGamePlayer?.deckId : activeSeat.deckId,
  } : undefined;
  const isLocalSpectator = gameMode === 'table' && (localPresence?.isSpectator ?? store.multiplayer.isSpectator);
  const seatedPeers = getSeatedLobbyPeers(store.multiplayer.peers, playerCount);
  const occupiedSeats = new Set(seatedPeers.map(peer => peer.seatIndex));
  const isTableHost = gameMode === 'table' && store.multiplayer.status === 'host';
  const isInTableRoom = gameMode === 'table' && ['host', 'joined', 'migrating'].includes(store.multiplayer.status);
  const startHandshake = store.multiplayer.startHandshake;
  const startHandshakeActive = Boolean(startHandshake && ['preparing', 'waiting', 'committing'].includes(startHandshake.status));
  const startAckedCount = startHandshake
    ? Math.min(startHandshake.requiredPeerIds.length, startHandshake.ackedPeerIds.filter(peerId => peerId !== store.multiplayer.peerId).length)
    : 0;
  const minimumTablePlayers = 2;
  const tableDeckStatus = gameMode === 'table'
    ? getTableDeckStatus({
      peers: store.multiplayer.peers,
      playerCount,
      seats: players,
      gamePlayers: store.game.players,
      savedDecks,
    })
    : [];
  const deckStatusBySeat = new Map(tableDeckStatus.map(status => [status.peer.seatIndex, status]));
  const tableStart = gameMode === 'table'
    ? canStartCommanderTable({
      isHost: isTableHost,
      peers: store.multiplayer.peers,
      playerCount,
      seats: players,
      gamePlayers: store.game.players,
      savedDecks,
      minimumPlayers: minimumTablePlayers,
      requireLoadedGameDecks: isTableHost,
      stabilizationMs: isTableHost ? TABLE_START_STABILIZATION_MS : 0,
      now: readinessNow,
      lastGameUpdateAt: store.game.lastUpdatedAt,
    })
    : { canStart: true, occupiedCount: playerCount, missingDeckPlayers: [] as string[], waitMs: 0, waitingForSync: false };
  const missingDeckPlayers = tableStart.missingDeckPlayers;
  const tableDecksReady = gameMode !== 'table' || (
    tableStart.occupiedCount >= minimumTablePlayers &&
    missingDeckPlayers.length === 0
  );
  const canStartTable = gameMode !== 'table' || (tableStart.canStart && !startHandshakeActive);
  const tableSyncWaitSeconds = Math.max(1, Math.ceil(tableStart.waitMs / 1000));
  const importPreparation = importResult ? prepareCommanderDeckForUse(importResult.deck) : null;
  const importMultiplayerValid = Boolean(importPreparation?.valid);
  const importInvalidReason = importPreparation && !importPreparation.valid
    ? importPreparation.errors.join(' ')
    : '';
  const joinerCanEnterStartedGame = gameMode === 'table'
    && isInTableRoom
    && !isTableHost
    && store.game.status === 'playing'
    && store.ui.screen === 'lobby';
  const joinerNeedsGamePatch = gameMode === 'table'
    && isInTableRoom
    && !isTableHost
    && store.multiplayer.lobby?.status === 'playing'
    && store.game.status !== 'playing';
  const showJoinerStartFallback = joinerCanEnterStartedGame || joinerNeedsGamePatch;

  useEffect(() => {
    if (gameMode !== 'table' || !isTableHost || tableStart.waitMs <= 0) return;
    const timer = window.setInterval(() => setReadinessNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [gameMode, isTableHost, tableStart.waitMs]);

  function updateMode(mode: GameMode) {
    setGameMode(mode);
    updateCount(mode === 'solo' ? 1 : (Math.max(2, playerCount) as PlayerCount));
  }

  function updateCount(n: PlayerCount) {
    setPlayerCount(n);
    setPlayers(prev => {
      if (n > prev.length) {
        return [...prev, ...Array.from({ length: n - prev.length }, (_, i) => ({
          id: crypto.randomUUID(),
          name: `Open Seat ${prev.length + i + 1}`,
          color: DEFAULT_COLORS[prev.length + i],
        }))];
      }
      return prev.slice(0, n);
    });
    if (activePlayerTab >= n) setActivePlayerTab(0);
  }

  function updatePlayer(idx: number, update: Partial<PlayerSetup>) {
    setPlayers(prev => prev.map((p, i) => i === idx ? { ...p, ...update } : p));
  }

  async function handleDeckFileUpload(file: File | null) {
    if (!file) return;
    setImporting(true);
    setImportError('');
    setImportNotice('');
    setImportResult(null);
    try {
      const raw = await file.text();
      const fallbackName = file.name.replace(/\.[^.]+$/, '').trim() || 'Imported Deck File';
      const parsed = parseDeckFilePayload(raw, fallbackName);
      if (parsed.error) {
        setImportError(parsed.error);
        return;
      }
      if (!parsed.deckText?.trim()) {
        setImportError('That file did not contain a readable decklist.');
        return;
      }
      setDeckText(parsed.deckText);
      if (parsed.logicText?.trim()) setCustomLogicText(parsed.logicText);
      setDeckName(current => current.trim() ? current : parsed.deck?.name ?? fallbackName);
      setImportNotice([
        `Loaded ${file.name} into the text importer.`,
        ...parsed.warnings,
      ].filter(Boolean).join(' '));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Deck file upload failed.');
    } finally {
      setImporting(false);
    }
  }

  async function handleImport() {
    if (!deckText.trim()) return;
    setImporting(true);
    setImportError('');
    setImportNotice('');
    setImportResult(null);
    try {
      const importOptions = { allowBannedCards: houseRules.has('allow_banned_cards') };
      const result = await importDecklist(deckText, deckName || 'Imported Deck', undefined, undefined, customLogicText, importOptions);
      const prepared = prepareCommanderDeckForUse(result.deck);
      setImportResult({
        ...result,
        deck: prepared.deck,
        errors: [...result.errors, ...prepared.errors],
        warnings: [...result.warnings, ...prepared.warnings],
        cardCount: prepared.totalCommanderCount,
        commanders: prepared.deck.commanders,
      });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Deck import failed.');
    } finally {
      setImporting(false);
    }
  }

  async function assignDeckToPlayer(deck: Deck) {
    const targetPlayerId = gameMode === 'table' ? localTablePlayerId : activeSetupPlayer?.id ?? '';
    if (!targetPlayerId || isLocalSpectator) {
      setImportError(gameMode === 'table'
        ? localDeckSeatTarget?.reason === 'spectator'
          ? 'Switch to Player before assigning a deck.'
          : 'Waiting for your assigned lobby seat before assigning a deck.'
        : 'Choose a player before assigning a deck.');
      return;
    }
    const prepared = prepareCommanderDeckForUse(deck);
    if (gameMode === 'table' && !prepared.valid) {
      setImportError(`Deck is not multiplayer-valid: ${prepared.errors.join(' ')}`);
      return;
    }
    updatePlayer(setupPlayerIndex, { deckId: prepared.deck.id });
    await store.loadDeck(targetPlayerId, prepared.deck);
    setImportResult(null);
    setImportError('');
    setImportNotice('');
    setDeckText('');
    setCustomLogicText('');
  }

  function toggleDeckForPlayer(deck: Deck) {
    const targetPlayerId = gameMode === 'table' ? localTablePlayerId : activeSetupPlayer?.id ?? '';
    if (!targetPlayerId || isLocalSpectator) {
      setImportError(gameMode === 'table'
        ? localDeckSeatTarget?.reason === 'spectator'
          ? 'Switch to Player before assigning a deck.'
          : 'Waiting for your assigned lobby seat before assigning a deck.'
        : 'Choose a player before assigning a deck.');
      return;
    }
    const assigned = activeSetupPlayer?.deckId === deck.id;
    if (assigned) {
      updatePlayer(setupPlayerIndex, { deckId: undefined });
      store.clearLoadedDeck(targetPlayerId);
      setImportError('');
      return;
    }
    void assignDeckToPlayer(deck);
  }

  async function saveDeckAndAssign() {
    if (!importResult) return;
    const prepared = prepareCommanderDeckForUse(importResult.deck);
    if (gameMode === 'table' && !prepared.valid) {
      setImportError(`Deck is not multiplayer-valid: ${prepared.errors.join(' ')}`);
      return;
    }
    saveDeck(prepared.deck);
    store.loadDecks();
    setFavoriteDeckIds(loadFavoriteDeckIds());
    await assignDeckToPlayer(prepared.deck);
  }

  function getGameConfig(configPlayerCount: PlayerCount = playerCount, votePlayers: { id: string }[] = players) {
    const selectedHouseRules = HOUSE_RULE_PRESETS
      .filter(rule => houseRules.has(rule.id))
      .map(rule => ({
        ...rule,
        votes: Object.fromEntries(votePlayers.map(player => [player.id, true])),
        approved: true,
        appliesTo: 'all' as const,
      }));

    return {
      playerCount: configPlayerCount,
      format: 'commander' as const,
      startingLife: gameMode === 'table' ? 40 : startingLife,
      useCommanderDamage: true,
      useInfect: true,
      startingHandSize: 7,
      maxMulligans: 6,
      commanderTaxEnabled: !houseRules.has('no_commander_tax'),
      houseRules: selectedHouseRules,
      timerEnabled: false,
    };
  }

  function getPlayersForGame() {
    if (gameMode !== 'table') {
      return players.map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        avatarInitial: p.avatarInitial,
        avatarStyle: p.avatarStyle,
        avatarImage: p.avatarImage,
      }));
    }

    const peerBySeat = new Map(seatedPeers.map(peer => [peer.seatIndex, peer]));
    return [...peerBySeat.entries()]
      .sort(([a], [b]) => a - b)
      .map(([seatIndex, peer]) => {
        const seat = players[seatIndex] ?? players[0];
        const playerId = resolveSeatPlayerId(seatIndex, store.game.players, players);
        return {
          id: playerId || seat.id,
          name: peer.name,
          color: peer.color,
          avatarInitial: peer.avatarInitial ?? seat.avatarInitial,
          avatarStyle: peer.avatarStyle ?? seat.avatarStyle,
          avatarImage: peer.avatarImage ?? seat.avatarImage,
        };
      });
  }

  function prepareTableRoomState() {
    const seatPlayers = players.slice(0, playerCount).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      avatarInitial: p.avatarInitial,
      avatarStyle: p.avatarStyle,
      avatarImage: p.avatarImage,
    }));
    const config = getGameConfig(playerCount, seatPlayers);
    store.initGame(config, seatPlayers);
  }

  function startGame(deckOverrides: Record<string, Deck> = {}) {
    if (gameMode === 'table' && !canStartTable) return;
    const gamePlayers = getPlayersForGame();
    const actualPlayerCount = (gameMode === 'table' ? gamePlayers.length : playerCount) as PlayerCount;
    const config = getGameConfig(actualPlayerCount, gamePlayers);
    if (gameMode === 'table') {
      store.prepareLoadedTableGame(config, gamePlayers);
    } else {
      store.initGame(config, gamePlayers);
    }

    // Load saved decks for players who have them
    (async () => {
      const setupPlayers = gameMode === 'table'
        ? [...occupiedSeats]
          .sort((a, b) => a - b)
          .map((index): PlayerSetup | null => {
            const seat = players[index];
            const latestGame = useGameStore.getState().game;
            if (!seat) return null;
            return {
              ...seat,
              id: resolveSeatPlayerId(index, latestGame.players, players),
              deckId: latestGame.players[index]?.deckId ?? seat.deckId,
            };
          })
          .filter((player): player is PlayerSetup => player !== null && Boolean(player.id))
        : players;
      for (const setupPlayer of setupPlayers) {
        const override = deckOverrides[setupPlayer.id];
        if (override) {
          await store.loadDeck(setupPlayer.id, override);
        } else if (setupPlayer.deckId) {
          const deck = savedDecks.find(d => d.id === setupPlayer.deckId);
          if (deck) {
            await store.loadDeck(setupPlayer.id, deck);
          }
        }
      }
      if (gameMode === 'table') {
        useGameStore.getState().beginMultiplayerGameStart();
      } else {
        store.startGame();
      }
      if (gameMode === 'solo') {
        store.setDeckBuilderOpen(true);
        if (store.ui.rightPanelOpen) store.toggleRightPanel();
      }
    })();
  }

  function toggleFavorite(deckId: string) {
    setFavoriteDeckIds(toggleFavoriteDeck(deckId));
    store.loadDecks();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 20000,
      background: 'linear-gradient(135deg, #080d11 0%, #10161a 54%, #0b0f12 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'auto',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 860,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        margin: 'auto',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <BrandMark size={36} />
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#f1f5f9', margin: 0, letterSpacing: 0 }}>
              On-Da-Stack
            </h1>
          </div>
          <div style={{ fontSize: 12, color: '#8aa0ad' }}>
            Commander sandbox | judge assistant | replay review
          </div>
        </div>

        {/* Main layout */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Left: Game setup */}
          <div style={{
            flex: '1 1 340px',
            background: '#10161a',
            border: '1px solid #26323a',
            borderRadius: 10,
            padding: 16,
          }}>
            <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, fontWeight: 700 }}>
              {gameMode === 'solo' ? 'Solo Deck Lab' : 'Game Setup'}
            </div>

            {/* Game mode */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                Mode
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <button
                  data-testid="btn-mode-solo"
                  data-help-title="Solo Lab"
                  data-help-body="Starts a one-player practice table for deck building, card logic testing, dummy opponents, and replay review."
                  data-help-placement="bottom"
                  onClick={() => updateMode('solo')}
                  style={{
                    padding: '8px 10px',
                    background: gameMode === 'solo' ? '#113a2b' : '#182127',
                    color: gameMode === 'solo' ? '#bbf7d0' : '#94a3b8',
                    border: `1px solid ${gameMode === 'solo' ? '#22c55e' : '#34414a'}`,
                    borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  }}
                >
                  Solo Lab
                </button>
                <button
                  data-testid="btn-mode-table"
                  data-help-title="Commander Table"
                  data-help-body="Sets up a 2-6 player Commander game. Players join, set their own profile, load a deck, ready up, then the host starts when everyone is validated."
                  data-help-placement="bottom"
                  onClick={() => updateMode('table')}
                  style={{
                    padding: '8px 10px',
                    background: gameMode === 'table' ? '#123642' : '#182127',
                    color: gameMode === 'table' ? '#cffafe' : '#94a3b8',
                    border: `1px solid ${gameMode === 'table' ? '#22d3ee' : '#34414a'}`,
                    borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  }}
                >
                  Commander Table
                </button>
              </div>
            </div>

            {/* Player count */}
            {gameMode === 'table' && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                  Players
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([2, 3, 4, 5, 6] as const).map(n => (
                    <button
                      key={n}
                      data-testid={`btn-player-count-${n}`}
                      data-help-title={`${n} Player Table`}
                      data-help-body={`Creates ${n} lobby seats for Commander. The host chooses seat count, but each player controls their own profile and deck.`}
                      data-help-placement="bottom"
                      onClick={() => updateCount(n)}
                      style={{
                        flex: 1, padding: '6px 0',
                        background: playerCount === n ? '#1d4ed8' : '#1e293b',
                        color: playerCount === n ? '#fff' : '#94a3b8',
                        border: `1px solid ${playerCount === n ? '#3b82f6' : '#334155'}`,
                        borderRadius: 5, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                      }}
                    >{n}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Starting life */}
            {gameMode === 'solo' ? (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                  Test Life: {startingLife}
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[20, 30, 40].map(n => (
                    <button
                      key={n}
                      onClick={() => setStartingLife(n)}
                      style={{
                        flex: 1, padding: '5px 0',
                        background: startingLife === n ? '#1d4ed8' : '#1e293b',
                        color: startingLife === n ? '#fff' : '#94a3b8',
                        border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                      }}
                    >{n}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{
                marginBottom: 14,
                padding: '7px 9px',
                borderRadius: 6,
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.2)',
              }}>
                <div style={{ fontSize: 11, color: '#bbf7d0', fontWeight: 700 }}>
                  Commander Life: 40
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  Life can be adjusted once the game starts.
                </div>
              </div>
            )}

            {/* Player setup tabs */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                {gameMode === 'solo' ? 'Solo Player' : 'Lobby Seats'}
              </label>
              {gameMode === 'solo' ? (
                <>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                    {players.map((p, i) => (
                      <button
                        key={p.id}
                        onClick={() => setActivePlayerTab(i)}
                        style={{
                          padding: '4px 8px',
                          background: activePlayerTab === i ? `${p.color}33` : '#1e293b',
                          border: `1px solid ${activePlayerTab === i ? p.color : '#334155'}`,
                          borderRadius: 4, cursor: 'pointer',
                          fontSize: 10, color: activePlayerTab === i ? p.color : '#64748b',
                          fontWeight: 600,
                        }}
                      >P{i + 1}</button>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <PlayerAvatar
                      name={players[activePlayerTab]?.name ?? 'Player'}
                      color={players[activePlayerTab]?.color || '#3b82f6'}
                      initial={players[activePlayerTab]?.avatarInitial ?? players[activePlayerTab]?.name?.slice(0, 1)}
                      styleMode={players[activePlayerTab]?.avatarStyle}
                      image={players[activePlayerTab]?.avatarImage}
                      size={34}
                      square
                    />
                    <input
                      type="color"
                      value={players[activePlayerTab]?.color || '#3b82f6'}
                      onChange={e => updatePlayer(activePlayerTab, { color: e.target.value })}
                      style={{ width: 32, height: 32, borderRadius: 4, border: 'none', cursor: 'pointer', background: 'none', padding: 0 }}
                    />
                    <input
                      value={players[activePlayerTab]?.name || ''}
                      onChange={e => updatePlayer(activePlayerTab, { name: e.target.value })}
                      placeholder={`Player ${activePlayerTab + 1} name`}
                      data-testid={`input-player-name-${activePlayerTab}`}
                      style={{
                        flex: 1,
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: 5,
                        padding: '6px 10px',
                        fontSize: 12, color: '#e2e8f0', outline: 'none',
                      }}
                    />
                    <button onClick={() => store.setProfileOpen(true)} style={smallBtnStyle}>
                      <span data-help-title="Edit Profile" data-help-body="Open your player profile to change your name, avatar, color, or card-art identity before loading into the table." data-help-placement="bottom">
                      Profile
                      </span>
                    </button>
                    <button onClick={applyActiveProfileToSeat0} style={smallBtnStyle}>
                      <span data-help-title="Apply Profile" data-help-body="Copies your saved profile onto the active solo player slot so the practice table uses your current identity." data-help-placement="bottom">
                      Apply
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {players.slice(0, playerCount).map((seat, index) => {
                    const peer = seatedPeers.find(p => p.seatIndex === index);
                    const deckStatus = deckStatusBySeat.get(index);
                    const occupied = Boolean(peer);
                    const statusLabel = deckStatus?.deckStatus ?? 'none';
                    const rejectionText = peer?.deck?.errors?.join(' ') || peer?.deck?.warnings?.join(' ') || '';
                    const deckLine = statusLabel === 'valid'
                      ? deckStatus?.deckName ?? 'Deck valid'
                      : statusLabel === 'submitted'
                        ? `${deckStatus?.deckName ?? 'Deck'} submitted`
                        : statusLabel === 'rejected'
                          ? `Rejected: ${rejectionText || 'Deck failed validation'}`
                          : 'Deck: none';
                    const deckLineColor = statusLabel === 'valid'
                      ? '#86efac'
                      : statusLabel === 'rejected'
                        ? '#fca5a5'
                        : statusLabel === 'submitted'
                          ? '#93c5fd'
                          : '#fbbf24';
                    return (
                      <div
                        key={seat.id}
                        data-testid={`lobby-seat-${index}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 8px',
                          borderRadius: 6,
                          background: occupied ? `${peer!.color}18` : 'rgba(255,255,255,0.025)',
                          border: `1px solid ${occupied ? peer!.color + '55' : '#26323a'}`,
                        }}
                      >
                        <PlayerAvatar
                          name={peer?.name ?? `Seat ${index + 1}`}
                          color={peer?.color ?? seat.color}
                          initial={peer?.avatarInitial ?? `${index + 1}`}
                          styleMode={peer?.avatarStyle}
                          image={peer?.avatarImage}
                          size={28}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: occupied ? '#e2e8f0' : '#64748b' }}>
                            Seat {index + 1}: {occupied ? peer!.name : 'Waiting for player'}
                          </div>
                          <div style={{ fontSize: 9, color: '#475569' }}>
                            {occupied ? (peer!.peerId === store.multiplayer.peerId ? 'You' : 'Joined') : 'Open seat'}
                          </div>
                          {occupied && (
                            <div style={{
                              marginTop: 3,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 5,
                              minWidth: 0,
                            }}>
                              <span style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background: statusLabel === 'valid' ? '#22c55e' : statusLabel === 'rejected' ? '#ef4444' : '#f59e0b',
                                flexShrink: 0,
                              }} />
                              <span
                                title={deckLine}
                                style={{
                                  fontSize: 9,
                                  color: deckLineColor,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {statusLabel}: {deckLine}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button data-help-title="Edit Profile" data-help-body="Open your player profile. The host does not set other players' names; each player manages their own identity." data-help-placement="bottom" onClick={() => store.setProfileOpen(true)} style={smallBtnStyle}>Edit Profile</button>
                    <button data-help-title="Apply Profile" data-help-body="Applies your saved profile to your lobby seat before the game starts." data-help-placement="bottom" onClick={applyActiveProfileToSeat0} style={smallBtnStyle}>Apply Profile</button>
                  </div>
                </div>
              )}
            </div>

            {/* House Rules */}
            {gameMode === 'table' && (
            <div>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                Rule Zero Options
              </label>
              {HOUSE_RULE_PRESETS.map(rule => (
                <label key={rule.id} style={{
                  display: 'flex', gap: 8, alignItems: 'flex-start',
                  padding: '5px 0', cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={houseRules.has(rule.id)}
                    onChange={() => {
                      setHouseRules(prev => {
                        const next = new Set(prev);
                        if (next.has(rule.id)) next.delete(rule.id);
                        else next.add(rule.id);
                        return next;
                      });
                    }}
                    style={{ marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontSize: 11, color: '#e2e8f0' }}>{rule.name}</div>
                    <div style={{ fontSize: 10, color: '#64748b' }}>{rule.description}</div>
                  </div>
                </label>
              ))}
            </div>
            )}
          </div>

          {shouldShowDeckImportPanel(gameMode) && (
          /* Right: Deck import */
          <div style={{
            flex: '1 1 340px',
            background: '#10161a',
            border: '1px solid #26323a',
            borderRadius: 10,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
              Deck Selection - {gameMode === 'solo' ? 'Solo Player' : (localDeckSeatTarget?.label ?? `Seat ${setupPlayerIndex + 1}`)}
            </div>

            {gameMode === 'table' && (
              <div
                data-testid="table-deck-seat-status"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}
              >
                {[
                  { label: 'Joined', active: isInTableRoom },
                  { label: localDeckSeatTarget?.assigned ? `Seat ${localDeckSeatTarget.seatIndex + 1}` : 'Seat Pending', active: Boolean(localDeckSeatTarget?.assigned) },
                  { label: activeSetupPlayer?.deckId ? 'Deck Loaded' : 'Choose Deck', active: Boolean(activeSetupPlayer?.deckId) },
                ].map(step => (
                  <div
                    key={step.label}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: `1px solid ${step.active ? '#0e7490' : '#334155'}`,
                      background: step.active ? 'rgba(14,116,144,0.16)' : '#111827',
                      color: step.active ? '#a5f3fc' : '#64748b',
                      fontSize: 10,
                      fontWeight: 800,
                      textAlign: 'center',
                      textTransform: 'uppercase',
                    }}
                  >
                    {step.label}
                  </div>
                ))}
              </div>
            )}

            {gameMode === 'table' && !tableDeckControlsEnabled && !isLocalSpectator && (
              <div style={{
                fontSize: 10,
                color: '#bfdbfe',
                background: 'rgba(30,58,138,0.16)',
                border: '1px solid #1e3a8a',
                borderRadius: 5,
                padding: '6px 8px',
              }}>
                {localDeckSeatTarget?.label ?? 'Connecting to room...'} Deck selection unlocks as soon as your seat is synced.
              </div>
            )}

            {isLocalSpectator && (
              <div style={{
                fontSize: 10,
                color: '#c4b5fd',
                background: 'rgba(76,29,149,0.18)',
                border: '1px solid #4c1d95',
                borderRadius: 5,
                padding: '6px 8px',
              }}>
                You are spectating. Switch to Player in the multiplayer panel before assigning a deck.
              </div>
            )}

            {/* Saved decks */}
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>
                Saved Decks ({savedDecks.length}/{MAX_STORED_DECKS})
                <span style={{ color: '#334155' }}> | Favorites {favoriteDeckIds.length}/{MAX_FAVORITE_DECKS}</span>
              </div>
              {savedDecks.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {savedDecks.map(deck => {
                    const assigned = activeSetupPlayer?.deckId === deck.id;
                    const favorite = favoriteDeckIds.includes(deck.id);
                    const favoriteLimitReached = !favorite && favoriteDeckIds.length >= MAX_FAVORITE_DECKS;
                    return (
                      <div
                        key={deck.id}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '6px 8px',
                          background: assigned ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${assigned ? '#3b82f6' : '#1e293b'}`,
                          borderRadius: 5,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 11, color: '#e2e8f0', fontWeight: 600 }}>{deck.name}</div>
                          <div style={{ fontSize: 9, color: '#64748b' }}>
                            {deck.cards.reduce((s, c) => s + c.count, 0)} cards
                            {deck.commanders.length > 0 && ` · ${deck.commanders[0]}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <button
                            type="button"
                            title={favorite ? 'Remove from favorites' : favoriteLimitReached ? 'Favorite limit reached' : 'Mark as favorite'}
                            onClick={() => toggleFavorite(deck.id)}
                            disabled={favoriteLimitReached}
                            style={{
                              fontSize: 9,
                              padding: '3px 6px',
                              background: favorite ? '#713f12' : '#1e293b',
                              color: favorite ? '#fde68a' : favoriteLimitReached ? '#334155' : '#94a3b8',
                              border: 'none',
                              borderRadius: 3,
                              cursor: favoriteLimitReached ? 'not-allowed' : 'pointer',
                              fontWeight: 700,
                            }}
                          >Fav</button>
                          <button
                            type="button"
                            aria-pressed={assigned}
                            title={assigned ? 'Click to stop using this deck for your lobby seat' : 'Use this deck for your lobby seat'}
                            onClick={() => toggleDeckForPlayer(deck)}
                            disabled={isLocalSpectator || !tableDeckControlsEnabled}
                            style={{
                              fontSize: 9, padding: '3px 8px',
                              background: assigned ? '#1d4ed8' : '#1e293b',
                              color: (isLocalSpectator || !tableDeckControlsEnabled) ? '#334155' : assigned ? '#fff' : '#94a3b8',
                              border: 'none', borderRadius: 3, cursor: (isLocalSpectator || !tableDeckControlsEnabled) ? 'not-allowed' : 'pointer',
                            }}
                          >{assigned ? 'Using' : 'Use'}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 10, color: '#475569', padding: '6px 0' }}>
                  No saved decks yet.
                </div>
              )}
            </div>

            {/* Import new deck */}
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>
                Import New Deck
                <span style={{ color: '#334155' }}> · Upload TXT, DEK, DEC, CSV, JSON, COD</span>
              </div>
              <input
                placeholder="Deck name"
                value={deckName}
                onChange={e => setDeckName(e.target.value)}
                style={{
                  width: '100%', marginBottom: 6, boxSizing: 'border-box',
                  background: '#1e293b', border: '1px solid #334155',
                  borderRadius: 5, padding: '6px 10px',
                  fontSize: 11, color: '#e2e8f0', outline: 'none',
                }}
              />
              <input
                ref={deckFileInputRef}
                type="file"
                accept=".txt,.dek,.dec,.csv,.json,.cod,.dck,text/plain,text/csv,application/json,application/xml,text/xml"
                onChange={event => {
                  void handleDeckFileUpload(event.target.files?.[0] ?? null);
                  event.currentTarget.value = '';
                }}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                data-testid="btn-upload-deck-file"
                data-help-title="Upload Deck File"
                data-help-body="Reads common deck export files and converts them into editable text before validation. Nothing is fetched from deck websites."
                data-help-example="Works well with plain text, MTGO .dek/.dec, CSV, On-Da-Stack JSON, and Cockatrice .cod exports."
                data-help-placement="top"
                onClick={() => deckFileInputRef.current?.click()}
                disabled={importing || !tableDeckControlsEnabled}
                style={{
                  width: '100%',
                  marginBottom: 6,
                  padding: '7px 10px',
                  background: '#1e293b',
                  color: (importing || !tableDeckControlsEnabled) ? '#475569' : '#bfdbfe',
                  border: '1px solid #334155',
                  borderRadius: 5,
                  cursor: importing ? 'wait' : !tableDeckControlsEnabled ? 'not-allowed' : 'pointer',
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                Upload Deck File
              </button>
              <textarea
                placeholder="Paste your decklist here or upload a deck file...&#10;&#10;Example:&#10;Commander&#10;1 Atraxa, Praetors' Voice&#10;&#10;Deck&#10;1 Sol Ring&#10;1 Command Tower&#10;..."
                value={deckText}
                onChange={e => {
                  setDeckText(e.target.value);
                  setImportNotice('');
                }}
                data-testid="input-decklist"
                rows={8}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#1e293b', border: '1px solid #334155',
                  borderRadius: 5, padding: '8px 10px',
                  fontSize: 10, color: '#e2e8f0', outline: 'none',
                  resize: 'vertical', fontFamily: 'monospace',
                  lineHeight: 1.5,
                }}
              />
              {importNotice && (
                <div data-testid="deck-import-file-notice" style={{
                  marginTop: 6,
                  fontSize: 10,
                  color: '#bfdbfe',
                  background: 'rgba(30,58,95,0.22)',
                  border: '1px solid #1e3a5f',
                  borderRadius: 5,
                  padding: '6px 8px',
                  lineHeight: 1.35,
                }}>
                  {importNotice}
                </div>
              )}
              <details style={{ marginTop: 8 }}>
                <summary style={{
                  fontSize: 10,
                  color: '#64748b',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}>
                  Custom logic and card notes
                </summary>
                <textarea
                  placeholder={'Optional JSON or lines like:\nnote: Card Name = table reminder\ntrigger: Card Name | attacks | create a Treasure\nreplacement: Card Name | would die | exile it instead'}
                  value={customLogicText}
                  onChange={e => setCustomLogicText(e.target.value)}
                  data-testid="input-custom-logic"
                  rows={4}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 6,
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: 5,
                    padding: '7px 9px',
                    fontSize: 10,
                    color: '#e2e8f0',
                    outline: 'none',
                    resize: 'vertical',
                    fontFamily: 'monospace',
                    lineHeight: 1.45,
                  }}
                />
              </details>
              <button
                data-testid="btn-import-deck"
                data-help-title="Import And Validate"
                data-help-body="Validates the pasted or uploaded deck text, pulls card information where possible, saves it to a deck slot, and reports warnings without blocking practice games."
                data-help-example="Commander mode needs loaded decks before starting; Solo mode can start without one."
                data-help-placement="top"
                onClick={handleImport}
                disabled={importing || !deckText.trim() || !tableDeckControlsEnabled}
                style={{
                  width: '100%', marginTop: 8, padding: '8px 0',
                  background: (importing || !tableDeckControlsEnabled) ? '#374151' : '#1d4ed8',
                  color: (importing || !tableDeckControlsEnabled) ? '#6b7280' : '#fff',
                  border: 'none', borderRadius: 5, cursor: importing ? 'wait' : !tableDeckControlsEnabled ? 'not-allowed' : 'pointer',
                  fontSize: 11, fontWeight: 700,
                }}
              >
                {importing ? 'Importing...' : 'Import & Validate'}
              </button>
              {importError && (
                <div data-testid="deck-import-error" style={{
                  marginTop: 6,
                  fontSize: 10,
                  color: '#fca5a5',
                  background: 'rgba(127,29,29,0.22)',
                  border: '1px solid #7f1d1d',
                  borderRadius: 5,
                  padding: '6px 8px',
                  lineHeight: 1.35,
                }}>
                  {importError}
                </div>
              )}
            </div>

            {/* Import result */}
            {importResult && (
              <div style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid #1e293b',
                borderRadius: 6,
                padding: 10,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>
                  {importResult.deck.name} — {importPreparation?.totalCommanderCount ?? importResult.deck.cards.reduce((s, c) => s + c.count, 0)} cards
                </div>

                <div style={{
                  fontSize: 10,
                  color: importMultiplayerValid ? '#86efac' : '#fca5a5',
                  background: importMultiplayerValid ? 'rgba(20,83,45,0.35)' : 'rgba(127,29,29,0.24)',
                  border: `1px solid ${importMultiplayerValid ? '#166534' : '#7f1d1d'}`,
                  borderRadius: 4,
                  padding: '4px 6px',
                  marginBottom: 6,
                  fontWeight: 700,
                }}>
                  {importMultiplayerValid ? 'Valid for multiplayer' : 'Not valid for multiplayer'}
                </div>

                {importResult.deck.commanders.length > 0 && (
                  <div style={{ fontSize: 10, color: '#a78bfa', marginBottom: 4 }}>
                    Commander{importResult.deck.commanders.length > 1 ? 's' : ''}: {importResult.deck.commanders.join(', ')}
                  </div>
                )}

                {importResult.deck.logicFile && (
                  <div style={{
                    fontSize: 10,
                    color: '#93c5fd',
                    background: 'rgba(30,58,95,0.35)',
                    border: '1px solid #1e3a5f',
                    borderRadius: 4,
                    padding: '4px 6px',
                    marginBottom: 6,
                  }}>
                    Custom logic: {[
                      importResult.deck.logicFile.customCards.length ? `${importResult.deck.logicFile.customCards.length} cards` : '',
                      importResult.deck.logicFile.rules.length ? `${importResult.deck.logicFile.rules.length} rules` : '',
                      importResult.deck.logicFile.triggers.length ? `${importResult.deck.logicFile.triggers.length} triggers` : '',
                      importResult.deck.logicFile.replacementEffects.length ? `${importResult.deck.logicFile.replacementEffects.length} replacements` : '',
                      Object.keys(importResult.deck.logicFile.cardNotes).length ? `${Object.keys(importResult.deck.logicFile.cardNotes).length} notes` : '',
                    ].filter(Boolean).join(' / ')}
                  </div>
                )}

                {importResult.errors.map((e, i) => (
                  <div key={i} style={{ fontSize: 10, color: '#f87171' }}>✗ {e}</div>
                ))}
                {importResult.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 10, color: '#fcd34d' }}>⚠ {w}</div>
                ))}

                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button
                    data-testid="btn-use-deck"
                    data-help-title="Save And Use Deck"
                    data-help-body="Stores the validated deck in one of your saved slots and assigns it to the current player or lobby seat."
                    data-help-placement="top"
                    onClick={saveDeckAndAssign}
                    disabled={isLocalSpectator || !tableDeckControlsEnabled || (gameMode === 'table' && !importMultiplayerValid)}
                    style={{
                      flex: 1, padding: '6px 0',
                      background: (isLocalSpectator || !tableDeckControlsEnabled || (gameMode === 'table' && !importMultiplayerValid)) ? '#182127' : '#14532d',
                      color: (isLocalSpectator || !tableDeckControlsEnabled || (gameMode === 'table' && !importMultiplayerValid)) ? '#475569' : '#86efac',
                      border: 'none',
                      borderRadius: 4,
                      cursor: (isLocalSpectator || !tableDeckControlsEnabled || (gameMode === 'table' && !importMultiplayerValid)) ? 'not-allowed' : 'pointer',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >Save & Use</button>
                  <button
                    onClick={() => setImportResult(null)}
                    style={{
                      padding: '6px 10px',
                      background: '#1e293b', color: '#94a3b8',
                      border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 10,
                    }}
                  >Dismiss</button>
                </div>
                {gameMode === 'table' && importInvalidReason && (
                  <div
                    data-testid="save-use-disabled-reason"
                    style={{
                      marginTop: 6,
                      fontSize: 10,
                      color: '#fca5a5',
                      lineHeight: 1.35,
                    }}
                  >
                    Save & Use is blocked because this deck is not multiplayer-valid: {importInvalidReason}
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </div>

        {/* Multiplayer */}
        {gameMode === 'table' && (
        <div style={{
          background: '#10161a',
          border: '1px solid #26323a',
          borderRadius: 10,
          padding: 16,
        }}>
          <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, fontWeight: 700 }}>
            Multiplayer — Peer-to-Peer
          </div>
          <MultiplayerPanel
            seatCount={playerCount}
            seats={players.slice(0, playerCount).map((player, index) => ({
              id: player.id,
              name: `Seat ${index + 1}`,
              deckId: store.game.players[index]?.deckId ?? player.deckId,
            }))}
            onPrepareRoom={prepareTableRoomState}
            onExitRoom={() => setExitOpen(true)}
          />
        </div>
        )}

        {showJoinerStartFallback && (
          <div style={{
            display: 'grid',
            gap: 8,
          }}>
            {joinerCanEnterStartedGame && (
              <button
                type="button"
                data-testid="btn-enter-started-game"
                onClick={() => store.enterGameScreen()}
                style={{
                  width: '100%',
                  padding: '14px 0',
                  border: '1px solid #22d3ee',
                  borderRadius: 8,
                  background: '#0f2a33',
                  color: '#cffafe',
                  cursor: 'pointer',
                  fontSize: 15,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Enter Game
              </button>
            )}
            {joinerNeedsGamePatch && (
              <button
                type="button"
                data-testid="btn-sync-from-host"
                onClick={() => store.requestMultiplayerGamePatch('lobby-playing-fallback-button')}
                style={{
                  width: '100%',
                  padding: '14px 0',
                  border: '1px solid #f59e0b',
                  borderRadius: 8,
                  background: '#332511',
                  color: '#fde68a',
                  cursor: 'pointer',
                  fontSize: 15,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Sync From Host
              </button>
            )}
          </div>
        )}

        {/* Start button */}
        {!showJoinerStartFallback && (
        <button
          data-testid="btn-start-game"
          data-help-title={gameMode === 'solo' ? 'Start Solo Lab' : 'Start Commander Game'}
          data-help-body={gameMode === 'solo' ? 'Starts the practice table. Solo mode can begin without a loaded deck so you can build and test freely.' : 'Starts the Commander table after players, decks, and connection updates have stayed stable for a short sync check.'}
          data-help-example={gameMode === 'table'
            ? startHandshakeActive
              ? 'Start sync: waiting for each connected player to confirm their seat and deck snapshot.'
              : tableStart.waitingForSync
              ? `Final sync check: about ${tableSyncWaitSeconds}s remaining.`
              : !tableDecksReady
                ? `Missing decks: ${missingDeckPlayers.join(', ')}`
                : undefined
            : undefined}
          data-help-placement="top"
          onClick={() => startGame()}
          disabled={!canStartTable}
          style={{
            width: '100%', padding: '14px 0',
            background: canStartTable ? 'linear-gradient(135deg, #0e7490, #f59e0b)' : '#182127',
            color: canStartTable ? '#fff' : '#475569', border: 'none', borderRadius: 8,
            fontSize: 15, fontWeight: 800, cursor: canStartTable ? 'pointer' : 'not-allowed',
            letterSpacing: '0.05em', textTransform: 'uppercase',
            boxShadow: '0 4px 20px rgba(34,211,238,0.18), 0 2px 18px rgba(245,158,11,0.16)',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '0.9'; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '1'; }}
        >
          {gameMode === 'solo'
            ? 'Start Deck Lab'
            : !isInTableRoom
              ? 'Create Room to Start'
              : !isTableHost
                ? 'Waiting for Host to Start'
              : startHandshakeActive
                ? startHandshake?.status === 'committing'
                  ? 'Starting Game...'
                  : `Syncing Start (${startAckedCount}/${startHandshake?.requiredPeerIds.length ?? 0})`
              : tableStart.occupiedCount < minimumTablePlayers
                ? `Waiting for Players (${tableStart.occupiedCount}/${minimumTablePlayers} Minimum)`
                : !tableDecksReady
                  ? `Waiting for Decks (${missingDeckPlayers.join(', ')})`
                : tableStart.waitingForSync
                  ? `Checking Connections (${tableSyncWaitSeconds}s)`
                : `Start Game (${tableStart.occupiedCount}/${playerCount} Seats)`}
        </button>
        )}

        {gameMode === 'table' && isInTableRoom && !isTableHost && (
          <div
            data-testid="joiner-lobby-debug"
            style={{
              border: '1px dashed #334155',
              borderRadius: 6,
              color: '#64748b',
              fontFamily: '"SFMono-Regular", Consolas, monospace',
              fontSize: 10,
              lineHeight: 1.45,
              padding: 8,
            }}
          >
            ui.screen: {store.ui.screen}<br />
            game.status: {store.game.status}<br />
            multiplayer.lobby.status: {store.multiplayer.lobby?.status ?? 'none'}<br />
            multiplayer.status: {store.multiplayer.status}
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 10, color: '#1e293b' }}>
          Card data powered by Scryfall · Official rules apply by default
        </div>
      </div>
      <ExitGameModal open={exitOpen} onClose={() => setExitOpen(false)} />
    </div>
  );
}

const smallBtnStyle: React.CSSProperties = {
  background: '#182127',
  border: '1px solid #34414a',
  borderRadius: 5,
  color: '#93c5fd',
  cursor: 'pointer',
  fontSize: 10,
  fontWeight: 700,
  padding: '6px 9px',
  whiteSpace: 'nowrap',
};
