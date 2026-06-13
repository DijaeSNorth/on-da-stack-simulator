import { useState } from 'react';
import type { CardState } from '../../types/game';
import { getCardPlaceholderStyle } from '../../data/cardDatabase';
import { getActiveProfile, getArtOverride } from '../../engine/profileStorage';
import { getMechanicBadgesForCard } from '../../rules/mechanicsRegistry';
import { useGameStore } from '../../store/gameStore';

interface CardImageProps {
  card: CardState;
  size?: 'tiny' | 'compact' | 'normal' | 'large' | 'preview';
  showArt?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const SIZE_DIMS = {
  tiny: { width: 28, height: 39 },
  compact: { width: 46, height: 64 },
  normal: { width: 74, height: 103 },
  large: { width: 120, height: 167 },
  preview: { width: 265, height: 370 },
};

export function CardImage({ card, size = 'normal', showArt = true, className = '', style }: CardImageProps) {
  const [imgError, setImgError] = useState(false);
  const showMechanicBadges = useGameStore(s => s.ui.settings.showMechanicBadges);
  const def = card.definition;
  const dims = SIZE_DIMS[size];

  // Art override: check active profile for a player-chosen print
  const activeProfile = getActiveProfile();
  const artOverride = getArtOverride(activeProfile, def.name);
  const imageUrl = artOverride?.imageUrl ?? (card.transformed ? def.imageUrlBack : def.imageUrl);
  const placeholder = getCardPlaceholderStyle(def);
  const mechanicBadges = !showMechanicBadges || size === 'tiny' ? [] : getMechanicBadgesForCard(card).slice(0, size === 'compact' ? 2 : 3);

  const containerStyle: React.CSSProperties = {
    width: dims.width,
    height: dims.height,
    borderRadius: size === 'preview' ? 10 : 4,
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
    transition: 'transform 0.15s ease',
    ...style,
  };

  // Tapped rotation
  const wrapStyle: React.CSSProperties = {
    transform: card.tapped ? 'rotate(90deg)' : 'none',
    transformOrigin: 'center',
    transition: 'transform 0.2s ease',
    display: 'inline-flex',
    position: 'relative',
  };

  return (
    <div style={wrapStyle} className={className}>
      <div style={containerStyle}>
        {showArt && imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={def.name}
            onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            loading="lazy"
          />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: placeholder,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '4px',
            boxSizing: 'border-box',
          }}>
            {size !== 'tiny' && (
              <span style={{
                fontSize: size === 'compact' ? 7 : size === 'preview' ? 12 : 9,
                fontWeight: 600,
                color: def.colors[0] === 'W' || def.colors.length === 0 ? '#222' : '#fff',
                textAlign: 'center',
                lineHeight: 1.2,
                wordBreak: 'break-word',
                maxWidth: '100%',
              }}>
                {def.name}
              </span>
            )}
          </div>
        )}

        {/* Counter badges */}
        {card.counters.length > 0 && size !== 'tiny' && (
          <div style={{
            position: 'absolute', bottom: 2, right: 2,
            display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end',
            maxWidth: '100%',
          }}>
            {card.counters.map(c => (
              <span key={c.type} style={{
                background: c.type === '+1/+1' ? '#22c55e' : c.type === '-1/-1' ? '#ef4444' : '#6366f1',
                color: '#fff',
                fontSize: 8,
                fontWeight: 700,
                borderRadius: 2,
                padding: '1px 3px',
                lineHeight: 1,
              }}>
                {c.type === '+1/+1' ? `+${c.count}` : c.type === '-1/-1' ? `-${c.count}` : `${c.type} ×${c.count}`}
              </span>
            ))}
          </div>
        )}

        {/* Summoning sickness dot */}
        {card.summoningSick && card.definition.cardTypes.includes('Creature') && size !== 'tiny' && (
          <div style={{
            position: 'absolute', top: 2, left: 2,
            width: 6, height: 6, borderRadius: '50%',
            background: '#f59e0b',
            boxShadow: '0 0 4px #f59e0b',
          }} title="Summoning sickness" />
        )}

        {/* Token badge */}
        {card.token && size !== 'tiny' && (
          <div style={{
            position: 'absolute', top: 2, right: 2,
            background: 'rgba(0,0,0,0.7)',
            color: '#facc15',
            fontSize: 7, fontWeight: 700,
            borderRadius: 2, padding: '1px 3px',
          }}>T</div>
        )}

        {/* Mechanic metadata badges */}
        {mechanicBadges.length > 0 && (
          <div style={{
            position: 'absolute',
            top: 2,
            left: card.summoningSick && card.definition.cardTypes.includes('Creature') ? 10 : 2,
            display: 'flex',
            gap: 2,
            maxWidth: '72%',
            overflow: 'hidden',
          }}>
            {mechanicBadges.map(badge => (
              <span key={badge.id} title={badge.title} style={{
                background: badge.manual ? 'rgba(245, 158, 11, 0.88)' : 'rgba(14, 165, 233, 0.88)',
                color: '#fff',
                fontSize: size === 'compact' ? 6 : 7,
                fontWeight: 800,
                borderRadius: 2,
                padding: '1px 3px',
                lineHeight: 1,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
                {badge.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Mana Symbol Renderer ─────────────────────────────────────────────────────

const MANA_COLORS: Record<string, { bg: string; color: string; symbol: string }> = {
  W: { bg: '#f9f6ee', color: '#78716c', symbol: 'W' },
  U: { bg: '#0e68ab', color: '#fff', symbol: 'U' },
  B: { bg: '#2d2d2d', color: '#e5e5e5', symbol: 'B' },
  R: { bg: '#d3202a', color: '#fff', symbol: 'R' },
  G: { bg: '#00733e', color: '#fff', symbol: 'G' },
  C: { bg: '#b5b5b5', color: '#fff', symbol: 'C' },
  X: { bg: '#6b7280', color: '#fff', symbol: 'X' },
};

export function ManaCost({ cost }: { cost: string }) {
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);

  return (
    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      {symbols.map((sym, i) => {
        const mc = MANA_COLORS[sym];
        const isGeneric = !isNaN(Number(sym));

        return (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 16, height: 16, borderRadius: '50%',
            background: mc ? mc.bg : isGeneric ? '#9ca3af' : '#6b7280',
            color: mc ? mc.color : '#fff',
            fontSize: 9, fontWeight: 700,
            border: '1px solid rgba(0,0,0,0.2)',
            lineHeight: 1,
          }}>
            {sym}
          </span>
        );
      })}
    </div>
  );
}
