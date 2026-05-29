// ─── useCombatFlow ────────────────────────────────────────────────────────────
// Hook that drives the chained-combat UI.
//
// When parseCommand() + resolveIntent() produce a MULTI_ATTACK or MULTI_BLOCK
// intent, call openCombat() — the hook handles everything from there:
//   • Opens CombatPanel with the resolved attackers
//   • Pre-populates any assignments from inline command annotations
//   • Calls enterCombat() on the store to lock in combat phase
//
// Single-attack commands (ATTACK) are forwarded directly to declareAttack()
// without opening the panel.
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import type { ResolvedIntent } from '../engine/nlpParser';

export interface CombatFlowState {
  /** Whether the CombatPanel overlay is open */
  panelOpen: boolean;
  /** Attacker instance IDs to render in the panel */
  attackerIds: string[];
  /** Pre-assigned targets: instanceId → playerId (from inline command annotations) */
  preAssignments: Record<string, string>;
}

export function useCombatFlow() {
  const store = useGameStore();
  const { game } = store;

  const [state, setState] = useState<CombatFlowState>({
    panelOpen: false,
    attackerIds: [],
    preAssignments: {},
  });

  /**
   * Handle a resolved NLP intent that involves attacking.
   * For MULTI_ATTACK: opens the CombatPanel overlay.
   * For ATTACK (single): fires declareAttack directly.
   * For MULTI_BLOCK: fires declareBlock for each blocker directly.
   */
  const handleCombatIntent = useCallback((intent: ResolvedIntent) => {
    if (intent.intent === 'MULTI_ATTACK') {
      const attackerIds = intent.resolvedInstanceIds ?? [];
      if (attackerIds.length === 0) return;

      // Translate per-instance attackAssignments (instanceId → playerIndex) to
      // instanceId → playerId for the panel
      const preAssignments: Record<string, string> = {};
      if (intent.attackAssignments) {
        for (const [instanceId, playerIdx] of Object.entries(intent.attackAssignments)) {
          const player = game.players[playerIdx - 1];
          if (player) preAssignments[instanceId] = player.id;
        }
      }

      // If a global target was specified (no per-card overrides), broadcast it
      if (intent.targetPlayerId && Object.keys(preAssignments).length === 0) {
        for (const id of attackerIds) {
          preAssignments[id] = intent.targetPlayerId;
        }
      }

      // Enter combat phase in the store
      store.enterCombat();

      setState({
        panelOpen: true,
        attackerIds,
        preAssignments,
      });
      return;
    }

    if (intent.intent === 'ATTACK' && intent.resolvedInstanceId) {
      // Single attacker — skip panel, fire directly
      const targetPlayer = intent.targetPlayerId ?? game.players.find(
        p => p.id !== game.activePlayerId
      )?.id;
      if (!targetPlayer) return;
      if (!game.combat.active) store.enterCombat();
      store.declareAttack(intent.resolvedInstanceId, targetPlayer);
      return;
    }

    if (intent.intent === 'MULTI_BLOCK' && intent.resolvedInstanceIds) {
      // Multi-blocker — fire each blocker immediately
      const attackerInstanceId = intent.resolvedInstanceId;
      if (!attackerInstanceId) return;
      for (const blockerId of intent.resolvedInstanceIds) {
        store.declareBlock(blockerId, attackerInstanceId);
      }
      return;
    }

    if (intent.intent === 'BLOCK' && intent.resolvedInstanceId && intent.candidates?.[0]) {
      store.declareBlock(intent.resolvedInstanceId, intent.candidates[0]);
    }
  }, [game, store]);

  const closeCombat = useCallback(() => {
    setState({ panelOpen: false, attackerIds: [], preAssignments: {} });
  }, []);

  return {
    combatFlow: state,
    handleCombatIntent,
    closeCombat,
  };
}
