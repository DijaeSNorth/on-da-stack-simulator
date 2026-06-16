import type {
  CodexTriageExport,
  CodexTriageExportCluster,
  CodexTriageSampleReport,
  PlayerReport,
  PlayerReportSeverity,
  ReportCluster,
} from '../types/report';
import { clusterReports, createClusterCodexPrompt } from './reportTriage';
import { sanitizeReportText } from './reportService';

const SEVERITY_RANK: Record<PlayerReportSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface CodexTriageExportOptions {
  now?: number;
  maxSamplesPerCluster?: number;
}

function highestSeverity(reports: PlayerReport[]): PlayerReportSeverity {
  return reports.reduce<PlayerReportSeverity>((highest, report) =>
    SEVERITY_RANK[report.severity] > SEVERITY_RANK[highest] ? report.severity : highest
  , 'low');
}

function reportTypes(reports: PlayerReport[]): Record<string, number> {
  return reports.reduce<Record<string, number>>((counts, report) => {
    counts[report.type] = (counts[report.type] ?? 0) + 1;
    return counts;
  }, {});
}

function sampleReport(report: PlayerReport): CodexTriageSampleReport {
  return {
    reportId: report.reportId,
    createdAt: report.createdAt,
    title: sanitizeReportText(report.title),
    sanitizedDescription: sanitizeReportText(report.description),
    reproSteps: extractReproSteps(report.description),
    safeContext: report.safeContext,
  };
}

function extractReproSteps(description: string): string[] {
  return description
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => /^\d+[.)]\s+/.test(line) || /^-\s+/.test(line))
    .slice(0, 8)
    .map(line => sanitizeReportText(line.replace(/^\d+[.)]\s+|^-\s+/, '')));
}

function clusterToExport(cluster: ReportCluster, maxSamples: number): CodexTriageExportCluster {
  const reports = cluster.reports ?? [];
  const logs = reports
    .flatMap(report => report.safeContext.actionLog ?? [])
    .slice(-25)
    .map(entry => `T${entry.turn} ${entry.phase} ${entry.actionType}: ${entry.description}`);
  const samples = reports.slice(0, maxSamples).map(sampleReport);
  return {
    clusterId: cluster.clusterId,
    title: sanitizeReportText(cluster.title),
    severity: cluster.severity,
    reportType: cluster.reportType,
    count: cluster.count,
    affectedBuilds: cluster.affectedBuilds,
    firstSeenAt: cluster.firstSeenAt,
    lastSeenAt: cluster.lastSeenAt,
    commonSymptoms: [sanitizeReportText(cluster.sanitizedSummary)].filter(Boolean),
    reproSteps: samples.flatMap(sample => sample.reproSteps ?? []).slice(0, 10),
    sanitizedLogs: logs.map(log => sanitizeReportText(log)),
    suggestedFiles: cluster.suggestedAreas,
    sampleReports: samples,
  };
}

export function createCodexTriageExport(
  reports: PlayerReport[],
  options: CodexTriageExportOptions = {},
): CodexTriageExport {
  const clusters = clusterReports(reports);
  const builds = Array.from(new Set(reports.map(report => report.buildCommit).filter(Boolean))).sort();
  return {
    exportVersion: '1',
    exportedAt: options.now ?? Date.now(),
    appBuildRange: builds,
    summary: {
      totalReports: reports.length,
      totalClusters: clusters.length,
      highestSeverity: highestSeverity(reports),
      reportTypes: reportTypes(reports),
    },
    clusters: clusters.map(cluster => clusterToExport(cluster, options.maxSamplesPerCluster ?? 5)),
    privacy: {
      rawReportsIncluded: false,
      privateZonesIncluded: false,
      firebaseUidsIncluded: false,
      participantTokensIncluded: false,
      rawRoomCodesIncluded: false,
    },
  };
}

export function createCodexTriageMarkdown(reports: PlayerReport[], options: CodexTriageExportOptions = {}): string {
  const triage = createCodexTriageExport(reports, options);
  const lines = [
    '# On-Da-Stack Sanitized Report Triage',
    '',
    `Exported: ${new Date(triage.exportedAt).toISOString()}`,
    `Reports: ${triage.summary.totalReports}`,
    `Clusters: ${triage.summary.totalClusters}`,
    `Highest severity: ${triage.summary.highestSeverity}`,
    '',
    'Privacy: raw reports, private zones, Firebase UIDs, participant tokens, and raw room codes are excluded.',
  ];

  for (const cluster of triage.clusters) {
    lines.push(
      '',
      `## ${cluster.title}`,
      '',
      `- Cluster: ${cluster.clusterId}`,
      `- Severity: ${cluster.severity}`,
      `- Type: ${cluster.reportType}`,
      `- Count: ${cluster.count}`,
      `- Builds: ${cluster.affectedBuilds.join(', ') || 'unknown'}`,
      `- Suggested files: ${cluster.suggestedFiles.join(', ') || 'none'}`,
      '',
      'Symptoms:',
      ...(cluster.commonSymptoms.length ? cluster.commonSymptoms.map(item => `- ${item}`) : ['- None provided']),
      '',
      'Codex prompt:',
      '```',
      createClusterCodexPrompt({
        clusterId: cluster.clusterId,
        fingerprint: cluster.clusterId.replace(/^cluster-/, ''),
        title: cluster.title,
        reportType: cluster.reportType,
        severity: cluster.severity,
        count: cluster.count,
        affectedBuilds: cluster.affectedBuilds,
        firstSeenAt: cluster.firstSeenAt,
        lastSeenAt: cluster.lastSeenAt,
        expiresAt: 0,
        sampleReportIds: cluster.sampleReports.map(sample => sample.reportId),
        commonContext: {},
        suggestedAreas: cluster.suggestedFiles,
        sanitizedSummary: cluster.commonSymptoms.join(' / '),
        status: 'new',
      }),
      '```',
    );
  }

  return lines.join('\n');
}
