// ─── Mechanic Resolver ────────────────────────────────────────────────────────
//
// Three-tier system:
//
//  Tier 1 — POPULAR (hardcoded engine support)
//    Always available via NLP and context menus. No card text needed.
//    Examples: Cycling, Flashback, Escape, Unearth, Reanimate, Scry, Surveil,
//              Foretell, Adventure, Disturb, Encore, Dredge, Rebound, Delve
//
//  Tier 2 — KEYWORD-DETECTED (resolved from card.definition.keywords[])
//    Scryfall returns these as clean strings. Checked at runtime when a card is
//    targeted. Presents the appropriate action button/suggestion.
//    Examples: Equip, Fortify, Bestow, Morph, Megamorph, Dash, Madness,
//              Overload, Buyback, Kicker, Flashback (also tier 1), Jumpstart,
//              Spectacle, Surge, Convoke, Delve (also tier 1), Emerge,
//              Awaken, Level up, Crew, Champion, Haunt, Hideaway, Offering
//
//  Tier 3 — ORACLE TEXT (parsed from oracleText at runtime)
//    Niche or unique effects not represented as keywords. Parsed on-demand
//    when viewing a card or attempting an action. Results are cached on the
//    card definition to avoid re-parsing.
//    Examples: Yawgmoth's Will ("play cards from your graveyard"),
//              Praetor's Grasp ("search opponent's library"),
//              Bribery ("put a creature from opponent's library onto battlefield"),
//              Knowledge Pool, Possibility Storm, etc.

import type { CardDefinition, CardState } from '../types/game';

// ─── Tier 1: Hardcoded popular mechanics ─────────────────────────────────────

export const TIER1_MECHANICS = new Set([
  // Cast-from-graveyard family
  'flashback', 'escape', 'unearth', 'encore', 'disturb', 'rebound',
  'dredge', 'delve', 'aftermath',
  // Cast-from-exile family
  'foretell', 'adventure', 'suspend',
  // Zone manipulation
  'cycling', 'reanimate',
  // Library manipulation
  'scry', 'surveil',
  // Token/copy
  'populate', 'myriad',
  // Evergreen keywords (always in context menus)
  'equip', 'attach', 'transform', 'flip', 'crew',
]);

// Display names for tier 1 (used in UI labels)
export const TIER1_LABELS: Record<string, string> = {
  flashback: 'Cast from Graveyard (Flashback)',
  escape: 'Cast from Graveyard (Escape)',
  unearth: 'Unearth (Temporarily to BF)',
  encore: 'Encore',
  disturb: 'Cast from Graveyard (Disturb)',
  rebound: 'Rebound',
  dredge: 'Dredge',
  delve: 'Cast from Graveyard (Delve)',
  aftermath: 'Cast from Graveyard (Aftermath)',
  foretell: 'Cast from Exile (Foretell)',
  adventure: 'Cast from Exile (Adventure)',
  suspend: 'Cast from Exile (Suspend)',
  cycling: 'Cycle (Discard → Draw 1)',
  reanimate: 'Reanimate (to Battlefield)',
  scry: 'Scry',
  surveil: 'Surveil',
  populate: 'Populate (Copy a Token)',
  myriad: 'Myriad',
  equip: 'Equip',
  attach: 'Attach',
  transform: 'Transform',
  flip: 'Flip',
  crew: 'Crew (tap creatures)',
};

// ─── Tier 2: Keyword-detected mechanics ──────────────────────────────────────
// These map Scryfall keyword strings → action type the UI should offer.

export type KeywordAction =
  | 'CAST_FROM_GY'
  | 'CAST_FROM_EXILE'
  | 'CYCLE'
  | 'MORPH'        // turn face-down / face-up
  | 'EQUIP'        // attach to creature
  | 'KICKER'       // pay kicker when casting
  | 'BUYBACK'      // return to hand on cast
  | 'MADNESS'      // cast from discard
  | 'DASH'         // cast with haste, return at end
  | 'EMERGE'       // sacrifice creature to reduce cost
  | 'SURGE'        // discount if you've cast a spell this turn
  | 'OVERLOAD'     // pay overload cost for all targets
  | 'CONSPIRE'     // copy by tapping creatures
  | 'REPLICATE'    // copy by paying mana
  | 'HAUNT'        // exile on death, haunt a creature
  | 'CHAMPION'     // exile a creature of the same type
  | 'OFFERING'     // flash + reduce cost
  | 'JUMP_START'   // flashback but discard instead of exile
  | 'SPECTACLE'    // discount if opponent lost life
  | 'MUTATE'       // merge with another creature
  | 'ESCAPE'       // cast from gy exiling cards
  | 'NINJUTSU'     // swap unblocked attacker with ninja
  | 'CHANNEL'      // discard for effect
  | 'CONVOKE'      // tap creatures to pay cost
  | 'IMPROVISE'    // tap artifacts to pay cost
  | 'ASSIST'       // another player helps pay
  | 'LEVELUP'      // pay to put level counters
  | 'REINFORCE'    // discard to put counters on creature
  | 'HIDEAWAY'     // look at top 4, exile one face down
  | 'FORTIFY'      // attach to land
  | 'BESTOW'       // cast as aura or creature
  | 'MONSTROSITY'  // pay to become monstrous
  | 'TRIBUTE'      // opponent chooses: counter or effect
  | 'AWAKEN'       // pay extra to animate a land
  | 'EXPLOIT'      // sacrifice a creature for effect
  | 'MANIFEST'     // put face-down, may turn up
  | 'MORPH_UP'     // turn face-up from morph
  | 'GENERIC'      // catch-all for display only

export interface KeywordMechanic {
  keyword: string;          // normalized lowercase Scryfall keyword
  action: KeywordAction;
  label: string;            // short UI label
  fromZone?: 'graveyard' | 'exile' | 'hand' | 'library';
  description: string;      // tooltip / judge reminder
}

export const TIER2_KEYWORDS: KeywordMechanic[] = [
  // Cast-from-graveyard
  { keyword: 'flashback',  action: 'CAST_FROM_GY', label: 'Flashback', fromZone: 'graveyard',
    description: 'Cast from graveyard by paying its flashback cost; exile instead of going to GY.' },
  { keyword: 'escape',     action: 'ESCAPE',       label: 'Escape',    fromZone: 'graveyard',
    description: 'Cast from graveyard by paying its escape cost and exiling other cards from GY.' },
  { keyword: 'unearth',    action: 'CAST_FROM_GY', label: 'Unearth',   fromZone: 'graveyard',
    description: 'Return this card to the battlefield until end of turn. Exile at end of turn or when it would leave.' },
  { keyword: 'encore',     action: 'CAST_FROM_GY', label: 'Encore',    fromZone: 'graveyard',
    description: 'Pay encore cost, exile from GY: create token copies attacking each opponent.' },
  { keyword: 'disturb',    action: 'CAST_FROM_GY', label: 'Disturb',   fromZone: 'graveyard',
    description: 'Cast from graveyard transformed. If it would leave the battlefield, exile it instead.' },
  { keyword: 'rebound',    action: 'CAST_FROM_EXILE', label: 'Rebound', fromZone: 'exile',
    description: 'Exile as it resolves; may cast for free during your next upkeep.' },
  { keyword: 'dredge',     action: 'CAST_FROM_GY', label: 'Dredge',    fromZone: 'graveyard',
    description: 'Instead of drawing, mill N cards and return this to your hand.' },
  { keyword: 'delve',      action: 'CAST_FROM_GY', label: 'Delve',     fromZone: 'graveyard',
    description: 'Each card exiled from GY while casting pays for {1}.' },
  { keyword: 'aftermath',  action: 'CAST_FROM_GY', label: 'Aftermath', fromZone: 'graveyard',
    description: 'Cast the second half of a split card only from your graveyard.' },
  { keyword: 'jump-start', action: 'CAST_FROM_GY', label: 'Jump-Start', fromZone: 'graveyard',
    description: 'Cast from graveyard by paying its cost and discarding a card; exile it afterward.' },
  // Cast-from-exile
  { keyword: 'foretell',   action: 'CAST_FROM_EXILE', label: 'Foretell', fromZone: 'exile',
    description: 'Exile face-down for {2} on your turn; cast for foretell cost on a later turn.' },
  { keyword: 'adventure',  action: 'CAST_FROM_EXILE', label: 'Cast Adventure', fromZone: 'exile',
    description: 'Cast the Adventure half as a spell; the card goes to exile, then cast the creature from exile.' },
  { keyword: 'suspend',    action: 'CAST_FROM_EXILE', label: 'Suspend', fromZone: 'exile',
    description: 'Exile with time counters; each upkeep remove one. Cast for free when last counter removed.' },
  // Discard-based
  { keyword: 'cycling',   action: 'CYCLE',         label: 'Cycle',     fromZone: 'hand',
    description: 'Pay cycling cost, discard this card: draw a card. Cycling triggers any "whenever you cycle" effects.' },
  { keyword: 'madness',   action: 'MADNESS',        label: 'Madness',   fromZone: 'hand',
    description: 'When discarded, exile it; may cast it for its madness cost instead.' },
  { keyword: 'channel',   action: 'CHANNEL',        label: 'Channel',   fromZone: 'hand',
    description: 'Discard this card: activate the channel ability.' },
  { keyword: 'reinforce', action: 'REINFORCE',      label: 'Reinforce', fromZone: 'hand',
    description: 'Discard this card: put N +1/+1 counters on target creature.' },
  // Morph family
  { keyword: 'morph',     action: 'MORPH',          label: 'Cast Face-Down (Morph)', fromZone: 'hand',
    description: 'Cast face-down for {3} as a 2/2; pay morph cost to turn it face-up.' },
  { keyword: 'megamorph', action: 'MORPH',          label: 'Cast Face-Down (Megamorph)', fromZone: 'hand',
    description: 'Like morph, but gets a +1/+1 counter when turned face-up.' },
  { keyword: 'manifest',  action: 'MANIFEST',       label: 'Manifest', fromZone: 'library',
    description: 'Put face-down as a 2/2; if it\'s a creature, you may turn it face-up for its mana cost.' },
  // Equipment/Aura casting modes
  { keyword: 'equip',     action: 'EQUIP',          label: 'Equip',     fromZone: 'battlefield',
    description: 'Pay equip cost: attach this Equipment to target creature you control.' },
  { keyword: 'fortify',   action: 'FORTIFY',        label: 'Fortify',   fromZone: 'battlefield',
    description: 'Pay fortify cost: attach this Fortification to target land you control.' },
  { keyword: 'bestow',    action: 'CAST_FROM_GY',   label: 'Bestow',    fromZone: 'hand',
    description: 'Cast as an Aura for its bestow cost. Falls off if creature leaves battlefield.' },
  // Alternative costs
  { keyword: 'dash',      action: 'DASH',           label: 'Dash',      fromZone: 'hand',
    description: 'Cast for its dash cost: it enters with haste and returns to your hand at end of turn.' },
  { keyword: 'emerge',    action: 'EMERGE',         label: 'Emerge',    fromZone: 'hand',
    description: 'Sacrifice a creature; reduce emerge cost by that creature\'s CMC.' },
  { keyword: 'surge',     action: 'SURGE',          label: 'Surge',     fromZone: 'hand',
    description: 'If you or a teammate cast a spell this turn, you may cast this for its surge cost.' },
  { keyword: 'overload',  action: 'OVERLOAD',       label: 'Overload',  fromZone: 'hand',
    description: 'Pay overload cost instead: change "target" to "each" in the text.' },
  { keyword: 'buyback',   action: 'BUYBACK',        label: 'Buyback',   fromZone: 'hand',
    description: 'Pay buyback cost in addition to casting cost: put it back in your hand instead of graveyard.' },
  { keyword: 'kicker',    action: 'KICKER',         label: 'Kicker',    fromZone: 'hand',
    description: 'Optionally pay kicker cost when casting for an additional effect.' },
  { keyword: 'multikicker', action: 'KICKER',       label: 'Multikicker', fromZone: 'hand',
    description: 'Optionally pay kicker cost any number of times when casting.' },
  { keyword: 'spectacle', action: 'SPECTACLE',      label: 'Spectacle', fromZone: 'hand',
    description: 'If an opponent lost life this turn, you may cast this for its spectacle cost.' },
  { keyword: 'mutate',    action: 'MUTATE',         label: 'Mutate',    fromZone: 'hand',
    description: 'Cast for mutate cost: merge with target non-human creature you own. New creature has all abilities.' },
  // Crew / tap triggers
  { keyword: 'crew',      action: 'EQUIP',          label: 'Crew',      fromZone: 'battlefield',
    description: 'Tap any number of creatures with total power ≥ N: this Vehicle becomes an artifact creature.' },
  // Other notable keywords
  { keyword: 'conspire',  action: 'CONSPIRE',       label: 'Conspire',  fromZone: 'hand',
    description: 'As you cast this spell, tap two untapped creatures that share a color: copy the spell.' },
  { keyword: 'replicate', action: 'REPLICATE',      label: 'Replicate', fromZone: 'hand',
    description: 'Pay replicate cost any number of times: copy the spell once for each time paid.' },
  { keyword: 'haunt',     action: 'HAUNT',          label: 'Haunt',     fromZone: 'graveyard',
    description: 'When this goes to GY from anywhere: exile haunting a creature. When that creature dies, trigger.' },
  { keyword: 'champion',  action: 'CHAMPION',       label: 'Champion',  fromZone: 'battlefield',
    description: 'On ETB: exile another creature of a specified type you control. If the champion leaves, return it.' },
  { keyword: 'hideaway',  action: 'HIDEAWAY',       label: 'Hideaway',  fromZone: 'library',
    description: 'On ETB: look at top 4, exile one face-down. Other ability lets you cast/play that card.' },
  { keyword: 'offering',  action: 'OFFERING',       label: 'Offering',  fromZone: 'hand',
    description: 'You may cast this card any time you could cast an instant by sacrificing a creature of the specified type; reduce cost.' },
  { keyword: 'ninjutsu',  action: 'NINJUTSU',       label: 'Ninjutsu',  fromZone: 'hand',
    description: 'Return an unblocked attacker you control to hand: put this onto the battlefield from your hand tapped and attacking.' },
  { keyword: 'convoke',   action: 'CONVOKE',        label: 'Convoke',   fromZone: 'hand',
    description: 'Your creatures can help cast this spell. Each creature tapped while casting reduces cost by {1} or one mana of that creature\'s color.' },
  { keyword: 'improvise', action: 'IMPROVISE',      label: 'Improvise', fromZone: 'hand',
    description: 'Each artifact tapped while casting this spell reduces its cost by {1}.' },
  { keyword: 'exploit',   action: 'EXPLOIT',        label: 'Exploit',   fromZone: 'battlefield',
    description: 'On ETB: you may sacrifice a creature. "Whenever X exploits a creature" triggers if you do.' },
  { keyword: 'awaken',    action: 'AWAKEN',         label: 'Awaken',    fromZone: 'hand',
    description: 'Pay awaken cost instead of regular cost: put N +1/+1 counters on target land; it becomes a creature.' },
  { keyword: 'monstrosity', action: 'MONSTROSITY',  label: 'Monstrosity', fromZone: 'battlefield',
    description: 'Pay monstrosity cost: put N +1/+1 counters on this creature. It becomes monstrous.' },
  { keyword: 'tribute',   action: 'TRIBUTE',        label: 'Tribute',   fromZone: 'hand',
    description: 'As this enters: an opponent may put N +1/+1 counters on it. If they don\'t, trigger an effect.' },
  { keyword: 'level up',  action: 'LEVELUP',        label: 'Level Up',  fromZone: 'battlefield',
    description: 'Pay level up cost: put a level counter on this creature.' },
  { keyword: 'assist',    action: 'ASSIST',         label: 'Assist',    fromZone: 'hand',
    description: 'Another player may pay up to X generic mana of this spell\'s cost.' },
];

// Index for fast lookup
const TIER2_INDEX = new Map<string, KeywordMechanic>(
  TIER2_KEYWORDS.map(m => [m.keyword.toLowerCase(), m])
);

// ─── Tier 3: Oracle text patterns ────────────────────────────────────────────
// These are parsed on-demand from oracleText. Each pattern must be very specific
// to avoid false positives. Results are treated as suggestions / judge notes,
// NOT automatic engine actions.

export interface OraclePattern {
  id: string;
  pattern: RegExp;
  label: string;
  category: 'search-library' | 'cast-from-zone' | 'zone-change' | 'copy' | 'replacement' | 'trigger' | 'other';
  description: string;
}

export const TIER3_PATTERNS: OraclePattern[] = [
  // Search opponent's library
  { id: 'search-opp-library', pattern: /search (?:target )?opponent'?s? library/i,
    label: 'Search Opponent\'s Library',
    category: 'search-library',
    description: 'This card searches an opponent\'s library. Opponent shuffles after.' },
  // Play cards from GY this turn (Yawgmoth's Will style)
  { id: 'play-from-gy-turn', pattern: /(?:you may )?(?:play|cast) cards? from (?:your )?graveyard/i,
    label: 'Cast/Play from Graveyard (This Turn)',
    category: 'cast-from-zone',
    description: 'Cards in your graveyard can be played/cast as if they were in your hand this turn.' },
  // Take control of permanent (Bribery, Control Magic)
  { id: 'search-opp-bf-take', pattern: /search (?:target )?opponent'?s? (?:library|graveyard|hand).+?put (?:it|that card|a card) onto the battlefield/i,
    label: 'Steal from Opponent Zone',
    category: 'search-library',
    description: 'Searches an opponent\'s zone and puts a card directly onto the battlefield under your control.' },
  // Put card from library onto battlefield directly
  { id: 'library-to-bf', pattern: /search your library for (?:a|an|up to \w+) .+?(?:card|creature|land|artifact|enchantment).+?put (?:it|that card|them) onto the battlefield/i,
    label: 'Tutor → Battlefield',
    category: 'search-library',
    description: 'Searches your library and puts the found card directly onto the battlefield.' },
  // Tutor to hand
  { id: 'tutor-hand', pattern: /search your library for (?:a|an|up to \w+) .+?(?:card|creature|land).+?(?:put it into your hand|add it to your hand)/i,
    label: 'Tutor → Hand',
    category: 'search-library',
    description: 'Searches your library and puts the found card into your hand.' },
  // Tutor to top of library
  { id: 'tutor-top', pattern: /search your library for .+?put (?:that card|it) on top/i,
    label: 'Tutor → Top of Library',
    category: 'search-library',
    description: 'Searches your library and puts the found card on top.' },
  // Replacement: if it would go to GY, exile instead (Leyline of the Void / Yawgmoth's Will style)
  { id: 'gy-to-exile-replacement',
    pattern: /if (?:a )?card.+?would (?:be put|go) into (?:(?:a|your|their|an opponent'?s?|any) )?graveyard/is,
    label: 'Graveyard Replacement → Exile',
    category: 'replacement',
    description: 'Replaces cards going to graveyard with exile. Affects reanimation, flashback, etc.' },
  // Copy a spell on the stack
  { id: 'copy-spell', pattern: /copy (?:that|the|target|it) spell/i,
    label: 'Copy a Spell',
    category: 'copy',
    description: 'Creates a copy of a spell on the stack. The copy is not cast and does not trigger "when you cast".' },
  // Copy a permanent
  { id: 'copy-permanent', pattern: /copy (?:of )?target (?:creature|artifact|permanent|enchantment)/i,
    label: 'Copy a Permanent',
    category: 'copy',
    description: 'Creates a copy of a permanent on the battlefield.' },
  // Each player draws / discards (group draw / Wheel effects)
  { id: 'wheel-effect', pattern: /each player (?:draws|discards).+?(?:draws|discards)/i,
    label: 'Wheel Effect',
    category: 'trigger',
    description: 'Affects all players\' draw/discard simultaneously. Triggers any "whenever" effects for each player.' },
  // Cascade
  { id: 'cascade', pattern: /cascade/i,
    label: 'Cascade',
    category: 'cast-from-zone',
    description: 'Exile cards from top of library until you hit a nonland card with lesser CMC; cast it for free.' },
  // Storm
  { id: 'storm', pattern: /storm/i,
    label: 'Storm',
    category: 'copy',
    description: 'When you cast this, copy it for each spell cast before it this turn.' },
  // Cipher
  { id: 'cipher', pattern: /cipher/i,
    label: 'Cipher',
    category: 'cast-from-zone',
    description: 'Encode on a creature you control; whenever that creature deals combat damage, copy the encoded spell.' },
  // Miracle
  { id: 'miracle', pattern: /miracle/i,
    label: 'Miracle',
    category: 'cast-from-zone',
    description: 'If this is the first card you drew this turn, you may cast it for its miracle cost.' },
  // Transmute
  { id: 'transmute', pattern: /transmute/i,
    label: 'Transmute',
    category: 'search-library',
    description: 'Discard this card: search your library for a card with the same CMC, reveal it, put it in your hand.' },
  // Retrace
  { id: 'retrace', pattern: /retrace/i,
    label: 'Retrace',
    category: 'cast-from-zone',
    description: 'You may cast this from your graveyard by discarding a land card in addition to paying its other costs.' },
  // Recover
  { id: 'recover', pattern: /recover/i,
    label: 'Recover',
    category: 'cast-from-zone',
    description: 'When a creature is put into your graveyard, you may pay the recover cost to return this card from your graveyard to your hand.' },
  // Persist / Undying (ETB/death triggers)
  { id: 'persist', pattern: /persist/i,
    label: 'Persist',
    category: 'zone-change',
    description: 'When this dies with no -1/-1 counters, return it with a -1/-1 counter.' },
  { id: 'undying', pattern: /undying/i,
    label: 'Undying',
    category: 'zone-change',
    description: 'When this dies with no +1/+1 counters, return it with a +1/+1 counter.' },
  // Living Death / mass reanimate
  { id: 'mass-reanimate', pattern: /return all .+? from (?:all )?(?:graveyards?|your graveyard) to the battlefield/i,
    label: 'Mass Reanimate',
    category: 'zone-change',
    description: 'Returns multiple creatures from graveyard(s) to the battlefield simultaneously.' },
];

// ─── Resolution functions ─────────────────────────────────────────────────────

/**
 * Given a card definition, return all Tier 2 mechanics it has.
 */
export function getTier2Mechanics(def: CardDefinition): KeywordMechanic[] {
  return def.keywords
    .map(k => TIER2_INDEX.get(k.toLowerCase()))
    .filter((m): m is KeywordMechanic => m !== undefined);
}

/**
 * Given a card definition, return all Tier 3 oracle patterns that match.
 * Cached on the definition object to avoid repeated parsing.
 */
const tier3Cache = new Map<string, OraclePattern[]>();

export function getTier3Patterns(def: CardDefinition): OraclePattern[] {
  const cached = tier3Cache.get(def.id);
  if (cached) return cached;

  const text = (def.oracleText || '').toLowerCase();
  const results = TIER3_PATTERNS.filter(p => p.pattern.test(text));
  tier3Cache.set(def.id, results);
  return results;
}

/**
 * Get ALL mechanics for a card across all tiers.
 * Returns a unified list with tier info for UI display.
 */
export interface CardMechanic {
  tier: 1 | 2 | 3;
  key: string;
  label: string;
  description: string;
  action?: KeywordAction;
  fromZone?: string;
  category?: OraclePattern['category'];
}

export function getAllMechanics(def: CardDefinition): CardMechanic[] {
  const results: CardMechanic[] = [];

  // Tier 1 — check keywords array + oracle text for well-known keywords
  for (const kw of def.keywords) {
    const k = kw.toLowerCase();
    if (TIER1_MECHANICS.has(k)) {
      results.push({
        tier: 1,
        key: k,
        label: TIER1_LABELS[k] || kw,
        description: TIER2_INDEX.get(k)?.description || `${kw} is a popular evergreen mechanic.`,
        action: TIER2_INDEX.get(k)?.action,
        fromZone: TIER2_INDEX.get(k)?.fromZone,
      });
    }
  }

  // Tier 2 — keywords not in tier 1
  for (const m of getTier2Mechanics(def)) {
    if (!TIER1_MECHANICS.has(m.keyword)) {
      results.push({
        tier: 2,
        key: m.keyword,
        label: m.label,
        description: m.description,
        action: m.action,
        fromZone: m.fromZone,
      });
    }
  }

  // Tier 3 — oracle text patterns
  for (const p of getTier3Patterns(def)) {
    // Don't double-report something already covered by tier 1/2
    const alreadyCovered = results.some(r => r.key === p.id);
    if (!alreadyCovered) {
      results.push({
        tier: 3,
        key: p.id,
        label: p.label,
        description: p.description,
        category: p.category,
      });
    }
  }

  return results;
}

/**
 * Quick check: does a card have a specific popular mechanic?
 * Used by context menu to decide which action buttons to show.
 */
export function hasMechanic(def: CardDefinition, mechanic: string): boolean {
  const k = mechanic.toLowerCase();
  if (def.keywords.some(kw => kw.toLowerCase() === k)) return true;
  if (k === 'cycling' && /cycling/i.test(def.oracleText)) return true;
  return false;
}

/**
 * Returns the cycling cost string from oracle text if present.
 * e.g. "Cycling {2}" → "{2}"
 */
export function getCyclingCost(def: CardDefinition): string | null {
  const match = def.oracleText?.match(/cycling\s+(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  return match ? match[1] : null;
}

/**
 * Returns the flashback/escape/unearth cost from oracle text if present.
 */
export function getAlternateCastCost(def: CardDefinition, mechanic: string): string | null {
  const pattern = new RegExp(`${mechanic}\\s+(\\{[^}]+\\}(?:\\s*\\{[^}]+\\})*)`, 'i');
  const match = def.oracleText?.match(pattern);
  return match ? match[1] : null;
}
