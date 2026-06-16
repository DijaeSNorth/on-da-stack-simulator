import {
  DAY_MS,
  calculateClusterExpiration,
  calculateReportExpiration,
  cleanupExpiredClusters,
  cleanupExpiredReports,
  createCleanupSummary,
  getExpiredClusters,
  getExpiredReports,
} from '../client/src/engine/reportRetention';
import type { PlayerReport, ReportCluster } from '../client/src/types/report';

let passed = 0;
let failed = 0;
let chain = Promise.resolve();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void | Promise<void>): void {
  chain = chain.then(async () => {
    try {
      await fn();
      console.log(`PASS ${name}`);
      passed += 1;
    } catch (error) {
      console.error(`FAIL ${name}`);
      console.error(error);
      failed += 1;
    }
  });
}

function makeReport(overrides: Partial<PlayerReport> = {}): PlayerReport {
  const report = {
    reportId: 'report-1',
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: 0,
    type: 'bug',
    severity: 'medium',
    title: 'Bug',
    description: 'A bug happened.',
    gameId: 'game-1',
    turn: 1,
    phase: 'main1',
    screen: 'game',
    buildCommit: 'dev',
    appVersion: 'dev',
    multiplayerStatus: 'disconnected',
    includeActionLog: false,
    includePublicSnapshot: false,
    includePrivateZones: false,
    privacyMode: 'private',
    status: 'new',
    retentionClass: 'normal',
    cleanupEligible: true,
    fingerprint: 'fingerprint',
    clusterId: 'cluster-fingerprint',
    safeContext: {
      appVersion: 'dev',
      buildCommit: 'dev',
      gameId: 'game-1',
      turn: 1,
      phase: 'main1',
      multiplayerStatus: 'disconnected',
      screen: 'game',
    },
    ...overrides,
  } as PlayerReport;
  return {
    ...report,
    expiresAt: overrides.expiresAt ?? calculateReportExpiration(report),
  };
}

function makeCluster(overrides: Partial<ReportCluster> = {}): ReportCluster {
  return {
    clusterId: 'cluster-1',
    fingerprint: 'fingerprint',
    title: 'Bug cluster',
    reportType: 'bug',
    severity: 'medium',
    count: 1,
    affectedBuilds: ['dev'],
    firstSeenAt: 1000,
    lastSeenAt: 1000,
    expiresAt: calculateClusterExpiration(1000),
    sampleReportIds: ['report-1'],
    commonContext: { screen: 'game' },
    suggestedAreas: ['client/src/store/gameStore.ts'],
    sanitizedSummary: 'A bug happened.',
    status: 'new',
    ...overrides,
  };
}

test('calculateReportExpiration applies default retention', () => {
  const expiresAt = calculateReportExpiration(makeReport());
  assert(expiresAt === 1000 + 60 * DAY_MS, 'expected 60 day default retention');
});

test('legal_hold reports do not expire', () => {
  const expiresAt = calculateReportExpiration(makeReport({ retentionClass: 'legal_hold' }));
  assert(expiresAt === Number.MAX_SAFE_INTEGER, 'expected no expiration');
});

test('dismissed reports expire sooner', () => {
  const expiresAt = calculateReportExpiration(makeReport({ status: 'dismissed', dismissedAt: 2000 }));
  assert(expiresAt === 2000 + 14 * DAY_MS, 'expected dismissed report 14 day retention');
});

test('high severity reports keep extended retention', () => {
  const expiresAt = calculateReportExpiration(makeReport({ severity: 'critical' }));
  assert(expiresAt === 1000 + 90 * DAY_MS, 'expected critical report 90 day retention');
});

test('getExpiredReports finds only cleanup-eligible expired reports', () => {
  const expired = makeReport({ reportId: 'expired', expiresAt: 10 });
  const legal = makeReport({ reportId: 'legal', retentionClass: 'legal_hold', expiresAt: 10 });
  const fresh = makeReport({ reportId: 'fresh', expiresAt: 999999999 });
  const result = getExpiredReports([expired, legal, fresh], 1000);
  assert(result.length === 1 && result[0].reportId === 'expired', 'expected only cleanup-eligible expired report');
});

test('cleanup summary reports counts', () => {
  const deleted = [makeReport({ reportId: 'deleted', expiresAt: 10 })];
  const summary = createCleanupSummary(deleted, [], 100);
  assert(summary.deletedReportCount === 1, 'expected deleted report count');
  assert(summary.deletedReportIds[0] === 'deleted', 'expected deleted id');
});

test('reportClusters retain sanitized data after raw reports expire', () => {
  const expiredReport = makeReport({ reportId: 'expired', expiresAt: 10 });
  const retainedCluster = makeCluster({ expiresAt: 999999 });
  assert(cleanupExpiredReports([expiredReport], 1000).length === 0, 'expected raw report cleanup');
  assert(cleanupExpiredClusters([retainedCluster], 1000).length === 1, 'expected cluster retained');
});

test('expired clusters are detected by cluster expiresAt', () => {
  const expiredCluster = makeCluster({ clusterId: 'cluster-old', expiresAt: 10 });
  const activeCluster = makeCluster({ clusterId: 'cluster-active', expiresAt: 999999 });
  const expired = getExpiredClusters([expiredCluster, activeCluster], 1000);
  assert(expired.length === 1 && expired[0].clusterId === 'cluster-old', 'expected expired cluster only');
});

chain.finally(() => {
  console.log(`\nReport retention tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
