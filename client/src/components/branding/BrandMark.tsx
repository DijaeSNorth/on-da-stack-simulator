import type { CSSProperties } from 'react';

interface BrandMarkProps {
  size?: number;
  compact?: boolean;
}

const cardLayerBase: CSSProperties = {
  position: 'absolute',
  width: '58%',
  height: '72%',
  borderRadius: 5,
  boxShadow: '0 8px 18px rgba(0,0,0,0.35)',
};

export function BrandMark({ size = 34, compact = false }: BrandMarkProps) {
  return (
    <div
      aria-label="On-Da-Stack logo placeholder"
      title="Logo placeholder"
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        borderRadius: 8,
        border: '1px dashed rgba(148,163,184,0.45)',
        background: 'linear-gradient(145deg, rgba(8,13,17,0.95), rgba(21,28,32,0.95))',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04), 0 0 22px rgba(34,211,238,0.12)',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          ...cardLayerBase,
          transform: 'translate(-12%, -8%) rotate(-9deg)',
          background: 'linear-gradient(160deg, #2a1711, #10151b)',
          border: '1px solid rgba(245,158,11,0.55)',
        }}
      />
      <span
        style={{
          ...cardLayerBase,
          transform: 'translate(8%, 4%) rotate(5deg)',
          background: 'linear-gradient(160deg, #082f35, #10151b)',
          border: '1px solid rgba(34,211,238,0.62)',
        }}
      />
      {!compact && (
        <span
          style={{
            position: 'relative',
            zIndex: 1,
            color: '#e5e7eb',
            fontSize: Math.max(7, Math.round(size * 0.22)),
            fontWeight: 800,
            letterSpacing: 0,
            textShadow: '0 1px 4px rgba(0,0,0,0.7)',
          }}
        >
          ODS
        </span>
      )}
    </div>
  );
}
