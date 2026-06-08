import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  deleteDeck,
  exportDeckAsText,
  importDecklist,
  loadFavoriteDeckIds,
  MAX_STORED_DECKS,
  parseDeckFilePayload,
  saveDeck,
} from '../../engine/deckImport';
import { fetchCardAutocomplete, fetchCardByName } from '../../data/cardDatabase';
import {
  addCardTrigger,
  addReplacement,
  analyzeDeckBuilderStats,
  adjustDeckEntry,
  createBlankDeck,
  customCardFromDefinition,
  getDeckBuilderRows,
  removeCardLogic,
  serializeDeckLogic,
  setCardNote,
  setDeckEntryCount,
  summarizeCardLogic,
  upsertCustomCard,
  type DeckBuilderSection,
} from '../../engine/soloDeckBuilder';
import type { Deck } from '../../types/game';

interface SoloDeckBuilderProps {
  playerId?: string;
  onLoadDeck?: (deck: Deck) => void | Promise<void>;
  loadLabel?: string;
  compact?: boolean;
}

const SECTION_LABELS: Record<DeckBuilderSection, string> = {
  commander: 'Commander',
  main: 'Main Deck',
  sideboard: 'Sideboard',
  maybeboard: 'Maybeboard',
};

export function SoloDeckBuilder({ playerId, onLoadDeck, loadLabel = 'Load to Battlefield', compact = false }: SoloDeckBuilderProps) {
  const store = useGameStore();
  const savedDecks = store.decks;
  const [draft, setDraft] = useState<Deck>(() => savedDecks[0] ?? createBlankDeck('Solo Lab Deck'));
  const [selectedCard, setSelectedCard] = useState(draft.commanders[0] ?? draft.cards[0]?.name ?? '');
  const [newCardName, setNewCardName] = useState('');
  const [newCardCount, setNewCardCount] = useState(1);
  const [newCardSection, setNewCardSection] = useState<DeckBuilderSection>('main');
  const [exchangeText, setExchangeText] = useState('');
  const [logicText, setLogicText] = useState('');
  const [status, setStatus] = useState('');
  const [triggerEvent, setTriggerEvent] = useState('');
  const [triggerEffect, setTriggerEffect] = useState('');
  const [replacementEvent, setReplacementEvent] = useState('');
  const [replacementEffect, setReplacementEffect] = useState('');
  const [customType, setCustomType] = useState('Creature');
  const [customOracle, setCustomOracle] = useState('');
  const [customStats, setCustomStats] = useState('');
  const [cardLookupLoading, setCardLookupLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(true);
  const [saveLimitOpen, setSaveLimitOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cardRows = useMemo(() => getDeckBuilderRows(draft), [draft]);
  const mainCount = draft.cards.reduce((sum, card) => sum + card.count, 0);
  const logicSummary = selectedCard ? summarizeCardLogic(draft, selectedCard) : undefined;
  const stats = useMemo(() => analyzeDeckBuilderStats(draft), [draft]);

  useEffect(() => {
    let cancelled = false;
    const q = newCardName.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      const names = await fetchCardAutocomplete(q);
      if (!cancelled) setSuggestions(names);
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [newCardName]);

  function refreshExchange(next: Deck) {
    setExchangeText(exportDeckAsText(next));
    setLogicText(serializeDeckLogic(next));
  }

  useEffect(() => {
    refreshExchange(draft);
  }, []);

  function replaceDraft(next: Deck, options: { refreshText?: boolean; sync?: boolean } = {}) {
    setDraft(next);
    if (!selectedCard && next.cards[0]) setSelectedCard(next.cards[0].name);
    if (options.refreshText) refreshExchange(next);
    if (options.sync && liveSyncEnabled) void syncDeckForTesting(next);
  }

  async function syncDeckForTesting(next: Deck) {
    if (!playerId) return;
    if (onLoadDeck) {
      await onLoadDeck(next);
      return;
    }
    if (store.game.config.playerCount === 1 && store.game.status !== 'lobby') {
      await store.loadDeck(playerId, next);
    }
  }

  async function addCard() {
    const requestedName = newCardName.trim();
    if (!requestedName || cardLookupLoading) return;
    setCardLookupLoading(true);
    setStatus(`Searching Scryfall for "${requestedName}"...`);
    try {
      const definition = await fetchCardByName(requestedName);
      const cardName = definition?.name ?? requestedName;
      let next = setDeckEntryCount(draft, newCardSection, cardName, newCardSection === 'commander' ? 1 : newCardCount);
      if (definition) {
        next = upsertCustomCard(next, customCardFromDefinition(definition));
      }
      replaceDraft(next);
      setSelectedCard(cardName);
      refreshExchange(next);
      if (liveSyncEnabled) await syncDeckForTesting(next);
      setSuggestions([]);
      setStatus(definition
        ? `Added ${cardName} from Scryfall and refreshed the test deck.`
        : `Added ${cardName}; Scryfall did not return a match, so it will test as a placeholder.`);
    } finally {
      setCardLookupLoading(false);
    }
    setNewCardName('');
    setNewCardCount(1);
  }

  function handleSave() {
    if (!savedDecks.some(deck => deck.id === draft.id) && savedDecks.length >= MAX_STORED_DECKS) {
      setSaveLimitOpen(true);
      setStatus('Saved deck slots are full. Download this build as a file or delete a stored deck first.');
      return;
    }
    saveDeck({ ...draft, importedAt: Date.now() });
    store.loadDecks();
    setSaveLimitOpen(false);
    setStatus(`Saved "${draft.name}".`);
  }

  function handleSaveAs() {
    const copy = { ...draft, id: crypto.randomUUID(), name: `${draft.name} Copy`, importedAt: Date.now() };
    if (savedDecks.length >= MAX_STORED_DECKS) {
      setDraft(copy);
      refreshExchange(copy);
      setSaveLimitOpen(true);
      setStatus('Saved deck slots are full. Download this copy as a file or delete a stored deck first.');
      return;
    }
    saveDeck(copy);
    store.loadDecks();
    setDraft(copy);
    refreshExchange(copy);
    setStatus(`Saved as "${copy.name}".`);
  }

  async function handleLoad() {
    handleSave();
    if (onLoadDeck) await onLoadDeck(draft);
    else if (playerId) await store.loadDeck(playerId, draft);
    setStatus(`Loaded "${draft.name}" for testing.`);
  }

  async function importDeckText(deckText: string, fallbackName = draft.name || 'Solo Lab Import', customLogicText = logicText) {
    const text = deckText.trim();
    if (!text) {
      setStatus('Paste or upload a decklist before importing.');
      return;
    }
    setStatus('Importing deck...');
    const result = await importDecklist(text, fallbackName, 'solo-builder', playerId, customLogicText, {
      captureFetchedCardData: true,
    });
    setDraft(result.deck);
    setSelectedCard(result.deck.commanders[0] ?? result.deck.cards[0]?.name ?? '');
    refreshExchange(result.deck);
    if (savedDecks.length >= MAX_STORED_DECKS) {
      setSaveLimitOpen(true);
    } else {
      store.saveDeckToStorage(result.deck);
    }
    if (liveSyncEnabled) await syncDeckForTesting(result.deck);
    setStatus(result.errors.length ? result.errors.join(' ') : `Imported ${result.cardCount} cards. ${result.warnings[0] ?? ''}`);
    return result;
  }

  async function handleImport() {
    await importDeckText(exchangeText, draft.name || 'Solo Lab Import', logicText);
  }

  function handleExportFile(deckToExport = draft) {
    const payload = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      source: 'On-Da-Stack Solo Deck Builder',
      deck: deckToExport,
      deckText: exportDeckAsText(deckToExport),
      logicText: serializeDeckLogic(deckToExport),
    }, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(deckToExport.name)}.on-da-stack-deck.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setSaveLimitOpen(false);
    setStatus(`Downloaded "${deckToExport.name}" as a file.`);
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const fallbackName = file.name.replace(/\.[^.]+$/, '') || 'Imported Deck File';
    const parsed = parseDeckFilePayload(text, fallbackName);
    if (parsed.error) {
      setStatus(parsed.error);
      return;
    }
    if (parsed.deck) {
      setDraft(parsed.deck);
      setSelectedCard(parsed.deck.commanders[0] ?? parsed.deck.cards[0]?.name ?? '');
      refreshExchange(parsed.deck);
      if (parsed.logicText !== undefined) setLogicText(parsed.logicText);
      if (liveSyncEnabled) await syncDeckForTesting(parsed.deck);
      setStatus(`Loaded "${parsed.deck.name}" from file. ${parsed.warnings[0] ?? ''}`.trim());
      return;
    }
    const nextDeckText = parsed.deckText ?? text;
    const nextLogicText = parsed.logicText ?? logicText;
    setExchangeText(nextDeckText);
    if (parsed.logicText !== undefined) setLogicText(parsed.logicText);
    const result = await importDeckText(nextDeckText, fallbackName, nextLogicText);
    if (result && parsed.warnings.length > 0 && result.errors.length === 0) {
      setStatus(`Imported "${file.name}". ${parsed.warnings[0]} ${result.warnings[0] ?? ''}`.trim());
    }
  }

  function handleSelectSavedDeck(deck: Deck) {
    setDraft(deck);
    setSelectedCard(deck.commanders[0] ?? deck.cards[0]?.name ?? '');
    refreshExchange(deck);
    if (liveSyncEnabled) void syncDeckForTesting(deck);
  }

  function handleDeleteDraft() {
    deleteDeck(draft.id);
    store.loadDecks();
    const blank = createBlankDeck('Solo Lab Deck');
    setDraft(blank);
    setSelectedCard('');
    refreshExchange(blank);
    setSaveLimitOpen(false);
    setStatus(`Deleted "${draft.name}" from saved slots.`);
  }

  function handleAddTrigger() {
    if (!selectedCard) return;
    replaceDraft(addCardTrigger(draft, {
      sourceCard: selectedCard,
      event: triggerEvent,
      effect: triggerEffect,
      reminderText: triggerEffect,
    }), { refreshText: true, sync: true });
    setTriggerEvent('');
    setTriggerEffect('');
  }

  function handleAddReplacement() {
    if (!selectedCard) return;
    replaceDraft(addReplacement(draft, {
      sourceCard: selectedCard,
      replaces: replacementEvent,
      replacement: replacementEffect,
    }), { refreshText: true, sync: true });
    setReplacementEvent('');
    setReplacementEffect('');
  }

  function handleCustomCard() {
    if (!selectedCard) return;
    const [power, toughness] = customStats.includes('/') ? customStats.split('/').map(part => part.trim()) : [];
    replaceDraft(upsertCustomCard(draft, {
      name: selectedCard,
      typeLine: customType,
      oracleText: customOracle,
      power,
      toughness,
    }), { refreshText: true, sync: true });
  }

  return (
    <div data-testid="solo-deck-builder" style={{
      display: 'grid',
      gridTemplateColumns: compact ? '1fr' : 'minmax(280px, 0.9fr) minmax(320px, 1.1fr)',
      gap: 12,
      minHeight: 0,
    }}>
      <div style={panelStyle}>
        <div style={headerStyle}>
          <span>Solo Deck Builder</span>
          <span style={{ color: '#64748b' }}>{mainCount}/100</span>
        </div>
        <input
          data-testid="solo-deck-name"
          value={draft.name}
          onChange={event => replaceDraft({ ...draft, name: event.target.value })}
          style={inputStyle}
        />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 58px 104px auto', gap: 6, position: 'relative' }}>
          <input
            data-testid="solo-add-card-name"
            data-help-title="Search Card"
            data-help-body="Searches Scryfall as you type. Pick a suggestion or press Enter to fetch card text and add it to the current deck."
            data-help-placement="bottom"
            value={newCardName}
            onChange={event => setNewCardName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void addCard(); }}
            placeholder="Search Scryfall card"
            style={inputStyle}
          />
          {suggestions.length > 0 && (
            <div style={suggestionBoxStyle}>
              {suggestions.map(name => (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setNewCardName(name);
                    setSuggestions([]);
                  }}
                  style={suggestionStyle}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <input
            type="number"
            min={1}
            value={newCardCount}
            onChange={event => setNewCardCount(Number(event.target.value) || 1)}
            style={inputStyle}
          />
          <select value={newCardSection} onChange={event => setNewCardSection(event.target.value as DeckBuilderSection)} style={inputStyle}>
            {Object.entries(SECTION_LABELS).map(([section, label]) => <option key={section} value={section}>{label}</option>)}
          </select>
          <button
            data-testid="solo-add-card"
            data-help-title="Add Card"
            data-help-body="Fetches the card information from Scryfall when possible, adds the chosen count to the selected section, and updates the live deck text."
            data-help-placement="bottom"
            onClick={() => void addCard()}
            disabled={cardLookupLoading}
            style={buttonStyle(cardLookupLoading ? '#1e293b' : '#14532d', cardLookupLoading ? '#64748b' : '#86efac')}
          >
            {cardLookupLoading ? '...' : 'Add'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <label
            data-help-title="Live Test Sync"
            data-help-body="When enabled, deck edits immediately update the solo test deck so you can practice table workflow while building."
            data-help-placement="bottom"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#94a3b8' }}
          >
            <input
              type="checkbox"
              checked={liveSyncEnabled}
              onChange={event => setLiveSyncEnabled(event.target.checked)}
            />
            Live test sync
          </label>
          <span style={{ fontSize: 10, color: '#475569' }}>
            {stats.totalCards}/100 cards · Avg MV {stats.avgManaValue.toFixed(2)} · C {stats.creatureCount} / L {stats.landCount} / A {stats.artifactCount} / I {stats.instantCount} / S {stats.sorceryCount}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, overflowY: 'auto', maxHeight: compact ? 260 : 390 }}>
          {cardRows.length === 0 ? (
            <div style={{ fontSize: 11, color: '#475569', padding: 12 }}>Add cards or import a decklist to start building.</div>
          ) : cardRows.map((row, index) => {
            const summary = summarizeCardLogic(draft, row.name);
            const active = selectedCard === row.name;
            const previousRow = cardRows[index - 1];
            const showTypeHeader = !previousRow || previousRow.primaryType !== row.primaryType;
            const visibleTypeCount = showTypeHeader
              ? cardRows.filter(typeRow => typeRow.primaryType === row.primaryType).reduce((sum, typeRow) => sum + typeRow.count, 0)
              : 0;
            return (
              <div key={`${row.section}-${row.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {showTypeHeader && (
                  <div
                    data-testid={`solo-type-group-${row.primaryType.toLowerCase()}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 8px 2px',
                      color: '#94a3b8',
                      fontSize: 9,
                      fontWeight: 900,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}
                  >
                    <span>{row.primaryType}</span>
                    <span>{visibleTypeCount}</span>
                  </div>
                )}
                <button
                key={`${row.section}-${row.name}`}
                data-testid={`solo-card-row-${row.name}`}
                data-help-title="Deck Card Row"
                data-help-body="Select a card to edit notes, triggers, replacements, or custom oracle text. Rows are grouped by card type using Scryfall or custom card data."
                data-help-example={`${row.count} in ${SECTION_LABELS[row.section]}`}
                onClick={() => setSelectedCard(row.name)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '34px 1fr auto',
                  gap: 6,
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: `1px solid ${active ? '#22d3ee' : '#26323a'}`,
                  background: active ? 'rgba(34,211,238,0.1)' : '#0b0f12',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 11, color: '#94a3b8' }}>{row.count}x</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</span>
                  <span style={{ fontSize: 9, color: '#475569' }}>
                    {row.typeLine ?? row.primaryType} - {SECTION_LABELS[row.section]}
                    {summary.note ? ' · note' : ''}
                    {summary.triggers ? ` · ${summary.triggers} trigger` : ''}
                    {summary.replacements ? ` · ${summary.replacements} replacement` : ''}
                    {summary.customCard ? ' · custom' : ''}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 3 }}>
                  <span onClick={event => { event.stopPropagation(); replaceDraft(adjustDeckEntry(draft, row.section, row.name, 1), { refreshText: true, sync: true }); }} style={miniButtonStyle}>+</span>
                  <span onClick={event => { event.stopPropagation(); replaceDraft(adjustDeckEntry(draft, row.section, row.name, -1), { refreshText: true, sync: true }); }} style={miniButtonStyle}>-</span>
                </span>
                </button>
              </div>
            );
          })}
        </div>

        <div style={statsPanelStyle}>
          <StatChip label="Creatures" value={stats.creatureCount} />
          <StatChip label="Lands" value={stats.landCount} />
          <StatChip label="Artifacts" value={stats.artifactCount} />
          <StatChip label="Instants" value={stats.instantCount} />
          <StatChip label="Sorceries" value={stats.sorceryCount} />
          <StatChip label="Enchantments" value={stats.enchantmentCount} />
          <StatChip label="Planeswalkers" value={stats.planeswalkerCount} />
          <StatChip label="Commanders" value={stats.commanderCount} />
          <StatChip label="Unknown" value={stats.unknownTypeCount} />
          <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3 }}>
            {Array.from({ length: 8 }, (_, mv) => (
              <div key={mv} title={`Mana value ${mv === 7 ? '7+' : mv}: ${stats.curve[mv] ?? 0}`} style={{ minWidth: 0 }}>
                <div style={{ height: 28, display: 'flex', alignItems: 'end', background: '#0b0f12', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: '100%',
                    height: `${Math.min(100, (stats.curve[mv] ?? 0) * 12)}%`,
                    background: '#0e7490',
                  }} />
                </div>
                <div style={{ fontSize: 8, color: '#64748b', textAlign: 'center' }}>{mv === 7 ? '7+' : mv}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button data-testid="solo-save-deck" data-help-title="Save Slot" data-help-body="Saves changes into the current stored deck slot. You can keep up to three saved decks in browser storage." data-help-placement="top" onClick={handleSave} title="Save this deck into one of your 3 stored deck slots." style={buttonStyle('#1e3a5f', '#bfdbfe')}>Save Slot</button>
          <button data-testid="solo-save-as-deck" data-help-title="Duplicate Slot" data-help-body="Creates a separate saved copy of this build. If all three slots are full, export the deck file before replacing anything." data-help-placement="top" onClick={handleSaveAs} title="Duplicate this build into a new stored slot." style={buttonStyle('#312e81', '#c4b5fd')}>Duplicate Slot</button>
          <button data-testid="solo-load-deck" data-help-title="Load To Practice" data-help-body="Loads the current draft into the solo battlefield so you can test sequencing, triggers, combat, and custom card logic." data-help-placement="top" onClick={handleLoad} style={buttonStyle('#14532d', '#86efac')}>{loadLabel}</button>
          <button data-help-title="Download Deck File" data-help-body="Exports a portable deck backup with card list and custom logic. Use this when saved slots are full or to move decks between browsers." data-help-placement="top" onClick={() => handleExportFile()} title="Download a portable deck backup file." style={buttonStyle('#3f2a08', '#fbbf24')}>Download File</button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.dek,.dec,.csv,.json,.cod,.dck,text/plain,text/csv,application/json,application/xml,text/xml"
            onChange={event => {
              void handleImportFile(event.target.files?.[0]);
              event.currentTarget.value = '';
            }}
            style={{ display: 'none' }}
          />
        </div>
        {saveLimitOpen && (
          <div style={{
            fontSize: 10,
            color: '#fde68a',
            background: 'rgba(113,63,18,0.28)',
            border: '1px solid #713f12',
            borderRadius: 6,
            padding: 8,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span>Saved deck slots are full. Keep building by downloading this deck as a file.</span>
            <button data-help-title="Export Instead" data-help-body="Saved slots are full. Download this deck as a file so you can keep building without losing the current list." data-help-placement="top" onClick={() => handleExportFile()} style={buttonStyle('#713f12', '#fde68a')}>Download</button>
          </div>
        )}
        {status && <div style={{ fontSize: 10, color: '#93c5fd' }}>{status}</div>}
        {savedDecks.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {savedDecks.map(deck => (
              <button key={deck.id} data-help-title="Saved Deck" data-help-body="Switches the builder to this saved deck slot." data-help-example={`${deck.cards.reduce((sum, card) => sum + card.count, 0)} cards`} data-help-placement="top" onClick={() => handleSelectSavedDeck(deck)} style={chipStyle(draft.id === deck.id)}>
                {deck.name}
              </button>
            ))}
            <button
              data-help-title="Delete Saved Deck"
              data-help-body="Deletes the selected saved deck slot from browser storage. Export first if you may want it later."
              data-help-placement="top"
              onClick={handleDeleteDraft}
              style={buttonStyle('#450a0a', '#fca5a5')}
            >
              Delete
            </button>
          </div>
        )}
        <div style={{ fontSize: 9, color: '#475569' }}>
          Saved deck slots: {savedDecks.length}/3 · Favorites: {loadFavoriteDeckIds().length}/2
        </div>
      </div>

      <div style={panelStyle}>
        <div style={headerStyle}>
          <span>Card Logic</span>
          <span style={{ color: '#64748b' }}>{selectedCard || 'Select a card'}</span>
        </div>
        {selectedCard ? (
          <>
            <textarea
              value={logicSummary?.note ?? ''}
              onChange={event => replaceDraft(setCardNote(draft, selectedCard, event.target.value), { refreshText: true })}
              placeholder="Card note or table reminder"
              rows={2}
              style={textareaStyle}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
              <input value={triggerEvent} onChange={event => setTriggerEvent(event.target.value)} placeholder="Trigger event" style={inputStyle} />
              <input value={triggerEffect} onChange={event => setTriggerEffect(event.target.value)} placeholder="Effect/reminder" style={inputStyle} />
              <button data-help-title="Add Trigger Logic" data-help-body="Adds a reminder for an event this card cares about. The assistant can surface it during play, but players still choose how to resolve it." data-help-placement="top" onClick={handleAddTrigger} style={buttonStyle('#78350f', '#fcd34d')}>Trigger</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
              <input value={replacementEvent} onChange={event => setReplacementEvent(event.target.value)} placeholder="Would happen" style={inputStyle} />
              <input value={replacementEffect} onChange={event => setReplacementEffect(event.target.value)} placeholder="Instead..." style={inputStyle} />
              <button data-help-title="Add Replacement Logic" data-help-body="Adds a would-happen / instead reminder for replacement effects such as exile instead of dying or modifying draws." data-help-placement="top" onClick={handleAddReplacement} style={buttonStyle('#4c1d95', '#ddd6fe')}>Replace</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
              <input value={customType} onChange={event => setCustomType(event.target.value)} placeholder="Type line" style={inputStyle} />
              <input value={customStats} onChange={event => setCustomStats(event.target.value)} placeholder="2/3" style={inputStyle} />
              <button data-help-title="Save Custom Card Text" data-help-body="Stores custom type line, stats, and oracle text for this card name so practice games can show the intended logic." data-help-placement="top" onClick={handleCustomCard} style={buttonStyle('#064e3b', '#99f6e4')}>Custom</button>
            </div>
            <textarea value={customOracle} onChange={event => setCustomOracle(event.target.value)} placeholder="Custom oracle text for this card" rows={3} style={textareaStyle} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button data-help-title="Clear Note" data-help-body="Removes the table note for this card only." data-help-placement="top" onClick={() => replaceDraft(removeCardLogic(draft, selectedCard, 'note'), { refreshText: true, sync: true })} style={buttonStyle('#1e293b', '#94a3b8')}>Clear Note</button>
              <button data-help-title="Clear Triggers" data-help-body="Removes trigger reminders for this card only." data-help-placement="top" onClick={() => replaceDraft(removeCardLogic(draft, selectedCard, 'triggers'), { refreshText: true, sync: true })} style={buttonStyle('#1e293b', '#94a3b8')}>Clear Triggers</button>
              <button data-help-title="Clear Replacements" data-help-body="Removes replacement-effect reminders for this card only." data-help-placement="top" onClick={() => replaceDraft(removeCardLogic(draft, selectedCard, 'replacements'), { refreshText: true, sync: true })} style={buttonStyle('#1e293b', '#94a3b8')}>Clear Replacements</button>
              <button data-help-title="Clear Custom Text" data-help-body="Removes custom card type, stats, and oracle text for this card only." data-help-placement="top" onClick={() => replaceDraft(removeCardLogic(draft, selectedCard, 'customCard'), { refreshText: true, sync: true })} style={buttonStyle('#1e293b', '#94a3b8')}>Clear Custom</button>
            </div>
          </>
        ) : (
          <div style={{ color: '#475569', fontSize: 11 }}>Select or add a card to attach notes, triggers, replacements, or custom card text.</div>
        )}

        <div style={headerStyle}>
          <span>Import / Export Deck</span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button data-help-title="Import Deck File" data-help-body="Uploads common deck files such as txt, csv, dek, dck, xml, json, or On-Da-Stack deck backups and imports them into this solo build." data-help-placement="top" onClick={() => fileInputRef.current?.click()} style={buttonStyle('#0f172a', '#93c5fd')}>Upload File</button>
            <button data-help-title="Import Pasted Deck" data-help-body="Parses the deck text box, fetches Scryfall card data, updates type counts, and loads the result into solo testing when live sync is enabled." data-help-placement="top" onClick={() => void handleImport()} style={buttonStyle('#1d4ed8', '#dbeafe')}>Import Text</button>
          </span>
        </div>
        <div style={{ fontSize: 9, color: '#64748b' }}>
          Paste a decklist, import a downloaded deck file, or edit the generated export text. Supports common text, CSV, XML, JSON, .dek, .dec, .cod, and .dck lists.
        </div>
        <textarea
          data-testid="solo-import-export-text"
          value={exchangeText}
          onChange={event => setExchangeText(event.target.value)}
          placeholder="Paste a decklist here, upload a deck file, or use the live text generated from the current build."
          rows={compact ? 5 : 8}
          style={textareaStyle}
        />
        <textarea
          value={logicText}
          onChange={event => setLogicText(event.target.value)}
          placeholder="Optional logic import/export lines"
          rows={compact ? 4 : 6}
          style={textareaStyle}
        />
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: '#10161a',
  border: '1px solid #26323a',
  borderRadius: 8,
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
  minHeight: 0,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: '#e2e8f0',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const inputStyle: React.CSSProperties = {
  minWidth: 0,
  width: '100%',
  boxSizing: 'border-box',
  background: '#0b0f12',
  border: '1px solid #334155',
  borderRadius: 5,
  padding: '6px 8px',
  color: '#e2e8f0',
  fontSize: 11,
  outline: 'none',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'monospace',
  lineHeight: 1.45,
};

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    background,
    color,
    border: `1px solid ${color}44`,
    borderRadius: 5,
    padding: '6px 9px',
    fontSize: 10,
    fontWeight: 800,
    cursor: 'pointer',
  };
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    ...buttonStyle(active ? '#123642' : '#1e293b', active ? '#67e8f9' : '#94a3b8'),
    maxWidth: 150,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

function StatChip({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{
      background: '#0b0f12',
      border: '1px solid #26323a',
      borderRadius: 5,
      padding: '5px 6px',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 9, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function safeFileName(value: string): string {
  return (value || 'solo-lab-deck')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/^-|-$/g, '') || 'solo-lab-deck';
}

const suggestionBoxStyle: React.CSSProperties = {
  position: 'absolute',
  top: 34,
  left: 0,
  width: 'min(100%, 330px)',
  zIndex: 20,
  background: '#0b0f12',
  border: '1px solid #334155',
  borderRadius: 6,
  boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
  overflow: 'hidden',
};

const suggestionStyle: React.CSSProperties = {
  width: '100%',
  display: 'block',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid #1e293b',
  color: '#e2e8f0',
  padding: '7px 9px',
  cursor: 'pointer',
  fontSize: 11,
};

const statsPanelStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: 5,
  background: 'rgba(255,255,255,0.025)',
  border: '1px solid #1e293b',
  borderRadius: 7,
  padding: 7,
};

const miniButtonStyle: React.CSSProperties = {
  border: '1px solid #334155',
  borderRadius: 4,
  minWidth: 20,
  textAlign: 'center',
  color: '#cbd5e1',
  background: '#182127',
  fontSize: 11,
  fontWeight: 800,
};
