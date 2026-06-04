import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { importDecklist, saveDeck } from '../../engine/deckImport';
import { MultiplayerPanel } from '../multiplayer/MultiplayerPanel';
import { getActiveProfile } from '../../engine/profileStorage';
import type { Deck } from '../../types/game';

interface PlayerSetup {
  id: string;
  name: string;
  color: string;
  deckId?: string;
}

type GameMode = 'solo' | 'table';
type PlayerCount = 1 | 2 | 3 | 4 | 5 | 6;

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
      name: i === 0 ? 'You' : `Player ${i + 1}`,
      color: DEFAULT_COLORS[i],
    }))
  );
  const [startingLife, setStartingLife] = useState(40);
  const [activePlayerTab, setActivePlayerTab] = useState(0);
  const [deckText, setDeckText] = useState('');
  const [customLogicText, setCustomLogicText] = useState('');
  const [deckName, setDeckName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ deck: Deck; errors: string[]; warnings: string[] } | null>(null);
  const [houseRules, setHouseRules] = useState<Set<string>>(new Set());

  // Auto-populate seat 0 from active profile on mount
  useEffect(() => {
    const profile = getActiveProfile();
    if (profile) {
      setPlayers(prev => prev.map((p, i) =>
        i === 0 ? { ...p, name: profile.displayName, color: profile.color } : p
      ));
    }
  }, []);

  const savedDecks = store.decks;

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
          name: `Player ${prev.length + i + 1}`,
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
    if (!deckText.trim()) return;
    setImporting(true);
    try {
      const result = await importDecklist(deckText, deckName || 'Imported Deck', undefined, undefined, customLogicText);
      setImportResult(result);
    } finally {
      setImporting(false);
    }
  }

  async function assignDeckToPlayer(deck: Deck) {
    updatePlayer(activePlayerTab, { deckId: deck.id });
    await store.loadDeck(players[activePlayerTab].id, deck);
    setImportResult(null);
    setDeckText('');
    setCustomLogicText('');
  }

  async function saveDeckAndAssign() {
    if (!importResult) return;
    saveDeck(importResult.deck);
    store.loadDecks();
    await assignDeckToPlayer(importResult.deck);
  }

  function startGame() {
    const selectedHouseRules = HOUSE_RULE_PRESETS
      .filter(rule => houseRules.has(rule.id))
      .map(rule => ({
        ...rule,
        votes: Object.fromEntries(players.map(player => [player.id, true])),
        approved: true,
        appliesTo: 'all' as const,
      }));

    const config = {
      playerCount,
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

    store.initGame(config, players.map(p => ({
      id: p.id, name: p.name, color: p.color,
    })));

    // Load saved decks for players who have them
    (async () => {
      for (let i = 0; i < players.length; i++) {
        if (players[i].deckId) {
          const deck = savedDecks.find(d => d.id === players[i].deckId);
          if (deck) {
            await store.loadDeck(players[i].id, deck);
          }
        }
      }
      store.startGame();
    })();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 20000,
      background: '#0d1117',
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
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-label="MTG Sim logo">
              <polygon points="16,2 30,28 2,28" stroke="#7c3aed" strokeWidth="2" fill="#1e1b4b" />
              <circle cx="16" cy="18" r="5" fill="#7c3aed" opacity="0.8" />
              <line x1="16" y1="8" x2="16" y2="13" stroke="#a78bfa" strokeWidth="1.5" />
            </svg>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', margin: 0, letterSpacing: '-0.02em' }}>
              Commander Table
            </h1>
          </div>
          <div style={{ fontSize: 12, color: '#475569' }}>
            Digital MTG Tabletop · Judge Assistant · Sandbox & Replay
          </div>
        </div>

        {/* Main layout */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Left: Game setup */}
          <div style={{
            flex: '1 1 340px',
            background: '#111827',
            border: '1px solid #1e293b',
            borderRadius: 10,
            padding: 16,
          }}>
            <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, fontWeight: 700 }}>
              Game Setup
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
                    background: gameMode === 'solo' ? '#14532d' : '#1e293b',
                    color: gameMode === 'solo' ? '#bbf7d0' : '#94a3b8',
                    border: `1px solid ${gameMode === 'solo' ? '#22c55e' : '#334155'}`,
                    borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  }}
                >
                  Solo Goldfish
                </button>
                <button
                  data-testid="btn-mode-table"
                  onClick={() => updateMode('table')}
                  style={{
                    padding: '8px 10px',
                    background: gameMode === 'table' ? '#1d4ed8' : '#1e293b',
                    color: gameMode === 'table' ? '#fff' : '#94a3b8',
                    border: `1px solid ${gameMode === 'table' ? '#3b82f6' : '#334155'}`,
                    borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                  }}
                >
                  Table / Multiplayer
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
                Starting Life: {startingLife}
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
                {gameMode === 'solo' ? 'Solo Player' : 'Player Names & Colors'}
              </label>
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

              {/* Active player editor */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
              </div>
            </div>

            {/* House Rules */}
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
          </div>

          {/* Right: Deck import */}
          <div style={{
            flex: '1 1 340px',
            background: '#111827',
            border: '1px solid #1e293b',
            borderRadius: 10,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}>
            <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
              Deck Import — {gameMode === 'solo' ? 'Solo Player' : `Player ${activePlayerTab + 1}`}
            </div>

            {/* Saved decks */}
            {savedDecks.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>Saved Decks</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {savedDecks.map(deck => {
                    const assigned = players[activePlayerTab]?.deckId === deck.id;
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
                        <button
                          onClick={() => assignDeckToPlayer(deck)}
                          style={{
                            fontSize: 9, padding: '3px 8px',
                            background: assigned ? '#1d4ed8' : '#1e293b',
                            color: assigned ? '#fff' : '#94a3b8',
                            border: 'none', borderRadius: 3, cursor: 'pointer',
                          }}
                        >{assigned ? '✓ Assigned' : 'Use'}</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Import new deck */}
            <div>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>
                Import New Deck
                <span style={{ color: '#334155' }}> · Supports Moxfield, Archidekt, MTGO, CSV</span>
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
                onClick={handleImport}
                disabled={importing || !deckText.trim()}
                style={{
                  width: '100%', marginTop: 8, padding: '8px 0',
                  background: importing ? '#374151' : '#1d4ed8',
                  color: importing ? '#6b7280' : '#fff',
                  border: 'none', borderRadius: 5, cursor: importing ? 'wait' : 'pointer',
                  fontSize: 11, fontWeight: 700,
                }}
              >
                {importing ? 'Importing...' : 'Import & Validate'}
              </button>
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
                    onClick={saveDeckAndAssign}
                    style={{
                      flex: 1, padding: '6px 0',
                      background: '#14532d', color: '#86efac',
                      border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 10, fontWeight: 700,
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
              </div>
            )}
          </div>
        </div>

        {/* Multiplayer */}
        {gameMode === 'table' && (
        <div style={{
          background: '#111827',
          border: '1px solid #1e293b',
          borderRadius: 10,
          padding: 16,
        }}>
          <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, fontWeight: 700 }}>
            Multiplayer — Testing (Firebase)
          </div>
          <MultiplayerPanel />
        </div>
        )}

        {/* Start button */}
        <button
          data-testid="btn-start-game"
          onClick={startGame}
          style={{
            width: '100%', padding: '14px 0',
            background: 'linear-gradient(135deg, #1d4ed8, #7c3aed)',
            color: '#fff', border: 'none', borderRadius: 8,
            fontSize: 15, fontWeight: 800, cursor: 'pointer',
            letterSpacing: '0.05em', textTransform: 'uppercase',
            boxShadow: '0 4px 20px rgba(124,58,237,0.3)',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '0.9'; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '1'; }}
        >
          {gameMode === 'solo' ? 'Start Solo Mode' : `Start Game (${playerCount} Players)`}
        </button>

        <div style={{ textAlign: 'center', fontSize: 10, color: '#1e293b' }}>
          Card data powered by Scryfall · Official rules apply by default
        </div>
      </div>
    </div>
  );
}
