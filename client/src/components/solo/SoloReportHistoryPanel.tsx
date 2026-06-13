import { useMemo, useState } from 'react';
import {
  SOLO_REPORT_CLEAR_WARNING,
  SOLO_REPORT_EXPORT_WARNING,
  SOLO_REPORT_IMPORT_WARNING,
  buildSoloReportHistoryViewModel,
  clearSoloReports,
  compareSoloReports,
  deleteSoloReport,
  exportSoloReportHistory,
  getSavedSoloReportsWithWarnings,
  importSoloReportHistory,
  saveSoloReport,
  updateSoloReportMetadata,
} from '../../engine/soloReportStorage';
import { generateSoloPerformanceReport } from '../../engine/soloPerformanceEngine';
import { useGameStore } from '../../store/gameStore';
import type { SavedSoloReport } from '../../types/game';

export function SoloReportHistoryPanel() {
  const store = useGameStore();
  const initialRead = useMemo(() => getSavedSoloReportsWithWarnings(), []);
  const [reports, setReports] = useState<SavedSoloReport[]>(initialRead.reports);
  const [warnings, setWarnings] = useState<string[]>(initialRead.warnings);
  const [deckId, setDeckId] = useState('');
  const [sessionType, setSessionType] = useState<'all' | 'goldfish' | 'dummy'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [detailId, setDetailId] = useState('');
  const [compareFirstId, setCompareFirstId] = useState('');
  const [compareSecondId, setCompareSecondId] = useState('');
  const [importText, setImportText] = useState('');
  const [status, setStatus] = useState('');
  const activeDeck = store.soloDeckLab.draftDeck
    ?? store.decks.find(deck => deck.id === store.soloDeckLab.activeDeckId);
  const currentSessionType = store.soloDeckLab.testSession?.mode === 'dummy' || store.game.players.some(player => player.isDummy)
    ? 'dummy'
    : 'goldfish';
  const canSaveCurrent = store.game.status === 'playing' &&
    (store.soloDeckLab.testSession?.mode === 'goldfish' || store.soloDeckLab.testSession?.mode === 'dummy' || store.game.players.some(player => player.isDummy));
  const view = buildSoloReportHistoryViewModel(reports, {
    deckId: deckId || undefined,
    sessionType,
    query,
    sort,
  });
  const detail = reports.find(report => report.id === detailId);
  const compareFirst = reports.find(report => report.id === compareFirstId);
  const compareSecond = reports.find(report => report.id === compareSecondId);
  const comparison = compareFirst && compareSecond && compareFirst.id !== compareSecond.id
    ? compareSoloReports(compareFirst, compareSecond)
    : undefined;

  function refresh(nextReports?: SavedSoloReport[], nextWarnings: string[] = []) {
    if (nextReports) {
      setReports(nextReports);
      setWarnings(nextWarnings);
      return;
    }
    const read = getSavedSoloReportsWithWarnings();
    setReports(read.reports);
    setWarnings(read.warnings);
  }

  function saveCurrentReport() {
    if (!canSaveCurrent) {
      setStatus('Start a goldfish or dummy session before saving a report.');
      return;
    }
    const report = generateSoloPerformanceReport(store.game, store.game.actionLog, {
      deck: activeDeck,
      session: store.soloDeckLab.testSession,
      testedPlayerId: store.localPlayerId || store.game.players.find(player => !player.isDummy)?.id,
      sessionType: currentSessionType,
    });
    saveSoloReport(report);
    refresh();
    setStatus('Current report saved to this browser.');
  }

  function exportHistory() {
    if (!confirmIfAvailable(SOLO_REPORT_EXPORT_WARNING)) return;
    const raw = exportSoloReportHistory();
    if (typeof document === 'undefined') {
      setStatus('Export JSON is ready, but downloads are unavailable in this environment.');
      return;
    }
    const blob = new Blob([raw], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = 'on-da-stack-solo-report-history.json';
    link.click();
    URL.revokeObjectURL(href);
    setStatus('Report history export created. You are responsible for storing it safely.');
  }

  function importHistory() {
    if (!importText.trim()) {
      setStatus('Paste exported report history JSON before importing.');
      return;
    }
    if (!confirmIfAvailable(SOLO_REPORT_IMPORT_WARNING)) return;
    const imported = importSoloReportHistory(importText);
    refresh(imported.reports, imported.warnings);
    setStatus(`Imported ${imported.importedCount} report${imported.importedCount === 1 ? '' : 's'} into this browser.`);
  }

  function removeReport(id: string) {
    refresh(deleteSoloReport(id));
    if (detailId === id) setDetailId('');
    if (compareFirstId === id) setCompareFirstId('');
    if (compareSecondId === id) setCompareSecondId('');
    setStatus('Report deleted from this browser.');
  }

  function clearHistory() {
    if (!confirmIfAvailable(SOLO_REPORT_CLEAR_WARNING)) return;
    clearSoloReports();
    refresh([]);
    setDetailId('');
    setCompareFirstId('');
    setCompareSecondId('');
    setStatus('Report history cleared from this browser.');
  }

  function addNote(report: SavedSoloReport) {
    const note = promptIfAvailable('Add or replace report note:', report.notes ?? '');
    if (note === undefined) return;
    refresh(updateSoloReportMetadata(report.id, { notes: note }));
    setStatus('Report note updated.');
  }

  function addTag(report: SavedSoloReport) {
    const tag = promptIfAvailable('Add tag:', '');
    if (!tag?.trim()) return;
    const tags = [...(report.tags ?? []), tag.trim()];
    refresh(updateSoloReportMetadata(report.id, { tags }));
    setStatus('Report tag updated.');
  }

  return (
    <div data-testid="solo-report-history-panel" style={{ display: 'grid', gap: 10 }}>
      <section style={panelStyle}>
        <div style={titleStyle}>Solo Report History</div>
        <div data-testid="solo-report-responsibility-copy" style={warningStyle}>{view.warningText}</div>
        <div style={mutedStyle}>
          Local history is user-managed data, not cloud backup or account storage.
        </div>
        <div style={buttonRowStyle}>
          <button type="button" data-testid="solo-save-current-report" disabled={!canSaveCurrent} onClick={saveCurrentReport} style={buttonStyle(canSaveCurrent)}>
            Save Current Report
          </button>
          <button type="button" onClick={exportHistory} disabled={reports.length === 0} style={buttonStyle(reports.length > 0)}>
            Export History
          </button>
          <button type="button" onClick={clearHistory} disabled={reports.length === 0} style={dangerButtonStyle(reports.length > 0)}>
            Clear History
          </button>
        </div>
      </section>

      <section style={panelStyle}>
        <div style={titleStyle}>Filters</div>
        <div style={formGridStyle}>
          <select value={deckId} onChange={event => setDeckId(event.target.value)} style={inputStyle}>
            <option value="">All decks</option>
            {view.deckOptions.map(deck => <option key={deck.deckId} value={deck.deckId}>{deck.deckName}</option>)}
          </select>
          <select value={sessionType} onChange={event => setSessionType(event.target.value as typeof sessionType)} style={inputStyle}>
            <option value="all">All sessions</option>
            <option value="goldfish">Goldfish</option>
            <option value="dummy">Dummy</option>
          </select>
          <select value={sort} onChange={event => setSort(event.target.value as typeof sort)} style={inputStyle}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search notes, tags, deck" style={inputStyle} />
        </div>
        <div style={mutedStyle}>{view.visibleCount}/{view.totalCount} reports visible.</div>
      </section>

      <section style={panelStyle}>
        <div style={titleStyle}>Saved Reports</div>
        {view.reports.length === 0 ? (
          <div style={mutedStyle}>No saved reports match the current filters.</div>
        ) : (
          <div style={{ display: 'grid', gap: 7 }}>
            {view.reports.map(report => (
              <div key={report.id} style={rowStyle}>
                <div>
                  <div style={nameStyle}>{report.deckName ?? report.deckId ?? 'Untitled deck'}</div>
                  <div style={mutedStyle}>
                    {new Date(report.savedAt).toLocaleString()} | {report.sessionType} | turns {report.report.turnsPlayed} | damage {report.report.combat.totalDamageDealt}/{report.report.combat.totalDamageTaken} | lands {report.report.manaDevelopment.landsPlayed} | mulligans {report.report.openingHand?.mulligansTaken ?? 0} | hints {report.report.suggestions.length}
                  </div>
                  {(report.tags?.length || report.notes) ? (
                    <div style={mutedStyle}>
                      {report.tags?.length ? `Tags: ${report.tags.join(', ')}` : ''}
                      {report.notes ? ` ${report.notes}` : ''}
                    </div>
                  ) : null}
                </div>
                <div style={buttonRowStyle}>
                  <button type="button" onClick={() => setDetailId(report.id)} style={smallButtonStyle}>View Details</button>
                  <button type="button" onClick={() => addNote(report)} style={smallButtonStyle}>Add Note</button>
                  <button type="button" onClick={() => addTag(report)} style={smallButtonStyle}>Add Tag</button>
                  <button type="button" onClick={() => removeReport(report.id)} style={smallDangerButtonStyle}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={panelStyle}>
        <div style={titleStyle}>Compare Reports</div>
        <div style={formGridStyle}>
          <select value={compareFirstId} onChange={event => setCompareFirstId(event.target.value)} style={inputStyle}>
            <option value="">First report</option>
            {reports.map(report => <option key={report.id} value={report.id}>{report.deckName ?? report.id} | {new Date(report.savedAt).toLocaleDateString()}</option>)}
          </select>
          <select value={compareSecondId} onChange={event => setCompareSecondId(event.target.value)} style={inputStyle}>
            <option value="">Second report</option>
            {reports.map(report => <option key={report.id} value={report.id}>{report.deckName ?? report.id} | {new Date(report.savedAt).toLocaleDateString()}</option>)}
          </select>
        </div>
        {comparison ? (
          <div style={{ display: 'grid', gap: 4 }}>
            {comparison.metrics.map(metric => (
              <div key={metric.label} style={compareRowStyle}>
                <span>{metric.label}</span>
                <span>{metric.first}</span>
                <span>{metric.second}</span>
                <span>{metric.difference === undefined ? '' : metric.difference > 0 ? `+${metric.difference}` : metric.difference}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={mutedStyle}>Choose two different reports for a side-by-side comparison.</div>
        )}
      </section>

      {detail && (
        <section style={panelStyle}>
          <div style={titleStyle}>Report Details</div>
          <div style={summaryGridStyle}>
            <Summary label="Turns" value={detail.report.turnsPlayed} />
            <Summary label="Actions" value={detail.report.actionsCount} />
            <Summary label="Damage dealt" value={detail.report.combat.totalDamageDealt} />
            <Summary label="Damage taken" value={detail.report.combat.totalDamageTaken} />
            <Summary label="Cards drawn" value={detail.report.cardFlow.cardsDrawn} />
            <Summary label="Suggestions" value={detail.report.suggestions.length} />
          </div>
          {detail.report.suggestions.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {detail.report.suggestions.map(suggestion => <li key={suggestion} style={{ color: '#cbd5e1', fontSize: 11 }}>{suggestion}</li>)}
            </ul>
          )}
        </section>
      )}

      <section style={panelStyle}>
        <div style={titleStyle}>Import History</div>
        <div style={warningStyle}>{SOLO_REPORT_IMPORT_WARNING}</div>
        <textarea value={importText} onChange={event => setImportText(event.target.value)} placeholder="Paste exported report history JSON" style={{ ...inputStyle, minHeight: 72 }} />
        <button type="button" onClick={importHistory} style={buttonStyle(Boolean(importText.trim()))}>Import History</button>
      </section>

      {warnings.length > 0 && <div style={warningStyle}>{warnings.join(' ')}</div>}
      {status && <div style={{ color: '#93c5fd', fontSize: 11 }}>{status}</div>}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={summaryStyle}>
      <div style={{ color: '#64748b', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function confirmIfAvailable(message: string): boolean {
  return typeof window === 'undefined' || typeof window.confirm !== 'function' || window.confirm(message);
}

function promptIfAvailable(message: string, value: string): string | undefined {
  if (typeof window === 'undefined' || typeof window.prompt !== 'function') return undefined;
  const result = window.prompt(message, value);
  return result === null ? undefined : result;
}

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: 10,
};

const titleStyle: React.CSSProperties = {
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

const warningStyle: React.CSSProperties = {
  color: '#fde68a',
  fontSize: 11,
};

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
  gap: 7,
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

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 7,
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'flex-end',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 8,
  alignItems: 'center',
  padding: '8px 9px',
  borderRadius: 7,
  border: '1px solid #26323a',
  background: '#0b0f12',
};

const nameStyle: React.CSSProperties = {
  color: '#f8fafc',
  fontSize: 12,
  fontWeight: 900,
};

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))',
  gap: 7,
};

const summaryStyle: React.CSSProperties = {
  background: '#0b0f12',
  border: '1px solid #26323a',
  borderRadius: 7,
  padding: 8,
};

const compareRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 70px 70px 60px',
  gap: 6,
  color: '#cbd5e1',
  fontSize: 11,
  padding: '5px 0',
  borderBottom: '1px solid #1e293b',
};

function buttonStyle(enabled: boolean): React.CSSProperties {
  return {
    background: enabled ? '#1e3a5f' : '#1e293b',
    color: enabled ? '#bfdbfe' : '#64748b',
    border: `1px solid ${enabled ? '#60a5fa55' : '#334155'}`,
    borderRadius: 6,
    padding: '7px 10px',
    fontSize: 10,
    fontWeight: 900,
    cursor: enabled ? 'pointer' : 'not-allowed',
    textTransform: 'uppercase',
  };
}

function dangerButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    ...buttonStyle(enabled),
    border: enabled ? '1px solid #7f1d1d' : '1px solid #334155',
    color: enabled ? '#fca5a5' : '#64748b',
  };
}

const smallButtonStyle: React.CSSProperties = {
  ...buttonStyle(true),
  background: '#182127',
  color: '#cbd5e1',
  border: '1px solid #334155',
};

const smallDangerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: '1px solid #7f1d1d',
  color: '#fca5a5',
};
