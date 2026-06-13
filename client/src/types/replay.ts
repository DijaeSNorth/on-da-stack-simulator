import type { ActionRecord, GameState } from './game';

export type ReplayMode = 'solo' | 'multiplayer';
export type ReplayStatus = 'idle' | 'loaded' | 'playing' | 'paused' | 'error';
export type ReplaySpeed = 0.5 | 1 | 2 | 'instant';
export type ReplayAnimationMode = 'off' | 'simple' | 'dramatic';

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
  | 'checkpoint';

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
