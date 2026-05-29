// ─── PhaseGuideBar ────────────────────────────────────────────────────────────
//
// A player-driven phase guidance bar. Never auto-advances anything.
// Shows where you are in the turn, what's typically done in this phase,
// and lets the player choose when to move forward.
//
// Layout:
//   [Phase Timeline Pills] ··· [Phase Hint + Context Warnings] [Priority + Controls]
//
// Rules:
//   - ALL actions are opt-in. No phase changes without a click.
//   - Suggestions are advisory only ("Ready to proceed?" — not a forced advance).
//   - Stack items block the "next phase" suggestion with a warning.
//   - Pending triggers block the "next phase" suggestion with a warning.
//   - Players can always jump to any phase via the timeline pills (judge-mode freedom).
//   - Pass Priority rotates priority through all players in seat order.
// ──────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import type { Phase } from '../types/game';

// ── Phase metadata ─────────────────────────────────────────────────────────────

interface PhaseMeta {
  label: string;
  short: string;
  hint: string;
  /** Advisory reminder shown below the hint */
  reminder?: string;
  group: 'beginning' | 'precombat' | 'combat' | 'postcombat' | 'ending';
}

const PHASE_META: Record<Phase, PhaseMeta> = {
  untap: {
    label: 'Untap',
    short: 'UN',
    hint: 'Untap all your permanents. No player receives priority here.',
    reminder: 'Phasing, Day/Night, and "at the beginning of untap" effects apply here.',
    group: 'beginning',
  },
  upkeep: {
    label: 'Upkeep',
    short: 'UP',
    hint: 'Upkeep triggers go on the stack. Handle any upkeep costs.',
    reminder: 'Check for cumulative upkeep, Sagas, Rhystic Study, etc.',
    group: 'beginning',
  },
  draw: {
    label: 'Draw',
    short: 'DR',
    hint: 'Draw your card for the turn. Opponents can respond.',
    reminder: 'Howling Mine, Consecrated Sphinx, and other draw-replacement effects apply here.',
    group: 'beginning',
  },
  main1: {
    label: 'Main 1',
    short: 'M1',
    hint: 'Cast spells, activate abilities, and play your land. No timing restrictions while the stack is empty.',
    reminder: 'You may play one land this turn if you haven\'t already.',
    group: 'precombat',
  },
  beginningOfCombat: {
    label: 'Begin Combat',
    short: 'BC',
    hint: 'Combat begins. Last chance to cast instants before attackers are declared.',
    reminder: 'Declare attackers in the next step. Tap creatures with summoning sickness now.',
    group: 'combat',
  },
  declareAttackers: {
    label: 'Attackers',
    short: 'ATK',
    hint: 'Declare your attacking creatures. Drag them to an opponent\'s zone, or use the Combat Panel.',
    reminder: 'Tapped creatures and those with summoning sickness can\'t attack. Vigilance creatures don\'t tap.',
    group: 'combat',
  },
  declareBlockers: {
    label: 'Blockers',
    short: 'BLK',
    hint: 'Defending players declare blockers. Drag creatures onto attackers.',
    reminder: 'Flying can only be blocked by flying or reach. Multiple blockers allowed per attacker.',
    group: 'combat',
  },
  combatDamage: {
    label: 'Damage',
    short: 'DMG',
    hint: 'Combat damage is dealt. First strike / double strike apply.',
    reminder: 'Assign damage to multiple blockers in order. Trample damage hits the player after blockers are lethal.',
    group: 'combat',
  },
  endOfCombat: {
    label: 'End Combat',
    short: 'EC',
    hint: '"At end of combat" triggers go on the stack. Myriad tokens are exiled.',
    reminder: 'Last chance to respond before leaving combat. Combat damage stays marked.',
    group: 'combat',
  },
  main2: {
    label: 'Main 2',
    short: 'M2',
    hint: 'Second main phase. Cast sorceries, creatures, and other permanents.',
    reminder: 'You may still play a land if you haven\'t this turn.',
    group: 'postcombat',
  },
  endStep: {
    label: 'End Step',
    short: 'END',
    hint: '"At the beginning of the end step" triggers fire. Hand size checked during cleanup.',
    reminder: 'Opponents can cast instants here. Teferi triggers apply.',
    group: 'ending',
  },
  cleanup: {
    label: 'Cleanup',
    short: 'CLN',
    hint: 'Discard to hand size (7 by default). Damage is removed from creatures. "Until end of turn" effects end.',
    reminder: 'No priority is received unless a trigger fires or an effect requires it.',
    group: 'ending',
  },
};

const PHASE_ORDER: Phase[] = [
  'untap', 'upkeep', 'draw', 'main1',
  'beginningOfCombat', 'declareAttackers', 'declareBlockers',
  'combatDamage', 'endOfCombat',
  'main2', 'endStep', 'cleanup',
];

const GROUP_COLORS: Record<PhaseMeta['group'], string> = {
  beginning:   '#1e3a5f',
  precombat:   '#064e3b',
  combat:      '#7f1d1d',
  postcombat:  '#064e3b',
  ending:      '#312e81',
};

const GROUP_ACCENT: Record<PhaseMeta['group'], string> = {
  beginning:   '#60a5fa',
  precombat:   '#34d399',
  combat:      '#f87171',
  postcombat:  '#34d399',
  ending:      '#a78bfa',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function PhasePill({
  phase,
  currentPhase,
  onClick,
}: {
  phase: Phase;
  currentPhase: Phase;
  onClick: () => void;
}) {
  const meta   = PHASE_META[phase];
  const curIdx = PHASE_ORDER.indexOf(currentPhase);
  const idx    = PHASE_ORDER.indexOf(phase);
  const isCurrent = phase === currentPhase;
  const isPast    = idx < curIdx;
  const accent    = GROUP_ACCENT[meta.group];

  return (
    <button
      data-testid={`phase-pill-${phase}`}
      onClick={onClick}
      title={`Jump to ${meta.label}`}
      style={{
        padding: '3px 7px',
        fontSize: 9,
        fontWeight: isCurrent ? 800 : 600,
        letterSpacing: isCurrent ? '0.04em' : '0.02em',
        borderRadius: 4,
        border: isCurrent
          ? `1px solid ${accent}`
          : isPast
            ? '1px solid #1e293b'
            : '1px solid #0f172a',
        background: isCurrent
          ? `${GROUP_COLORS[meta.group]}`
          : isPast
            ? 'rgba(255,255,255,0.03)'
            : 'transparent',
        color: isCurrent
          ? accent
          : isPast
            ? '#334155'
            : '#475569',
        cursor: 'pointer',
        transition: 'all 0.12s',
        flexShrink: 0,
        boxShadow: isCurrent ? `0 0 8px ${accent}44` : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {meta.short}
    </button>
  );
}

// ── Context warnings (things that should be resolved before advancing) ────────

interface ContextWarning {
  text: string;
  severity: 'block' | 'warn' | 'info';
}

function getContextWarnings(
  phase: Phase,
  stackSize: number,
  pendingTriggers: number,
  localIsActive: boolean,
  attackers: number,
): ContextWarning[] {
  const warnings: ContextWarning[] = [];

  if (stackSize > 0) {
    warnings.push({
      text: `Stack has ${stackSize} item${stackSize > 1 ? 's' : ''} — resolve before advancing`,
      severity: 'block',
    });
  }
  if (pendingTriggers > 0) {
    warnings.push({
      text: `${pendingTriggers} trigger${pendingTriggers > 1 ? 's' : ''} pending — acknowledge before advancing`,
      severity: 'warn',
    });
  }
  if (phase === 'declareAttackers' && localIsActive && attackers === 0) {
    warnings.push({ text: 'No attackers declared — pass if not attacking', severity: 'info' });
  }
  if (phase === 'cleanup') {
    warnings.push({ text: 'Check hand size ≤ 7 before ending turn', severity: 'info' });
  }

  return warnings;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PhaseGuideBar() {
  const store    = useGameStore();
  const { game, localPlayerId } = store;
  const [expanded, setExpanded] = useState(false);

  if (game.players.length === 0) return null;

  const currentPhase   = game.phase;
  const meta           = PHASE_META[currentPhase];
  const accent         = GROUP_ACCENT[meta.group];
  const activePlayer   = game.players.find(p => p.id === game.activePlayerId);
  const priorityPlayer = game.players.find(p => p.id === game.priorityPlayerId);
  const localIsActive  = game.activePlayerId === localPlayerId;
  const localHasPriority = game.priorityPlayerId === localPlayerId;

  const stackSize      = game.stack.length;
  const pendingTriggers = game.triggerQueue.filter(t => !t.acknowledged).length;
  const attackers      = game.combat.attackers.length;

  const warnings = getContextWarnings(currentPhase, stackSize, pendingTriggers, localIsActive, attackers);
  const hasBlocker = warnings.some(w => w.severity === 'block');

  // What phase comes next?
  const curIdx   = PHASE_ORDER.indexOf(currentPhase);
  const nextPhase = curIdx < PHASE_ORDER.length - 1 ? PHASE_ORDER[curIdx + 1] : null;
  const nextMeta  = nextPhase ? PHASE_META[nextPhase] : null;
  const isLastPhase = !nextPhase;

  // Priority chain: who comes after current priority holder?
  const priorityIdx  = game.players.findIndex(p => p.id === game.priorityPlayerId);
  const nextPriority = game.players[(priorityIdx + 1) % game.players.length];

  return (
    <div
      data-testid="phase-guide-bar"
      style={{
        background: '#080f1a',
        borderBottom: '1px solid #1e293b',
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: expanded ? 'auto' : 32,
        minHeight: 32,
        flexShrink: 0,
        position: 'relative',
        overflow: expanded ? 'visible' : 'hidden',
      }}
    >
      {/* ── Phase Timeline ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
        {PHASE_ORDER.map(ph => (
          <PhasePill
            key={ph}
            phase={ph}
            currentPhase={currentPhase}
            onClick={() => store.goToPhase(ph)}
          />
        ))}
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 18, background: '#1e293b', flexShrink: 0 }} />

      {/* ── Phase hint (compact, expandable) ──────────────────────────────── */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
        title="Click to expand phase details"
      >
        {/* Current phase accent dot */}
        <span style={{
          width: 6, height: 6, borderRadius: '50%',
          background: accent,
          boxShadow: `0 0 5px ${accent}`,
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 10, color: accent, fontWeight: 700, flexShrink: 0 }}>
          {meta.label}
        </span>
        <span style={{
          fontSize: 10, color: '#475569',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {meta.hint}
        </span>
        {/* Expand indicator */}
        <span style={{ fontSize: 9, color: '#334155', flexShrink: 0, marginLeft: 2 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* ── Context warnings ──────────────────────────────────────────────── */}
      {warnings.map((w, i) => (
        <div
          key={i}
          style={{
            fontSize: 9,
            color: w.severity === 'block' ? '#f87171'
                 : w.severity === 'warn'  ? '#fcd34d'
                 : '#60a5fa',
            background: w.severity === 'block' ? 'rgba(127,29,29,0.4)'
                      : w.severity === 'warn'  ? 'rgba(120,53,15,0.4)'
                      : 'rgba(30,58,95,0.4)',
            border: `1px solid ${w.severity === 'block' ? '#7f1d1d' : w.severity === 'warn' ? '#78350f' : '#1e3a5f'}`,
            borderRadius: 4,
            padding: '2px 7px',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {w.severity === 'block' ? '⛔' : w.severity === 'warn' ? '⚠' : 'ℹ'} {w.text}
        </div>
      ))}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* ── Priority display ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {priorityPlayer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{
              fontSize: 9, color: '#475569',
            }}>
              Priority:
            </span>
            <span style={{
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: priorityPlayer.color,
                boxShadow: `0 0 4px ${priorityPlayer.color}`,
                display: 'inline-block',
              }} />
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: localHasPriority ? '#e2e8f0' : '#64748b',
              }}>
                {localHasPriority ? 'You' : priorityPlayer.name}
              </span>
            </span>
          </div>
        )}

        {/* Pass Priority button */}
        <button
          data-testid="btn-pass-priority-guide"
          onClick={store.passPriority}
          title={`Pass priority to ${nextPriority?.name ?? '…'}`}
          style={{
            padding: '3px 9px',
            fontSize: 9,
            fontWeight: 700,
            background: localHasPriority ? 'rgba(30,58,95,0.6)' : 'transparent',
            color: localHasPriority ? '#93c5fd' : '#475569',
            border: `1px solid ${localHasPriority ? '#1e3a5f' : '#1e293b'}`,
            borderRadius: 4,
            cursor: 'pointer',
            letterSpacing: '0.03em',
            transition: 'all 0.12s',
          }}
        >
          Pass → {nextPriority?.name ? nextPriority.name.slice(0, 8) : '…'}
        </button>

        {/* Divider */}
        <div style={{ width: 1, height: 16, background: '#1e293b' }} />

        {/* ── Suggested next action ──────────────────────────────────────── */}
        {!isLastPhase ? (
          <button
            data-testid="btn-suggest-next-phase"
            onClick={() => !hasBlocker && store.advancePhase()}
            disabled={hasBlocker}
            title={
              hasBlocker
                ? 'Resolve stack / triggers before advancing'
                : `Proceed to ${nextMeta?.label}`
            }
            style={{
              padding: '3px 11px',
              fontSize: 9,
              fontWeight: 800,
              background: hasBlocker
                ? 'rgba(127,29,29,0.3)'
                : `${GROUP_COLORS[PHASE_META[nextPhase!].group]}`,
              color: hasBlocker
                ? '#7f1d1d'
                : GROUP_ACCENT[PHASE_META[nextPhase!].group],
              border: `1px solid ${hasBlocker ? '#7f1d1d' : GROUP_ACCENT[PHASE_META[nextPhase!].group] + '66'}`,
              borderRadius: 4,
              cursor: hasBlocker ? 'not-allowed' : 'pointer',
              opacity: hasBlocker ? 0.6 : 1,
              letterSpacing: '0.03em',
              transition: 'all 0.12s',
            }}
          >
            {hasBlocker ? 'Blocked ⛔' : `→ ${nextMeta?.label}`}
          </button>
        ) : (
          /* Last phase = End Turn button */
          <button
            data-testid="btn-end-turn-guide"
            onClick={() => !hasBlocker && store.advanceTurn()}
            disabled={hasBlocker}
            title={hasBlocker ? 'Resolve stack / triggers first' : 'End turn'}
            style={{
              padding: '3px 11px',
              fontSize: 9,
              fontWeight: 800,
              background: hasBlocker ? 'rgba(127,29,29,0.3)' : 'rgba(124,58,237,0.3)',
              color: hasBlocker ? '#7f1d1d' : '#c4b5fd',
              border: `1px solid ${hasBlocker ? '#7f1d1d' : '#7c3aed44'}`,
              borderRadius: 4,
              cursor: hasBlocker ? 'not-allowed' : 'pointer',
              opacity: hasBlocker ? 0.6 : 1,
              letterSpacing: '0.03em',
            }}
          >
            {hasBlocker ? 'Blocked ⛔' : 'End Turn →'}
          </button>
        )}
      </div>

      {/* ── Expanded detail panel ─────────────────────────────────────────── */}
      {expanded && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: '#0a1628',
          border: '1px solid #1e293b',
          borderTop: 'none',
          padding: '10px 14px',
          zIndex: 150,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          {/* Full phase hint */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{
              fontSize: 9, fontWeight: 800, color: accent,
              background: GROUP_COLORS[meta.group],
              border: `1px solid ${accent}44`,
              borderRadius: 4,
              padding: '3px 8px',
              flexShrink: 0,
              letterSpacing: '0.06em',
            }}>
              {meta.label.toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.5 }}>{meta.hint}</div>
              {meta.reminder && (
                <div style={{ fontSize: 10, color: '#475569', marginTop: 4, lineHeight: 1.4 }}>
                  📌 {meta.reminder}
                </div>
              )}
            </div>
          </div>

          {/* Phase progression overview */}
          <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            {PHASE_ORDER.map((ph, i) => {
              const m    = PHASE_META[ph];
              const isCur = ph === currentPhase;
              const isPast = i < curIdx;
              return (
                <div key={ph} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {i > 0 && (
                    <span style={{ fontSize: 8, color: '#1e293b' }}>›</span>
                  )}
                  <button
                    onClick={() => { store.goToPhase(ph); setExpanded(false); }}
                    style={{
                      fontSize: 9, padding: '2px 6px',
                      borderRadius: 3,
                      border: isCur ? `1px solid ${GROUP_ACCENT[m.group]}` : '1px solid transparent',
                      background: isCur ? GROUP_COLORS[m.group] : 'transparent',
                      color: isCur ? GROUP_ACCENT[m.group] : isPast ? '#334155' : '#64748b',
                      cursor: 'pointer',
                      fontWeight: isCur ? 700 : 400,
                    }}
                  >
                    {m.label}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Turn context */}
          <div style={{ display: 'flex', gap: 16, fontSize: 10, color: '#475569' }}>
            <span>Turn {game.turn}</span>
            <span>Active: <strong style={{ color: activePlayer?.color ?? '#e2e8f0' }}>{activePlayer?.name ?? '?'}</strong></span>
            <span>Priority: <strong style={{ color: priorityPlayer?.color ?? '#60a5fa' }}>{localHasPriority ? 'You' : priorityPlayer?.name ?? '?'}</strong></span>
            {game.stack.length > 0 && <span style={{ color: '#60a5fa' }}>Stack: {game.stack.length}</span>}
            {pendingTriggers > 0 && <span style={{ color: '#fcd34d' }}>Triggers: {pendingTriggers}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
