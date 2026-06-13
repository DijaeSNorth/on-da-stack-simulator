import { useState } from 'react';
import {
  formatSoloPerformanceReportText,
  generateSoloPerformanceReport,
  serializeSoloPerformanceReport,
} from '../../engine/soloPerformanceEngine';
import { saveSoloReport } from '../../engine/soloReportStorage';
import { useGameStore } from '../../store/gameStore';
import type { SoloPerformanceReport } from '../../types/game';

interface SoloPerformancePanelProps {
  sessionType: 'goldfish' | 'dummy';
}

export function SoloPerformancePanel({ sessionType }: SoloPerformancePanelProps) {
  const store = useGameStore();
  const [report, setReport] = useState<SoloPerformanceReport | null>(null);
  const [status, setStatus] = useState('');
  const activeDeck = store.soloDeckLab.draftDeck
    ?? store.decks.find(deck => deck.id === store.soloDeckLab.activeDeckId);
  const session = store.soloDeckLab.testSession;
  const sessionReady = store.game.status === 'playing' &&
    (session?.mode === sessionType || (sessionType === 'dummy' && store.game.players.some(player => player.isDummy)));

  function generateReport() {
    const next = generateSoloPerformanceReport(store.game, store.game.actionLog, {
      deck: activeDeck,
      session,
      testedPlayerId: store.localPlayerId || store.game.players.find(player => !player.isDummy)?.id,
      sessionType,
    });
    setReport(next);
    setStatus('Report generated.');
  }

  function saveReport() {
    if (!report) return;
    saveSoloReport(report);
    setStatus('Report saved to this browser. Export report history if you want a backup.');
  }

  async function copyReport() {
    if (!report) return;
    const text = formatSoloPerformanceReportText(report);
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setStatus('Clipboard unavailable in this environment.');
      return;
    }
    await navigator.clipboard.writeText(text);
    setStatus('Report copied.');
  }

  function exportJson() {
    if (!report || typeof document === 'undefined') return;
    const blob = new Blob([serializeSoloPerformanceReport(report)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `${report.deckName ?? report.deckId ?? 'solo'}-performance-report.json`.replace(/[^a-z0-9._-]+/gi, '-');
    link.click();
    URL.revokeObjectURL(href);
    setStatus('Report JSON exported.');
  }

  return (
    <section data-testid="solo-performance-panel" style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={titleStyle}>Performance Report</div>
          <div style={mutedStyle}>
            Summarizes this {sessionType} session from the action log and current game state.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button type="button" data-testid="solo-generate-report" disabled={!sessionReady} onClick={generateReport} style={buttonStyle(sessionReady)}>
            Generate Report
          </button>
          <button type="button" disabled={!report} onClick={saveReport} style={buttonStyle(Boolean(report))}>
            Save Report
          </button>
          <button type="button" disabled={!report} onClick={() => void copyReport()} style={buttonStyle(Boolean(report))}>
            Copy Report
          </button>
          <button type="button" disabled={!report} onClick={exportJson} style={buttonStyle(Boolean(report))}>
            Export JSON
          </button>
        </div>
      </div>

      {!sessionReady && (
        <div style={mutedStyle}>Start a {sessionType} session before generating a report.</div>
      )}

      {report && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={summaryGridStyle}>
            <Summary label="Turns" value={report.turnsPlayed} />
            <Summary label="Actions" value={report.actionsCount} />
            <Summary label="Lands" value={report.manaDevelopment.landsPlayed} />
            <Summary label="Damage dealt" value={report.combat.totalDamageDealt} />
            <Summary label="Damage taken" value={report.combat.totalDamageTaken} />
            <Summary label="Cards drawn" value={report.cardFlow.cardsDrawn} />
          </div>

          <ReportSection title="Opening Hand">
            {report.openingHand ? (
              <>
                <Metric label="Lands" value={report.openingHand.landCount} />
                <Metric label="Nonlands" value={report.openingHand.nonlandCount} />
                <Metric label="Average MV" value={report.openingHand.averageManaValue?.toFixed(2) ?? 'Unknown'} />
                <Metric label="Mulligans" value={report.openingHand.mulligansTaken ?? 0} />
                <Metric label="Kept size" value={report.openingHand.keptHandSize ?? 'Unknown'} />
              </>
            ) : (
              <div style={mutedStyle}>Opening hand details were not available.</div>
            )}
          </ReportSection>

          <ReportSection title="Mana Development">
            <Metric label="First three turn land drops" value={report.manaDevelopment.firstThreeTurnsLandDrops} />
            <Metric label="Missed land drop turns" value={report.manaDevelopment.turnsMissedLandDrop.join(', ') || 'None'} />
          </ReportSection>

          <ReportSection title="Board Development">
            <Metric label="First permanent turn" value={report.boardDevelopment.firstPermanentTurn ?? 'Unknown'} />
            <Metric label="First creature turn" value={report.boardDevelopment.firstCreatureTurn ?? 'Unknown'} />
            <Metric label="Creatures played" value={report.boardDevelopment.creaturesPlayed} />
            <Metric label="Noncreature spells" value={report.boardDevelopment.noncreatureSpellsPlayed} />
            <Metric label="Tokens created" value={report.boardDevelopment.tokensCreated} />
          </ReportSection>

          <ReportSection title="Combat">
            <Metric label="First attack" value={report.combat.turnOfFirstAttack ?? 'None'} />
            <Metric label="Lethal turn" value={report.combat.turnOfLethal ?? 'None'} />
            <Metric label="Attacks declared" value={report.combat.attacksDeclared} />
            <Metric label="Blocks declared" value={report.combat.blockersDeclared} />
          </ReportSection>

          <ReportSection title="Card Flow">
            <Metric label="Discarded" value={report.cardFlow.cardsDiscarded} />
            <Metric label="Tutored/searched" value={report.cardFlow.cardsTutoredOrSearched} />
            <Metric label="Hand at end" value={report.cardFlow.cardsInHandAtEnd} />
          </ReportSection>

          {report.dummy && (
            <ReportSection title="Dummy Pressure">
              <Metric label="Profile" value={report.dummy.profile ?? 'Unknown'} />
              <Metric label="Archetype" value={report.dummy.archetype ?? 'None'} />
              <Metric label="Pressure taken" value={report.dummy.pressureTaken ?? 0} />
              <Metric label="Survived to turn" value={report.dummy.survivedToTurn ?? 'No'} />
              <Metric label="Combo clock" value={report.dummy.comboClockTurn ?? 'None'} />
              <Metric label="Dummy actions" value={report.dummy.dummyActionsCount ?? 0} />
            </ReportSection>
          )}

          <ListSection title="Suggestions" items={report.suggestions} emptyText="No rough testing hints yet." />
          <ListSection title="Warnings" items={report.warnings} emptyText="No report warnings." />
        </div>
      )}

      {status && <div style={{ color: '#93c5fd', fontSize: 11 }}>{status}</div>}
    </section>
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

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      <div style={metricGridStyle}>{children}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ color: '#64748b', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function ListSection({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      {items.length === 0 ? (
        <div style={mutedStyle}>{emptyText}</div>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
          {items.map(item => <li key={item} style={{ color: '#cbd5e1', fontSize: 11 }}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  background: '#0b0f12',
  border: '1px solid #334155',
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

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(94px, 1fr))',
  gap: 7,
};

const summaryStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #1e293b',
  borderRadius: 7,
  padding: 8,
};

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 7,
  padding: 8,
};

const sectionTitleStyle: React.CSSProperties = {
  color: '#bfdbfe',
  fontSize: 10,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const metricGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(116px, 1fr))',
  gap: 8,
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
