import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { importDecklist } from '../../engine/deckImport';
import {
  adjustDeckEntry,
  getGroupedDeckBuilderRows,
  markDeckCommander,
  setDeckEntryCount,
  unmarkDeckCommander,
  validateCommanderDraft,
  type DeckBuilderGroupBy,
  type DeckBuilderRow,
  type DeckBuilderSection,
} from '../../engine/soloDeckBuilder';
import { getDeckCardCount } from './soloUiModel';

const SECTION_LABELS: Record<DeckBuilderSection, string> = {
  commander: 'Commander',
  main: 'Main Deck',
  sideboard: 'Sideboard',
  maybeboard: 'Maybeboard',
};

const GROUP_LABELS: Record<DeckBuilderGroupBy, string> = {
  type: 'Type',
  manaValue: 'Mana Value',
  color: 'Color',
  none: 'None',
};

export function SoloBuilderPanel() {
  const store = useGameStore();
  const activeDeck = store.soloDeckLab.draftDeck
    ?? store.decks.find(deck => deck.id === store.soloDeckLab.activeDeckId);
  const validation = activeDeck ? validateCommanderDraft(activeDeck) : store.soloDeckLab.lastValidation;
  const [deckName, setDeckName] = useState('');
  const [deckText, setDeckText] = useState('');
  const [newCardName, setNewCardName] = useState('');
  const [newCardCount, setNewCardCount] = useState(1);
  const [newCardSection, setNewCardSection] = useState<DeckBuilderSection>('main');
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<DeckBuilderGroupBy>('type');
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState('');

  const groups = useMemo(
    () => activeDeck ? getGroupedDeckBuilderRows(activeDeck, groupBy, search) : [],
    [activeDeck, groupBy, search],
  );
  const mainCount = activeDeck ? getDeckCardCount(activeDeck) : 0;
  const commanderCount = activeDeck?.commanders.length ?? 0;
  const unsaved = Boolean(store.soloDeckLab.unsavedChanges);

  function updateDraft(nextDeck: NonNullable<typeof activeDeck>) {
    store.setSoloDraftDeck(nextDeck, { unsaved: true });
  }

  function createDraft() {
    store.createSoloDraftDeck(deckName.trim() || 'Untitled Solo Deck');
    setStatus('Created a new local draft deck.');
  }

  function addCard() {
    if (!activeDeck || !newCardName.trim()) return;
    const next = setDeckEntryCount(activeDeck, newCardSection, newCardName, newCardSection === 'commander' ? 1 : newCardCount);
    updateDraft(next);
    setNewCardName('');
    setNewCardCount(1);
    setStatus(`Added ${newCardName.trim()} to ${SECTION_LABELS[newCardSection]}.`);
  }

  async function importForLab() {
    if (!deckText.trim()) return;
    setImporting(true);
    setStatus('');
    try {
      const result = await importDecklist(deckText, deckName || 'Solo Deck Lab Import', undefined, undefined, undefined, {
        allowBannedCards: true,
        captureFetchedCardData: true,
      });
      store.setSoloDraftDeck(result.deck, { unsaved: true });
      setDeckName('');
      setDeckText('');
      setStatus(result.errors.length ? result.errors.join(' ') : `Imported ${result.cardCount} cards into the local draft.`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Deck import failed.');
    } finally {
      setImporting(false);
    }
  }

  function saveDraft() {
    const saved = store.saveSoloDraftDeck();
    setStatus(saved ? 'Saved Deck Lab draft.' : 'Create or load a deck before saving.');
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={summaryStyle}>
        <div>
          <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 900 }}>
            {activeDeck?.name ?? 'No builder draft loaded'}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>
            {mainCount}/100 cards including commanders | {commanderCount} commander{commanderCount === 1 ? '' : 's'}
            {unsaved ? ' | Unsaved changes' : ''}
          </div>
        </div>
        <div style={{
          color: validation?.valid ? '#86efac' : '#fca5a5',
          fontSize: 11,
          fontWeight: 900,
          border: `1px solid ${validation?.valid ? '#166534' : '#7f1d1d'}`,
          borderRadius: 999,
          padding: '6px 10px',
          background: validation?.valid ? 'rgba(22,101,52,0.22)' : 'rgba(127,29,29,0.18)',
        }}>
          {validation?.valid ? 'Commander valid' : 'Needs fixes'}
        </div>
      </div>

      {!activeDeck && (
        <div data-testid="solo-empty-deck-state" style={panelStyle}>
          <div style={{ color: '#94a3b8', fontSize: 11 }}>Create a draft or import a decklist to use the Deck Lab builder.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <input value={deckName} onChange={event => setDeckName(event.target.value)} placeholder="New deck name" style={inputStyle} />
            <button type="button" onClick={createDraft} style={buttonStyle('#14532d', '#dcfce7')}>Create Draft</button>
          </div>
        </div>
      )}

      {activeDeck && (
        <>
          <div style={panelStyle}>
            <div style={sectionTitleStyle}>Decklist editor</div>
            <input
              data-testid="solo-builder-deck-name"
              value={activeDeck.name}
              onChange={event => updateDraft({ ...activeDeck, name: event.target.value, importedAt: Date.now() })}
              style={inputStyle}
            />
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, 1fr) 58px 118px auto', gap: 6 }}>
              <input
                data-testid="solo-builder-add-card-name"
                value={newCardName}
                onChange={event => setNewCardName(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') addCard(); }}
                placeholder="Card name"
                style={inputStyle}
              />
              <input
                type="number"
                min={1}
                value={newCardCount}
                onChange={event => setNewCardCount(Math.max(1, Number(event.target.value) || 1))}
                style={inputStyle}
              />
              <select value={newCardSection} onChange={event => setNewCardSection(event.target.value as DeckBuilderSection)} style={inputStyle}>
                {Object.entries(SECTION_LABELS).map(([section, label]) => <option key={section} value={section}>{label}</option>)}
              </select>
              <button type="button" data-testid="solo-builder-add-card" onClick={addCard} style={buttonStyle('#14532d', '#dcfce7')}>Add</button>
            </div>
          </div>

          <div style={panelStyle}>
            <div style={sectionTitleStyle}>Commander section</div>
            {activeDeck.commanders.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 11 }}>No commander marked yet.</div>
            ) : activeDeck.commanders.map(name => (
              <CommanderRow key={name} name={name} onUnmark={() => updateDraft(unmarkDeckCommander(activeDeck, name))} />
            ))}
          </div>

          <div style={panelStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px 120px', gap: 8 }}>
              <input
                data-testid="solo-builder-search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search decklist"
                style={inputStyle}
              />
              <select value={groupBy} onChange={event => setGroupBy(event.target.value as DeckBuilderGroupBy)} style={inputStyle}>
                {Object.entries(GROUP_LABELS).map(([value, label]) => <option key={value} value={value}>Group: {label}</option>)}
              </select>
              <button type="button" onClick={saveDraft} style={buttonStyle('#1e3a5f', '#bfdbfe')}>{unsaved ? 'Save Draft' : 'Saved'}</button>
            </div>

            <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflowY: 'auto', paddingRight: 2 }}>
              {groups.map(group => (
                <div key={group.key} data-testid={`solo-builder-group-${group.key}`} style={{ display: 'grid', gap: 4 }}>
                  <div style={groupHeaderStyle}>
                    <span>{group.label}</span>
                    <span>{group.count}</span>
                  </div>
                  {group.rows.map(row => (
                    <DeckRow
                      key={`${row.section}-${row.name}`}
                      row={row}
                      isCommander={activeDeck.commanders.some(name => name.toLowerCase() === row.name.toLowerCase())}
                      onIncrement={() => updateDraft(adjustDeckEntry(activeDeck, row.section, row.name, 1))}
                      onDecrement={() => updateDraft(adjustDeckEntry(activeDeck, row.section, row.name, -1))}
                      onRemove={() => updateDraft(setDeckEntryCount(activeDeck, row.section, row.name, 0))}
                      onMarkCommander={() => updateDraft(markDeckCommander(activeDeck, row.name))}
                      onUnmarkCommander={() => updateDraft(unmarkDeckCommander(activeDeck, row.name))}
                    />
                  ))}
                </div>
              ))}
              {groups.length === 0 && <div style={{ color: '#64748b', fontSize: 11 }}>No cards match this search.</div>}
            </div>
          </div>
        </>
      )}

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>Validation</div>
        <div style={{ color: validation?.valid ? '#86efac' : '#fca5a5', fontSize: 11, fontWeight: 800 }}>
          {validation ? `${validation.cardCount}/100 | ${validation.commanders.length} commander${validation.commanders.length === 1 ? '' : 's'}` : 'No validation yet'}
        </div>
        {(validation?.errors ?? []).map(error => <div key={error} style={{ color: '#fca5a5', fontSize: 10 }}>{error}</div>)}
        {(validation?.warnings ?? []).map(warning => <div key={warning} style={{ color: '#fcd34d', fontSize: 10 }}>{warning}</div>)}
        {validation?.valid && <div style={{ color: '#86efac', fontSize: 10 }}>Ready to save/use for Solo testing.</div>}
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>Import decklist</div>
        <input value={deckName} onChange={event => setDeckName(event.target.value)} placeholder="Deck name" style={inputStyle} />
        <textarea
          data-testid="solo-deck-import-text"
          value={deckText}
          onChange={event => setDeckText(event.target.value)}
          placeholder="Paste decklist..."
          rows={6}
          style={textareaStyle}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="solo-import-deck"
            onClick={() => void importForLab()}
            disabled={importing || !deckText.trim()}
            style={buttonStyle(importing || !deckText.trim() ? '#1e293b' : '#166534', importing || !deckText.trim() ? '#64748b' : '#dcfce7')}
          >
            {importing ? 'Importing...' : 'Import as Draft'}
          </button>
          {activeDeck && (
            <button
              type="button"
              data-testid="solo-builder-use-goldfish"
              onClick={() => void store.startSoloDeckLabGame('goldfish')}
              style={buttonStyle('#332511', '#fde68a')}
            >
              Use in Goldfish
            </button>
          )}
        </div>
        {status && <div style={{ color: '#93c5fd', fontSize: 10 }}>{status}</div>}
      </div>
    </div>
  );
}

function CommanderRow({ name, onUnmark }: { name: string; onUnmark: () => void }) {
  return (
    <div style={rowStyle}>
      <div>
        <div style={{ color: '#f8fafc', fontSize: 12, fontWeight: 800 }}>{name}</div>
        <div style={{ color: '#64748b', fontSize: 10 }}>Commander</div>
      </div>
      <button type="button" onClick={onUnmark} style={smallButtonStyle}>Unmark</button>
    </div>
  );
}

function DeckRow({
  row,
  isCommander,
  onIncrement,
  onDecrement,
  onRemove,
  onMarkCommander,
  onUnmarkCommander,
}: {
  row: DeckBuilderRow;
  isCommander: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  onMarkCommander: () => void;
  onUnmarkCommander: () => void;
}) {
  return (
    <div data-testid={`solo-builder-row-${row.name}`} style={rowStyle}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {row.count}x {row.name}
        </div>
        <div style={{ color: '#64748b', fontSize: 10 }}>
          {SECTION_LABELS[row.section]} | {row.typeLine ?? row.primaryType}
          {typeof row.manaValue === 'number' ? ` | MV ${row.manaValue}` : ''}
          {row.colorIdentity?.length ? ` | ${row.colorIdentity.join('')}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {row.section !== 'commander' && <button type="button" onClick={onIncrement} style={smallButtonStyle}>+</button>}
        {row.section !== 'commander' && <button type="button" onClick={onDecrement} style={smallButtonStyle}>-</button>}
        {isCommander
          ? <button type="button" onClick={onUnmarkCommander} style={smallButtonStyle}>Unmark</button>
          : <button type="button" onClick={onMarkCommander} style={smallButtonStyle}>Commander</button>}
        <button type="button" onClick={onRemove} style={smallDangerButtonStyle}>Remove</button>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: 10,
};

const summaryStyle: React.CSSProperties = {
  ...panelStyle,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const sectionTitleStyle: React.CSSProperties = {
  color: '#e2e8f0',
  fontSize: 11,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const inputStyle: React.CSSProperties = {
  minWidth: 0,
  background: '#111827',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  padding: '7px 9px',
  fontSize: 11,
  boxSizing: 'border-box',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'monospace',
  lineHeight: 1.45,
};

const groupHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  color: '#94a3b8',
  fontSize: 9,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  padding: '4px 2px',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 8,
  alignItems: 'center',
  padding: '7px 8px',
  border: '1px solid #26323a',
  borderRadius: 7,
  background: '#0b0f12',
};

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    background,
    color,
    border: `1px solid ${color}44`,
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 10,
    fontWeight: 900,
    cursor: 'pointer',
    textTransform: 'uppercase',
  };
}

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid #334155',
  borderRadius: 5,
  background: '#182127',
  color: '#cbd5e1',
  fontSize: 10,
  fontWeight: 800,
  padding: '4px 7px',
  cursor: 'pointer',
};

const smallDangerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: '1px solid #7f1d1d',
  color: '#fca5a5',
};
