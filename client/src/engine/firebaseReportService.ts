import { ref, remove, set } from 'firebase/database';
import { ensureFirebaseAnonymousAuth, getFirebaseDatabase } from '../config/firebase';
import type { PlayerReport, ReportCleanupSummary, ReportSubmitResult } from '../types/report';
import {
  exportPlayerReportJson,
  saveLocalReport,
} from './reportService';
import {
  cleanupExpiredReports,
  createCleanupSummary,
  getExpiredReports,
} from './reportRetention';

const REPORT_CLEANUP_LAST_RUN_KEY = 'on-da-stack-report-cleanup-last-run';
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function submitPlayerReport(report: PlayerReport): Promise<ReportSubmitResult> {
  const localExportJson = exportPlayerReportJson(report);
  saveLocalReport(report);

  if (report.privacyMode === 'local_export_only') {
    return {
      ok: true,
      report,
      submittedToFirebase: false,
      localExportJson,
      error: 'Report saved locally only.',
    };
  }

  const db = getFirebaseDatabase();
  if (!db) {
    return {
      ok: false,
      report,
      submittedToFirebase: false,
      localExportJson,
      error: 'Firebase reports are not configured. Use local export or sanitized GitHub fallback.',
    };
  }

  const user = await ensureFirebaseAnonymousAuth();
  if (!user) {
    return {
      ok: false,
      report,
      submittedToFirebase: false,
      localExportJson,
      error: 'Anonymous report auth failed. Use local export or sanitized GitHub fallback.',
    };
  }

  try {
    await set(ref(db, `reports/${report.reportId}`), report);
    return {
      ok: true,
      report,
      submittedToFirebase: true,
      localExportJson,
    };
  } catch (error) {
    return {
      ok: false,
      report,
      submittedToFirebase: false,
      localExportJson,
      error: error instanceof Error ? error.message : 'Report write failed. Use local export or sanitized GitHub fallback.',
    };
  }
}

export function shouldRunLocalReportCleanup(now = Date.now()): boolean {
  if (typeof localStorage === 'undefined') return false;
  const lastRun = Number(localStorage.getItem(REPORT_CLEANUP_LAST_RUN_KEY) ?? 0);
  return !Number.isFinite(lastRun) || now - lastRun >= CLEANUP_INTERVAL_MS;
}

export function markLocalReportCleanupRun(now = Date.now()): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(REPORT_CLEANUP_LAST_RUN_KEY, String(now));
  }
}

export function cleanupExpiredLocalReports(reports: PlayerReport[], now = Date.now()): {
  reports: PlayerReport[];
  summary: ReportCleanupSummary;
} {
  const expired = getExpiredReports(reports, now);
  const kept = cleanupExpiredReports(reports, now);
  markLocalReportCleanupRun(now);
  return {
    reports: kept,
    summary: createCleanupSummary(expired, [], now, { reports: kept.length, clusters: 0 }),
  };
}

export async function cleanupExpiredFirebaseReports(
  reports: PlayerReport[],
  now = Date.now(),
  batchSize = 20,
): Promise<ReportCleanupSummary> {
  const db = getFirebaseDatabase();
  const expired = getExpiredReports(reports, now).slice(0, Math.max(1, batchSize));
  if (!db || expired.length === 0) {
    return createCleanupSummary([], [], now, { reports: reports.length, clusters: 0 });
  }

  const deleted: PlayerReport[] = [];
  for (const report of expired) {
    try {
      await remove(ref(db, `reports/${report.reportId}`));
      deleted.push(report);
    } catch {
      break;
    }
  }
  return createCleanupSummary(deleted, [], now, { reports: reports.length - deleted.length, clusters: 0 });
}
