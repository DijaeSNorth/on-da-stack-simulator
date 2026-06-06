import { useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';
import { useDragCombatContext } from '../../hooks/DragCombatContext';
import { PlayerAvatar } from '../profile/PlayerAvatar';
import type { CardState, Player } from '../../types/game';

interface TokenCloud {
  key: string;
  cards: CardState[];
  name: string;
  power: string;
  toughness: string;
  tappedCount: number;
  counters: { type: string; total: number }[];
}

function groupTokenClouds(cards: CardState[]): { singles: CardState[]; clouds: TokenCloud[] } {
  const tokenGroups = new Map<string, CardState[]>();
  const singles: CardState[] = [];

  for (const card of cards) {
    if (card.token && card.definition.power !== undefined) {
      const key = `${card.definition.name}-${card.definition.power}-${card.definition.toughness}`;
      if (!tokenGroups.has(key)) tokenGroups.set(key, []);
      tokenGroups.get(key)!.push(card);
    } else {
      singles.push(card);
    }
  }

  const clouds: TokenCloud[] = [];
  for (const [key, group] of tokenGroups) {
    if (group.length >= 3) {
      const def = group[0].definition;
      const tappedCount = group.filter(c => c.tapped).length;
      const counterMap = new Map<string, number>();
      for (const card of group) {
        for (const c of card.counters) {
          counterMap.set(c.type, (counterMap.get(c.type) || 0) + c.count);
        }
      }
      clouds.push({
        key,
        cards: group,
        name: def.name,
        power: def.power || '?',
        toughness: def.toughness || '?',
        tappedCount,
        counters: [...counterMap.entries()].map(([type, total]) => ({ type, total })),
      });
    } else {
      for (const c of group) singles.push(c);
    }
  }

  return { singles, clouds };
}

interface PlayerBattlefieldProps {
  player: Player;
  isLocal?: boolean;
  isActive?: boolean;
  compact?: boolean;
}

export function PlayerBattlefield({ player, isLocal, isActive, compact }: PlayerBattlefieldProps) {
  const store = useGameStore();
  const { game, ui } = store;
  const drag = useDragCombatContext();
  const [expandedClouds, setExpandedClouds] = useState<Set<string>>(new Set());
  const lastTouchTapRef = useRef<{ id: string; time: number; x: number; y: number } | null>(null);

  const cards = player.battlefield.map(id => game.cards[id]).filter(Boolean) as CardState[];

  const lands    = cards.filter(c => c.definition.cardTypes.includes('Land'));
  const nonLands = cards.filter(c => !c.definition.cardTypes.includes('Land') && !c.token);
  const tokens   = cards.filter(c => c.token);

  const { singles: tokenSingles, clouds: tokenClouds } = groupTokenClouds(tokens);

  const cardSize = compact ? 'compact' : cards.length > 20 ? 'compact' : 'normal';
  const gap = compact ? 2 : 4;

  // ── Drag-combat visual state ───────────────────────────────────────────────
  // During an attack drag, own creatures that are valid attackers should glow
  // During a block drag, opponent's attacking creatures should show drop targets
  const isDraggingAttack = drag.dragState?.mode === 'attack';
  const isDraggingBlock  = drag.dragState?.mode === 'block';
  const combatActive     = game.combat.active;

  function handleCardClick(e: React.MouseEvent, instanceId: string) {
    e.preventDefault();
    if (e.type === 'contextmenu') {
      store.openCardContextMenu(instanceId, e.clientX, e.clientY);
    } else {
      store.setSelectedCard(instanceId);
      store.setCardPreview(instanceId, { x: e.clientX, y: e.clientY });
    }
  }

  function toggleTapped(card: CardState) {
    if (!isLocal || card.zone !== 'battlefield') return;
    if (card.tapped) store.untapCard(card.instanceId);
    else store.tapCard(card.instanceId);
  }

  function handleCardPointerUp(e: React.PointerEvent<HTMLDivElement>, card: CardState) {
    if (e.pointerType === 'mouse') return;
    const now = Date.now();
    const previous = lastTouchTapRef.current;
    const isSameCard = previous?.id === card.instanceId;
    const closeEnough = previous ? Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 24 : false;
    if (isSameCard && closeEnough && now - previous.time < 340) {
      e.preventDefault();
      e.stopPropagation();
      lastTouchTapRef.current = null;
      toggleTapped(card);
      return;
    }
    lastTouchTapRef.current = { id: card.instanceId, time: now, x: e.clientX, y: e.clientY };
  }

  function renderCard(card: CardState) {
    const isSelected = ui.selectedCardId === card.instanceId;
    const isBeingDragged = drag.dragState?.instanceId === card.instanceId;
    const isDropTarget   = drag.dropTarget?.id === card.instanceId && drag.dropTarget?.type === 'attacker';

    // Determine if this card is a valid attacker to glow during drag
    const def = card.definition;
    const isValidAttacker = isLocal && isDraggingAttack
      && def.cardTypes.includes('Creature')
      && !card.tapped
      && !def.keywords.includes('Defender')
      && !(card.summoningSick && !def.keywords.includes('Haste') && !def.oracleText.toLowerCase().includes('haste'));

    // Determine if this card is an active attacker (valid block target during block drag)
    const isActiveAttacker = isDraggingBlock && combatActive
      && game.combat.attackers.some(a => a.instanceId === card.instanceId);

    // Drag handlers for own cards
    const dragHandlers = isLocal ? drag.cardDragHandlers(card.instanceId) : {};
    // Block drop handlers for opponent's active attackers
    const blockDropHandlers = isActiveAttacker ? drag.attackerDropHandlers(card.instanceId) : {};

    // Outline logic
    let outlineColor: string | undefined;
    let outlineWidth = 2;
    if (isDropTarget)          { outlineColor = '#22c55e'; outlineWidth = 3; }
    else if (isSelected)       { outlineColor = '#60a5fa'; }
    else if (isValidAttacker)  { outlineColor = '#ef4444'; }
    else if (isActiveAttacker) { outlineColor = '#f97316'; }

    return (
      <div
        key={card.instanceId}
        data-testid={`card-battlefield-${card.instanceId}`}
        data-card-instance={card.instanceId}
        style={{
          position: 'relative',
          cursor: isLocal ? 'grab' : isActiveAttacker ? 'crosshair' : 'pointer',
          outline: outlineColor ? `${outlineWidth}px solid ${outlineColor}` : 'none',
          outlineOffset: isDropTarget ? 3 : 0,
          borderRadius: 4,
          transition: 'transform 0.1s, outline 0.1s, opacity 0.1s',
          opacity: isBeingDragged ? 0.35 : 1,
          // Pulse glow for valid drag targets
          boxShadow: isDropTarget
            ? `0 0 12px 4px #22c55e88`
            : isValidAttacker && isDraggingAttack
              ? `0 0 8px 2px #ef444466`
              : isActiveAttacker
                ? `0 0 8px 2px #f9731666`
                : 'none',
        }}
        onClick={(e) => handleCardClick(e, card.instanceId)}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleTapped(card);
        }}
        onPointerUp={(e) => handleCardPointerUp(e, card)}
        onContextMenu={(e) => { e.preventDefault(); handleCardClick(e, card.instanceId); }}
        onMouseEnter={(e) => {
          store.setHoveredCard(card.instanceId);
          store.setCardPreview(card.instanceId, { x: e.clientX, y: e.clientY });
        }}
        onMouseMove={(e) => store.setCardPreviewAnchor({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => {
          store.setHoveredCard(null);
          store.setCardPreview(null);
        }}
        title={
          isValidAttacker  ? `Drag to attack — ${card.definition.name}` :
          isActiveAttacker ? `Drop a creature here to block ${card.definition.name}` :
          card.definition.name
        }
        {...dragHandlers}
        {...blockDropHandlers}
      >
        <CardImage card={card} size={cardSize} />

        {/* Combat role badge */}
        {card.combatRole === 'attacker' && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', borderRadius: '50%',
            width: 14, height: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: '#fff', fontWeight: 700,
            boxShadow: '0 0 6px #ef4444',
          }}>⚔</div>
        )}
        {card.combatRole === 'blocker' && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            background: '#3b82f6', borderRadius: '50%',
            width: 14, height: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: '#fff', fontWeight: 700,
            boxShadow: '0 0 6px #3b82f6',
          }}>🛡</div>
        )}

        {/* Drag hint tooltip (only shows when actively dragging own card) */}
        {isBeingDragged && (
          <div style={{
            position: 'absolute', bottom: '110%', left: '50%',
            transform: 'translateX(-50%)',
            background: '#0f172a', color: '#e2e8f0',
            fontSize: 9, padding: '3px 7px', borderRadius: 4,
            border: '1px solid #334155', whiteSpace: 'nowrap',
            pointerEvents: 'none', zIndex: 100,
          }}>
            Drop on opponent to attack
          </div>
        )}
      </div>
    );
  }

  function renderTokenCloud(cloud: TokenCloud) {
    const expanded = expandedClouds.has(cloud.key);
    return (
      <div
        key={cloud.key}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6, padding: '4px 6px', minWidth: 54,
          transition: 'background 0.15s',
        }}
        onClick={() => setExpandedClouds(prev => {
          const next = new Set(prev);
          if (next.has(cloud.key)) next.delete(cloud.key);
          else next.add(cloud.key);
          return next;
        })}
        title={`${cloud.cards.length}× ${cloud.name} — click to expand`}
      >
        <div style={{ fontSize: 18, lineHeight: 1 }}>🪙</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>×{cloud.cards.length}</div>
        <div style={{ fontSize: 9, color: '#94a3b8' }}>{cloud.power}/{cloud.toughness}</div>
        {cloud.tappedCount > 0 && <div style={{ fontSize: 9, color: '#f59e0b' }}>↻{cloud.tappedCount}</div>}
        {cloud.counters.map(c => (
          <div key={c.type} style={{ fontSize: 8, color: '#6ee7b7' }}>{c.type}:{c.total}</div>
        ))}
      </div>
    );
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 9, color: '#475569', textTransform: 'uppercase',
    letterSpacing: '0.08em', marginBottom: 3, fontWeight: 600,
  };

  return (
    <div
      data-testid={`battlefield-${player.id}`}
      style={{
        display: 'flex', flexDirection: 'column',
        gap: compact ? 4 : 6,
        padding: compact ? '4px 6px' : '6px 10px',
        width: '100%',
        minHeight: compact ? 80 : 120,
        position: 'relative', boxSizing: 'border-box',
      }}
    >
      {/* Player name strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        borderBottom: `1px solid ${player.color}44`,
        paddingBottom: compact ? 2 : 4,
        marginBottom: compact ? 2 : 4,
      }}>
        <PlayerAvatar
          name={player.name}
          color={player.color}
          initial={player.avatarInitial ?? player.name.slice(0, 1)}
          styleMode={player.avatarStyle}
          image={player.avatarImage}
          size={compact ? 18 : 24}
        />
        <span style={{
          fontSize: compact ? 9 : 11, fontWeight: 600,
          color: isActive ? '#e2e8f0' : '#94a3b8', letterSpacing: '0.03em',
        }}>
          {player.name}
        </span>
        {isActive && !compact && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#22c55e',
            background: '#14532d44', borderRadius: 3, padding: '1px 5px',
          }}>ACTIVE</span>
        )}
        {!compact && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#64748b' }}>
            {cards.length} permanent{cards.length !== 1 ? 's' : ''}
          </span>
        )}

        {/* Opponent hand count — always visible so you can track what they're holding */}
        {!isLocal && (
          <span style={{
            marginLeft: compact ? undefined : 'auto',
            fontSize: 9,
            color: player.hand.length > 7
              ? '#f59e0b'
              : player.hand.length === 0
                ? '#334155'
                : '#475569',
            fontWeight: 600,
            flexShrink: 0,
          }}
          title={`${player.name} has ${player.hand.length} card${player.hand.length !== 1 ? 's' : ''} in hand`}
          >
            ✋ {player.hand.length}
          </span>
        )}

        {/* Drag hint — show when dragging an attack toward this player */}
        {isDraggingAttack && !isLocal && (
          <span style={{
            marginLeft: 'auto', fontSize: 9, color: '#ef4444',
            animation: 'pulse 1s infinite',
            fontWeight: 700,
          }}>
            Drop to attack →
          </span>
        )}
      </div>

      {/* Lands */}
      {lands.length > 0 && (
        <div>
          {!compact && <div style={labelStyle}>Lands ({lands.length})</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap }}>{lands.map(renderCard)}</div>
        </div>
      )}

      {/* Non-land permanents */}
      {nonLands.length > 0 && (
        <div>
          {!compact && <div style={labelStyle}>Permanents ({nonLands.length})</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap }}>{nonLands.map(renderCard)}</div>
        </div>
      )}

      {/* Tokens */}
      {(tokenSingles.length > 0 || tokenClouds.length > 0) && (
        <div>
          {!compact && <div style={labelStyle}>Tokens ({tokens.length})</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap, alignItems: 'flex-end' }}>
            {tokenClouds.map(renderTokenCloud)}
            {tokenClouds.filter(c => expandedClouds.has(c.key)).flatMap(c => c.cards.map(renderCard))}
            {tokenSingles.map(renderCard)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {cards.length === 0 && !compact && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flex: 1, gap: 4,
        }}>
          {isDraggingAttack && !isLocal ? (
            <span style={{ color: '#ef444466', fontSize: 12, fontStyle: 'italic' }}>Drop here to attack {player.name}</span>
          ) : (
            <span style={{ color: '#1e293b', fontSize: 11, fontStyle: 'italic' }}>No permanents</span>
          )}
          {/* Show library / graveyard counts as context */}
          {isLocal && (
            <span style={{ fontSize: 9, color: '#1e293b' }}>
              Library: {player.library.length} · GY: {player.graveyard.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
