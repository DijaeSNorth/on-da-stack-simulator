import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  deleteDeck,
  exportDeckAsText,
  importDecklist,
  loadFavoriteDeckIds,
  saveDeck,
} from '../../engine/deckImport';
import { fetchCardByName } from '../../data/cardDatabase';
import {
  addCardTrigger,
  addReplacement,
  adjustDeckEntry,
  createBlankDeck,
  customCardFromDefinition,
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

  const cardRows = useMemo(() => {
    const rows = [
      ...draft.commanders.map(name => ({ section: 'commander' as const, name, count: 1 })),
      ...draft.cards.map(card => ({ section: 'main' as const, name: card.name, count: card.count })),
      ...draft.sideboard.map(card => ({ section: 'sideboard' as const, name: card.name, count: card.count })),
      ...draft.maybeboard.map(card => ({ section: 'maybeboard' as const, name: card.name, count: card.count })),
    ];
    return rows;
  }, [draft]);
  const mainCount = draft.cards.reduce((sum, card) => sum + card.count, 0);
  const logicSummary = selectedCard ? summarizeCardLogic(draft, selectedCard) : undefined;

  function replaceDraft(next: Deck) {
    setDraft(next);
    if (!selectedCard && next.cards[0]) setSelectedCard(next.cards[0].name);
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
      setExchangeText(exportDeckAsText(next));
      setLogicText(serializeDeckLogic(next));
      await syncDeckForTesting(next);
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
    saveDeck({ ...draft, importedAt: Date.now() });
    store.loadDecks();
    setStatus(`Saved "${draft.name}".`);
  }

  function handleSaveAs() {
    const copy = { ...draft, id: crypto.randomUUID(), name: `${draft.name} Copy`, importedAt: Date.now() };
    saveDeck(copy);
    store.loadDecks();
    setDraft(copy);
    setStatus(`Saved as "${copy.name}".`);
  }

  async function handleLoad() {
    handleSave();
    if (onLoadDeck) await onLoadDeck(draft);
    else if (playerId) await store.loadDeck(playerId, draft);
    setStatus(`Loaded "${draft.name}" for testing.`);
  }

  async function handleImport() {
    if (!exchangeText.trim()) return;
    setStatus('Importing deck...');
    const result = await importDecklist(exchangeText, draft.name || 'Solo Lab Import', 'solo-builder', playerId, logicText);
    setDraft(result.deck);
    setSelectedCard(result.deck.commanders[0] ?? result.deck.cards[0]?.name ?? '');
    store.saveDeckToStorage(result.deck);
    setStatus(result.errors.length ? result.errors.join(' ') : `Imported ${result.cardCount} cards. ${result.warnings[0] ?? ''}`);
  }

  function handleExport() {
    setExchangeText(exportDeckAsText(draft));
    setLogicText(serializeDeckLogic(draft));
    setStatus('Export text refreshed.');
  }

  function handleAddTrigger() {
    if (!selectedCard) return;
    replaceDraft(addCardTrigger(draft, {
      sourceCard: selectedCard,
      event: triggerEvent,
      effect: triggerEffect,
      reminderText: triggerEffect,
    }));
    setTriggerEvent('');
    setTriggerEffect('');
  }

  function handleAddReplacement() {
    if (!selectedCard) return;
    replaceDraft(addReplacement(draft, {
      sourceCard: selectedCard,
      replaces: replacementEvent,
      replacement: replacementEffect,
    }));
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
    }));
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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 58px 104px auto', gap: 6 }}>
          <input
            data-testid="solo-add-card-name"
            value={newCardName}
            onChange={event => setNewCardName(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') void addCard(); }}
            placeholder="Card name"
            style={inputStyle}
          />
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
            onClick={() => void addCard()}
            disabled={cardLookupLoading}
            style={buttonStyle(cardLookupLoading ? '#1e293b' : '#14532d', cardLookupLoading ? '#64748b' : '#86efac')}
          >
            {cardLookupLoading ? '...' : 'Add'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, overflowY: 'auto', maxHeight: compact ? 260 : 390 }}>
          {cardRows.length === 0 ? (
            <div style={{ fontSize: 11, color: '#475569', padding: 12 }}>Add cards or import a decklist to start building.</div>
          ) : cardRows.map(row => {
            const summary = summarizeCardLogic(draft, row.name);
            const active = selectedCard === row.name;
            return (
              <button
                key={`${row.section}-${row.name}`}
                data-testid={`solo-card-row-${row.name}`}
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
                    {SECTION_LABELS[row.section]}
                    {summary.note ? ' · note' : ''}
                    {summary.triggers ? ` · ${summary.triggers} trigger` : ''}
                    {summary.replacements ? ` · ${summary.replacements} replacement` : ''}
                    {summary.customCard ? ' · custom' : ''}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 3 }}>
                  <span onClick={event => { event.stopPropagation(); replaceDraft(adjustDeckEntry(draft, row.section, row.name, 1)); }} style={miniButtonStyle}>+</span>
                  <span onClick={event => { event.stopPropagation(); replaceDraft(adjustDeckEntry(draft, row.section, row.name, -1)); }} style={miniButtonStyle}>-</span>
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button data-testid="solo-save-deck" onClick={handleSave} style={buttonStyle('#1e3a5f', '#bfdbfe')}>Save</button>
          <button data-testid="solo-save-as-deck" onClick={handleSaveAs} style={buttonStyle('#312e81', '#c4b5fd')}>Save As</button>
          <button data-testid="solo-load-deck" onClick={handleLoad} style={buttonStyle('#14532d', '#86efac')}>{loadLabel}</button>
          <button onClick={handleExport} style={buttonStyle('#1e293b', '#fbbf24')}>Export</button>
        </div>
        {status && <div style={{ fontSize: 10, color: '#93c5fd' }}>{status}</div>}
        {savedDecks.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {savedDecks.map(deck => (
              <button key={deck.id} onClick={() => { setDraft(deck); setSelectedCard(deck.commanders[0] ?? deck.cards[0]?.name ?? ''); }} style={chipStyle(draft.id === deck.id)}>
                {deck.name}
              </button>
            ))}
            <button
              onClick={() => {
                deleteDeck(draft.id);
                store.loadDecks();
                setDraft(createBlankDeck('Solo Lab Deck'));
              }}
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
              onChange={event => replaceDraft(setCardNote(draft, selectedCard, event.target.value))}
              placeholder="Card note or table reminder"
              rows={2}
              style={textareaStyle}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
              <input value={triggerEvent} onChange={event => setTriggerEvent(event.target.value)} placeholder="Trigger event" style={inputStyle} />
              <input value={triggerEffect} onChange={event => setTriggerEffect(event.target.value)} placeholder="Effect/reminder" style={inputStyle} />
              <button onClick={handleAddTrigger} style={buttonStyle('#78350f', '#fcd34d')}>Trigger</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
              <input value={replacementEvent} onChange={event => setReplacementEvent(event.target.value)} placeholder="Would happen" style={inputStyle} />
              <input value={replacementEffect} onChange={event => setReplacementEffect(event.target.value)} placeholder="Instead..." style={inputStyle} />
              <button onClick={handleAddReplacement} style={buttonStyle('#4c1d95', '#ddd6fe')}>Replace</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
              <input value={customType} onChange={event => setCustomType(event.target.value)} placeholder="Type line" style={inputStyle} />
              <input value={customStats} onChange={event => setCustomStats(event.target.value)} placeholder="2/3" style={inputStyle} />
              <button onClick={handleCustomCard} style={buttonStyle('#064e3b', '#99f6e4')}>Custom</button>
            </div>
            <textarea value={customOracle} onChange={event => setCustomOracle(event.target.value)} placeholder="Custom oracle text for this card" rows={3} style={textareaStyle} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => replaceDraft(removeCardLogic(draft, selectedCard, 'note'))} style={buttonStyle('#1e293b', '#94a3b8')}>Clear Note</button>
              <button onClick={() => replaceDraft(removeCardLogic(draft, selectedCard, 'triggers'))} style={buttonStyle('#1e293b', '#94a3b8')}>Clear Triggers</button>
              <button onClick={() => replaceDraft(removeCardLogic(draft, selectedCard, 'replacements'))} style={buttonStyle('#1e293b', '#94a3b8')}>Clear Replacements</button>
              <button onClick={() => replaceDraft(removeCardLogic(draft, selectedCard, 'customCard'))} style={buttonStyle('#1e293b', '#94a3b8')}>Clear Custom</button>
            </div>
          </>
        ) : (
          <div style={{ color: '#475569', fontSize: 11 }}>Select or add a card to attach notes, triggers, replacements, or custom card text.</div>
        )}

        <div style={headerStyle}>
          <span>Import / Export</span>
          <button onClick={handleImport} style={buttonStyle('#1d4ed8', '#dbeafe')}>Import Text</button>
        </div>
        <textarea
          data-testid="solo-import-export-text"
          value={exchangeText}
          onChange={event => setExchangeText(event.target.value)}
          placeholder="Paste a decklist here, or click Export to generate one from the builder."
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
