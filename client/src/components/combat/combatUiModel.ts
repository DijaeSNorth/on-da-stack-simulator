import { getLegalAttackTargetsForPlayer } from '../../engine/gameEngine';
import type { AttackDefenderTarget, CardState, CombatAttackAssignment, GameState, Player } from '../../types/game';

export interface AttackTargetGroup {
  player: Player;
  playerTarget: AttackDefenderTarget;
  planeswalkers: Array<Extract<AttackDefenderTarget, { type: 'planeswalker' }>>;
  battles: Array<Extract<AttackDefenderTarget, { type: 'battle' }>>;
}

export interface CombatAssignmentSummary {
  key: string;
  text: string;
  targetLabel: string;
  count: number;
  sourceName: string;
  isTokenStack: boolean;
}

export function groupLegalAttackTargetsByOpponent(game: GameState, attackingPlayerId: string): AttackTargetGroup[] {
  const legalTargets = getLegalAttackTargetsForPlayer(game, attackingPlayerId);
  return game.players
    .filter(player => player.id !== attackingPlayerId)
    .map(player => ({
      player,
      playerTarget: legalTargets.find(target => target.type === 'player' && target.playerId === player.id) ?? { type: 'player', playerId: player.id },
      planeswalkers: legalTargets.filter((target): target is Extract<AttackDefenderTarget, { type: 'planeswalker' }> => target.type === 'planeswalker' && target.controllerId === player.id),
      battles: legalTargets.filter((target): target is Extract<AttackDefenderTarget, { type: 'battle' }> => target.type === 'battle' && target.protectorId === player.id),
    }));
}

export function formatAttackTargetLabel(game: GameState, target: AttackDefenderTarget): string {
  if (target.type === 'player') {
    const player = game.players.find(entry => entry.id === target.playerId);
    return player ? `${player.name} (${player.life})` : target.playerId;
  }
  const card = game.cards[target.permanentId];
  if (target.type === 'planeswalker') {
    const controller = game.players.find(player => player.id === target.controllerId);
    return `${card?.definition.name ?? 'Planeswalker'}${controller ? ` - ${controller.name}` : ''}`;
  }
  const protector = game.players.find(player => player.id === target.protectorId);
  return `${card?.definition.name ?? 'Battle'}${protector ? ` - protected by ${protector.name}` : ''}`;
}

export function buildCombatAssignmentSummaries(game: GameState): CombatAssignmentSummary[] {
  return (game.combat.attackAssignments ?? []).map(assignment => {
    const targetLabel = formatAttackTargetLabel(game, assignment.attackTarget);
    const noun = assignment.count === 1 ? assignment.sourceName : pluralizeSourceName(assignment.sourceName);
    const suffix = isLikelySneakAssignment(game, assignment) ? ' (Sneak)' : '';
    return {
      key: assignment.assignmentId,
      text: `${assignment.count} ${noun}${suffix} attacking ${targetLabel}`,
      targetLabel,
      count: assignment.count,
      sourceName: assignment.sourceName,
      isTokenStack: assignment.isTokenStack,
    };
  });
}

export function getAttackerBlockBadge(attackerId: string, blockedAttackerIds: Set<string>): 'blocked' | 'unblocked' {
  return blockedAttackerIds.has(attackerId) ? 'blocked' : 'unblocked';
}

export function getPendingBlockedAttackerIds(pendingBlockers: Array<{ attackerInstanceId: string }>): Set<string> {
  return new Set(pendingBlockers.map(blocker => blocker.attackerInstanceId));
}

export function getBlockerLegalityIssue(blocker: CardState, attacker: CardState): string | undefined {
  if (!blocker.definition.cardTypes.includes('Creature')) return 'Not a creature.';
  if (blocker.tapped) return 'Tapped creatures cannot block.';
  if (hasKeywordOrText(blocker, "can't block") || hasKeywordOrText(blocker, 'cannot block')) return 'This creature cannot block.';
  if (hasKeywordOrText(attacker, 'flying') && !hasKeywordOrText(blocker, 'flying') && !hasKeywordOrText(blocker, 'reach')) {
    return 'Needs flying or reach to block flying.';
  }
  const attackerShadow = hasKeywordOrText(attacker, 'shadow');
  const blockerShadow = hasKeywordOrText(blocker, 'shadow');
  if (attackerShadow && !blockerShadow) return 'Needs shadow to block shadow.';
  if (!attackerShadow && blockerShadow) return 'Shadow cannot block non-shadow.';
  if (hasKeywordOrText(attacker, 'intimidate')) {
    const sharedColor = attacker.definition.colors.some(color => blocker.definition.colors.includes(color));
    const artifact = blocker.definition.cardTypes.includes('Artifact');
    if (!artifact && !sharedColor) return 'Intimidate needs artifact or shared color.';
  }
  const protection = getProtectionIssue(blocker, attacker);
  if (protection) return protection;
  return undefined;
}

export function classifyCombatWarning(warning: string): 'unsupported' | 'manual' | 'unknownPT' | 'trampleDeathtouch' | 'general' {
  const lower = warning.toLowerCase();
  if (lower.includes('unknown') || lower.includes('variable p/t')) return 'unknownPT';
  if (lower.includes('trample') || lower.includes('deathtouch')) return 'trampleDeathtouch';
  if (lower.includes('prevent') || lower.includes('requires manual combat-damage review')) return 'unsupported';
  if (lower.includes('manual')) return 'manual';
  return 'general';
}

function isLikelySneakAssignment(game: GameState, assignment: CombatAttackAssignment): boolean {
  const sneakEvents = game.turnTrackers.sneakCastsThisTurn ?? [];
  return assignment.attackerIds.some(id => sneakEvents.some(event => event.cardId === id));
}

function pluralizeSourceName(sourceName: string): string {
  if (/s$/i.test(sourceName)) return sourceName;
  if (/token$/i.test(sourceName)) return `${sourceName}s`;
  return `${sourceName}s`;
}

function hasKeywordOrText(card: CardState, value: string): boolean {
  const lower = value.toLowerCase();
  return (card.definition.keywords ?? []).some(keyword => keyword.toLowerCase() === lower)
    || String(card.definition.oracleText ?? '').toLowerCase().includes(lower);
}

function getProtectionIssue(blocker: CardState, attacker: CardState): string | undefined {
  const oracle = String(attacker.definition.oracleText ?? '').toLowerCase();
  const matches = oracle.match(/protection from ([\w\s,]+?)(?:\.|,|\band\b|$)/g);
  if (!matches) return undefined;
  const colorNameToCode: Record<string, string> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  for (const match of matches) {
    const quality = match.replace('protection from ', '').replace(/[.,]+$/, '').trim();
    if (quality === 'everything') return 'Attacker has protection from everything.';
    const colorCode = colorNameToCode[quality];
    if (colorCode && blocker.definition.colors.includes(colorCode as CardState['definition']['colors'][number])) {
      return `Attacker has protection from ${quality}.`;
    }
    const lowerTypes = [...blocker.definition.cardTypes, ...blocker.definition.subTypes].map(type => type.toLowerCase());
    if (lowerTypes.includes(quality)) return `Attacker has protection from ${quality}.`;
  }
  return undefined;
}
