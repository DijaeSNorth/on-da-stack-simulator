import type { CardState } from '../../types/game';
import { getMechanicsForCard } from '../../rules/mechanicsRegistry';
import { defaultRuleset } from '../../rules/defaultRuleset';
import type { RulesetDefinition } from '../../rules/mechanicTypes';

export type KeywordIconId =
  | 'deathtouch'
  | 'double_strike'
  | 'first_strike'
  | 'menace'
  | 'flying'
  | 'reach'
  | 'trample'
  | 'lifelink'
  | 'vigilance'
  | 'haste'
  | 'hexproof'
  | 'ward'
  | 'indestructible'
  | 'protection'
  | 'defender'
  | 'flash'
  | 'prowess'
  | 'toxic'
  | 'infect'
  | 'wither'
  | 'firebending'
  | 'airbend'
  | 'waterbend'
  | 'earthbend'
  | 'warp'
  | 'sneak'
  | 'exhaust'
  | 'station'
  | 'class'
  | 'clue'
  | 'treasure'
  | 'food'
  | 'blood'
  | 'map'
  | 'lander'
  | 'mutagen'
  | 'manual'
  | 'unknown';

export type KeywordIconCategory =
  | 'combat'
  | 'evasion'
  | 'protection'
  | 'speed'
  | 'resource'
  | 'mechanic'
  | 'token'
  | 'manual';

export interface ExternalIconAttribution {
  source: 'local' | 'game-icons.net' | 'custom';
  author?: string;
  license?: string;
  url?: string;
  attributionRequired?: boolean;
}

export interface KeywordIconDefinition {
  id: KeywordIconId;
  label: string;
  shortLabel: string;
  aliases: string[];
  description: string;
  category: KeywordIconCategory;
  defaultColor?: string;
  svgPath: string;
  viewBox?: string;
  attribution?: ExternalIconAttribution;
}

const LOCAL_ATTRIBUTION: ExternalIconAttribution = { source: 'local' };

export const KEYWORD_ICON_REGISTRY: Record<KeywordIconId, KeywordIconDefinition> = {
  deathtouch: icon('deathtouch', 'Deathtouch', 'DT', ['death touch'], 'Any damage this deals to a creature is lethal.', 'combat', '#86efac', 'M12 2 6 5v5c0 4 2.5 7 6 8 3.5-1 6-4 6-8V5l-6-3Zm-3 8a1.4 1.4 0 1 0 0-2.8A1.4 1.4 0 0 0 9 10Zm6 0a1.4 1.4 0 1 0 0-2.8A1.4 1.4 0 0 0 15 10Zm-4.5 4h3l-1.5-2-1.5 2Zm-2 2.5h7v-1.4h-7v1.4Z'),
  double_strike: icon('double_strike', 'Double Strike', 'DS', ['double-strike'], 'Deals first-strike and regular combat damage.', 'combat', '#facc15', 'M7 4 4 17l3-1 3-12H7Zm7 0-3 13 3-1 3-12h-3Z'),
  first_strike: icon('first_strike', 'First Strike', 'FS', ['first-strike'], 'Deals combat damage before creatures without first strike.', 'combat', '#fde68a', 'M9 4 6 18l9-10-4 1 3-5H9Z'),
  menace: icon('menace', 'Menace', 'MEN', [], 'Cannot be blocked except by two or more creatures.', 'evasion', '#fca5a5', 'M5 9c2-4 5-5 7-5s5 1 7 5c-2 4-5 5-7 5S7 13 5 9Zm4 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm6 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9 17h6l-3 3-3-3Z'),
  flying: icon('flying', 'Flying', 'FLY', [], 'Can be blocked only by flying or reach.', 'evasion', '#bfdbfe', 'M12 5c-4-2-8-1-10 3 3-1 6 0 8 3-3 0-5 2-6 5 4-2 7-1 8 2 1-3 4-4 8-2-1-3-3-5-6-5 2-3 5-4 8-3-2-4-6-5-10-3Z'),
  reach: icon('reach', 'Reach', 'RCH', [], 'Can block creatures with flying.', 'evasion', '#93c5fd', 'M12 3 7 20h2l1-4h4l1 4h2L12 3Zm0 5 1.5 6h-3L12 8Zm-5 1 5-5 5 5h-3v3h-4V9H7Z'),
  trample: icon('trample', 'Trample', 'TR', [], 'Excess combat damage can hit the attacked player or permanent.', 'combat', '#bbf7d0', 'M6 5h7l5 5-3 2-3-3H9v4h4l5 4-2 2-5-3H5V5h1Z'),
  lifelink: icon('lifelink', 'Lifelink', 'LL', [], 'Damage this deals also causes its controller to gain life.', 'combat', '#fbcfe8', 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10Zm-2-8h4v-2h-4v2Zm1 3h2v-8h-2v8Z'),
  vigilance: icon('vigilance', 'Vigilance', 'VIG', [], 'Attacking does not cause this creature to tap.', 'combat', '#c4b5fd', 'M12 5c5 0 9 5 9 7s-4 7-9 7-9-5-9-7 4-7 9-7Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-2a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z'),
  haste: icon('haste', 'Haste', 'HST', [], 'Can attack and tap immediately.', 'speed', '#fdba74', 'M4 13h7l-2 7 9-11h-7l2-6-9 10Zm-2-5h5V6H2v2Zm0 4h4v-2H2v2Z'),
  hexproof: icon('hexproof', 'Hexproof', 'HEX', [], 'Cannot be targeted by opponents.', 'protection', '#a7f3d0', 'M12 2 4 6v6c0 4 3 7 8 10 5-3 8-6 8-10V6l-8-4Zm0 3 5 3v4c0 2.5-1.8 4.6-5 6.7C8.8 16.6 7 14.5 7 12V8l5-3Z'),
  ward: icon('ward', 'Ward', 'WARD', [], 'Opponent spells or abilities targeting this need an extra payment.', 'protection', '#99f6e4', 'M12 3 5 7v5c0 4 3 6.5 7 8.5 4-2 7-4.5 7-8.5V7l-7-4Zm-2 6h4l-1 2h3l-5 6 1-4H9l1-4Z'),
  indestructible: icon('indestructible', 'Indestructible', 'IND', [], 'Cannot be destroyed by damage or destroy effects.', 'protection', '#e5e7eb', 'M12 2 20 12l-8 10-8-10L12 2Zm0 4-4.5 6 4.5 6 4.5-6L12 6Zm0 3 2 3-2 3-2-3 2-3Z'),
  protection: icon('protection', 'Protection', 'PRO', [], 'Protected from stated qualities; check exact card text.', 'protection', '#fef3c7', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 3a6 6 0 0 1 5 9.3L8.7 7A6 6 0 0 1 12 6Zm0 12a6 6 0 0 1-5-9.3l8.3 8.3A6 6 0 0 1 12 18Z'),
  defender: icon('defender', 'Defender', 'DEF', [], 'Cannot attack.', 'combat', '#cbd5e1', 'M4 5h16v15H4V5Zm2 2v3h5V7H6Zm7 0v3h5V7h-5Zm-7 5v3h5v-3H6Zm7 0v3h5v-3h-5Zm-7 5v1h12v-1H6Z'),
  flash: icon('flash', 'Flash', 'FL', [], 'Can be cast any time you could cast an instant.', 'speed', '#fef08a', 'M13 2 5 13h6l-2 9 9-13h-6l1-7Z'),
  prowess: icon('prowess', 'Prowess', 'PROW', [], 'Gets +1/+1 when you cast a noncreature spell.', 'combat', '#fda4af', 'M12 3 5 12h5l-2 9 11-12h-5l2-6h-4Z'),
  toxic: icon('toxic', 'Toxic', 'TOX', [], 'Combat damage to players gives poison counters.', 'combat', '#bef264', 'M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10Zm-2 11h4v-2h-4v2Zm1 3h2v-2h-2v2Z'),
  infect: icon('infect', 'Infect', 'INF', [], 'Deals damage as -1/-1 counters or poison counters.', 'combat', '#a3e635', 'M12 3c3 2 5 5 5 8 0 4-2 7-5 10-3-3-5-6-5-10 0-3 2-6 5-8Zm-3 8 6 4-1-5-5 1Z'),
  wither: icon('wither', 'Wither', 'WTH', [], 'Deals damage to creatures as -1/-1 counters.', 'combat', '#d9f99d', 'M6 6h12v3H6V6Zm2 6h8v3H8v-3Zm3 5h2v3h-2v-3Z'),
  firebending: icon('firebending', 'Firebending', 'FIRE', ['firebend'], 'Set mechanic that creates red combat mana when attacking.', 'mechanic', '#fb7185', 'M12 21c4-2 6-5 5-8 0-3-2-5-4-8 0 3-2 4-4 6 0-2-1-3-2-4-2 3-4 5-4 8 0 4 3 6 7 6Zm0-3c-2 0-3-1.3-3-3 0-1.4 1-2.6 3-4 2 1.4 3 2.6 3 4 0 1.7-1 3-3 3Z'),
  airbend: icon('airbend', 'Airbend', 'AIR', ['airbending'], 'Set mechanic tied to exile/return or cast permissions.', 'mechanic', '#bae6fd', 'M4 9c3-4 10-4 13-1 2 2 1 5-2 5H8v-2h7c2 0 2-3 0-4-2-2-7-2-9 1L4 9Zm2 5h10c3 0 4 4 1 6-2 1-5 1-7-1l1-2c2 1 4 1 5 0 1-1 0-2-1-2H6v-1Z'),
  waterbend: icon('waterbend', 'Waterbend', 'WATER', ['waterbending'], 'Set mechanic for tapping eligible permanents toward costs.', 'mechanic', '#67e8f9', 'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Zm-4 11c2 1 6 1 8-2 0 4-2 6-4 6s-4-2-4-4Z'),
  earthbend: icon('earthbend', 'Earthbend', 'EARTH', ['earthbending'], 'Set mechanic that temporarily makes a land into a creature.', 'mechanic', '#a7f3d0', 'M5 15 10 4h4l5 11-7 6-7-6Zm5-1h4l-2-6-2 6Z'),
  warp: icon('warp', 'Warp', 'WARP', [], 'Set mechanic for alternate casting or delayed exile instructions.', 'mechanic', '#c084fc', 'M12 4a8 8 0 1 0 8 8h-3a5 5 0 1 1-5-5V4Zm0 3a5 5 0 1 0 5 5h-3a2 2 0 1 1-2-2V7Z'),
  sneak: icon('sneak', 'Sneak', 'SNK', [], 'Set mechanic for casting by returning an unblocked attacker.', 'mechanic', '#d8b4fe', 'M7 16c2-5 6-8 10-9l1 3c-3 1-5 3-6 6h4v3H6l1-3Zm1-7 4-4 2 2-4 4-2-2Z'),
  exhaust: icon('exhaust', 'Exhaust', 'EXH', [], 'Once-per-object ability tracking.', 'mechanic', '#fbbf24', 'M12 2 4 14h6l-1 8 11-14h-7l-1-6Zm3 15h4v3h-4v-3Z'),
  station: icon('station', 'Station', 'STN', ['spacecraft'], 'Tap creatures to add charge counters or unlock spacecraft.', 'mechanic', '#93c5fd', 'M12 3 20 20l-8-4-8 4 8-17Zm0 6-3 6 3-1 3 1-3-6Z'),
  class: icon('class', 'Class', 'CLS', ['classes'], 'Class card level state is tracked manually.', 'mechanic', '#fde68a', 'M5 4h10a4 4 0 0 1 4 4v12H8a3 3 0 0 1-3-3V4Zm3 3v10h8V8a1 1 0 0 0-1-1H8Zm2 2h4v2h-4V9Zm0 3h5v2h-5v-2Z'),
  clue: icon('clue', 'Clue', 'CLUE', [], 'Artifact token that can be sacrificed to draw a card.', 'token', '#fef3c7', 'M10 4a6 6 0 1 0 3.5 10.9l3.8 3.8 1.4-1.4-3.8-3.8A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z'),
  treasure: icon('treasure', 'Treasure', 'TRS', [], 'Artifact token that sacrifices for mana.', 'token', '#facc15', 'M12 3 20 9l-8 12L4 9l8-6Zm0 3-4 3 4 6 4-6-4-3Z'),
  food: icon('food', 'Food', 'FOOD', [], 'Artifact token that can be sacrificed to gain life.', 'token', '#bbf7d0', 'M12 4c2 0 4 2 4 5v1h2v4c0 4-3 7-6 7s-6-3-6-7v-4h2V9c0-3 2-5 4-5Zm-2 6h4V9c0-2-1-3-2-3s-2 1-2 3v1Z'),
  blood: icon('blood', 'Blood', 'BLD', [], 'Artifact token that loots by discarding and drawing.', 'token', '#fca5a5', 'M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10Zm0 14a2 2 0 0 0 2-2H9a3 3 0 0 0 3 2Z'),
  map: icon('map', 'Map', 'MAP', [], 'Token or marker used by map/explore-style effects.', 'token', '#fde68a', 'M4 5l5-2 6 2 5-2v16l-5 2-6-2-5 2V5Zm5 0v12l6 2V7L9 5Z'),
  lander: icon('lander', 'Lander', 'LND', [], 'Set token/mechanic metadata for Lander tokens.', 'token', '#d9f99d', 'M12 3 18 13l-3 1 3 5-3 1-3-5-3 5-3-1 3-5-3-1 6-10Z'),
  mutagen: icon('mutagen', 'Mutagen', 'MUT', [], 'Set token/mechanic metadata for Mutagen tokens.', 'token', '#c4b5fd', 'M8 3h8v2l-2 3v5l4 7H6l4-7V8L8 5V3Zm3 6h2l-1-2-1 2Zm0 5-2 4h6l-2-4h-2Z'),
  manual: icon('manual', 'Manual', 'MAN', [], 'Resolve or track this manually.', 'manual', '#fbbf24', 'M15 3 21 9l-3 3-2-2-7 7v3H6v-3l7-7-2-2 4-5Zm-8 17h10v2H7v-2Z'),
  unknown: icon('unknown', 'Unknown', '?', [], 'Unknown keyword or mechanic.', 'manual', '#cbd5e1', 'M11 16h2v2h-2v-2Zm1-12a5 5 0 0 0-5 5h2a3 3 0 1 1 4.8 2.4c-1.4 1-2.8 1.9-2.8 3.6h2c0-.8.8-1.4 1.8-2.1A5 5 0 0 0 12 4Z'),
};

const IMPORTANT_ICON_ORDER: KeywordIconId[] = [
  'deathtouch',
  'double_strike',
  'first_strike',
  'trample',
  'flying',
  'reach',
  'menace',
  'lifelink',
  'vigilance',
  'haste',
  'indestructible',
  'protection',
  'hexproof',
  'ward',
  'firebending',
  'sneak',
  'airbend',
  'warp',
  'exhaust',
  'station',
  'clue',
  'treasure',
  'food',
  'manual',
  'unknown',
];

const MECHANIC_ICON_MAP: Record<string, KeywordIconId> = {
  firebending: 'firebending',
  airbend: 'airbend',
  waterbend: 'waterbend',
  earthbend: 'earthbend',
  warp: 'warp',
  sneak: 'sneak',
  exhaust: 'exhaust',
  station: 'station',
  spacecraft: 'station',
  classes: 'class',
  clue: 'clue',
  'lander-token': 'lander',
  'mutagen-token': 'mutagen',
};

const TOKEN_ICON_NAMES: Array<[RegExp, KeywordIconId]> = [
  [/\bclue\b/i, 'clue'],
  [/\btreasure\b/i, 'treasure'],
  [/\bfood\b/i, 'food'],
  [/\bblood\b/i, 'blood'],
  [/\bmap\b/i, 'map'],
  [/\blander\b/i, 'lander'],
  [/\bmutagen\b/i, 'mutagen'],
];

const ALIAS_TO_ID = new Map<string, KeywordIconId>();
for (const definition of Object.values(KEYWORD_ICON_REGISTRY)) {
  ALIAS_TO_ID.set(normalizeKeyword(definition.id), definition.id);
  ALIAS_TO_ID.set(normalizeKeyword(definition.label), definition.id);
  ALIAS_TO_ID.set(normalizeKeyword(definition.shortLabel), definition.id);
  for (const alias of definition.aliases) ALIAS_TO_ID.set(normalizeKeyword(alias), definition.id);
}

function icon(
  id: KeywordIconId,
  label: string,
  shortLabel: string,
  aliases: string[],
  description: string,
  category: KeywordIconCategory,
  defaultColor: string,
  svgPath: string,
): KeywordIconDefinition {
  return { id, label, shortLabel, aliases, description, category, defaultColor, svgPath, viewBox: '0 0 24 24', attribution: LOCAL_ATTRIBUTION };
}

function normalizeKeyword(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cardText(card: CardState): string {
  const definition = card.definition ?? {};
  const faces = (definition.faces ?? []).map(face => [
    face.name,
    face.typeLine,
    face.oracleText,
    ...(face.keywords ?? []),
  ].join(' '));
  return [
    definition.name,
    definition.typeLine,
    definition.oracleText,
    ...(definition.keywords ?? []),
    ...(definition.subTypes ?? []),
    ...faces,
  ].filter(Boolean).join(' ');
}

function addIcon(ids: Set<KeywordIconId>, value?: string): void {
  if (!value) return;
  const id = resolveKeywordIconId(value);
  if (id) ids.add(id);
}

export function resolveKeywordIconId(value: string): KeywordIconId | undefined {
  return ALIAS_TO_ID.get(normalizeKeyword(value));
}

export function getMechanicIconId(mechanicId: string): KeywordIconId {
  return MECHANIC_ICON_MAP[mechanicId] ?? 'manual';
}

export function getKeywordIconDefinition(id: KeywordIconId): KeywordIconDefinition {
  return KEYWORD_ICON_REGISTRY[id];
}

export function getKeywordIconIdsForCard(
  card: CardState,
  ruleset: RulesetDefinition = defaultRuleset,
  options: { includeManualFallback?: boolean } = {},
): KeywordIconId[] {
  const ids = new Set<KeywordIconId>();
  const definition = card.definition;
  const text = cardText(card);

  for (const keyword of definition?.keywords ?? []) addIcon(ids, keyword);
  for (const face of definition?.faces ?? []) {
    for (const keyword of face.keywords ?? []) addIcon(ids, keyword);
  }

  for (const entry of Object.values(KEYWORD_ICON_REGISTRY)) {
    if (entry.id === 'manual' || entry.id === 'unknown') continue;
    const patterns = [entry.label, ...entry.aliases].map(value => new RegExp(`\\b${escapeRegex(value).replace(/\s+/g, '\\s+')}\\b`, 'i'));
    if (patterns.some(pattern => pattern.test(text))) ids.add(entry.id);
  }

  for (const mechanic of getMechanicsForCard(card, ruleset)) {
    const iconId = getMechanicIconId(mechanic.id);
    ids.add(iconId);
    const manual = mechanic.automationLevel === 'manual_prompt' || mechanic.automationLevel === 'unsupported' || !mechanic.executable;
    if (manual && options.includeManualFallback) ids.add('manual');
  }

  if (card.exilePermission?.sourceMechanic === 'airbend') ids.add('airbend');
  if (card.exilePermission?.sourceMechanic === 'warp' || card.warpedThisTurn) ids.add('warp');
  if (card.earthbend) ids.add('earthbend');
  if (card.sneak) ids.add('sneak');
  if (card.spacecraft) ids.add('station');
  if (card.classLevel !== undefined) ids.add('class');

  const tokenText = `${definition?.name ?? ''} ${definition?.typeLine ?? ''} ${(definition?.subTypes ?? []).join(' ')}`;
  for (const [pattern, iconId] of TOKEN_ICON_NAMES) {
    if (pattern.test(tokenText)) ids.add(iconId);
  }

  return orderKeywordIconIds([...ids]);
}

export function getImportantKeywordIconIds(ids: KeywordIconId[], limit = 5): KeywordIconId[] {
  return orderKeywordIconIds([...new Set(ids)]).slice(0, Math.max(0, limit));
}

export function getCardSurfaceKeywordIconIds(
  card: CardState,
  showMechanicBadges: boolean,
  size: 'tiny' | 'compact' | 'normal' | 'large' | 'preview' = 'normal',
): KeywordIconId[] {
  if (!showMechanicBadges || size === 'tiny') return [];
  const limit = size === 'compact' ? 3 : size === 'preview' ? 8 : 5;
  return getImportantKeywordIconIds(getKeywordIconIdsForCard(card), limit);
}

export function getKeywordIconIdsForCards(cards: CardState[]): { shared: KeywordIconId[]; mixed: KeywordIconId[] } {
  if (cards.length === 0) return { shared: [], mixed: [] };
  const perCard = cards.map(card => new Set(getKeywordIconIdsForCard(card)));
  const all = new Set(perCard.flatMap(set => [...set]));
  const shared: KeywordIconId[] = [];
  const mixed: KeywordIconId[] = [];
  for (const id of all) {
    if (perCard.every(set => set.has(id))) shared.push(id);
    else mixed.push(id);
  }
  return {
    shared: orderKeywordIconIds(shared),
    mixed: orderKeywordIconIds(mixed),
  };
}

export function orderKeywordIconIds(ids: KeywordIconId[]): KeywordIconId[] {
  const unique = [...new Set(ids)];
  return unique.sort((a, b) => {
    const rankA = IMPORTANT_ICON_ORDER.indexOf(a);
    const rankB = IMPORTANT_ICON_ORDER.indexOf(b);
    return (rankA === -1 ? 999 : rankA) - (rankB === -1 ? 999 : rankB) || a.localeCompare(b);
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

