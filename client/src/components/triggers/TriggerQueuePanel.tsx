// ─── TriggerQueuePanel ────────────────────────────────────────────────────────
//
// Floating trigger queue overlay — appears when there are pending triggers.
// Shows triggers in APNAP order (Active Player > Non-Active Player).
//
// Features:
//   • Shows each pending trigger with source name, controller color, and text
//   • ↑ / ↓ reorder buttons for manual APNAP ordering
//   • "Resolve" button acknowledges top trigger (advances queue)
//   • "Resolve All" batch-acknowledges all pending triggers
//   • "Missed" button marks a trigger as missed (judge logs it, still proceeds)
//   • Trigger type badge (ETB / Upkeep / Attack / etc.)
//   • Collapsed mode when ≥ 4 triggers — expand on click
//   • Glows amber when 1+ pending, red if any are missed
//
// CR references:
//   CR 603 — Handling triggered abilities
//   CR 603.3 — When trigger goes on stack (active player controls order)
//   CR 603.6c — APNAP ordering for simultaneous triggers
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { TriggerItem } from '../../types/game';

// ── Type badge styles ────────────────────────────────────────────────────────

const TYPE_COLORS: Record<TriggerItem['triggerType'], { bg: string; fg: string; label: string }> = {
  ETB:       { bg: '#064e3b', fg: '#34d399', label: 'ETB' },
  attack:    { bg: '#7f1d1d', fg: '#fca5a5', label: 'ATTACK' },
  cast:      { bg: '#123642', fg: '#67e8f9', label: 'CAST' },
  upkeep:    { bg: '#1e3a8a', fg: '#93c5fd', label: 'UPKEEP' },
  graveyard: { bg: '#1e1b4b', fg: '#a5b4fc', label: 'GY' },
  exile:     { bg: '#312e81', fg: '#c4b5fd', label: 'EXILE' },
  damage:    { bg: '#7c2d12', fg: '#fdba74', label: 'DMG' },
  other:     { bg: '#1e293b', fg: '#94a3b8', label: 'OTHER' },
};

function TriggerTypeBadge({ type }: { type: TriggerItem['triggerType'] }) {
  const { bg, fg, label } = TYPE_COLORS[type] ?? TYPE_COLORS.other;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 5px',
        borderRadius: 3,
        fontSize: 8,
        fontWeight: 800,
        letterSpacing: '0.08em',
        background: bg,
        color: fg,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

// ── Individual trigger row ────────────────────────────────────────────────────

interface TriggerRowProps {
  trigger: TriggerItem;
  index: number;
  total: number;
  playerColor: string;
  playerName: string;
  isTop: boolean;
  onAck: () => void;
  onShortcut: () => void;
  onMissed: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function TriggerRow({
  trigger,
  index,
  total,
  playerColor,
  playerName,
  isTop,
  onAck,
  onShortcut,
  onMissed,
  onMoveUp,
  onMoveDown,
}: TriggerRowProps) {
  const [showMissed, setShowMissed] = useState(false);

  return (
    <div
      data-testid={`trigger-row-${trigger.id}`}
      style={{
        background: isTop ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.03)',
        border: isTop ? '1px solid #92400e' : '1px solid #1e293b',
        borderRadius: 6,
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        position: 'relative',
        transition: 'background 0.15s',
      }}
    >
      {/* Header row: index, type badge, source name, controller dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Queue position */}
        <span style={{
          fontSize: 9,
          fontWeight: 800,
          color: isTop ? '#fcd34d' : '#475569',
          width: 16,
          flexShrink: 0,
          textAlign: 'center',
        }}>
          {index + 1}.
        </span>

        {/* Type badge */}
        <TriggerTypeBadge type={trigger.triggerType} />

        {/* Source name */}
        <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', flex: 1, minWidth: 0 }}>
          {trigger.sourceName}
        </span>

        {/* Controller dot + name */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: playerColor,
            display: 'inline-block',
          }} />
          <span style={{ fontSize: 9, color: '#64748b' }}>{playerName}</span>
        </span>
      </div>

      {/* Trigger text */}
      <div style={{ fontSize: 10, color: '#94a3b8', paddingLeft: 22, lineHeight: 1.4 }}>
        {trigger.text}
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 22 }}>
        {/* Resolve (top trigger only highlighted) */}
        <button
          data-testid={`btn-resolve-trigger-${trigger.id}`}
          onClick={onAck}
          style={{
            padding: '3px 10px',
            fontSize: 10,
            fontWeight: 700,
            background: isTop ? '#92400e' : '#1e293b',
            color: isTop ? '#fcd34d' : '#64748b',
            border: `1px solid ${isTop ? '#b45309' : '#334155'}`,
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {isTop ? 'Resolve ↵' : 'Resolve'}
        </button>

        {trigger.effect?.kind === 'vialSmasherDamage' && (
          <button
            data-testid={`btn-trigger-shortcut-${trigger.id}`}
            onClick={onShortcut}
            title="Shortcut: choose a random opponent and apply Vial Smasher damage"
            style={{
              padding: '3px 8px',
              fontSize: 9,
              fontWeight: 800,
              background: '#123642',
              color: '#67e8f9',
              border: '1px solid #0e7490',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Random Damage
          </button>
        )}

        {trigger.effect?.kind === 'poisonFromCombatDamage' && (
          <button
            data-testid={`btn-trigger-shortcut-${trigger.id}`}
            onClick={onShortcut}
            title="Shortcut: apply poison counters from combat damage"
            style={{
              padding: '3px 8px',
              fontSize: 9,
              fontWeight: 800,
              background: '#1f2a10',
              color: '#bef264',
              border: '1px solid #4d7c0f',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Apply Poison
          </button>
        )}

        {trigger.effect?.kind === 'createToken' && (
          <button
            data-testid={`btn-trigger-shortcut-${trigger.id}`}
            onClick={onShortcut}
            title={`Shortcut: create ${trigger.effect.token.name} token${trigger.effect.count === 1 ? '' : 's'}`}
            style={{
              padding: '3px 8px',
              fontSize: 9,
              fontWeight: 800,
              background: '#2e1f10',
              color: '#fdba74',
              border: '1px solid #c2410c',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Create Token
          </button>
        )}

        {/* Reorder buttons */}
        <button
          data-testid={`btn-trigger-up-${trigger.id}`}
          onClick={onMoveUp}
          disabled={index === 0}
          title="Move up (resolves first)"
          style={{
            padding: '2px 6px',
            fontSize: 10,
            background: 'transparent',
            color: index === 0 ? '#334155' : '#64748b',
            border: '1px solid #334155',
            borderRadius: 3,
            cursor: index === 0 ? 'default' : 'pointer',
          }}
        >↑</button>
        <button
          data-testid={`btn-trigger-down-${trigger.id}`}
          onClick={onMoveDown}
          disabled={index === total - 1}
          title="Move down (resolves later)"
          style={{
            padding: '2px 6px',
            fontSize: 10,
            background: 'transparent',
            color: index === total - 1 ? '#334155' : '#64748b',
            border: '1px solid #334155',
            borderRadius: 3,
            cursor: index === total - 1 ? 'default' : 'pointer',
          }}
        >↓</button>

        {/* Missed button (with confirmation) */}
        {!showMissed ? (
          <button
            data-testid={`btn-trigger-missed-${trigger.id}`}
            onClick={() => setShowMissed(true)}
            title="Mark as missed trigger (CR 603)"
            style={{
              padding: '2px 6px',
              fontSize: 9,
              background: 'transparent',
              color: '#475569',
              border: '1px solid #334155',
              borderRadius: 3,
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            Missed
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 3, marginLeft: 'auto', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#f87171' }}>Miss trigger?</span>
            <button
              data-testid={`btn-confirm-missed-${trigger.id}`}
              onClick={() => { setShowMissed(false); onMissed(); }}
              style={{ padding: '2px 6px', fontSize: 9, background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 3, cursor: 'pointer' }}
            >Yes</button>
            <button
              onClick={() => setShowMissed(false)}
              style={{ padding: '2px 6px', fontSize: 9, background: '#1e293b', color: '#64748b', border: 'none', borderRadius: 3, cursor: 'pointer' }}
            >No</button>
          </div>
        )}
      </div>

      {/* APNAP badge for top position */}
      {isTop && (
        <div style={{
          position: 'absolute',
          top: -1,
          right: -1,
          background: '#92400e',
          color: '#fcd34d',
          fontSize: 8,
          fontWeight: 800,
          padding: '1px 5px',
          borderRadius: '0 5px 0 4px',
          letterSpacing: '0.05em',
        }}>
          NEXT
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function TriggerQueuePanel() {
  const store = useGameStore();
  const { game } = store;
  const [collapsed, setCollapsed] = useState(false);

  const pending   = game.triggerQueue.filter(t => !t.acknowledged);
  const hasMissed = game.triggerQueue.some(t => t.missed);
  const visiblePending = pending.slice(0, 25);
  const hiddenPendingCount = pending.length - visiblePending.length;

  const resolveAll = useCallback(() => {
    store.ackAllTriggers();
  }, [store]);

  // Don't render if nothing pending
  if (pending.length === 0) return null;

  const headerColor = hasMissed ? '#ef4444' : '#f59e0b';
  const headerBg    = hasMissed ? 'rgba(127,29,29,0.95)' : 'rgba(120,53,15,0.95)';

  return (
    <div
      data-testid="trigger-queue-panel"
      style={{
        position: 'fixed',
        bottom: 60,
        right: 16,
        width: 340,
        zIndex: 200,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: `0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px ${headerColor}44`,
        userSelect: 'none',
      }}
    >
      {/* Header */}
      <div
        data-testid="trigger-queue-header"
        onClick={() => setCollapsed(c => !c)}
        style={{
          background: headerBg,
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          cursor: 'pointer',
          borderBottom: collapsed ? 'none' : `1px solid ${headerColor}44`,
        }}
      >
        {/* Pulse dot */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: headerColor,
          boxShadow: `0 0 8px ${headerColor}`,
          flexShrink: 0,
          animation: 'trigger-pulse 1.4s ease-in-out infinite',
        }} />

        <span style={{ fontSize: 11, fontWeight: 800, color: headerColor, flex: 1, letterSpacing: '0.04em' }}>
          TRIGGER QUEUE
        </span>

        {/* Count badge */}
        <span style={{
          background: headerColor,
          color: '#0f172a',
          fontSize: 10,
          fontWeight: 800,
          padding: '1px 6px',
          borderRadius: 10,
        }}>
          {pending.length}
        </span>

        {/* Collapse indicator */}
        <span style={{ fontSize: 12, color: headerColor, transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          ▲
        </span>
      </div>

      {/* Body */}
      {!collapsed && (
        <div style={{ background: 'rgba(15,23,42,0.97)', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>

          {/* APNAP note */}
          <div style={{
            fontSize: 9, color: '#475569',
            padding: '3px 8px',
            background: 'rgba(71,85,105,0.12)',
            borderRadius: 4,
            marginBottom: 2,
          }}>
            CR 603.6c — Use ↑↓ to set APNAP order. Triggers resolve from top.
          </div>

          {/* Trigger rows */}
          {visiblePending.map((t, i) => {
            const player = game.players.find(p => p.id === t.controllerId);
            return (
              <TriggerRow
                key={t.id}
                trigger={t}
                index={i}
                total={pending.length}
                playerColor={player?.color ?? '#475569'}
                playerName={player?.name ?? t.controllerId}
                isTop={i === 0}
                onAck={() => store.ackTrigger(t.id)}
                onShortcut={() => store.applyTriggerShortcut(t.id)}
                onMissed={() => store.markTriggerMissed(t.id)}
                onMoveUp={() => store.moveTriggerUp(t.id)}
                onMoveDown={() => store.moveTriggerDown(t.id)}
              />
            );
          })}

          {hiddenPendingCount > 0 && (
            <div
              style={{
                fontSize: 10,
                color: '#94a3b8',
                padding: '6px 8px',
                background: 'rgba(148,163,184,0.08)',
                border: '1px dashed #334155',
                borderRadius: 5,
                textAlign: 'center',
              }}
            >
              +{hiddenPendingCount} more pending triggers. Resolve all still affects the full queue.
            </div>
          )}

          {/* Footer: Resolve All button (only when 2+ triggers) */}
          {pending.length >= 2 && (
            <button
              data-testid="btn-resolve-all-triggers"
              onClick={resolveAll}
              style={{
                marginTop: 4,
                padding: '5px 0',
                width: '100%',
                fontSize: 10,
                fontWeight: 700,
                background: '#1e293b',
                color: '#64748b',
                border: '1px solid #334155',
                borderRadius: 5,
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              Resolve All ({pending.length})
            </button>
          )}
        </div>
      )}

      {/* CSS animation for pulse */}
      <style>{`
        @keyframes trigger-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
