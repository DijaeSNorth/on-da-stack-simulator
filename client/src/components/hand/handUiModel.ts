import type { CardState } from '../../types/game';
import type { SyncStatus } from '../../engine/multiplayerSync';
import { filterCards, sortCards, type CardSortMode } from '../../engine/cardFilter';
import { canControlPlayer } from '../../engine/playerPermissions';
import { isArtifact, isCreature, isEnchantment, isLand } from '../../engine/gameEngine';

export const HAND_COMPACT_THRESHOLD = 8;
export const HAND_GRID_THRESHOLD = 15;

export type HandDisplayMode = 'normal' | 'compact' | 'grid';
export type HandSortMode = 'manual' | 'manaValue' | 'cardType' | 'color' | 'name';
export type HandGroupMode = 'all' | 'lands' | 'creatures' | 'spells' | 'artifactsEnchantments' | 'other';
export type HandPrivacyView = 'visible' | 'countOnly';

export interface HandViewOptions {
  search?: string;
  sortMode?: HandSortMode;
  groupMode?: HandGroupMode;
  pinnedIds?: Set<string> | string[];
  compactThreshold?: number;
}

export interface HandGroup {
  key: HandGroupMode;
  label: string;
  cards: CardState[];
}

export interface HandViewModel {
  displayMode: HandDisplayMode;
  pinnedCards: CardState[];
  groups: HandGroup[];
  visibleCards: CardState[];
  filteredCount: number;
}

const GROUP_LABELS: Record<HandGroupMode, string> = {
  all: 'All',
  lands: 'Lands',
  creatures: 'Creatures',
  spells: 'Instants / Sorceries',
  artifactsEnchantments: 'Artifacts / Enchantments',
  other: 'Other',
};

const GROUP_ORDER: HandGroupMode[] = ['lands', 'creatures', 'spells', 'artifactsEnchantments', 'other'];

export function getHandDisplayMode(cardCount: number, compactThreshold = HAND_COMPACT_THRESHOLD): HandDisplayMode {
  if (cardCount >= HAND_GRID_THRESHOLD) return 'grid';
  if (cardCount >= compactThreshold) return 'compact';
  return 'normal';
}

export function getHandPrivacyView(
  localPlayerId: string | null | undefined,
  targetPlayerId: string | null | undefined,
  multiplayerStatus: SyncStatus | 'spectator',
  judgeMode: boolean,
): HandPrivacyView {
  return canControlPlayer(localPlayerId, targetPlayerId, multiplayerStatus, judgeMode) ? 'visible' : 'countOnly';
}

export function buildHandViewModel(cards: CardState[], options: HandViewOptions = {}): HandViewModel {
  const sortMode = options.sortMode ?? 'manual';
  const groupMode = options.groupMode ?? 'all';
  const pinnedIds = new Set(Array.isArray(options.pinnedIds) ? options.pinnedIds : [...(options.pinnedIds ?? [])]);
  const searched = filterCards(cards, { query: options.search?.trim() || undefined });
  const sorted = sortHandCards(searched, sortMode);
  const pinnedCards = sorted.filter(card => pinnedIds.has(card.instanceId));
  const visibleCards = sorted.filter(card => !pinnedIds.has(card.instanceId));

  return {
    displayMode: getHandDisplayMode(cards.length, options.compactThreshold),
    pinnedCards,
    visibleCards,
    filteredCount: searched.length,
    groups: groupHandCards(visibleCards, groupMode),
  };
}

export function sortHandCards(cards: CardState[], sortMode: HandSortMode): CardState[] {
  if (sortMode === 'manual') return [...cards];
  const cardSortMode: CardSortMode = sortMode === 'cardType' ? 'cardType' : sortMode;
  return sortCards(cards, cardSortMode);
}

export function groupHandCards(cards: CardState[], groupMode: HandGroupMode): HandGroup[] {
  if (groupMode === 'all') return [{ key: 'all', label: GROUP_LABELS.all, cards }];

  const groups = GROUP_ORDER
    .map(key => ({ key, label: GROUP_LABELS[key], cards: cards.filter(card => getHandGroupKey(card) === key) }))
    .filter(group => group.cards.length > 0);

  return groups.length > 0 ? groups : [{ key: 'other', label: GROUP_LABELS.other, cards: [] }];
}

export function getHandGroupKey(card: CardState): Exclude<HandGroupMode, 'all'> {
  if (isLand(card)) return 'lands';
  if (isCreature(card)) return 'creatures';
  if (hasHandCardType(card, 'Instant') || hasHandCardType(card, 'Sorcery')) return 'spells';
  if (isArtifact(card) || isEnchantment(card)) return 'artifactsEnchantments';
  return 'other';
}

function hasHandCardType(card: CardState, type: string): boolean {
  const types = card.definition?.cardTypes ?? [];
  const typeLine = card.definition?.typeLine ?? '';
  return types.some(cardType => cardType.toLowerCase() === type.toLowerCase())
    || new RegExp(`\\b${type}\\b`, 'i').test(typeLine);
}
