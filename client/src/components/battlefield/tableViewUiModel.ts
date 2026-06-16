import type { CardState, GameState, Player } from '../../types/game';
import { canBattlefieldCardBlock } from './battlefieldUiModel';
import { isArtifact, isCreature, isEnchantment, isLand, isPlaneswalker } from '../../engine/gameEngine';

export type TableViewMode = 'table' | 'focused' | 'player_focused' | 'combat' | 'compact' | 'free_layout';
export type LocalBoardSize = 'normal' | 'large' | 'full';
export type LocalBoardPosition = 'bottom' | 'center' | 'left' | 'right';

export interface BoardFrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoardLayoutPreferences {
  mode: TableViewMode;
  focusedOpponentId?: string;
  localBoardSize: LocalBoardSize;
  localBoardPosition: LocalBoardPosition;
  compactOpponents: boolean;
  editLayoutMode: boolean;
  collapsedSectionsByPlayer: Record<string, string[]>;
  freeLayoutPositions: Record<string, BoardFrameRect>;
}

export interface BoardInteractionLink {
  id: string;
  kind: 'attack' | 'block' | 'target' | 'damage';
  fromPlayerId?: string;
  toPlayerId?: string;
  sourceInstanceId?: string;
  targetInstanceId?: string;
  label: string;
}

export const DEFAULT_BOARD_LAYOUT_PREFERENCES: BoardLayoutPreferences = {
  mode: 'player_focused',
  focusedOpponentId: undefined,
  localBoardSize: 'large',
  localBoardPosition: 'bottom',
  compactOpponents: true,
  editLayoutMode: false,
  collapsedSectionsByPlayer: {},
  freeLayoutPositions: {},
};

export interface PlayerBoardSummary {
  playerId: string;
  creatures: number;
  tokens: number;
  untappedBlockers: number;
  artifactsEnchantments: number;
  lands: number;
  planeswalkers: number;
  permanents: number;
  handCount: number;
  libraryCount: number;
  connected: boolean;
  isAttackingPlayer: boolean;
  isDefendingPlayer: boolean;
}

export function getPlayerBoardSummary(game: GameState, player: Player): PlayerBoardSummary {
  const cards = getPlayerBattlefieldCards(game, player);
  const defendingIds = getCombatDefendingPlayerIds(game);
  return {
    playerId: player.id,
    creatures: cards.filter(isCreature).length,
    tokens: cards.filter(card => card.token).length,
    untappedBlockers: cards.filter(canBattlefieldCardBlock).length,
    artifactsEnchantments: cards.filter(card => isArtifact(card) || isEnchantment(card)).length,
    lands: cards.filter(isLand).length,
    planeswalkers: cards.filter(isPlaneswalker).length,
    permanents: cards.length,
    handCount: player.hand.length,
    libraryCount: player.library.length,
    connected: player.connected,
    isAttackingPlayer: game.combat.active && game.combat.attackingPlayerId === player.id,
    isDefendingPlayer: defendingIds.has(player.id),
  };
}

export function getTableViewModeLabel(mode: TableViewMode): string {
  switch (mode) {
    case 'table': return 'Table View';
    case 'player_focused': return 'Player-Focused Board View';
    case 'focused': return 'Focused Player View';
    case 'combat': return 'Combat Focus View';
    case 'compact': return 'Compact Board Grid';
    case 'free_layout': return 'Free Board Layout';
  }
}

export function getCombatDefendingPlayerIds(game: GameState): Set<string> {
  const ids = new Set<string>();
  for (const attacker of game.combat.attackers ?? []) {
    ids.add(attacker.targetPlayerId);
    const target = attacker.attackTarget;
    if (target?.type === 'player') ids.add(target.playerId);
    if (target?.type === 'planeswalker') ids.add(target.controllerId);
    if (target?.type === 'battle') ids.add(target.protectorId);
  }
  for (const assignment of game.combat.attackAssignments ?? []) {
    if (assignment.attackTarget.type === 'player') ids.add(assignment.attackTarget.playerId);
    if (assignment.attackTarget.type === 'planeswalker') ids.add(assignment.attackTarget.controllerId);
    if (assignment.attackTarget.type === 'battle') ids.add(assignment.attackTarget.protectorId);
  }
  return ids;
}

export function isPlayerCombatRelevant(game: GameState, playerId: string): boolean {
  if (!game.combat.active && game.combat.attackers.length === 0 && (game.combat.attackAssignments?.length ?? 0) === 0) return false;
  return game.combat.attackingPlayerId === playerId || getCombatDefendingPlayerIds(game).has(playerId);
}

export function chooseFocusedPlayerId(game: GameState, requestedId: string | null | undefined, localPlayerId: string | null | undefined): string | undefined {
  if (requestedId && game.players.some(player => player.id === requestedId)) return requestedId;
  if (localPlayerId && game.players.some(player => player.id === localPlayerId)) return localPlayerId;
  return game.players[0]?.id;
}

export function chooseFocusedOpponentId(game: GameState, requestedId: string | null | undefined, localPlayerId: string | null | undefined): string | undefined {
  const opponents = game.players.filter(player => player.id !== localPlayerId);
  if (requestedId && opponents.some(player => player.id === requestedId)) return requestedId;
  const defendingIds = getCombatDefendingPlayerIds(game);
  const combatDefender = opponents.find(player => defendingIds.has(player.id));
  if (combatDefender) return combatDefender.id;
  const activeOpponent = opponents.find(player => player.id === game.activePlayerId);
  if (activeOpponent) return activeOpponent.id;
  return opponents[0]?.id;
}

export function normalizeTableViewMode(value: unknown): TableViewMode {
  return value === 'table' || value === 'focused' || value === 'player_focused' || value === 'combat' || value === 'compact' || value === 'free_layout'
    ? value
    : 'player_focused';
}

export function normalizeBoardLayoutPreferences(value: Partial<BoardLayoutPreferences> | null | undefined): BoardLayoutPreferences {
  const localBoardSize = value?.localBoardSize === 'normal' || value?.localBoardSize === 'large' || value?.localBoardSize === 'full'
    ? value.localBoardSize
    : DEFAULT_BOARD_LAYOUT_PREFERENCES.localBoardSize;
  const localBoardPosition = value?.localBoardPosition === 'bottom' || value?.localBoardPosition === 'center' || value?.localBoardPosition === 'left' || value?.localBoardPosition === 'right'
    ? value.localBoardPosition
    : DEFAULT_BOARD_LAYOUT_PREFERENCES.localBoardPosition;
  return {
    ...DEFAULT_BOARD_LAYOUT_PREFERENCES,
    ...value,
    mode: normalizeTableViewMode(value?.mode),
    focusedOpponentId: typeof value?.focusedOpponentId === 'string' ? value.focusedOpponentId : undefined,
    localBoardSize,
    localBoardPosition,
    compactOpponents: value?.compactOpponents ?? DEFAULT_BOARD_LAYOUT_PREFERENCES.compactOpponents,
    editLayoutMode: value?.editLayoutMode ?? DEFAULT_BOARD_LAYOUT_PREFERENCES.editLayoutMode,
    collapsedSectionsByPlayer: value?.collapsedSectionsByPlayer && typeof value.collapsedSectionsByPlayer === 'object' ? value.collapsedSectionsByPlayer : {},
    freeLayoutPositions: value?.freeLayoutPositions && typeof value.freeLayoutPositions === 'object' ? value.freeLayoutPositions : {},
  };
}

export function getPlayerBoardLayoutRole(
  playerId: string,
  localPlayerId: string | null | undefined,
  focusedOpponentId: string | null | undefined,
  mode: TableViewMode,
  game: GameState,
): 'local_primary' | 'focused_opponent' | 'combat_relevant' | 'compact_opponent' | 'standard' {
  const isLocal = playerId === localPlayerId;
  if (mode === 'player_focused') {
    if (isLocal) return 'local_primary';
    if (playerId === focusedOpponentId) return 'focused_opponent';
    if (isPlayerCombatRelevant(game, playerId)) return 'combat_relevant';
    return 'compact_opponent';
  }
  if (mode === 'combat') {
    if (isPlayerCombatRelevant(game, playerId)) return isLocal ? 'local_primary' : 'combat_relevant';
    return 'compact_opponent';
  }
  if (mode === 'focused') {
    if (playerId === focusedOpponentId || isLocal) return isLocal ? 'local_primary' : 'focused_opponent';
    return 'compact_opponent';
  }
  return isLocal ? 'local_primary' : 'standard';
}

export function isDragCombatEnabledForBoardLayout(preferences: BoardLayoutPreferences): boolean {
  return !preferences.editLayoutMode;
}

export function buildBoardInteractionLinks(game: GameState): BoardInteractionLink[] {
  const links: BoardInteractionLink[] = [];
  for (const attacker of game.combat.attackers ?? []) {
    const source = game.cards[attacker.instanceId];
    const targetPlayerId = attacker.attackTarget?.type === 'player'
      ? attacker.attackTarget.playerId
      : attacker.attackTarget?.type === 'planeswalker'
        ? attacker.attackTarget.controllerId
        : attacker.attackTarget?.type === 'battle'
          ? attacker.attackTarget.protectorId
          : attacker.targetPlayerId;
    links.push({
      id: `attack-${attacker.instanceId}-${targetPlayerId}`,
      kind: 'attack',
      fromPlayerId: source?.controllerId,
      toPlayerId: targetPlayerId,
      sourceInstanceId: attacker.instanceId,
      targetInstanceId: attacker.attackTarget?.type === 'planeswalker' || attacker.attackTarget?.type === 'battle' ? attacker.attackTarget.permanentId : undefined,
      label: `${source?.definition.name ?? 'Attacker'} attacks`,
    });
  }
  for (const blocker of game.combat.blockers ?? []) {
    const source = game.cards[blocker.instanceId];
    const target = game.cards[blocker.blockedAttacker];
    links.push({
      id: `block-${blocker.instanceId}-${blocker.blockedAttacker}`,
      kind: 'block',
      fromPlayerId: source?.controllerId,
      toPlayerId: target?.controllerId,
      sourceInstanceId: blocker.instanceId,
      targetInstanceId: blocker.blockedAttacker,
      label: `${source?.definition.name ?? 'Blocker'} blocks ${target?.definition.name ?? 'attacker'}`,
    });
  }
  return links;
}

function getPlayerBattlefieldCards(game: GameState, player: Player): CardState[] {
  return player.battlefield.map(id => game.cards[id]).filter(Boolean) as CardState[];
}
