import { useGameStore } from '../../store/gameStore';
import { CardImage, ManaCost } from './CardImage';
import type { CardState } from '../../types/game';

interface CardPreviewProps {
  card: CardState;
  onClose?: () => void;
}

export function CardPreview({ card, onClose }: CardPreviewProps) {
  const def = card.definition;

  return (
    <div style={{
      position: 'fixed', right: 16, top: 60, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 12,
      pointerEvents: 'none',
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '1px solid #2d2d4a',
        borderRadius: 12,
        padding: 12,
        width: 280,
        boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
        pointerEvents: 'auto',
      }}>
        <CardImage card={card} size="preview" />
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#e2e8f0' }}>{def.name}</span>
            {def.manaCost && <ManaCost cost={def.manaCost.raw} />}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{def.typeLine}</div>
          {def.oracleText && (
            <div style={{
              fontSize: 11, color: '#cbd5e1', background: 'rgba(255,255,255,0.04)',
              borderRadius: 6, padding: '6px 8px', lineHeight: 1.5, marginBottom: 6,
              maxHeight: 120, overflowY: 'auto',
            }}>
              {def.oracleText.split('\n').map((line, i) => <p key={i} style={{ margin: '0 0 4px 0' }}>{line}</p>)}
            </div>
          )}
          {def.flavorText && (
            <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', marginBottom: 6 }}>{def.flavorText}</div>
          )}
          {(def.power !== undefined || def.loyalty !== undefined) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <span style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                {def.power !== undefined ? `${def.power}/${def.toughness}` : `[${def.loyalty}]`}
              </span>
            </div>
          )}
          {card.counters.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>Counters:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {card.counters.map(c => (
                  <span key={c.type} style={{
                    background: c.type === '+1/+1' ? '#166534' : c.type === '-1/-1' ? '#991b1b' : '#4338ca',
                    color: '#fff', fontSize: 10, fontWeight: 600, borderRadius: 4, padding: '1px 6px',
                  }}>{c.type} ×{c.count}</span>
                ))}
              </div>
            </div>
          )}
          {card.notes && <div style={{ marginTop: 8, fontSize: 10, color: '#facc15' }}>Note: {card.notes}</div>}
          {card.zone === 'exile' && card.exileReason && (
            <div style={{ marginTop: 6, fontSize: 10, color: '#f97316' }}>
              Exiled by: {card.exileReason}
              {card.exileReturn && ` · Returns: ${card.exileReturn}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function FloatingCardPreview() {
  const { ui, game, setCardPreview } = useGameStore();
  const card = ui.cardPreview ? game.cards[ui.cardPreview] : null;
  if (!card) return null;
  return <CardPreview card={card} onClose={() => setCardPreview(null)} />;
}
