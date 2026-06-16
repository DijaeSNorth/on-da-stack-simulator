import { createCodexTriageExport, createCodexTriageMarkdown } from '../client/src/engine/reportExport';
import { buildPlayerReport } from '../client/src/engine/reportService';
import { clusterReports, createClusterCodexPrompt, createReportFingerprint } from '../client/src/engine/reportTriage';
import { createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import type { GameState } from '../client/src/types/game';
import type { MultiplayerState, UIState } from '../client/src/store/gameStore';
import type { PlayerReport, PlayerReportInput } from '../client/src/types/report';

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

function makeGame(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  return {
    ...base,
    status: 'playing',
    turn: 2,
    phase: 'combat',
    players: [
      createPlayer('p1', 'Reporter', 0, '#22c55e', config),
      createPlayer('p2', 'Opponent', 1, '#ef4444', config),
    ],
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
  };
}

const ui = {
  screen: 'game',
  soloModeTab: 'builder',
  rightPanelTab: 'log',
  leftPanelOpen: true,
  rightPanelOpen: true,
  combatMode: false,
  deckBuilderOpen: false,
  lobbyOpen: false,
  zoneDrawer: null,
  cardContextMenu: null,
  cardPreview: null,
  cardPreviewAnchor: null,
  searchQuery: '',
  showTokenEditor: false,
  cardSearchOpen: false,
  replayOpen: false,
  profileOpen: false,
  uiSettingsOpen: false,
  judgeMode: false,
  battlefieldView: 'normal',
  tableViewMode: 'table',
  selectedCardId: null,
  hoveredCardId: null,
  focusedPlayerId: null,
  settings: {
    density: 'normal',
    showMechanicBadges: true,
    showCombatMath: true,
    collapseLandsByDefault: false,
    collapseTokensByDefault: false,
    compactHandThreshold: 8,
    tokenStackThreshold: 3,
    showWarningBadges: true,
    showBuildStamp: true,
  },
  assistantMessages: [],
  actionFilter: '',
  panelSizes: { left: 220, right: 280, deckBuilder: 430 },
} as UIState;

const multiplayer = {
  status: 'joined',
  roomCode: 'ROOM42',
  peerId: 'peer-1',
  playerId: 'p1',
  sessionId: 'session',
  isHost: false,
  isSpectator: false,
  peers: {},
  lobby: null,
  configured: true,
  startHandshake: null,
} as MultiplayerState;

function report(input: Partial<PlayerReportInput>, now: number): PlayerReport {
  return buildPlayerReport({
    game: makeGame(),
    ui,
    multiplayer,
    localPlayerId: 'p1',
    input: {
      type: 'multiplayer_desync',
      severity: 'medium',
      title: 'Joiner life total stopped updating',
      description: 'Joiner sees stale combat damage after block assignment.',
      component: 'MultiplayerPanel',
      actionType: 'SYNC_PATCH',
      includeActionLog: true,
      privacyMode: 'private',
      ...input,
    },
    now,
  });
}

test('Report fingerprint groups similar reports', () => {
  const first = report({}, 1);
  const second = report({}, 2);
  assert(createReportFingerprint(first) === createReportFingerprint(second), 'expected same fingerprint');
  const clusters = clusterReports([first, second]);
  assert(clusters.length === 1, `expected one cluster, got ${clusters.length}`);
  assert(clusters[0].count === 2, 'expected cluster count');
});

test('Different report types do not cluster together', () => {
  const bug = report({ type: 'bug' }, 1);
  const rules = report({ type: 'rules_issue' }, 2);
  const clusters = clusterReports([bug, rules]);
  assert(clusters.length === 2, `expected two clusters, got ${clusters.length}`);
});

test('Codex triage export contains clusters and sample reports', () => {
  const exportFile = createCodexTriageExport([report({}, 1), report({ severity: 'high' }, 2)], { now: 10 });
  assert(exportFile.exportVersion === '1', 'expected export version');
  assert(exportFile.clusters.length === 1, 'expected one cluster');
  assert(exportFile.clusters[0].sampleReports.length > 0, 'expected sample reports');
  assert(exportFile.summary.highestSeverity === 'high', 'expected severity escalation');
});

test('Codex triage export privacy flags exclude private data', () => {
  const raw = JSON.stringify(createCodexTriageExport([report({
    description: 'Firebase UID: uid-secret participantToken token-secret room code ROOM42',
  }, 1)]));
  assert(!raw.includes('uid-secret'), 'expected Firebase UID excluded');
  assert(!raw.includes('token-secret'), 'expected participant token excluded');
  assert(!raw.includes('ROOM42'), 'expected raw room code excluded');
  const exportFile = JSON.parse(raw);
  assert(exportFile.privacy.rawReportsIncluded === false, 'expected no raw reports');
  assert(exportFile.privacy.privateZonesIncluded === false, 'expected no private zones');
});

test('Cluster prompt generator produces useful suggested files', () => {
  const clusters = clusterReports([report({ type: 'multiplayer_connection', component: 'firebase' }, 1)]);
  const prompt = createClusterCodexPrompt(clusters[0]);
  assert(prompt.includes('Investigate report cluster'), 'expected prompt headline');
  assert(prompt.includes('client/src/engine/firebaseSync.ts'), 'expected firebase suggested file');
  assert(prompt.includes('Make the smallest fix'), 'expected repair guidance');
});

test('Markdown export includes sanitized prompt blocks', () => {
  const markdown = createCodexTriageMarkdown([report({}, 1)], { now: 10 });
  assert(markdown.includes('# On-Da-Stack Sanitized Report Triage'), 'expected markdown title');
  assert(markdown.includes('Codex prompt'), 'expected prompt section');
});

chain.finally(() => {
  console.log(`\nReport triage tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
