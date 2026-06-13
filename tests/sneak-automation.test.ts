/**
 * Sneak semi-automation checks.
 *
 * Run with: npx tsx tests/sneak-automation.test.ts
 */

import {
  castWithSneak,
  canCastWithSneak,
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  createSingleAttackAssignment,
  declareAttacker,
  declareBlocker,
} from '../client/src/engine/gameEngine';
import type { AttackDefenderTarget, CardDefinition, GameState } from '../client/src/types/game';

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
  id: 'sneak-test-creature',
  name: 'Test Attacker',
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

const sneakDef: CardDefinition = {
  ...creatureDef,
  id: 'sneak-creature',
  name: 'Sneak Creature',
  oracleText: 'Sneak {1}{B}',
  colors: ['B'],
  colorIdentity: ['B'],
};

const planeswalkerDef: CardDefinition = {
  ...creatureDef,
  id: 'sneak-walker',
  name: 'Target Walker',
  typeLine: 'Legendary Planeswalker - Test',
  cardTypes: ['Planeswalker'],
  subTypes: ['Test'],
  oracleText: '',
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

function addBattlefieldCard(game: GameState, def: CardDefinition, ownerId: string) {
  const card = { ...createCardState(def, ownerId, 'library'), zone: 'battlefield' as const, summoningSick: false };
  return {
    card,
    game: {
      ...game,
      cards: { ...game.cards, [card.instanceId]: card },
      definitions: { ...game.definitions, [def.id]: def },
      players: game.players.map(player =>
        player.id === ownerId
          ? { ...player, battlefield: [...player.battlefield, card.instanceId] }
          : player
      ),
    },
  };
}

function addHandCard(game: GameState, def: CardDefinition, ownerId: string) {
  const card = { ...createCardState(def, ownerId, 'hand'), zone: 'hand' as const };
  return {
    card,
    game: {
      ...game,
      cards: { ...game.cards, [card.instanceId]: card },
      definitions: { ...game.definitions, [def.id]: def },
      players: game.players.map(player =>
        player.id === ownerId
          ? { ...player, hand: [...player.hand, card.instanceId] }
          : player
      ),
    },
  };
}

function setDeclareBlockers(game: GameState): GameState {
  return { ...game, phase: 'declareBlockers', combat: { ...game.combat, combatPhase: 'declareBlockers' } };
}

function setupPlayerTargetSneak(): { game: GameState; attackerId: string; sneakId: string } {
  let game = makeGame();
  const attacker = addBattlefieldCard(game, creatureDef, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const sneak = addHandCard(game, sneakDef, 'p1');
  game = setDeclareBlockers(sneak.game);
  return { game, attackerId: attacker.card.instanceId, sneakId: sneak.card.instanceId };
}

function setupPlaneswalkerTargetSneak(): { game: GameState; attackerId: string; sneakId: string; walkerId: string } {
  let game = makeGame();
  const attacker = addBattlefieldCard(game, creatureDef, 'p1');
  game = attacker.game;
  const walker = addBattlefieldCard(game, planeswalkerDef, 'p2');
  game = walker.game;
  const target: AttackDefenderTarget = { type: 'planeswalker', permanentId: walker.card.instanceId, controllerId: 'p2' };
  const attackingCard = {
    ...game.cards[attacker.card.instanceId],
    tapped: true,
    combatRole: 'attacker' as const,
    attackTarget: 'p2',
  };
  game = {
    ...game,
    cards: { ...game.cards, [attacker.card.instanceId]: attackingCard },
    combat: {
      ...game.combat,
      active: true,
      attackingPlayerId: 'p1',
      attackers: [{ instanceId: attacker.card.instanceId, targetPlayerId: 'p2', targets: [], attackTarget: target }],
      attackAssignments: [
        createSingleAttackAssignment({ ...game, cards: { ...game.cards, [attacker.card.instanceId]: attackingCard } }, attacker.card.instanceId, target),
      ],
    },
  };
  const sneak = addHandCard(game, sneakDef, 'p1');
  game = setDeclareBlockers(sneak.game);
  return { game, attackerId: attacker.card.instanceId, sneakId: sneak.card.instanceId, walkerId: walker.card.instanceId };
}

test('Cannot Sneak outside declare blockers timing', () => {
  const setup = setupPlayerTargetSneak();
  const game = { ...setup.game, phase: 'declareAttackers' as const, combat: { ...setup.game.combat, combatPhase: 'declareAttackers' as const } };
  assert(!canCastWithSneak(game, 'p1', setup.sneakId), 'expected Sneak unavailable before declare blockers');
});

test('Cannot Sneak if no unblocked attacker', () => {
  let setup = setupPlayerTargetSneak();
  const blocker = addBattlefieldCard(setup.game, { ...creatureDef, id: 'sneak-blocker', name: 'Blocker' }, 'p2');
  setup = { ...setup, game: declareBlocker(blocker.game, blocker.card.instanceId, setup.attackerId) };
  assert(!canCastWithSneak(setup.game, 'p1', setup.sneakId), 'expected Sneak unavailable with no unblocked attacker');
});

test('Cannot return opponent attacker', () => {
  const setup = setupPlayerTargetSneak();
  const opponent = addBattlefieldCard(setup.game, { ...creatureDef, id: 'opponent-attacker', name: 'Opponent Attacker' }, 'p2');
  const result = castWithSneak(opponent.game, 'p1', setup.sneakId, opponent.card.instanceId);
  assert(!result.valid, 'expected opponent attacker return rejected');
});

test('Returning unblocked attacker moves it to owner hand', () => {
  const setup = setupPlayerTargetSneak();
  const result = castWithSneak(setup.game, 'p1', setup.sneakId, setup.attackerId);
  const p1 = result.state.players.find(player => player.id === 'p1')!;
  assert(result.valid, result.reason ?? 'expected Sneak success');
  assert(result.state.cards[setup.attackerId].zone === 'hand', 'expected returned attacker in hand');
  assert(p1.hand.includes(setup.attackerId), 'expected owner hand list to include returned attacker');
});

test('Sneak creature enters tapped and attacking same player target', () => {
  const setup = setupPlayerTargetSneak();
  const result = castWithSneak(setup.game, 'p1', setup.sneakId, setup.attackerId);
  const card = result.state.cards[setup.sneakId];
  assert(result.valid, result.reason ?? 'expected Sneak success');
  assert(card.zone === 'battlefield', 'expected Sneak creature on battlefield');
  assert(card.tapped, 'expected Sneak creature tapped');
  assert(card.combatRole === 'attacker', 'expected Sneak creature attacking');
  assert(card.attackTarget === 'p2', 'expected Sneak creature attacking Player 2');
});

test('Sneak creature enters tapped and attacking same planeswalker target', () => {
  const setup = setupPlaneswalkerTargetSneak();
  const result = castWithSneak(setup.game, 'p1', setup.sneakId, setup.attackerId);
  const assignment = result.state.combat.attackAssignments.find(item => item.attackerIds.includes(setup.sneakId));
  assert(result.valid, result.reason ?? 'expected Sneak success');
  assert(assignment?.attackTarget.type === 'planeswalker', 'expected planeswalker attack target');
  assert(assignment?.attackTarget.type === 'planeswalker' && assignment.attackTarget.permanentId === setup.walkerId, 'expected same planeswalker');
});

test('Sneak creates CombatAttackAssignment', () => {
  const setup = setupPlayerTargetSneak();
  const result = castWithSneak(setup.game, 'p1', setup.sneakId, setup.attackerId);
  assert(result.state.combat.attackAssignments.some(assignment => assignment.attackerIds.includes(setup.sneakId)), 'expected Sneak attack assignment');
});

test('sneakCastsThisTurn tracks action', () => {
  const setup = setupPlayerTargetSneak();
  const result = castWithSneak(setup.game, 'p1', setup.sneakId, setup.attackerId);
  const events = result.state.turnTrackers.sneakCastsThisTurn ?? [];
  assert(events.length === 1, `expected one Sneak tracker event, got ${events.length}`);
  assert(events[0].cardId === setup.sneakId, 'expected Sneak card tracked');
});

console.log(`\nSneak automation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
