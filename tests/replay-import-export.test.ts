import { createReplayFileFromGame } from '../client/src/engine/replayEngine';
import {
  clearRecentReplayImports,
  formatReplayFileName,
  importReplayCandidate,
  loadRecentReplayImports,
  saveRecentReplayImport,
  summarizeReplayFile,
} from '../client/src/engine/replayFileUtils';
import { useGameStore } from '../client/src/store/gameStore';
import type { ActionRecord, GameState, Player } from '../client/src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
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

function player(id: string, name: string): Player {
  return {
    id,
    name,
    color: '#3b82f6',
    seatIndex: id === 'p1' ? 0 : 1,
    life: 40,
    mulliganCount: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 },
    commanderDamage: {},
    poisonCounters: 0,
    energyCounters: 0,
    experienceCounters: 0,
    commanderCastCount: {},
    commanders: [],
    isReady: true,
    isActive: id === 'p1',
    hasPriority: id === 'p1',
    hand: [],
    library: [],
    graveyard: [],
    exile: [],
    sideboard: [],
    maybeboard: [],
    commandZone: [],
    battlefield: [],
    connected: true,
    isSpectator: false,
    settings: {
      assistantMode: 'ON',
      assistantVerbosity: 'normal',
      showTriggerReminders: true,
      showStackExplanations: true,
      coachingLevel: 'advanced',
      isJudgeMode: false,
    },
  };
}

function cardDef(name: string) {
  return {
    id: name,
    name,
    cmc: 1,
    typeLine: 'Creature',
    superTypes: [],
    cardTypes: ['Creature' as const],
    subTypes: [],
    oracleText: '',
    colors: [],
    colorIdentity: [],
    keywords: [],
    isDoubleFaced: false,
    legalities: {},
  };
}

function action(id: string, type: ActionRecord['actionType'], description: string, data: Record<string, unknown> = {}, affectedObjects: string[] = []): ActionRecord {
  return {
    id,
    turn: 1,
    phase: 'main1',
    playerId: 'p1',
    actionType: type,
    timestamp: 1000,
    description,
    affectedObjects,
    data,
    flags: [],
    undone: false,
  };
}

function game(): GameState {
  const p1 = player('p1', 'Player A');
  const p2 = {
    ...player('p2', 'Player B'),
    hand: ['hidden-hand'],
    library: ['hidden-lib'],
    sideboard: ['hidden-side'],
    maybeboard: ['hidden-maybe'],
  };
  return {
    id: 'game-import-export',
    rulesetVersion: 'rules-test',
    config: {
      playerCount: 2,
      format: 'commander',
      startingLife: 40,
      useCommanderDamage: true,
      useInfect: true,
      startingHandSize: 7,
      maxMulligans: 7,
      commanderTaxEnabled: true,
      houseRules: [],
      timerEnabled: false,
    },
    players: [p1, p2],
    cards: {
      'hidden-hand': { instanceId: 'hidden-hand', definitionId: 'h1', definition: cardDef('Secret Hand Card'), zone: 'hand', ownerId: 'p2', controllerId: 'p2', tapped: false, faceDown: false, transformed: false, phased: false, counters: [], attachments: [], markedForDamage: 0, summoningSick: false, token: false, copy: false, notes: '', exilePermanent: false, combatRole: 'none', combatDamageAssigned: 0 },
      'hidden-lib': { instanceId: 'hidden-lib', definitionId: 'h2', definition: cardDef('Secret Library Card'), zone: 'library', ownerId: 'p2', controllerId: 'p2', tapped: false, faceDown: false, transformed: false, phased: false, counters: [], attachments: [], markedForDamage: 0, summoningSick: false, token: false, copy: false, notes: '', exilePermanent: false, combatRole: 'none', combatDamageAssigned: 0 },
      'hidden-side': { instanceId: 'hidden-side', definitionId: 'h3', definition: cardDef('Secret Sideboard Card'), zone: 'sideboard', ownerId: 'p2', controllerId: 'p2', tapped: false, faceDown: false, transformed: false, phased: false, counters: [], attachments: [], markedForDamage: 0, summoningSick: false, token: false, copy: false, notes: '', exilePermanent: false, combatRole: 'none', combatDamageAssigned: 0 },
      'hidden-maybe': { instanceId: 'hidden-maybe', definitionId: 'h4', definition: cardDef('Secret Maybe Card'), zone: 'maybeboard', ownerId: 'p2', controllerId: 'p2', tapped: false, faceDown: false, transformed: false, phased: false, counters: [], attachments: [], markedForDamage: 0, summoningSick: false, token: false, copy: false, notes: '', exilePermanent: false, combatRole: 'none', combatDamageAssigned: 0 },
    },
    definitions: {},
    turn: 1,
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
    phase: 'main1',
    stack: [],
    triggerQueue: [],
    actionLog: [
      action('a1', 'SEARCH_LIBRARY', 'Player B searched for Secret Library Card', { private: true, library: ['hidden-lib'], choices: ['hidden-lib'] }, ['hidden-lib']),
      action('a2', 'CHANGE_LIFE', 'Player B lost 2 life', { playerId: 'p2', delta: -2 }),
    ],
    assistantFlags: [],
    combat: { active: false, attackingPlayerId: '', attackers: [], blockers: [], attackAssignments: [], blockAssignments: [], combatPhase: 'none', hasMyriad: false, myriadCopies: [] },
    houseRules: [],
    turnTrackers: { spellsWarpedThisTurn: [], cardsAirbendedThisTurn: [], waterbendEventsThisTurn: [], earthbentThisTurn: [] },
    snapshots: {},
    undoPointer: -1,
    createdAt: 1,
    lastUpdatedAt: 1,
    status: 'playing',
  };
}

function candidate(name: string, body: string, size = body.length, type = 'application/json') {
  return {
    name,
    size,
    type,
    text: async () => body,
  };
}

async function main(): Promise<void> {
  await test('valid replay file imports successfully', async () => {
    const replay = createReplayFileFromGame(game(), { includePrivateZones: false, includeFinalSnapshot: true, redacted: true }, { gameName: 'Import Test', appVersion: '1.0.0' });
    const result = await importReplayCandidate(candidate('valid.json', JSON.stringify(replay)));
    assert(result.ok && Boolean(result.replayFile), 'expected valid replay import');
    const loaded = await useGameStore.getState().loadReplayFile(result.replayFile);
    assert(loaded, 'expected store to load imported replay');
  });

  await test('invalid JSON returns friendly error', async () => {
    const result = await importReplayCandidate(candidate('bad.json', '{bad'));
    assert(!result.ok && result.errors.includes('Invalid JSON.'), 'expected Invalid JSON error');
  });

  await test('unsupported version returns friendly error', async () => {
    const replay = { ...createReplayFileFromGame(game(), { includePrivateZones: false, includeFinalSnapshot: false, redacted: true }), replayVersion: '99.0.0' };
    const result = await importReplayCandidate(candidate('future.json', JSON.stringify(replay)));
    assert(!result.ok && result.errors.some(error => error.includes('Unsupported replayVersion')), 'expected unsupported replayVersion error');
  });

  await test('non-json file is rejected', async () => {
    const result = await importReplayCandidate(candidate('replay.txt', '{}', 2, 'text/plain'));
    assert(!result.ok && result.errors.some(error => error.includes('Non-json')), 'expected non-json rejection');
  });

  await test('oversized file is rejected', async () => {
    const result = await importReplayCandidate(candidate('big.json', '{}', 30, 'application/json'), { maxBytes: 10 });
    assert(!result.ok && result.errors.includes('Replay file too large.'), 'expected oversized rejection');
  });

  await test('public export redacts private zones', () => {
    const replay = createReplayFileFromGame(game(), { includePrivateZones: false, includeFinalSnapshot: true, redacted: true });
    assert(!replay.initialGameState.cards['hidden-hand'], 'expected hand identity removed');
    assert(!replay.initialGameState.cards['hidden-lib'], 'expected library identity removed');
    assert(replay.initialGameState.players[1].sideboard.length === 0, 'expected sideboard cleared');
    assert(replay.initialGameState.players[1].maybeboard.length === 0, 'expected maybeboard cleared');
  });

  await test('public export keeps hand and library counts', () => {
    const replay = createReplayFileFromGame(game(), { includePrivateZones: false, includeFinalSnapshot: true, redacted: true });
    assert(replay.initialGameState.players[1].hand.length === 1, 'expected hand count preserved');
    assert(replay.initialGameState.players[1].library.length === 1, 'expected library count preserved');
  });

  await test('private export includes private zones', () => {
    const replay = createReplayFileFromGame(game(), { includePrivateZones: true, includeFinalSnapshot: true, redacted: false });
    assert(Boolean(replay.initialGameState.cards['hidden-hand']), 'expected hand card identity included');
    assert(Boolean(replay.initialGameState.cards['hidden-lib']), 'expected library card identity included');
    assert(replay.privacy.includesPrivateZones, 'expected private privacy marker');
  });

  await test('export file name includes gameId and privacy mode', () => {
    const replay = createReplayFileFromGame(game(), { includePrivateZones: false, includeFinalSnapshot: false, redacted: true });
    const name = formatReplayFileName(replay, 'public');
    assert(name.includes('game-import-export') && name.endsWith('-public.json'), `unexpected file name ${name}`);
  });

  await test('replay summary displays player, action, and privacy metadata', () => {
    const replay = createReplayFileFromGame(game(), { includePrivateZones: false, includeFinalSnapshot: false, redacted: true });
    const summary = summarizeReplayFile(replay, 'summary.json');
    assert(summary.players.includes('Player A') && summary.actionCount === 2 && summary.privacyMode === 'redacted', 'expected summary metadata');
  });

  await test('recent replay metadata stores without full private contents', () => {
    clearRecentReplayImports();
    const replay = createReplayFileFromGame(game(), { includePrivateZones: true, includeFinalSnapshot: true, redacted: false });
    const summary = summarizeReplayFile(replay, 'private.json');
    saveRecentReplayImport(summary);
    const raw = localStorage.getItem('on-da-stack-recent-replay-imports-v1') || '';
    assert(!raw.includes('Secret Hand Card') && !raw.includes('initialGameState'), 'expected metadata only');
    assert(loadRecentReplayImports().length === 1, 'expected one recent replay');
  });

  await test('public export labels do not leak hidden card names', () => {
    const replay = createReplayFileFromGame(game(), { includePrivateZones: false, includeFinalSnapshot: false, redacted: true });
    const raw = JSON.stringify(replay.actionLog);
    assert(!raw.includes('Secret Library Card'), 'expected hidden card name redacted from action log');
  });

  if (failed > 0) process.exit(1);
  console.log(`Replay import/export tests passed: ${passed}`);
}

void main();
