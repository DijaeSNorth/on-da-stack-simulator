import { useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { CardState, Phase } from '../../types/game';
import type { ReactNode } from 'react';
import type { SoloDeckLabStartOptions } from './SoloDeckLab';

interface SoloSandboxPanelProps {
  startOptions?: SoloDeckLabStartOptions;
}

const phaseOptions: Phase[] = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'beginningOfCombat',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'endOfCombat',
  'main2',
  'endStep',
  'cleanup',
];

const zoneOptions: CardState['zone'][] = ['battlefield', 'hand', 'graveyard', 'exile', 'library', 'command'];

const panelStyle = {
  display: 'grid',
  gap: 10,
} as const;

const sectionStyle = {
  display: 'grid',
  gap: 8,
  padding: 10,
  borderRadius: 8,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(15, 23, 42, 0.58)',
} as const;

const rowStyle = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
} as const;

const labelStyle = {
  color: '#cbd5e1',
  fontSize: 11,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: 0.04,
} as const;

const inputStyle = {
  minWidth: 72,
  padding: '7px 8px',
  borderRadius: 7,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: '#020617',
  color: '#e2e8f0',
  fontSize: 12,
} as const;

const buttonStyle = {
  padding: '8px 10px',
  borderRadius: 7,
  border: '1px solid rgba(245, 158, 11, 0.55)',
  background: '#332511',
  color: '#fde68a',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 900,
  textTransform: 'uppercase',
} as const;

function SandboxSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={sectionStyle}>
      <div style={labelStyle}>{title}</div>
      {children}
    </section>
  );
}

export function SoloSandboxPanel({ startOptions }: SoloSandboxPanelProps) {
  const store = useGameStore();
  const [drawCount, setDrawCount] = useState(1);
  const [revealCount, setRevealCount] = useState(3);
  const [tokenName, setTokenName] = useState('Goblin');
  const [tokenCount, setTokenCount] = useState(1);
  const [tokenPower, setTokenPower] = useState('1');
  const [tokenToughness, setTokenToughness] = useState('1');
  const [lifeTotal, setLifeTotal] = useState(40);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [selectedZone, setSelectedZone] = useState<CardState['zone']>('battlefield');
  const [counterType, setCounterType] = useState('+1/+1');
  const [counterAmount, setCounterAmount] = useState(1);
  const [overridePower, setOverridePower] = useState('3');
  const [overrideToughness, setOverrideToughness] = useState('3');
  const [phase, setPhase] = useState<Phase>('main1');
  const [manaNote, setManaNote] = useState('');
  const [cardNote, setCardNote] = useState('');
  const [triggerText, setTriggerText] = useState('');

  const canUseSandbox = store.canUseSoloSandboxTools();
  const player = store.game.players.find(current => current.id === store.localPlayerId) ?? store.game.players[0];
  const selectableCards = useMemo(() => {
    if (!player) return [];
    return Object.values(store.game.cards)
      .filter(card => card.controllerId === player.id && card.zone !== 'library')
      .sort((a, b) => `${a.zone}-${a.definition.name}`.localeCompare(`${b.zone}-${b.definition.name}`));
  }, [store.game.cards, player]);
  const activeCardId = selectedCardId || selectableCards[0]?.instanceId || '';
  const activeCard = activeCardId ? store.game.cards[activeCardId] : undefined;

  const disabled = !canUseSandbox;

  return (
    <div style={panelStyle}>
      <div style={{ color: '#94a3b8', fontSize: 11 }}>
        Sandbox tools are limited to Solo games unless judge mode is enabled. Actions are logged for replay/export review.
      </div>

      <button
        type="button"
        data-testid="solo-start-sandbox"
        onClick={() => void store.startSoloDeckLabGame('sandbox', startOptions)}
        style={buttonStyle}
      >
        Start Sandbox
      </button>

      {!canUseSandbox && (
        <div style={{ padding: 10, borderRadius: 8, background: '#1e293b', color: '#cbd5e1', fontSize: 12 }}>
          Start a Solo sandbox game to use these tools. Judge mode can also enable them for manual corrections.
        </div>
      )}

      <SandboxSection title="Draw / Search">
        <div style={rowStyle}>
          <input
            aria-label="Draw count"
            type="number"
            min={1}
            value={drawCount}
            onChange={event => setDrawCount(Number(event.target.value) || 1)}
            style={inputStyle}
          />
          <button type="button" disabled={disabled} onClick={() => store.sandboxDrawCards(drawCount)} style={buttonStyle}>
            Draw X
          </button>
          <input
            aria-label="Reveal count"
            type="number"
            min={1}
            value={revealCount}
            onChange={event => setRevealCount(Number(event.target.value) || 1)}
            style={inputStyle}
          />
          <button type="button" disabled={disabled} onClick={() => store.sandboxRevealTopCards(revealCount)} style={buttonStyle}>
            Reveal Top X
          </button>
          <button type="button" disabled={disabled} onClick={() => store.sandboxSearchLibrary()} style={buttonStyle}>
            Search Library
          </button>
          <button type="button" disabled={disabled} onClick={() => store.sandboxShuffleLibrary()} style={buttonStyle}>
            Shuffle
          </button>
        </div>
      </SandboxSection>

      <SandboxSection title="Board">
        <div style={rowStyle}>
          <select
            aria-label="Sandbox selected card"
            value={activeCardId}
            onChange={event => setSelectedCardId(event.target.value)}
            style={{ ...inputStyle, minWidth: 220 }}
          >
            {selectableCards.length === 0 && <option value="">No selectable cards</option>}
            {selectableCards.map(card => (
              <option key={card.instanceId} value={card.instanceId}>
                {card.definition.name} ({card.zone})
              </option>
            ))}
          </select>
          <select
            aria-label="Move card zone"
            value={selectedZone}
            onChange={event => setSelectedZone(event.target.value as CardState['zone'])}
            style={inputStyle}
          >
            {zoneOptions.map(zone => <option key={zone} value={zone}>{zone}</option>)}
          </select>
          <button type="button" disabled={disabled || !activeCard} onClick={() => store.sandboxMoveCardToZone(activeCardId, selectedZone)} style={buttonStyle}>
            Move Card
          </button>
          <input
            aria-label="Life total"
            type="number"
            value={lifeTotal}
            onChange={event => setLifeTotal(Number(event.target.value) || 0)}
            style={inputStyle}
          />
          <button type="button" disabled={disabled} onClick={() => store.sandboxSetLifeTotal(lifeTotal)} style={buttonStyle}>
            Set Life
          </button>
          <button type="button" disabled={disabled} onClick={() => store.sandboxResetBoard()} style={buttonStyle}>
            Reset Board
          </button>
        </div>
      </SandboxSection>

      <SandboxSection title="Counters / P/T">
        <div style={rowStyle}>
          <input
            aria-label="Counter type"
            value={counterType}
            onChange={event => setCounterType(event.target.value)}
            style={inputStyle}
          />
          <input
            aria-label="Counter amount"
            type="number"
            min={1}
            value={counterAmount}
            onChange={event => setCounterAmount(Number(event.target.value) || 1)}
            style={inputStyle}
          />
          <button type="button" disabled={disabled || !activeCard} onClick={() => store.sandboxAddCounter(activeCardId, counterType, counterAmount)} style={buttonStyle}>
            Add Counter
          </button>
          <button type="button" disabled={disabled || !activeCard} onClick={() => store.sandboxRemoveCounter(activeCardId, counterType, counterAmount)} style={buttonStyle}>
            Remove Counter
          </button>
          <input
            aria-label="Override power"
            value={overridePower}
            onChange={event => setOverridePower(event.target.value)}
            style={inputStyle}
          />
          <input
            aria-label="Override toughness"
            value={overrideToughness}
            onChange={event => setOverrideToughness(event.target.value)}
            style={inputStyle}
          />
          <button
            type="button"
            disabled={disabled || !activeCard}
            onClick={() => store.sandboxSetPowerToughnessOverride([activeCardId], overridePower, overrideToughness)}
            style={buttonStyle}
          >
            Set P/T
          </button>
          <button type="button" disabled={disabled || !activeCard} onClick={() => store.sandboxClearPowerToughnessOverride([activeCardId])} style={buttonStyle}>
            Clear P/T
          </button>
        </div>
      </SandboxSection>

      <SandboxSection title="Tokens">
        <div style={rowStyle}>
          <input aria-label="Token name" value={tokenName} onChange={event => setTokenName(event.target.value)} style={inputStyle} />
          <input aria-label="Token count" type="number" min={1} value={tokenCount} onChange={event => setTokenCount(Number(event.target.value) || 1)} style={inputStyle} />
          <input aria-label="Token power" value={tokenPower} onChange={event => setTokenPower(event.target.value)} style={inputStyle} />
          <input aria-label="Token toughness" value={tokenToughness} onChange={event => setTokenToughness(event.target.value)} style={inputStyle} />
          <button type="button" disabled={disabled} onClick={() => store.sandboxCreateToken(tokenName, tokenCount, tokenPower, tokenToughness)} style={buttonStyle}>
            Create Token
          </button>
        </div>
      </SandboxSection>

      <SandboxSection title="Turn / Phase">
        <div style={rowStyle}>
          <select aria-label="Sandbox phase" value={phase} onChange={event => setPhase(event.target.value as Phase)} style={inputStyle}>
            {phaseOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <button type="button" disabled={disabled} onClick={() => store.sandboxForcePhase(phase)} style={buttonStyle}>
            Force Phase
          </button>
          <button type="button" disabled={disabled} onClick={() => store.sandboxAdvanceTurn()} style={buttonStyle}>
            Next Turn
          </button>
        </div>
      </SandboxSection>

      <SandboxSection title="Notes / Triggers">
        <div style={rowStyle}>
          <input
            aria-label="Mana note"
            placeholder="Mana/resource note"
            value={manaNote}
            onChange={event => setManaNote(event.target.value)}
            style={{ ...inputStyle, minWidth: 180 }}
          />
          <button type="button" disabled={disabled || !manaNote.trim()} onClick={() => store.sandboxAddManaNote(manaNote)} style={buttonStyle}>
            Add Resource Note
          </button>
          <input
            aria-label="Card note"
            placeholder="Card note"
            value={cardNote}
            onChange={event => setCardNote(event.target.value)}
            style={{ ...inputStyle, minWidth: 180 }}
          />
          <button type="button" disabled={disabled || !activeCard || !cardNote.trim()} onClick={() => store.sandboxSetCardNote(activeCardId, cardNote)} style={buttonStyle}>
            Add Card Note
          </button>
          <input
            aria-label="Manual trigger"
            placeholder="Manual trigger"
            value={triggerText}
            onChange={event => setTriggerText(event.target.value)}
            style={{ ...inputStyle, minWidth: 180 }}
          />
          <button type="button" disabled={disabled || !activeCard || !triggerText.trim()} onClick={() => store.sandboxAddManualTrigger(activeCardId, triggerText)} style={buttonStyle}>
            Add Trigger
          </button>
        </div>
      </SandboxSection>
    </div>
  );
}
