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
  const multiplayer = useGameStore(state => state.multiplayer);
  const [moment, setMoment] = useState<CommanderMoment | null>(null);

  const isMultiplayer =
    multiplayer.status === 'host' || multiplayer.status === 'joined' || multiplayer.status === 'migrating';

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
      data-mode={isMultiplayer ? 'toast' : 'hero'}
      style={{
        position: 'fixed',
        top: isMultiplayer ? 88 : 0,
        right: isMultiplayer ? 16 : 'auto',
        left: isMultiplayer ? 'auto' : 0,
        bottom: isMultiplayer ? 'auto' : 0,
        zIndex: isMultiplayer ? 14000 : 25000,
        display: isMultiplayer ? 'block' : 'flex',
        alignItems: isMultiplayer ? 'flex-start' : 'center',
        justifyContent: isMultiplayer ? 'flex-end' : 'center',
        pointerEvents: 'none',
        background: isMultiplayer ? 'transparent' : 'radial-gradient(circle at 50% 44%, rgba(251,191,36,0.24), rgba(8,13,17,0.05) 34%, transparent 58%)',
        animation: isMultiplayer ? 'none' : 'commanderMomentBackdrop 3.8s ease forwards',
      }}
    >
      <div style={{
        width: isMultiplayer ? 'min(420px, calc(100vw - 28px))' : 'min(520px, calc(100vw - 28px))',
        minHeight: isMultiplayer ? 86 : 190,
        display: 'grid',
        gridTemplateColumns: card ? (isMultiplayer ? '94px 1fr' : '112px 1fr') : '1fr',
        gap: isMultiplayer ? 12 : 18,
        alignItems: isMultiplayer ? 'flex-start' : 'center',
        padding: isMultiplayer ? 12 : 18,
        border: `1px solid ${moment.playerColor}`,
        borderRadius: isMultiplayer ? 10 : 8,
        background: 'linear-gradient(135deg, rgba(15,23,42,0.96), rgba(17,24,39,0.92))',
        boxShadow: isMultiplayer
          ? `0 0 0 1px rgba(251,191,36,0.28), 0 14px 35px ${moment.playerColor}55`
          : `0 0 0 1px rgba(251,191,36,0.28), 0 24px 80px ${moment.playerColor}55`,
        animation: isMultiplayer ? 'none' : 'commanderMomentCard 3.8s cubic-bezier(.16,1,.3,1) forwards',
      }}>
        {card && (
          <div style={{
            transform: isMultiplayer ? 'rotate(-2deg)' : 'rotate(-4deg)',
            filter: `drop-shadow(0 0 ${isMultiplayer ? 12 : 18}px ${moment.playerColor}aa)`,
            transformOrigin: 'top center',
            width: isMultiplayer ? 84 : 'auto',
          }}>
            <CardImage card={card} size="normal" />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{
            color: '#fbbf24',
            fontSize: isMultiplayer ? 10 : 11,
            fontWeight: 900,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            marginBottom: isMultiplayer ? 6 : 8,
          }}>
            Commander Cast
          </div>
          <div style={{
            color: '#f8fafc',
            fontSize: isMultiplayer ? 22 : 32,
            lineHeight: isMultiplayer ? 1.08 : 1.02,
            fontWeight: 900,
            textShadow: `0 0 24px ${moment.playerColor}77`,
            overflowWrap: 'anywhere',
          }}>
            {moment.cardName}
          </div>
          <div style={{
            marginTop: 10,
            color: '#cbd5e1',
            fontSize: isMultiplayer ? 12 : 14,
            fontWeight: 700,
            lineHeight: 1.2,
          }}>
            {moment.playerName} put their commander on the stack.
          </div>
          <div style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginTop: isMultiplayer ? 10 : 14,
          }}>
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
