import { createAnimationsForAction } from '../client/src/engine/replayAnimationEngine';
import { createReplayFileFromGame } from '../client/src/engine/replayEngine';
import { useGameStore } from '../client/src/store/gameStore';
import type { ActionRecord, CardDefinition, CardState, GameState, Player } from '../client/src/types/game';
import type { ReplayPrivacy } from '../client/src/types/replay';

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

const privatePrivacy: ReplayPrivacy = { includesPrivateZones: true };
const publicPrivacy: ReplayPrivacy = { includesPrivateZones: false, redactedPlayers: ['p1'] };

function cardDef(name: string): CardDefinition {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    cmc: 1,
    typeLine: 'Creature',
    superTypes: [],
    cardTypes: ['Creature'],
    subTypes: [],
    oracleText: '',
    colors: [],
    colorIdentity: [],
    keywords: [],
    isDoubleFaced: false,
    legalities: {},
  };
}

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
    hand: id === 'p1' ? ['hidden-card'] : [],
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

function game(): GameState {
  const hidden: CardState = {
    instanceId: 'hidden-card',
    definitionId: 'secret-dragon',
    definition: cardDef('Secret Dragon'),
    zone: 'hand',
    ownerId: 'p1',
    controllerId: 'p1',
    tapped: false,
    faceDown: false,
    transformed: false,
    phased: false,
    counters: [],
    attachments: [],
    markedForDamage: 0,
    summoningSick: false,
    token: false,
    copy: false,
    notes: '',
    exilePermanent: false,
    combatRole: 'none',
    combatDamageAssigned: 0,
  };
  return {
    id: 'animation-game',
    rulesetVersion: 'test',
    config: { playerCount: 2, format: 'commander', startingLife: 40, useCommanderDamage: true, useInfect: true, startingHandSize: 7, maxMulligans: 7, commanderTaxEnabled: true, houseRules: [], timerEnabled: false },
    players: [player('p1', 'Player A'), player('p2', 'Player B')],
    cards: { [hidden.instanceId]: hidden },
    definitions: { [hidden.definitionId]: hidden.definition },
    turn: 1,
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
    phase: 'main1',
    stack: [],
    triggerQueue: [],
    actionLog: [],
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

function action(actionType: ActionRecord['actionType'], description = actionType, data: Record<string, unknown> = {}, affectedObjects: string[] = ['hidden-card']): ActionRecord {
  return {
    id: `${actionType}-${description}`.replace(/\W+/g, '-'),
    turn: 1,
    phase: actionType === 'DECLARE_ATTACKER' ? 'declareAttackers' : 'main1',
    playerId: 'p1',
    actionType,
    timestamp: 1,
    description,
    affectedObjects,
    data,
    flags: [],
    undone: false,
  };
}

await test('draw action creates draw_card animation', () => {
  const animations = createAnimationsForAction(action('DRAW_CARD'), game(), game(), privatePrivacy);
  assert(animations[0]?.type === 'draw_card', 'expected draw_card');
});

await test('cast action creates cast_spell animation', () => {
  const animations = createAnimationsForAction(action('CAST_SPELL'), game(), game(), privatePrivacy);
  assert(animations[0]?.type === 'cast_spell', 'expected cast_spell');
});

await test('zone move creates move_card animation', () => {
  const animations = createAnimationsForAction(action('MOVE_CARD', 'Moved card', { fromZone: 'hand', toZone: 'battlefield' }), game(), game(), privatePrivacy);
  assert(animations[0]?.type === 'move_card' && animations[0].destinationZone === 'battlefield', 'expected move_card to battlefield');
});

await test('token stack attack creates one grouped attack animation', () => {
  const affected = Array.from({ length: 20 }, (_, index) => `token-${index}`);
  const animations = createAnimationsForAction(action('DECLARE_ATTACKER', '20 tokens attacked', { targetPlayerId: 'p2' }, affected), game(), game(), privatePrivacy);
  assert(animations.length === 1 && animations[0].type === 'attack', `expected one grouped attack animation, got ${animations.length}`);
});

await test('Firebending action creates mechanic_firebending animation', () => {
  assert(createAnimationsForAction(action('OTHER', 'Firebending added mana'), game(), game(), privatePrivacy)[0]?.type === 'mechanic_firebending', 'expected firebending');
});

await test('Airbend action creates mechanic_airbend animation', () => {
  assert(createAnimationsForAction(action('OTHER', 'Airbend target permanent'), game(), game(), privatePrivacy)[0]?.type === 'mechanic_airbend', 'expected airbend');
});

await test('Earthbend action creates mechanic_earthbend animation', () => {
  assert(createAnimationsForAction(action('OTHER', 'Earthbend land'), game(), game(), privatePrivacy)[0]?.type === 'mechanic_earthbend', 'expected earthbend');
});

await test('Sneak action creates mechanic_sneak animation', () => {
  assert(createAnimationsForAction(action('CAST', 'Sneak cast a creature'), game(), game(), privatePrivacy)[0]?.type === 'mechanic_sneak', 'expected sneak');
});

await test('unknown action creates manual animation', () => {
  assert(createAnimationsForAction(action('ROLL_DICE', 'Rolled a die', {}, []), game(), game(), privatePrivacy)[0]?.type === 'manual', 'expected manual');
});

await test('animation mode off returns no active animation', () => {
  assert(createAnimationsForAction(action('DRAW_CARD'), game(), game(), privatePrivacy, 'off').length === 0, 'expected no animations when off');
});

await test('public replay does not expose hidden card names in labels', () => {
  const animations = createAnimationsForAction(action('CAST_SPELL'), game(), game(), publicPrivacy);
  assert(!animations[0].label.includes('Secret Dragon'), `label leaked hidden name: ${animations[0].label}`);
});

await test('scrubbing clears pending animations', async () => {
  useGameStore.getState().initGame(useGameStore.getState().game.config, [
    { id: 'p1', name: 'Player A', color: '#3b82f6' },
    { id: 'p2', name: 'Player B', color: '#ef4444' },
  ]);
  const file = { ...createReplayFileFromGame(useGameStore.getState().game, { includePrivateZones: true, includeFinalSnapshot: false, redacted: false }), actionLog: [action('DRAW_CARD')] };
  await useGameStore.getState().loadReplayFile(file);
  useGameStore.getState().replaySetAnimationMode('simple');
  useGameStore.getState().replayStepForward();
  assert((useGameStore.getState().replay?.currentAnimations.length ?? 0) > 0, 'expected animation before scrub');
  useGameStore.getState().replayJumpToAction(-1);
  assert((useGameStore.getState().replay?.currentAnimations.length ?? 0) === 0, 'expected scrub to clear animations');
});

await test('animation playback does not mutate game state', () => {
  const before = JSON.stringify(game());
  const state = game();
  createAnimationsForAction(action('MOVE_CARD'), state, state, privatePrivacy);
  assert(JSON.stringify(state) === before, 'expected animation generation to be pure');
});

await test('replay can jump when animations are disabled', () => {
  useGameStore.getState().replaySetAnimationMode('off');
  useGameStore.getState().replayJumpToAction(0);
  assert(useGameStore.getState().replay?.currentActionIndex === 0, 'expected jump with animations off');
});

console.log(`\nReplay animation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
