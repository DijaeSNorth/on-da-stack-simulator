import type { PlayerReport, ReportCleanupSummary, ReportCluster } from '../types/report';

export const DAY_MS = 24 * 60 * 60 * 1000;

export const REPORT_RETENTION = {
  rawPrivateDays: 60,
  lowMediumResolvedDays: 30,
  dismissedDuplicateDays: 14,
  highCriticalDays: 90,
  highCriticalResolvedDays: 30,
  sanitizedClusterDays: 180,
} as const;

function addDays(anchor: number, days: number): number {
  return anchor + days * DAY_MS;
}

export function calculateReportExpiration(report: Pick<PlayerReport,
  'createdAt' | 'severity' | 'status' | 'retentionClass' | 'cleanupEligible' | 'resolvedAt' | 'dismissedAt'
>): number {
  if (!report.cleanupEligible || report.retentionClass === 'legal_hold' || report.retentionClass === 'manual_export_only') {
    return Number.MAX_SAFE_INTEGER;
  }

  if (report.status === 'dismissed' || report.status === 'duplicate') {
    return addDays(report.dismissedAt ?? report.resolvedAt ?? report.createdAt, REPORT_RETENTION.dismissedDuplicateDays);
  }

  if ((report.status === 'resolved' || report.status === 'fixed') && (report.severity === 'low' || report.severity === 'medium')) {
    return addDays(report.resolvedAt ?? report.createdAt, REPORT_RETENTION.lowMediumResolvedDays);
  }

  if (report.severity === 'high' || report.severity === 'critical' || report.retentionClass === 'extended') {
    const severityWindow = addDays(report.createdAt, REPORT_RETENTION.highCriticalDays);
    const resolvedWindow = report.resolvedAt ? addDays(report.resolvedAt, REPORT_RETENTION.highCriticalResolvedDays) : severityWindow;
    return Math.max(severityWindow, resolvedWindow);
  }

  return addDays(report.createdAt, REPORT_RETENTION.rawPrivateDays);
}

export function calculateClusterExpiration(lastSeenAt: number): number {
  return addDays(lastSeenAt, REPORT_RETENTION.sanitizedClusterDays);
}

export function getExpiredReports(reports: PlayerReport[], now = Date.now()): PlayerReport[] {
  return reports.filter(report =>
    report.cleanupEligible &&
    report.retentionClass !== 'legal_hold' &&
    report.retentionClass !== 'manual_export_only' &&
    report.expiresAt < now
  );
}

export function getExpiredClusters(clusters: ReportCluster[], now = Date.now()): ReportCluster[] {
  return clusters.filter(cluster => cluster.expiresAt < now && cluster.status !== 'fixing');
}

export function cleanupExpiredReports(reports: PlayerReport[], now = Date.now()): PlayerReport[] {
  const expired = new Set(getExpiredReports(reports, now).map(report => report.reportId));
  return reports.filter(report => !expired.has(report.reportId));
}

export function cleanupExpiredClusters(clusters: ReportCluster[], now = Date.now()): ReportCluster[] {
  const expired = new Set(getExpiredClusters(clusters, now).map(cluster => cluster.clusterId));
  return clusters.filter(cluster => !expired.has(cluster.clusterId));
}

export function createCleanupSummary(
  deletedReports: PlayerReport[],
  deletedClusters: ReportCluster[],
  now = Date.now(),
  retained?: { reports?: number; clusters?: number },
): ReportCleanupSummary {
  return {
    deletedReportCount: deletedReports.length,
    deletedClusterCount: deletedClusters.length,
    deletedReportIds: deletedReports.map(report => report.reportId),
    deletedClusterIds: deletedClusters.map(cluster => cluster.clusterId),
    retainedReportCount: retained?.reports,
    retainedClusterCount: retained?.clusters,
    createdAt: now,
  };
}
