// ─── Assistant / Judge Engine ─────────────────────────────────────────────────
import { v4 as uuid } from 'uuid';
import type { CustomTrigger, GameState, CardState, AssistantFlag, FlagSeverity, Phase, KnownTriggerEffect } from '../types/game';
import { getTier3Patterns } from './mechanicResolver';
import { getEffectiveCardDefinition, getEffectiveCardName, getEffectiveOracleText } from './cardFaces';

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

  const def = getEffectiveCardDefinition(card);
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

  const def = getEffectiveCardDefinition(card);
  if (card.tapped) {
    flags.push(makeFlag('flagged', 'Flagged', `${def.name} is already tapped.`, 'CR 305.5'));
    return { legal: false, flags, summary: flags[0].text };
  }

  if (card.summoningSick && def.cardTypes.includes('Creature')) {
    const hasHaste = def.keywords.includes('Haste');
    if (!hasHaste) {
      flags.push(makeFlag('flagged', 'Flagged', `${def.name} has summoning sickness — tap abilities requiring the creature to be untapped cannot be used.`, 'CR 302.6'));
      return { legal: false, flags, summary: flags[0].text };
    }
  }

  flags.push(makeFlag('legal', 'Legal', `${def.name} can be tapped.`));
  return { legal: true, flags, summary: flags[0].text };
}

export function checkAttackLegality(state: GameState, attackerInstanceId: string): LegalityResult {
  const card = state.cards[attackerInstanceId];
  if (!card) return { legal: false, flags: [], summary: 'Card not found.' };

  const flags: AssistantFlag[] = [];
  const def = getEffectiveCardDefinition(card);

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

  const attackRestriction = Object.values(state.cards).find(permanent =>
    permanent.zone === 'battlefield' &&
    permanent.controllerId === card.controllerId &&
    normalizeRulesText(getEffectiveOracleText(permanent)).includes("creatures you control can't attack")
  );
  if (attackRestriction) {
    flags.push(makeFlag('flagged', 'Flagged',
      `${getEffectiveCardName(attackRestriction)} says creatures you control can't attack. The simulator will allow the action for practice, but this should be corrected.`,
      undefined,
      attackRestriction.instanceId
    ));
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

  const blockerDef = getEffectiveCardDefinition(blocker);
  const attackerDef = getEffectiveCardDefinition(attacker);

  if (!blockerDef.cardTypes.includes('Creature')) {
    flags.push(makeFlag('flagged', 'Flagged', `${blockerDef.name} is not a creature and cannot block.`));
    return { legal: false, flags, summary: flags[0].text };
  }

  if (blocker.tapped) {
    flags.push(makeFlag('flagged', 'Flagged', `${blockerDef.name} is tapped and cannot block.`, 'CR 509.1'));
    return { legal: false, flags, summary: flags[0].text };
  }

  // Flying check
  const attackerHasFlying = attackerDef.keywords.includes('Flying') ||
    attackerDef.oracleText.toLowerCase().includes('flying');
  const attackerHasReach = attackerDef.keywords.includes('Reach') ||
    attackerDef.oracleText.toLowerCase().includes('reach');
  const blockerHasFlying = blockerDef.keywords.includes('Flying') ||
    blockerDef.oracleText.toLowerCase().includes('flying');
  const blockerHasReach = blockerDef.keywords.includes('Reach') ||
    blockerDef.oracleText.toLowerCase().includes('reach');

  if (attackerHasFlying && !blockerHasFlying && !blockerHasReach) {
    flags.push(makeFlag('flagged', 'Flagged', `${blockerDef.name} cannot block ${attackerDef.name} — attacker has Flying and blocker has neither Flying nor Reach.`, 'CR 702.9'));
    return { legal: false, flags, summary: flags[0].text };
  }

  // Intimidate/Menace checks
  if (attackerDef.keywords.includes('Menace')) {
    const existingBlockers = state.combat.blockers.filter(b => b.blockedAttacker === attackerInstanceId);
    if (existingBlockers.length === 0) {
      flags.push(makeFlag('needsReview', 'Needs Review', `${attackerDef.name} has Menace — it must be blocked by 2 or more creatures to be blocked legally.`, 'CR 702.110'));
    }
  }

  flags.push(makeFlag('legal', 'Legal', `${blockerDef.name} can block ${attackerDef.name}.`));
  return { legal: true, flags, summary: flags[0].text };
}

// ─── Trigger Detection ────────────────────────────────────────────────────────

export interface DetectedTrigger {
  sourceCard: CardState;
  triggerText: string;
  triggerType: 'ETB' | 'attack' | 'cast' | 'upkeep' | 'graveyard' | 'exile' | 'damage' | 'other';
  effect?: KnownTriggerEffect;
  data?: Record<string, unknown>;
}

export function detectETBTriggers(state: GameState, newCard: CardState): DetectedTrigger[] {
  const triggers: DetectedTrigger[] = [];
  const newDef = getEffectiveCardDefinition(newCard);
  const text = newDef.oracleText.toLowerCase();

  if (isLandfallTriggerText(text)) {
    const ownLandfall = makeLandfallTrigger(state, newCard, newCard, newDef.oracleText);
    if (ownLandfall) triggers.push(ownLandfall);
  } else if ((text.includes('when') || text.includes('whenever')) && (text.includes('enters') || text.includes('enters the battlefield'))) {
    triggers.push({
      sourceCard: newCard,
      triggerText: extractTriggerText(newDef.oracleText, 'enters'),
      triggerType: 'ETB',
    });
  }

  for (const custom of getMatchingCustomTriggers(newCard, 'ETB')) {
    triggers.push(customToDetectedTrigger(newCard, custom, 'ETB'));
  }

  // Check other cards that trigger on this card entering
  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield' || card.instanceId === newCard.instanceId) continue;
    const cardText = getEffectiveOracleText(card);
    const t = cardText.toLowerCase();
    const landfallTrigger = makeLandfallTrigger(state, card, newCard, cardText);
    if (landfallTrigger) {
      triggers.push(landfallTrigger);
    } else if (t.includes('whenever a creature enters') || t.includes('whenever another') ) {
      triggers.push({
        sourceCard: card,
        triggerText: extractTriggerText(cardText, 'whenever'),
        triggerType: 'ETB',
      });
    }
    for (const custom of getMatchingCustomTriggers(card, 'ETB').filter(customEtbCanObserveOtherCard)) {
      triggers.push(customToDetectedTrigger(card, custom, 'ETB'));
    }
  }

  return triggers;
}

export function detectUpkeepTriggers(state: GameState, activePlayerId: string): DetectedTrigger[] {
  const triggers: DetectedTrigger[] = [];

  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield' || card.controllerId !== activePlayerId) continue;
    const oracleText = getEffectiveOracleText(card);
    const text = normalizeRulesText(oracleText);
    if (!text.includes('upkeep') && !text.includes('cumulative upkeep')) continue;
    const isOwnUpkeep = text.includes('at the beginning of your upkeep') || text.includes('cumulative upkeep');
    if (!isOwnUpkeep) continue;
    triggers.push({
      sourceCard: card,
      triggerText: text.includes('cumulative upkeep')
        ? `${getEffectiveCardName(card)} cumulative upkeep reminder: add an age counter, then pay the upkeep cost for each age counter or sacrifice it.`
        : extractTriggerText(oracleText, 'upkeep'),
      triggerType: 'upkeep',
    });
  }

  return triggers;
}

export function detectAttackTriggers(state: GameState, attackerCard: CardState): DetectedTrigger[] {
  const triggers: DetectedTrigger[] = [];
  const oracleText = getEffectiveOracleText(attackerCard);
  const text = oracleText.toLowerCase();

  if (text.includes('whenever this creature attacks') ||
    text.includes('whenever') && text.includes('attacks') ||
    text.includes('when ~ attacks')) {
    triggers.push({
      sourceCard: attackerCard,
      triggerText: extractTriggerText(oracleText, 'whenever'),
      triggerType: 'attack',
    });
  }

  for (const custom of getMatchingCustomTriggers(attackerCard, 'attack')) {
    triggers.push(customToDetectedTrigger(attackerCard, custom, 'attack'));
  }

  return triggers;
}

export function detectCastTriggers(
  state: GameState,
  castingPlayerId: string,
  spellCard: CardState,
  spellNumberThisTurn: number
): DetectedTrigger[] {
  const triggers: DetectedTrigger[] = [];

  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield') continue;
    const controlsCastingPlayer = card.controllerId === castingPlayerId;
    const cardDef = getEffectiveCardDefinition(card);
    const spellDef = getEffectiveCardDefinition(spellCard);
    const text = normalizeRulesText(cardDef.oracleText);

    const customCastTriggers = getMatchingCustomTriggers(card, 'cast')
      .filter(custom => customCastTriggerCanObserve(custom, controlsCastingPlayer));
    for (const custom of customCastTriggers) {
      triggers.push(customToDetectedTrigger(card, custom, 'cast'));
    }

    const isFirstSpellTrigger = text.includes('whenever you cast your first spell each turn');
    if (isFirstSpellTrigger && (!controlsCastingPlayer || spellNumberThisTurn !== 1)) continue;

    const isVialStyleDamage = text.includes('opponent at random') &&
      text.includes('deals damage equal to that spell') &&
      text.includes('mana value');
    if (isFirstSpellTrigger && !isVialStyleDamage) {
      triggers.push({
        sourceCard: card,
        triggerText: extractTriggerText(cardDef.oracleText, 'whenever'),
        triggerType: 'cast',
        data: {
          spellInstanceId: spellCard.instanceId,
          spellName: spellDef.name,
          manaValue: spellDef.cmc ?? spellDef.manaCost?.cmc ?? 0,
          spellNumberThisTurn,
        },
      });
      continue;
    }

    if (isFirstSpellTrigger && isVialStyleDamage) {
      const manaValue = spellDef.cmc ?? spellDef.manaCost?.cmc ?? 0;
      const eligibleOpponentIds = state.players
        .filter(player => player.id !== castingPlayerId && !player.isSpectator)
        .map(player => player.id);
      triggers.push({
        sourceCard: card,
        triggerText: `${cardDef.name} triggered: choose an opponent at random. It deals ${manaValue} damage to that player or a planeswalker they control.`,
        triggerType: 'cast',
        effect: {
          kind: 'vialSmasherDamage',
          spellInstanceId: spellCard.instanceId,
          spellName: spellDef.name,
          manaValue,
          eligibleOpponentIds,
        },
        data: {
          spellInstanceId: spellCard.instanceId,
          spellName: spellDef.name,
          manaValue,
          spellNumberThisTurn,
        },
      });
      continue;
    }

    if (genericCastTriggerMatches(text, controlsCastingPlayer, spellCard, spellNumberThisTurn)) {
      triggers.push({
        sourceCard: card,
        triggerText: extractTriggerText(cardDef.oracleText, 'whenever'),
        triggerType: 'cast',
        data: {
          spellInstanceId: spellCard.instanceId,
          spellName: spellDef.name,
          manaValue: spellDef.cmc ?? spellDef.manaCost?.cmc ?? 0,
          spellNumberThisTurn,
        },
      });
    }
  }

  return triggers;
}

export function detectCombatDamageTriggers(
  _state: GameState,
  attackerCard: CardState,
  damagedPlayerId: string,
  damage: number
): DetectedTrigger[] {
  const oracleText = getEffectiveOracleText(attackerCard);
  const text = normalizeRulesText(oracleText);
  if (!text.includes('whenever') || !text.includes('deals combat damage to a player')) return [];

  const trigger: DetectedTrigger = {
    sourceCard: attackerCard,
    triggerText: extractTriggerText(oracleText, 'whenever'),
    triggerType: 'damage',
    data: { damagedPlayerId, damage },
  };

  if (text.includes('get that many poison counters')) {
    trigger.triggerText = `${getEffectiveCardName(attackerCard)} triggered: ${damage} poison counter${damage === 1 ? '' : 's'} for the damaged player.`;
    trigger.effect = {
      kind: 'poisonFromCombatDamage',
      damagedPlayerId,
      amount: damage,
    };
  }

  return [trigger];
}

function makeLandfallTrigger(
  state: GameState,
  sourceCard: CardState,
  enteringCard: CardState,
  oracleText: string
): DetectedTrigger | null {
  const text = normalizeRulesText(oracleText);
  if (!isLandfallTriggerText(text)) return null;
  if (!getEffectiveCardDefinition(enteringCard).cardTypes.includes('Land')) return null;
  if (text.includes('under your control') && enteringCard.controllerId !== sourceCard.controllerId) return null;
  if (text.includes('seven or more lands with different names') &&
    countDistinctControlledLandNames(state, sourceCard.controllerId) < 7) {
    return null;
  }

  const trigger: DetectedTrigger = {
    sourceCard,
    triggerText: extractTriggerText(oracleText, 'whenever'),
    triggerType: 'ETB',
    data: {
      enteringLandId: enteringCard.instanceId,
      enteringLandName: getEffectiveCardName(enteringCard),
      distinctLandNames: countDistinctControlledLandNames(state, sourceCard.controllerId),
    },
  };

  if (text.includes('create a 2/2 black zombie creature token')) {
    trigger.effect = {
      kind: 'createToken',
      controllerId: sourceCard.controllerId,
      count: 1,
      token: {
        name: 'Zombie',
        power: '2',
        toughness: '2',
        colors: ['B'],
        cardTypes: ['Creature'],
        subTypes: ['Zombie'],
        keywords: [],
        oracleText: '',
        typeLine: 'Token Creature - Zombie',
      },
    };
  }

  return trigger;
}

function isLandfallTriggerText(text: string): boolean {
  return text.includes('whenever') &&
    text.includes('land enters') &&
    (text.includes('under your control') || text.includes('field of the dead or another land enters'));
}

function countDistinctControlledLandNames(state: GameState, controllerId: string): number {
  const names = new Set<string>();
  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield' || card.controllerId !== controllerId) continue;
    const def = getEffectiveCardDefinition(card);
    if (!def.cardTypes.includes('Land')) continue;
    names.add(def.name.toLowerCase());
  }
  return names.size;
}

function customCastTriggerCanObserve(trigger: CustomTrigger, controlsCastingPlayer: boolean): boolean {
  const event = trigger.event.toLowerCase();
  if (controlsCastingPlayer) return !event.includes('opponent casts');
  return event.includes('opponent') || event.includes('player casts');
}

function genericCastTriggerMatches(
  text: string,
  controlsCastingPlayer: boolean,
  spellCard: CardState,
  spellNumberThisTurn: number
): boolean {
  if (!text.includes('whenever')) return false;
  const watchesYou = controlsCastingPlayer &&
    (text.includes('whenever you cast') || text.includes('whenever you cast or copy'));
  const watchesOpponent = !controlsCastingPlayer && text.includes('whenever an opponent casts');
  const watchesAnyPlayer = text.includes('whenever a player casts');
  if (!watchesYou && !watchesOpponent && !watchesAnyPlayer) return false;

  if (mentionsNthSpellTrigger(text, 'second') && spellNumberThisTurn !== 2) return false;
  if (mentionsNthSpellTrigger(text, 'first') && spellNumberThisTurn !== 1) return false;
  return spellMatchesCastCondition(text, spellCard);
}

function mentionsNthSpellTrigger(text: string, ordinal: 'first' | 'second'): boolean {
  return text.includes(`your ${ordinal} spell each turn`) ||
    text.includes(`their ${ordinal} spell each turn`) ||
    text.includes(`that player's ${ordinal} spell each turn`) ||
    text.includes(`that player’s ${ordinal} spell each turn`);
}

function spellMatchesCastCondition(text: string, spellCard: CardState): boolean {
  const types = getEffectiveCardDefinition(spellCard).cardTypes;
  const has = (type: string) => types.some(cardType => cardType.toLowerCase() === type);
  const mentionsInstantOrSorcery = text.includes('instant or sorcery');
  if (text.includes('noncreature spell') && has('creature')) return false;
  if (text.includes('creature spell') && !text.includes('noncreature spell') && !has('creature')) return false;
  if (mentionsInstantOrSorcery && !has('instant') && !has('sorcery')) return false;
  if (!mentionsInstantOrSorcery && text.includes('instant spell') && !has('instant')) return false;
  if (!mentionsInstantOrSorcery && text.includes('sorcery spell') && !has('sorcery')) return false;
  if (text.includes('artifact spell') && !has('artifact')) return false;
  if (text.includes('enchantment spell') && !has('enchantment')) return false;
  if (text.includes('planeswalker spell') && !has('planeswalker')) return false;
  return true;
}

function getMatchingCustomTriggers(card: CardState, eventType: DetectedTrigger['triggerType']): CustomTrigger[] {
  return (card.definition.customTriggers ?? []).filter(trigger => customTriggerMatchesEvent(trigger, eventType));
}

function customTriggerMatchesEvent(trigger: CustomTrigger, eventType: DetectedTrigger['triggerType']): boolean {
  const event = trigger.event.toLowerCase();
  if (eventType === 'ETB') return /\b(etb|enter|enters|battlefield)\b/.test(event);
  if (eventType === 'attack') return /\b(attack|attacks|attacking)\b/.test(event);
  if (eventType === 'cast') return /\b(cast|casts|spell)\b/.test(event);
  if (eventType === 'upkeep') return event.includes('upkeep');
  if (eventType === 'graveyard') return event.includes('graveyard') || event.includes('dies');
  if (eventType === 'exile') return event.includes('exile');
  if (eventType === 'damage') return event.includes('damage');
  return true;
}

function normalizeRulesText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function customEtbCanObserveOtherCard(trigger: CustomTrigger): boolean {
  const event = trigger.event.toLowerCase();
  return event.includes('another') ||
    event.includes('a creature') ||
    event.includes('a permanent') ||
    event.includes('a card') ||
    event.includes('whenever');
}

function customToDetectedTrigger(
  sourceCard: CardState,
  trigger: CustomTrigger,
  triggerType: DetectedTrigger['triggerType']
): DetectedTrigger {
  return {
    sourceCard,
    triggerText: trigger.reminderText || `${trigger.event}: ${trigger.effect}`,
    triggerType,
  };
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
    const def = getEffectiveCardDefinition(card);
    const text = def.oracleText.toLowerCase();

    // Tax effects
    if (text.includes('spells cost') && text.includes('more')) {
      flags.push(makeFlag('info', 'Info',
        `${def.name} is increasing spell costs. Check the effect.`
      ));
    }

    // Draw restrictions
    if (text.includes("can't draw more than") || text.includes('players can\'t draw')) {
      flags.push(makeFlag('info', 'Info',
        `${def.name} may be restricting card draw.`
      ));
    }

    // "Opponents can't" effects
    if (text.includes("opponents can't")) {
      flags.push(makeFlag('info', 'Info',
        `${def.name} is restricting what opponents can do. Check the restriction.`
      ));
    }

    if (text.includes("creatures you control can't attack")) {
      flags.push(makeFlag('needsReview', 'Needs Review',
        `${def.name}: creatures controlled by ${state.players.find(player => player.id === card.controllerId)?.name ?? card.controllerId} can't attack.`,
        undefined,
        card.instanceId
      ));
    }

    if (text.includes('prevent all damage that would be dealt to you')) {
      flags.push(makeFlag('needsReview', 'Needs Review',
        `${def.name}: prevent all damage that would be dealt to its controller.`,
        undefined,
        card.instanceId
      ));
    }

    for (const effect of card.definition.replacementEffects ?? []) {
      flags.push(makeFlag('needsReview', 'Needs Review',
        `${def.name} has a custom replacement effect: ${effect.replaces} -> ${effect.replacement}.`,
        undefined,
        card.instanceId
      ));
    }

    for (const rule of card.definition.customRules ?? []) {
      flags.push(makeFlag('info', 'Info',
        `${def.name} is covered by custom rule "${rule.name}": ${rule.effect}.`,
        undefined,
        card.instanceId
      ));
    }

    for (const pattern of getTier3Patterns(def)) {
      if (!['replacement', 'copy', 'cast-from-zone', 'zone-change'].includes(pattern.category)) continue;
      flags.push(makeFlag('needsReview', 'Needs Review',
        `${def.name}: ${pattern.description}`,
        undefined,
        card.instanceId
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
