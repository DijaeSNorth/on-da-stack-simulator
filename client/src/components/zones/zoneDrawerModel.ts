import type { CardState, Player, Zone } from '../../types/game';
import type { SyncStatus } from '../../engine/multiplayerSync';
import { filterCards, groupCards, sortCards, type CardGroupMode, type CardSortMode } from '../../engine/cardFilter';
import { canControlPlayer, isPrivateZone } from '../../engine/playerPermissions';
import { getMechanicHint, getMechanicsForCard } from '../../rules/mechanicsRegistry';

export const LARGE_ZONE_THRESHOLD = 30;

export type ZoneDrawerZone = 'graveyard' | 'exile' | 'library' | 'hand' | 'command';
export type ZoneSortMode = 'order' | 'newest' | 'oldest' | 'name' | 'manaValue' | 'cardType' | 'color';
export type ZoneGroupMode = 'none' | 'cardType' | 'manaValue' | 'color' | 'owner' | 'controller';
export type ZoneDisplayMode = 'grid' | 'compact';

export interface ZonePrivacyOptions {
  zone: ZoneDrawerZone;
  playerId: string;
  localPlayerId?: string | null;
  multiplayerStatus: SyncStatus | 'spectator';
  judgeMode: boolean;
  privateView?: boolean;
  viewerId?: string;
}

export interface ZoneViewOptions {
  search?: string;
  sortMode?: ZoneSortMode;
  groupMode?: ZoneGroupMode;
  canViewCards: boolean;
  totalCount?: number;
}

export interface ZoneGroup {
  key: string;
  label: string;
  cards: CardState[];
}

export interface ZoneViewModel {
  displayMode: ZoneDisplayMode;
  groups: ZoneGroup[];
  visibleCards: CardState[];
  filteredCount: number;
  totalCount: number;
  hiddenMessage?: string;
}

export function getZoneCardIds(player: Player, zone: ZoneDrawerZone): string[] {
  switch (zone) {
    case 'graveyard': return player.graveyard ?? [];
    case 'exile': return player.exile ?? [];
    case 'library': return player.library ?? [];
    case 'hand': return player.hand ?? [];
    case 'command': return player.commandZone ?? player.commanders ?? [];
  }
}

export function canViewZoneCards(options: ZonePrivacyOptions): boolean {
  const canControlZone = canControlPlayer(
    options.localPlayerId,
    options.playerId,
    options.multiplayerStatus,
    options.judgeMode,
  );

  return options.judgeMode || (
    (!options.privateView || !options.viewerId || options.viewerId === options.localPlayerId) &&
    (!isPrivateZone(options.zone as Zone) || canControlZone)
  );
}

export function getZonePrivacyLabel(zone: ZoneDrawerZone, totalCount: number, canViewCards: boolean): string | undefined {
  if (canViewCards) return undefined;
  const label = isPrivateZone(zone as Zone) ? 'Hidden private zone' : 'Hidden zone';
  return `${label} - ${totalCount} card${totalCount === 1 ? '' : 's'}`;
}

export function buildZoneDrawerView(cards: CardState[], options: ZoneViewOptions): ZoneViewModel {
  const totalCount = options.totalCount ?? cards.length;
  if (!options.canViewCards) {
    return {
      displayMode: 'compact',
      groups: [],
      visibleCards: [],
      filteredCount: 0,
      totalCount,
      hiddenMessage: `Hidden private zone - ${totalCount} card${totalCount === 1 ? '' : 's'}`,
    };
  }

  const searched = filterCards(cards, { query: options.search?.trim() || undefined });
  const sorted = sortZoneCards(searched, options.sortMode ?? 'order');
  const groups = groupZoneCards(sorted, options.groupMode ?? 'none');

  return {
    displayMode: totalCount >= LARGE_ZONE_THRESHOLD ? 'compact' : 'grid',
    groups,
    visibleCards: sorted,
    filteredCount: searched.length,
    totalCount,
  };
}

export function sortZoneCards(cards: CardState[], sortMode: ZoneSortMode): CardState[] {
  if (sortMode === 'order' || sortMode === 'oldest') return [...cards];
  if (sortMode === 'newest') return [...cards].reverse();
  const mapped: CardSortMode = sortMode === 'cardType' ? 'cardType' : sortMode;
  return sortCards(cards, mapped);
}

export function groupZoneCards(cards: CardState[], groupMode: ZoneGroupMode): ZoneGroup[] {
  if (groupMode === 'none') return [{ key: 'all', label: 'All cards', cards }];
  if (groupMode === 'owner' || groupMode === 'controller') return groupByPlayer(cards, groupMode);

  const mapped: CardGroupMode = groupMode;
  return groupCards(cards, mapped).map(group => ({
    key: group.key,
    label: group.label,
    cards: group.cards,
  }));
}

export function getExilePermissionLabels(card: CardState): string[] {
  const labels: string[] = [];
  const permission = card.exilePermission;
  if (permission?.sourceMechanic === 'airbend') labels.push('Airbend permission');
  if (permission?.sourceMechanic === 'warp') labels.push('Warp permission');
  if (permission?.alternativeCost) labels.push(`Cast ${permission.alternativeCost}`);

  for (const mechanic of getMechanicsForCard(card)) {
    if ((mechanic.id === 'airbend' || mechanic.id === 'warp') && !labels.some(label => label.toLowerCase().includes(mechanic.id))) {
      labels.push(`${mechanic.name} permission`);
    }
  }

  return labels;
}

export function getExilePermissionTitle(card: CardState): string {
  const permission = card.exilePermission;
  if (permission?.sourceMechanic === 'airbend') return 'Airbended - owner may cast this from exile; normal timing applies.';
  if (permission?.sourceMechanic === 'warp') return 'Warp - may be cast from exile using its permission.';
  const mechanic = getMechanicsForCard(card).find(entry => entry.id === 'airbend' || entry.id === 'warp');
  return mechanic ? getMechanicHint(mechanic.id, 'exile') : 'Cast from exile permission.';
}

function groupByPlayer(cards: CardState[], mode: 'owner' | 'controller'): ZoneGroup[] {
  const groups = new Map<string, ZoneGroup>();
  for (const card of cards) {
    const key = mode === 'owner' ? card.ownerId : card.controllerId;
    const label = `${mode === 'owner' ? 'Owner' : 'Controller'}: ${key || 'Unknown'}`;
    if (!groups.has(key || 'unknown')) groups.set(key || 'unknown', { key: key || 'unknown', label, cards: [] });
    groups.get(key || 'unknown')!.cards.push(card);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
