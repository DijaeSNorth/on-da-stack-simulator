/**
 * Combat data model compatibility checks.
 *
 * Run with: npx tsx tests/combat-model.test.ts
 */

import {
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  declareAttacker,
  declareBlocker,
  getLegalAttackTargetsForPlayer,
  getTargetPlayerIdFromAttackTarget,
  getUnblockedAttackAssignments,
} from '../client/src/engine/gameEngine';
import type { CardDefinition, GameState } from '../client/src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

const creatureDef: CardDefinition = {
  id: 'combat-creature',
  name: 'Combat Creature',
  cmc: 2,
  typeLine: 'Creature - Test',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Test'],
  oracleText: '',
  colors: ['R'],
  colorIdentity: ['R'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '2',
  toughness: '2',
};

const planeswalkerDef: CardDefinition = {
  ...creatureDef,
  id: 'combat-planeswalker',
  name: 'Test Walker',
  typeLine: 'Legendary Planeswalker - Test',
  cardTypes: ['Planeswalker'],
  subTypes: ['Test'],
  power: undefined,
  toughness: undefined,
  loyalty: 4,
};

function makeGame(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Player 1', 0, '#ef4444', config);
  const p2 = createPlayer('p2', 'Player 2', 1, '#3b82f6', config);
  p1.isActive = true;
  p1.hasPriority = true;
  return { ...base, players: [p1, p2], activePlayerId: 'p1', priorityPlayerId: 'p1' };
}

function addPermanent(game: GameState, def: CardDefinition, ownerId: string): { game: GameState; id: string } {
  const card = { ...createCardState(def, ownerId, 'library'), zone: 'battlefield' as const, summoningSick: false };
  return {
    id: card.instanceId,
    game: {
      ...game,
      cards: { ...game.cards, [card.instanceId]: card },
      players: game.players.map(player =>
        player.id === ownerId
          ? { ...player, battlefield: [...player.battlefield, card.instanceId] }
          : player
      ),
    },
  };
}

test('declareAttacker with targetPlayerId creates AttackDefenderTarget player', () => {
  const added = addPermanent(makeGame(), creatureDef, 'p1');
  const game = declareAttacker(added.game, added.id, 'p2');
  const legacy = game.combat.attackers[0];
  assert(legacy.targetPlayerId === 'p2', 'expected legacy targetPlayerId');
  assert(legacy.attackTarget?.type === 'player', 'expected player attack target');
  assert(legacy.attackTarget.type === 'player' && legacy.attackTarget.playerId === 'p2', 'expected p2 target');
});

test('Attack assignment stores attackerId and defender target', () => {
  const added = addPermanent(makeGame(), creatureDef, 'p1');
  const game = declareAttacker(added.game, added.id, 'p2');
  const assignment = game.combat.attackAssignments[0];
  assert(assignment.attackerIds.includes(added.id), 'expected attacker id in assignment');
  assert(assignment.attackTarget.type === 'player', 'expected player assignment target');
  assert(assignment.count === 1 && !assignment.isTokenStack, 'expected single non-token assignment');
});

test('getTargetPlayerIdFromAttackTarget returns player ID for player target', () => {
  assert(getTargetPlayerIdFromAttackTarget({ type: 'player', playerId: 'p2' }) === 'p2', 'expected p2');
});

test('getLegalAttackTargetsForPlayer includes opponent players', () => {
  const targets = getLegalAttackTargetsForPlayer(makeGame(), 'p1');
  assert(targets.some(target => target.type === 'player' && target.playerId === 'p2'), 'expected p2 target');
});

test('getLegalAttackTargetsForPlayer includes opponent planeswalkers if present', () => {
  const added = addPermanent(makeGame(), planeswalkerDef, 'p2');
  const targets = getLegalAttackTargetsForPlayer(added.game, 'p1');
  assert(targets.some(target => target.type === 'planeswalker' && target.permanentId === added.id), 'expected planeswalker target');
});

test('getUnblockedAttackAssignments returns unblocked assignments', () => {
  const added = addPermanent(makeGame(), creatureDef, 'p1');
  const game = declareAttacker(added.game, added.id, 'p2');
  const unblocked = getUnblockedAttackAssignments(game, 'p1');
  assert(unblocked.length === 1, `expected one unblocked assignment, got ${unblocked.length}`);
  assert(unblocked[0].attackerIds[0] === added.id, 'expected attacker assignment returned');
});

test('getUnblockedAttackAssignments excludes blocked assignments', () => {
  let game = makeGame();
  const attacker = addPermanent(game, creatureDef, 'p1');
  game = attacker.game;
  const blocker = addPermanent(game, { ...creatureDef, id: 'blocker', name: 'Blocker' }, 'p2');
  game = declareAttacker(blocker.game, attacker.id, 'p2');
  game = declareBlocker(game, blocker.id, attacker.id);
  const unblocked = getUnblockedAttackAssignments(game, 'p1');
  assert(unblocked.length === 0, 'expected blocked assignment excluded');
});

console.log(`\nCombat model tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
