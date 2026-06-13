import type { SavedSoloReport, SoloPerformanceReport } from '../types/game';

export const SOLO_REPORT_HISTORY_KEY = 'on-da-stack-solo-report-history';
export const SOLO_REPORT_HISTORY_CAP = 50;
export const SOLO_REPORT_RESPONSIBILITY_COPY = 'Report history is stored in this browser. Export anything you want to keep or back up.';
export const SOLO_REPORT_CLEAR_WARNING = 'This clears report history stored in this browser. Export first if you want to keep it.';
export const SOLO_REPORT_IMPORT_WARNING = 'Imported report history is stored in this browser.';
export const SOLO_REPORT_EXPORT_WARNING = 'You are responsible for storing this exported file safely.';

export interface SaveSoloReportOptions {
  tags?: string[];
  notes?: string;
  savedAt?: number;
}

export interface SoloReportHistoryReadResult {
  reports: SavedSoloReport[];
  warnings: string[];
}

export interface ImportSoloReportHistoryResult {
  reports: SavedSoloReport[];
  importedCount: number;
  warnings: string[];
}

export interface SoloReportHistoryFilters {
  deckId?: string;
  sessionType?: SavedSoloReport['sessionType'] | 'all';
  query?: string;
  sort?: 'newest' | 'oldest';
}

export interface SoloReportHistoryViewModel {
  reports: SavedSoloReport[];
  totalCount: number;
  visibleCount: number;
  deckOptions: { deckId: string; deckName: string }[];
  warningText: string;
}

export interface SoloReportComparison {
  firstId: string;
  secondId: string;
  metrics: {
    label: string;
    first: number | string;
    second: number | string;
    difference?: number;
  }[];
}

const UNSAFE_EXPORT_KEYS = new Set([
  'firebaseAuthUid',
  'authUid',
  'uid',
  'participantToken',
  'participantTokens',
  'roomCode',
  'roomId',
  'peerId',
  'sessionId',
  'lobby',
  'peers',
  'firebaseRecovery',
  'recoverySnapshot',
  'privateSnapshot',
  'multiplayer',
]);

export function saveSoloReport(report: SoloPerformanceReport, options: SaveSoloReportOptions = {}): SavedSoloReport {
  const saved = normalizeSavedSoloReport({
    id: `saved-${report.id}-${options.savedAt ?? Date.now()}`,
    savedAt: options.savedAt ?? Date.now(),
    deckId: report.deckId,
    deckName: report.deckName,
    sessionType: report.sessionType,
    report,
    tags: normalizeTags(options.tags),
    notes: normalizeNotes(options.notes),
  });
  if (!saved) throw new Error('Invalid solo performance report.');
  const current = getSavedSoloReports();
  const next = capReports([saved, ...current.filter(item => item.id !== saved.id)]);
  writeReports(next);
  return saved;
}

export function getSavedSoloReports(): SavedSoloReport[] {
  return getSavedSoloReportsWithWarnings().reports;
}

export function getSavedSoloReportsWithWarnings(): SoloReportHistoryReadResult {
  if (typeof localStorage === 'undefined') return { reports: [], warnings: ['Local report history storage is unavailable.'] };
  const raw = localStorage.getItem(SOLO_REPORT_HISTORY_KEY);
  if (!raw) return { reports: [], warnings: [] };
  try {
    const parsed = JSON.parse(raw) as unknown;
    const reports = parseReportArray(parsed);
    return { reports, warnings: [] };
  } catch {
    return { reports: [], warnings: ['Saved report history was corrupt and could not be loaded.'] };
  }
}

export function deleteSoloReport(reportId: string): SavedSoloReport[] {
  const next = getSavedSoloReports().filter(report => report.id !== reportId);
  writeReports(next);
  return next;
}

export function updateSoloReportMetadata(
  reportId: string,
  metadata: { notes?: string; tags?: string[] },
): SavedSoloReport[] {
  const next = getSavedSoloReports().map(report =>
    report.id === reportId
      ? {
        ...report,
        notes: metadata.notes !== undefined ? normalizeNotes(metadata.notes) : report.notes,
        tags: metadata.tags !== undefined ? normalizeTags(metadata.tags) : report.tags,
      }
      : report
  );
  writeReports(next);
  return next;
}

export function clearSoloReports(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(SOLO_REPORT_HISTORY_KEY);
}

export function exportSoloReportHistory(): string {
  return JSON.stringify({
    exportedAt: Date.now(),
    source: 'on-da-stack-solo-report-history',
    responsibilityNotice: SOLO_REPORT_EXPORT_WARNING,
    reports: sanitizeForExport(getSavedSoloReports()),
  }, null, 2);
}

export function importSoloReportHistory(raw: string): ImportSoloReportHistoryResult {
  const warnings: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { reports: getSavedSoloReports(), importedCount: 0, warnings: ['Import file was not valid JSON.'] };
  }
  const candidates = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.reports)
      ? parsed.reports
      : undefined;
  if (!candidates) {
    return { reports: getSavedSoloReports(), importedCount: 0, warnings: ['Import did not contain a report history array.'] };
  }
  const imported = candidates
    .map(candidate => normalizeSavedSoloReport(stripUnsafeFields(candidate)))
    .filter((report): report is SavedSoloReport => Boolean(report));
  if (imported.length !== candidates.length) warnings.push('Some imported reports were skipped because their shape was invalid.');
  const existing = getSavedSoloReports();
  const byId = new Map<string, SavedSoloReport>();
  for (const report of [...imported, ...existing]) byId.set(report.id, report);
  const reports = capReports([...byId.values()]);
  writeReports(reports);
  return { reports, importedCount: imported.length, warnings };
}

export function buildSoloReportHistoryViewModel(
  reports: SavedSoloReport[],
  filters: SoloReportHistoryFilters = {},
): SoloReportHistoryViewModel {
  const query = filters.query?.trim().toLowerCase() ?? '';
  const sorted = [...reports].sort((a, b) => filters.sort === 'oldest' ? a.savedAt - b.savedAt : b.savedAt - a.savedAt);
  const visible = sorted.filter(report => {
    if (filters.deckId && report.deckId !== filters.deckId) return false;
    if (filters.sessionType && filters.sessionType !== 'all' && report.sessionType !== filters.sessionType) return false;
    if (!query) return true;
    return [
      report.deckName,
      report.deckId,
      report.sessionType,
      report.notes,
      ...(report.tags ?? []),
      ...(report.report.suggestions ?? []),
    ].filter(Boolean).join(' ').toLowerCase().includes(query);
  });
  const deckOptions = Array.from(new Map(reports
    .filter(report => report.deckId)
    .map(report => [report.deckId!, { deckId: report.deckId!, deckName: report.deckName ?? report.deckId! }]))
    .values())
    .sort((a, b) => a.deckName.localeCompare(b.deckName));
  return {
    reports: visible,
    totalCount: reports.length,
    visibleCount: visible.length,
    deckOptions,
    warningText: SOLO_REPORT_RESPONSIBILITY_COPY,
  };
}

export function compareSoloReports(first: SavedSoloReport, second: SavedSoloReport): SoloReportComparison {
  const metric = (
    label: string,
    getValue: (report: SoloPerformanceReport) => number | string | undefined,
  ): SoloReportComparison['metrics'][number] => {
    const firstValue = getValue(first.report) ?? 'Unknown';
    const secondValue = getValue(second.report) ?? 'Unknown';
    return {
      label,
      first: firstValue,
      second: secondValue,
      difference: typeof firstValue === 'number' && typeof secondValue === 'number' ? secondValue - firstValue : undefined,
    };
  };
  return {
    firstId: first.id,
    secondId: second.id,
    metrics: [
      metric('Turns played', report => report.turnsPlayed),
      metric('Damage dealt', report => report.combat.totalDamageDealt),
      metric('Damage taken', report => report.combat.totalDamageTaken),
      metric('Lands played', report => report.manaDevelopment.landsPlayed),
      metric('Missed land drops', report => report.manaDevelopment.turnsMissedLandDrop.length),
      metric('First creature turn', report => report.boardDevelopment.firstCreatureTurn),
      metric('Turn of lethal', report => report.combat.turnOfLethal),
      metric('Cards drawn', report => report.cardFlow.cardsDrawn),
      metric('Suggestions', report => report.suggestions.length),
    ],
  };
}

export function getSoloReportResponsibilityCopy(): string {
  return SOLO_REPORT_RESPONSIBILITY_COPY;
}

function parseReportArray(value: unknown): SavedSoloReport[] {
  if (!Array.isArray(value)) return [];
  return capReports(value
    .map(candidate => normalizeSavedSoloReport(candidate))
    .filter((report): report is SavedSoloReport => Boolean(report)));
}

function normalizeSavedSoloReport(value: unknown): SavedSoloReport | undefined {
  if (!isRecord(value) || !isReport(value.report)) return undefined;
  const savedAt = toNumber(value.savedAt) ?? value.report.generatedAt;
  const id = toStringValue(value.id) || `saved-${value.report.id}-${savedAt}`;
  const deckId = toStringValue(value.deckId) ?? value.report.deckId;
  const deckName = toStringValue(value.deckName) ?? value.report.deckName;
  const sessionType = value.sessionType === 'dummy' ? 'dummy' : value.sessionType === 'goldfish' ? 'goldfish' : value.report.sessionType;
  return {
    id,
    savedAt,
    deckId,
    deckName,
    sessionType,
    report: value.report,
    tags: normalizeTags(Array.isArray(value.tags) ? value.tags : undefined),
    notes: normalizeNotes(value.notes),
  };
}

function isReport(value: unknown): value is SoloPerformanceReport {
  return isRecord(value) &&
    typeof value.id === 'string' &&
    (value.sessionType === 'goldfish' || value.sessionType === 'dummy') &&
    typeof value.generatedAt === 'number' &&
    typeof value.turnsPlayed === 'number' &&
    typeof value.actionsCount === 'number' &&
    isRecord(value.manaDevelopment) &&
    isRecord(value.boardDevelopment) &&
    isRecord(value.combat) &&
    isRecord(value.cardFlow) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.suggestions);
}

function writeReports(reports: SavedSoloReport[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SOLO_REPORT_HISTORY_KEY, JSON.stringify(capReports(reports)));
}

function capReports(reports: SavedSoloReport[]): SavedSoloReport[] {
  return [...reports]
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, SOLO_REPORT_HISTORY_CAP);
}

function normalizeTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const normalized = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
  return normalized.length ? normalized : undefined;
}

function normalizeNotes(notes: unknown): string | undefined {
  return typeof notes === 'string' && notes.trim() ? notes.trim().slice(0, 1000) : undefined;
}

function sanitizeForExport(value: unknown): unknown {
  return stripUnsafeFields(value);
}

function stripUnsafeFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsafeFields);
  if (!isRecord(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_EXPORT_KEYS.has(key)) continue;
    next[key] = stripUnsafeFields(child);
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
