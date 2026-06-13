import { prepareCommanderDeckForUse } from '../../engine/deckImport';
import type { Deck } from '../../types/game';

const BASIC_LANDS = new Set([
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
  'Wastes',
  'Snow-Covered Plains',
  'Snow-Covered Island',
  'Snow-Covered Swamp',
  'Snow-Covered Mountain',
  'Snow-Covered Forest',
]);

interface DeckHealthPanelProps {
  deck: Deck;
  compact?: boolean;
}

export function DeckHealthPanel({ deck, compact = false }: DeckHealthPanelProps) {
  const prepared = prepareCommanderDeckForUse(deck);
  const totalCards = prepared.totalCommanderCount;
  const duplicateCount = prepared.deck.cards.filter(card => card.count > 1 && !BASIC_LANDS.has(card.name)).length;
  const commanderCount = prepared.deck.commanders.length;
  const landCount = prepared.deck.cards
    .filter(card => BASIC_LANDS.has(card.name) || /\b(tower|sanctum|foundry|forge|heath|vista|land|gate|pool|garden|island|plains|swamp|mountain|forest)\b/i.test(card.name))
    .reduce((sum, card) => sum + card.count, 0);

  const checks = [
    { label: totalCards === 100 ? '100 cards' : `${totalCards}/100 cards`, state: totalCards === 100 ? 'good' : 'warn' },
    { label: commanderCount > 0 ? `${commanderCount} commander${commanderCount > 1 ? 's' : ''}` : 'No commander', state: commanderCount > 0 ? 'good' : 'warn' },
    { label: duplicateCount === 0 ? 'Singleton clean' : `${duplicateCount} duplicate${duplicateCount > 1 ? 's' : ''}`, state: duplicateCount === 0 ? 'good' : 'warn' },
    { label: `${landCount} likely land${landCount === 1 ? '' : 's'}`, state: landCount >= 34 && landCount <= 42 ? 'good' : 'info' },
  ] as const;

  const ready = prepared.valid;

  return (
    <div
      data-testid="deck-health-panel"
      style={{
        background: ready ? 'rgba(20,83,45,0.18)' : 'rgba(120,53,15,0.14)',
        border: `1px solid ${ready ? '#14532d' : '#78350f'}`,
        borderRadius: 6,
        padding: compact ? 8 : 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
        <div style={{ fontSize: 10, color: ready ? '#86efac' : '#fcd34d', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Deck Health
        </div>
        <div style={{ fontSize: 9, color: ready ? '#86efac' : '#f59e0b', fontWeight: 700 }}>
          {ready ? 'Commander ready' : 'Needs review'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {checks.map(check => (
          <span
            key={check.label}
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: check.state === 'good' ? '#86efac' : check.state === 'warn' ? '#fcd34d' : '#93c5fd',
              background: check.state === 'good' ? 'rgba(20,83,45,0.55)' : check.state === 'warn' ? 'rgba(120,53,15,0.55)' : 'rgba(30,58,95,0.5)',
              border: `1px solid ${check.state === 'good' ? '#14532d' : check.state === 'warn' ? '#78350f' : '#1e3a5f'}`,
              borderRadius: 999,
              padding: '2px 7px',
            }}
          >
            {check.label}
          </span>
        ))}
      </div>
      {!compact && !ready && (
        <div style={{ color: '#94a3b8', fontSize: 10, lineHeight: 1.4, marginTop: 7 }}>
          You can still test this deck in Solo. Table games keep multiplayer legality guardrails on.
        </div>
      )}
    </div>
  );
}
