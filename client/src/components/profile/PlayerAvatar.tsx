import type { CSSProperties } from 'react';
import type { PlayerAvatarImage } from '../../types/game';

interface PlayerAvatarProps {
  name?: string;
  color: string;
  initial?: string;
  styleMode?: 'solid' | 'gradient' | 'outline';
  image?: PlayerAvatarImage;
  size?: number;
  square?: boolean;
}

export function PlayerAvatar({
  name = 'Player',
  color,
  initial = '?',
  styleMode = 'solid',
  image,
  size = 36,
  square = false,
}: PlayerAvatarProps) {
  const radius = square ? Math.max(5, size * 0.16) : '50%';
  const bg =
    styleMode === 'gradient'
      ? `linear-gradient(135deg, ${color}, ${color}88)`
      : styleMode === 'outline'
        ? 'transparent'
        : color;

  const baseStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    background: bg,
    border: styleMode === 'outline' ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size * 0.42,
    fontWeight: 800,
    color: styleMode === 'outline' ? color : '#fff',
    flexShrink: 0,
    userSelect: 'none',
    overflow: 'hidden',
    position: 'relative',
    boxShadow: `0 0 0 1px rgba(0,0,0,0.35), 0 0 ${Math.max(6, size * 0.22)}px ${color}44`,
  };

  return (
    <div style={baseStyle} title={image?.label ? `${name} - ${image.label}` : name}>
      {image?.url ? (
        <img
          src={image.url}
          alt={`${name} avatar`}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: '50% 35%',
            display: 'block',
          }}
          onError={event => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        initial || '?'
      )}
    </div>
  );
}
