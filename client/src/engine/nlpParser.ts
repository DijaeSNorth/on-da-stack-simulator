// ─── Natural Language Command Parser ─────────────────────────────────────────
// Parses free-text player commands into structured game intents.
// Pattern-first, then fuzzy card name resolution against the active game state.
//
// Examples:
//   "cast sol ring"                   → { intent: 'CAST', cardName: 'Sol Ring' }
//   "attack player 2 with goblin guide" → { intent: 'ATTACK', card: '...', target: 'player2' }
//   "tap all lands"                   → { intent: 'TAP_ALL_LANDS' }
//   "move to combat"                  → { intent: 'GO_TO_PHASE', phase: 'beginningOfCombat' }
//   "draw 3"                          → { intent: 'DRAW', count: 3 }
//   "+1/+1 counter on goblin guide"   → { intent: 'ADD_COUNTER', counterType: '+1/+1', cardName: '...' }
//   "pass"                            → { intent: 'PASS_PRIORITY' }
//   "end turn"                        → { intent: 'END_TURN' }
//   "untap all"                       → { intent: 'UNTAP_ALL' }
//   "exile lightning bolt"            → { intent: 'MOVE_CARD', zone: 'exile', cardName: '...' }
//   "bounce sol ring to hand"         → { intent: 'MOVE_CARD', zone: 'hand', cardName: '...' }
//   "counter lightning bolt"          → { intent: 'COUNTER_SPELL', cardName: '...' }
//   "resolve"                         → { intent: 'RESOLVE_STACK' }
//   "shuffle"                         → { intent: 'SHUFFLE' }
//   "scry 3"                          → { intent: 'SCRY', count: 3 }
//   "create 3 1/1 white soldier tokens" → { intent: 'CREATE_TOKEN', ... }
//   "player 2 takes 5"                → { intent: 'LIFE_CHANGE', playerId: '...', delta: -5 }
//   "gain 3 life"                     → { intent: 'LIFE_CHANGE', delta: 3 }

import type { GameState, Phase, Zone } from '../types/game';
import { deckCache } from './deckCache';

// ─── Intent Types ─────────────────────────────────────────────────────────────

export type IntentType =
  | 'CAST'
  | 'PLAY_LAND'
  | 'ATTACK'
  | 'MULTI_ATTACK'   // comma-separated attackers, optionally with targets
  | 'MULTI_BLOCK'    // comma-separated blockers vs one attacker
  | 'BLOCK'
  | 'TAP'
  | 'UNTAP'
  | 'TAP_ALL_LANDS'
  | 'UNTAP_ALL'
  | 'MOVE_CARD'
  | 'DRAW'
  | 'DISCARD'
  | 'SHUFFLE'
  | 'MILL'
  | 'SCRY'
  | 'ADD_COUNTER'
  | 'REMOVE_COUNTER'
  | 'LIFE_CHANGE'
  | 'POISON'
  | 'PASS_PRIORITY'
  | 'GO_TO_PHASE'
  | 'END_TURN'
  | 'ENTER_COMBAT'
  | 'END_COMBAT'
  | 'RESOLVE_STACK'
  | 'COUNTER_SPELL'
  | 'CREATE_TOKEN'
  | 'TRANSFORM'
  | 'FLIP_COIN'
  | 'ROLL_DICE'
  | 'UNDO'
  | 'SURVEIL'
  | 'CYCLE'
  | 'CAST_FROM_GY'
  | 'CAST_FROM_EXILE'
  | 'REANIMATE'
  | 'LOOK_AT_HAND'   // peek at opponent's hand
  | 'LOOK_AT_TOP'    // look at top N of any player's library
  | 'SORT_HAND'
  | 'UNKNOWN';

export interface ParsedIntent {
  intent: IntentType;
  raw: string;
  confidence: 'high' | 'medium' | 'low';

  // Card targeting — single
  cardName?: string;
  resolvedInstanceId?: string;   // filled after fuzzy match against game state

  // Card targeting — multi (MULTI_ATTACK, MULTI_BLOCK, etc.)
  // Each entry is a raw card name parsed from the comma list.
  cardNames?: string[];
  resolvedInstanceIds?: string[]; // parallel array to cardNames, filled after resolution

  // For MULTI_ATTACK — per-attacker target overrides (from "X attacks player 2, Y attacks player 3")
  // Map of cardName → targetPlayerIndex. If absent, the CombatPanel lets the player pick.
  attackAssignments?: Record<string, number>;  // cardName (normalized) → 1-based player index

  // Player targeting
  targetPlayerIndex?: number;    // 1-based player number from text
  targetPlayerId?: string;       // resolved player ID
  targetText?: string;           // raw target text from command input
  targetName?: string;           // card/permanent target text
  targetInstanceId?: string;     // resolved target card/permanent

  // Zone movement
  fromZone?: Zone;
  toZone?: Zone;

  // Counters
  counterType?: string;
  counterAmount?: number;

  // Life / damage
  delta?: number;

  // Phase
  phase?: Phase;

  // Draw / mill / scry
  count?: number;

  // Token creation
  token?: {
    count: number;
    power: number;
    toughness: number;
    colors: string[];
    subTypes: string[];
    name: string;
  };

  // Dice / coin
  diceSize?: number;

  // Ambiguity — multiple possible cards matched
  ambiguous?: boolean;
  candidates?: string[];        // multiple instanceIds

  // Error
  error?: string;
}

// ─── Phase Aliases ────────────────────────────────────────────────────────────

const PHASE_ALIASES: Record<string, Phase> = {
  'untap': 'untap',
  'upkeep': 'upkeep',
  'draw': 'draw',
  'draw step': 'draw',
  'main': 'main1',
  'main 1': 'main1',
  'main 2': 'main2',
  'main phase': 'main1',
  'first main': 'main1',
  'second main': 'main2',
  'precombat main': 'main1',
  'postcombat main': 'main2',
  'combat': 'beginningOfCombat',
  'beginning of combat': 'beginningOfCombat',
  'begin combat': 'beginningOfCombat',
  'attackers': 'declareAttackers',
  'declare attackers': 'declareAttackers',
  'blockers': 'declareBlockers',
  'declare blockers': 'declareBlockers',
  'damage': 'combatDamage',
  'combat damage': 'combatDamage',
  'end of combat': 'endOfCombat',
  'end step': 'endStep',
  'end': 'endStep',
  'cleanup': 'cleanup',
};

// ─── Zone Aliases ─────────────────────────────────────────────────────────────

const ZONE_ALIASES: Record<string, Zone> = {
  'hand': 'hand',
  'battlefield': 'battlefield',
  'play': 'battlefield',
  'graveyard': 'graveyard',
  'gy': 'graveyard',
  'grave': 'graveyard',
  'exile': 'exile',
  'exiled': 'exile',
  'library': 'library',
  'deck': 'library',
  'command zone': 'command',
  'command': 'command',
  'stack': 'stack',
};

// ─── Counter Aliases ──────────────────────────────────────────────────────────

const COUNTER_ALIASES: Record<string, string> = {
  '+1/+1': '+1/+1',
  '+1': '+1/+1',
  'plus one': '+1/+1',
  'plus counter': '+1/+1',
  '-1/-1': '-1/-1',
  '-1': '-1/-1',
  'minus one': '-1/-1',
  'loyalty': 'loyalty',
  'poison': 'poison',
  'stun': 'stun',
  'shield': 'shield',
  'charge': 'charge',
  'energy': 'energy',
  'experience': 'experience',
  'time': 'time',
  'age': 'age',
  'fade': 'fade',
  'quest': 'quest',
};

// ─── Color Aliases ────────────────────────────────────────────────────────────

const COLOR_ALIASES: Record<string, string> = {
  'white': 'W', 'w': 'W',
  'blue': 'U', 'u': 'U',
  'black': 'B', 'b': 'B',
  'red': 'R', 'r': 'R',
  'green': 'G', 'g': 'G',
  'colorless': 'C',
};

// ─── Core Parser ──────────────────────────────────────────────────────────────

export function parseCommand(raw: string): ParsedIntent {
  const input = raw.trim();
  const lower = input.toLowerCase().replace(/['']/g, "'").replace(/[""]/g, '"');
  const tokens = lower.split(/\s+/);

  const result: ParsedIntent = { intent: 'UNKNOWN', raw: input, confidence: 'low' };

  // ── Priority / Pass ──
  if (/^(pass|pass priority|ok|ok go|yield)$/.test(lower)) {
    return { ...result, intent: 'PASS_PRIORITY', confidence: 'high' };
  }

  // ── End Turn ──
  if (/^(end turn|next turn|end my turn|done)$/.test(lower)) {
    return { ...result, intent: 'END_TURN', confidence: 'high' };
  }

  // ── Undo ──
  if (/^(undo|take that back|revert)$/.test(lower)) {
    return { ...result, intent: 'UNDO', confidence: 'high' };
  }

  // ── Resolve Stack ──
  if (/^(resolve|let it resolve|resolve top|resolve stack)$/.test(lower)) {
    return { ...result, intent: 'RESOLVE_STACK', confidence: 'high' };
  }

  // ── Shuffle ──
  if (/^(shuffle|shuffle (my )?library|shuffle (my )?deck)$/.test(lower)) {
    return { ...result, intent: 'SHUFFLE', confidence: 'high' };
  }

  if (/^(sort|sort hand|sort my hand|organize hand|organize my hand)$/.test(lower)) {
    return { ...result, intent: 'SORT_HAND', confidence: 'high' };
  }

  // ── Flip Coin ──
  if (/^(flip( a)? coin|flip coin)$/.test(lower)) {
    return { ...result, intent: 'FLIP_COIN', confidence: 'high' };
  }

  // ── Roll Dice ──
  const diceMatch = lower.match(/^roll(?:\s+a)?\s+(?:d(\d+)|(\d+)[- ]?sided(?: die| dice)?|die)$/);
  if (diceMatch) {
    return { ...result, intent: 'ROLL_DICE', diceSize: parseInt(diceMatch[1] || diceMatch[2] || '6'), confidence: 'high' };
  }

  // ── Untap All ──
  if (/^(untap all|untap everything|untap all permanents)$/.test(lower)) {
    return { ...result, intent: 'UNTAP_ALL', confidence: 'high' };
  }

  // ── Tap All Lands ──
  if (/^(tap all( my)? lands?|tap lands?)$/.test(lower)) {
    return { ...result, intent: 'TAP_ALL_LANDS', confidence: 'high' };
  }

  // ── Enter / End Combat ──
  if (/^(enter combat|go to combat|attack|begin combat)$/.test(lower)) {
    return { ...result, intent: 'ENTER_COMBAT', confidence: 'high' };
  }
  if (/^(end combat|finish combat|combat is over)$/.test(lower)) {
    return { ...result, intent: 'END_COMBAT', confidence: 'high' };
  }

  // ── Go to Phase ──
  for (const [alias, phase] of Object.entries(PHASE_ALIASES)) {
    if (lower === alias || lower === `go to ${alias}` || lower === `move to ${alias}` || lower === `skip to ${alias}`) {
      return { ...result, intent: 'GO_TO_PHASE', phase, confidence: 'high' };
    }
  }

  // ── Draw ──
  const drawMatch = lower.match(/^draw(?:\s+(\d+|a|an|one|two|three|four|five|six|seven))?(?:\s+cards?)?$/);
  if (drawMatch) {
    return { ...result, intent: 'DRAW', count: parseWordNumber(drawMatch[1]) || 1, confidence: 'high' };
  }

  // ── Mill ──
  const millMatch = lower.match(/^mill(?:\s+(\d+|a|one|two|three|four|five))?\s*(?:cards?)?$/);
  if (millMatch) {
    return { ...result, intent: 'MILL', count: parseWordNumber(millMatch[1]) || 1, confidence: 'high' };
  }

  // ── Scry ──
  const scryMatch = lower.match(/^scry\s+(\d+|one|two|three|four|five|six|seven)$/);
  if (scryMatch) {
    return { ...result, intent: 'SCRY', count: parseWordNumber(scryMatch[1]) || 1, confidence: 'high' };
  }

  // ── Surveil ──
  const surveilMatch = lower.match(/^surveil\s+(\d+|one|two|three|four|five)$/);
  if (surveilMatch) {
    return { ...result, intent: 'SURVEIL', count: parseWordNumber(surveilMatch[1]) || 1, confidence: 'high' };
  }

  // ── Cycle ──
  // "cycle sol ring" / "discard for cycling sol ring" / "cycle my goblin guide"
  const cycleMatch = lower.match(/^(?:cycle|cycling|cycle away|discard.*cycling)\s+(.+)$/);
  if (cycleMatch) {
    return { ...result, intent: 'CYCLE', cardName: normalizeName(cycleMatch[1]), confidence: 'high' };
  }

  // ── Look at opponent hand ──
  // "look at player 2's hand" / "see player 3 hand"
  const lookHandMatch = lower.match(/^(?:look at|see|peek at|search)\s+player\s+(\d)(?:'s)?\s+hand$/);
  if (lookHandMatch) {
    return { ...result, intent: 'LOOK_AT_HAND', targetPlayerIndex: parseInt(lookHandMatch[1]), confidence: 'high' };
  }

  // ── Look at top N ──
  // "look at top 3" / "look at top 3 of my library" / "look at top of player 2's library"
  const lookTopSelf = lower.match(/^look at top(?:\s+(\d+))?(?:\s+(?:of|cards?|of my library|of my deck))?$/);
  if (lookTopSelf) {
    return { ...result, intent: 'LOOK_AT_TOP', count: parseWordNumber(lookTopSelf[1]) || 1, confidence: 'high' };
  }
  const lookTopPlayer = lower.match(/^look at top(?:\s+(\d+))?(?:\s+cards?)? of player\s+(\d)(?:'s)?(?:\s+(?:library|deck))?$/);
  if (lookTopPlayer) {
    return { ...result, intent: 'LOOK_AT_TOP', count: parseWordNumber(lookTopPlayer[1]) || 1, targetPlayerIndex: parseInt(lookTopPlayer[2]), confidence: 'high' };
  }

  // ── Cast from graveyard (flashback, unearth, encore, escape, etc.) ──
  // "flashback goblin dark-dwellers" / "cast from graveyard goblin guide"
  // "escape elspeth" / "unearth gravecrawler" / "encore zuzu"
  const castFromGyMatch = lower.match(
    /^(?:flashback|escape|unearth|encore|delve|disturb|rebound|dredge|cast from gy|cast from graveyard)\s+(.+)$/
  );
  if (castFromGyMatch) {
    return { ...result, intent: 'CAST_FROM_GY', cardName: normalizeName(castFromGyMatch[1]), confidence: 'high' };
  }
  // "cast sol ring from graveyard"
  const castFromGyAlt = lower.match(/^cast\s+(.+?)\s+from\s+(?:graveyard|gy|grave)$/);
  if (castFromGyAlt) {
    return { ...result, intent: 'CAST_FROM_GY', cardName: normalizeName(castFromGyAlt[1]), confidence: 'high' };
  }

  // ── Cast from exile ──
  // "foretell nephalia drownyard" / "adventure goblin guide" / "cast from exile"
  const castFromExileMatch = lower.match(
    /^(?:foretell|adventure|cast from exile|exile cast)\s+(.+)$/
  );
  if (castFromExileMatch) {
    return { ...result, intent: 'CAST_FROM_EXILE', cardName: normalizeName(castFromExileMatch[1]), confidence: 'high' };
  }
  const castFromExileAlt = lower.match(/^cast\s+(.+?)\s+from\s+exile$/);
  if (castFromExileAlt) {
    return { ...result, intent: 'CAST_FROM_EXILE', cardName: normalizeName(castFromExileAlt[1]), confidence: 'high' };
  }

  // ── Reanimate ──
  // "reanimate gravecrawler" / "return gravecrawler to battlefield" / "put gravecrawler onto battlefield"
  const reanimateKeyword = lower.match(/^(?:reanimate|animate|raise|resurrect|recover)\s+(.+)$/);
  const reanimateReturn = lower.match(/^return\s+(.+?)\s+to\s+(?:the\s+)?battlefield(?:\s+under\s+(?:your|my)\s+control)?$/);
  const reanimatePut = lower.match(/^put\s+(.+?)\s+(?:on|onto)\s+(?:the\s+)?battlefield(?:\s+under\s+(?:your|my)\s+control)?$/);
  const reanimateMatch = reanimateKeyword || reanimateReturn || reanimatePut;
  if (reanimateMatch) {
    const name = reanimateMatch[1];
    return { ...result, intent: 'REANIMATE', cardName: normalizeName(name), confidence: 'high' };
  }

  // ── Life gain / loss ──
  const gainMatch = lower.match(/^(?:i\s+)?gain\s+(\d+)\s*(?:life)?$/);
  if (gainMatch) {
    return { ...result, intent: 'LIFE_CHANGE', delta: parseInt(gainMatch[1]), confidence: 'high' };
  }
  const loseMatch = lower.match(/^(?:i\s+)?(?:lose|lost|take)\s+(\d+)\s*(?:life|damage)?$/);
  if (loseMatch) {
    return { ...result, intent: 'LIFE_CHANGE', delta: -parseInt(loseMatch[1]), confidence: 'high' };
  }

  // ── Player N takes / gains X ──
  const playerLifeMatch = lower.match(
    /^player\s+(\d)\s+(?:takes|loses|lost)\s+(\d+)(?:\s+(?:life|damage))?$|^player\s+(\d)\s+gains\s+(\d+)(?:\s+life)?$/
  );
  if (playerLifeMatch) {
    const playerIdx = parseInt(playerLifeMatch[1] || playerLifeMatch[3]);
    const amount = parseInt(playerLifeMatch[2] || playerLifeMatch[4]);
    const gains = lower.includes('gains');
    return { ...result, intent: 'LIFE_CHANGE', targetPlayerIndex: playerIdx, delta: gains ? amount : -amount, confidence: 'high' };
  }

  // ── Poison ──
  const poisonMatch = lower.match(/^(?:add\s+)?(\d+)\s+poison(?:\s+counters?)?(?:\s+to\s+player\s+(\d))?$/);
  if (poisonMatch) {
    return { ...result, intent: 'POISON', count: parseInt(poisonMatch[1]), targetPlayerIndex: poisonMatch[2] ? parseInt(poisonMatch[2]) : undefined, confidence: 'high' };
  }

  // ── Counter spell by name (on stack) ──
  const counterMatch = lower.match(/^counter\s+(.+)$/);
  if (counterMatch) {
    return { ...result, intent: 'COUNTER_SPELL', cardName: normalizeName(counterMatch[1]), confidence: 'medium' };
  }

  // ── Cast / Play ──
  const castPatterns = [
    /^(?:cast|play|cast\s+spell)\s+(.+?)(?:\s+(?:targeting|on|at)\s+(.+?))?(?:\s+from\s+(?:hand|graveyard|exile))?$/,
  ];
  for (const pattern of castPatterns) {
    const m = lower.match(pattern);
    if (m) {
      const targetText = m[2]?.trim();
      const playerTarget = targetText?.match(/^player\s+(\d)$/);
      return {
        ...result,
        intent: 'CAST',
        cardName: normalizeName(m[1]),
        targetText: targetText ? normalizeName(targetText) : undefined,
        targetPlayerIndex: playerTarget ? parseInt(playerTarget[1]) : undefined,
        targetName: targetText && !playerTarget ? normalizeName(targetText) : undefined,
        confidence: 'medium',
      };
    }
  }

  // ── Tap specific card ──
  const tapMatch = lower.match(/^tap\s+(.+)$/);
  if (tapMatch && !lower.includes('all') && !lower.includes('lands')) {
    return { ...result, intent: 'TAP', cardName: normalizeName(tapMatch[1]), confidence: 'medium' };
  }

  // ── Untap specific card ──
  const untapMatch = lower.match(/^untap\s+(.+)$/);
  if (untapMatch && !lower.includes('all')) {
    return { ...result, intent: 'UNTAP', cardName: normalizeName(untapMatch[1]), confidence: 'medium' };
  }

  // ── Transform ──
  const transformMatch = lower.match(/^transform\s+(.+)$/);
  if (transformMatch) {
    return { ...result, intent: 'TRANSFORM', cardName: normalizeName(transformMatch[1]), confidence: 'medium' };
  }

  // ── Attack ──
  // ── Multi-attack ──
  // "attack with Goblin Guide, Mayhem Devil, Satya"
  // "attack with Goblin Guide, Mayhem Devil targeting player 2"
  // "attack player 2 with Goblin Guide, Mayhem Devil"
  // "Goblin Guide, Mayhem Devil attack"
  // Also handles optional per-creature target annotations in the list:
  //   "Goblin Guide (player 2), Mayhem Devil (player 3) attack"
  const multiAttackWith = lower.match(/^attack(?:\s+player\s+(\d))?\s+with\s+(.+)$/);
  if (multiAttackWith) {
    const raw = multiAttackWith[2];
    const defaultTarget = multiAttackWith[1] ? parseInt(multiAttackWith[1]) : undefined;
    // Check if it has commas (multi) or "and" joining multiple names
    if (raw.includes(',') || /\band\b/.test(raw)) {
      const { names, assignments } = parseAttackerList(raw, defaultTarget);
      if (names.length > 1) {
        return {
          ...result,
          intent: 'MULTI_ATTACK',
          cardNames: names,
          targetPlayerIndex: defaultTarget,
          attackAssignments: Object.keys(assignments).length > 0 ? assignments : undefined,
          confidence: 'high',
        };
      }
    }
  }

  // "Goblin Guide, Mayhem Devil, Satya attack [player N]"
  const multiCreatureAttack = lower.match(/^(.+?)\s+attacks?(?:\s+player\s+(\d))?$/);
  if (multiCreatureAttack) {
    const raw = multiCreatureAttack[1];
    if (raw.includes(',') || (/\band\b/.test(raw) && raw.split(/\band\b/).length === 2)) {
      const defaultTarget = multiCreatureAttack[2] ? parseInt(multiCreatureAttack[2]) : undefined;
      const { names, assignments } = parseAttackerList(raw, defaultTarget);
      if (names.length > 1) {
        return {
          ...result,
          intent: 'MULTI_ATTACK',
          cardNames: names,
          targetPlayerIndex: defaultTarget,
          attackAssignments: Object.keys(assignments).length > 0 ? assignments : undefined,
          confidence: 'high',
        };
      }
    }
  }

  // ── Multi-block ──
  // "Goblin Guide, Wall of Blossoms block Mayhem Devil"
  // "block Mayhem Devil with Goblin Guide, Wall of Blossoms"
  const multiBlockWith = lower.match(/^block\s+(.+?)\s+with\s+(.+)$/);
  if (multiBlockWith && (multiBlockWith[2].includes(',') || /\band\b/.test(multiBlockWith[2]))) {
    const blockerNames = splitNameList(multiBlockWith[2]).map(normalizeName);
    const attackerName = normalizeName(multiBlockWith[1]);
    if (blockerNames.length > 1) {
      return { ...result, intent: 'MULTI_BLOCK', cardName: attackerName, cardNames: blockerNames, confidence: 'high' };
    }
  }
  const multiBlockAtk = lower.match(/^(.+?)\s+blocks?\s+(.+)$/);
  if (multiBlockAtk) {
    const rawBlockers = multiBlockAtk[1];
    if (rawBlockers.includes(',') || /\band\b/.test(rawBlockers)) {
      const blockerNames = splitNameList(rawBlockers).map(normalizeName);
      const attackerName = normalizeName(multiBlockAtk[2]);
      if (blockerNames.length > 1) {
        return { ...result, intent: 'MULTI_BLOCK', cardName: attackerName, cardNames: blockerNames, confidence: 'high' };
      }
    }
  }

  // ── Single Attack ──
  // "attack player 2 with goblin guide"
  // "attack with goblin guide"
  // "goblin guide attacks"
  const attackWithTarget = lower.match(/^attack\s+player\s+(\d)\s+with\s+(.+)$/);
  if (attackWithTarget) {
    return { ...result, intent: 'ATTACK', targetPlayerIndex: parseInt(attackWithTarget[1]), cardName: normalizeName(attackWithTarget[2]), confidence: 'high' };
  }
  const attackWith = lower.match(/^attack\s+with\s+(.+)$/);
  if (attackWith) {
    return { ...result, intent: 'ATTACK', cardName: normalizeName(attackWith[1]), confidence: 'medium' };
  }
  const cardAttacks = lower.match(/^(.+?)\s+attacks?(?:\s+player\s+(\d))?$/);
  if (cardAttacks && !lower.startsWith('declare') && cardAttacks[1].split(' ').length <= 6) {
    return { ...result, intent: 'ATTACK', cardName: normalizeName(cardAttacks[1]), targetPlayerIndex: cardAttacks[2] ? parseInt(cardAttacks[2]) : undefined, confidence: 'medium' };
  }

  // ── Block ──
  const blockMatch = lower.match(/^(.+?)\s+blocks?\s+(.+)$/);
  if (blockMatch) {
    return { ...result, intent: 'BLOCK', cardName: normalizeName(blockMatch[1]), ambiguous: false, candidates: [normalizeName(blockMatch[2])], confidence: 'medium' };
  }

  // ── Move card to zone ──
  // "exile lightning bolt" / "bounce sol ring to hand" / "put X in graveyard"
  const movePatterns: Array<{ pattern: RegExp; zone: Zone }> = [
    { pattern: /^exile\s+(.+)$/, zone: 'exile' },
    { pattern: /^destroy\s+(.+)$/, zone: 'graveyard' },
    { pattern: /^sacrifice\s+(.+)$/, zone: 'graveyard' },
    { pattern: /^discard\s+(.+)$/, zone: 'graveyard' },
    { pattern: /^bounce\s+(.+?)(?:\s+to\s+hand)?$/, zone: 'hand' },
    { pattern: /^return\s+(.+?)\s+to\s+(?:hand|your hand)$/, zone: 'hand' },
    { pattern: /^return\s+(.+?)\s+to\s+(?:library|deck)$/, zone: 'library' },
    { pattern: /^put\s+(.+?)\s+(?:in(?:to)?|on(?:to)?)\s+(?:the\s+)?graveyard$/, zone: 'graveyard' },
    { pattern: /^put\s+(.+?)\s+(?:in(?:to)?|on(?:to)?)\s+(?:your\s+)?hand$/, zone: 'hand' },
    { pattern: /^put\s+(.+?)\s+(?:in(?:to)?|back\s+(?:in)?(?:to)?)\s+(?:the\s+)?(?:library|deck)$/, zone: 'library' },
    { pattern: /^(.+?)\s+(?:goes?|go)\s+to\s+(?:the\s+)?graveyard$/, zone: 'graveyard' },
    { pattern: /^(.+?)\s+(?:goes?|go)\s+to\s+exile$/, zone: 'exile' },
  ];
  for (const { pattern, zone } of movePatterns) {
    const m = lower.match(pattern);
    if (m) {
      return { ...result, intent: 'MOVE_CARD', toZone: zone, cardName: normalizeName(m[1]), confidence: 'medium' };
    }
  }

  // ── Add Counter ──
  // "+1/+1 on goblin guide" / "add 2 charge counters to sol ring"
  const addCounterPatterns = [
    /^(\+1\/\+1|[-+]\d\/[-+]\d)\s+(?:on|to|counter on)\s+(.+)$/,
    /^add\s+(?:a\s+)?(\w+)\s+counter\s+(?:on|to)\s+(.+)$/,
    /^add\s+(\d+)\s+(\w+)\s+counters?\s+(?:on|to)\s+(.+)$/,
    /^put\s+(?:a\s+)?(\w+)\s+counter\s+on\s+(.+)$/,
    /^put\s+(\d+)\s+(\w+)\s+counters?\s+on\s+(.+)$/,
  ];
  for (const p of addCounterPatterns) {
    const m = lower.match(p);
    if (m) {
      let cType: string, cAmount: number, cCard: string;
      if (m.length === 4 && /^\d+$/.test(m[1])) {
        cAmount = parseInt(m[1]); cType = resolveCounterType(m[2]); cCard = m[3];
      } else if (m.length === 4 && /^\d+$/.test(m[2])) {
        cAmount = parseInt(m[2]); cType = resolveCounterType(m[1]); cCard = m[3];
      } else {
        cType = resolveCounterType(m[1]); cAmount = 1; cCard = m[2] || m[3];
      }
      return { ...result, intent: 'ADD_COUNTER', counterType: cType, counterAmount: cAmount, cardName: normalizeName(cCard), confidence: 'medium' };
    }
  }

  // ── Remove Counter ──
  const removeCounterPatterns = [
    /^remove\s+(?:a\s+)?(\w+)\s+counter\s+(?:from)\s+(.+)$/,
    /^remove\s+(\d+)\s+(\w+)\s+counters?\s+from\s+(.+)$/,
  ];
  for (const p of removeCounterPatterns) {
    const m = lower.match(p);
    if (m) {
      const cType = resolveCounterType(m[1]);
      const cCard = m[2] || m[3];
      return { ...result, intent: 'REMOVE_COUNTER', counterType: cType, counterAmount: 1, cardName: normalizeName(cCard), confidence: 'medium' };
    }
  }

  // ── Create Token ──
  // "create 3 1/1 white soldier tokens"
  // "make a 2/2 green bear token"
  // "create treasure token" / "create 2 treasure tokens"
  const namedTokenMatch = lower.match(
    /^(?:create|make|generate|add)\s+(?:(\d+|a|an)\s+)?(?:a\s+)?([a-z ]+?)\s+tokens?$/
  );
  if (namedTokenMatch) {
    const countRaw = namedTokenMatch[1];
    const tokenDesc = namedTokenMatch[2].trim();

    // Check if it has P/T in it: "1/1 white soldier"
    const ptMatch = tokenDesc.match(/^(\d+)\/(\d+)\s*(.*)$/);
    let power = 1, toughness = 1, extras = tokenDesc;
    if (ptMatch) { power = parseInt(ptMatch[1]); toughness = parseInt(ptMatch[2]); extras = ptMatch[3].trim(); }

    // Extract colors
    const colors: string[] = [];
    const colorWords = extras.split(' ');
    const cleanWords = colorWords.filter(w => {
      const c = COLOR_ALIASES[w];
      if (c) { colors.push(c); return false; }
      return true;
    });

    const subTypes = cleanWords.filter(Boolean);
    const name = `${power}/${toughness} ${extras.trim()}`.trim() || tokenDesc;

    return {
      ...result,
      intent: 'CREATE_TOKEN',
      count: parseWordNumber(countRaw) || 1,
      token: { count: parseWordNumber(countRaw) || 1, power, toughness, colors, subTypes, name },
      confidence: 'medium',
    };
  }

  // ── Fallback: try to match a bare card name (any word sequence that isn't a keyword) ──
  const cleaned = lower.replace(/[^a-z0-9 ',\-]/g, '').trim();
  if (cleaned.length > 2) {
    return { ...result, intent: 'CAST', cardName: normalizeName(cleaned), confidence: 'low' };
  }

  return result;
}

// ─── Post-Parse: Resolve Against Game State ───────────────────────────────────

export interface ResolvedIntent extends ParsedIntent {
  resolvedInstanceId?: string;
  resolvedInstanceIds?: string[];
  targetPlayerId?: string;
  ambiguous?: boolean;
  candidates?: string[];
  error?: string;
}

export function resolveIntent(
  intent: ParsedIntent,
  state: GameState,
  actingPlayerId: string
): ResolvedIntent {
  const r: ResolvedIntent = { ...intent };

  // Resolve target player
  if (intent.targetPlayerIndex !== undefined) {
    const p = state.players[intent.targetPlayerIndex - 1];
    r.targetPlayerId = p?.id;
    if (!p) r.error = `No player ${intent.targetPlayerIndex} in this game.`;
  }

  // Resolve card name → instance ID (single card intents)
  if (intent.cardName) {
    const matches = findCardsByName(intent.cardName, state, actingPlayerId, intent);
    if (matches.length === 0) {
      r.error = `No card named "${intent.cardName}" found in the relevant zone.`;
    } else if (matches.length === 1) {
      r.resolvedInstanceId = matches[0];
    } else {
      r.ambiguous = true;
      r.candidates = matches;
      r.resolvedInstanceId = matches[0]; // default to first
    }
  }

  // Resolve multi-card name list → instance IDs (MULTI_ATTACK, MULTI_BLOCK)
  if (intent.cardNames && intent.cardNames.length > 0) {
    const fakeIntent: ParsedIntent = {
      ...intent,
      // For attackers/blockers, always search battlefield
      intent: intent.intent === 'MULTI_BLOCK' ? 'BLOCK' : 'ATTACK',
    };
    const resolved: string[] = [];
    const errors: string[] = [];
    for (const name of intent.cardNames) {
      const matches = findCardsByName(name, state, actingPlayerId, fakeIntent);
      if (matches.length === 0) {
        errors.push(`"${name}" not found on battlefield.`);
      } else {
        resolved.push(matches[0]); // take best match per card
      }
    }
    r.resolvedInstanceIds = resolved;
    if (errors.length > 0) {
      r.error = errors.join(' ');
    }

    // Re-key attackAssignments from normalized name keys to resolvedInstanceId
    // so consumers don't have to do name matching themselves
    if (intent.attackAssignments && resolved.length > 0) {
      const remapped: Record<string, number> = {};
      intent.cardNames.forEach((name, i) => {
        const id = resolved[i];
        const playerIdx = intent.attackAssignments![name];
        if (id && playerIdx !== undefined) remapped[id] = playerIdx;
      });
      r.attackAssignments = remapped;
    }
  }

  return r;
}

// ─── Fuzzy Card Name Resolution ───────────────────────────────────────────────

function findCardsByName(
  name: string,
  state: GameState,
  actingPlayerId: string,
  intent: ParsedIntent
): string[] {
  const normalizedQuery = name.toLowerCase().trim();
  const searchZones = getSearchZones(intent);

  // ── Primary: DeckCache (O(1) index, pre-built at deck-load time) ──────────
  // The cache resolves fuzzy names using a pre-built prefix trie + scored
  // index over every card ingested at deck-upload time. We then cross-
  // reference those names against live game state to get real instanceIds.
  const cacheHits = deckCache.resolveCardName(normalizedQuery, actingPlayerId);

  if (cacheHits.length > 0) {
    const results: Array<{ instanceId: string; score: number }> = [];
    for (const hit of cacheHits) {
      for (const card of Object.values(state.cards)) {
        if (!searchZones.includes(card.zone)) continue;
        if (card.definition.name.toLowerCase() === hit.nameLower) {
          const rank = cacheHits.indexOf(hit);
          results.push({ instanceId: card.instanceId, score: 1.0 - rank * 0.1 });
        }
      }
    }
    if (results.length > 0) {
      results.sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      return results
        .filter(c => {
          const n = state.cards[c.instanceId]?.definition.name;
          if (!n || seen.has(n)) return false;
          seen.add(n);
          return true;
        })
        .slice(0, 5)
        .map(c => c.instanceId);
    }
  }

  // ── Fallback: scan live game state (for uncached / placeholder cards) ──────
  const candidates: Array<{ instanceId: string; score: number }> = [];

  for (const card of Object.values(state.cards)) {
    if (!searchZones.includes(card.zone)) continue;
    const cardName = card.definition.name.toLowerCase();
    const score = fuzzyScore(normalizedQuery, cardName);
    if (score >= 0.4) candidates.push({ instanceId: card.instanceId, score });
  }

  candidates.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  return candidates
    .filter(c => {
      const n = state.cards[c.instanceId]?.definition.name;
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    })
    .slice(0, 5)
    .map(c => c.instanceId);
}

function getSearchZones(intent: ParsedIntent): import('../types/game').Zone[] {
  switch (intent.intent) {
    case 'CAST': return ['hand', 'graveyard', 'exile', 'command'];
    case 'PLAY_LAND': return ['hand'];
    case 'ATTACK': return ['battlefield'];
    case 'BLOCK': return ['battlefield'];
    case 'TAP': return ['battlefield'];
    case 'UNTAP': return ['battlefield'];
    case 'TRANSFORM': return ['battlefield'];
    case 'ADD_COUNTER': return ['battlefield'];
    case 'REMOVE_COUNTER': return ['battlefield'];
    case 'DISCARD': return ['hand'];
    case 'CYCLE': return ['hand'];
    case 'COUNTER_SPELL': return ['stack'];
    case 'MOVE_CARD': return ['battlefield', 'hand', 'graveyard', 'exile', 'library'];
    case 'CAST_FROM_GY': return ['graveyard'];
    case 'CAST_FROM_EXILE': return ['exile'];
    case 'REANIMATE': return ['graveyard', 'exile'];
    default: return ['battlefield', 'hand', 'graveyard', 'exile', 'command', 'stack'];
  }
}

// ─── Fuzzy Matching ───────────────────────────────────────────────────────────

function fuzzyScore(query: string, target: string): number {
  if (target === query) return 1.0;
  if (target.startsWith(query)) return 0.95;
  if (target.includes(query)) return 0.85;

  // Check each word of query against target
  const qWords = query.split(/\s+/);
  const tWords = target.split(/\s+/);
  let wordMatches = 0;
  for (const qw of qWords) {
    if (tWords.some(tw => tw.startsWith(qw) || tw === qw)) wordMatches++;
  }
  const wordScore = wordMatches / Math.max(qWords.length, tWords.length);
  if (wordScore > 0) return wordScore * 0.8;

  // Character-level similarity (Dice coefficient)
  return diceCoefficient(query, target) * 0.7;
}

function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const aBigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    aBigrams.set(bg, (aBigrams.get(bg) || 0) + 1);
  }
  let intersections = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = aBigrams.get(bg) || 0;
    if (count > 0) { intersections++; aBigrams.set(bg, count - 1); }
  }
  return (2 * intersections) / (a.length + b.length - 2);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Multi-Card List Parsers ──────────────────────────────────────────────────

/**
 * Split a raw comma/and-separated list into individual card name strings.
 * Handles: "Goblin Guide, Mayhem Devil, Satya"
 *          "Goblin Guide and Mayhem Devil"
 */
export function splitNameList(raw: string): string[] {
  return raw
    .split(/,|\band\b/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Parse an attacker list that may contain optional inline target annotations:
 *   "Goblin Guide (player 2), Mayhem Devil, Satya (player 3)"
 * Returns normalized card names and a per-card assignment map.
 * defaultTarget is applied to cards without an explicit annotation.
 */
export function parseAttackerList(
  raw: string,
  defaultTarget?: number
): { names: string[]; assignments: Record<string, number> } {
  const parts = splitNameList(raw);
  const names: string[] = [];
  const assignments: Record<string, number> = {};

  for (const part of parts) {
    // Inline target: "Goblin Guide (player 2)" or "-> player 2" or "targeting player 2"
    const inlineTarget = part.match(/^(.+?)\s*(?:\(player\s*(\d)\)|->\s*player\s*(\d)|targeting\s+player\s*(\d))$/i);
    if (inlineTarget) {
      const n = normalizeNameHelper(inlineTarget[1]);
      const t = parseInt(inlineTarget[2] || inlineTarget[3] || inlineTarget[4]);
      names.push(n);
      if (!isNaN(t)) assignments[n] = t;
    } else {
      const n = normalizeNameHelper(part);
      names.push(n);
      if (defaultTarget !== undefined) assignments[n] = defaultTarget;
    }
  }

  return { names, assignments };
}

// Internal helper — same as normalizeName but extracted to avoid forward-reference
function normalizeNameHelper(raw: string): string {
  return raw
    .trim()
    .replace(/^(the|a|an|my|your|their)\s+/i, '')
    .replace(/\s+(it|that|this|card|permanent|creature|spell)$/i, '')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function normalizeName(raw: string): string {
  return raw
    .trim()
    // Remove common articles and suffixes that aren't part of card names
    .replace(/^(the|a|an|my|your|their)\s+/i, '')
    .replace(/\s+(it|that|this|card|permanent|creature|spell)$/i, '')
    .trim()
    // Title-case each word
    .replace(/\b\w/g, c => c.toUpperCase());
}

function resolveCounterType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return COUNTER_ALIASES[lower] || raw;
}

function parseWordNumber(raw?: string): number {
  if (!raw) return 1;
  const num = parseInt(raw);
  if (!isNaN(num)) return num;
  const map: Record<string, number> = {
    'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
    'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  };
  return map[raw.toLowerCase()] || 1;
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

export function getSuggestions(partial: string, state: GameState, actingPlayerId: string): string[] {
  if (!partial.trim()) return getContextualSuggestions(state, actingPlayerId);

  const lower = partial.toLowerCase();
  const suggestions: string[] = [];

  if ('sort hand'.startsWith(lower) || lower.startsWith('sort')) {
    suggestions.push('sort hand');
  }

  // ── 1. DeckCache trie autocomplete (fastest path, pre-built at deck-load) ───────
  // Returns command completions like "cast Sol Ring", "attack with Goblin Guide"
  // or raw card names, based on whatever prefix the player has typed.
  const cacheCompletions = deckCache.getCompletions(lower);
  suggestions.push(...cacheCompletions);

  // ── 2. Phase suggestions (always available) ────────────────────────────────
  const phaseKeywords = ['move to ', 'go to ', 'skip to '];
  for (const kw of phaseKeywords) {
    if (lower.startsWith(kw) || kw.startsWith(lower)) {
      for (const alias of Object.keys(PHASE_ALIASES)) {
        suggestions.push(`${kw}${alias}`);
      }
    }
  }

  // ── 3. Fallback: scan live game state (for uncached / placeholder cards) ─────
  // Only runs if the cache returned fewer than 4 completions.
  if (suggestions.length < 4) {
    const player = state.players.find(p => p.id === actingPlayerId);
    if (player) {
      const zones = ['hand', 'battlefield', 'graveyard'] as const;
      for (const zone of zones) {
        const cardIds = zone === 'hand' ? player.hand
          : zone === 'battlefield' ? player.battlefield
          : player.graveyard;
        for (const id of cardIds) {
          const card = state.cards[id];
          if (!card) continue;
          const name = card.definition.name;
          if (name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase().split(' ')[0])) {
            if (zone === 'hand') suggestions.push(`cast ${name}`);
            if (zone === 'battlefield' && card.definition.cardTypes.includes('Creature')) {
              suggestions.push(`attack with ${name}`, `tap ${name}`);
            }
            if (zone === 'graveyard') suggestions.push(`return ${name} to hand`);
          }
        }
      }
    }
  }

  return [...new Set(suggestions)].slice(0, 8);
}

function getContextualSuggestions(state: GameState, actingPlayerId: string): string[] {
  const suggestions: string[] = [];
  const phase = state.phase;

  if (phase === 'untap') suggestions.push('untap all');
  if (phase === 'draw') suggestions.push('draw');
  if (phase === 'main1' || phase === 'main2') {
    suggestions.push('pass', 'tap all lands', 'draw');
    const player = state.players.find(p => p.id === actingPlayerId);
    if (player?.hand.length) {
      suggestions.push('sort hand');
      for (const id of player.hand.slice(0, 3)) {
        const card = state.cards[id];
        if (card) {
          const isLand = card.definition.cardTypes.includes('Land');
          suggestions.push(isLand ? `play ${card.definition.name}` : `cast ${card.definition.name}`);
        }
      }
    }
    suggestions.push('move to combat');
  }
  if (phase === 'beginningOfCombat') suggestions.push('declare attackers', 'end combat', 'pass');
  if (phase === 'declareAttackers') suggestions.push('pass', 'end turn');
  if (phase === 'endStep') suggestions.push('end turn', 'pass');

  suggestions.push('end turn', 'pass', 'undo');
  return [...new Set(suggestions)].slice(0, 8);
}
