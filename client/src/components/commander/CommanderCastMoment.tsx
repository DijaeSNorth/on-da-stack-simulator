import { useEffect, useState, type CSSProperties } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';

interface CommanderMoment {
  actionId: string;
  cardId?: string;
  cardName: string;
  playerName: string;
  playerColor: string;
  castNumber?: number;
  tax?: number;
}

export function CommanderCastMoment() {
  const game = useGameStore(state => state.game);
  const [moment, setMoment] = useState<CommanderMoment | null>(null);

  useEffect(() => {
    const action = game.actionLog[game.actionLog.length - 1];
    if (!action || action.data?.commanderCast !== true) return;

    const cardId = action.affectedObjects[0];
    const card = cardId ? game.cards[cardId] : undefined;
    setMoment({
      actionId: action.id,
      cardId,
      cardName: String(action.data.cardName || card?.definition.name || 'Commander'),
      playerName: String(action.data.playerName || 'A player'),
      playerColor: String(action.data.playerColor || '#fbbf24'),
      castNumber: typeof action.data.commanderCastNumber === 'number' ? action.data.commanderCastNumber : undefined,
      tax: typeof action.data.commanderTax === 'number' ? action.data.commanderTax : undefined,
    });

    const timer = window.setTimeout(() => setMoment(current =>
      current?.actionId === action.id ? null : current
    ), 3800);
    return () => window.clearTimeout(timer);
  }, [game.actionLog, game.cards]);

  if (!moment) return null;
  const card = moment.cardId ? game.cards[moment.cardId] : undefined;

  return (
    <div
      data-testid="commander-cast-moment"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 25000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        background: 'radial-gradient(circle at 50% 44%, rgba(251,191,36,0.24), rgba(8,13,17,0.05) 34%, transparent 58%)',
        animation: 'commanderMomentBackdrop 3.8s ease forwards',
      }}
    >
      <div style={{
        width: 'min(520px, calc(100vw - 28px))',
        minHeight: 190,
        display: 'grid',
        gridTemplateColumns: card ? '112px 1fr' : '1fr',
        gap: 18,
        alignItems: 'center',
        padding: 18,
        border: `1px solid ${moment.playerColor}`,
        borderRadius: 8,
        background: 'linear-gradient(135deg, rgba(15,23,42,0.96), rgba(17,24,39,0.92))',
        boxShadow: `0 0 0 1px rgba(251,191,36,0.28), 0 24px 80px ${moment.playerColor}55`,
        animation: 'commanderMomentCard 3.8s cubic-bezier(.16,1,.3,1) forwards',
      }}>
        {card && (
          <div style={{
            transform: 'rotate(-4deg)',
            filter: `drop-shadow(0 0 18px ${moment.playerColor}aa)`,
          }}>
            <CardImage card={card} size="normal" />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{
            color: '#fbbf24',
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}>
            Commander Cast
          </div>
          <div style={{
            color: '#f8fafc',
            fontSize: 32,
            lineHeight: 1.02,
            fontWeight: 900,
            textShadow: `0 0 24px ${moment.playerColor}77`,
            overflowWrap: 'anywhere',
          }}>
            {moment.cardName}
          </div>
          <div style={{
            marginTop: 10,
            color: '#cbd5e1',
            fontSize: 14,
            fontWeight: 700,
          }}>
            {moment.playerName} put their commander on the stack.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {moment.castNumber !== undefined && (
              <span style={pillStyle(moment.playerColor)}>
                Cast #{moment.castNumber}
              </span>
            )}
            {moment.tax !== undefined && moment.tax > 0 && (
              <span style={pillStyle('#f97316')}>
                Commander tax +{moment.tax}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function pillStyle(color: string): CSSProperties {
  return {
    color: '#f8fafc',
    background: `${color}33`,
    border: `1px solid ${color}aa`,
    borderRadius: 999,
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  };
}
