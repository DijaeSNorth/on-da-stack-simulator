import { useGameStore } from '../../store/gameStore';
import { CardImage, ManaCost } from './CardImage';
import type { CardState } from '../../types/game';
import { getMechanicBadgesForCard, getMechanicHint, getMechanicsForCard } from '../../rules/mechanicsRegistry';
import { getEffectivePowerToughness } from '../../engine/gameEngine';

interface CardPreviewProps {
  card: CardState;
  anchor?: { x: number; y: number } | null;
  onClose?: () => void;
}

export function CardPreview({ card, anchor, onClose }: CardPreviewProps) {
  const def = card.definition;
  const mechanics = getMechanicsForCard(card);
  const badges = getMechanicBadgesForCard(card);
  const effectivePT = getEffectivePowerToughness(card);
  const hasPrintedPT = def.power !== undefined || def.toughness !== undefined;
  const hasPTOverride = Boolean(card.powerToughnessOverride);
  const plusCounters = card.counters.find(counter => counter.type === '+1/+1')?.count ?? 0;
  const minusCounters = card.counters.find(counter => counter.type === '-1/-1')?.count ?? 0;
  const chargeCounters = card.counters.find(counter => counter.type === 'charge')?.count ?? 0;
  const classLevel = card.classLevel;
  const context = mechanics.some(mechanic => mechanic.id === 'waterbend') && card.zone === 'hand'
    ? 'cost_payment'
    : card.zone === 'exile' ? 'exile' : card.zone === 'graveyard' ? 'graveyard' : card.zone === 'battlefield' ? 'battlefield' : 'manual_prompt';
  const exhaustUsed = Boolean(card.exhaustUsed?.default) || /\bexhaust(?:ed)?\s*:\s*used\b/i.test(card.notes);
  const width = 280;
  const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight;
  const left = anchor
    ? Math.max(12, Math.min(anchor.x + 18, viewportWidth - width - 12))
    : viewportWidth - width - 16;
  const top = anchor
    ? Math.max(12, Math.min(anchor.y - 180, viewportHeight - 420))
    : 60;

  return (
    <div style={{
      position: 'fixed', left, top, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 12,
      pointerEvents: 'none',
    }}>
      <div style={{
        background: '#1a1a2e',
        border: '1px solid #2d2d4a',
        borderRadius: 12,
        padding: 12,
        width,
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
          {badges.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {badges.map(badge => (
                <span key={badge.id} title={badge.title} style={{
                  fontSize: 9,
                  fontWeight: 800,
                  borderRadius: 999,
                  padding: '2px 6px',
                  background: badge.manual ? '#92400e' : '#075985',
                  color: badge.manual ? '#fed7aa' : '#bae6fd',
                }}>
                  {badge.label}
                </span>
              ))}
            </div>
          )}
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
          {(hasPrintedPT || def.loyalty !== undefined || hasPTOverride) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
              {hasPTOverride && (
                <span title="Manual power/toughness override active" style={{
                  background: '#92400e',
                  color: '#fed7aa',
                  borderRadius: 999,
                  padding: '2px 6px',
                  fontSize: 9,
                  fontWeight: 800,
                }}>
                  P/T OVERRIDE
                </span>
              )}
              <span style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                {hasPrintedPT ? `${effectivePT ? `${effectivePT.power}/${effectivePT.toughness}` : `${def.power ?? '*'}/${def.toughness ?? '*'}`}` : `[${def.loyalty}]`}
              </span>
            </div>
          )}
          {(hasPrintedPT || hasPTOverride || plusCounters > 0 || minusCounters > 0) && (
            <div style={{
              marginTop: 6,
              fontSize: 10,
              color: '#cbd5e1',
              background: 'rgba(255,255,255,0.035)',
              border: '1px solid rgba(148, 163, 184, 0.18)',
              borderRadius: 6,
              padding: '5px 6px',
              lineHeight: 1.35,
            }}>
              {effectivePT && <div><strong>Effective P/T:</strong> {effectivePT.power}/{effectivePT.toughness}</div>}
              {hasPrintedPT && <div><strong>Printed P/T:</strong> {def.power ?? '*'}/{def.toughness ?? '*'}</div>}
              {(plusCounters > 0 || minusCounters > 0) && (
                <div><strong>Counters:</strong> +1/+1 x{plusCounters}, -1/-1 x{minusCounters}</div>
              )}
              {card.powerToughnessOverride && (
                <>
                  <div><strong>Override:</strong> {card.powerToughnessOverride.power ?? '?'}/{card.powerToughnessOverride.toughness ?? '?'} ({card.powerToughnessOverride.expires})</div>
                  {card.powerToughnessOverride.reason && <div><strong>Reason:</strong> {card.powerToughnessOverride.reason}</div>}
                </>
              )}
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
          {card.earthbend && (
            <div style={{
              marginTop: 8,
              fontSize: 10,
              color: '#bbf7d0',
              background: 'rgba(22, 101, 52, 0.22)',
              border: '1px solid rgba(34, 197, 94, 0.28)',
              borderRadius: 6,
              padding: '5px 6px',
              lineHeight: 1.35,
            }}>
              <strong>Earthbent Land:</strong> base 0/0 land creature with haste. It has {card.earthbend.amount} +1/+1 counter(s) and returns tapped if it dies or is exiled.
            </div>
          )}
          {card.spacecraft && (
            <div style={{
              marginTop: 8,
              fontSize: 10,
              color: '#bfdbfe',
              background: 'rgba(30, 64, 175, 0.22)',
              border: '1px solid rgba(59, 130, 246, 0.28)',
              borderRadius: 6,
              padding: '5px 6px',
              lineHeight: 1.35,
            }}>
              <strong>Spacecraft:</strong> {chargeCounters} charge counter(s)
              {card.spacecraft.stationThreshold !== undefined && ` / station ${card.spacecraft.stationThreshold}`}
              {card.spacecraft.stationed ? ' - stationed/unlocked' : ''}
              {card.spacecraft.chargeCountersAddedByStation !== undefined && ` (${card.spacecraft.chargeCountersAddedByStation} added by station)`}
            </div>
          )}
          {classLevel !== undefined && (
            <div style={{
              marginTop: 8,
              fontSize: 10,
              color: '#fde68a',
              background: 'rgba(146, 64, 14, 0.22)',
              border: '1px solid rgba(245, 158, 11, 0.28)',
              borderRadius: 6,
              padding: '5px 6px',
              lineHeight: 1.35,
            }}>
              <strong>Class Level:</strong> {classLevel} unlocked. Class levels are tracked as state, not counters.
            </div>
          )}
          {card.notes && <div style={{ marginTop: 8, fontSize: 10, color: '#facc15' }}>Note: {card.notes}</div>}
          {mechanics.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {mechanics.slice(0, 3).map(mechanic => (
                <div key={mechanic.id} style={{
                  fontSize: 10,
                  color: mechanic.automationLevel === 'metadata_only' ? '#94a3b8' : '#bae6fd',
                  background: 'rgba(14, 165, 233, 0.08)',
                  border: '1px solid rgba(14, 165, 233, 0.18)',
                  borderRadius: 6,
                  padding: '5px 6px',
                  lineHeight: 1.35,
                }}>
                  <strong>{mechanic.name}:</strong> {getMechanicHint(mechanic.id, context, undefined, { exhaustUsed })}
                </div>
              ))}
            </div>
          )}
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
  return <CardPreview card={card} anchor={ui.cardPreviewAnchor} onClose={() => setCardPreview(null)} />;
}
