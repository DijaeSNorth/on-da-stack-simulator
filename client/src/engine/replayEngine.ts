import type { ActionRecord, CardState, GameState, Phase, Player } from '../types/game';
import { DEFAULT_REPLAY_WATCH_PARTY_STATE } from './replayWatchParty';
import type {
  ExportReplayOptions,
  ReplayCheckpoint as ReplayStateCheckpoint,
  ReplayFile,
  ReplayFileValidationResult,
  ReplayPlayerSummary,
  ReplaySession,
  ReplaySpeed,
  ReplayTimelineMarker,
  ReplayTimelineMarkerKind,
  ReplayBookmark,
  ReplayClip,
  ReplayReviewNote,
} from '../types/replay';

export const SUPPORTED_REPLAY_VERSION = '2.0.0';
export const DEFAULT_REPLAY_CHECKPOINT_INTERVAL = 25;
export const DEFAULT_REPLAY_CREATOR_SETTINGS = {
  showTimeline: true,
  showActionCaption: true,
  showPlayerPanels: true,
  showLifeTotals: true,
  showCommanderNames: true,
  streamerSafeMode: true,
};
const REPLAY_STORAGE_KEY = 'mtg-replays-v1';
const MAX_STORED_REPLAYS = 10;

export interface ReplayClipInput {
  title: string;
  startActionIndex: number;
  endActionIndex: number;
  tags?: string[];
  description?: string;
  createdAt?: number;
  clipId?: string;
}

export interface ReplayClipValidationResult {
  ok: boolean;
  errors: string[];
}

export interface ReplayCheckpoint {
  actionIndex: number;
  state: string;
  label: string;
}

export interface ReplayMeta {
  id: string;
  name: string;
  savedAt: number;
  turnCount: number;
  playerNames: string[];
  actionCount: number;
  durationMs: number;
  format: string;
}

export interface Replay {
  meta: ReplayMeta;
  actionLog: ActionRecord[];
  checkpoints: ReplayCheckpoint[];
}

export const ACTION_COLORS: Record<string, string> = {
  CAST_SPELL: '#60a5fa',
  ACTIVATE_ABILITY: '#a78bfa',
  PUT_ON_STACK: '#22d3ee',
  RESOLVE_STACK: '#14b8a6',
  COUNTER_SPELL: '#f87171',
  MOVE_CARD: '#94a3b8',
  TAP: '#f59e0b',
  UNTAP: '#84cc16',
  ATTACH: '#c084fc',
  DETACH: '#c084fc',
  ADD_COUNTER: '#34d399',
  REMOVE_COUNTER: '#fb7185',
  CHANGE_LIFE: '#f97316',
  COMMANDER_DAMAGE: '#ef4444',
  DECLARE_ATTACKER: '#dc2626',
  DECLARE_BLOCKER: '#2563eb',
  PASS_PRIORITY: '#64748b',
  CHANGE_PHASE: '#38bdf8',
  DRAW_CARD: '#22c55e',
  DISCARD: '#eab308',
  SHUFFLE: '#64748b',
  SEARCH_LIBRARY: '#818cf8',
  ADD_TOKEN: '#2dd4bf',
  REMOVE_TOKEN: '#f43f5e',
  GAME_START: '#10b981',
  GAME_END: '#f43f5e',
  MULLIGAN: '#f59e0b',
  NOTE: '#e5e7eb',
  FLAG: '#facc15',
  SNAPSHOT: '#93c5fd',
  OTHER: '#94a3b8',
};

function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSupportedVersion(version: string): boolean {
  return version === SUPPORTED_REPLAY_VERSION || version.startsWith('2.');
}

function normalizeReplayFile(raw: unknown): ReplayFile | null {
  if (!isRecord(raw)) return null;
  const replayFile = raw as Partial<ReplayFile>;
  if (!replayFile.replayVersion || !replayFile.initialGameState || !Array.isArray(replayFile.actionLog) || !Array.isArray(replayFile.players)) {
    return null;
  }
  return {
    replayVersion: String(replayFile.replayVersion),
    exportedAt: typeof replayFile.exportedAt === 'number' ? replayFile.exportedAt : Date.now(),
    gameId: String(replayFile.gameId ?? replayFile.initialGameState.id ?? 'unknown-game'),
    gameName: replayFile.gameName,
    rulesetVersion: replayFile.rulesetVersion ?? replayFile.initialGameState.rulesetVersion,
    appVersion: replayFile.appVersion,
    buildCommit: replayFile.buildCommit,
    mode: replayFile.mode === 'multiplayer' ? 'multiplayer' : 'solo',
    players: replayFile.players,
    initialGameState: replayFile.initialGameState,
    actionLog: replayFile.actionLog,
    finalGameState: replayFile.finalGameState,
    privacy: replayFile.privacy ?? { includesPrivateZones: false },
  };
}

export function validateReplayFile(raw: unknown): ReplayFileValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { ok: false, errors: ['Replay file must be a JSON object.'], warnings };
  }
  if (!raw.replayVersion) errors.push('Replay file is missing replayVersion.');
  if (!raw.initialGameState) errors.push('Replay file is missing initialGameState.');
  if (!Array.isArray(raw.actionLog)) errors.push('Replay file actionLog must be an array.');
  if (!Array.isArray(raw.players) || raw.players.length === 0) errors.push('Replay file players must be a non-empty array.');
  if (typeof raw.replayVersion === 'string' && !isSupportedVersion(raw.replayVersion)) {
    errors.push(`Unsupported replayVersion "${raw.replayVersion}". Supported version is ${SUPPORTED_REPLAY_VERSION}.`);
  }
  const replayFile = normalizeReplayFile(raw);
  if (errors.length > 0 || !replayFile) return { ok: false, errors, warnings };
  if (!replayFile.gameName) warnings.push('Replay file has no gameName.');
  if (!replayFile.appVersion) warnings.push('Replay file has no appVersion metadata.');
  return { ok: true, replayFile, errors, warnings };
}

function setPlayerZone(player: Player, zone: CardState['zone'], ids: string[]): Player {
  switch (zone) {
    case 'library': return { ...player, library: ids };
    case 'hand': return { ...player, hand: ids };
    case 'battlefield': return { ...player, battlefield: ids };
    case 'graveyard': return { ...player, graveyard: ids };
    case 'exile': return { ...player, exile: ids };
    case 'command': return { ...player, commandZone: ids };
    case 'sideboard': return { ...player, sideboard: ids };
    case 'maybeboard': return { ...player, maybeboard: ids };
    default: return player;
  }
}

function removeCardFromPlayerZones(player: Player, cardId: string): Player {
  return {
    ...player,
    hand: player.hand.filter(id => id !== cardId),
    library: player.library.filter(id => id !== cardId),
    battlefield: player.battlefield.filter(id => id !== cardId),
    graveyard: player.graveyard.filter(id => id !== cardId),
    exile: player.exile.filter(id => id !== cardId),
    sideboard: player.sideboard.filter(id => id !== cardId),
    maybeboard: player.maybeboard.filter(id => id !== cardId),
    commandZone: player.commandZone.filter(id => id !== cardId),
  };
}

function addCardToZone(player: Player, zone: CardState['zone'], cardId: string): Player {
  const key = zone === 'command' ? 'commandZone' : zone;
  if (key === 'stack') return player;
  const current = key === 'commandZone' ? player.commandZone : player[key as keyof Player];
  if (!Array.isArray(current) || current.includes(cardId)) return player;
  return setPlayerZone(player, zone, [...current, cardId]);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function phaseFromData(action: ActionRecord): Phase | undefined {
  const value = asString(action.data?.to) ?? asString(action.data?.phase);
  return value as Phase | undefined;
}

function applyReplayAction(state: GameState, action: ActionRecord): { state: GameState; warning?: string } {
  let next = cloneGameState(state);
  const data = action.data ?? {};
  try {
    switch (action.actionType) {
      case 'CHANGE_PHASE': {
        const phase = phaseFromData(action);
        next = {
          ...next,
          turn: Number.isFinite(action.turn) ? action.turn : next.turn,
          phase: phase ?? action.phase ?? next.phase,
        };
        break;
      }
      case 'CHANGE_LIFE': {
        const playerId = asString(data.playerId) ?? action.playerId;
        const delta = asNumber(data.delta) ?? asNumber(data.amount) ?? 0;
        next = {
          ...next,
          players: next.players.map(player => player.id === playerId ? { ...player, life: player.life + delta } : player),
        };
        break;
      }
      case 'COMMANDER_DAMAGE': {
        const playerId = asString(data.playerId) ?? action.playerId;
        const commanderId = asString(data.commanderId) ?? action.affectedObjects[0] ?? 'unknown';
        const amount = asNumber(data.amount) ?? asNumber(data.damage) ?? 0;
        next = {
          ...next,
          players: next.players.map(player => player.id === playerId
            ? { ...player, commanderDamage: { ...player.commanderDamage, [commanderId]: (player.commanderDamage[commanderId] ?? 0) + amount } }
            : player),
        };
        break;
      }
      case 'TAP':
      case 'UNTAP': {
        const tapped = action.actionType === 'TAP';
        const cards = { ...next.cards };
        for (const id of action.affectedObjects ?? []) {
          if (cards[id]) cards[id] = { ...cards[id], tapped };
        }
        next = { ...next, cards };
        break;
      }
      case 'MOVE_CARD':
      case 'DRAW_CARD':
      case 'DISCARD': {
        const cardIds = action.affectedObjects ?? [];
        const toZone = (asString(data.toZone) ?? asString(data.to) ?? (action.actionType === 'DRAW_CARD' ? 'hand' : action.actionType === 'DISCARD' ? 'graveyard' : undefined)) as CardState['zone'] | undefined;
        if (!toZone) return { state: next, warning: `Action ${action.id} MOVE_CARD has no target zone.` };
        const cards = { ...next.cards };
        let players = next.players;
        for (const cardId of cardIds) {
          const card = cards[cardId];
          if (!card) continue;
          const controllerId = asString(data.toController) ?? asString(data.controllerId) ?? card.controllerId;
          cards[cardId] = { ...card, zone: toZone, controllerId };
          players = players.map(player => removeCardFromPlayerZones(player, cardId));
          players = players.map(player => player.id === controllerId ? addCardToZone(player, toZone, cardId) : player);
        }
        next = { ...next, cards, players };
        break;
      }
      case 'DECLARE_ATTACKER': {
        const attackers = action.affectedObjects.map(instanceId => ({
          instanceId,
          targetPlayerId: asString(data.targetPlayerId) ?? asString(data.defenderId) ?? '',
          targets: [],
        }));
        next = {
          ...next,
          combat: { ...next.combat, active: true, attackers: [...next.combat.attackers, ...attackers] },
          cards: action.affectedObjects.reduce((cards, id) => cards[id] ? { ...cards, [id]: { ...cards[id], tapped: true, combatRole: 'attacker' as const } } : cards, next.cards),
        };
        break;
      }
      case 'DECLARE_BLOCKER': {
        const blockedAttacker = asString(data.attackerId) ?? asString(data.blockedAttacker) ?? '';
        next = {
          ...next,
          combat: {
            ...next.combat,
            active: true,
            blockers: [
              ...next.combat.blockers,
              ...action.affectedObjects.map(instanceId => ({ instanceId, blockedAttacker })),
            ],
          },
        };
        break;
      }
      case 'PASS_PRIORITY': {
        next = {
          ...next,
          priorityPlayerId: action.playerId,
          players: next.players.map(player => ({ ...player, hasPriority: player.id === action.playerId })),
        };
        break;
      }
      case 'GAME_START':
      case 'GAME_END':
      case 'CAST_SPELL':
      case 'ACTIVATE_ABILITY':
      case 'PUT_ON_STACK':
      case 'RESOLVE_STACK':
      case 'COUNTER_SPELL':
      case 'ADD_COUNTER':
      case 'REMOVE_COUNTER':
      case 'REMOVE_ALL_COUNTERS':
      case 'ADD_TOKEN':
      case 'REMOVE_TOKEN':
      case 'ADD_MANA':
      case 'SPEND_MANA':
      case 'CLEAR_MANA':
      case 'MULLIGAN':
      case 'NOTE':
      case 'FLAG':
      case 'SNAPSHOT':
      case 'OTHER':
        break;
      default:
        return { state: next, warning: `Unsupported replay action ${action.actionType} at index ${action.id}.` };
    }
  } catch (error) {
    return { state: next, warning: `Replay action ${action.id} failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  return {
    state: {
      ...next,
      turn: Number.isFinite(action.turn) ? action.turn : next.turn,
      phase: action.phase ?? next.phase,
      actionLog: [...next.actionLog, action],
      lastUpdatedAt: action.timestamp || next.lastUpdatedAt,
    },
  };
}

export function createReplayCheckpointsWithWarnings(
  replayFile: ReplayFile,
  interval = DEFAULT_REPLAY_CHECKPOINT_INTERVAL,
): { checkpoints: ReplayStateCheckpoint[]; warnings: string[] } {
  const safeInterval = Math.max(1, Math.floor(interval));
  const checkpoints: ReplayStateCheckpoint[] = [{
    actionIndex: -1,
    turnNumber: replayFile.initialGameState.turn,
    createdAt: Date.now(),
    gameState: { ...cloneGameState(replayFile.initialGameState), actionLog: [] },
  }];
  const warnings: string[] = [];
  let state: GameState = { ...cloneGameState(replayFile.initialGameState), actionLog: [] };

  replayFile.actionLog.forEach((action, index) => {
    const result = applyReplayAction(state, action);
    state = result.state;
    if (result.warning) warnings.push(result.warning);
    const shouldCheckpoint = (index + 1) % safeInterval === 0 || index === replayFile.actionLog.length - 1;
    if (shouldCheckpoint) {
      checkpoints.push({
        actionIndex: index,
        turnNumber: state.turn,
        createdAt: Date.now(),
        gameState: cloneGameState(state),
      });
    }
  });

  return { checkpoints, warnings };
}

export function createReplayCheckpoints(
  replayFile: ReplayFile,
  interval = DEFAULT_REPLAY_CHECKPOINT_INTERVAL,
): ReplayStateCheckpoint[] {
  return createReplayCheckpointsWithWarnings(replayFile, interval).checkpoints;
}

function findNearestCheckpoint(
  checkpoints: ReplayStateCheckpoint[] | undefined,
  targetIndex: number,
): ReplayStateCheckpoint | undefined {
  if (!checkpoints?.length) return undefined;
  return checkpoints
    .filter(checkpoint => checkpoint.actionIndex <= targetIndex)
    .sort((a, b) => b.actionIndex - a.actionIndex)[0];
}

export function applyReplayToIndex(
  replayFile: ReplayFile,
  actionIndex: number,
  checkpoints?: ReplayStateCheckpoint[],
): { currentGameState: GameState; warnings: string[] } {
  const targetIndex = Math.max(-1, Math.min(actionIndex, replayFile.actionLog.length - 1));
  const checkpoint = findNearestCheckpoint(checkpoints, targetIndex);
  let state: GameState = checkpoint
    ? cloneGameState(checkpoint.gameState)
    : { ...cloneGameState(replayFile.initialGameState), actionLog: [] };
  const warnings: string[] = [];
  for (let index = (checkpoint?.actionIndex ?? -1) + 1; index <= targetIndex; index++) {
    const result = applyReplayAction(state, replayFile.actionLog[index]);
    state = result.state;
    if (result.warning) warnings.push(result.warning);
  }
  return { currentGameState: state, warnings };
}

export function getReplayClipReplayId(replayFile: ReplayFile): string {
  return `${replayFile.gameId}:${replayFile.exportedAt}`;
}

export function validateReplayClipRange(
  replayFile: ReplayFile,
  startActionIndex: number,
  endActionIndex: number,
  title = 'clip',
): ReplayClipValidationResult {
  const errors: string[] = [];
  const maxIndex = replayFile.actionLog.length - 1;
  if (!title.trim()) errors.push('Clip title is required.');
  if (!Number.isInteger(startActionIndex) || !Number.isInteger(endActionIndex)) {
    errors.push('Clip action indexes must be whole numbers.');
  }
  if (startActionIndex > endActionIndex) {
    errors.push('Clip startActionIndex must be before or equal to endActionIndex.');
  }
  if (startActionIndex < 0 || endActionIndex < 0 || startActionIndex > maxIndex || endActionIndex > maxIndex) {
    errors.push('Clip action indexes must be within the replay action log.');
  }
  if (replayFile.actionLog.length === 0) {
    errors.push('Cannot create a clip from an empty action log.');
  }
  return { ok: errors.length === 0, errors };
}

export function createReplayClip(
  replayFile: ReplayFile,
  input: ReplayClipInput,
): { clip?: ReplayClip; errors: string[] } {
  const title = input.title.trim();
  const validation = validateReplayClipRange(replayFile, input.startActionIndex, input.endActionIndex, title);
  if (!validation.ok) return { errors: validation.errors };
  return {
    clip: {
      clipId: input.clipId ?? `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      replayId: getReplayClipReplayId(replayFile),
      title,
      startActionIndex: input.startActionIndex,
      endActionIndex: input.endActionIndex,
      tags: input.tags?.map(tag => tag.trim()).filter(Boolean) ?? [],
      description: input.description?.trim() || undefined,
      createdAt: input.createdAt ?? Date.now(),
    },
    errors: [],
  };
}

export function getReplayClipDuration(replayFile: ReplayFile, clip: ReplayClip): { actionCount: number; turnCount: number } {
  const actions = replayFile.actionLog.slice(clip.startActionIndex, clip.endActionIndex + 1);
  return {
    actionCount: Math.max(0, clip.endActionIndex - clip.startActionIndex + 1),
    turnCount: new Set(actions.map(action => action.turn)).size,
  };
}

export function exportReplayClipMetadataJson(replayFile: ReplayFile, clip: ReplayClip): string {
  const duration = getReplayClipDuration(replayFile, clip);
  return JSON.stringify({
    replayId: clip.replayId,
    gameId: replayFile.gameId,
    gameName: replayFile.gameName,
    privacy: replayFile.privacy.includesPrivateZones ? 'private' : replayFile.privacy.redactedPlayers?.length ? 'redacted' : 'public',
    clip: {
      ...clip,
      actionCount: duration.actionCount,
      turnCount: duration.turnCount,
    },
  }, null, 2);
}

export function generateReplayClipSummary(replayFile: ReplayFile, clip: ReplayClip): string {
  const duration = getReplayClipDuration(replayFile, clip);
  const privacy = replayFile.privacy.includesPrivateZones ? 'Private' : replayFile.privacy.redactedPlayers?.length ? 'Redacted' : 'Public';
  return [
    `# ${clip.title}`,
    '',
    `Replay: ${replayFile.gameName || replayFile.gameId}`,
    `Privacy: ${privacy}`,
    `Actions: ${clip.startActionIndex + 1}-${clip.endActionIndex + 1} (${duration.actionCount})`,
    `Turns covered: ${duration.turnCount}`,
    clip.tags.length ? `Tags: ${clip.tags.join(', ')}` : '',
    clip.description ? `Description: ${clip.description}` : '',
  ].filter(Boolean).join('\n');
}

export function createReplaySession(replayFile: ReplayFile): ReplaySession {
  const { currentGameState, warnings } = applyReplayToIndex(replayFile, -1);
  return {
    replayFile,
    currentActionIndex: -1,
    currentGameState,
    status: 'loaded',
    speed: 1,
    warnings,
    checkpoints: undefined,
    checkpointInterval: DEFAULT_REPLAY_CHECKPOINT_INTERVAL,
    animationEnabled: false,
    animationMode: 'off',
    currentAnimations: [],
    animationSpeed: 1,
    animationQueue: [],
    reviewNotes: [],
    bookmarks: [],
    clips: [],
    clipDraft: {},
    viewMode: 'review',
    creatorSettings: { ...DEFAULT_REPLAY_CREATOR_SETTINGS },
    watchParty: {
      ...DEFAULT_REPLAY_WATCH_PARTY_STATE,
      playback: { ...DEFAULT_REPLAY_WATCH_PARTY_STATE.playback },
      viewers: [],
    },
  };
}

export function jumpReplayToAction(session: ReplaySession, actionIndex: number): ReplaySession {
  const targetIndex = Math.max(-1, Math.min(actionIndex, session.replayFile.actionLog.length - 1));
  const { currentGameState, warnings } = applyReplayToIndex(session.replayFile, targetIndex, session.checkpoints);
  return {
    ...session,
    currentActionIndex: targetIndex,
    currentGameState,
    status: session.status === 'playing' ? 'playing' : 'paused',
    warnings,
    currentAnimations: [],
    animationQueue: [],
  };
}

export function stepReplayForward(session: ReplaySession): ReplaySession {
  return jumpReplayToAction(session, session.currentActionIndex + 1);
}

export function stepReplayBackward(session: ReplaySession): ReplaySession {
  return jumpReplayToAction(session, session.currentActionIndex - 1);
}

export function jumpReplayToTurn(session: ReplaySession, turnNumber: number): ReplaySession {
  const index = session.replayFile.actionLog.findIndex(action => action.turn >= turnNumber);
  return jumpReplayToAction(session, index >= 0 ? index : session.replayFile.actionLog.length - 1);
}

function markerTypeForAction(action: ActionRecord): ReplayTimelineMarkerKind | null {
  const type = action.actionType;
  const text = `${type} ${action.description ?? ''}`.toLowerCase();
  if ((action.flags ?? []).length > 0 || type === 'FLAG') return 'warning';
  if (type === 'CHANGE_PHASE' && (action.phase === 'untap' || /\bturn\b/i.test(action.description ?? ''))) return 'turn';
  if (type === 'DECLARE_ATTACKER' || type === 'DECLARE_BLOCKER' || text.includes('combat') || text.includes('attack') || text.includes('block')) return 'combat';
  if (type === 'CAST_SPELL' || type === 'CAST' || type === 'PUT_ON_STACK' || type === 'RESOLVE_STACK' || type === 'COUNTER_SPELL') return 'spell';
  if (type === 'ACTIVATE_ABILITY' || type === 'CHOOSE_MODE') return 'ability';
  if (type === 'CHANGE_LIFE' || type === 'COMMANDER_DAMAGE' || text.includes('damage')) return 'damage';
  if (type === 'MOVE_CARD' || type === 'DRAW_CARD' || type === 'DISCARD' || type === 'SHUFFLE' || type === 'SEARCH_LIBRARY') return 'zone_change';
  if (['SCRY', 'SURVEIL', 'CYCLE', 'DREDGE', 'PROLIFERATE', 'TUTOR', 'REANIMATE'].includes(type) || /\b(airbend|warp|firebend|waterbend|earthbend|sneak|station|blight|vivid)\b/i.test(text)) return 'mechanic';
  if (type === 'NOTE' || type === 'OTHER' || type === 'SNAPSHOT' || type === 'UNDO' || type === 'REDO') return 'manual';
  return 'warning';
}

function markerSeverity(type: ReplayTimelineMarkerKind): ReplayTimelineMarker['severity'] {
  if (type === 'warning') return 'warning';
  if (type === 'turn' || type === 'combat' || type === 'damage' || type === 'checkpoint') return 'important';
  return 'info';
}

function safeReplayMarkerLabel(replayFile: ReplayFile, action: ActionRecord, type: ReplayTimelineMarkerKind): string {
  const privateReplay = replayFile.privacy.includesPrivateZones;
  if (privateReplay) return action.description || action.actionType;
  const player = replayFile.players.find(summary => summary.playerId === action.playerId)?.displayName ?? 'A player';
  if (type === 'spell') return `${player} cast a spell`;
  if (type === 'zone_change') return `${player} moved a card`;
  if (action.actionType === 'DRAW_CARD') return `${player} drew a card`;
  if (type === 'turn') return `Turn ${action.turn}`;
  if (type === 'combat') return `${player} combat action`;
  if (type === 'damage') return `${player} damage/life change`;
  if (type === 'warning') return `Review action ${action.actionType}`;
  return action.description || action.actionType;
}

export function getReplayTimelineMarkers(
  replayFile: ReplayFile,
  checkpoints?: ReplayStateCheckpoint[],
  review?: { notes?: ReplayReviewNote[]; bookmarks?: ReplayBookmark[] },
): ReplayTimelineMarker[] {
  const markers: ReplayTimelineMarker[] = [];
  let lastTurn: number | null = null;
  replayFile.actionLog.forEach((action, actionIndex) => {
    if (action.turn !== lastTurn) {
      markers.push({
        id: `turn-${action.turn}-${actionIndex}`,
        actionIndex,
        turnNumber: action.turn,
        type: 'turn',
        label: `Turn ${action.turn}`,
        severity: 'important',
      });
      lastTurn = action.turn;
    }
    const type = markerTypeForAction(action);
    if (!type || type === 'turn') return;
    markers.push({
      id: `${type}-${action.id}-${actionIndex}`,
      actionIndex,
      turnNumber: action.turn,
      type,
      label: safeReplayMarkerLabel(replayFile, action, type),
      severity: markerSeverity(type),
    });
  });
  for (const checkpoint of checkpoints ?? []) {
    markers.push({
      id: `checkpoint-${checkpoint.actionIndex}`,
      actionIndex: Math.max(-1, checkpoint.actionIndex),
      turnNumber: checkpoint.turnNumber,
      type: 'checkpoint',
      label: checkpoint.actionIndex < 0 ? 'Initial checkpoint' : `Checkpoint ${checkpoint.actionIndex + 1}`,
      severity: 'info',
    });
  }
  for (const note of review?.notes ?? []) {
    markers.push({
      id: `note-${note.noteId}`,
      actionIndex: note.actionIndex,
      turnNumber: note.turnNumber,
      type: 'note',
      label: note.title || `${note.type.replace(/_/g, ' ')} note`,
      severity: note.type === 'mistake' || note.type === 'rules_question' ? 'warning' : 'info',
    });
  }
  for (const bookmark of review?.bookmarks ?? []) {
    markers.push({
      id: `bookmark-${bookmark.bookmarkId}`,
      actionIndex: bookmark.actionIndex,
      turnNumber: bookmark.turnNumber,
      type: 'bookmark',
      label: bookmark.label,
      severity: bookmark.type === 'mistake' || bookmark.type === 'rules' ? 'warning' : 'important',
    });
  }
  return markers.sort((a, b) => a.actionIndex - b.actionIndex || markerSort(a.type) - markerSort(b.type));
}

function markerSort(type: ReplayTimelineMarkerKind): number {
  if (type === 'checkpoint') return 0;
  if (type === 'turn') return 1;
  if (type === 'warning') return 2;
  if (type === 'bookmark') return 3;
  if (type === 'note') return 4;
  return 5;
}

function summarizePlayers(game: GameState): ReplayPlayerSummary[] {
  return game.players.map(player => ({
    playerId: player.id,
    displayName: player.name,
    seatIndex: player.seatIndex,
    commanderNames: player.commanders.map(id => game.cards[id]?.definition.name).filter(Boolean),
    deckName: player.deckId,
  }));
}

function collectHiddenCardNames(game: GameState): Set<string> {
  const names = new Set<string>();
  for (const player of game.players) {
    for (const id of [...player.hand, ...player.library, ...player.sideboard, ...player.maybeboard]) {
      const name = game.cards[id]?.definition?.name;
      if (name) names.add(name);
    }
  }
  return names;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeHiddenNames(description: string, hiddenNames: Set<string>): string {
  let text = description;
  for (const name of hiddenNames) {
    if (!name.trim()) continue;
    text = text.replace(new RegExp(escapeRegExp(name), 'gi'), 'a hidden card');
  }
  return text;
}

function actionTouchesHiddenCard(action: ActionRecord, game: GameState): boolean {
  return (action.affectedObjects ?? []).some(id => {
    const card = game.cards[id];
    return card?.zone === 'hand' || card?.zone === 'library' || card?.zone === 'sideboard' || card?.zone === 'maybeboard';
  });
}

function redactedPrivateActionDescription(action: ActionRecord, game: GameState): string {
  const player = game.players.find(item => item.id === action.playerId)?.name ?? 'A player';
  if (action.actionType === 'DRAW_CARD') return `${player} drew a card.`;
  if (action.actionType === 'SEARCH_LIBRARY') return `${player} searched a library.`;
  if (action.actionType === 'SCRY') return `${player} performed a private scry action.`;
  if (action.actionType === 'SURVEIL') return `${player} performed a private surveil action.`;
  if (action.actionType === 'DISCARD') return `${player} discarded a card.`;
  if (action.actionType === 'CAST' || action.actionType === 'CAST_SPELL') return `${player} cast a spell.`;
  if (action.actionType === 'MOVE_CARD') return `${player} moved a hidden card.`;
  return sanitizeHiddenNames(action.description || action.actionType, collectHiddenCardNames(game));
}

function redactAction(action: ActionRecord, game: GameState): ActionRecord {
  const privateKeys = new Set([
    'privateChoices',
    'privateChoice',
    'choice',
    'choices',
    'hand',
    'library',
    'sideboard',
    'maybeboard',
    'viewerId',
    'cardIds',
    'milled',
    'revealed',
    'lookedAt',
    'scry',
    'surveil',
    'search',
  ]);
  const data = Object.fromEntries(Object.entries(action.data ?? {}).filter(([key]) => !privateKeys.has(key)));
  const privateAction = action.data?.private === true || actionTouchesHiddenCard(action, game);
  const description = privateAction
    ? redactedPrivateActionDescription(action, game)
    : sanitizeHiddenNames(action.description || action.actionType, collectHiddenCardNames(game));
  const affectedObjects = (action.affectedObjects ?? []).filter(id => {
    const card = game.cards[id];
    return !(card?.zone === 'hand' || card?.zone === 'library' || card?.zone === 'sideboard' || card?.zone === 'maybeboard');
  });
  return { ...action, description, affectedObjects, data };
}

export function redactGameStateForPublicReplay(state: GameState): GameState {
  const cards = { ...state.cards };
  const players = state.players.map(player => {
    const hiddenIds = [...player.hand, ...player.library, ...player.sideboard, ...player.maybeboard];
    for (const id of hiddenIds) delete cards[id];
    return {
      ...player,
      hand: Array.from({ length: player.hand.length }, (_, index) => `redacted-hand-${player.id}-${index}`),
      library: Array.from({ length: player.library.length }, (_, index) => `redacted-library-${player.id}-${index}`),
      sideboard: [],
      maybeboard: [],
    };
  });
  const visibleDefinitionIds = new Set(Object.values(cards).map(card => card.definitionId));
  const definitions = Object.fromEntries(
    Object.entries(state.definitions).filter(([id]) => visibleDefinitionIds.has(id)),
  );
  const actionLog = state.actionLog.map(action => redactAction(action, state));
  return { ...cloneGameState(state), players, cards, definitions, actionLog };
}

export function createReplayFileFromGame(
  game: GameState,
  options: ExportReplayOptions,
  metadata: { gameName?: string; appVersion?: string; buildCommit?: string; mode?: 'solo' | 'multiplayer' } = {},
): ReplayFile {
  const initialGameState = options.redacted || !options.includePrivateZones
    ? redactGameStateForPublicReplay(game)
    : cloneGameState(game);
  const finalGameState = options.includeFinalSnapshot
    ? (options.redacted || !options.includePrivateZones ? redactGameStateForPublicReplay(game) : cloneGameState(game))
    : undefined;
  return {
    replayVersion: SUPPORTED_REPLAY_VERSION,
    exportedAt: Date.now(),
    gameId: game.id,
    gameName: metadata.gameName,
    rulesetVersion: game.rulesetVersion,
    appVersion: metadata.appVersion,
    buildCommit: metadata.buildCommit,
    mode: metadata.mode ?? (game.config.playerCount > 1 ? 'multiplayer' : 'solo'),
    players: summarizePlayers(game),
    initialGameState,
    actionLog: options.redacted || !options.includePrivateZones ? game.actionLog.map(action => redactAction(action, game)) : [...game.actionLog],
    finalGameState,
    privacy: {
      includesPrivateZones: options.includePrivateZones && !options.redacted,
      redactedPlayers: options.redacted || !options.includePrivateZones ? game.players.map(player => player.id) : undefined,
    },
  };
}

export function createReplay(game: GameState, name = 'Untitled Replay'): Replay {
  const actionLog = [...game.actionLog];
  const turnCount = Math.max(game.turn, ...actionLog.map(action => action.turn), 1);
  const firstTime = actionLog[0]?.timestamp ?? game.createdAt;
  const lastTime = actionLog[actionLog.length - 1]?.timestamp ?? game.lastUpdatedAt;
  return {
    meta: {
      id: `replay-${game.id}-${Date.now()}`,
      name,
      savedAt: Date.now(),
      turnCount,
      playerNames: game.players.map(player => player.name),
      actionCount: actionLog.length,
      durationMs: Math.max(0, lastTime - firstTime),
      format: game.config.format,
    },
    actionLog,
    checkpoints: [{ actionIndex: -1, state: JSON.stringify(game), label: 'Initial state' }],
  };
}

export function exportReplayAsJSON(replay: Replay): string {
  return JSON.stringify(replay, null, 2);
}

export function importReplayFromJSON(json: string): Replay | null {
  try {
    const replay = JSON.parse(json) as Replay;
    if (!replay?.meta?.id || !Array.isArray(replay.actionLog) || !Array.isArray(replay.checkpoints)) return null;
    return replay;
  } catch {
    return null;
  }
}

export function loadReplaysFromStorage(): Replay[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(REPLAY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReplayToStorage(replay: Replay): void {
  if (typeof localStorage === 'undefined') return;
  const replays = loadReplaysFromStorage().filter(item => item.meta.id !== replay.meta.id);
  localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify([replay, ...replays].slice(0, MAX_STORED_REPLAYS)));
}

export function deleteReplayFromStorage(id: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(loadReplaysFromStorage().filter(replay => replay.meta.id !== id)));
}

export function getActionsUpTo(replay: Replay, actionIndex: number): ActionRecord[] {
  return replay.actionLog.slice(0, Math.max(0, actionIndex) + 1);
}

export function groupActionsByTurn(actions: ActionRecord[]): { turn: number; phase: Phase; actions: ActionRecord[] }[] {
  const groups = new Map<string, { turn: number; phase: Phase; actions: ActionRecord[] }>();
  for (const action of actions) {
    const key = `${action.turn}-${action.phase}`;
    const existing = groups.get(key) ?? { turn: action.turn, phase: action.phase, actions: [] };
    existing.actions.push(action);
    groups.set(key, existing);
  }
  return [...groups.values()];
}

export function describeAction(action: ActionRecord): string {
  return action.description?.trim() || `${action.playerId} ${action.actionType}`;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function replaySpeedToDelay(speed: ReplaySpeed): number {
  if (speed === 'instant') return 0;
  return Math.max(40, Math.round(700 / speed));
}
