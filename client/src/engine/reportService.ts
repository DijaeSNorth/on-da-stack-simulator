import type { GameState } from '../types/game';
import type { MultiplayerState, UIState } from '../store/gameStore';
import type {
  PlayerReport,
  PlayerReportInput,
  PlayerReportPrivacyMode,
  PlayerReportRetentionClass,
  PlayerReportSeverity,
  PublicReportGameSnapshot,
  ReportDeckContext,
  ReportSafeContext,
  SafeActionLogEntry,
} from '../types/report';
import { calculateReportExpiration } from './reportRetention';
import { createReportFingerprint } from './reportTriage';

export const LOCAL_REPORTS_KEY = 'on-da-stack-player-reports-v1';
export const REPORT_PRIVACY_NOTICE = 'Reports may include selected game context. Do not include personal information unless you choose to.';
export const REPORT_RETENTION_NOTICE = 'Reports are support and diagnostic data and may be cleaned up after a retention period.';

export interface BuildPlayerReportOptions {
  game: GameState;
  ui: UIState;
  multiplayer: MultiplayerState;
  localPlayerId?: string;
  input: PlayerReportInput;
  browserInfo?: string;
  recentConsoleErrors?: string[];
  now?: number;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function envValue(name: string, fallback: string): string {
  return ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name] ?? fallback).trim();
}

export function hashReportValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return `hash-${stableHash(normalized.toUpperCase())}`;
}

function truncate(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
}

function normalizeText(value: string, fallback: string, maxLength: number): string {
  return truncate(value.trim() || fallback, maxLength);
}

function hiddenCardNames(game: GameState): Set<string> {
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

export function sanitizeReportText(value: string, game?: GameState): string {
  let text = value.replace(/Firebase UID:\s*[A-Za-z0-9_-]+/gi, 'Firebase UID: [redacted]');
  text = text.replace(/participantToken["':=\s]+[A-Za-z0-9._-]+/gi, 'participantToken [redacted]');
  text = text.replace(/room\s*code["':=\s]+[A-Z0-9]{4,16}/gi, 'room code [redacted]');
  text = text.replace(/\b[A-Z0-9]{6}\b/g, '[possible-room-code-redacted]');
  if (game) {
    for (const name of hiddenCardNames(game)) {
      if (!name.trim()) continue;
      text = text.replace(new RegExp(escapeRegExp(name), 'gi'), 'a hidden card');
    }
  }
  return truncate(text, 3000);
}

function safeActionLog(game: GameState, include: boolean): SafeActionLogEntry[] | undefined {
  if (!include) return undefined;
  return game.actionLog.slice(-50).map(action => ({
    id: action.id,
    turn: action.turn,
    phase: action.phase,
    actionType: action.actionType,
    description: sanitizeReportText(action.description || action.actionType, game),
    actorId: action.playerId,
    createdAt: action.timestamp,
  }));
}

function publicSnapshot(game: GameState, localPlayerId: string | undefined, include: boolean): PublicReportGameSnapshot | undefined {
  if (!include) return undefined;
  return {
    gameId: game.id,
    status: game.status,
    turn: game.turn,
    phase: game.phase,
    activePlayerId: game.activePlayerId,
    priorityPlayerId: game.priorityPlayerId,
    playerCount: game.players.length,
    stackCount: game.stack.length,
    triggerCount: game.triggerQueue.length,
    players: game.players.map(player => ({
      playerId: player.id,
      seatIndex: player.seatIndex,
      life: player.life,
      battlefieldCount: player.battlefield.length,
      graveyardCount: player.graveyard.length,
      exileCount: player.exile.length,
      handCount: player.hand.length,
      libraryCount: player.library.length,
      commanderCount: player.commanders.length,
      isLocalPlayer: player.id === localPlayerId,
    })),
  };
}

function deckContext(game: GameState, localPlayerId: string | undefined): ReportDeckContext | undefined {
  const player = game.players.find(candidate => candidate.id === localPlayerId) ?? game.players[0];
  if (!player?.deckId) return undefined;
  const libraryCount = player.library.length;
  const commanderCount = player.commanders.length;
  return {
    activeDeckId: player.deckId,
    cardCount: libraryCount + player.hand.length + player.battlefield.length + player.graveyard.length + player.exile.length,
    commanderCount,
    deckHash: hashReportValue(`${player.deckId}:${libraryCount}:${commanderCount}`),
  };
}

function defaultPrivacy(type: PlayerReportInput['type'], requested?: PlayerReportPrivacyMode): PlayerReportPrivacyMode {
  if (requested) return requested;
  if (type === 'player_behavior' || type === 'cheating') return 'private';
  return 'private';
}

function defaultRetention(type: PlayerReportInput['type'], severity: PlayerReportSeverity, requested?: PlayerReportRetentionClass): PlayerReportRetentionClass {
  if (requested) return requested;
  if (severity === 'critical') return 'extended';
  if (type === 'cheating') return 'extended';
  if (type === 'player_behavior') return 'normal';
  return 'normal';
}

function normalizeSeverity(value: PlayerReportInput['severity'] | undefined): PlayerReportSeverity {
  return value ?? 'medium';
}

export function buildReportSafeContext(options: BuildPlayerReportOptions): ReportSafeContext {
  const { game, ui, multiplayer, localPlayerId, input } = options;
  const includePrivateZones = input.includePrivateZones === true;
  return {
    appVersion: envValue('VITE_APP_VERSION', 'dev'),
    buildCommit: envValue('VITE_COMMIT_SHA', 'dev'),
    rulesetVersion: game.rulesetVersion,
    browserInfo: options.browserInfo,
    gameId: game.id,
    turn: game.turn,
    phase: game.phase,
    reporterPlayerId: localPlayerId,
    roomCodeHash: hashReportValue(multiplayer.roomCode),
    multiplayerStatus: multiplayer.status,
    lobbyStatus: multiplayer.lobby?.status,
    deckStatus: deckContext(game, localPlayerId),
    screen: ui.screen,
    component: input.component,
    actionType: input.actionType,
    recentConsoleErrors: options.recentConsoleErrors?.slice(-8).map(error => sanitizeReportText(error, game)),
    actionLog: safeActionLog(game, Boolean(input.includeActionLog) && !includePrivateZones),
    publicSnapshot: publicSnapshot(game, localPlayerId, Boolean(input.includePublicSnapshot) && !includePrivateZones),
  };
}

export function buildPlayerReport(options: BuildPlayerReportOptions): PlayerReport {
  const now = options.now ?? options.input.now ?? Date.now();
  const severity = normalizeSeverity(options.input.severity);
  const privacyMode = defaultPrivacy(options.input.type, options.input.privacyMode);
  const retentionClass = defaultRetention(options.input.type, severity, options.input.retentionClass);
  const safeContext = buildReportSafeContext({ ...options, now });
  const title = normalizeText(options.input.title, `${options.input.type} report`, 120);
  const description = sanitizeReportText(normalizeText(options.input.description, 'No description provided.', 3000), options.game);
  const reportBase = {
    reportId: `report-${now}-${stableHash(`${title}:${description}:${options.localPlayerId ?? ''}`)}`,
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
    type: options.input.type,
    severity,
    title,
    description,
    contactEmail: options.input.contactEmail?.trim() || undefined,
    reporterPlayerId: options.localPlayerId,
    reportedPlayerId: options.input.reportedPlayerId?.trim() || undefined,
    gameId: options.game.id,
    roomCodeHash: safeContext.roomCodeHash,
    turn: options.game.turn,
    phase: options.game.phase,
    screen: options.ui.screen,
    component: options.input.component,
    actionType: options.input.actionType,
    buildCommit: safeContext.buildCommit,
    appVersion: safeContext.appVersion,
    rulesetVersion: safeContext.rulesetVersion,
    multiplayerStatus: options.multiplayer.status,
    lobbyStatus: options.multiplayer.lobby?.status,
    deckStatus: safeContext.deckStatus,
    includeActionLog: Boolean(options.input.includeActionLog),
    includePublicSnapshot: Boolean(options.input.includePublicSnapshot),
    includePrivateZones: options.input.includePrivateZones === true,
    privacyMode,
    status: options.input.status ?? 'new',
    retentionClass,
    cleanupEligible: retentionClass !== 'legal_hold' && retentionClass !== 'manual_export_only',
    safeContext,
  } satisfies Omit<PlayerReport, 'expiresAt' | 'fingerprint' | 'clusterId'> & { expiresAt: number };
  const fingerprint = createReportFingerprint(reportBase);
  const report: PlayerReport = {
    ...reportBase,
    fingerprint,
    clusterId: `cluster-${fingerprint}`,
    expiresAt: 0,
  };
  report.expiresAt = calculateReportExpiration(report);
  return report;
}

export function exportPlayerReportJson(report: PlayerReport): string {
  return JSON.stringify(report, null, 2);
}

export function loadLocalReports(): PlayerReport[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isPlayerReport) : [];
  } catch {
    return [];
  }
}

export function saveLocalReport(report: PlayerReport): PlayerReport[] {
  const next = [report, ...loadLocalReports().filter(existing => existing.reportId !== report.reportId)].slice(0, 100);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(next));
  }
  return next;
}

export function clearLocalReports(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LOCAL_REPORTS_KEY);
}

export function isPlayerReport(value: unknown): value is PlayerReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<PlayerReport>;
  return typeof report.reportId === 'string' &&
    typeof report.createdAt === 'number' &&
    typeof report.expiresAt === 'number' &&
    typeof report.type === 'string' &&
    typeof report.title === 'string' &&
    typeof report.description === 'string' &&
    typeof report.fingerprint === 'string' &&
    typeof report.clusterId === 'string';
}
