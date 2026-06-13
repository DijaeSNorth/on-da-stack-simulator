import type { CardState, CardType, ManaColor } from '../types/game';
import {
  getCardTypes,
  getTypeLine,
  hasCardType,
  isArtifact,
  isBattle,
  isCreature,
  isEnchantment,
  isLand,
  isPlaneswalker,
  isToken,
} from './gameEngine';
import { getMechanicBadgesForCard, getMechanicsForCard } from '../rules/mechanicsRegistry';

export type CardSortMode =
  | 'name'
  | 'manaValue'
  | 'cardType'
  | 'color'
  | 'power'
  | 'toughness'
  | 'draw'
  | 'order'
  | 'index';

export type CardGroupMode =
  | 'cardType'
  | 'manaValue'
  | 'color'
  | 'landNonland'
  | 'creatureNoncreature'
  | 'tokenNonToken'
  | 'mechanic';

export type CardFilterType =
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'instant'
  | 'sorcery'
  | 'land'
  | 'planeswalker'
  | 'battle';

export interface ManaValueRange {
  min?: number;
  max?: number;
}

export interface CardFilterOptions {
  query?: string;
  types?: CardFilterType[];
  creature?: boolean;
  artifact?: boolean;
  enchantment?: boolean;
  instant?: boolean;
  sorcery?: boolean;
  land?: boolean;
  planeswalker?: boolean;
  battle?: boolean;
  token?: boolean;
  tapped?: boolean;
  untapped?: boolean;
  attacking?: boolean;
  blocking?: boolean;
  summoningSick?: boolean;
  hasCounters?: boolean;
  hasMechanicBadge?: boolean | string;
  hasPowerToughnessOverride?: boolean;
  color?: ManaColor | 'colorless' | 'multicolor';
  colors?: Array<ManaColor | 'colorless' | 'multicolor'>;
  manaValue?: ManaValueRange;
  manaValueMin?: number;
  manaValueMax?: number;
  revealPrivateDetails?: boolean;
}

export type CardGroupResult = Array<{ key: string; label: string; cards: CardState[] }>;

const TYPE_ORDER: CardType[] = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Instant', 'Sorcery'];
const COLOR_ORDER: Array<ManaColor | 'M' | 'Z'> = ['W', 'U', 'B', 'R', 'G', 'C', 'M', 'Z'];

export function getCardSearchText(card: CardState | undefined, options: Pick<CardFilterOptions, 'revealPrivateDetails'> = {}): string {
  if (!card) return '';
  if (isHiddenForSearch(card, options)) return getPublicHiddenSearchText(card);

  const definition = card.definition;
  const mechanicText = getMechanicSearchParts(card).join(' ');
  const faceText = (definition?.faces ?? [])
    .map(face => [
      face.name,
      face.typeLine,
      face.oracleText,
      face.keywords?.join(' '),
      face.colors?.join(' '),
      face.cmc,
    ].filter(isSearchValue).join(' '))
    .join(' ');

  return normalizeSearchText([
    definition?.name,
    getTypeLine(card),
    definition?.oracleText,
    definition?.keywords?.join(' '),
    definition?.colors?.join(' '),
    definition?.colorIdentity?.join(' '),
    getColorLabel(card),
    getManaValue(card),
    mechanicText,
    faceText,
    card.token ? 'token' : '',
    card.tapped ? 'tapped' : 'untapped',
    card.summoningSick ? 'summoning sick' : '',
    card.combatRole,
    card.powerToughnessOverride ? 'power toughness override pt override' : '',
  ].filter(isSearchValue).join(' '));
}

export function matchesCardSearch(card: CardState | undefined, query: string, options: Pick<CardFilterOptions, 'revealPrivateDetails'> = {}): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  const text = getCardSearchText(card, options);
  return needle.split(/\s+/).every(part => text.includes(part));
}

export function filterCards(cards: CardState[], filterOptions: CardFilterOptions = {}): CardState[] {
  return cards.filter(card => {
    if (!card) return false;
    if (filterOptions.query && !matchesCardSearch(card, filterOptions.query, filterOptions)) return false;

    const requestedTypes = collectRequestedTypes(filterOptions);
    if (requestedTypes.length > 0 && !requestedTypes.some(type => matchesTypeFilter(card, type))) return false;

    if (filterOptions.token !== undefined && isToken(card) !== filterOptions.token) return false;
    if (filterOptions.tapped !== undefined && Boolean(card.tapped) !== filterOptions.tapped) return false;
    if (filterOptions.untapped !== undefined && Boolean(!card.tapped) !== filterOptions.untapped) return false;
    if (filterOptions.attacking !== undefined && (card.combatRole === 'attacker') !== filterOptions.attacking) return false;
    if (filterOptions.blocking !== undefined && (card.combatRole === 'blocker') !== filterOptions.blocking) return false;
    if (filterOptions.summoningSick !== undefined && Boolean(card.summoningSick) !== filterOptions.summoningSick) return false;
    if (filterOptions.hasCounters !== undefined && hasCounters(card) !== filterOptions.hasCounters) return false;
    if (filterOptions.hasPowerToughnessOverride !== undefined && Boolean(card.powerToughnessOverride) !== filterOptions.hasPowerToughnessOverride) return false;
    if (filterOptions.hasMechanicBadge !== undefined && !matchesMechanicBadgeFilter(card, filterOptions.hasMechanicBadge)) return false;
    if (!matchesColorFilter(card, filterOptions)) return false;
    if (!matchesManaValueRange(card, filterOptions)) return false;

    return true;
  });
}

export function sortCards(cards: CardState[], sortMode: CardSortMode = 'index'): CardState[] {
  if (sortMode === 'index' || sortMode === 'order' || sortMode === 'draw') return [...cards];

  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const byMode = compareBySortMode(a.card, b.card, sortMode);
      return byMode || a.index - b.index;
    })
    .map(entry => entry.card);
}

export function groupCards(cards: CardState[], groupMode: CardGroupMode): CardGroupResult {
  const groups = new Map<string, { key: string; label: string; cards: CardState[] }>();
  for (const card of cards) {
    const key = getGroupKey(card, groupMode);
    const label = getGroupLabel(key, groupMode);
    if (!groups.has(key)) groups.set(key, { key, label, cards: [] });
    groups.get(key)!.cards.push(card);
  }
  return Array.from(groups.values()).sort((a, b) => compareGroupKeys(a.key, b.key, groupMode));
}

function isHiddenForSearch(card: CardState, options: Pick<CardFilterOptions, 'revealPrivateDetails'>): boolean {
  return options.revealPrivateDetails === false && Boolean(card.faceDown);
}

function getPublicHiddenSearchText(card: CardState): string {
  return normalizeSearchText([
    'hidden card',
    'face down',
    card.zone,
    card.tapped ? 'tapped' : 'untapped',
    card.token ? 'token' : '',
  ].join(' '));
}

function isSearchValue(value: unknown): value is string | number {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w/+*-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectRequestedTypes(options: CardFilterOptions): CardFilterType[] {
  const requested = new Set<CardFilterType>(options.types ?? []);
  const flags: CardFilterType[] = ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'land', 'planeswalker', 'battle'];
  for (const flag of flags) {
    if (options[flag]) requested.add(flag);
  }
  return [...requested];
}

function matchesTypeFilter(card: CardState, type: CardFilterType): boolean {
  switch (type) {
    case 'creature': return isCreature(card);
    case 'artifact': return isArtifact(card);
    case 'enchantment': return isEnchantment(card);
    case 'instant': return hasCardType(card, 'Instant');
    case 'sorcery': return hasCardType(card, 'Sorcery');
    case 'land': return isLand(card);
    case 'planeswalker': return isPlaneswalker(card);
    case 'battle': return isBattle(card);
  }
}

function hasCounters(card: CardState): boolean {
  return (card.counters ?? []).some(counter => (counter?.count ?? 0) > 0);
}

function matchesMechanicBadgeFilter(card: CardState, expected: boolean | string): boolean {
  const mechanics = getMechanicSearchParts(card).map(normalizeSearchText);
  if (typeof expected === 'boolean') return expected ? mechanics.length > 0 : mechanics.length === 0;
  const needle = normalizeSearchText(expected);
  return mechanics.some(part => part.includes(needle));
}

function matchesColorFilter(card: CardState, options: CardFilterOptions): boolean {
  const requested = options.colors ?? (options.color ? [options.color] : []);
  if (requested.length === 0) return true;
  const label = getColorGroupKey(card);
  const colors = getColors(card);
  return requested.some(color => {
    if (color === 'colorless') return label === 'Z' || colors.length === 0;
    if (color === 'multicolor') return label === 'M';
    return colors.includes(color);
  });
}

function matchesManaValueRange(card: CardState, options: CardFilterOptions): boolean {
  const min = options.manaValue?.min ?? options.manaValueMin;
  const max = options.manaValue?.max ?? options.manaValueMax;
  if (min === undefined && max === undefined) return true;
  const mv = getManaValue(card);
  if (mv === undefined) return false;
  if (min !== undefined && mv < min) return false;
  if (max !== undefined && mv > max) return false;
  return true;
}

function compareBySortMode(a: CardState, b: CardState, mode: CardSortMode): number {
  switch (mode) {
    case 'name':
      return compareText(a.definition?.name, b.definition?.name);
    case 'manaValue':
      return compareNumber(getManaValue(a), getManaValue(b)) || compareText(a.definition?.name, b.definition?.name);
    case 'cardType':
      return compareNumber(getTypeRank(a), getTypeRank(b)) || compareText(a.definition?.name, b.definition?.name);
    case 'color':
      return compareNumber(getColorRank(a), getColorRank(b)) || compareText(a.definition?.name, b.definition?.name);
    case 'power':
      return compareNumber(parseStat(a.definition?.power), parseStat(b.definition?.power)) || compareText(a.definition?.name, b.definition?.name);
    case 'toughness':
      return compareNumber(parseStat(a.definition?.toughness), parseStat(b.definition?.toughness)) || compareText(a.definition?.name, b.definition?.name);
    case 'draw':
    case 'order':
    case 'index':
      return 0;
  }
}

function compareText(a: unknown, b: unknown): number {
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' });
}

function compareNumber(a: number | undefined, b: number | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

function getTypeRank(card: CardState): number {
  const types = getCardTypes(card);
  const rank = TYPE_ORDER.findIndex(type => types.includes(type));
  return rank === -1 ? TYPE_ORDER.length : rank;
}

function getColorRank(card: CardState): number {
  const key = getColorGroupKey(card);
  const rank = COLOR_ORDER.indexOf(key);
  return rank === -1 ? COLOR_ORDER.length : rank;
}

function getGroupKey(card: CardState, mode: CardGroupMode): string {
  switch (mode) {
    case 'cardType':
      return getPrimaryType(card);
    case 'manaValue':
      return getManaValue(card)?.toString() ?? 'unknown';
    case 'color':
      return getColorGroupKey(card);
    case 'landNonland':
      return isLand(card) ? 'land' : 'nonland';
    case 'creatureNoncreature':
      return isCreature(card) ? 'creature' : 'noncreature';
    case 'tokenNonToken':
      return isToken(card) ? 'token' : 'non-token';
    case 'mechanic':
      return getMechanicSearchParts(card)[0] ?? 'none';
  }
}

function getGroupLabel(key: string, mode: CardGroupMode): string {
  if (mode === 'color') return colorGroupLabel(key);
  if (mode === 'manaValue') return key === 'unknown' ? 'Unknown mana value' : `Mana value ${key}`;
  if (mode === 'mechanic') return key === 'none' ? 'No mechanic' : key;
  return key;
}

function compareGroupKeys(a: string, b: string, mode: CardGroupMode): number {
  if (mode === 'manaValue') return compareNumber(numberFromKey(a), numberFromKey(b));
  if (mode === 'color') return compareNumber(colorOrderIndex(a), colorOrderIndex(b));
  if (mode === 'cardType') return compareNumber(typeOrderIndex(a), typeOrderIndex(b));
  return compareText(a, b);
}

function numberFromKey(key: string): number | undefined {
  const parsed = Number.parseFloat(key);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getPrimaryType(card: CardState): string {
  const types = getCardTypes(card);
  return TYPE_ORDER.find(type => types.includes(type)) ?? types[0] ?? 'Unknown';
}

function getManaValue(card: CardState): number | undefined {
  const value = card.definition?.manaCost?.cmc ?? card.definition?.cmc;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getColors(card: CardState): ManaColor[] {
  const printedColors = card.definition?.colors;
  const identityColors = card.definition?.colorIdentity;
  const colors = Array.isArray(printedColors) && printedColors.length > 0 ? printedColors : identityColors ?? [];
  return Array.isArray(colors) ? colors.filter(Boolean) : [];
}

function getColorGroupKey(card: CardState): ManaColor | 'M' | 'Z' {
  const rawColors = getColors(card);
  const colors = rawColors.filter(color => color !== 'C');
  if (colors.length > 1) return 'M';
  if (colors.length === 1) return colors[0];
  return rawColors.includes('C') ? 'C' : 'Z';
}

function getColorLabel(card: CardState): string {
  return colorGroupLabel(getColorGroupKey(card));
}

function colorGroupLabel(key: string): string {
  switch (key) {
    case 'W': return 'white';
    case 'U': return 'blue';
    case 'B': return 'black';
    case 'R': return 'red';
    case 'G': return 'green';
    case 'C': return 'colorless';
    case 'Z': return 'colorless';
    case 'M': return 'multicolor';
    default: return key || 'unknown';
  }
}

function parseStat(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function colorOrderIndex(key: string): number | undefined {
  const index = COLOR_ORDER.indexOf(key as ManaColor | 'M' | 'Z');
  return index === -1 ? undefined : index;
}

function typeOrderIndex(key: string): number | undefined {
  const index = TYPE_ORDER.indexOf(key as CardType);
  return index === -1 ? undefined : index;
}

function getMechanicSearchParts(card: CardState): string[] {
  try {
    const badges = getMechanicBadgesForCard(card).flatMap(badge => [badge.id, badge.label, badge.title]);
    const mechanics = getMechanicsForCard(card).flatMap(mechanic => [mechanic.id, mechanic.name, mechanic.ui.shortLabel, mechanic.ui.reminder]);
    return [...badges, ...mechanics].filter(isSearchValue).map(String);
  } catch {
    return [];
  }
}
