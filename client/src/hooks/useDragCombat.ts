// ─── useDragCombat ────────────────────────────────────────────────────────────
// Manages drag-and-drop combat declaration state globally.
//
// ATTACK: drag YOUR creature → drop on an OPPONENT's player zone
//   → calls store.enterCombat() if not active, then store.declareAttack()
//   → if attacker has Myriad, fires custom event for CombatPanel instead
//
// BLOCK: drag YOUR creature → drop on an opponent's ATTACKING card
//   → calls store.declareBlock(blockerInstanceId, attackerInstanceId)
//   → only valid when game.combat.active === true and you are NOT the attacker
//
// Legality notes (enforced at drag-over, not at drop, to give visual feedback):
//   - Defender keyword: cannot attack
//   - Summoning sickness: cannot attack unless has Haste
//   - Tapped: cannot attack or block
//   - Vigilance: CAN attack (handled in gameEngine — doesn't tap)
//   - Protection: blocker must share no quality that attacker is protected from
//   - Menace: attacker must be blocked by 2+ creatures (advisory only — assistant flags)
//   - Reach: can block flying creatures
//   - Flying: can only be blocked by flying/reach (checked at drop)
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef } from 'react';
import { useGameStore } from '../store/gameStore';
import type { CardState } from '../types/game';

export type DragMode = 'attack' | 'block' | null;

export interface DragState {
  instanceId: string;
  mode: DragMode;
  /** Whether dragged creature has Myriad keyword */
  hasMyriad: boolean;
}

export interface DropTarget {
  type: 'player' | 'attacker';
  id: string;
  valid: boolean;
}

// ── Keyword helpers ────────────────────────────────────────────────────────────

function hasKeyword(card: CardState, kw: string): boolean {
  const lw = kw.toLowerCase();
  return (
    card.definition.keywords.some(k => k.toLowerCase() === lw) ||
    card.definition.oracleText.toLowerCase().includes(lw)
  );
}

function cardHasMyriad(card: CardState): boolean {
  return hasKeyword(card, 'myriad');
}

/**
 * Quick check: can this creature attack?
 * Returns false if tapped, summoning sick without haste, or has Defender.
 * Does NOT check combat legality vs specific targets (that's the engine's job).
 */
function canAttack(card: CardState): boolean {
  if (!card.definition.cardTypes.includes('Creature')) return false;
  if (card.tapped) return false;
  if (card.summoningSick && !hasKeyword(card, 'haste')) return false;
  if (hasKeyword(card, 'defender')) return false;
  return true;
}

/**
 * Quick check: can this creature block?
 * Returns false if tapped or not a creature.
 */
function canBlock(card: CardState): boolean {
  if (!card.definition.cardTypes.includes('Creature')) return false;
  if (card.tapped) return false;
  if (hasKeyword(card, "can't block")) return false;
  return true;
}

/**
 * Check if a blocker is legal for a given attacker.
 * Covers: flying/reach, protection (color/type), shadow, horsemanship.
 * Returns { legal, reason } — reason is shown as a tooltip/log warning.
 */
function blockerLegal(blocker: CardState, attacker: CardState): { legal: boolean; reason?: string } {
  const aOracle = attacker.definition.oracleText.toLowerCase();
  const bOracle = blocker.definition.oracleText.toLowerCase();

  // Flying: can only be blocked by flying or reach (CR 702.9b)
  const attackerFlies = hasKeyword(attacker, 'flying');
  const blockerFlies  = hasKeyword(blocker, 'flying');
  const blockerReach  = hasKeyword(blocker, 'reach');
  if (attackerFlies && !blockerFlies && !blockerReach) {
    return { legal: false, reason: `${blocker.definition.name} can't block flying creatures without flying or reach` };
  }

  // Shadow: can only block/be blocked by shadow (CR 702.27)
  const attackerShadow = hasKeyword(attacker, 'shadow');
  const blockerShadow  = hasKeyword(blocker, 'shadow');
  if (attackerShadow && !blockerShadow) {
    return { legal: false, reason: `${blocker.definition.name} doesn't have shadow and can't block ${attacker.definition.name}` };
  }
  if (!attackerShadow && blockerShadow) {
    return { legal: false, reason: `${blocker.definition.name} has shadow and can't block non-shadow creatures` };
  }

  // Protection (simplified color check) — CR 702.16
  // "Protection from [quality]" means: can't be blocked by [quality], can't be damaged by [quality], etc.
  // Colors in card data use single-letter codes (W/U/B/R/G); oracle text uses full names.
  const COLOR_NAME_TO_CODE: Record<string, string> = {
    white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g',
  };
  const protMatch = aOracle.match(/protection from ([\w\s,]+?)(?:\.|,|\band\b|$)/g);
  if (protMatch) {
    const bColors = blocker.definition.colors.map(c => c.toLowerCase());
    const bTypes  = blocker.definition.subtypes?.map(t => t.toLowerCase()) ?? [];
    for (const pm of protMatch) {
      const quality = pm.replace('protection from ', '').replace(/[.,]+$/, '').trim();
      if (quality === 'everything') {
        return { legal: false, reason: `${attacker.definition.name} has protection from everything` };
      }
      // Normalize quality: if it's a color name, map to single-letter code
      const qualityCode = COLOR_NAME_TO_CODE[quality] ?? quality;
      if (bColors.includes(qualityCode) || bColors.includes(quality) || bTypes.includes(quality)) {
        return { legal: false, reason: `${attacker.definition.name} has protection from ${quality}` };
      }
    }
  }

  // Intimidate: can only be blocked by artifact creatures or creatures that share a color (CR 702.13)
  if (hasKeyword(attacker, 'intimidate')) {
    const aColors  = attacker.definition.colors.map(c => c.toLowerCase());
    const bColors  = blocker.definition.colors.map(c => c.toLowerCase());
    const bIsArt   = blocker.definition.cardTypes.includes('Artifact');
    const sharedColor = aColors.some(c => bColors.includes(c));
    if (!bIsArt && !sharedColor) {
      return { legal: false, reason: `${blocker.definition.name} can't block due to Intimidate (no shared color, not artifact)` };
    }
  }

  return { legal: true };
}

export function useDragCombat() {
  const store = useGameStore();

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Ref so event handlers always see latest drag state without stale closure
  const dragRef = useRef<DragState | null>(null);

  // ── Drag source handlers ────────────────────────────────────────────────────

  const cardDragHandlers = useCallback((instanceId: string) => {
    return {
      draggable: true as const,

      onDragStart: (e: React.DragEvent) => {
        const { game, localPlayerId } = store;
        const card = game.cards[instanceId];
        if (!card) return;

        const isOwn = card.controllerId === localPlayerId;
        if (!isOwn || card.zone !== 'battlefield') {
          e.preventDefault();
          return;
        }

        const combatActive       = game.combat.active;
        const localIsAttacker    = game.combat.attackingPlayerId === localPlayerId;
        const thereAreAttackers  = game.combat.attackers.length > 0;

        // Determine mode:
        //   - attack: not in combat yet, OR we ARE the active attacker adding more
        //   - block:  combat active AND we are NOT the attacker AND there ARE attackers
        let mode: DragMode = null;

        if (!combatActive || localIsAttacker) {
          // Either no combat yet or we're the attacker declaring more
          if (canAttack(card)) mode = 'attack';
        } else if (combatActive && !localIsAttacker && thereAreAttackers) {
          // Opponent is attacking — we can block
          if (canBlock(card)) mode = 'block';
        }

        if (!mode) {
          e.preventDefault();
          return;
        }

        const state: DragState = {
          instanceId,
          mode,
          hasMyriad: cardHasMyriad(card),
        };
        dragRef.current = state;
        setDragState(state);

        // Encode instance ID in dataTransfer for cross-component drops
        e.dataTransfer.setData('text/plain', instanceId);
        e.dataTransfer.effectAllowed = 'move';

        // Custom ghost: card name badge
        const ghost = document.createElement('div');
        ghost.textContent = card.definition.name;
        ghost.style.cssText = `
          position:fixed; top:-100px; left:-100px;
          background:#1e293b; color:#e2e8f0; padding:6px 10px;
          border-radius:8px; border:1px solid #ef4444; font-size:12px;
          font-weight:600; white-space:nowrap; pointer-events:none;
          box-shadow:0 4px 12px rgba(0,0,0,0.5);
        `;
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
        requestAnimationFrame(() => document.body.removeChild(ghost));
      },

      onDragEnd: () => {
        dragRef.current = null;
        setDragState(null);
        setDropTarget(null);
      },
    };
  }, [store]);

  // ── Player zone drop handlers (attack targets) ──────────────────────────────

  const playerDropHandlers = useCallback((targetPlayerId: string) => {
    return {
      onDragOver: (e: React.DragEvent) => {
        const ds = dragRef.current;
        if (!ds || ds.mode !== 'attack') return;
        const { game, localPlayerId } = store;
        if (targetPlayerId === localPlayerId) return; // Can't attack yourself

        const card = game.cards[ds.instanceId];
        if (!card || !canAttack(card)) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget({ type: 'player', id: targetPlayerId, valid: true });
      },

      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDropTarget(prev => (prev?.id === targetPlayerId ? null : prev));
        }
      },

      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const ds = dragRef.current;
        if (!ds || ds.mode !== 'attack') return;
        const { game, localPlayerId } = store;
        if (targetPlayerId === localPlayerId) return;

        const card = game.cards[ds.instanceId];
        if (!card || !canAttack(card)) return;

        // ── CRITICAL: enterCombat BEFORE declareAttack ──────────────────────
        // enterCombat() resets attackers:[] — it must fire first so the
        // subsequent declareAttack() can add to the fresh list.
        if (!game.combat.active) {
          store.enterCombat();
        }

        if (ds.hasMyriad) {
          // Trigger Myriad setup via custom event — CombatPanel listens
          window.dispatchEvent(new CustomEvent('mtg:drag-myriad-attack', {
            detail: { instanceId: ds.instanceId, targetPlayerId },
          }));
        } else {
          store.declareAttack(ds.instanceId, targetPlayerId);
        }

        dragRef.current = null;
        setDragState(null);
        setDropTarget(null);
      },
    };
  }, [store]);

  // ── Attacker card drop handlers (block targets) ──────────────────────────

  const attackerDropHandlers = useCallback((attackerInstanceId: string) => {
    return {
      onDragOver: (e: React.DragEvent) => {
        const ds = dragRef.current;
        if (!ds || ds.mode !== 'block') return;
        const { game } = store;

        const blocker  = game.cards[ds.instanceId];
        const attacker = game.cards[attackerInstanceId];
        if (!blocker || !attacker) return;
        if (!canBlock(blocker)) return;
        if (blocker.instanceId === attackerInstanceId) return;
        // Can't block your own side's attacker
        if (attacker.controllerId === blocker.controllerId) return;
        // Must actually be an attacker
        if (!game.combat.attackers.some(a => a.instanceId === attackerInstanceId)) return;

        // Check evasion legality
        const { legal } = blockerLegal(blocker, attacker);
        if (!legal) return; // Still allow the drag-over silently — engine will log

        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget({ type: 'attacker', id: attackerInstanceId, valid: true });
      },

      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setDropTarget(prev => (prev?.id === attackerInstanceId ? null : prev));
        }
      },

      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const ds = dragRef.current;
        if (!ds || ds.mode !== 'block') return;

        const { game } = store;
        const blocker  = game.cards[ds.instanceId];
        const attacker = game.cards[attackerInstanceId];

        if (!blocker || !attacker) return;
        if (!canBlock(blocker)) return;
        if (!game.combat.attackers.some(a => a.instanceId === attackerInstanceId)) return;

        // Log legality warning if illegal block attempted (assistant never blocks action)
        const { legal, reason } = blockerLegal(blocker, attacker);
        if (!legal && reason) {
          // The engine still allows it (judge mode) but fires an assistant flag
          console.warn('[DragCombat] Illegal block:', reason);
        }

        store.declareBlock(ds.instanceId, attackerInstanceId);

        dragRef.current = null;
        setDragState(null);
        setDropTarget(null);
      },
    };
  }, [store]);

  return {
    dragState,
    dropTarget,
    cardDragHandlers,
    playerDropHandlers,
    attackerDropHandlers,
  };
}
