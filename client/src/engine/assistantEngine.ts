// ─── Assistant / Judge Engine ─────────────────────────────────────────────────
import { v4 as uuid } from 'uuid';
import type { GameState, CardState, AssistantFlag, FlagSeverity, Phase } from '../types/game';

// ─── Timing Windows ───────────────────────────────────────────────────────────

const SORCERY_SPEED_PHASES: Phase[] = ['main1', 'main2'];

export function canCastAtSorcerySpeed(state: GameState, playerId: string): boolean {
  return (
    state.activePlayerId === playerId &&
    SORCERY_SPEED_PHASES.includes(state.phase) &&
    state.stack.length === 0
  );
}

export function canCastAtInstantSpeed(_state: GameState, _playerId: string): boolean {
  // Simplified — any player with priority
  return true;
}

// ─── Action Legality ──────────────────────────────────────────────────────────

export interface LegalityResult {
  legal: boolean;
  flags: AssistantFlag[];
  summary: string;
}

export function checkCastLegality(
  state: GameState,
  castingPlayerId: string,
  cardInstanceId: string
): LegalityResult {
  const flags: AssistantFlag[] = [];
  const card = state.cards[cardInstanceId];

  if (!card) {
    return { legal: false, flags: [], summary: 'Card not found.' };
  }

  const def = card.definition;
  const isInstant = def.cardTypes.includes('Instant') || def.keywords.includes('Flash');
  const isSorcery = !isInstant;

  let legal = true;

  // Timing check
  if (isSorcery && !canCastAtSorcerySpeed(state, castingPlayerId)) {
    flags.push(makeFlag('flagged', 'Flagged', `${def.name} can only be cast at sorcery speed. It's not your main phase or there are spells on the stack.`, 'CR 307.1'));
    legal = false;
  }

  // Zone check
  if (card.zone !== 'hand' && card.zone !== 'command') {
    const playFromGrave = def.oracleText.toLowerCase().includes('cast this card from your graveyard') ||
      def.oracleText.toLowerCase().includes('cast from your graveyard');
    const playFromExile = def.oracleText.toLowerCase().includes('cast this card from exile') ||
      def.oracleText.toLowerCase().includes('cast from exile');

    if (card.zone === 'graveyard' && !playFromGrave) {
      flags.push(makeFlag('flagged', 'Flagged', `${def.name} cannot be cast from the graveyard without a special effect.`, 'CR 601.3'));
      legal = false;
    } else if (card.zone === 'exile' && !playFromExile) {
      flags.push(makeFlag('flagged', 'Flagged', `${def.name} cannot normally be cast from exile.`, 'CR 601.3'));
      legal = false;
    }
  }

  // Summoning sickness
  if (def.cardTypes.includes('Creature') && card.zone === 'battlefield' && card.summoningSick) {
    const hasHaste = def.keywords.includes('Haste') || def.oracleText.toLowerCase().includes('haste');
    if (!hasHaste) {
      flags.push(makeFlag('info', 'Info', `${def.name} has summoning sickness — it cannot attack or use tap abilities until your next turn.`, 'CR 302.6'));
    }
  }

  // Commander tax (CR 903.8) — surface how much extra mana is owed
  if (state.config.commanderTaxEnabled && (card.zone === 'command' || card.zone === 'hand')) {
    const castingPlayer = state.players.find(p => p.id === castingPlayerId);
    const isCommanderOfPlayer = castingPlayer?.commanders.includes(cardInstanceId);
    if (isCommanderOfPlayer && castingPlayer) {
      const castCount = castingPlayer.commanderCastCount[cardInstanceId] || 0;
      if (castCount > 0) {
        const taxAmount = castCount * 2;
        flags.push(makeFlag('info', 'Tax', `${def.name} has been cast ${castCount} time${castCount !== 1 ? 's' : ''} this game — you must pay an additional {${taxAmount}} mana (commander tax).`, 'CR 903.8'));
      }
    }
  }

  if (legal && flags.length === 0) {
    flags.push(makeFlag('legal', 'Legal', `${def.name} may be cast at this time.`));
  }

  return { legal, flags, summary: flags[0]?.text || '' };
}

export function checkTapLegality(state: GameState, instanceId: string): LegalityResult {
  const card = state.cards[instanceId];
  if (!card) return { legal: false, flags: [], summary: 'Card not found.' };

  const flags: AssistantFlag[] = [];

  if (card.tapped) {
    flags.push(makeFlag('flagged', 'Flagged', `${card.definition.name} is already tapped.`, 'CR 305.5'));
    return { legal: false, flags, summary: flags[0].text };
  }

  if (card.summoningSick && card.definition.cardTypes.includes('Creature')) {
    const hasHaste = card.definition.keywords.includes('Haste');
    if (!hasHaste) {
      flags.push(makeFlag('flagged', 'Flagged', `${card.definition.name} has summoning sickness — tap abilities requiring the creature to be untapped cannot be used.`, 'CR 302.6'));
      return { legal: false, flags, summary: flags[0].text };
    }
  }

  flags.push(makeFlag('legal', 'Legal', `${card.definition.name} can be tapped.`));
  return { legal: true, flags, summary: flags[0].text };
}

export function checkAttackLegality(state: GameState, attackerInstanceId: string): LegalityResult {
  const card = state.cards[attackerInstanceId];
  if (!card) return { legal: false, flags: [], summary: 'Card not found.' };

  const flags: AssistantFlag[] = [];
  const def = card.definition;

  if (!def.cardTypes.includes('Creature')) {
    flags.push(makeFlag('flagged', 'Flagged', `${def.name} is not a creature and cannot attack.`));
    return { legal: false, flags, summary: flags[0].text };
  }

  if (card.tapped) {
    flags.push(makeFlag('flagged', 'Flagged', `${def.name} is already tapped and cannot attack.`, 'CR 508.1'));
    return { legal: false, flags, summary: flags[0].text };
  }

  if (card.summoningSick) {
    const hasHaste = def.keywords.includes('Haste') || def.oracleText.toLowerCase().includes('haste');
    if (!hasHaste) {
      flags.push(makeFlag('flagged', 'Flagged', `${def.name} has summoning sickness — it can't attack this turn.`, 'CR 302.6'));
      return { legal: false, flags, summary: flags[0].text };
    }
  }

  const hasVigilance = def.keywords.includes('Vigilance');
  if (!hasVigilance) {
    flags.push(makeFlag('info', 'Info', `${def.name} will be tapped when it attacks.`));
  }

  if (def.keywords.includes('Defender')) {
    flags.push(makeFlag('flagged', 'Flagged', `${def.name} has Defender and cannot attack.`, 'CR 702.3'));
    return { legal: false, flags, summary: flags[0].text };
  }

  flags.push(makeFlag('legal', 'Legal', `${def.name} can attack.`));
  return { legal: true, flags, summary: flags[0].text };
}

export function checkBlockLegality(
  state: GameState,
  blockerInstanceId: string,
  attackerInstanceId: string
): LegalityResult {
  const blocker = state.cards[blockerInstanceId];
  const attacker = state.cards[attackerInstanceId];
  if (!blocker || !attacker) return { legal: false, flags: [], summary: 'Card not found.' };

  const flags: AssistantFlag[] = [];

  if (!blocker.definition.cardTypes.includes('Creature')) {
    flags.push(makeFlag('flagged', 'Flagged', `${blocker.definition.name} is not a creature and cannot block.`));
    return { legal: false, flags, summary: flags[0].text };
  }

  if (blocker.tapped) {
    flags.push(makeFlag('flagged', 'Flagged', `${blocker.definition.name} is tapped and cannot block.`, 'CR 509.1'));
    return { legal: false, flags, summary: flags[0].text };
  }

  // Flying check
  const attackerHasFlying = attacker.definition.keywords.includes('Flying') ||
    attacker.definition.oracleText.toLowerCase().includes('flying');
  const attackerHasReach = attacker.definition.keywords.includes('Reach') ||
    attacker.definition.oracleText.toLowerCase().includes('reach');
  const blockerHasFlying = blocker.definition.keywords.includes('Flying') ||
    blocker.definition.oracleText.toLowerCase().includes('flying');
  const blockerHasReach = blocker.definition.keywords.includes('Reach') ||
    blocker.definition.oracleText.toLowerCase().includes('reach');

  if (attackerHasFlying && !blockerHasFlying && !blockerHasReach) {
    flags.push(makeFlag('flagged', 'Flagged', `${blocker.definition.name} cannot block ${attacker.definition.name} — attacker has Flying and blocker has neither Flying nor Reach.`, 'CR 702.9'));
    return { legal: false, flags, summary: flags[0].text };
  }

  // Intimidate/Menace checks
  if (attacker.definition.keywords.includes('Menace')) {
    const existingBlockers = state.combat.blockers.filter(b => b.blockedAttacker === attackerInstanceId);
    if (existingBlockers.length === 0) {
      flags.push(makeFlag('needsReview', 'Needs Review', `${attacker.definition.name} has Menace — it must be blocked by 2 or more creatures to be blocked legally.`, 'CR 702.110'));
    }
  }

  flags.push(makeFlag('legal', 'Legal', `${blocker.definition.name} can block ${attacker.definition.name}.`));
  return { legal: true, flags, summary: flags[0].text };
}

// ─── Trigger Detection ────────────────────────────────────────────────────────

export interface DetectedTrigger {
  sourceCard: CardState;
  triggerText: string;
  triggerType: 'ETB' | 'attack' | 'upkeep' | 'graveyard' | 'exile' | 'damage' | 'other';
}

export function detectETBTriggers(state: GameState, newCard: CardState): DetectedTrigger[] {
  const triggers: DetectedTrigger[] = [];
  const text = newCard.definition.oracleText.toLowerCase();

  if (text.includes('when') && (text.includes('enters') || text.includes('enters the battlefield'))) {
    triggers.push({
      sourceCard: newCard,
      triggerText: extractTriggerText(newCard.definition.oracleText, 'enters'),
      triggerType: 'ETB',
    });
  }

  // Check other cards that trigger on this card entering
  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield' || card.instanceId === newCard.instanceId) continue;
    const t = card.definition.oracleText.toLowerCase();
    if (t.includes('whenever a creature enters') || t.includes('whenever another') ) {
      triggers.push({
        sourceCard: card,
        triggerText: extractTriggerText(card.definition.oracleText, 'whenever'),
        triggerType: 'ETB',
      });
    }
  }

  return triggers;
}

export function detectAttackTriggers(state: GameState, attackerCard: CardState): DetectedTrigger[] {
  const triggers: DetectedTrigger[] = [];
  const text = attackerCard.definition.oracleText.toLowerCase();

  if (text.includes('whenever this creature attacks') || text.includes('when ~ attacks')) {
    triggers.push({
      sourceCard: attackerCard,
      triggerText: extractTriggerText(attackerCard.definition.oracleText, 'whenever'),
      triggerType: 'attack',
    });
  }

  return triggers;
}

function extractTriggerText(oracleText: string, keyword: string): string {
  const lower = oracleText.toLowerCase();
  const idx = lower.indexOf(keyword);
  if (idx === -1) return oracleText;
  const sentence = oracleText.slice(idx).split(/[.!]/)[0];
  return sentence.trim();
}

// ─── Interaction Analysis ─────────────────────────────────────────────────────

export function analyzeInteraction(
  state: GameState,
  cardA: string,
  cardB: string
): AssistantFlag[] {
  const a = state.cards[cardA];
  const b = state.cards[cardB];
  if (!a || !b) return [];

  const flags: AssistantFlag[] = [];
  const aText = a.definition.oracleText.toLowerCase();
  const bText = b.definition.oracleText.toLowerCase();

  // Infinite loop detection (simple heuristic)
  if (aText.includes('untap') && bText.includes('untap') &&
    aText.includes('whenever') && bText.includes('whenever')) {
    flags.push(makeFlag('needsReview', 'Needs Review',
      `${a.definition.name} and ${b.definition.name} may create an infinite loop. Verify there's a stopping condition.`,
      'CR 720'
    ));
  }

  // Protection interaction
  if (bText.includes('protection from')) {
    flags.push(makeFlag('needsReview', 'Needs Review',
      `${b.definition.name} may have protection that prevents targeting. Check the oracle text.`
    ));
  }

  return flags;
}

// ─── Rule Modifier Detection ──────────────────────────────────────────────────

export function getActiveModifiers(state: GameState): AssistantFlag[] {
  const flags: AssistantFlag[] = [];

  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield') continue;
    const text = card.definition.oracleText.toLowerCase();

    // Tax effects
    if (text.includes('spells cost') && text.includes('more')) {
      flags.push(makeFlag('info', 'Info',
        `${card.definition.name} is increasing spell costs. Check the effect.`
      ));
    }

    // Draw restrictions
    if (text.includes("can't draw more than") || text.includes('players can\'t draw')) {
      flags.push(makeFlag('info', 'Info',
        `${card.definition.name} may be restricting card draw.`
      ));
    }

    // "Opponents can't" effects
    if (text.includes("opponents can't")) {
      flags.push(makeFlag('info', 'Info',
        `${card.definition.name} is restricting what opponents can do. Check the restriction.`
      ));
    }
  }

  return flags;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFlag(
  severity: FlagSeverity,
  label: AssistantFlag['label'],
  text: string,
  ruleRef?: string,
  cardRef?: string
): AssistantFlag {
  return { id: uuid(), severity, label, text, ruleRef, cardRef };
}
