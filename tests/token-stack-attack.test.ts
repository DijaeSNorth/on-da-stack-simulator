/**
 * Token stack attack assignment checks.
 *
 * Run with: npx tsx tests/token-stack-attack.test.ts
 */

import {
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  createTokens,
  declareTokenStackAttack,
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

const goblinToken: Partial<CardDefinition> & { name: string } = {
  name: 'Goblin',
  typeLine: 'Token Creature - Goblin',
  cardTypes: ['Creature'],
  subTypes: ['Goblin'],
  colors: ['R'],
  colorIdentity: ['R'],
  keywords: [],
  oracleText: '',
  power: '1',
  toughness: '1',
};

const planeswalkerDef: CardDefinition = {
  id: 'jace-test',
  name: 'Jace Test',
  cmc: 4,
  typeLine: 'Legendary Planeswalker - Jace',
  superTypes: ['Legendary'],
  cardTypes: ['Planeswalker'],
  subTypes: ['Jace'],
  oracleText: '',
  colors: ['U'],
  colorIdentity: ['U'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  loyalty: 4,
};

function makeGame(playerCount: 2 | 3 = 2): GameState {
  const config = createDefaultGameConfig(playerCount);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Player A', 0, '#ef4444', config);
  const p2 = createPlayer('p2', 'Player B', 1, '#3b82f6', config);
  const players = playerCount === 3
    ? [...[p1, p2], createPlayer('p3', 'Player C', 2, '#22c55e', config)]
    : [p1, p2];
  players[0] = { ...players[0], isActive: true, hasPriority: true };
  return { ...base, players, activePlayerId: 'p1', priorityPlayerId: 'p1' };
}

function addGoblinStack(game: GameState, count: number): { game: GameState; ids: string[]; group: string } {
  const created = createTokens(game, 'p1', goblinToken, count);
  return {
    ids: created.tokenIds,
    group: created.visualGroup,
    game: {
      ...created.state,
      cards: Object.fromEntries(Object.entries(created.state.cards).map(([id, card]) => [
        id,
        created.tokenIds.includes(id) ? { ...card, summoningSick: false } : card,
      ])),
    },
  };
}

function addPlaneswalker(game: GameState): { game: GameState; id: string } {
  const card = { ...createCardState(planeswalkerDef, 'p2', 'library'), zone: 'battlefield' as const };
  return {
    id: card.instanceId,
    game: {
      ...game,
      cards: { ...game.cards, [card.instanceId]: card },
      players: game.players.map(player =>
        player.id === 'p2'
          ? { ...player, battlefield: [...player.battlefield, card.instanceId] }
          : player
      ),
    },
  };
}

test('token stack of 30 can attack all one player', () => {
  const stack = addGoblinStack(makeGame(), 30);
  const result = declareTokenStackAttack(stack.game, 'p1', stack.group, stack.ids, [
    { count: 30, attackTarget: { type: 'player', playerId: 'p2' } },
  ]);
  assert(result.valid, result.reason ?? 'expected valid attack');
  assert(result.state.combat.attackAssignments[0].count === 30, 'expected one 30-token assignment');
  assert(result.state.combat.attackers.length === 30, 'expected legacy attackers updated');
});

test('token stack of 30 can attack 10 at Player B and leave 20 back', () => {
  const stack = addGoblinStack(makeGame(), 30);
  const result = declareTokenStackAttack(stack.game, 'p1', stack.group, stack.ids, [
    { count: 10, attackTarget: { type: 'player', playerId: 'p2' } },
  ]);
  assert(result.valid, result.reason ?? 'expected valid attack');
  assert(result.selectedAttackerIds.length === 10, 'expected 10 selected attackers');
  assert(stack.ids.filter(id => result.state.cards[id].combatRole !== 'attacker').length === 20, 'expected 20 back');
});

test('token stack of 30 can split 10 at Player B and 5 at Player C', () => {
  const stack = addGoblinStack(makeGame(3), 30);
  const result = declareTokenStackAttack(stack.game, 'p1', stack.group, stack.ids, [
    { count: 10, attackTarget: { type: 'player', playerId: 'p2' } },
    { count: 5, attackTarget: { type: 'player', playerId: 'p3' } },
  ]);
  assert(result.valid, result.reason ?? 'expected valid split attack');
  assert(result.state.combat.attackAssignments.length === 2, 'expected two assignments');
  assert(result.state.combat.attackAssignments[1].attackTarget.type === 'player', 'expected player target');
  assert(result.state.combat.attackers.length === 15, 'expected 15 legacy attackers');
});

test('token stack can attack a planeswalker target', () => {
  let stack = addGoblinStack(makeGame(), 30);
  const walker = addPlaneswalker(stack.game);
  stack = { ...stack, game: walker.game };
  const result = declareTokenStackAttack(stack.game, 'p1', stack.group, stack.ids, [
    { count: 5, attackTarget: { type: 'planeswalker', permanentId: walker.id, controllerId: 'p2' } },
  ]);
  assert(result.valid, result.reason ?? 'expected valid planeswalker attack');
  assert(result.state.combat.attackAssignments[0].attackTarget.type === 'planeswalker', 'expected planeswalker target');
  assert(result.state.combat.attackers[0].targetPlayerId === 'p2', 'expected legacy target to controller');
});

test('cannot assign more tokens than eligible', () => {
  const stack = addGoblinStack(makeGame(), 30);
  const result = declareTokenStackAttack(stack.game, 'p1', stack.group, stack.ids, [
    { count: 31, attackTarget: { type: 'player', playerId: 'p2' } },
  ]);
  assert(!result.valid, 'expected invalid over-assignment');
});

test('tapped tokens are not selected', () => {
  const stack = addGoblinStack(makeGame(), 30);
  const tapped = new Set(stack.ids.slice(0, 5));
  const game = {
    ...stack.game,
    cards: Object.fromEntries(Object.entries(stack.game.cards).map(([id, card]) => [
      id,
      tapped.has(id) ? { ...card, tapped: true } : card,
    ])),
  };
  const result = declareTokenStackAttack(game, 'p1', stack.group, stack.ids, [
    { count: 25, attackTarget: { type: 'player', playerId: 'p2' } },
  ]);
  assert(result.valid, result.reason ?? 'expected valid attack using untapped tokens');
  assert(result.selectedAttackerIds.every(id => !tapped.has(id)), 'expected tapped tokens skipped');
});

test('summoning-sick non-haste tokens are not selected', () => {
  const created = createTokens(makeGame(), 'p1', goblinToken, 30);
  const result = declareTokenStackAttack(created.state, 'p1', created.visualGroup, created.tokenIds, [
    { count: 1, attackTarget: { type: 'player', playerId: 'p2' } },
  ]);
  assert(!result.valid, 'expected summoning-sick non-haste tokens to be ineligible');
});

test('selected token IDs become attackers and tap unless vigilance', () => {
  const stack = addGoblinStack(makeGame(), 30);
  const result = declareTokenStackAttack(stack.game, 'p1', stack.group, stack.ids, [
    { count: 3, attackTarget: { type: 'player', playerId: 'p2' } },
  ]);
  assert(result.valid, result.reason ?? 'expected valid attack');
  assert(result.selectedAttackerIds.every(id => result.state.cards[id].combatRole === 'attacker'), 'expected attacker role');
  assert(result.selectedAttackerIds.every(id => result.state.cards[id].tapped), 'expected selected tokens tapped');
});

test('legacy combat.attackers updates for compatibility', () => {
  const stack = addGoblinStack(makeGame(), 30);
  const result = declareTokenStackAttack(stack.game, 'p1', stack.group, stack.ids, [
    { count: 7, attackTarget: { type: 'player', playerId: 'p2' } },
  ]);
  assert(result.valid, result.reason ?? 'expected valid attack');
  assert(result.state.combat.attackers.length === 7, 'expected seven legacy attackers');
  assert(result.state.combat.attackers.every(attacker => attacker.attackTarget?.type === 'player'), 'expected legacy attackTarget mirror');
});

console.log(`\nToken stack attack tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
