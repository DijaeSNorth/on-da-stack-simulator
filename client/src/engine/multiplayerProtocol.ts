import type { Deck, GameState, Player, PlayerAvatarImage } from '../types/game';
import { prepareCommanderDeckForUse } from './deckImport';

export const MULTIPLAYER_PROTOCOL_VERSION = 2;
const PLAYER_ID_KEY = 'on_da_stack_player_id_v2';
const MAX_PROTOCOL_SKEW_MS = 10 * 60 * 1000;

export type LobbyStatus = 'lobby' | 'starting' | 'playing' | 'ended';
export type DeckStatus = 'none' | 'submitted' | 'valid' | 'rejected';

export interface PlayerIdentity {
  playerId: string;
  sessionId: string;
}

export interface LobbyPlayer {
  playerId: string;
  peerId: string;
  sessionId: string;
  name: string;
  color: string;
  avatarInitial?: string;
  avatarStyle?: 'solid' | 'gradient' | 'outline';
  avatarImage?: PlayerAvatarImage;
  seatIndex: number;
  isSpectator: boolean;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
  deckStatus: DeckStatus;
  lastSeen: number;
}

export interface DeckSubmission {
  playerId: string;
  deckId: string;
  deckName: string;
  commanderNames: string[];
  cardCount: number;
  cards: { name: string; count: number }[];
  deckHash: string;
  submittedAt: number;
}

export interface SubmittedDeckPublicSummary {
  playerId: string;
  deckId: string;
  deckName: string;
  commanderNames: string[];
  cardCount: number;
  deckHash: string;
  status: DeckStatus;
  errors: string[];
  warnings: string[];
}

export interface LobbyState {
  roomId: string;
  roomCode: string;
  hostPeerId: string;
  players: Record<string, LobbyPlayer>;
  submittedDecks: Record<string, SubmittedDeckPublicSummary>;
  minPlayers: 2;
  maxPlayers: 6;
  status: LobbyStatus;
  updatedAt: number;
}

export interface PublicPlayerState {
  id: string;
  name: string;
  color: string;
  seatIndex: number;
  life: number;
  poisonCounters: number;
  energyCounters: number;
  experienceCounters: number;
  commanderDamage: Record<string, number>;
  commanderCastCount: Record<string, number>;
  commanders: string[];
  commandZone: string[];
  battlefield: string[];
  graveyard: string[];
  exile: string[];
  sideboardCount: number;
  maybeboardCount: number;
  handCount: number;
  libraryCount: number;
  connected: boolean;
  isSpectator: boolean;
  isActive: boolean;
  hasPriority: boolean;
  deckId?: string;
}

export interface PublicGameState {
  id: string;
  status: GameState['status'];
  turn: number;
  phase: GameState['phase'];
  activePlayerId: string;
  priorityPlayerId: string;
  players: PublicPlayerState[];
  cards: GameState['cards'];
  definitions: GameState['definitions'];
  stack: GameState['stack'];
  triggerQueue: GameState['triggerQueue'];
  actionLog: GameState['actionLog'];
  assistantFlags: GameState['assistantFlags'];
  combat: GameState['combat'];
  houseRules: GameState['houseRules'];
  lastUpdatedAt: number;
}

export interface PrivatePlayerState {
  playerId: string;
  hand: string[];
  library: string[];
  sideboard: string[];
  maybeboard: string[];
}

export interface StartGamePreparePayload {
  gameId: string;
  playerList: { playerId: string; peerId: string; seatIndex: number; deckId: string; deckHash: string }[];
  deckHashes: Record<string, string>;
  turnOrder: string[];
  deadline: number;
}

export interface StartGameAckPayload {
  gameId: string;
  playerId: string;
  peerId: string;
  deckId: string;
  deckHash: string;
  ready: true;
}

export interface GameStatePatchPayload {
  seq: number;
  publicGameState: PublicGameState;
  privatePlayerState?: PrivatePlayerState;
  sanitizedGame?: GameState;
}

export interface GameActionRequestPayload {
  actionSeq: number;
  actionType: string;
  params: Record<string, unknown>;
}

export type MultiplayerMessageType =
  | 'PRESENCE'
  | 'PRESENCE_BROADCAST'
  | 'LOBBY_STATE'
  | 'DECK_SUBMITTED'
  | 'DECK_VALIDATED'
  | 'DECK_REJECTED'
  | 'PLAYER_READY_CHANGED'
  | 'START_GAME_PREPARE'
  | 'START_GAME_ACK'
  | 'START_GAME_COMMIT'
  | 'GAME_ACTION_REQUEST'
  | 'GAME_STATE_RESYNC_REQUEST'
  | 'GAME_STATE_PATCH_REQUEST'
  | 'GAME_STATE_PATCH'
  | 'GAME_STATE'
  | 'HOST_MIGRATION'
  | 'LEAVE_ROOM'
  | 'KICKED'
  | 'PING'
  | 'PONG';

export interface MultiplayerMessage<TType extends MultiplayerMessageType = MultiplayerMessageType, TPayload = unknown> {
  protocolVersion: typeof MULTIPLAYER_PROTOCOL_VERSION;
  messageId: string;
  roomId: string;
  playerId: string;
  peerId: string;
  sessionId: string;
  sentAt: number;
  seq?: number;
  type: TType;
  payload: TPayload;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  message?: MultiplayerMessage;
}

const MESSAGE_TYPES = new Set<MultiplayerMessageType>([
  'PRESENCE',
  'PRESENCE_BROADCAST',
  'LOBBY_STATE',
  'DECK_SUBMITTED',
  'DECK_VALIDATED',
  'DECK_REJECTED',
  'PLAYER_READY_CHANGED',
  'START_GAME_PREPARE',
  'START_GAME_ACK',
  'START_GAME_COMMIT',
  'GAME_ACTION_REQUEST',
  'GAME_STATE_RESYNC_REQUEST',
  'GAME_STATE_PATCH_REQUEST',
  'GAME_STATE_PATCH',
  'GAME_STATE',
  'HOST_MIGRATION',
  'LEAVE_ROOM',
  'KICKED',
  'PING',
  'PONG',
]);

export function getOrCreateStablePlayerId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage()): string {
  const existing = storage?.getItem(PLAYER_ID_KEY);
  if (existing && isValidProtocolId(existing)) return existing;
  const playerId = `player-${crypto.randomUUID()}`;
  try {
    storage?.setItem(PLAYER_ID_KEY, playerId);
  } catch {
    // Session-only fallback still gives the protocol a player id.
  }
  return playerId;
}

export function createSessionId(): string {
  return `session-${crypto.randomUUID()}`;
}

export function makeMultiplayerMessage<TType extends MultiplayerMessageType, TPayload>({
  roomId,
  playerId,
  peerId,
  sessionId,
  type,
  payload,
  seq,
  sentAt = Date.now(),
}: {
  roomId: string;
  playerId: string;
  peerId: string;
  sessionId: string;
  type: TType;
  payload: TPayload;
  seq?: number;
  sentAt?: number;
}): MultiplayerMessage<TType, TPayload> {
  return {
    protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
    messageId: crypto.randomUUID(),
    roomId,
    playerId,
    peerId,
    sessionId,
    sentAt,
    seq,
    type,
    payload,
  };
}

export function validateMultiplayerMessage(raw: unknown, expectedRoomId?: string): ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'message must be an object' };
  const message = raw as Partial<MultiplayerMessage>;
  if (message.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) return { ok: false, reason: 'unsupported protocolVersion' };
  if (!isValidProtocolId(message.messageId)) return { ok: false, reason: 'missing messageId' };
  if (!isValidProtocolId(message.roomId)) return { ok: false, reason: 'invalid roomId' };
  if (expectedRoomId && message.roomId !== expectedRoomId) return { ok: false, reason: 'invalid roomId' };
  if (!isValidProtocolId(message.playerId)) return { ok: false, reason: 'missing playerId' };
  if (!isValidProtocolId(message.peerId)) return { ok: false, reason: 'missing peerId' };
  if (!isValidProtocolId(message.sessionId)) return { ok: false, reason: 'missing sessionId' };
  if (!message.type || !MESSAGE_TYPES.has(message.type)) return { ok: false, reason: 'unknown type' };
  if (!Number.isFinite(message.sentAt) || Math.abs(Date.now() - Number(message.sentAt)) > MAX_PROTOCOL_SKEW_MS) {
    return { ok: false, reason: 'invalid sentAt' };
  }
  if (message.seq !== undefined && (!Number.isInteger(message.seq) || message.seq < 0)) return { ok: false, reason: 'invalid seq' };
  return { ok: true, message: message as MultiplayerMessage };
}

export function createDeckSubmission(deck: Deck, playerId: string, submittedAt = Date.now()): DeckSubmission {
  const prepared = prepareCommanderDeckForUse(deck);
  const base = {
    playerId,
    deckId: prepared.deck.id,
    deckName: prepared.deck.name,
    commanderNames: [...prepared.deck.commanders],
    cardCount: prepared.totalCommanderCount,
    cards: prepared.deck.cards,
  };
  return {
    ...base,
    deckHash: prepared.deckHash,
    submittedAt,
  };
}

export function computeDeckHash(submission: Omit<DeckSubmission, 'deckHash' | 'submittedAt'>): string {
  return prepareCommanderDeckForUse({
    id: submission.deckId || 'submitted-deck',
    name: submission.deckName || 'Submitted deck',
    format: 'commander',
    commanders: submission.commanderNames,
    cards: submission.cards,
    sideboard: [],
    maybeboard: [],
    colorIdentity: [],
    importedAt: Date.now(),
  }).deckHash;
}

export function validateDeckSubmission(submission: DeckSubmission): { valid: boolean; errors: string[]; warnings: string[]; expectedHash: string } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prepared = prepareCommanderDeckForUse({
    id: submission.deckId || 'submitted-deck',
    name: submission.deckName || 'Submitted deck',
    format: 'commander',
    commanders: submission.commanderNames,
    cards: submission.cards,
    sideboard: [],
    maybeboard: [],
    colorIdentity: [],
    importedAt: submission.submittedAt,
  });
  const expectedHash = computeDeckHash(submission);
  if (!submission.playerId) errors.push('Missing playerId.');
  if (!submission.deckId) errors.push('Missing deckId.');
  if (prepared.commanderCount === 0) errors.push('Missing commander.');
  if (prepared.commanderCount > 2) errors.push(`Too many commanders: found ${prepared.commanderCount}.`);
  if (prepared.totalCommanderCount !== 100) errors.push(`Card count not 100: found ${prepared.totalCommanderCount}.`);
  if (submission.cardCount !== prepared.totalCommanderCount) errors.push(`Submitted card count mismatch: claimed ${submission.cardCount}, canonical count is ${prepared.totalCommanderCount}.`);
  if (submission.deckHash !== expectedHash) errors.push('Deck hash mismatch.');
  warnings.push(...prepared.warnings);
  return { valid: errors.length === 0, errors, warnings, expectedHash };
}

export function publicDeckSummary(submission: DeckSubmission, status: DeckStatus, warnings: string[] = [], errors: string[] = []): SubmittedDeckPublicSummary {
  return {
    playerId: submission.playerId,
    deckId: submission.deckId,
    deckName: submission.deckName,
    commanderNames: submission.commanderNames.slice(0, 2),
    cardCount: submission.cardCount,
    deckHash: submission.deckHash,
    status,
    errors: errors.slice(0, 6),
    warnings: warnings.slice(0, 4),
  };
}

export function canHostStartFromLobby(lobby: LobbyState): { canStart: boolean; reason?: string; seatedPlayers: LobbyPlayer[] } {
  const seatedPlayers = Object.values(lobby.players)
    .filter(player => player.connected && !player.isSpectator && player.seatIndex >= 0)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (lobby.status !== 'lobby') return { canStart: false, reason: 'Lobby is not ready.', seatedPlayers };
  if (seatedPlayers.length < lobby.minPlayers) return { canStart: false, reason: 'Need at least 2 seated players.', seatedPlayers };
  if (seatedPlayers.length > lobby.maxPlayers) return { canStart: false, reason: 'Too many seated players.', seatedPlayers };
  const missingDeck = seatedPlayers.find(player => lobby.submittedDecks[player.playerId]?.status !== 'valid');
  if (missingDeck) return { canStart: false, reason: `${missingDeck.name} needs a valid deck.`, seatedPlayers };
  const notReady = seatedPlayers.find(player => !player.ready);
  if (notReady) return { canStart: false, reason: `${notReady.name} is not ready.`, seatedPlayers };
  return { canStart: true, seatedPlayers };
}

export function createStartGamePrepare(lobby: LobbyState, gameId: string, deadline: number): StartGamePreparePayload {
  const { seatedPlayers } = canHostStartFromLobby(lobby);
  const playerList = seatedPlayers.map(player => {
    const deck = lobby.submittedDecks[player.playerId];
    return {
      playerId: player.playerId,
      peerId: player.peerId,
      seatIndex: player.seatIndex,
      deckId: deck?.deckId ?? '',
      deckHash: deck?.deckHash ?? '',
    };
  });
  return {
    gameId,
    playerList,
    deckHashes: Object.fromEntries(playerList.map(player => [player.playerId, player.deckHash])),
    turnOrder: playerList.map(player => player.playerId),
    deadline,
  };
}

export function createPublicGameState(game: GameState): PublicGameState {
  const hiddenCardIds = new Set(game.players.flatMap(player => [...player.hand, ...player.library]));
  const publicCards = Object.fromEntries(
    Object.entries(game.cards).filter(([id]) => !hiddenCardIds.has(id)),
  );
  return {
    id: game.id,
    status: game.status,
    turn: game.turn,
    phase: game.phase,
    activePlayerId: game.activePlayerId,
    priorityPlayerId: game.priorityPlayerId,
    players: game.players.map(player => publicPlayerState(player)),
    cards: publicCards,
    definitions: game.definitions,
    stack: game.stack,
    triggerQueue: game.triggerQueue,
    actionLog: game.actionLog,
    assistantFlags: game.assistantFlags,
    combat: game.combat,
    houseRules: game.houseRules,
    lastUpdatedAt: game.lastUpdatedAt,
  };
}

export function createPrivatePlayerState(game: GameState, playerId: string): PrivatePlayerState | undefined {
  const player = game.players.find(item => item.id === playerId);
  if (!player) return undefined;
  return {
    playerId,
    hand: [...player.hand],
    library: [...player.library],
    sideboard: [...player.sideboard],
    maybeboard: [...player.maybeboard],
  };
}

export function sanitizeGameStateForPlayer(game: GameState, viewerPlayerId: string): GameState {
  const hiddenIds = new Set<string>();
  const players = game.players.map(player => {
    if (player.id === viewerPlayerId) return player;
    for (const id of [...player.hand, ...player.library, ...player.sideboard, ...player.maybeboard]) hiddenIds.add(id);
    return {
      ...player,
      hand: Array.from({ length: player.hand.length }, (_, index) => `hidden-hand-${player.id}-${index}`),
      library: Array.from({ length: player.library.length }, (_, index) => `hidden-library-${player.id}-${index}`),
      sideboard: [],
      maybeboard: [],
    };
  });
  const cards = Object.fromEntries(
    Object.entries(game.cards).filter(([id]) => !hiddenIds.has(id)),
  );
  return { ...game, players, cards };
}

function publicPlayerState(player: Player): PublicPlayerState {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    seatIndex: player.seatIndex,
    life: player.life,
    poisonCounters: player.poisonCounters,
    energyCounters: player.energyCounters,
    experienceCounters: player.experienceCounters,
    commanderDamage: player.commanderDamage,
    commanderCastCount: player.commanderCastCount,
    commanders: player.commanders,
    commandZone: player.commandZone,
    battlefield: player.battlefield,
    graveyard: player.graveyard,
    exile: player.exile,
    sideboardCount: player.sideboard.length,
    maybeboardCount: player.maybeboard.length,
    handCount: player.hand.length,
    libraryCount: player.library.length,
    connected: player.connected,
    isSpectator: player.isSpectator,
    isActive: player.isActive,
    hasPriority: player.hasPriority,
    deckId: player.deckId,
  };
}

function isValidProtocolId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
