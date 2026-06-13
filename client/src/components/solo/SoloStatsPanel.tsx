import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import { analyzeDeck, type DeckStatsColorKey, type DeckStatsCurveKey } from '../../engine/deckStats';
import { getDeckCommanderLine, getValidationLabel } from './soloUiModel';

const CURVE_KEYS: DeckStatsCurveKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', 'unknown'];
const COLOR_KEYS: DeckStatsColorKey[] = ['W', 'U', 'B', 'R', 'G', 'Colorless', 'Unknown'];

export function SoloStatsPanel() {
  const store = useGameStore();
  const activeDeck = store.soloDeckLab.draftDeck
    ?? store.decks.find(deck => deck.id === store.soloDeckLab.activeDeckId);
  const validation = store.soloDeckLab.lastValidation;
  const badge = getValidationLabel(validation);
  const stats = useMemo(() => analyzeDeck(activeDeck), [activeDeck]);
  const maxCurve = Math.max(1, ...CURVE_KEYS.map(key => stats.manaCurve[key]));

  if (!activeDeck) {
    return (
      <div data-testid="solo-stats-empty" style={emptyStyle}>
        Load or create a deck to see Commander stats.
      </div>
    );
  }

  return (
    <div data-testid="solo-stats-panel" style={{ display: 'grid', gap: 12 }}>
      <div style={summaryGridStyle}>
        <SummaryCard label="Cards" value={stats.totalCards} detail={`${stats.mainDeckCount} main / ${stats.commanderCount} commander`} />
        <SummaryCard label="Lands" value={stats.landCount} detail={`${stats.nonlandCount} nonland`} />
        <SummaryCard label="Creatures" value={stats.creatureCount} detail={`${stats.instantSorceryCount} instant/sorcery`} />
        <SummaryCard label="Avg MV" value={stats.averageManaValue.toFixed(2)} detail="lands excluded" />
      </div>

      <section style={panelStyle}>
        <Header title="Deck identity" aside={badge.label} color={badge.color} />
        <div style={{ color: '#cbd5e1', fontSize: 11 }}>
          <strong style={{ color: '#f8fafc' }}>Deck:</strong> {activeDeck.name}
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 11 }}>
          <strong style={{ color: '#f8fafc' }}>Commanders:</strong> {getDeckCommanderLine(activeDeck)}
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 11 }}>
          <strong style={{ color: '#f8fafc' }}>Color identity:</strong> {stats.colorIdentity.length ? stats.colorIdentity.join('') : 'Unknown / colorless'}
        </div>
      </section>

      <section style={panelStyle}>
        <Header title="Mana curve" aside={`${stats.unknownManaValueCount} unknown MV`} />
        <div style={curveGridStyle}>
          {CURVE_KEYS.map(key => {
            const value = stats.manaCurve[key];
            const height = Math.max(6, Math.round((value / maxCurve) * 72));
            return (
              <div key={key} style={curveColumnStyle} title={`${curveLabel(key)}: ${value}`}>
                <div style={curveBarTrackStyle}>
                  <div style={{ ...curveBarStyle, height }} />
                </div>
                <div style={curveLabelStyle}>{curveLabel(key)}</div>
                <div style={curveCountStyle}>{value}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={panelStyle}>
        <Header title="Type breakdown" />
        <div style={breakdownGridStyle}>
          <StatLine label="Land" value={stats.landCount} />
          <StatLine label="Nonland" value={stats.nonlandCount} />
          <StatLine label="Creature" value={stats.creatureCount} />
          <StatLine label="Instant/Sorcery" value={stats.instantSorceryCount} />
          <StatLine label="Artifact" value={stats.artifactCount} />
          <StatLine label="Enchantment" value={stats.enchantmentCount} />
          <StatLine label="Planeswalker" value={stats.planeswalkerCount} />
          <StatLine label="Battle" value={stats.battleCount} />
        </div>
      </section>

      <section style={panelStyle}>
        <Header title="Color distribution" />
        <div style={breakdownGridStyle}>
          {COLOR_KEYS.map(key => (
            <StatLine key={key} label={key} value={stats.colorDistribution[key]} />
          ))}
        </div>
      </section>

      <section style={panelStyle}>
        <Header title="Commander testing categories" aside="heuristic/manual placeholders" />
        <div style={breakdownGridStyle}>
          <StatLine label="Ramp" value={stats.rampCount} />
          <StatLine label="Draw" value={stats.drawCount} />
          <StatLine label="Removal" value={stats.removalCount} />
          <StatLine label="Board wipes" value={stats.boardWipeCount} />
        </div>
        <div style={{ color: '#64748b', fontSize: 10 }}>
          These are lightweight oracle-text hints for testing, not final deckbuilding judgments.
        </div>
      </section>

      <section style={panelStyle}>
        <Header title="Warnings" />
        {(validation?.errors ?? []).map(error => <WarningLine key={error} tone="error" text={error} />)}
        {(validation?.warnings ?? []).map(warning => <WarningLine key={warning} tone="warning" text={warning} />)}
        {stats.warnings.map(warning => <WarningLine key={warning} tone="warning" text={warning} />)}
        {validation?.valid && stats.warnings.length === 0 && (
          <div style={{ color: '#86efac', fontSize: 10 }}>No stats warnings for the current draft.</div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <div style={summaryCardStyle}>
      <div style={{ color: '#64748b', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#f8fafc', fontSize: 22, fontWeight: 900 }}>{value}</div>
      <div style={{ color: '#94a3b8', fontSize: 10 }}>{detail}</div>
    </div>
  );
}

function Header({ title, aside, color = '#94a3b8' }: { title: string; aside?: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
      <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {title}
      </div>
      {aside && <div style={{ color, fontSize: 10, fontWeight: 800 }}>{aside}</div>}
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={statLineStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WarningLine({ tone, text }: { tone: 'error' | 'warning'; text: string }) {
  return (
    <div style={{ color: tone === 'error' ? '#fca5a5' : '#fcd34d', fontSize: 10 }}>
      {text}
    </div>
  );
}

function curveLabel(key: DeckStatsCurveKey): string {
  if (key === '7') return '7+';
  if (key === 'unknown') return '?';
  return key;
}

const emptyStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: 11,
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: 12,
};

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: 10,
};

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 8,
};

const summaryCardStyle: React.CSSProperties = {
  background: '#0b0f12',
  border: '1px solid #26323a',
  borderRadius: 8,
  padding: 10,
  minWidth: 0,
};

const curveGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(9, minmax(0, 1fr))',
  gap: 6,
  alignItems: 'end',
};

const curveColumnStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 0,
  textAlign: 'center',
};

const curveBarTrackStyle: React.CSSProperties = {
  height: 78,
  display: 'flex',
  alignItems: 'end',
  justifyContent: 'center',
  background: '#0b0f12',
  border: '1px solid #1e293b',
  borderRadius: 5,
  overflow: 'hidden',
};

const curveBarStyle: React.CSSProperties = {
  width: '100%',
  background: 'linear-gradient(180deg, #22c55e, #0e7490)',
};

const curveLabelStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 9,
  fontWeight: 800,
};

const curveCountStyle: React.CSSProperties = {
  color: '#e2e8f0',
  fontSize: 10,
  fontWeight: 900,
};

const breakdownGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 6,
};

const statLineStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  background: '#0b0f12',
  border: '1px solid #26323a',
  borderRadius: 6,
  padding: '6px 8px',
  color: '#cbd5e1',
  fontSize: 11,
};
