import type { CardState, GameState, ManaCost, Zone } from '../types/game';
import { getEffectiveCardDefinition } from './cardFaces';

export interface CommanderCastSuggestion {
  commanderInstanceId: string;
  commanderName: string;
  message: string;
  priority: number;
  action: 'cast' | 'move-to-command' | 'status';
}

export interface CommanderCastCheckOptions {
  judgeMode?: boolean;
}

function getPlayer(game: GameState, playerId: string) {
  return game.players.find(player => player.id === playerId);
}

function isMainPhase(phase: GameState['phase']): boolean {
  return phase === 'main1' || phase === 'main2';
}

function isCommanderForPlayer(game: GameState, playerId: string, commanderInstanceId: string): boolean {
  const player = getPlayer(game, playerId);
  const card = game.cards[commanderInstanceId];
  return Boolean(player && card && player.commanders.includes(commanderInstanceId) && card.ownerId === playerId);
}

function formatManaCost(cost: ManaCost | undefined): string {
  return cost?.raw?.trim() || '{0}';
}

export function getPlayerCommanders(game: GameState, playerId: string): CardState[] {
  const player = getPlayer(game, playerId);
  if (!player) return [];
  return player.commanders.map(id => game.cards[id]).filter((card): card is CardState => Boolean(card));
}

export function getCommanderZoneCards(game: GameState, playerId: string): CardState[] {
  return getPlayerCommanders(game, playerId).filter(card => card.zone === 'command');
}

export function getCommanderCastCount(game: GameState, playerId: string, commanderInstanceId: string): number {
  const player = getPlayer(game, playerId);
  const value = player?.commanderCastCount?.[commanderInstanceId] ?? 0;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getCommanderTax(game: GameState, playerId: string, commanderInstanceId: string): number {
  if (!game.config.commanderTaxEnabled) return 0;
  return getCommanderCastCount(game, playerId, commanderInstanceId) * 2;
}

export function getCommanderTotalCost(card: CardState | undefined, commanderTax: number): string {
  if (!card) return '';
  const baseCost = formatManaCost(getEffectiveCardDefinition(card).manaCost);
  return commanderTax > 0 ? `${baseCost} + {${commanderTax}}` : baseCost;
}

export function getCommanderCastDisabledReason(
  game: GameState,
  playerId: string,
  commanderInstanceId: string,
  options: CommanderCastCheckOptions = {},
): string | null {
  const player = getPlayer(game, playerId);
  const card = game.cards[commanderInstanceId];
  if (!player || !card) return 'Commander not found.';
  if (player.isSpectator) return 'Spectators cannot cast commanders.';
  if (!options.judgeMode && !isCommanderForPlayer(game, playerId, commanderInstanceId)) {
    return 'You can only cast your own commander.';
  }
  if (card.zone === 'battlefield') return 'This commander is already on the battlefield.';
  if (card.zone !== 'command') return 'Commander is not in the command zone.';
  if (!options.judgeMode && game.status === 'playing' && game.activePlayerId !== playerId) return 'Not your turn.';
  if (!options.judgeMode && game.status === 'playing' && !isMainPhase(game.phase)) return 'Not a main phase.';
  return null;
}

export function canCastCommander(
  game: GameState,
  playerId: string,
  commanderInstanceId: string,
  options: CommanderCastCheckOptions = {},
): boolean {
  return getCommanderCastDisabledReason(game, playerId, commanderInstanceId, options) === null;
}

export function getCommanderCastSuggestions(game: GameState, playerId: string): CommanderCastSuggestion[] {
  const commanders = getPlayerCommanders(game, playerId);
  const player = getPlayer(game, playerId);
  const hasBoard = Boolean(player?.battlefield.length);
  const suggestions: CommanderCastSuggestion[] = [];

  for (const commander of commanders) {
    const tax = getCommanderTax(game, playerId, commander.instanceId);
    const disabledReason = getCommanderCastDisabledReason(game, playerId, commander.instanceId);
    if (!disabledReason) {
      suggestions.push({
        commanderInstanceId: commander.instanceId,
        commanderName: commander.definition.name,
        message: `You can cast ${commander.definition.name} from the command zone.`,
        priority: hasBoard ? 40 : 65,
        action: 'cast',
      });
      if (tax > 0) {
        suggestions.push({
          commanderInstanceId: commander.instanceId,
          commanderName: commander.definition.name,
          message: `${commander.definition.name} costs +${tax} commander tax.`,
          priority: 50,
          action: 'status',
        });
      }
      continue;
    }

    if (commander.zone === 'graveyard' || commander.zone === 'exile') {
      suggestions.push({
        commanderInstanceId: commander.instanceId,
        commanderName: commander.definition.name,
        message: `You can move ${commander.definition.name} to the command zone.`,
        priority: 55,
        action: 'move-to-command',
      });
    }
  }

  return suggestions.sort((a, b) => b.priority - a.priority || a.commanderName.localeCompare(b.commanderName));
}

export function canMoveCommanderToCommandZone(game: GameState, playerId: string, commanderInstanceId: string, fromZone?: Zone): boolean {
  const card = game.cards[commanderInstanceId];
  if (!card || card.ownerId !== playerId) return false;
  if (!getPlayer(game, playerId)?.commanders.includes(commanderInstanceId)) return false;
  if (card.zone === 'command') return false;
  if (fromZone && card.zone !== fromZone) return false;
  return card.zone === 'graveyard' || card.zone === 'exile' || card.zone === 'hand' || card.zone === 'library';
}
