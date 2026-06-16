import type {
  PlayerReport,
  PlayerReportSeverity,
  PlayerReportType,
  ReportCluster,
} from '../types/report';
import { calculateClusterExpiration } from './reportRetention';

const SEVERITY_RANK: Record<PlayerReportSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function stableHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeSignal(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/firebase uid:\s*[a-z0-9_-]+/gi, 'firebase uid [redacted]')
    .replace(/participanttoken\s+[a-z0-9._-]+/gi, 'participanttoken [redacted]')
    .replace(/\b[A-Z0-9]{6}\b/g, '[code]')
    .replace(/[^a-z0-9 _.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function highestSeverity(reports: PlayerReport[]): PlayerReportSeverity {
  return reports.reduce<PlayerReportSeverity>((highest, report) =>
    SEVERITY_RANK[report.severity] > SEVERITY_RANK[highest] ? report.severity : highest
  , 'low');
}

export function createReportFingerprint(report: Pick<PlayerReport,
  'type' | 'screen' | 'component' | 'actionType' | 'buildCommit' | 'title' | 'description' | 'safeContext'
>): string {
  const parts = [
    report.type,
    report.safeContext?.multiplayerStatus ?? '',
    report.screen,
    report.component ?? '',
    normalizeSignal(report.actionType),
    normalizeSignal(report.title),
    normalizeSignal(report.description).slice(0, 120),
    report.buildCommit === 'dev' ? '' : report.buildCommit,
  ];
  return stableHash(parts.join('|'));
}

function suggestedAreasFor(report: PlayerReport): string[] {
  const value = `${report.type} ${report.screen} ${report.component ?? ''} ${report.actionType ?? ''}`.toLowerCase();
  const areas = new Set<string>();
  if (value.includes('lobby') || value.includes('multiplayer')) {
    areas.add('client/src/components/lobby/LobbyScreen.tsx');
    areas.add('client/src/components/multiplayer/MultiplayerPanel.tsx');
    areas.add('client/src/engine/lobbyReadiness.ts');
  }
  if (value.includes('deck') || report.type === 'deck_import') {
    areas.add('client/src/engine/deckImport.ts');
    areas.add('client/src/engine/deckImportExport.ts');
    areas.add('client/src/components/deckbuilder/SoloDeckBuilder.tsx');
  }
  if (value.includes('replay')) {
    areas.add('client/src/engine/replayEngine.ts');
    areas.add('client/src/components/replay/ReplayTimeline.tsx');
  }
  if (value.includes('combat')) {
    areas.add('client/src/engine/gameEngine.ts');
    areas.add('client/src/components/combat/CombatPanel.tsx');
  }
  if (value.includes('firebase') || report.type === 'multiplayer_connection' || report.type === 'multiplayer_desync') {
    areas.add('client/src/engine/firebaseSync.ts');
    areas.add('database.rules.json');
  }
  if (report.type === 'rules_issue') {
    areas.add('client/src/engine/mechanicResolver.ts');
    areas.add('client/src/rules/mechanicsRegistry.ts');
  }
  if (areas.size === 0) areas.add('client/src/store/gameStore.ts');
  return Array.from(areas);
}

function commonContext(reports: PlayerReport[]): ReportCluster['commonContext'] {
  const first = reports[0];
  return {
    screen: reports.every(report => report.screen === first.screen) ? first.screen : undefined,
    component: reports.every(report => report.component === first.component) ? first.component : undefined,
    actionType: reports.every(report => report.actionType === first.actionType) ? first.actionType : undefined,
    multiplayerStatus: reports.every(report => report.multiplayerStatus === first.multiplayerStatus) ? first.multiplayerStatus : undefined,
  };
}

function clusterTitle(type: PlayerReportType, reports: PlayerReport[]): string {
  const repeatedTitle = reports[0]?.title ?? `${type} reports`;
  return reports.length > 1 ? `${repeatedTitle} (${reports.length} reports)` : repeatedTitle;
}

function summaryFor(reports: PlayerReport[]): string {
  const examples = reports.slice(0, 3).map(report => report.description).filter(Boolean);
  return examples.join(' / ') || 'No sanitized symptom text provided.';
}

export function clusterReports(reports: PlayerReport[]): ReportCluster[] {
  const groups = new Map<string, PlayerReport[]>();
  for (const report of reports) {
    const key = report.fingerprint || createReportFingerprint(report);
    groups.set(key, [...(groups.get(key) ?? []), report]);
  }

  return Array.from(groups.entries()).map(([fingerprint, grouped]) => {
    const sorted = [...grouped].sort((a, b) => a.createdAt - b.createdAt);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const affectedBuilds = Array.from(new Set(sorted.map(report => report.buildCommit).filter(Boolean)));
    const suggestedAreas = Array.from(new Set(sorted.flatMap(suggestedAreasFor)));
    return {
      clusterId: `cluster-${fingerprint}`,
      fingerprint,
      title: clusterTitle(first.type, sorted),
      reportType: first.type,
      severity: highestSeverity(sorted),
      count: sorted.length,
      affectedBuilds,
      firstSeenAt: first.createdAt,
      lastSeenAt: last.createdAt,
      expiresAt: calculateClusterExpiration(last.createdAt),
      sampleReportIds: sorted.slice(0, 5).map(report => report.reportId),
      commonContext: commonContext(sorted),
      suggestedAreas,
      sanitizedSummary: summaryFor(sorted),
      status: sorted.some(report => report.status === 'fixing') ? 'fixing' as const : 'new' as const,
      reports: sorted,
    };
  }).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.count - a.count);
}

export function createClusterCodexPrompt(cluster: ReportCluster): string {
  return [
    `Investigate report cluster ${cluster.clusterId}.`,
    `Severity: ${cluster.severity}`,
    `Count: ${cluster.count}`,
    `Symptoms: ${cluster.sanitizedSummary}`,
    `Affected builds: ${cluster.affectedBuilds.join(', ') || 'unknown'}`,
    `Suggested files: ${cluster.suggestedAreas.join(', ')}`,
    'Use the sanitized sample reports below.',
    'Do not inspect private player data.',
    'Make the smallest fix and add regression tests.',
  ].join('\n');
}
