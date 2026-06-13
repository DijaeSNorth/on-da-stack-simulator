import {
  SOLO_REPORT_HISTORY_CAP,
  SOLO_REPORT_HISTORY_KEY,
  buildSoloReportHistoryViewModel,
  clearSoloReports,
  compareSoloReports,
  deleteSoloReport,
  exportSoloReportHistory,
  getSavedSoloReports,
  getSavedSoloReportsWithWarnings,
  getSoloReportResponsibilityCopy,
  importSoloReportHistory,
  saveSoloReport,
} from '../client/src/engine/soloReportStorage';
import type { SavedSoloReport, SoloPerformanceReport } from '../client/src/types/game';

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

function installLocalStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() { return store.size; },
    },
    configurable: true,
  });
}

function resetStorage(): void {
  installLocalStorage();
  clearSoloReports();
}

function makeReport(id: string, overrides: Partial<SoloPerformanceReport> = {}): SoloPerformanceReport {
  return {
    id,
    deckId: overrides.deckId ?? 'deck-a',
    deckName: overrides.deckName ?? 'Deck A',
    sessionType: overrides.sessionType ?? 'goldfish',
    generatedAt: overrides.generatedAt ?? 100,
    turnsPlayed: overrides.turnsPlayed ?? 3,
    actionsCount: overrides.actionsCount ?? 8,
    openingHand: overrides.openingHand ?? {
      landCount: 2,
      nonlandCount: 5,
      averageManaValue: 2.8,
      mulligansTaken: 1,
      keptHandSize: 6,
    },
    manaDevelopment: overrides.manaDevelopment ?? {
      landsPlayed: 2,
      turnsMissedLandDrop: [3],
      firstThreeTurnsLandDrops: 2,
    },
    boardDevelopment: overrides.boardDevelopment ?? {
      firstPermanentTurn: 2,
      firstCreatureTurn: 2,
      creaturesPlayed: 1,
      noncreatureSpellsPlayed: 1,
      tokensCreated: 0,
    },
    combat: overrides.combat ?? {
      totalDamageDealt: 6,
      totalDamageTaken: 2,
      turnOfFirstAttack: 3,
      turnOfLethal: undefined,
      attacksDeclared: 1,
      blockersDeclared: 0,
    },
    cardFlow: overrides.cardFlow ?? {
      cardsDrawn: 3,
      cardsDiscarded: 0,
      cardsTutoredOrSearched: 0,
      cardsInHandAtEnd: 4,
    },
    dummy: overrides.dummy,
    warnings: overrides.warnings ?? [],
    suggestions: overrides.suggestions ?? ['Opening mana may be inconsistent.'],
  };
}

function makeSaved(report: SoloPerformanceReport, savedAt = report.generatedAt): SavedSoloReport {
  return {
    id: `saved-${report.id}`,
    savedAt,
    deckId: report.deckId,
    deckName: report.deckName,
    sessionType: report.sessionType,
    report,
  };
}

test('Save report to localStorage', () => {
  resetStorage();
  const saved = saveSoloReport(makeReport('report-save'), { savedAt: 1, tags: ['test'], notes: 'opening hand' });
  const raw = globalThis.localStorage.getItem(SOLO_REPORT_HISTORY_KEY);
  assert(raw?.includes(saved.id), 'expected saved report in localStorage');
});

test('Load saved reports', () => {
  resetStorage();
  saveSoloReport(makeReport('report-load'), { savedAt: 2 });
  const reports = getSavedSoloReports();
  assert(reports.length === 1, `expected one report, got ${reports.length}`);
  assert(reports[0].report.id === 'report-load', 'expected saved report id');
});

test('Delete report', () => {
  resetStorage();
  const saved = saveSoloReport(makeReport('report-delete'), { savedAt: 3 });
  const reports = deleteSoloReport(saved.id);
  assert(reports.length === 0, 'expected report deleted');
  assert(getSavedSoloReports().length === 0, 'expected storage empty after delete');
});

test('Clear reports', () => {
  resetStorage();
  saveSoloReport(makeReport('report-clear'), { savedAt: 4 });
  clearSoloReports();
  assert(getSavedSoloReports().length === 0, 'expected no reports after clear');
});

test('Corrupt localStorage returns empty array and warning', () => {
  resetStorage();
  globalThis.localStorage.setItem(SOLO_REPORT_HISTORY_KEY, '{bad json');
  const result = getSavedSoloReportsWithWarnings();
  assert(result.reports.length === 0, 'expected empty reports for corrupt storage');
  assert(result.warnings.length > 0, 'expected warning for corrupt storage');
});

test('History cap keeps newest 50', () => {
  resetStorage();
  for (let index = 0; index < SOLO_REPORT_HISTORY_CAP + 5; index += 1) {
    saveSoloReport(makeReport(`report-${index}`, { generatedAt: index }), { savedAt: index });
  }
  const reports = getSavedSoloReports();
  assert(reports.length === SOLO_REPORT_HISTORY_CAP, `expected cap ${SOLO_REPORT_HISTORY_CAP}, got ${reports.length}`);
  assert(reports[0].report.id === `report-${SOLO_REPORT_HISTORY_CAP + 4}`, 'expected newest report first');
});

test('Export history creates valid JSON', () => {
  resetStorage();
  saveSoloReport(makeReport('report-export'), { savedAt: 5 });
  const parsed = JSON.parse(exportSoloReportHistory()) as { reports?: unknown[]; responsibilityNotice?: string };
  assert(Array.isArray(parsed.reports), 'expected reports array');
  assert(parsed.reports.length === 1, 'expected one exported report');
  assert(Boolean(parsed.responsibilityNotice), 'expected responsibility notice');
});

test('Import history validates reports', () => {
  resetStorage();
  const raw = JSON.stringify({ reports: [makeSaved(makeReport('report-import'), 6), { id: 'bad' }] });
  const result = importSoloReportHistory(raw);
  assert(result.importedCount === 1, `expected one import, got ${result.importedCount}`);
  assert(result.warnings.length === 1, 'expected warning for invalid report');
  assert(getSavedSoloReports()[0].report.id === 'report-import', 'expected imported report saved');
});

test('Export does not include Firebase auth UID or participant tokens', () => {
  resetStorage();
  const unsafe = makeSaved(makeReport('report-private'), 7) as SavedSoloReport & {
    firebaseAuthUid?: string;
    participantTokens?: string[];
  };
  unsafe.firebaseAuthUid = 'firebase-user-secret';
  unsafe.participantTokens = ['participant-token-secret'];
  globalThis.localStorage.setItem(SOLO_REPORT_HISTORY_KEY, JSON.stringify([unsafe]));
  const exported = exportSoloReportHistory();
  assert(!exported.includes('firebase-user-secret'), 'expected Firebase UID omitted');
  assert(!exported.includes('participant-token-secret'), 'expected participant token omitted');
});

test('Export does not include multiplayer room control data', () => {
  resetStorage();
  const unsafe = makeSaved(makeReport('report-room'), 8) as SavedSoloReport & {
    roomCode?: string;
    peerId?: string;
    multiplayer?: { roomCode: string };
  };
  unsafe.roomCode = 'ABC123';
  unsafe.peerId = 'peer-secret';
  unsafe.multiplayer = { roomCode: 'ROOMSECRET' };
  globalThis.localStorage.setItem(SOLO_REPORT_HISTORY_KEY, JSON.stringify([unsafe]));
  const exported = exportSoloReportHistory();
  assert(!exported.includes('ABC123'), 'expected room code omitted');
  assert(!exported.includes('peer-secret'), 'expected peer id omitted');
  assert(!exported.includes('ROOMSECRET'), 'expected multiplayer data omitted');
});

test('Compare two reports returns expected metric differences', () => {
  const first = makeSaved(makeReport('report-compare-a', { combat: { ...makeReport('base').combat, totalDamageDealt: 4 }, generatedAt: 1 }), 1);
  const second = makeSaved(makeReport('report-compare-b', { combat: { ...makeReport('base').combat, totalDamageDealt: 10 }, generatedAt: 2 }), 2);
  const comparison = compareSoloReports(first, second);
  const damage = comparison.metrics.find(metric => metric.label === 'Damage dealt');
  assert(damage?.difference === 6, `expected damage difference 6, got ${damage?.difference}`);
});

test('UI model filters by deck and session type', () => {
  const reports = [
    makeSaved(makeReport('deck-a-goldfish', { deckId: 'deck-a', deckName: 'Deck A', sessionType: 'goldfish' }), 1),
    makeSaved(makeReport('deck-b-dummy', { deckId: 'deck-b', deckName: 'Deck B', sessionType: 'dummy' }), 2),
  ];
  const view = buildSoloReportHistoryViewModel(reports, { deckId: 'deck-b', sessionType: 'dummy' });
  assert(view.visibleCount === 1, `expected one visible report, got ${view.visibleCount}`);
  assert(view.reports[0].report.id === 'deck-b-dummy', 'expected deck-b dummy report');
});

test('User-responsibility warning text is present in report history UI model', () => {
  const text = getSoloReportResponsibilityCopy();
  assert(text.includes('stored in this browser'), 'expected browser storage warning');
  assert(text.includes('Export anything you want to keep or back up'), 'expected export backup warning');
  const view = buildSoloReportHistoryViewModel([]);
  assert(view.warningText === text, 'expected UI model warning text');
});

void chain.then(() => {
  console.log(`\nSolo report history tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
