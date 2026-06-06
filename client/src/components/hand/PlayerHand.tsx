import { useRef, useState, type PointerEvent } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';
import type { CardState } from '../../types/game';

// ─── SpectatorHandViewer ──────────────────────────────────────────────────────────
// Spectators see ALL players' hands via tabbed panel, face-up, read-only.
function SpectatorHandViewer() {
  const store = useGameStore();
  const { game } = store;
  const [activeTab, setActiveTab] = useState(0);

  const players = game.players;
  if (players.length === 0) return null;
  const activePlayer = players[activeTab] ?? players[0];
  const handCards = activePlayer.hand.map(id => game.cards[id]).filter(Boolean) as CardState[];

  return (
    <div style={{
      background: '#0d1117',
      borderTop: '1px solid #1e293b',
    }}>
      {/* Spectator banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 12px',
        background: '#1a0a2e', borderBottom: '1px solid #2d1b69',
      }}>
        <span style={{ fontSize: 9, color: '#a78bfa', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>
          👁 Spectating — All Hands
        </span>
        <div style={{ flex: 1 }} />
        {players.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setActiveTab(i)}
            style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
              cursor: 'pointer', border: '1px solid',
              borderColor: activeTab === i ? p.color : '#334155',
              background: activeTab === i ? `${p.color}22` : 'transparent',
              color: activeTab === i ? p.color : '#475569',
              transition: 'all 0.1s',
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      {/* Cards */}
      <div style={{
        height: 110,
        display: 'flex', alignItems: 'center',
        padding: '8px 16px', gap: 6, overflowX: 'auto',
      }}>
        {handCards.length === 0 ? (
          <div style={{ color: '#334155', fontSize: 12, fontStyle: 'italic' }}>Empty hand</div>
        ) : handCards.map(card => (
          <div key={card.instanceId} style={{ flexShrink: 0 }}>
            <CardImage
              card={card}
              size="compact"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── PlayerHand ───────────────────────────────────────────────────────────────────
function moveCardToIndex(cards: CardState[], cardId: string, toIndex: number): CardState[] {
  const fromIndex = cards.findIndex(card => card.instanceId === cardId);
  if (fromIndex === -1) return cards;
  const next = [...cards];
  const [card] = next.splice(fromIndex, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, card);
  return next;
}

export function PlayerHand() {
  const store = useGameStore();
  const { game, ui, localPlayerId, multiplayer } = store;
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [dragState, setDragState] = useState<{
    cardId: string;
    fromIndex: number;
    toIndex: number;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const handRailRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  // Spectators see all players' hands in a tabbed viewer
  if (multiplayer.isSpectator) return <SpectatorHandViewer />;

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
  const cardStep = Math.max(1, Math.min(cardSpread, 55));
  const displayCards = dragState
    ? moveCardToIndex(handCards, dragState.cardId, dragState.toIndex)
    : handCards;

  function getHandIndexForClientX(clientX: number): number {
    const rect = handRailRef.current?.getBoundingClientRect();
    if (!rect) return dragState?.toIndex ?? 0;
    const centerX = rect.left + rect.width / 2;
    const raw = Math.round(((clientX - centerX) / cardStep) + ((count - 1) / 2));
    return Math.max(0, Math.min(count - 1, raw));
  }

  function handleCardPointerDown(event: PointerEvent<HTMLDivElement>, cardId: string, index: number) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragState({
      cardId,
      fromIndex: index,
      toIndex: index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    });
  }

  function handleCardPointerMove(event: PointerEvent<HTMLDivElement>) {
    setDragState(current => {
      if (!current || current.pointerId !== event.pointerId) return current;
      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
      const moved = current.moved || distance > 7;
      if (!moved) return current;
      event.preventDefault();
      return { ...current, moved, toIndex: getHandIndexForClientX(event.clientX) };
    });
  }

  function handleCardPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const targetIndex = getHandIndexForClientX(event.clientX);
    const moved = dragState.moved || targetIndex !== dragState.fromIndex;
    if (moved) {
      const nextCards = moveCardToIndex(handCards, dragState.cardId, targetIndex);
      store.reorderHand(localPlayerId, nextCards.map(card => card.instanceId));
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    setDragState(null);
  }

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
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{
          fontSize: 10, color: '#475569',
          fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
        }}>
          Hand ({count})
        </span>
        <button
          type="button"
          data-testid="btn-sort-hand"
          title="Sort hand by card type, color, mana value, then name. You can also type 'sort hand'."
          onClick={() => store.sortHand(localPlayerId)}
          style={{
            padding: '3px 7px',
            borderRadius: 5,
            border: '1px solid #334155',
            background: '#0f172a',
            color: '#94a3b8',
            fontSize: 9,
            fontWeight: 800,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          Sort
        </button>
      </div>

      {/* Fan of cards */}
      <div ref={handRailRef} style={{
        position: 'relative',
        height: '100%',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: 10,
      }}>
        {displayCards.map((card, i) => {
          const isHovered = hoveredIdx === i;
          const isSelected = ui.selectedCardId === card.instanceId;
          const isDragging = dragState?.cardId === card.instanceId;

          // Fan angle: spread cards slightly
          const spreadRange = Math.min(count * 4, 20);
          const angle = count > 1 ? ((i / (count - 1)) - 0.5) * spreadRange : 0;
          const verticalOffset = isDragging ? -38 : isHovered ? -30 : Math.abs(angle) * 1.5;

          return (
            <div
              key={card.instanceId}
              data-testid={`hand-card-${card.instanceId}`}
              style={{
                position: 'absolute',
                left: `calc(50% + ${(i - (count - 1) / 2) * cardStep}px)`,
                bottom: verticalOffset,
                transform: `rotate(${angle}deg) ${isDragging ? 'scale(1.15)' : isHovered ? 'scale(1.12)' : isSelected ? 'scale(1.06)' : 'scale(1)'}`,
                transformOrigin: 'bottom center',
                zIndex: isDragging ? 140 : isHovered ? 100 : i,
                cursor: isDragging ? 'grabbing' : 'grab',
                touchAction: 'none',
                opacity: dragState && !isDragging ? 0.82 : 1,
                transition: dragState ? 'left 0.12s ease, transform 0.12s ease, bottom 0.12s ease, opacity 0.12s ease' : 'transform 0.15s ease, bottom 0.15s ease, z-index 0s',
                outline: isSelected ? '2px solid #60a5fa' : 'none',
                borderRadius: 5,
              }}
              onPointerDown={(event) => handleCardPointerDown(event, card.instanceId, i)}
              onPointerMove={handleCardPointerMove}
              onPointerUp={handleCardPointerUp}
              onPointerCancel={() => setDragState(null)}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => {
                if (suppressClickRef.current) return;
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

              {/* Hovered card tooltip — name + type + mana + P/T */}
              {isHovered && (
                <div style={{
                  position: 'absolute',
                  bottom: '105%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: 6,
                  padding: '6px 8px',
                  pointerEvents: 'none',
                  marginBottom: 4,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.7)',
                  minWidth: 120,
                  maxWidth: 180,
                  zIndex: 200,
                }}>
                  {/* Name row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap' }}>
                      {card.definition.name}
                    </span>
                    {card.definition.manaCost?.raw && (
                      <span style={{ fontSize: 9, color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {card.definition.manaCost.raw}
                      </span>
                    )}
                  </div>
                  {/* Type line */}
                  {card.definition.cardTypes.length > 0 && (
                    <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
                      {card.definition.cardTypes.join(' ')}
                    </div>
                  )}
                  {/* P/T for creatures */}
                  {card.definition.power !== undefined && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', marginTop: 2 }}>
                      {card.definition.power}/{card.definition.toughness}
                    </div>
                  )}
                  {/* Summoning sick */}
                  {card.summoningSick && (
                    <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 1 }}>⏳ Summoning sickness</div>
                  )}
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
