import { useMemo, useRef, useState } from 'react';
import { importDecklist, parseDeckFilePayload } from '../../engine/deckImport';
import {
  exportDeckJsonText,
  exportDeckText,
  importDeckFromJsonExport,
  makeDeckDownloadName,
} from '../../engine/deckImportExport';
import { validateCommanderDraft } from '../../engine/soloDeckBuilder';
import { useGameStore } from '../../store/gameStore';

export function SoloExportPanel() {
  const store = useGameStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeDeck = store.soloDeckLab.draftDeck
    ?? store.decks.find(deck => deck.id === store.soloDeckLab.activeDeckId);
  const validation = activeDeck ? validateCommanderDraft(activeDeck) : store.soloDeckLab.lastValidation;
  const exportText = useMemo(() => exportDeckText(activeDeck), [activeDeck]);
  const exportJson = useMemo(() => exportDeckJsonText(activeDeck, validation), [activeDeck, validation]);
  const [deckName, setDeckName] = useState(activeDeck?.name ?? 'Imported Solo Deck');
  const [importText, setImportText] = useState('');
  const [renameText, setRenameText] = useState(activeDeck?.name ?? '');
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);

  async function importTextDeck() {
    const raw = importText.trim();
    if (!raw) return;
    setImporting(true);
    setStatus('');
    try {
      const jsonDeck = tryImportJsonDeck(raw, deckName);
      if (jsonDeck) {
        store.setSoloDraftDeck(jsonDeck, { unsaved: true });
        setStatus(`Imported ${jsonDeck.name} from JSON export.`);
        setImportText('');
        return;
      }
      const result = await importDecklist(raw, deckName || 'Solo Deck Lab Import', undefined, undefined, undefined, {
        allowBannedCards: true,
        captureFetchedCardData: true,
      });
      store.setSoloDraftDeck(result.deck, { unsaved: true });
      setStatus(result.errors.length ? result.errors.join(' ') : `Imported ${result.cardCount} cards.`);
      setImportText('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Deck import failed.');
    } finally {
      setImporting(false);
    }
  }

  async function importFile(file?: File) {
    if (!file) return;
    setImporting(true);
    setStatus('');
    try {
      const text = await file.text();
      const jsonDeck = tryImportJsonDeck(text, file.name.replace(/\.[^.]+$/, '') || deckName);
      if (jsonDeck) {
        store.setSoloDraftDeck(jsonDeck, { unsaved: true });
        setStatus(`Imported ${jsonDeck.name} from ${file.name}.`);
        return;
      }
      const payload = parseDeckFilePayload(text, file.name.replace(/\.[^.]+$/, '') || deckName);
      if (payload.error) {
        setStatus(payload.error);
        return;
      }
      if (payload.deck) {
        store.setSoloDraftDeck(payload.deck, { unsaved: true });
        setStatus(`Loaded ${payload.deck.name} from ${file.name}.`);
        return;
      }
      if (payload.deckText) {
        const result = await importDecklist(payload.deckText, deckName || file.name.replace(/\.[^.]+$/, '') || 'Imported Deck', undefined, undefined, payload.logicText, {
          allowBannedCards: true,
          captureFetchedCardData: true,
        });
        store.setSoloDraftDeck(result.deck, { unsaved: true });
        setStatus([...payload.warnings, ...result.errors, ...result.warnings].filter(Boolean).join(' ') || `Imported ${result.cardCount} cards from ${file.name}.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Deck file import failed.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function copy(text: string, label: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`${label} copied to clipboard.`);
    } catch {
      setStatus('Clipboard copy is unavailable in this browser. Select the text and copy manually.');
    }
  }

  function download(text: string, filename: string, type: string) {
    if (!text) return;
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Downloaded ${filename}.`);
  }

  function saveActiveDeck() {
    const saved = store.saveSoloDraftDeck();
    setStatus(saved ? 'Saved active deck to local storage.' : 'Load or import a deck before saving.');
  }

  function renameActiveDeck() {
    if (!activeDeck) return;
    const renamed = store.renameSoloDeck(activeDeck.id, renameText || activeDeck.name);
    setStatus(renamed ? 'Renamed saved deck.' : 'Save this deck before renaming it.');
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <section style={panelStyle}>
        <div style={sectionTitleStyle}>Saved Decks</div>
        {store.decks.length === 0 && <div style={mutedStyle}>No saved local decks yet.</div>}
        {store.decks.map(deck => (
          <div key={deck.id} style={savedDeckRowStyle}>
            <div>
              <div style={{ color: '#f8fafc', fontSize: 12, fontWeight: 900 }}>{deck.name}</div>
              <div style={mutedStyle}>{deck.commanders.join(', ') || 'No commander'} | {deck.cards.reduce((sum, card) => sum + card.count, 0)} cards</div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => store.loadSoloDeck(deck)} style={smallButtonStyle}>Load</button>
              <button type="button" onClick={() => store.duplicateSoloDeck(deck.id)} style={smallButtonStyle}>Duplicate</button>
              <button type="button" onClick={() => store.deleteSoloDeck(deck.id)} style={dangerButtonStyle}>Delete</button>
            </div>
          </div>
        ))}
      </section>

      <section style={panelStyle}>
        <div style={sectionTitleStyle}>Import</div>
        <input value={deckName} onChange={event => setDeckName(event.target.value)} placeholder="Deck name" style={inputStyle} />
        <textarea
          value={importText}
          onChange={event => setImportText(event.target.value)}
          placeholder="Paste deck text or Solo JSON export..."
          rows={7}
          style={textareaStyle}
        />
        <div style={buttonRowStyle}>
          <button type="button" disabled={importing || !importText.trim()} onClick={() => void importTextDeck()} style={buttonStyle}>
            {importing ? 'Importing...' : 'Import Text / JSON'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.json,.dek,.cod,.csv,.xml"
            onChange={event => void importFile(event.target.files?.[0])}
            style={{ display: 'none' }}
          />
          <button type="button" disabled={importing} onClick={() => fileInputRef.current?.click()} style={buttonStyle}>
            Import File
          </button>
        </div>
      </section>

      <section style={panelStyle}>
        <div style={sectionTitleStyle}>Active Deck</div>
        <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 900 }}>{activeDeck?.name ?? 'No active deck'}</div>
        <div style={mutedStyle}>
          {validation ? `${validation.cardCount}/100 | ${validation.commanders.length} commander${validation.commanders.length === 1 ? '' : 's'}` : 'No validation summary'}
          {store.soloDeckLab.unsavedChanges ? ' | Unsaved changes' : ''}
        </div>
        {(validation?.errors ?? []).map(error => <div key={error} style={errorStyle}>{error}</div>)}
        {(validation?.warnings ?? []).map(warning => <div key={warning} style={warningStyle}>{warning}</div>)}
        <div style={buttonRowStyle}>
          <button type="button" disabled={!activeDeck} onClick={saveActiveDeck} style={buttonStyle}>Save Local Deck</button>
          <input value={renameText} onChange={event => setRenameText(event.target.value)} placeholder="Rename deck" style={inputStyle} />
          <button type="button" disabled={!activeDeck} onClick={renameActiveDeck} style={buttonStyle}>Rename</button>
          <button type="button" disabled={!activeDeck} onClick={() => activeDeck && store.duplicateSoloDeck(activeDeck.id)} style={buttonStyle}>Duplicate</button>
        </div>
      </section>

      <section style={panelStyle}>
        <div style={sectionTitleStyle}>Export Plain Text</div>
        <textarea readOnly data-testid="solo-export-text" value={exportText} placeholder="Load a deck to export it." rows={10} style={textareaStyle} />
        <div style={buttonRowStyle}>
          <button type="button" disabled={!exportText} onClick={() => void copy(exportText, 'Decklist')} style={buttonStyle}>Copy Decklist</button>
          <button type="button" disabled={!exportText} onClick={() => download(exportText, makeDeckDownloadName(activeDeck, 'txt'), 'text/plain')} style={buttonStyle}>Download .txt</button>
        </div>
      </section>

      <section style={panelStyle}>
        <div style={sectionTitleStyle}>Export JSON</div>
        <textarea readOnly data-testid="solo-export-json" value={exportJson} placeholder="Load a deck to export JSON." rows={10} style={textareaStyle} />
        <div style={buttonRowStyle}>
          <button type="button" disabled={!exportJson} onClick={() => void copy(exportJson, 'Deck JSON')} style={buttonStyle}>Copy JSON</button>
          <button type="button" disabled={!exportJson} onClick={() => download(exportJson, makeDeckDownloadName(activeDeck, 'json'), 'application/json')} style={buttonStyle}>Download .json</button>
        </div>
      </section>

      {status && <div style={{ color: '#93c5fd', fontSize: 11 }}>{status}</div>}
    </div>
  );
}

function tryImportJsonDeck(raw: string, fallbackName: string) {
  try {
    return importDeckFromJsonExport(raw, fallbackName);
  } catch {
    return null;
  }
}

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: 10,
};

const sectionTitleStyle: React.CSSProperties = {
  color: '#e2e8f0',
  fontSize: 11,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const mutedStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 11,
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

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const savedDeckRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 8,
  alignItems: 'center',
  padding: '8px 9px',
  borderRadius: 7,
  border: '1px solid #26323a',
  background: '#0b0f12',
};

const buttonStyle: React.CSSProperties = {
  background: '#1e3a5f',
  color: '#bfdbfe',
  border: '1px solid #60a5fa55',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 10,
  fontWeight: 900,
  cursor: 'pointer',
  textTransform: 'uppercase',
};

const smallButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#182127',
  color: '#cbd5e1',
  border: '1px solid #334155',
};

const dangerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: '1px solid #7f1d1d',
  color: '#fca5a5',
};

const errorStyle: React.CSSProperties = {
  color: '#fca5a5',
  fontSize: 10,
};

const warningStyle: React.CSSProperties = {
  color: '#fcd34d',
  fontSize: 10,
};
