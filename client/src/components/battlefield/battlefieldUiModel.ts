import type { CardState } from '../../types/game';
import { filterCards, type CardFilterOptions } from '../../engine/cardFilter';
import { isArtifact, isBattle, isCreature, isEnchantment, isLand, isPlaneswalker } from '../../engine/gameEngine';
import { getMechanicBadgesForCard } from '../../rules/mechanicsRegistry';

export type BattlefieldSectionKey = 'creatures' | 'lands' | 'artifacts' | 'enchantments' | 'planeswalkers' | 'battles' | 'tokens' | 'other';
export type BattlefieldFilterChip = 'tapped' | 'untapped' | 'creatures' | 'tokens' | 'canAttack' | 'canBlock' | 'hasCounters' | 'hasPowerToughnessOverride' | 'hasMechanicBadge';
export type BattlefieldDensityMode = 'normal' | 'compact' | 'ultraCompact';

export interface BattlefieldSection {
  key: BattlefieldSectionKey;
  label: string;
  cards: CardState[];
}

export interface BattlefieldThreatSummary {
  totalCreatures: number;
  untappedBlockers: number;
  attackingPower: number;
  tokenCount: number;
  planeswalkerCount: number;
}

export interface BattlefieldViewOptions {
  search?: string;
  filters?: Set<BattlefieldFilterChip> | BattlefieldFilterChip[];
  forcedDensity?: BattlefieldDensityMode | 'auto';
  compact?: boolean;
  combatActive?: boolean;
}

export interface BattlefieldViewModel {
  density: BattlefieldDensityMode;
  filteredCards: CardState[];
  sections: BattlefieldSection[];
  summary: BattlefieldThreatSummary;
}

const SECTION_ORDER: BattlefieldSectionKey[] = ['creatures', 'lands', 'artifacts', 'enchantments', 'planeswalkers', 'battles', 'tokens', 'other'];
const SECTION_LABELS: Record<BattlefieldSectionKey, string> = {
  creatures: 'Creatures',
  lands: 'Lands',
  artifacts: 'Artifacts',
  enchantments: 'Enchantments',
  planeswalkers: 'Planeswalkers',
  battles: 'Battles',
  tokens: 'Tokens',
  other: 'Other',
};

export function buildBattlefieldView(cards: CardState[], options: BattlefieldViewOptions = {}): BattlefieldViewModel {
  const filters = new Set(Array.isArray(options.filters) ? options.filters : [...(options.filters ?? [])]);
  const filteredCards = applyBattlefieldFilters(cards, options.search, filters);
  const density = options.forcedDensity && options.forcedDensity !== 'auto'
    ? options.forcedDensity
    : getBattlefieldDensityMode(cards.length, Boolean(options.compact));

  return {
    density,
    filteredCards,
    sections: groupBattlefieldSections(filteredCards),
    summary: getBattlefieldThreatSummary(cards, Boolean(options.combatActive)),
  };
}

export function applyBattlefieldFilters(cards: CardState[], search: string | undefined, filters: Set<BattlefieldFilterChip>): CardState[] {
  const filterOptions: CardFilterOptions = { query: search?.trim() || undefined };
  if (filters.has('tapped')) filterOptions.tapped = true;
  if (filters.has('untapped')) filterOptions.untapped = true;
  if (filters.has('creatures')) filterOptions.creature = true;
  if (filters.has('tokens')) filterOptions.token = true;
  if (filters.has('hasCounters')) filterOptions.hasCounters = true;
  if (filters.has('hasPowerToughnessOverride')) filterOptions.hasPowerToughnessOverride = true;
  if (filters.has('hasMechanicBadge')) filterOptions.hasMechanicBadge = true;

  return filterCards(cards, filterOptions).filter(card => {
    if (filters.has('canAttack') && !canBattlefieldCardAttack(card)) return false;
    if (filters.has('canBlock') && !canBattlefieldCardBlock(card)) return false;
    return true;
  });
}

export function groupBattlefieldSections(cards: CardState[]): BattlefieldSection[] {
  const groups = new Map<BattlefieldSectionKey, CardState[]>();
  for (const key of SECTION_ORDER) groups.set(key, []);
  for (const card of cards) groups.get(getBattlefieldSectionKey(card))!.push(card);
  return SECTION_ORDER
    .map(key => ({ key, label: SECTION_LABELS[key], cards: groups.get(key) ?? [] }))
    .filter(section => section.cards.length > 0);
}

export function getBattlefieldDensityMode(cardCount: number, compact: boolean): BattlefieldDensityMode {
  if (compact || cardCount >= 36) return 'ultraCompact';
  if (cardCount >= 18) return 'compact';
  return 'normal';
}

export function getBattlefieldThreatSummary(cards: CardState[], combatActive: boolean): BattlefieldThreatSummary {
  const creatures = cards.filter(isCreature);
  const attacking = combatActive ? creatures.filter(card => card.combatRole === 'attacker') : [];
  return {
    totalCreatures: creatures.length,
    untappedBlockers: creatures.filter(canBattlefieldCardBlock).length,
    attackingPower: attacking.reduce((total, card) => total + parseStat(card.definition?.power), 0),
    tokenCount: cards.filter(card => card.token).length,
    planeswalkerCount: cards.filter(isPlaneswalker).length,
  };
}

export function canBattlefieldCardAttack(card: CardState): boolean {
  if (!isCreature(card)) return false;
  if (card.tapped || card.combatRole === 'attacker') return false;
  if (hasKeywordOrText(card, 'defender')) return false;
  if (card.summoningSick && !hasKeywordOrText(card, 'haste')) return false;
  return true;
}

export function canBattlefieldCardBlock(card: CardState): boolean {
  if (!isCreature(card)) return false;
  if (card.tapped || card.combatRole === 'blocker') return false;
  if (hasKeywordOrText(card, "can't block") || hasKeywordOrText(card, 'cannot block')) return false;
  return true;
}

export function cardHasVisibleMechanicBadge(card: CardState): boolean {
  return getMechanicBadgesForCard(card).length > 0;
}

function getBattlefieldSectionKey(card: CardState): BattlefieldSectionKey {
  if (card.token) return 'tokens';
  if (isCreature(card)) return 'creatures';
  if (isLand(card)) return 'lands';
  if (isArtifact(card)) return 'artifacts';
  if (isEnchantment(card)) return 'enchantments';
  if (isPlaneswalker(card)) return 'planeswalkers';
  if (isBattle(card)) return 'battles';
  return 'other';
}

function hasKeywordOrText(card: CardState, value: string): boolean {
  const lower = value.toLowerCase();
  return (card.definition?.keywords ?? []).some(keyword => keyword.toLowerCase() === lower)
    || String(card.definition?.oracleText ?? '').toLowerCase().includes(lower);
}

function parseStat(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
