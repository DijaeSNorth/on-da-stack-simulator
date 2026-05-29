import { useState, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';
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
  const [expandedClouds, setExpandedClouds] = useState<Set<string>>(new Set());

  const cards = player.battlefield.map(id => game.cards[id]).filter(Boolean) as CardState[];

  // Separate land, non-land permanents, tokens
  const lands = cards.filter(c => c.definition.cardTypes.includes('Land'));
  const nonLands = cards.filter(c =>
    !c.definition.cardTypes.includes('Land') && !c.token
  );
  const tokens = cards.filter(c => c.token);

  const { singles: tokenSingles, clouds: tokenClouds } = groupTokenClouds(tokens);

  const cardSize = compact ? 'compact' : cards.length > 30 ? 'compact' : cards.length > 20 ? 'normal' : 'normal';
  const gap = compact ? 2 : 4;

  function handleCardClick(e: React.MouseEvent, instanceId: string) {
    e.preventDefault();
    if (e.type === 'contextmenu') {
      store.openCardContextMenu(instanceId, e.clientX, e.clientY);
    } else {
      store.setSelectedCard(instanceId);
      store.setCardPreview(instanceId);
    }
  }

  function renderCard(card: CardState) {
    const isSelected = ui.selectedCardId === card.instanceId;
    return (
      <div
        key={card.instanceId}
        data-testid={`card-battlefield-${card.instanceId}`}
        style={{
          position: 'relative',
          cursor: 'pointer',
          outline: isSelected ? '2px solid #60a5fa' : 'none',
          borderRadius: 4,
          transition: 'transform 0.1s',
        }}
        onClick={(e) => handleCardClick(e, card.instanceId)}
        onContextMenu={(e) => { e.preventDefault(); handleCardClick(e, card.instanceId); }}
        onMouseEnter={() => store.setHoveredCard(card.instanceId)}
        onMouseLeave={() => store.setHoveredCard(null)}
        title={card.definition.name}
      >
        <CardImage card={card} size={cardSize} />
        {/* Attack arrow indicator */}
        {card.combatRole === 'attacker' && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', borderRadius: '50%',
            width: 12, height: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, color: '#fff', fontWeight: 700,
          }}>⚔</div>
        )}
        {card.combatRole === 'blocker' && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            background: '#3b82f6', borderRadius: '50%',
            width: 12, height: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, color: '#fff', fontWeight: 700,
          }}>🛡</div>
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
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          padding: '4px 6px',
          minWidth: 54,
          transition: 'background 0.15s',
        }}
        onClick={() => setExpandedClouds(prev => {
          const next = new Set(prev);
          if (next.has(cloud.key)) next.delete(cloud.key);
          else next.add(cloud.key);
          return next;
        })}
        title={`${cloud.cards.length}× ${cloud.name} — click to expand`}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
      >
        <div style={{ fontSize: 18, lineHeight: 1 }}>🪙</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>
          ×{cloud.cards.length}
        </div>
        <div style={{ fontSize: 9, color: '#94a3b8' }}>
          {cloud.power}/{cloud.toughness}
        </div>
        {cloud.tappedCount > 0 && (
          <div style={{ fontSize: 9, color: '#f59e0b' }}>
            ↻{cloud.tappedCount}
          </div>
        )}
        {cloud.counters.map(c => (
          <div key={c.type} style={{ fontSize: 8, color: '#6ee7b7' }}>
            {c.type}:{c.total}
          </div>
        ))}
      </div>
    );
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 9,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 3,
    fontWeight: 600,
  };

  return (
    <div
      data-testid={`battlefield-${player.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: compact ? 4 : 6,
        padding: compact ? '4px 6px' : '6px 10px',
        width: '100%',
        minHeight: compact ? 80 : 120,
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      {/* Player name strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        borderBottom: `1px solid ${player.color}44`,
        paddingBottom: compact ? 2 : 4,
        marginBottom: compact ? 2 : 4,
      }}>
        <div style={{
          width: compact ? 8 : 10, height: compact ? 8 : 10,
          borderRadius: '50%',
          background: player.color,
          flexShrink: 0,
          boxShadow: isActive ? `0 0 8px ${player.color}` : 'none',
        }} />
        <span style={{
          fontSize: compact ? 9 : 11,
          fontWeight: 600,
          color: isActive ? '#e2e8f0' : '#94a3b8',
          letterSpacing: '0.03em',
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
      </div>

      {/* Lands row */}
      {lands.length > 0 && (
        <div>
          {!compact && <div style={labelStyle}>Lands ({lands.length})</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap }}>
            {lands.map(renderCard)}
          </div>
        </div>
      )}

      {/* Non-land permanents */}
      {nonLands.length > 0 && (
        <div>
          {!compact && <div style={labelStyle}>Permanents ({nonLands.length})</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap }}>
            {nonLands.map(renderCard)}
          </div>
        </div>
      )}

      {/* Tokens */}
      {(tokenSingles.length > 0 || tokenClouds.length > 0) && (
        <div>
          {!compact && <div style={labelStyle}>Tokens ({tokens.length})</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap, alignItems: 'flex-end' }}>
            {tokenClouds.map(renderTokenCloud)}
            {/* Expanded cloud cards */}
            {tokenClouds
              .filter(c => expandedClouds.has(c.key))
              .flatMap(c => c.cards.map(renderCard))
            }
            {tokenSingles.map(renderCard)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {cards.length === 0 && !compact && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flex: 1, color: '#334155', fontSize: 12, fontStyle: 'italic',
        }}>
          No permanents
        </div>
      )}
    </div>
  );
}
