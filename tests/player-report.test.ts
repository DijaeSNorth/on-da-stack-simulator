import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import {
  buildPlayerReport,
  exportPlayerReportJson,
  hashReportValue,
} from '../client/src/engine/reportService';
import { submitPlayerReport } from '../client/src/engine/firebaseReportService';
import { buildSanitizedGitHubIssueBodyFromReport, buildSanitizedGitHubIssueUrlFromReport } from '../client/src/engine/issueReport';
import { ReportButton } from '../client/src/components/report/ReportButton';
import {
  createAction,
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
} from '../client/src/engine/gameEngine';
import type { CardDefinition, GameState } from '../client/src/types/game';
import type { MultiplayerState, UIState } from '../client/src/store/gameStore';

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

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  clear(): void { this.values.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
});

const secretDef: CardDefinition = {
  id: 'secret-card',
  name: 'Secret Tutor',
  cmc: 2,
  typeLine: 'Sorcery',
  superTypes: [],
  cardTypes: ['Sorcery'],
  subTypes: [],
  oracleText: 'Search your library.',
  colors: ['B'],
  colorIdentity: ['B'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
};

function makeGame(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Reporter', 0, '#22c55e', config);
  const p2 = createPlayer('p2', 'Opponent', 1, '#ef4444', config);
  const hidden = createCardState(secretDef, 'p1', 'hand');
  const withHidden = {
    ...base,
    status: 'playing' as const,
    players: [{ ...p1, hand: [hidden.instanceId], deckId: 'deck-1' }, p2],
    cards: { [hidden.instanceId]: hidden },
    definitions: { [secretDef.id]: secretDef },
    turn: 3,
    phase: 'main1' as const,
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
  };
  const action = createAction(withHidden, 'p1', 'SEARCH_LIBRARY', 'Reporter searched for Secret Tutor from hand', [hidden.instanceId], {
    hand: ['Secret Tutor'],
    participantToken: 'token-private',
  });
  return { ...withHidden, actionLog: [action] };
}

function makeUi(): UIState {
  return {
    screen: 'game',
    soloModeTab: 'builder',
    selectedCardId: null,
    hoveredCardId: null,
    focusedPlayerId: null,
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
  };
}

function makeMultiplayer(): MultiplayerState {
  return {
    status: 'joined',
    roomCode: 'ABC123',
    peerId: 'peer-1',
    playerId: 'p1',
    sessionId: 'session-1',
    isHost: false,
    isSpectator: false,
    peers: {},
    lobby: { roomCode: 'ABC123', status: 'lobby', hostPeerId: 'peer-host', players: [], submittedDecks: {}, updatedAt: 1 },
    configured: true,
    startHandshake: null,
  };
}

function makeReport(overrides = {}) {
  return buildPlayerReport({
    game: makeGame(),
    ui: makeUi(),
    multiplayer: makeMultiplayer(),
    localPlayerId: 'p1',
    input: {
      type: 'bug',
      severity: 'medium',
      title: 'Library search leaked private card',
      description: 'Room code ABC123 saw Firebase UID: abc123 and participantToken token-private while Secret Tutor was hidden.',
      privacyMode: 'sanitized_public',
      includeActionLog: true,
      includePublicSnapshot: true,
      ...overrides,
    },
    browserInfo: 'PlayerReportTest/1.0',
    now: 1000,
  });
}

test('Build report payload with safe context', () => {
  const report = makeReport();
  assert(report.reportId.startsWith('report-'), 'expected report id');
  assert(report.safeContext.gameId === report.gameId, 'expected game context');
  assert(report.safeContext.roomCodeHash === hashReportValue('ABC123'), 'expected room hash');
  assert(report.safeContext.actionLog?.length === 1, 'expected safe action log');
});

test('Private report excludes hands and libraries by default', () => {
  const report = makeReport({ includePublicSnapshot: true, includeActionLog: true });
  const raw = exportPlayerReportJson(report);
  assert(!raw.includes('"hand":'), 'expected no raw hand array');
  assert(!raw.includes('"library":'), 'expected no raw library array');
  assert(raw.includes('"handCount"'), 'expected hand count');
  assert(raw.includes('"libraryCount"'), 'expected library count');
  assert(!raw.includes('Secret Tutor'), 'expected hidden card name redacted');
});

test('Private report excludes Firebase UID and participant token', () => {
  const raw = exportPlayerReportJson(makeReport());
  assert(!/Firebase UID:\s*abc123/i.test(raw), 'expected Firebase UID redacted');
  assert(!raw.includes('token-private'), 'expected participant token redacted');
});

test('Room code is hashed or redacted', () => {
  const raw = exportPlayerReportJson(makeReport());
  assert(!raw.includes('ABC123'), 'expected raw room code excluded');
  assert(raw.includes(hashReportValue('ABC123') ?? ''), 'expected room hash present');
});

test('Public sanitized GitHub issue body excludes private data', () => {
  const report = makeReport();
  const body = buildSanitizedGitHubIssueBodyFromReport(report);
  assert(body, 'expected sanitized issue body');
  assert(!body.includes('Secret Tutor'), 'expected hidden card omitted');
  assert(!body.includes('ABC123'), 'expected raw room code omitted');
  assert(!body.includes('token-private'), 'expected token omitted');
  assert(buildSanitizedGitHubIssueUrlFromReport(report)?.startsWith('https://github.com/'), 'expected GitHub URL');
});

test('Player behavior report defaults to private', () => {
  const report = makeReport({ type: 'player_behavior', privacyMode: undefined });
  assert(report.privacyMode === 'private', 'expected private behavior report');
  assert(buildSanitizedGitHubIssueUrlFromReport(report) === null, 'expected no public GitHub issue for behavior report');
});

test('Firebase report service gracefully falls back when Firebase disabled', async () => {
  const result = await submitPlayerReport(makeReport({ privacyMode: 'private' }));
  assert(result.submittedToFirebase === false, 'expected no Firebase submit in test env');
  assert(result.localExportJson.includes('"reportId"'), 'expected local export JSON');
});

test('Report button renders modal opener', () => {
  const html = renderToString(createElement(ReportButton, { defaultType: 'bug', label: 'Report' }));
  assert(html.includes('btn-open-report-modal'), 'expected report opener test id');
  assert(html.includes('Report'), 'expected report label');
});

test('RTDB rules include scoped private report indexes', () => {
  const rules = JSON.parse(readFileSync('database.rules.json', 'utf8'));
  assert(!rules.rules.rooms['.read'], 'expected no broad rooms parent read');
  assert(rules.rules.reports['.read'] === false, 'expected reports not publicly readable');
  assert(rules.rules.reports['.indexOn'].includes('expiresAt'), 'expected report expiresAt index');
  assert(rules.rules.reports['.indexOn'].includes('clusterId'), 'expected report clusterId index');
  assert(rules.rules.reportClusters['.indexOn'].includes('fingerprint'), 'expected cluster fingerprint index');
});

chain.finally(() => {
  console.log(`\nPlayer report tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
