// ─── Token Registry ───────────────────────────────────────────────────────────
//
// Maps well-known MTG card names → the token(s) they produce.
// Used by:
//   - CardContextMenu: "Create X Token" shortcut buttons on right-click
//   - NLP terminal: suggested commands when a token producer is on the battlefield
//   - NLP parser: shortcuts like "activate [card name]" or "make goblin token"
//
// Coverage tiers:
//   - Tier A: Very popular Commander staples (always show shortcut)
//   - Tier B: Common but not universal (show if card is on battlefield)
//   - Tier C: Niche — resolved from oracle text at runtime (see getTokensFromOracleText)
//
// Token definition shape matches gameEngine.createToken() parameters.

import type { ManaColor } from '../types/game';

export interface TokenDef {
  name: string;
  power: string;
  toughness: string;
  colors: ManaColor[];
  cardTypes: string[];
  subTypes: string[];
  keywords: string[];
  oracleText?: string;
  typeLine: string;
  isToken: true;
  // Optional display helpers
  colorLabel?: string;   // e.g. "White" for UI chip
  emoji?: string;        // quick visual in suggestion list
}

export interface CardTokenEntry {
  // How many tokens created by default (can be overridden by X/choosable)
  defaultCount: number;
  // If count is variable (X-cost, choose N, etc.)
  variableCount?: boolean;
  tokens: TokenDef[];
  // Short description for NLP suggestion
  hint: string;
  // Tier A = always suggest, B = on-battlefield only, C = runtime parse
  tier: 'A' | 'B' | 'C';
}

// ─── Shared token templates ───────────────────────────────────────────────────

const TREASURE: TokenDef = {
  name: 'Treasure', power: '0', toughness: '0',
  colors: [], cardTypes: ['Artifact'], subTypes: ['Treasure'], keywords: [],
  oracleText: '{T}, Sacrifice this artifact: Add one mana of any color.',
  typeLine: 'Artifact — Treasure', isToken: true, emoji: '💎',
};
const CLUE: TokenDef = {
  name: 'Clue', power: '0', toughness: '0',
  colors: [], cardTypes: ['Artifact'], subTypes: ['Clue'], keywords: [],
  oracleText: '{2}, Sacrifice this artifact: Draw a card.',
  typeLine: 'Artifact — Clue', isToken: true, emoji: '🔍',
};
const FOOD: TokenDef = {
  name: 'Food', power: '0', toughness: '0',
  colors: [], cardTypes: ['Artifact'], subTypes: ['Food'], keywords: [],
  oracleText: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
  typeLine: 'Artifact — Food', isToken: true, emoji: '🍎',
};
const BLOOD: TokenDef = {
  name: 'Blood', power: '0', toughness: '0',
  colors: [], cardTypes: ['Artifact'], subTypes: ['Blood'], keywords: [],
  oracleText: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.',
  typeLine: 'Artifact — Blood', isToken: true, emoji: '🩸',
};
const GOLD: TokenDef = {
  name: 'Gold', power: '0', toughness: '0',
  colors: [], cardTypes: ['Artifact'], subTypes: ['Gold'], keywords: [],
  oracleText: 'Sacrifice this artifact: Add one mana of any color.',
  typeLine: 'Artifact — Gold', isToken: true, emoji: '🪙',
};
const MAP: TokenDef = {
  name: 'Map', power: '0', toughness: '0',
  colors: [], cardTypes: ['Artifact'], subTypes: ['Map'], keywords: [],
  oracleText: '{1}, {T}, Sacrifice this artifact: Search your library for a basic land card, reveal it, put it into your hand, then shuffle.',
  typeLine: 'Artifact — Map', isToken: true, emoji: '🗺️',
};
const COPY = (name: string, colors: ManaColor[] = []): TokenDef => ({
  name: `${name} (copy)`, power: '*', toughness: '*',
  colors, cardTypes: ['Token'], subTypes: [], keywords: [],
  oracleText: `Copy of ${name}.`,
  typeLine: 'Token', isToken: true, emoji: '📋',
});

// Creature templates
const SOLDIER_W: TokenDef = { name: '1/1 White Soldier', power: '1', toughness: '1', colors: ['W'], cardTypes: ['Creature'], subTypes: ['Soldier'], keywords: [], typeLine: 'Token Creature — Soldier', isToken: true, emoji: '⚔️' };
const ZOMBIE_B: TokenDef = { name: '2/2 Black Zombie', power: '2', toughness: '2', colors: ['B'], cardTypes: ['Creature'], subTypes: ['Zombie'], keywords: [], typeLine: 'Token Creature — Zombie', isToken: true, emoji: '🧟' };
const ZOMBIE_B_DECAYED: TokenDef = { name: '2/2 Black Zombie (Decayed)', power: '2', toughness: '2', colors: ['B'], cardTypes: ['Creature'], subTypes: ['Zombie'], keywords: ['Decayed'], oracleText: "Decayed (This creature can't block. When it attacks, sacrifice it at end of combat.)", typeLine: 'Token Creature — Zombie', isToken: true, emoji: '🧟' };
const GOBLIN_R: TokenDef = { name: '1/1 Red Goblin', power: '1', toughness: '1', colors: ['R'], cardTypes: ['Creature'], subTypes: ['Goblin'], keywords: [], typeLine: 'Token Creature — Goblin', isToken: true, emoji: '👺' };
const ELF_G: TokenDef = { name: '1/1 Green Elf', power: '1', toughness: '1', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Elf'], keywords: [], typeLine: 'Token Creature — Elf', isToken: true, emoji: '🧝' };
const ELDRAZI_SCION: TokenDef = { name: '1/1 Colorless Eldrazi Scion', power: '1', toughness: '1', colors: [], cardTypes: ['Creature'], subTypes: ['Eldrazi', 'Scion'], keywords: [], oracleText: 'Sacrifice this creature: Add {C}.', typeLine: 'Token Creature — Eldrazi Scion', isToken: true, emoji: '👾' };
const ELDRAZI_SPAWN: TokenDef = { name: '0/1 Colorless Eldrazi Spawn', power: '0', toughness: '1', colors: [], cardTypes: ['Creature'], subTypes: ['Eldrazi', 'Spawn'], keywords: [], oracleText: 'Sacrifice this creature: Add {C}.', typeLine: 'Token Creature — Eldrazi Spawn', isToken: true, emoji: '👾' };
const SPIRIT_W: TokenDef = { name: '1/1 White Spirit (Flying)', power: '1', toughness: '1', colors: ['W'], cardTypes: ['Creature'], subTypes: ['Spirit'], keywords: ['Flying'], typeLine: 'Token Creature — Spirit', isToken: true, emoji: '👻' };
const SPIRIT_WB: TokenDef = { name: '1/1 White/Black Spirit (Flying)', power: '1', toughness: '1', colors: ['W', 'B'], cardTypes: ['Creature'], subTypes: ['Spirit'], keywords: ['Flying'], typeLine: 'Token Creature — Spirit', isToken: true, emoji: '👻' };
const BIRD_W: TokenDef = { name: '1/1 White Bird (Flying)', power: '1', toughness: '1', colors: ['W'], cardTypes: ['Creature'], subTypes: ['Bird'], keywords: ['Flying'], typeLine: 'Token Creature — Bird', isToken: true, emoji: '🐦' };
const ANGEL_W: TokenDef = { name: '4/4 White Angel (Flying)', power: '4', toughness: '4', colors: ['W'], cardTypes: ['Creature'], subTypes: ['Angel'], keywords: ['Flying'], typeLine: 'Token Creature — Angel', isToken: true, emoji: '😇' };
const DRAGON_R: TokenDef = { name: '5/5 Red Dragon (Flying)', power: '5', toughness: '5', colors: ['R'], cardTypes: ['Creature'], subTypes: ['Dragon'], keywords: ['Flying'], typeLine: 'Token Creature — Dragon', isToken: true, emoji: '🐉' };
const WOLF_G: TokenDef = { name: '2/2 Green Wolf', power: '2', toughness: '2', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Wolf'], keywords: [], typeLine: 'Token Creature — Wolf', isToken: true, emoji: '🐺' };
const BEAR_G: TokenDef = { name: '2/2 Green Bear', power: '2', toughness: '2', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Bear'], keywords: [], typeLine: 'Token Creature — Bear', isToken: true, emoji: '🐻' };
const SAPROLING_G: TokenDef = { name: '1/1 Green Saproling', power: '1', toughness: '1', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Saproling'], keywords: [], typeLine: 'Token Creature — Saproling', isToken: true, emoji: '🍄' };
const SNAKE_G: TokenDef = { name: '1/1 Green Snake', power: '1', toughness: '1', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Snake'], keywords: [], typeLine: 'Token Creature — Snake', isToken: true, emoji: '🐍' };
const INSECT_G: TokenDef = { name: '1/1 Green Insect', power: '1', toughness: '1', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Insect'], keywords: [], typeLine: 'Token Creature — Insect', isToken: true, emoji: '🐛' };
const SQUIRREL_G: TokenDef = { name: '1/1 Green Squirrel', power: '1', toughness: '1', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Squirrel'], keywords: [], typeLine: 'Token Creature — Squirrel', isToken: true, emoji: '🐿️' };
const CAT_W: TokenDef = { name: '2/2 White Cat', power: '2', toughness: '2', colors: ['W'], cardTypes: ['Creature'], subTypes: ['Cat'], keywords: [], typeLine: 'Token Creature — Cat', isToken: true, emoji: '🐱' };
const HUMAN_W: TokenDef = { name: '1/1 White Human', power: '1', toughness: '1', colors: ['W'], cardTypes: ['Creature'], subTypes: ['Human'], keywords: [], typeLine: 'Token Creature — Human', isToken: true, emoji: '🧑' };
const KNIGHT_W: TokenDef = { name: '2/2 White Knight (Vigilance)', power: '2', toughness: '2', colors: ['W'], cardTypes: ['Creature'], subTypes: ['Knight'], keywords: ['Vigilance'], typeLine: 'Token Creature — Knight', isToken: true, emoji: '🏇' };
const KNIGHT_WB: TokenDef = { name: '2/2 White/Black Knight (Vigilance)', power: '2', toughness: '2', colors: ['W', 'B'], cardTypes: ['Creature'], subTypes: ['Knight'], keywords: ['Vigilance'], typeLine: 'Token Creature — Knight', isToken: true, emoji: '🏇' };
const THOPTER_WU: TokenDef = { name: '1/1 Colorless Thopter (Flying)', power: '1', toughness: '1', colors: [], cardTypes: ['Artifact', 'Creature'], subTypes: ['Thopter'], keywords: ['Flying'], typeLine: 'Artifact Token Creature — Thopter', isToken: true, emoji: '✈️' };
const COPY_ARTIFACT: TokenDef = { name: '0/0 Colorless Construct', power: '0', toughness: '0', colors: [], cardTypes: ['Artifact', 'Creature'], subTypes: ['Construct'], keywords: [], typeLine: 'Artifact Token Creature — Construct', isToken: true, emoji: '🤖' };
const WURM_G: TokenDef = { name: '3/3 Green Wurm', power: '3', toughness: '3', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Wurm'], keywords: [], typeLine: 'Token Creature — Wurm', isToken: true, emoji: '🐛' };
const ZOMBIE_ARMY: TokenDef = { name: '0/0 Black Zombie Army', power: '0', toughness: '0', colors: ['B'], cardTypes: ['Creature'], subTypes: ['Zombie', 'Army'], keywords: [], typeLine: 'Token Creature — Zombie Army', isToken: true, emoji: '🧟' };
const PIRATE_B: TokenDef = { name: '2/2 Black Pirate (Menace)', power: '2', toughness: '2', colors: ['B'], cardTypes: ['Creature'], subTypes: ['Pirate'], keywords: ['Menace'], typeLine: 'Token Creature — Pirate', isToken: true, emoji: '🏴‍☠️' };
const DINOSAUR_G: TokenDef = { name: '3/3 Green Dinosaur', power: '3', toughness: '3', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Dinosaur'], keywords: [], typeLine: 'Token Creature — Dinosaur', isToken: true, emoji: '🦕' };
const COPY_BLUE_CREATURE: TokenDef = { name: 'Creature Token (Copy)', power: '*', toughness: '*', colors: ['U'], cardTypes: ['Creature'], subTypes: [], keywords: [], oracleText: 'Copy of target creature.', typeLine: 'Token Creature', isToken: true, emoji: '📋' };
const ILLUSION_U: TokenDef = { name: '1/1 Blue Illusion (Flying)', power: '1', toughness: '1', colors: ['U'], cardTypes: ['Creature'], subTypes: ['Illusion'], keywords: ['Flying'], typeLine: 'Token Creature — Illusion', isToken: true, emoji: '💭' };
const MERFOLK_U: TokenDef = { name: '1/1 Blue Merfolk', power: '1', toughness: '1', colors: ['U'], cardTypes: ['Creature'], subTypes: ['Merfolk'], keywords: [], typeLine: 'Token Creature — Merfolk', isToken: true, emoji: '🧜' };
const SHARK_U: TokenDef = { name: '3/3 Blue Shark (Flying)', power: '3', toughness: '3', colors: ['U'], cardTypes: ['Creature'], subTypes: ['Shark'], keywords: ['Flying'], typeLine: 'Token Creature — Shark', isToken: true, emoji: '🦈' };
const FAERIE_U: TokenDef = { name: '1/1 Blue Faerie (Flying)', power: '1', toughness: '1', colors: ['U'], cardTypes: ['Creature'], subTypes: ['Faerie'], keywords: ['Flying'], typeLine: 'Token Creature — Faerie', isToken: true, emoji: '🧚' };
const INCUBATOR: TokenDef = { name: 'Incubator', power: '0', toughness: '0', colors: [], cardTypes: ['Artifact'], subTypes: ['Incubator'], keywords: [], oracleText: '{2}: Transform this artifact. (It becomes a 0/0 Phyrexian artifact creature with +1/+1 counters on it.)', typeLine: 'Artifact — Incubator', isToken: true, emoji: '🥚' };
const RHINO_W: TokenDef = { name: '4/4 Green Rhino (Trample)', power: '4', toughness: '4', colors: ['G', 'W'], cardTypes: ['Creature'], subTypes: ['Rhino'], keywords: ['Trample'], typeLine: 'Token Creature — Rhino', isToken: true, emoji: '🦏' };
const WARRIOR_R: TokenDef = { name: '1/1 White/Black/Red Warrior (Haste)', power: '1', toughness: '1', colors: ['W', 'B', 'R'], cardTypes: ['Creature'], subTypes: ['Warrior'], keywords: ['Haste'], typeLine: 'Token Creature — Warrior', isToken: true, emoji: '⚔️' };

// ─── Registry: card name → token entry ───────────────────────────────────────
// Keys are lowercased, normalized card names for fast lookup.
// Multiple entries for double-faced cards / variants.

export const TOKEN_REGISTRY: Record<string, CardTokenEntry> = {

  // ── Artifact tokens ────────────────────────────────────────────────────────

  'smothering tithe': {
    defaultCount: 1, tokens: [TREASURE],
    hint: 'Create 1 Treasure token (each opponent who draws without paying {2})',
    tier: 'A',
  },
  'goldspan dragon': {
    defaultCount: 1, tokens: [TREASURE],
    hint: 'Create 1 Treasure when it attacks or becomes targeted',
    tier: 'A',
  },
  'magda, brazen outlaw': {
    defaultCount: 1, tokens: [TREASURE],
    hint: 'Create 1 Treasure when a Dwarf you control becomes tapped',
    tier: 'A',
  },
  'pitiless plunderer': {
    defaultCount: 1, tokens: [TREASURE],
    hint: 'Create 1 Treasure when a creature you control dies',
    tier: 'A',
  },
  'revel in riches': {
    defaultCount: 1, tokens: [TREASURE],
    hint: 'Create 1 Treasure when an opponent\'s creature dies',
    tier: 'A',
  },
  'dockside extortionist': {
    defaultCount: 1, variableCount: true, tokens: [TREASURE],
    hint: 'Create X Treasure tokens (X = opponent artifacts/enchantments)',
    tier: 'A',
  },
  'academy manufactor': {
    defaultCount: 1, tokens: [TREASURE, CLUE, FOOD],
    hint: 'Create a Clue, Food, AND Treasure whenever you would create one of them',
    tier: 'A',
  },
  "galazeth prismari": {
    defaultCount: 1, tokens: [TREASURE],
    hint: 'Create 1 Treasure when Galazeth enters the battlefield',
    tier: 'B',
  },
  'tireless tracker': {
    defaultCount: 1, tokens: [CLUE],
    hint: 'Create 1 Clue whenever a land enters under your control',
    tier: 'A',
  },
  'alela, artful provocateur': {
    defaultCount: 1, tokens: [FAERIE_U],
    hint: 'Create 1/1 Faerie whenever you cast an artifact or enchantment spell',
    tier: 'A',
  },
  'march of the machines': {
    defaultCount: 0, tokens: [],
    hint: 'Ongoing: artifact tokens become creatures (no direct token creation)',
    tier: 'B',
  },
  'thopter spy network': {
    defaultCount: 1, tokens: [THOPTER_WU],
    hint: 'Create 1 Thopter token at your upkeep if you control an artifact',
    tier: 'B',
  },
  'thopter foundry': {
    defaultCount: 1, tokens: [THOPTER_WU],
    hint: 'Sacrifice an artifact: Create 1 Thopter + gain 1 life',
    tier: 'B',
  },
  'breya, etherium shaper': {
    defaultCount: 2, tokens: [THOPTER_WU, THOPTER_WU],
    hint: 'Create 2 Thopter tokens when Breya enters the battlefield',
    tier: 'A',
  },

  // ── White token producers ──────────────────────────────────────────────────

  'adeline, resplendent cathar': {
    defaultCount: 1, variableCount: true, tokens: [HUMAN_W],
    hint: 'Create a 1/1 Human whenever you attack (one per opponent attacked)',
    tier: 'A',
  },
  'elspeth, sun\'s champion': {
    defaultCount: 3, tokens: [SOLDIER_W, SOLDIER_W, SOLDIER_W],
    hint: '[+1] Create 3 1/1 White Soldier tokens',
    tier: 'A',
  },
  'elspeth tirel': {
    defaultCount: 3, tokens: [SOLDIER_W, SOLDIER_W, SOLDIER_W],
    hint: '[+2] Create 3 1/1 White Soldier tokens',
    tier: 'B',
  },
  'elspeth, knight-errant': {
    defaultCount: 1, tokens: [SOLDIER_W],
    hint: '[+1] Create 1 1/1 White Soldier token',
    tier: 'B',
  },
  'assemble the legion': {
    defaultCount: 1, variableCount: true, tokens: [SOLDIER_W],
    hint: 'Add a Muster counter each upkeep, create that many 1/1 Soldiers',
    tier: 'B',
  },
  'decree of justice': {
    defaultCount: 1, variableCount: true, tokens: [ANGEL_W],
    hint: 'Create X 4/4 Angel tokens (or cycle for X 1/1 Soldiers)',
    tier: 'A',
  },
  'dawn of hope': {
    defaultCount: 1, tokens: [SOLDIER_W],
    hint: '{3}{W}: Create a 1/1 White Soldier token',
    tier: 'B',
  },
  'cathars\' crusade': {
    defaultCount: 0, tokens: [],
    hint: 'Ongoing: puts +1/+1 counters on creatures when any creature enters (not a token creator)',
    tier: 'B',
  },
  'anointed procession': {
    defaultCount: 0, tokens: [],
    hint: 'Replacement: doubles tokens you create (not a direct creator — use with another card)',
    tier: 'A',
  },
  'parallel lives': {
    defaultCount: 0, tokens: [],
    hint: 'Replacement: doubles tokens you create (not a direct creator — use with another card)',
    tier: 'A',
  },
  'doubling season': {
    defaultCount: 0, tokens: [],
    hint: 'Replacement: doubles tokens AND counters you create',
    tier: 'A',
  },
  'mondrak, glory dominus': {
    defaultCount: 0, tokens: [],
    hint: 'Replacement: doubles tokens you create',
    tier: 'A',
  },
  'jetmir\'s garden': {
    defaultCount: 0, tokens: [],
    hint: 'Land — no token creation',
    tier: 'B',
  },
  'luminarch ascension': {
    defaultCount: 1, tokens: [ANGEL_W],
    hint: '{1}{W}: Create a 4/4 White Angel (Flying) token (after quest counters)',
    tier: 'A',
  },
  'entreat the angels': {
    defaultCount: 1, variableCount: true, tokens: [ANGEL_W],
    hint: 'Create X 4/4 White Angel tokens',
    tier: 'A',
  },
  'sigarda\'s aid': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — flash auras/equipment',
    tier: 'B',
  },
  'paladin class': {
    defaultCount: 1, tokens: [KNIGHT_W],
    hint: 'Level 2: Create a 2/2 White Knight (Vigilance) at your end step',
    tier: 'B',
  },
  'hero of bladehold': {
    defaultCount: 2, tokens: [SOLDIER_W, SOLDIER_W],
    hint: 'Create 2 1/1 White Soldier tokens whenever Hero attacks',
    tier: 'B',
  },
  'captain of the watch': {
    defaultCount: 3, tokens: [SOLDIER_W, SOLDIER_W, SOLDIER_W],
    hint: 'Create 3 1/1 Soldier tokens when Captain enters',
    tier: 'B',
  },

  // ── Black token producers ──────────────────────────────────────────────────

  'grave titan': {
    defaultCount: 2, tokens: [ZOMBIE_B, ZOMBIE_B],
    hint: 'Create 2 2/2 Black Zombie tokens when Grave Titan attacks or ETBs',
    tier: 'A',
  },
  'ghoulcaller gisa': {
    defaultCount: 1, variableCount: true, tokens: [ZOMBIE_B],
    hint: '{B}, {T}, Sacrifice a creature: Create X 2/2 Zombie tokens (X = creature\'s power)',
    tier: 'A',
  },
  'undead augur': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — draws cards when Zombies die',
    tier: 'B',
  },
  'liliana, dreadhorde general': {
    defaultCount: 1, tokens: [ZOMBIE_B],
    hint: '[+1] Create 1 2/2 Black Zombie token',
    tier: 'A',
  },
  'liliana of the dark realms': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — library search / -X effect',
    tier: 'B',
  },
  'wilhelt, the rotcleaver': {
    defaultCount: 1, tokens: [ZOMBIE_B_DECAYED],
    hint: 'Create a 2/2 Zombie (Decayed) when a non-Decayed Zombie dies',
    tier: 'A',
  },
  'rooftop storm': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — free Zombie casting',
    tier: 'B',
  },
  'blood artist': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — triggers on creature death',
    tier: 'B',
  },
  'ophiomancer': {
    defaultCount: 1, tokens: [SNAKE_G],
    hint: 'Create a 1/1 black Snake with deathtouch at each upkeep if you control no Snakes',
    tier: 'B',
  },
  'endrek sahr, master breeder': {
    defaultCount: 1, variableCount: true, tokens: [ZOMBIE_B],
    hint: 'Create X Thrull tokens when you cast a creature (X = CMC)',
    tier: 'B',
  },
  'ayara, first of locthwain': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — drains life when black creatures ETB',
    tier: 'B',
  },

  // ── Red token producers ────────────────────────────────────────────────────

  'krenko, mob boss': {
    defaultCount: 1, variableCount: true, tokens: [GOBLIN_R],
    hint: '{T}: Create X 1/1 Goblin tokens (X = Goblins you control)',
    tier: 'A',
  },
  'goblin rabblemaster': {
    defaultCount: 1, tokens: [GOBLIN_R],
    hint: 'Create 1 1/1 Goblin token at the beginning of combat',
    tier: 'A',
  },
  'siege-gang commander': {
    defaultCount: 3, tokens: [GOBLIN_R, GOBLIN_R, GOBLIN_R],
    hint: 'Create 3 1/1 Goblin tokens when Siege-Gang enters',
    tier: 'A',
  },
  'dragon broodmother': {
    defaultCount: 1, tokens: [DRAGON_R],
    hint: 'Create a 1/1 Dragon (Flying) token at each upkeep',
    tier: 'B',
  },
  'utvara hellkite': {
    defaultCount: 1, tokens: [DRAGON_R],
    hint: 'Create a 6/6 Dragon token whenever a Dragon you control attacks',
    tier: 'A',
  },
  'scourge of valkas': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — deals damage when Dragons ETB',
    tier: 'B',
  },
  'chaos warp': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation',
    tier: 'B',
  },
  'rabble-rouser': {
    defaultCount: 1, tokens: [GOBLIN_R],
    hint: 'Create 1/1 Goblin at beginning of each combat',
    tier: 'B',
  },
  'pashalik mons': {
    defaultCount: 0, tokens: [],
    hint: 'No tokens — drains life',
    tier: 'B',
  },

  // ── Green token producers ──────────────────────────────────────────────────

  'avenger of zendikar': {
    defaultCount: 1, variableCount: true, tokens: [{ ...SAPROLING_G, name: '0/1 Green Plant', subTypes: ['Plant'] }],
    hint: 'Create X 0/1 Plant tokens (X = lands you control)',
    tier: 'A',
  },
  'tendershoot dryad': {
    defaultCount: 1, tokens: [SAPROLING_G],
    hint: 'Create a 1/1 Saproling at each player\'s upkeep (if City\'s Blessing)',
    tier: 'A',
  },
  'mycoloth': {
    defaultCount: 1, variableCount: true, tokens: [SAPROLING_G],
    hint: 'Create X 1/1 Saproling tokens at upkeep (X = Devour counters)',
    tier: 'A',
  },
  'green sun\'s twilight': {
    defaultCount: 1, variableCount: true, tokens: [SAPROLING_G],
    hint: 'Create X 1/1 Saprolings if X is odd',
    tier: 'B',
  },
  'chatterfang, squirrel general': {
    defaultCount: 1, variableCount: true, tokens: [SQUIRREL_G],
    hint: 'Create X additional Squirrel tokens whenever you create X tokens',
    tier: 'A',
  },
  'deranged hermit': {
    defaultCount: 4, tokens: [SQUIRREL_G, SQUIRREL_G, SQUIRREL_G, SQUIRREL_G],
    hint: 'Create 4 1/1 Squirrel tokens when Deranged Hermit enters',
    tier: 'B',
  },
  'nissa, who shakes the world': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — animates lands',
    tier: 'B',
  },
  'garruk wildspeaker': {
    defaultCount: 1, tokens: [WOLF_G],
    hint: '[+1] Create 2 1/1 Wolf tokens',
    tier: 'A',
  },
  'garruk, primal hunter': {
    defaultCount: 3, tokens: [WOLF_G, WOLF_G, WOLF_G],
    hint: '[0]: Create a 3/3 Beast token  [+1]: Draw cards equal to greatest power',
    tier: 'B',
  },
  'garruk, caller of beasts': {
    defaultCount: 3, variableCount: false, tokens: [{ name: '3/3 Green Beast', power: '3', toughness: '3', colors: ['G'], cardTypes: ['Creature'], subTypes: ['Beast'], keywords: [], typeLine: 'Token Creature — Beast', isToken: true, emoji: '🦁' }],
    hint: '[-3]: Create a 3/3 Beast token',
    tier: 'B',
  },
  'rhys the redeemed': {
    defaultCount: 1, tokens: [ELF_G],
    hint: '{G}: Create a 1/1 Elf  {4}{G}{W}: Copy each token you control',
    tier: 'A',
  },
  'ezuri, renegade leader': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — regenerates Elves or overruns',
    tier: 'B',
  },

  // ── Blue token producers ───────────────────────────────────────────────────

  'murmuring mystic': {
    defaultCount: 1, tokens: [BIRD_W],
    hint: 'Create a 1/1 white Bird (Flying) token whenever you cast an instant/sorcery',
    tier: 'A',
  },
  'talrand, sky summoner': {
    defaultCount: 1, tokens: [ILLUSION_U],
    hint: 'Create a 2/2 Blue Drake (Flying) whenever you cast an instant or sorcery',
    tier: 'A',
  },
  'metallurgic summonings': {
    defaultCount: 1, variableCount: true, tokens: [COPY_ARTIFACT],
    hint: 'Create an X/X Construct whenever you cast an instant/sorcery (X = CMC)',
    tier: 'A',
  },
  'teferi, master of time': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — phase out/draw',
    tier: 'B',
  },
  'jace, architect of thought': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation',
    tier: 'B',
  },
  'ominous seas': {
    defaultCount: 1, tokens: [SHARK_U],
    hint: 'Create an 8/8 Kraken when you\'ve drawn 8 cards (clears counters)',
    tier: 'B',
  },

  // ── Multicolor token producers ─────────────────────────────────────────────

  'ghired, conclave exile': {
    defaultCount: 1, tokens: [RHINO_W],
    hint: 'Create a 4/4 Rhino (Trample) when Ghired enters, then populates on attack',
    tier: 'A',
  },
  'trostani, selesnya\'s voice': {
    defaultCount: 0, tokens: [],
    hint: 'No direct token creation — gains life and populates',
    tier: 'A',
  },
  'emmara, soul of the accord': {
    defaultCount: 1, tokens: [SOLDIER_W],
    hint: 'Create a 1/1 white Soldier whenever Emmara becomes tapped',
    tier: 'A',
  },
  'queasy orb': {
    defaultCount: 1, tokens: [ZOMBIE_B],
    hint: 'Creates 2/2 zombie tokens',
    tier: 'B',
  },
  'najeela, the blade-blossom': {
    defaultCount: 1, tokens: [WARRIOR_R],
    hint: 'Create a 1/1 Warrior token attacking whenever a Warrior deals combat damage',
    tier: 'A',
  },
  'syr gwyn, hero of ashvale': {
    defaultCount: 0, tokens: [],
    hint: 'No direct token creation — equipment draw/Knights',
    tier: 'B',
  },
  'judith, the scourge diva': {
    defaultCount: 0, tokens: [],
    hint: 'No direct token creation — non-token creature death pings',
    tier: 'B',
  },
  'purphoros, god of the forge': {
    defaultCount: 0, tokens: [],
    hint: 'No direct token creation — deals 2 damage per ETB',
    tier: 'B',
  },

  // ── Eldrazi & Colorless ────────────────────────────────────────────────────

  'emrakul, the aeons torn': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation',
    tier: 'B',
  },
  'kozilek, butcher of truth': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation',
    tier: 'B',
  },
  'ulamog, the infinite gyre': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation',
    tier: 'B',
  },
  'blight herder': {
    defaultCount: 3, tokens: [ELDRAZI_SCION, ELDRAZI_SCION, ELDRAZI_SCION],
    hint: 'Create 3 1/1 Eldrazi Scion tokens when cast with Processor ability',
    tier: 'B',
  },
  'eldrazi displacer': {
    defaultCount: 0, tokens: [],
    hint: 'No token creation — blinks permanents',
    tier: 'B',
  },

  // ── Copy / Clone mechanics ─────────────────────────────────────────────────

  'irenicus\'s vile duplication': {
    defaultCount: 1, tokens: [COPY_BLUE_CREATURE],
    hint: 'Create a token copy of target non-legendary creature',
    tier: 'B',
  },
  'mimic vat': {
    defaultCount: 1, tokens: [COPY_BLUE_CREATURE],
    hint: '{3}: Create a token copy of imprinted card. Exile at end of turn.',
    tier: 'A',
  },
  'splinter twin': {
    defaultCount: 1, tokens: [COPY_BLUE_CREATURE],
    hint: '{T}: Create a token copy of enchanted creature with haste; exile at end step',
    tier: 'A',
  },
  'rite of replication': {
    defaultCount: 1, tokens: [COPY_BLUE_CREATURE],
    hint: 'Create a token copy of target creature (kicked: 5 copies)',
    tier: 'A',
  },
  'helm of the host': {
    defaultCount: 1, tokens: [COPY_BLUE_CREATURE],
    hint: 'At beginning of combat, create a non-legendary copy of equipped creature',
    tier: 'A',
  },
  'cackling counterpart': {
    defaultCount: 1, tokens: [COPY_BLUE_CREATURE],
    hint: 'Create a token copy of target creature you control',
    tier: 'B',
  },
  'follow the leader': {
    defaultCount: 1, tokens: [COPY_BLUE_CREATURE],
    hint: 'Create a token copy of target commander or legend entering play',
    tier: 'B',
  },
  'minion reflector': {
    defaultCount: 1, tokens: [COPY_BLUE_CREATURE],
    hint: '{2}: When a non-token creature enters under your control, create a copy',
    tier: 'B',
  },
};

// ─── Alias index (normalized card name → registry key) ───────────────────────
// Handles "Elspeth" → "elspeth, sun's champion" etc.

const ALIAS_MAP: Record<string, string> = {
  'elspeth': "elspeth, sun's champion",
  'garruk': 'garruk wildspeaker',
  'liliana': 'liliana, dreadhorde general',
  'krenko': 'krenko, mob boss',
  'gisa': 'ghoulcaller gisa',
  'talrand': 'talrand, sky summoner',
  'avenger': 'avenger of zendikar',
  'tendershoot': 'tendershoot dryad',
  'smothering': 'smothering tithe',
  'grave titan': 'grave titan',
  'goblin rabblemaster': 'goblin rabblemaster',
  'rhys': 'rhys the redeemed',
  'emmara': 'emmara, soul of the accord',
  'najeela': 'najeela, the blade-blossom',
  'ghired': 'ghired, conclave exile',
  'wilhelt': 'wilhelt, the rotcleaver',
  'helm of the host': 'helm of the host',
  'splinter twin': 'splinter twin',
  'mimic vat': 'mimic vat',
  'chatterfang': 'chatterfang, squirrel general',
  'luminarch': 'luminarch ascension',
};

// ─── Lookup functions ─────────────────────────────────────────────────────────

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ',\-]/g, '').trim();
}

/**
 * Look up token entry for a card by name.
 * Checks exact match first, then alias map.
 */
export function getTokenEntry(cardName: string): CardTokenEntry | null {
  const key = normalize(cardName);
  if (TOKEN_REGISTRY[key]) return TOKEN_REGISTRY[key];
  const alias = ALIAS_MAP[key];
  if (alias && TOKEN_REGISTRY[alias]) return TOKEN_REGISTRY[alias];
  return null;
}

/**
 * Given a set of battlefield card names, return all token suggestions for the
 * NLP terminal. Returns tier-A always, tier-B only for on-battlefield cards.
 */
export function getBattlefieldTokenSuggestions(
  battlefieldCardNames: string[]
): Array<{ cardName: string; entry: CardTokenEntry }> {
  const results: Array<{ cardName: string; entry: CardTokenEntry }> = [];
  for (const name of battlefieldCardNames) {
    const entry = getTokenEntry(name);
    if (!entry || entry.defaultCount === 0) continue;
    results.push({ cardName: name, entry });
  }
  return results;
}

/**
 * Parse a token from oracle text as a last resort (Tier C).
 * Returns a best-effort TokenDef array or empty array.
 */
export function getTokensFromOracleText(oracleText: string): TokenDef[] {
  const tokens: TokenDef[] = [];
  const text = oracleText.toLowerCase();

  // Treasure
  if (/create.+treasure token/.test(text)) tokens.push(TREASURE);
  // Clue
  if (/create.+clue token/.test(text)) tokens.push(CLUE);
  // Food
  if (/create.+food token/.test(text)) tokens.push(FOOD);
  // Blood
  if (/create.+blood token/.test(text)) tokens.push(BLOOD);
  // Generic P/T creature token: "create a X/X [color] [subtype] creature token"
  const ptMatch = text.match(/create (?:a |an )?(?:\w+ )?(\d+)\/(\d+) ([a-z]+) ([a-z]+) (?:creature )?token/);
  if (ptMatch) {
    tokens.push({
      name: `${ptMatch[1]}/${ptMatch[2]} ${ptMatch[4]}`,
      power: ptMatch[1], toughness: ptMatch[2],
      colors: [], cardTypes: ['Creature'],
      subTypes: [ptMatch[4].charAt(0).toUpperCase() + ptMatch[4].slice(1)],
      keywords: [], typeLine: `Token Creature — ${ptMatch[4].charAt(0).toUpperCase() + ptMatch[4].slice(1)}`,
      isToken: true,
    });
  }
  return tokens;
}

/**
 * Quick NLP shortcuts: "create [card] token" or "activate [card]"
 * Returns the token entry if the card name is recognized.
 */
export function resolveTokenShortcut(input: string): {
  cardName: string;
  entry: CardTokenEntry;
  count: number;
} | null {
  const lower = input.toLowerCase();
  // "create token from [cardname]" / "make [cardname] token" / "activate [cardname]"
  const patterns = [
    /^(?:create|make|generate)\s+(?:a\s+)?token\s+(?:from|with|for)\s+(.+)$/,
    /^activate\s+(.+?)(?:\s+ability)?$/,
    /^(.+?)\s+(?:creates?|makes?|generates?)\s+(?:a\s+)?token$/,
    /^(?:create|make)\s+(.+?)\s+token$/,
  ];
  for (const p of patterns) {
    const m = lower.match(p);
    if (m) {
      const cardName = m[1].trim();
      const entry = getTokenEntry(cardName);
      if (entry && entry.defaultCount > 0) {
        return { cardName, entry, count: entry.defaultCount };
      }
    }
  }
  return null;
}
