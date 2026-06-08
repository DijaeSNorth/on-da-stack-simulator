import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { deckCache, type CachedCard } from '../../engine/deckCache';
import type { CardDefinition } from '../../types/game';

// ─── Scryfall types ───────────────────────────────────────────────────────────

interface ScryfallCard {
  id: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  cmc?: number;
  power?: string;
  toughness?: string;
  loyalty?: string;
  image_uris?: { normal?: string; small?: string; border_crop?: string };
  card_faces?: { image_uris?: { normal?: string; small?: string }; oracle_text?: string; type_line?: string }[];
  color_identity?: string[];
  colors?: string[];
  flavor_text?: string;
  rulings_uri?: string;
}

// ─── Result type (union of cache hit or Scryfall hit) ─────────────────────────

interface CardResult {
  source: 'cache' | 'scryfall';
  name: string;
  typeLine: string;
  oracleText: string;
  imageUrl?: string;
  manaCost?: string;
  cmc?: number;
  power?: string;
  toughness?: string;
  loyalty?: string;
  colorIdentity?: string[];
  // Full Scryfall data for preview panel
  scryfallCard?: ScryfallCard;
  // Full cached card for cache source
  cachedCard?: CachedCard;
}

const SCRYFALL_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'On-Da-Stack Simulator/1.0',
};

// ─── Scryfall fetch helpers ───────────────────────────────────────────────────

async function fetchScryfallFuzzy(name: string): Promise<CardResult | null> {
  try {
    const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;
    const res = await fetch(url, { headers: SCRYFALL_HEADERS });
    if (!res.ok) return null;
    const card: ScryfallCard = await res.json();
    return scryfallToResult(card);
  } catch {
    return null;
  }
}

async function fetchScryfallSearch(query: string, signal?: AbortSignal): Promise<CardResult[]> {
  try {
    const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=name&page=1`;
    const res = await fetch(url, { signal, headers: SCRYFALL_HEADERS });
    if (!res.ok) return [];
    const data = await res.json();
    const cards: ScryfallCard[] = data.data ?? [];
    return cards.slice(0, 20).map(scryfallToResult);
  } catch {
    return [];
  }
}

function scryfallToResult(card: ScryfallCard): CardResult {
  const face0 = card.card_faces?.[0];
  const imageUrl =
    card.image_uris?.border_crop ??
    card.image_uris?.normal ??
    card.image_uris?.small ??
    face0?.image_uris?.normal ??
    face0?.image_uris?.small;

  return {
    source: 'scryfall',
    name: card.name,
    typeLine: card.type_line ?? face0?.type_line ?? '',
    oracleText: card.oracle_text ?? face0?.oracle_text ?? '',
    imageUrl,
    manaCost: card.mana_cost,
    cmc: card.cmc,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    colorIdentity: card.color_identity,
    scryfallCard: card,
  };
}

function cachedToResult(c: CachedCard): CardResult {
  return {
    source: 'cache',
    name: c.name,
    typeLine: c.typeLine,
    oracleText: c.oracleLower,
    imageUrl: c.imageUrl,
    colorIdentity: c.colorIdentity,
    power: c.power !== undefined ? String(c.power) : undefined,
    toughness: c.toughness !== undefined ? String(c.toughness) : undefined,
    cmc: c.mv,
    cachedCard: c,
  };
}

// ─── Mana cost pip renderer ───────────────────────────────────────────────────

const MANA_COLOR: Record<string, string> = {
  W: '#f9fafb', U: '#3b82f6', B: '#9ca3af', R: '#ef4444', G: '#22c55e',
  C: '#94a3b8', X: '#fbbf24', Y: '#fbbf24', Z: '#fbbf24',
};

function ManaPip({ symbol }: { symbol: string }) {
  const s = symbol.toUpperCase().replace(/[{}]/g, '');
  const color = MANA_COLOR[s] ?? '#94a3b8';
  const isNum = /^\d+$/.test(s);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 14, height: 14, borderRadius: '50%',
      background: isNum ? '#334155' : color,
      color: isNum ? '#e2e8f0' : (s === 'W' ? '#1e293b' : '#fff'),
      fontSize: 8, fontWeight: 700, marginRight: 1, flexShrink: 0,
      border: '1px solid rgba(255,255,255,0.15)',
    }}>
      {s}
    </span>
  );
}

function ManaCostRow({ cost }: { cost?: string }) {
  if (!cost) return null;
  const pips = cost.match(/\{[^}]+\}/g) ?? [];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
      {pips.map((p, i) => <ManaPip key={i} symbol={p} />)}
    </span>
  );
}

// ─── Card result row ──────────────────────────────────────────────────────────

interface ResultRowProps {
  result: CardResult;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
}

function ResultRow({ result, selected, onSelect, onPreview }: ResultRowProps) {
  const isCreature = result.typeLine.toLowerCase().includes('creature');
  const isPlaneswalker = result.typeLine.toLowerCase().includes('planeswalker');

  return (
    <div
      data-testid={`card-search-result-${result.name.replace(/\s/g, '-')}`}
      onClick={onSelect}
      onMouseEnter={onPreview}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', cursor: 'pointer',
        background: selected ? '#1e3a5f' : 'transparent',
        borderLeft: selected ? '2px solid #3b82f6' : '2px solid transparent',
        borderRadius: 4,
        transition: 'background 0.1s',
      }}
      onMouseLeave={() => {}}
    >
      {/* Thumbnail */}
      <div style={{
        width: 32, height: 44, borderRadius: 3,
        background: '#1e293b', flexShrink: 0, overflow: 'hidden',
        border: '1px solid #334155',
      }}>
        {result.imageUrl ? (
          <img
            src={result.imageUrl}
            alt={result.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#475569' }}>
            MTG
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <span style={{
            fontSize: 12, fontWeight: 600, color: '#e2e8f0',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {result.name}
          </span>
          <ManaCostRow cost={result.manaCost} />
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {result.typeLine || '—'}
        </div>
        {(isCreature && result.power !== undefined) && (
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
            {result.power}/{result.toughness}
          </div>
        )}
        {(isPlaneswalker && result.loyalty !== undefined) && (
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
            [{result.loyalty}]
          </div>
        )}
      </div>

      {/* Source badge */}
      <div style={{
        fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
        background: result.source === 'cache' ? '#166534' : '#1e3a5f',
        color: result.source === 'cache' ? '#4ade80' : '#60a5fa',
        flexShrink: 0,
      }}>
        {result.source === 'cache' ? 'DECK' : 'SF'}
      </div>
    </div>
  );
}

// ─── Detail preview (right side of panel) ────────────────────────────────────

function CardDetailPanel({ result }: { result: CardResult | null }) {
  if (!result) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', color: '#334155', fontSize: 12, gap: 8,
      }}>
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <rect x="4" y="4" width="32" height="36" rx="3" stroke="#334155" strokeWidth="2" />
          <line x1="10" y1="14" x2="30" y2="14" stroke="#334155" strokeWidth="1.5" />
          <line x1="10" y1="19" x2="24" y2="19" stroke="#334155" strokeWidth="1.5" />
          <line x1="10" y1="24" x2="27" y2="24" stroke="#334155" strokeWidth="1.5" />
        </svg>
        <span>Hover a card to preview</span>
      </div>
    );
  }

  const oracle = result.oracleText || '';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Card image */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 16px 0' }}>
        <div style={{ width: 200, height: 279, borderRadius: 8, overflow: 'hidden', border: '1px solid #334155', background: '#1e293b' }}>
          {result.imageUrl ? (
            <img
              src={result.imageUrl}
              alt={result.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13 }}>
              No image available
            </div>
          )}
        </div>
      </div>

      {/* Oracle text section */}
      <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{result.name}</span>
          <ManaCostRow cost={result.manaCost} />
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{result.typeLine}</div>

        {oracle && (
          <div style={{
            fontSize: 11, color: '#cbd5e1', background: 'rgba(255,255,255,0.04)',
            borderRadius: 6, padding: '8px 10px', lineHeight: 1.6, marginBottom: 8,
          }}>
            {oracle.split('\n').map((line, i) => (
              <p key={i} style={{ margin: '0 0 4px 0' }}>{line}</p>
            ))}
          </div>
        )}

        {result.power !== undefined && (
          <div style={{ textAlign: 'right' }}>
            <span style={{
              background: 'rgba(255,255,255,0.1)', borderRadius: 4,
              padding: '2px 8px', fontSize: 13, fontWeight: 700, color: '#e2e8f0',
            }}>
              {result.power}/{result.toughness}
            </span>
          </div>
        )}
        {result.loyalty !== undefined && (
          <div style={{ textAlign: 'right' }}>
            <span style={{
              background: '#7c3aed', borderRadius: 4,
              padding: '2px 8px', fontSize: 13, fontWeight: 700, color: '#fff',
            }}>
              [{result.loyalty}]
            </span>
          </div>
        )}

        {result.source === 'scryfall' && (
          <div style={{ marginTop: 8, fontSize: 10, color: '#475569' }}>
            Data via Scryfall API
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main CardSearchPanel ─────────────────────────────────────────────────────

export function CardSearchPanel() {
  const store = useGameStore();
  const { ui } = store;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CardResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<CardResult | null>(null);
  const [previewResult, setPreviewResult] = useState<CardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scryfallLoading, setScryfallLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'search' | 'deck'>('search');

  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Focus input on open
  useEffect(() => {
    if (ui.cardSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
      setSelectedResult(null);
      setPreviewResult(null);
    }
  }, [ui.cardSearchOpen]);

  // Search logic
  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    // Abort previous Scryfall request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);

    // 1. Search deckCache (instant, synchronous)
    const cacheHits = deckCache.resolveCardName(q);
    const cacheResults: CardResult[] = cacheHits.map(cachedToResult);
    setResults(cacheResults);
    setLoading(false);

    // 2. Scryfall fallback — always run, merge unique names
    setScryfallLoading(true);
    try {
      const sfResults = await fetchScryfallSearch(q, abortRef.current.signal);
      setResults(prev => {
        const existingNames = new Set(prev.map(r => r.name.toLowerCase()));
        const fresh = sfResults.filter(r => !existingNames.has(r.name.toLowerCase()));
        return [...prev, ...fresh];
      });
    } catch {
      // aborted — ignore
    } finally {
      setScryfallLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => runSearch(query), 180);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  if (!ui.cardSearchOpen) return null;

  const close = () => {
    store.setCardSearchOpen(false);
  };

  // Keyboard: Escape closes
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
  };

  const displayPreview = previewResult ?? selectedResult;

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="card-search-backdrop"
        onClick={close}
        style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(2px)',
        }}
      />

      {/* Panel */}
      <div
        data-testid="card-search-panel"
        onKeyDown={handleKeyDown}
        style={{
          position: 'fixed',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10001,
          width: 780, maxWidth: 'calc(100vw - 40px)',
          height: 560, maxHeight: 'calc(100vh - 100px)',
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 12,
          boxShadow: '0 40px 120px rgba(0,0,0,0.9)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px 0',
          flexShrink: 0,
        }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginRight: 'auto' }}>
            {(['search', 'deck'] as const).map(tab => (
              <button
                key={tab}
                data-testid={`card-panel-tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600,
                  borderRadius: 6, cursor: 'pointer',
                  border: '1px solid',
                  borderColor: activeTab === tab ? '#3b82f6' : '#1e293b',
                  background: activeTab === tab ? '#1e3a5f' : 'transparent',
                  color: activeTab === tab ? '#60a5fa' : '#64748b',
                  transition: 'all 0.15s',
                }}
              >
                {tab === 'search' ? '🔍 Card Search' : '📚 Deck Preview'}
              </button>
            ))}
          </div>

          {/* Close */}
          <button
            data-testid="card-search-close"
            onClick={close}
            style={{
              width: 24, height: 24, borderRadius: 6, border: '1px solid #1e293b',
              background: 'transparent', color: '#64748b', cursor: 'pointer',
              fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {activeTab === 'search' ? (
          <SearchTab
            inputRef={inputRef}
            query={query}
            setQuery={setQuery}
            results={results}
            loading={loading}
            scryfallLoading={scryfallLoading}
            selectedResult={selectedResult}
            setSelectedResult={setSelectedResult}
            setPreviewResult={setPreviewResult}
            displayPreview={displayPreview}
          />
        ) : (
          <DeckPreviewTab displayPreview={displayPreview} setPreviewResult={setPreviewResult} />
        )}
      </div>
    </>
  );
}

// ─── Search Tab ───────────────────────────────────────────────────────────────

interface SearchTabProps {
  inputRef: React.RefObject<HTMLInputElement>;
  query: string;
  setQuery: (q: string) => void;
  results: CardResult[];
  loading: boolean;
  scryfallLoading: boolean;
  selectedResult: CardResult | null;
  setSelectedResult: (r: CardResult) => void;
  setPreviewResult: (r: CardResult | null) => void;
  displayPreview: CardResult | null;
}

function SearchTab({
  inputRef, query, setQuery, results, loading, scryfallLoading,
  selectedResult, setSelectedResult, setPreviewResult, displayPreview,
}: SearchTabProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 14, gap: 12 }}>
      {/* Search input */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <span style={{
          position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 13, color: '#475569', pointerEvents: 'none',
        }}>🔍</span>
        <input
          ref={inputRef}
          data-testid="card-search-input"
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search cards — deck cache first, Scryfall fallback..."
          style={{
            width: '100%', boxSizing: 'border-box',
            background: '#1e293b', border: '1px solid #334155',
            borderRadius: 8, padding: '8px 36px 8px 34px',
            color: '#e2e8f0', fontSize: 13,
            outline: 'none',
          }}
          onFocus={e => { e.target.style.borderColor = '#3b82f6'; }}
          onBlur={e => { e.target.style.borderColor = '#334155'; }}
        />
        {(loading || scryfallLoading) && (
          <span style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            fontSize: 10, color: '#64748b',
          }}>
            {loading ? '⟳' : '↓SF'}
          </span>
        )}
      </div>

      {/* Results + preview split */}
      <div style={{ flex: 1, display: 'flex', gap: 12, overflow: 'hidden', minHeight: 0 }}>
        {/* Results list */}
        <div style={{
          width: 320, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          background: '#0a0f1a', borderRadius: 8, border: '1px solid #1e293b',
          overflow: 'hidden',
        }}>
          {/* Stats bar */}
          {query && (
            <div style={{
              padding: '4px 10px', fontSize: 10, color: '#475569',
              borderBottom: '1px solid #1e293b', flexShrink: 0,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>{results.length} results</span>
              {scryfallLoading && <span style={{ color: '#3b82f6' }}>Scryfall...</span>}
            </div>
          )}

          <div style={{ overflowY: 'auto', flex: 1, padding: 4 }}>
            {!query && (
              <div style={{ padding: '20px 10px', textAlign: 'center', color: '#334155', fontSize: 12 }}>
                Type to search your decks and all of Scryfall
              </div>
            )}
            {query && results.length === 0 && !loading && !scryfallLoading && (
              <div style={{ padding: '20px 10px', textAlign: 'center', color: '#334155', fontSize: 12 }}>
                No cards found for "{query}"
              </div>
            )}
            {results.map(r => (
              <ResultRow
                key={`${r.source}-${r.name}`}
                result={r}
                selected={selectedResult?.name === r.name}
                onSelect={() => setSelectedResult(r)}
                onPreview={() => setPreviewResult(r)}
              />
            ))}
          </div>
        </div>

        {/* Preview */}
        <div style={{
          flex: 1, background: '#0a0f1a', borderRadius: 8, border: '1px solid #1e293b',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <CardDetailPanel result={displayPreview} />
        </div>
      </div>

      {/* Hint */}
      <div style={{ fontSize: 10, color: '#334155', flexShrink: 0 }}>
        Deck cache (DECK) = instant results · Scryfall (SF) = full card database fallback · Press Esc to close
      </div>
    </div>
  );
}

// ─── Deck Preview Tab (player zone browser) ───────────────────────────────────

interface DeckPreviewTabProps {
  displayPreview: CardResult | null;
  setPreviewResult: (r: CardResult | null) => void;
}

function DeckPreviewTab({ displayPreview, setPreviewResult }: DeckPreviewTabProps) {
  const store = useGameStore();
  const { game, localPlayerId } = store;
  const [selectedPlayerId, setSelectedPlayerId] = useState(localPlayerId);
  const [selectedZone, setSelectedZone] = useState<'hand' | 'library' | 'graveyard' | 'exile' | 'battlefield' | 'command'>('hand');
  const [zoneFilter, setZoneFilter] = useState('');

  const player = game.players.find(p => p.id === selectedPlayerId) ?? game.players[0];
  if (!player) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 13 }}>
        No players in game. Load a deck in the Lobby first.
      </div>
    );
  }

  const zones: Array<{ key: typeof selectedZone; label: string }> = [
    { key: 'hand', label: 'Hand' },
    { key: 'library', label: 'Library' },
    { key: 'battlefield', label: 'Battlefield' },
    { key: 'graveyard', label: 'Graveyard' },
    { key: 'exile', label: 'Exile' },
    { key: 'command', label: 'Command' },
  ];

  const zoneCardIds: string[] = player[selectedZone as keyof typeof player] as string[] ?? [];
  const zoneCards = zoneCardIds
    .map(id => game.cards[id])
    .filter(Boolean);

  const filteredCards = zoneFilter.trim()
    ? zoneCards.filter(c =>
        c.definition.name.toLowerCase().includes(zoneFilter.toLowerCase()) ||
        c.definition.typeLine.toLowerCase().includes(zoneFilter.toLowerCase())
      )
    : zoneCards;

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: '12px 14px 14px', gap: 12, minHeight: 0 }}>
      {/* Left: controls + card list */}
      <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
        {/* Player selector */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
          {game.players.map(p => (
            <button
              key={p.id}
              data-testid={`deck-preview-player-${p.id}`}
              onClick={() => setSelectedPlayerId(p.id)}
              style={{
                padding: '3px 8px', fontSize: 10, fontWeight: 600,
                borderRadius: 4, cursor: 'pointer',
                border: '1px solid',
                borderColor: selectedPlayerId === p.id ? p.color : '#1e293b',
                background: selectedPlayerId === p.id ? `${p.color}22` : 'transparent',
                color: selectedPlayerId === p.id ? p.color : '#64748b',
              }}
            >
              {p.name}{p.id === localPlayerId ? ' (You)' : ''}
            </button>
          ))}
        </div>

        {/* Zone tabs */}
        <div style={{ display: 'flex', gap: 3, flexShrink: 0, flexWrap: 'wrap' }}>
          {zones.map(z => {
            const count = (player[z.key as keyof typeof player] as string[] ?? []).length;
            return (
              <button
                key={z.key}
                data-testid={`deck-preview-zone-${z.key}`}
                onClick={() => { setSelectedZone(z.key); setZoneFilter(''); }}
                style={{
                  padding: '3px 8px', fontSize: 10, fontWeight: 600,
                  borderRadius: 4, cursor: 'pointer',
                  border: '1px solid',
                  borderColor: selectedZone === z.key ? '#7c3aed' : '#1e293b',
                  background: selectedZone === z.key ? '#4c1d9522' : 'transparent',
                  color: selectedZone === z.key ? '#a78bfa' : '#64748b',
                }}
              >
                {z.label} <span style={{ fontSize: 9, opacity: 0.7 }}>({count})</span>
              </button>
            );
          })}
        </div>

        {/* Filter input */}
        <input
          data-testid="deck-preview-filter"
          type="text"
          value={zoneFilter}
          onChange={e => setZoneFilter(e.target.value)}
          placeholder={`Filter ${selectedZone}...`}
          style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
            padding: '5px 10px', color: '#e2e8f0', fontSize: 12,
            outline: 'none', flexShrink: 0,
          }}
        />

        {/* Card list */}
        <div style={{
          flex: 1, background: '#0a0f1a', borderRadius: 8, border: '1px solid #1e293b',
          overflowY: 'auto', minHeight: 0,
        }}>
          {filteredCards.length === 0 ? (
            <div style={{ padding: '20px 10px', textAlign: 'center', color: '#334155', fontSize: 12 }}>
              {zoneFilter ? `No matches in ${selectedZone}` : `${selectedZone} is empty`}
            </div>
          ) : (
            <div style={{ padding: 4 }}>
              {filteredCards.map(card => {
                const result: CardResult = {
                  source: 'cache',
                  name: card.definition.name,
                  typeLine: card.definition.typeLine,
                  oracleText: card.definition.oracleText ?? '',
                  imageUrl: card.definition.imageUrl,
                  power: card.definition.power,
                  toughness: card.definition.toughness,
                  loyalty: card.definition.loyalty !== undefined ? String(card.definition.loyalty) : undefined,
                  cmc: card.definition.cmc,
                };

                return (
                  <div
                    key={card.instanceId}
                    data-testid={`deck-preview-card-${card.instanceId}`}
                    onMouseEnter={() => setPreviewResult(result)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 8px', cursor: 'default', borderRadius: 4,
                      transition: 'background 0.1s',
                    }}
                    onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = '#1e293b'; }}
                    onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    {/* Mini thumbnail */}
                    <div style={{ width: 28, height: 39, borderRadius: 2, overflow: 'hidden', flexShrink: 0, background: '#1e293b', border: '1px solid #334155' }}>
                      {card.definition.imageUrl ? (
                        <img src={card.definition.imageUrl} alt={card.definition.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                      ) : null}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {card.definition.name}
                      </div>
                      <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>
                        {card.definition.typeLine}
                      </div>
                    </div>

                    {/* Status badges */}
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      {card.tapped && (
                        <span style={{ fontSize: 8, padding: '1px 3px', borderRadius: 2, background: '#78350f', color: '#fcd34d', fontWeight: 700 }}>TAP</span>
                      )}
                      {card.counters.length > 0 && (
                        <span style={{ fontSize: 8, padding: '1px 3px', borderRadius: 2, background: '#1d4ed8', color: '#93c5fd', fontWeight: 700 }}>
                          {card.counters.map(c => `${c.type}×${c.count}`).join(' ')}
                        </span>
                      )}
                      {card.token && (
                        <span style={{ fontSize: 8, padding: '1px 3px', borderRadius: 2, background: '#166534', color: '#4ade80', fontWeight: 700 }}>TKN</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Stats footer */}
        <div style={{ fontSize: 10, color: '#334155', flexShrink: 0, textAlign: 'right' }}>
          Showing {filteredCards.length} of {zoneCards.length} cards in {selectedZone}
        </div>
      </div>

      {/* Preview panel */}
      <div style={{
        flex: 1, background: '#0a0f1a', borderRadius: 8, border: '1px solid #1e293b',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        <CardDetailPanel result={displayPreview} />
      </div>
    </div>
  );
}
