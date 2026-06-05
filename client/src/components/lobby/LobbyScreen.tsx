import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  importDeckFromUrl,
  importDecklist,
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
type ImportMode = 'text' | 'url';

const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

const HOUSE_RULE_PRESETS = [
  { id: 'free_mulligan', name: 'Free Mulligan', description: 'First mulligan is free (no card loss)' },
  { id: 'no_commander_tax', name: 'No Commander Tax', description: 'Commanders don\'t cost more to cast from command zone' },
  { id: 'extra_land', name: 'Extra Land Drop', description: 'Each player may play an additional land per turn' },
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
  const [importMode, setImportMode] = useState<ImportMode>('text');
  const [deckText, setDeckText] = useState('');
  const [deckUrl, setDeckUrl] = useState('');
  const [customLogicText, setCustomLogicText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [houseRules, setHouseRules] = useState<Set<string>>(new Set());
  const [favoriteDeckIds, setFavoriteDeckIds] = useState<string[]>(() => loadFavoriteDeckIds());

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

  const savedDecks = store.decks;
  const localPresence = store.multiplayer.peerId ? store.multiplayer.peers[store.multiplayer.peerId] : undefined;
  const localSeatIndex = gameMode === 'table' && localPresence && localPresence.seatIndex >= 0 ? localPresence.seatIndex : 0;
  const setupPlayerIndex = gameMode === 'solo' ? activePlayerTab : localSeatIndex;
  const activeSetupPlayer = players[setupPlayerIndex] ?? players[0];
  const seatedPeers = Object.values(store.multiplayer.peers)
    .filter(peer => peer.online && !peer.isSpectator && peer.seatIndex >= 0 && peer.seatIndex < playerCount);
  const occupiedSeats = new Set(seatedPeers.map(peer => peer.seatIndex));
  const isTableHost = gameMode === 'table' && store.multiplayer.status === 'host';
  const minimumTablePlayers = 2;
  const tableDeckStatus = seatedPeers
    .map(peer => {
      const seat = players[peer.seatIndex];
      const loadedPlayer = seat ? store.game.players.find(player => player.id === seat.id) : undefined;
      const hasLoadedDeck = Boolean(
        loadedPlayer?.deckId &&
        (loadedPlayer.library.length > 0 || loadedPlayer.commandZone.length > 0)
      );
      const hasAssignedSavedDeck = Boolean(seat?.deckId && savedDecks.some(deck => deck.id === seat.deckId));
      return {
        peer,
        seat,
        ready: hasLoadedDeck || hasAssignedSavedDeck,
      };
    });
  const missingDeckPlayers = tableDeckStatus
    .filter(status => !status.ready)
    .map(status => status.peer.name);
  const tableDecksReady = gameMode !== 'table' || (
    occupiedSeats.size >= minimumTablePlayers &&
    missingDeckPlayers.length === 0
  );
  const canStartTable = gameMode !== 'table' || (
    isTableHost &&
    occupiedSeats.size >= minimumTablePlayers &&
    tableDecksReady
  );

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

  async function handleImport() {
    if (importMode === 'text' && !deckText.trim()) return;
    if (importMode === 'url' && !deckUrl.trim()) return;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    try {
      const result = importMode === 'url'
        ? await importDeckFromUrl(deckUrl, deckName, undefined, customLogicText)
        : await importDecklist(deckText, deckName || 'Imported Deck', undefined, undefined, customLogicText);
      setImportResult(result);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Deck import failed.');
    } finally {
      setImporting(false);
    }
  }

  async function assignDeckToPlayer(deck: Deck) {
    updatePlayer(setupPlayerIndex, { deckId: deck.id });
    await store.loadDeck(activeSetupPlayer.id, deck);
    setImportResult(null);
    setImportError('');
    setDeckText('');
    setDeckUrl('');
    setCustomLogicText('');
  }

  async function saveDeckAndAssign() {
    if (!importResult) return;
    saveDeck(importResult.deck);
    store.loadDecks();
    setFavoriteDeckIds(loadFavoriteDeckIds());
    await assignDeckToPlayer(importResult.deck);
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
      startingLife,
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
        return {
          id: seat.id,
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
        ? [...occupiedSeats].sort((a, b) => a - b).map(index => players[index]).filter(Boolean)
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
      store.startGame();
      if (gameMode === 'solo') {
        store.setRightPanelTab('debug');
      }
    })();
  }

  function testDeck(deck: Deck) {
    updatePlayer(setupPlayerIndex, { deckId: deck.id });
    startGame({ [activeSetupPlayer.id]: deck });
  }

  function saveDeckAndTest() {
    if (!importResult) return;
    saveDeck(importResult.deck);
    store.loadDecks();
    setFavoriteDeckIds(loadFavoriteDeckIds());
    testDeck(importResult.deck);
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
                  {([2, 3, 4] as const).map(n => (
                    <button
                      key={n}
                      data-testid={`btn-player-count-${n}`}
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
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                {gameMode === 'solo' ? 'Test Life' : 'Starting Life'}: {startingLife}
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
                      Profile
                    </button>
                    <button onClick={applyActiveProfileToSeat0} style={smallBtnStyle}>
                      Apply
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {players.slice(0, playerCount).map((seat, index) => {
                    const peer = seatedPeers.find(p => p.seatIndex === index);
                    const occupied = Boolean(peer);
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
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button onClick={() => store.setProfileOpen(true)} style={smallBtnStyle}>Edit Profile</button>
                    <button onClick={applyActiveProfileToSeat0} style={smallBtnStyle}>Apply Profile</button>
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

          {/* Right: Deck import */}
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
              Deck Import — {gameMode === 'solo' ? 'Solo Player' : `Your Setup (Seat ${setupPlayerIndex + 1})`}
            </div>

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
                            onClick={() => gameMode === 'solo' ? testDeck(deck) : assignDeckToPlayer(deck)}
                            style={{
                              fontSize: 9, padding: '3px 8px',
                              background: assigned ? '#1d4ed8' : '#1e293b',
                              color: assigned ? '#fff' : '#94a3b8',
                              border: 'none', borderRadius: 3, cursor: 'pointer',
                            }}
                          >{gameMode === 'solo' ? 'Test' : assigned ? 'Assigned' : 'Use'}</button>
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
                <span style={{ color: '#334155' }}> · Supports URL, MTGO, CSV</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                {(['url', 'text'] as const).map(mode => (
                  <button
                    key={mode}
                    data-testid={`btn-import-mode-${mode}`}
                    onClick={() => {
                      setImportMode(mode);
                      setImportError('');
                      setImportResult(null);
                    }}
                    style={{
                      padding: '6px 8px',
                      background: importMode === mode ? '#1e3a5f' : '#1e293b',
                      color: importMode === mode ? '#bfdbfe' : '#94a3b8',
                      border: `1px solid ${importMode === mode ? '#60a5fa' : '#334155'}`,
                      borderRadius: 5,
                      cursor: 'pointer',
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                    }}
                  >
                    {mode === 'url' ? 'Website URL' : 'Paste Text'}
                  </button>
                ))}
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
              {importMode === 'url' ? (
                <div>
                  <input
                    placeholder="https://www.moxfield.com/decks/... or Archidekt / MTGGoldfish / TappedOut"
                    value={deckUrl}
                    onChange={e => setDeckUrl(e.target.value)}
                    data-testid="input-deck-url"
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      background: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: 5,
                      padding: '8px 10px',
                      fontSize: 11,
                      color: '#e2e8f0',
                      outline: 'none',
                    }}
                  />
                  <div style={{ fontSize: 9, color: '#475569', marginTop: 5, lineHeight: 1.35 }}>
                    Public Moxfield and Archidekt links import directly. MTGGoldfish and TappedOut use their public text exports when available.
                  </div>
                </div>
              ) : (
                <textarea
                  placeholder="Paste your decklist here...&#10;&#10;Example:&#10;Commander&#10;1 Atraxa, Praetors' Voice&#10;&#10;Deck&#10;1 Sol Ring&#10;1 Command Tower&#10;..."
                  value={deckText}
                  onChange={e => setDeckText(e.target.value)}
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
              )}
              <details open={gameMode === 'solo'} style={{ marginTop: 8 }}>
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
                onClick={handleImport}
                disabled={importing || (importMode === 'text' ? !deckText.trim() : !deckUrl.trim())}
                style={{
                  width: '100%', marginTop: 8, padding: '8px 0',
                  background: importing ? '#374151' : '#1d4ed8',
                  color: importing ? '#6b7280' : '#fff',
                  border: 'none', borderRadius: 5, cursor: importing ? 'wait' : 'pointer',
                  fontSize: 11, fontWeight: 700,
                }}
              >
                {importing ? 'Importing...' : importMode === 'url' ? 'Fetch & Validate' : 'Import & Validate'}
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
                  {importResult.deck.name} — {importResult.deck.cards.reduce((s, c) => s + c.count, 0)} cards
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
                    onClick={gameMode === 'solo' ? saveDeckAndTest : saveDeckAndAssign}
                    style={{
                      flex: 1, padding: '6px 0',
                      background: '#14532d', color: '#86efac',
                      border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 700,
                    }}
                  >{gameMode === 'solo' ? 'Save & Test' : 'Save & Use'}</button>
                  <button
                    onClick={() => setImportResult(null)}
                    style={{
                      padding: '6px 10px',
                      background: '#1e293b', color: '#94a3b8',
                      border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 10,
                    }}
                  >Dismiss</button>
                </div>
              </div>
            )}
          </div>
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
            }))}
            onPrepareRoom={prepareTableRoomState}
          />
        </div>
        )}

        {/* Start button */}
        <button
          data-testid="btn-start-game"
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
            : !isTableHost
              ? 'Create Room to Start'
              : occupiedSeats.size < minimumTablePlayers
                ? `Waiting for Players (${occupiedSeats.size}/${minimumTablePlayers} Minimum)`
                : !tableDecksReady
                  ? `Waiting for Decks (${missingDeckPlayers.join(', ')})`
                : `Start Game (${occupiedSeats.size}/${playerCount} Seats)`}
        </button>

        <div style={{ textAlign: 'center', fontSize: 10, color: '#1e293b' }}>
          Card data powered by Scryfall · Official rules apply by default
        </div>
      </div>
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
