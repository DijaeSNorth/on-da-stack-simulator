import type { ActionRecord, GameState } from './game';

export type ReplayMode = 'solo' | 'multiplayer';
export type ReplayStatus = 'idle' | 'loaded' | 'playing' | 'paused' | 'error';
export type ReplaySpeed = 0.5 | 1 | 2 | 'instant';
export type ReplayAnimationMode = 'off' | 'simple' | 'dramatic';
export type ReplayViewMode = 'normal' | 'review' | 'creator';
export type ReplayWatchPartyRole = 'none' | 'host' | 'presenter' | 'viewer';
export type ReplayWatchPartySyncMode = 'presenter_sync' | 'free_scrub';

export type ReplayAnimationType =
  | 'draw_card'
  | 'cast_spell'
  | 'move_card'
  | 'attack'
  | 'block'
  | 'damage'
  | 'life_change'
  | 'counter_change'
  | 'token_create'
  | 'mechanic_firebending'
  | 'mechanic_airbend'
  | 'mechanic_waterbend'
  | 'mechanic_earthbend'
  | 'mechanic_warp'
  | 'mechanic_sneak'
  | 'turn_banner'
  | 'manual';

export interface ReplayAnimation {
  id: string;
  type: ReplayAnimationType;
  actionId?: string;
  playerId?: string;
  cardIds?: string[];
  sourceZone?: string;
  destinationZone?: string;
  targetPlayerId?: string;
  targetPermanentId?: string;
  amount?: number;
  label: string;
  durationMs: number;
  intensity: 'subtle' | 'normal' | 'dramatic';
  privacy: 'public' | 'private' | 'redacted';
}

export interface ReplayPlayerSummary {
  playerId: string;
  displayName: string;
  seatIndex: number;
  commanderNames?: string[];
  deckName?: string;
  deckHash?: string;
}

export interface ReplayPrivacy {
  includesPrivateZones: boolean;
  redactedPlayers?: string[];
}

export interface ReplayFile {
  replayVersion: string;
  exportedAt: number;
  gameId: string;
  gameName?: string;
  rulesetVersion?: string;
  appVersion?: string;
  buildCommit?: string;
  mode: ReplayMode;
  players: ReplayPlayerSummary[];
  initialGameState: GameState;
  actionLog: ActionRecord[];
  finalGameState?: GameState;
  privacy: ReplayPrivacy;
}

export interface ReplayFileValidationResult {
  ok: boolean;
  replayFile?: ReplayFile;
  errors: string[];
  warnings: string[];
}

export interface ReplayCheckpoint {
  actionIndex: number;
  turnNumber?: number;
  createdAt: number;
  gameState: GameState;
}

export type ReplayReviewNoteType =
  | 'mistake'
  | 'good_play'
  | 'rules_question'
  | 'deck_issue'
  | 'combat_decision'
  | 'mulligan_decision'
  | 'mana_issue'
  | 'highlight'
  | 'content_clip'
  | 'general';

export interface ReplayReviewNote {
  noteId: string;
  replayId: string;
  actionIndex: number;
  turnNumber?: number;
  createdAt: number;
  updatedAt?: number;
  authorName?: string;
  type: ReplayReviewNoteType;
  title?: string;
  body: string;
  tags: string[];
}

export type ReplayBookmarkType =
  | 'turning_point'
  | 'combat'
  | 'combo'
  | 'mistake'
  | 'highlight'
  | 'rules'
  | 'custom';

export interface ReplayBookmark {
  bookmarkId: string;
  replayId: string;
  actionIndex: number;
  turnNumber?: number;
  createdAt: number;
  label: string;
  color?: string;
  type: ReplayBookmarkType;
}

export interface ReplayClip {
  clipId: string;
  replayId: string;
  title: string;
  startActionIndex: number;
  endActionIndex: number;
  tags: string[];
  description?: string;
  createdAt: number;
}

export interface ReplayCreatorSettings {
  showTimeline: boolean;
  showActionCaption: boolean;
  showPlayerPanels: boolean;
  showLifeTotals: boolean;
  showCommanderNames: boolean;
  streamerSafeMode: boolean;
}

export interface ReplayWatchViewer {
  viewerId: string;
  displayName: string;
  role: 'host' | 'presenter' | 'viewer';
  online: boolean;
  lastSeen: number;
}

export interface ReplayWatchPartyPlayback {
  actionIndex: number;
  status: 'paused' | 'playing';
  speed: number;
  animationMode: ReplayAnimationMode;
  updatedAt: number;
  controlledBy?: string;
}

export interface ReplayWatchComment {
  commentId: string;
  watchRoomCode: string;
  actionIndex: number;
  viewerId: string;
  displayName: string;
  createdAt: number;
  expiresAt?: number;
  body: string;
  type: 'comment' | 'question' | 'reaction';
}

export interface ReplayWatchPartyState {
  watchRoomCode?: string;
  role: ReplayWatchPartyRole;
  syncMode: ReplayWatchPartySyncMode;
  playback: ReplayWatchPartyPlayback;
  viewers: ReplayWatchViewer[];
}

export interface ReplaySession {
  replayFile: ReplayFile;
  currentActionIndex: number;
  currentGameState: GameState;
  status: ReplayStatus;
  speed: ReplaySpeed;
  warnings: string[];
  checkpoints?: ReplayCheckpoint[];
  checkpointInterval: number;
  animationEnabled: boolean;
  animationMode: ReplayAnimationMode;
  currentAnimations: ReplayAnimation[];
  animationSpeed: number;
  animationQueue?: ReplayAnimation[];
  reviewNotes: ReplayReviewNote[];
  bookmarks: ReplayBookmark[];
  clips: ReplayClip[];
  clipDraft?: {
    startActionIndex?: number;
    endActionIndex?: number;
  };
  activeClipId?: string;
  viewMode: ReplayViewMode;
  creatorSettings: ReplayCreatorSettings;
  watchParty: ReplayWatchPartyState;
}

export type ReplayTimelineMarkerKind =
  | 'turn'
  | 'combat'
  | 'spell'
  | 'ability'
  | 'damage'
  | 'zone_change'
  | 'mechanic'
  | 'manual'
  | 'warning'
  | 'checkpoint'
  | 'note'
  | 'bookmark';

export interface ReplayTimelineMarker {
  id: string;
  actionIndex: number;
  turnNumber?: number;
  type: ReplayTimelineMarkerKind;
  label: string;
  severity?: 'info' | 'important' | 'warning';
}

export interface ExportReplayOptions {
  includePrivateZones: boolean;
  includeFinalSnapshot: boolean;
  redacted: boolean;
  includeAnimationMetadata?: boolean;
}
