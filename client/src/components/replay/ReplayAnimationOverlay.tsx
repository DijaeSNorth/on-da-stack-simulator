import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { ReplayAnimation } from '../../types/replay';

export function ReplayAnimationOverlay() {
  const replay = useGameStore(s => s.replay);
  const clearAnimations = useGameStore(s => s.replayClearAnimations);
  const animations = replay?.currentAnimations ?? [];
  const mode = replay?.animationMode ?? 'off';

  useEffect(() => {
    if (!animations.length || mode === 'off') return;
    const duration = Math.max(...animations.map(animation => animation.durationMs));
    const timer = window.setTimeout(clearAnimations, duration);
    return () => window.clearTimeout(timer);
  }, [animations, clearAnimations, mode]);

  if (!replay || mode === 'off' || animations.length === 0) return null;
  const primary = animations[0];

  return (
    <div
      data-testid="replay-animation-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 60,
        overflow: 'hidden',
      }}
    >
      <style>{`
        @keyframes replayPulse {
          0% { transform: scale(0.96); opacity: 0; }
          18% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.04); opacity: 0; }
        }
        @keyframes replayArrow {
          0% { transform: translateX(-18px); opacity: 0; }
          22% { opacity: 1; }
          100% { transform: translateX(28px); opacity: 0; }
        }
        @keyframes replayPop {
          0% { transform: translateY(10px) scale(0.9); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translateY(-18px) scale(1.04); opacity: 0; }
        }
      `}</style>
      <div style={{
        position: 'absolute',
        left: '50%',
        top: primary.type === 'turn_banner' ? '34%' : 18,
        transform: 'translateX(-50%)',
        minWidth: mode === 'dramatic' ? 280 : 180,
        maxWidth: '72%',
        textAlign: 'center',
        padding: mode === 'dramatic' ? '13px 18px' : '8px 12px',
        borderRadius: 8,
        border: `1px solid ${colorFor(primary)}99`,
        background: mode === 'dramatic' ? 'rgba(2,6,23,0.88)' : 'rgba(15,23,42,0.78)',
        color: '#f8fafc',
        boxShadow: `0 0 34px ${colorFor(primary)}33`,
        animation: `replayPulse ${primary.durationMs}ms ease-out both`,
        fontSize: mode === 'dramatic' ? 16 : 12,
        fontWeight: 900,
        letterSpacing: 0,
      }}>
        {primary.label}
      </div>
      {animations.map((animation, index) => (
        <ReplayAnimationGlyph key={animation.id} animation={animation} index={index} dramatic={mode === 'dramatic'} />
      ))}
    </div>
  );
}

function ReplayAnimationGlyph({ animation, index, dramatic }: { animation: ReplayAnimation; index: number; dramatic: boolean }) {
  const color = colorFor(animation);
  const left = 18 + ((index * 17) % 58);
  const top = 30 + ((index * 13) % 44);
  if (animation.type === 'attack' || animation.type === 'block') {
    return (
      <div style={{
        position: 'absolute',
        left: `${Math.min(left, 72)}%`,
        top: `${top}%`,
        width: dramatic ? 190 : 130,
        height: 3,
        background: color,
        boxShadow: `0 0 18px ${color}`,
        animation: `replayArrow ${animation.durationMs}ms ease-out both`,
      }} />
    );
  }
  if (animation.type === 'damage' || animation.type === 'life_change' || animation.type === 'counter_change') {
    return (
      <div style={{
        position: 'absolute',
        right: `${18 + index * 5}%`,
        top: `${24 + index * 9}%`,
        color,
        fontSize: dramatic ? 24 : 17,
        fontWeight: 950,
        textShadow: '0 2px 12px #020617',
        animation: `replayPop ${animation.durationMs}ms ease-out both`,
      }}>
        {animation.amount !== undefined ? animation.amount > 0 ? `+${animation.amount}` : animation.amount : animation.type.replace('_', ' ')}
      </div>
    );
  }
  return (
    <div style={{
      position: 'absolute',
      left: `${left}%`,
      top: `${top}%`,
      width: dramatic ? 72 : 46,
      height: dramatic ? 96 : 62,
      borderRadius: 6,
      border: `2px solid ${color}`,
      background: `${color}18`,
      boxShadow: `0 0 26px ${color}55`,
      animation: `replayPulse ${animation.durationMs}ms ease-out both`,
    }} />
  );
}

function colorFor(animation: ReplayAnimation): string {
  switch (animation.type) {
    case 'draw_card': return '#22c55e';
    case 'cast_spell': return '#60a5fa';
    case 'attack': return '#ef4444';
    case 'block': return '#3b82f6';
    case 'damage':
    case 'life_change': return '#f97316';
    case 'counter_change': return '#34d399';
    case 'token_create': return '#2dd4bf';
    case 'mechanic_firebending': return '#f43f5e';
    case 'mechanic_airbend': return '#bae6fd';
    case 'mechanic_waterbend': return '#38bdf8';
    case 'mechanic_earthbend': return '#84cc16';
    case 'mechanic_warp': return '#a78bfa';
    case 'mechanic_sneak': return '#facc15';
    case 'turn_banner': return '#f8fafc';
    default: return '#94a3b8';
  }
}
