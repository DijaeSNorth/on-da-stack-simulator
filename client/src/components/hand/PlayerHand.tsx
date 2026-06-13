import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';
import type { CardState, Player } from '../../types/game';
import {
  buildHandViewModel,
  getHandPrivacyView,
  type HandDisplayMode,
  type HandGroupMode,
  type HandSortMode,
} from './handUiModel';

function moveCardToIndex(cards: CardState[], cardId: string, toIndex: number): CardState[] {
  const fromIndex = cards.findIndex(card => card.instanceId === cardId);
  if (fromIndex === -1) return cards;
  const next = [...cards];
  const [card] = next.splice(fromIndex, 1);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, card);
  return next;
}

function HandCountRail({ label = 'Spectating' }: { label?: string }) {
  const { game } = useGameStore();
  return (
    <div
      data-testid="hand-count-rail"
      style={{
        minHeight: 76,
        background: '#0d1117',
        borderTop: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        overflowX: 'auto',
      }}
    >
      <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', flexShrink: 0 }}>
        {label}
      </span>
      {game.players.map(player => (
        <div
          key={player.id}
          data-testid={`hand-count-${player.id}`}
          style={{
            border: '1px solid #243142',
            borderRadius: 6,
            padding: '6px 9px',
            minWidth: 110,
            color: '#94a3b8',
            fontSize: 10,
          }}
          title={`${player.name}: ${player.hand.length} hand, ${player.library.length} library`}
        >
          <div style={{ color: player.color, fontWeight: 800, marginBottom: 2 }}>{player.name}</div>
          <div>Hand: {player.hand.length}</div>
          <div>Library: {player.library.length}</div>
        </div>
      ))}
    </div>
  );
}

function JudgeHandInspector() {
  const store = useGameStore();
  const { game } = store;
  const [activePlayerId, setActivePlayerId] = useState(game.players[0]?.id ?? '');
  const player = game.players.find(p => p.id === activePlayerId) ?? game.players[0];
  if (!player) return <HandCountRail label="Judge" />;
  const cards = player.hand.map(id => game.cards[id]).filter(Boolean) as CardState[];

  return (
    <div style={{ borderTop: '1px solid #1e293b', background: '#0d1117' }}>
      <div style={{ display: 'flex', gap: 6, padding: '6px 10px 0', overflowX: 'auto' }}>
        {game.players.map(p => (
          <button
            key={p.id}
            data-testid={`judge-hand-tab-${p.id}`}
            onClick={() => setActivePlayerId(p.id)}
            style={chipStyle(activePlayerId === p.id ? p.color : '#334155', activePlayerId === p.id)}
          >
            {p.name} ({p.hand.length})
          </button>
        ))}
      </div>
      <HandSurface player={player} cards={cards} canManipulate={false} label="Judge hand view" />
    </div>
  );
}

export function PlayerHand() {
  const store = useGameStore();
  const { game, localPlayerId, multiplayer, ui } = store;
  const multiplayerStatus = multiplayer.isSpectator ? 'spectator' : multiplayer.status;

  if (multiplayer.isSpectator && !ui.judgeMode) return <HandCountRail />;
  if (multiplayer.isSpectator && ui.judgeMode) return <JudgeHandInspector />;

  const player = game.players.find(p => p.id === localPlayerId);
  if (!player) return <HandCountRail label="Hands" />;

  const privacy = getHandPrivacyView(localPlayerId, player.id, multiplayerStatus, ui.judgeMode);
  if (privacy !== 'visible') return <HandCountRail label="Hands" />;

  const handCards = player.hand.map(id => game.cards[id]).filter(Boolean) as CardState[];
  return <HandSurface player={player} cards={handCards} canManipulate label="Hand" />;
}

function HandSurface({
  player,
  cards,
  canManipulate,
  label,
}: {
  player: Player;
  cards: CardState[];
  canManipulate: boolean;
  label: string;
}) {
  const store = useGameStore();
  const { game, ui, localPlayerId } = store;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(cards.length >= 8);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<HandSortMode>('manual');
  const [groupMode, setGroupMode] = useState<HandGroupMode>('all');
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
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

  const view = buildHandViewModel(cards, { search, sortMode, groupMode, pinnedIds, compactThreshold: ui.settings.compactHandThreshold });
  const count = cards.length;
  const canDragOrder = canManipulate
    && sortMode === 'manual'
    && groupMode === 'all'
    && search.trim() === ''
    && pinnedIds.size === 0
    && view.displayMode !== 'grid';
  const flatCards = view.groups.flatMap(group => group.cards);
  const displayCards = canDragOrder && dragState
    ? moveCardToIndex(flatCards, dragState.cardId, dragState.toIndex)
    : flatCards;
  const height = view.displayMode === 'grid' ? 190 : controlsOpen || view.pinnedCards.length > 0 ? 158 : 124;
  const cardSize = getCardImageSize(view.displayMode);
  const cardStep = getCardStep(view.displayMode, displayCards.length);

  function getHandIndexForClientX(clientX: number): number {
    const rect = handRailRef.current?.getBoundingClientRect();
    if (!rect) return dragState?.toIndex ?? 0;
    const centerX = rect.left + rect.width / 2;
    const raw = Math.round(((clientX - centerX) / cardStep) + ((displayCards.length - 1) / 2));
    return Math.max(0, Math.min(displayCards.length - 1, raw));
  }

  function handleCardPointerDown(event: PointerEvent<HTMLDivElement>, cardId: string, index: number) {
    if (!canDragOrder) return;
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
    if (!canDragOrder) return;
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
    if (!canDragOrder || !dragState || dragState.pointerId !== event.pointerId) return;
    const targetIndex = getHandIndexForClientX(event.clientX);
    const moved = dragState.moved || targetIndex !== dragState.fromIndex;
    if (moved) {
      const nextCards = moveCardToIndex(cards, dragState.cardId, targetIndex);
      store.reorderHand(player.id, nextCards.map(card => card.instanceId));
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    setDragState(null);
  }

  function togglePinned(cardId: string) {
    if (!canManipulate) return;
    setPinnedIds(current => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function renderCard(card: CardState, index: number, pinned = false) {
    const isHovered = hoveredId === card.instanceId;
    const isSelected = ui.selectedCardId === card.instanceId;
    const isDragging = dragState?.cardId === card.instanceId;
    const fan = view.displayMode !== 'grid' && groupMode === 'all' && !pinned;
    const spreadRange = Math.min(displayCards.length * 4, 20);
    const angle = fan && displayCards.length > 1 ? ((index / (displayCards.length - 1)) - 0.5) * spreadRange : 0;
    const verticalOffset = fan ? (isDragging ? -34 : isHovered ? -26 : Math.abs(angle) * 1.4) : 0;

    return (
      <div
        key={card.instanceId}
        data-testid={`hand-card-${card.instanceId}`}
        style={{
          position: fan ? 'absolute' : 'relative',
          left: fan ? `calc(50% + ${(index - (displayCards.length - 1) / 2) * cardStep}px)` : undefined,
          bottom: fan ? verticalOffset : undefined,
          transform: fan ? `rotate(${angle}deg) ${isDragging ? 'scale(1.14)' : isHovered ? 'scale(1.1)' : isSelected ? 'scale(1.05)' : 'scale(1)'}` : isSelected ? 'scale(1.04)' : undefined,
          transformOrigin: 'bottom center',
          zIndex: isDragging ? 140 : isHovered ? 100 : index,
          cursor: canDragOrder ? (isDragging ? 'grabbing' : 'grab') : 'pointer',
          touchAction: canDragOrder ? 'none' : 'auto',
          opacity: dragState && !isDragging ? 0.82 : 1,
          transition: 'transform 0.15s ease, bottom 0.15s ease, opacity 0.12s ease',
          outline: isSelected ? '2px solid #60a5fa' : 'none',
          borderRadius: 5,
          flexShrink: 0,
        }}
        onPointerDown={(event) => handleCardPointerDown(event, card.instanceId, index)}
        onPointerMove={handleCardPointerMove}
        onPointerUp={handleCardPointerUp}
        onPointerCancel={() => setDragState(null)}
        onMouseEnter={(event) => {
          setHoveredId(card.instanceId);
          store.setCardPreview(card.instanceId, { x: event.clientX, y: event.clientY });
        }}
        onMouseMove={(event) => store.setCardPreviewAnchor({ x: event.clientX, y: event.clientY })}
        onMouseLeave={() => {
          setHoveredId(null);
          store.setCardPreview(null);
        }}
        onClick={(event) => {
          if (suppressClickRef.current) return;
          store.setSelectedCard(card.instanceId);
          store.setCardPreview(card.instanceId, { x: event.clientX, y: event.clientY });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          store.openCardContextMenu(card.instanceId, event.clientX, event.clientY);
        }}
        title={card.definition.name}
      >
        <CardImage card={card} size={cardSize} />
        {canManipulate && (
          <button
            type="button"
            data-testid={`pin-hand-card-${card.instanceId}`}
            title={pinnedIds.has(card.instanceId) ? 'Unpin card' : 'Pin card'}
            onClick={(event) => {
              event.stopPropagation();
              togglePinned(card.instanceId);
            }}
            style={{
              position: 'absolute',
              top: -5,
              right: -5,
              width: 18,
              height: 18,
              borderRadius: 999,
              border: '1px solid #334155',
              background: pinnedIds.has(card.instanceId) ? '#f59e0b' : '#0f172a',
              color: pinnedIds.has(card.instanceId) ? '#111827' : '#94a3b8',
              fontSize: 10,
              fontWeight: 900,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            {pinnedIds.has(card.instanceId) ? '!' : '+'}
          </button>
        )}
      </div>
    );
  }

  if (count === 0) {
    return (
      <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 12, fontStyle: 'italic', borderTop: '1px solid #1e293b' }}>
        Empty hand
      </div>
    );
  }

  return (
    <div
      data-testid="player-hand"
      data-hand-mode={view.displayMode}
      style={{
        height,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        borderTop: '1px solid #1e293b',
        background: 'linear-gradient(180deg, #0d1117, #111827)',
        overflow: 'visible',
        zIndex: 50,
        padding: '6px 12px 8px',
        boxSizing: 'border-box',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24 }}>
        <span style={{ fontSize: 10, color: '#64748b', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
          {label} ({count})
        </span>
        <span data-testid="hand-display-mode" style={{ ...miniBadgeStyle, color: modeColor(view.displayMode) }}>
          {view.displayMode}
        </span>
        {view.filteredCount !== count && (
          <span style={miniBadgeStyle}>{view.filteredCount} shown</span>
        )}
        {view.pinnedCards.length > 0 && (
          <span style={{ ...miniBadgeStyle, color: '#fbbf24' }}>{view.pinnedCards.length} pinned</span>
        )}
        <button
          type="button"
          data-testid="hand-controls-toggle"
          onClick={() => setControlsOpen(open => !open)}
          style={{ ...controlButtonStyle, marginLeft: 'auto' }}
        >
          {controlsOpen ? 'Hide controls' : 'Controls'}
        </button>
      </div>

      {controlsOpen && (
        <div data-testid="hand-controls" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            data-testid="hand-search-input"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search hand"
            style={searchInputStyle}
          />
          <select data-testid="hand-sort-select" value={sortMode} onChange={event => setSortMode(event.target.value as HandSortMode)} style={selectStyle}>
            <option value="manual">Manual</option>
            <option value="manaValue">Mana value</option>
            <option value="cardType">Type</option>
            <option value="color">Color</option>
            <option value="name">Name</option>
          </select>
          <select data-testid="hand-group-select" value={groupMode} onChange={event => setGroupMode(event.target.value as HandGroupMode)} style={selectStyle}>
            <option value="all">All</option>
            <option value="lands">Lands</option>
            <option value="creatures">Creatures</option>
            <option value="spells">Instants/Sorceries</option>
            <option value="artifactsEnchantments">Artifacts/Enchantments</option>
            <option value="other">Other</option>
          </select>
          {canManipulate && (
            <button
              type="button"
              data-testid="btn-sort-hand"
              title="Persist current type/color/mana/name hand order"
              onClick={() => store.sortHand(player.id)}
              style={controlButtonStyle}
            >
              Save sort
            </button>
          )}
        </div>
      )}

      {view.pinnedCards.length > 0 && (
        <div data-testid="pinned-hand-section" style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 48, overflowX: 'auto' }}>
          <span style={{ fontSize: 9, color: '#fbbf24', fontWeight: 900, textTransform: 'uppercase', flexShrink: 0 }}>Pinned</span>
          {view.pinnedCards.map((card, index) => renderCard(card, index, true))}
        </div>
      )}

      <div
        ref={handRailRef}
        data-testid="hand-card-area"
        style={getCardAreaStyle(view.displayMode, groupMode)}
      >
        {displayCards.length === 0 ? (
          <div style={{ color: '#475569', fontSize: 12, fontStyle: 'italic', padding: 12 }}>No matching cards</div>
        ) : groupMode === 'all' ? (
          displayCards.map((card, index) => renderCard(card, index))
        ) : (
          view.groups.map(group => (
            <div key={group.key} data-testid={`hand-group-${group.key}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 110 }}>
              <span style={{ fontSize: 9, color: '#64748b', fontWeight: 900, textTransform: 'uppercase' }}>{group.label} ({group.cards.length})</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: view.displayMode === 'grid' ? 'wrap' : 'nowrap' }}>
                {group.cards.map((card, index) => renderCard(card, index))}
              </div>
            </div>
          ))
        )}
      </div>

      {canManipulate && ui.selectedCardId && player.hand.includes(ui.selectedCardId) && (
        <SelectedHandActions
          card={game.cards[ui.selectedCardId]}
          playerId={localPlayerId}
          onDone={() => store.setSelectedCard(null)}
        />
      )}
    </div>
  );
}

function SelectedHandActions({ card, playerId, onDone }: { card: CardState | undefined; playerId: string; onDone: () => void }) {
  const store = useGameStore();
  if (!card) return null;
  const isLand = card.definition.cardTypes.includes('Land');
  const sneakCandidates = store.getSneakReturnCandidates(playerId);
  const canSneak = store.canCastWithSneak(playerId, card.instanceId) && sneakCandidates.length === 1;

  return (
    <div style={{ position: 'absolute', right: 12, bottom: 10, display: 'flex', gap: 6 }}>
      <button
        data-testid="btn-play-selected"
        onClick={() => {
          if (isLand) store.playLand(playerId, card.instanceId);
          else store.castCard(playerId, card.instanceId);
          onDone();
        }}
        style={actionButtonStyle('#1d4ed8')}
      >
        {isLand ? 'Play Land' : 'Cast'}
      </button>
      {canSneak && (
        <button
          data-testid="btn-sneak-selected"
          onClick={() => {
            store.castWithSneak(playerId, card.instanceId, sneakCandidates[0].attackerId);
            onDone();
          }}
          style={actionButtonStyle('#7c2d12')}
        >
          Sneak
        </button>
      )}
      <button
        data-testid="btn-discard-selected"
        onClick={() => {
          store.discardFromHand(playerId, card.instanceId);
          onDone();
        }}
        style={actionButtonStyle('#991b1b')}
      >
        Discard
      </button>
    </div>
  );
}

function getCardImageSize(mode: HandDisplayMode): 'normal' | 'compact' {
  return mode === 'normal' ? 'normal' : 'compact';
}

function getCardStep(mode: HandDisplayMode, count: number): number {
  if (mode === 'normal') return Math.max(34, Math.min(58, 420 / Math.max(1, count)));
  return Math.max(26, Math.min(42, 520 / Math.max(1, count)));
}

function getCardAreaStyle(mode: HandDisplayMode, groupMode: HandGroupMode): CSSProperties {
  if (mode === 'grid') {
    return {
      flex: 1,
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      display: 'flex',
      flexWrap: 'wrap',
      alignContent: 'flex-start',
      gap: 7,
      padding: '2px 4px 4px',
    };
  }
  if (groupMode !== 'all') {
    return {
      flex: 1,
      minHeight: 0,
      overflowX: 'auto',
      overflowY: 'hidden',
      display: 'flex',
      gap: 12,
      alignItems: 'flex-end',
      paddingBottom: 2,
    };
  }
  return {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingBottom: 4,
  };
}

function chipStyle(color: string, active: boolean): CSSProperties {
  return {
    padding: '3px 8px',
    borderRadius: 5,
    border: `1px solid ${color}`,
    background: active ? `${color}22` : 'transparent',
    color: active ? color : '#94a3b8',
    fontSize: 10,
    fontWeight: 800,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

function actionButtonStyle(background: string): CSSProperties {
  return {
    background,
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 10,
    cursor: 'pointer',
    fontWeight: 700,
  };
}

function modeColor(mode: HandDisplayMode): string {
  if (mode === 'grid') return '#fbbf24';
  if (mode === 'compact') return '#93c5fd';
  return '#86efac';
}

const miniBadgeStyle: CSSProperties = {
  fontSize: 9,
  color: '#94a3b8',
  border: '1px solid #26323a',
  borderRadius: 999,
  padding: '2px 7px',
  fontWeight: 800,
  textTransform: 'uppercase',
};

const controlButtonStyle: CSSProperties = {
  height: 26,
  borderRadius: 5,
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#94a3b8',
  fontSize: 10,
  fontWeight: 800,
  cursor: 'pointer',
  padding: '0 9px',
};

const selectStyle: CSSProperties = {
  height: 26,
  borderRadius: 5,
  border: '1px solid #334155',
  background: '#0b1220',
  color: '#cbd5e1',
  fontSize: 10,
  fontWeight: 700,
  padding: '0 8px',
};

const searchInputStyle: CSSProperties = {
  height: 26,
  width: 150,
  borderRadius: 5,
  border: '1px solid #334155',
  background: '#0b1220',
  color: '#e2e8f0',
  fontSize: 10,
  fontWeight: 700,
  padding: '0 9px',
  outline: 'none',
};
