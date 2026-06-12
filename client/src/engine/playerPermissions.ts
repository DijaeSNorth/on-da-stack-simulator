import type { SyncStatus } from './multiplayerSync';
import type { CardState, GameState, Zone } from '../types/game';

export function canControlPlayer(
  localPlayerId: string | null | undefined,
  targetPlayerId: string | null | undefined,
  multiplayerStatus: SyncStatus | 'spectator',
  judgeMode: boolean,
): boolean {
  if (judgeMode) return true;
  if (multiplayerStatus === 'spectator') return false;
  if (
    multiplayerStatus === 'disconnected' ||
    multiplayerStatus === 'connecting' ||
    multiplayerStatus === 'connected' ||
    multiplayerStatus === 'error'
  ) {
    return true;
  }
  if (
    multiplayerStatus === 'host' ||
    multiplayerStatus === 'joined' ||
    multiplayerStatus === 'migrating'
  ) {
    return Boolean(localPlayerId && targetPlayerId && localPlayerId === targetPlayerId);
  }
  return Boolean(localPlayerId && targetPlayerId && localPlayerId === targetPlayerId);
}

export function isPrivateZone(zone: Zone): boolean {
  return zone === 'hand' || zone === 'library' || zone === 'sideboard' || zone === 'maybeboard';
}

export function findCardOwner(game: GameState, card: CardState | undefined): string | null {
  if (!card) return null;
  for (const player of game.players) {
    if (
      player.hand.includes(card.instanceId) ||
      player.library.includes(card.instanceId) ||
      player.sideboard.includes(card.instanceId) ||
      player.maybeboard.includes(card.instanceId) ||
      player.battlefield.includes(card.instanceId) ||
      player.graveyard.includes(card.instanceId) ||
      player.exile.includes(card.instanceId) ||
      player.commandZone.includes(card.instanceId)
    ) {
      return player.id;
    }
  }
  return card.controllerId;
}

export function canAccessPrivateCard(
  game: GameState,
  card: CardState | undefined,
  localPlayerId: string | null | undefined,
  multiplayerStatus: SyncStatus | 'spectator',
  judgeMode: boolean,
): boolean {
  if (!card || !isPrivateZone(card.zone)) return true;
  return canControlPlayer(localPlayerId, findCardOwner(game, card), multiplayerStatus, judgeMode);
}
