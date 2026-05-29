import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';
import type { CardState } from '../../types/game';

export function PlayerHand() {
  const store = useGameStore();
  const { game, ui, localPlayerId } = store;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const player = game.players.find(p => p.id === localPlayerId);
  if (!player) return null;

  const handCards = player.hand.map(id => game.cards[id]).filter(Boolean) as CardState[];
  const count = handCards.length;

  if (count === 0) return (
    <div style={{
      height: 90,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#334155',
      fontSize: 12,
      fontStyle: 'italic',
      borderTop: '1px solid #1e293b',
    }}>
      Empty hand
    </div>
  );

  // Fan layout: cards spread like a hand of cards
  const totalWidth = Math.min(count * 60, window.innerWidth - 200);
  const cardSpread = Math.min(60, (totalWidth - 74) / Math.max(1, count - 1));

  return (
    <div
      data-testid="player-hand"
      style={{
        height: 120,
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        borderTop: '1px solid #1e293b',
        background: 'linear-gradient(180deg, #0d1117, #111827)',
        overflow: 'visible',
        zIndex: 50,
        padding: '0 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Hand label */}
      <div style={{
        position: 'absolute',
        left: 12, bottom: 8,
        fontSize: 10, color: '#475569',
        fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
      }}>
        Hand ({count})
      </div>

      {/* Fan of cards */}
      <div style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: 10,
      }}>
        {handCards.map((card, i) => {
          const isHovered = hoveredIdx === i;
          const isSelected = ui.selectedCardId === card.instanceId;

          // Fan angle: spread cards slightly
          const spreadRange = Math.min(count * 4, 20);
          const angle = count > 1 ? ((i / (count - 1)) - 0.5) * spreadRange : 0;
          const verticalOffset = isHovered ? -30 : Math.abs(angle) * 1.5;

          return (
            <div
              key={card.instanceId}
              data-testid={`hand-card-${card.instanceId}`}
              style={{
                position: 'absolute',
                left: `calc(50% + ${(i - (count - 1) / 2) * Math.min(cardSpread, 55)}px)`,
                bottom: verticalOffset,
                transform: `rotate(${angle}deg) ${isHovered ? 'scale(1.12)' : isSelected ? 'scale(1.06)' : 'scale(1)'}`,
                transformOrigin: 'bottom center',
                zIndex: isHovered ? 100 : i,
                cursor: 'pointer',
                transition: 'transform 0.15s ease, bottom 0.15s ease, z-index 0s',
                outline: isSelected ? '2px solid #60a5fa' : 'none',
                borderRadius: 5,
              }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => {
                store.setSelectedCard(card.instanceId);
                store.setCardPreview(card.instanceId);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                store.openCardContextMenu(card.instanceId, e.clientX, e.clientY);
              }}
              title={card.definition.name}
            >
              <CardImage card={card} size="normal" />

              {/* Hovered card name tooltip */}
              {isHovered && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#1e1e32',
                  border: '1px solid #3d3d5c',
                  borderRadius: 4,
                  padding: '3px 6px',
                  fontSize: 10,
                  color: '#e2e8f0',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  marginBottom: 4,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                }}>
                  {card.definition.name}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick actions for selected hand card */}
      {ui.selectedCardId && player.hand.includes(ui.selectedCardId) && (() => {
        const sel = game.cards[ui.selectedCardId];
        if (!sel) return null;
        const isLand = sel.definition.cardTypes.includes('Land');
        return (
          <div style={{
            position: 'absolute',
            right: 12, bottom: 10,
            display: 'flex', gap: 6,
          }}>
            <button
              data-testid="btn-play-selected"
              onClick={() => {
                if (isLand) {
                  store.playLand(localPlayerId, ui.selectedCardId!);
                } else {
                  store.castCard(localPlayerId, ui.selectedCardId!);
                }
                store.setSelectedCard(null);
              }}
              style={{
                background: '#1d4ed8', color: '#fff',
                border: 'none', borderRadius: 4,
                padding: '4px 10px', fontSize: 10, cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {isLand ? 'Play Land' : 'Cast'}
            </button>
            <button
              data-testid="btn-discard-selected"
              onClick={() => {
                store.discardFromHand(localPlayerId, ui.selectedCardId!);
                store.setSelectedCard(null);
              }}
              style={{
                background: '#991b1b', color: '#fff',
                border: 'none', borderRadius: 4,
                padding: '4px 10px', fontSize: 10, cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Discard
            </button>
          </div>
        );
      })()}
    </div>
  );
}
