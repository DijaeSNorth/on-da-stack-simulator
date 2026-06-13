import { SUPPORTED_REPLAY_VERSION, validateReplayFile } from './replayEngine';
import type { ReplayFile, ReplayFileValidationResult } from '../types/replay';

export const MAX_REPLAY_FILE_BYTES = 25 * 1024 * 1024;
const RECENT_REPLAYS_KEY = 'on-da-stack-recent-replay-imports-v1';
const MAX_RECENT_REPLAYS = 5;

export interface ReplayImportCandidate {
  name: string;
  size: number;
  type?: string;
  text: () => Promise<string>;
}

export interface ReplayImportSummary {
  gameId: string;
  gameName?: string;
  exportedAt: number;
  exportedDate: string;
  players: string[];
  actionCount: number;
  estimatedTurnCount: number;
  replayVersion: string;
  appVersion?: string;
  buildCommit?: string;
  rulesetVersion?: string;
  privacyMode: 'public' | 'private' | 'redacted';
  warningsCount: number;
  fileName?: string;
  importedAt?: number;
}

export interface ReplayImportResult {
  ok: boolean;
  replayFile?: ReplayFile;
  summary?: ReplayImportSummary;
  errors: string[];
  warnings: string[];
}

function slugFilePart(value: string): string {
  return value.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'game';
}

export function getReplayPrivacyMode(replayFile: ReplayFile): ReplayImportSummary['privacyMode'] {
  if (replayFile.privacy.includesPrivateZones) return 'private';
  if (replayFile.privacy.redactedPlayers?.length) return 'redacted';
  return 'public';
}

export function formatReplayFileName(replayFile: ReplayFile, privacyMode = getReplayPrivacyMode(replayFile)): string {
  const date = new Date(replayFile.exportedAt || Date.now()).toISOString().slice(0, 10);
  const mode = privacyMode === 'private' ? 'private' : 'public';
  return `on-da-stack-replay-${date}-${slugFilePart(replayFile.gameId)}-${mode}.json`;
}

export function summarizeReplayFile(replayFile: ReplayFile, fileName?: string): ReplayImportSummary {
  const turnNumbers = new Set(replayFile.actionLog.map(action => action.turn).filter(turn => Number.isFinite(turn)));
  const warningCount = replayFile.actionLog.filter(action =>
    action.actionType === 'FLAG' ||
    (action.flags ?? []).length > 0 ||
    Array.isArray(action.data?.reviewTypes)
  ).length;
  return {
    gameId: replayFile.gameId,
    gameName: replayFile.gameName,
    exportedAt: replayFile.exportedAt,
    exportedDate: new Date(replayFile.exportedAt || Date.now()).toLocaleString(),
    players: replayFile.players.map(player => player.displayName),
    actionCount: replayFile.actionLog.length,
    estimatedTurnCount: Math.max(1, turnNumbers.size || replayFile.initialGameState.turn || 1),
    replayVersion: replayFile.replayVersion,
    appVersion: replayFile.appVersion,
    buildCommit: replayFile.buildCommit,
    rulesetVersion: replayFile.rulesetVersion,
    privacyMode: getReplayPrivacyMode(replayFile),
    warningsCount: warningCount,
    fileName,
  };
}

export function getFriendlyReplayValidationErrors(validation: ReplayFileValidationResult): string[] {
  return validation.errors.map(error => {
    if (error.includes('initialGameState')) return 'Missing initialGameState.';
    if (error.includes('actionLog')) return 'Missing actionLog.';
    if (error.includes('Unsupported replayVersion')) return `Unsupported replayVersion. This app supports ${SUPPORTED_REPLAY_VERSION}.`;
    return error;
  });
}

function isLikelyJsonFile(candidate: ReplayImportCandidate): boolean {
  const name = candidate.name.toLowerCase();
  const type = candidate.type?.toLowerCase() ?? '';
  return name.endsWith('.json') || type === 'application/json' || type === 'text/json';
}

function appVersionWarning(replayFile: ReplayFile, currentAppVersion?: string): string | null {
  if (!currentAppVersion || !replayFile.appVersion || currentAppVersion === 'dev') return null;
  if (replayFile.appVersion === currentAppVersion) return null;
  const replayMajor = Number.parseInt(replayFile.appVersion.split('.')[0] ?? '', 10);
  const currentMajor = Number.parseInt(currentAppVersion.split('.')[0] ?? '', 10);
  if (Number.isFinite(replayMajor) && Number.isFinite(currentMajor) && replayMajor > currentMajor) {
    return 'Replay was created with a newer app version.';
  }
  return null;
}

export function replayAppearsToIncludePrivateData(replayFile: ReplayFile): boolean {
  if (replayFile.privacy.includesPrivateZones) return true;
  return replayFile.initialGameState.players.some(player =>
    player.hand.some(id => Boolean(replayFile.initialGameState.cards[id])) ||
    player.library.some(id => Boolean(replayFile.initialGameState.cards[id])) ||
    player.sideboard.some(id => Boolean(replayFile.initialGameState.cards[id])) ||
    player.maybeboard.some(id => Boolean(replayFile.initialGameState.cards[id]))
  );
}

export async function importReplayCandidate(
  candidate: ReplayImportCandidate,
  options: { currentAppVersion?: string; maxBytes?: number } = {},
): Promise<ReplayImportResult> {
  const maxBytes = options.maxBytes ?? MAX_REPLAY_FILE_BYTES;
  if (!isLikelyJsonFile(candidate)) {
    return { ok: false, errors: ['Non-json file rejected. Choose a .json replay file.'], warnings: [] };
  }
  if (candidate.size > maxBytes) {
    return { ok: false, errors: ['Replay file too large.'], warnings: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await candidate.text());
  } catch {
    return { ok: false, errors: ['Invalid JSON.'], warnings: [] };
  }

  const validation = validateReplayFile(parsed);
  if (!validation.ok || !validation.replayFile) {
    return { ok: false, errors: getFriendlyReplayValidationErrors(validation), warnings: validation.warnings };
  }

  const warnings = [...validation.warnings];
  if (replayAppearsToIncludePrivateData(validation.replayFile) && !validation.replayFile.privacy.includesPrivateZones) {
    warnings.push('Replay appears to include private data.');
  }
  const versionWarning = appVersionWarning(validation.replayFile, options.currentAppVersion);
  if (versionWarning) warnings.push(versionWarning);

  return {
    ok: true,
    replayFile: validation.replayFile,
    summary: summarizeReplayFile(validation.replayFile, candidate.name),
    errors: [],
    warnings,
  };
}

export function loadRecentReplayImports(): ReplayImportSummary[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_REPLAYS_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ReplayImportSummary => Boolean(item) && typeof item === 'object' && typeof (item as ReplayImportSummary).gameId === 'string').slice(0, MAX_RECENT_REPLAYS);
  } catch {
    return [];
  }
}

export function saveRecentReplayImport(summary: ReplayImportSummary): ReplayImportSummary[] {
  const metadataOnly: ReplayImportSummary = {
    ...summary,
    importedAt: Date.now(),
  };
  const recent = [metadataOnly, ...loadRecentReplayImports().filter(item =>
    item.gameId !== summary.gameId || item.exportedAt !== summary.exportedAt || item.fileName !== summary.fileName
  )].slice(0, MAX_RECENT_REPLAYS);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(RECENT_REPLAYS_KEY, JSON.stringify(recent));
  }
  return recent;
}

export function clearRecentReplayImports(): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(RECENT_REPLAYS_KEY);
}
