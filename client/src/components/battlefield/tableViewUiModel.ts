import type { CardState, GameState, Player } from '../../types/game';
import { canBattlefieldCardBlock } from './battlefieldUiModel';
import { isArtifact, isCreature, isEnchantment, isLand, isPlaneswalker } from '../../engine/gameEngine';

export type TableViewMode = 'table' | 'focused' | 'combat' | 'compact';

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
    case 'focused': return 'Focused Player View';
    case 'combat': return 'Combat Focus View';
    case 'compact': return 'Compact Board Grid';
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

function getPlayerBattlefieldCards(game: GameState, player: Player): CardState[] {
  return player.battlefield.map(id => game.cards[id]).filter(Boolean) as CardState[];
}
