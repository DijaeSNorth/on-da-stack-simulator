import type { ActionRecord, GameState } from '../types/game';
import type { ReplayAnimation, ReplayAnimationMode, ReplayPrivacy } from '../types/replay';

const MECHANIC_MATCHERS: { pattern: RegExp; type: ReplayAnimation['type']; label: string }[] = [
  { pattern: /\bfirebend|firebending\b/i, type: 'mechanic_firebending', label: 'Firebending' },
  { pattern: /\bairbend|airbending\b/i, type: 'mechanic_airbend', label: 'Airbend' },
  { pattern: /\bwaterbend|waterbending\b/i, type: 'mechanic_waterbend', label: 'Waterbend' },
  { pattern: /\bearthbend|earthbending\b/i, type: 'mechanic_earthbend', label: 'Earthbend' },
  { pattern: /\bwarp\b/i, type: 'mechanic_warp', label: 'Warp' },
  { pattern: /\bsneak\b/i, type: 'mechanic_sneak', label: 'Sneak' },
];

function playerName(game: GameState | undefined, playerId: string | undefined): string {
  if (!playerId) return 'A player';
  return game?.players.find(player => player.id === playerId)?.name ?? playerId;
}

function replayPrivacyKind(privacy?: ReplayPrivacy): ReplayAnimation['privacy'] {
  if (!privacy) return 'public';
  return privacy.includesPrivateZones ? 'private' : 'redacted';
}

function isRedacted(privacy?: ReplayPrivacy): boolean {
  return replayPrivacyKind(privacy) !== 'private';
}

function safeCardLabel(action: ActionRecord, game: GameState | undefined, privacy?: ReplayPrivacy): string {
  if (isRedacted(privacy)) {
    if (action.actionType === 'CAST_SPELL' || action.actionType === 'CAST') return 'a spell';
    return 'a card';
  }
  const firstCardId = action.affectedObjects?.[0];
  return firstCardId ? game?.cards[firstCardId]?.definition.name ?? 'a card' : 'a card';
}

function amountFromAction(action: ActionRecord): number | undefined {
  const data = action.data ?? {};
  const value = data.amount ?? data.delta ?? data.damage ?? data.count;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function durationFor(mode: ReplayAnimationMode, baseMs: number): number {
  if (mode === 'off') return 0;
  if (mode === 'simple') return Math.max(120, Math.round(baseMs * 0.65));
  return Math.round(baseMs * 1.25);
}

function intensityFor(mode: ReplayAnimationMode): ReplayAnimation['intensity'] {
  if (mode === 'simple') return 'subtle';
  if (mode === 'dramatic') return 'dramatic';
  return 'normal';
}

function animation(
  action: ActionRecord,
  type: ReplayAnimation['type'],
  label: string,
  privacy: ReplayAnimation['privacy'],
  mode: ReplayAnimationMode,
  extra: Partial<ReplayAnimation> = {},
): ReplayAnimation {
  return {
    id: `${action.id}-${type}`,
    type,
    actionId: action.id,
    playerId: action.playerId,
    cardIds: action.affectedObjects?.slice(0, 12),
    label,
    durationMs: durationFor(mode, extra.durationMs ?? 700),
    intensity: extra.intensity ?? intensityFor(mode),
    privacy,
    ...extra,
  };
}

export function createAnimationsForAction(
  action: ActionRecord,
  gameBefore?: GameState,
  gameAfter?: GameState,
  replayPrivacy?: ReplayPrivacy,
  mode: ReplayAnimationMode = 'dramatic',
): ReplayAnimation[] {
  if (mode === 'off') return [];
  const privacy = replayPrivacyKind(replayPrivacy);
  const actor = playerName(gameAfter ?? gameBefore, action.playerId);
  const text = `${action.actionType} ${action.description ?? ''}`.toLowerCase();

  for (const matcher of MECHANIC_MATCHERS) {
    if (matcher.pattern.test(text)) {
      return [animation(action, matcher.type, `${actor}: ${matcher.label}`, privacy, mode, { durationMs: 850 })];
    }
  }

  switch (action.actionType) {
    case 'DRAW_CARD':
      return [animation(action, 'draw_card', `${actor} drew ${isRedacted(replayPrivacy) ? 'a card' : safeCardLabel(action, gameAfter, replayPrivacy)}`, privacy, mode, {
        destinationZone: 'hand',
      })];
    case 'CAST':
    case 'CAST_SPELL':
      return [animation(action, 'cast_spell', `${actor} cast ${safeCardLabel(action, gameAfter, replayPrivacy)}`, privacy, mode, {
        sourceZone: 'hand',
        destinationZone: 'stack',
        durationMs: 900,
      })];
    case 'MOVE_CARD': {
      const sourceZone = typeof action.data?.fromZone === 'string' ? action.data.fromZone : undefined;
      const destinationZone = typeof action.data?.toZone === 'string' ? action.data.toZone : typeof action.data?.to === 'string' ? action.data.to : undefined;
      return [animation(action, 'move_card', `${actor} moved ${safeCardLabel(action, gameAfter, replayPrivacy)}`, privacy, mode, {
        sourceZone,
        destinationZone,
      })];
    }
    case 'DECLARE_ATTACKER': {
      const targetPlayerId = typeof action.data?.targetPlayerId === 'string' ? action.data.targetPlayerId : typeof action.data?.defenderId === 'string' ? action.data.defenderId : undefined;
      const count = action.affectedObjects?.length ?? 0;
      const label = count > 1
        ? `${count} attackers swung at ${playerName(gameAfter ?? gameBefore, targetPlayerId)}`
        : `${actor} attacked ${playerName(gameAfter ?? gameBefore, targetPlayerId)}`;
      return [animation(action, 'attack', label, privacy, mode, {
        targetPlayerId,
        durationMs: count > 8 ? 800 : 950,
      })];
    }
    case 'DECLARE_BLOCKER':
      return [animation(action, 'block', `${actor} blocked`, privacy, mode, {
        targetPermanentId: typeof action.data?.attackerId === 'string' ? action.data.attackerId : typeof action.data?.blockedAttacker === 'string' ? action.data.blockedAttacker : undefined,
      })];
    case 'CHANGE_LIFE':
      return [animation(action, 'life_change', `${actor} life ${amountFromAction(action) ?? ''}`.trim(), privacy, mode, {
        amount: amountFromAction(action),
        targetPlayerId: typeof action.data?.playerId === 'string' ? action.data.playerId : action.playerId,
      })];
    case 'COMMANDER_DAMAGE':
      return [animation(action, 'damage', `${actor} took commander damage`, privacy, mode, {
        amount: amountFromAction(action),
        targetPlayerId: typeof action.data?.playerId === 'string' ? action.data.playerId : action.playerId,
      })];
    case 'ADD_COUNTER':
    case 'REMOVE_COUNTER':
    case 'REMOVE_ALL_COUNTERS':
      return [animation(action, 'counter_change', `${actor} changed counters`, privacy, mode, { amount: amountFromAction(action) })];
    case 'ADD_TOKEN': {
      const count = Math.max(1, action.affectedObjects?.length || amountFromAction(action) || 1);
      return [animation(action, 'token_create', `${actor} created ${count} token${count === 1 ? '' : 's'}`, privacy, mode, {
        amount: count,
        durationMs: count > 12 ? 700 : 900,
      })];
    }
    case 'CHANGE_PHASE':
      if (action.phase === 'untap' || /\bturn\b/i.test(action.description ?? '')) {
        return [animation(action, 'turn_banner', `Turn ${action.turn}`, privacy, mode, { durationMs: 950 })];
      }
      return [];
    default:
      return [animation(action, 'manual', action.description || `${actor} ${action.actionType.toLowerCase().replace(/_/g, ' ')}`, privacy, mode, {
        durationMs: 550,
        intensity: 'subtle',
      })];
  }
}

export function scaleReplayAnimations(animations: ReplayAnimation[], animationSpeed: number): ReplayAnimation[] {
  const speed = Number.isFinite(animationSpeed) && animationSpeed > 0 ? animationSpeed : 1;
  return animations.map(item => ({ ...item, durationMs: Math.max(60, Math.round(item.durationMs / speed)) }));
}
