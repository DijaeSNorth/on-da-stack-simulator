/**
 * Combat UI helper checks.
 *
 * Run with: npx tsx tests/combat-ui.test.ts
 */

import {
  buildCombatAssignmentSummaries,
  classifyCombatWarning,
  formatAttackTargetLabel,
  getAttackerBlockBadge,
  getBlockerLegalityIssue,
  groupLegalAttackTargetsByOpponent,
} from '../client/src/components/combat/combatUiModel';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer, createSingleAttackAssignment } from '../client/src/engine/gameEngine';
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
  id: 'combat-ui-creature',
  name: 'Goblin',
  cmc: 1,
  typeLine: 'Creature - Goblin',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Goblin'],
  oracleText: '',
  colors: ['R'],
  colorIdentity: ['R'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '1',
  toughness: '1',
};

const walkerDef: CardDefinition = {
  ...creatureDef,
  id: 'combat-ui-walker',
  name: 'Jace Test',
  typeLine: 'Legendary Planeswalker - Jace',
  cardTypes: ['Planeswalker'],
  subTypes: ['Jace'],
  power: undefined,
  toughness: undefined,
  loyalty: 4,
};

const battleDef: CardDefinition = {
  ...creatureDef,
  id: 'combat-ui-battle',
  name: 'Invasion Test',
  typeLine: 'Battle - Siege',
  cardTypes: ['Battle'],
  subTypes: ['Siege'],
  power: undefined,
  toughness: undefined,
};

function makeGame(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  return {
    ...base,
    players: [
      { ...createPlayer('p1', 'Player A', 0, '#ef4444', config), life: 40 },
      { ...createPlayer('p2', 'Player B', 1, '#3b82f6', config), life: 27 },
    ],
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
  };
}

function addBattlefieldCard(game: GameState, def: CardDefinition, ownerId: string) {
  const card = { ...createCardState(def, ownerId, 'library'), zone: 'battlefield' as const, summoningSick: false };
  return {
    card,
    game: {
      ...game,
      cards: { ...game.cards, [card.instanceId]: card },
      definitions: { ...game.definitions, [def.id]: def },
      players: game.players.map(player => player.id === ownerId ? { ...player, battlefield: [...player.battlefield, card.instanceId] } : player),
    },
  };
}

test('Attack targets group player, planeswalkers, and battles by opponent', () => {
  let game = makeGame();
  const walker = addBattlefieldCard(game, walkerDef, 'p2');
  game = walker.game;
  const battle = addBattlefieldCard(game, battleDef, 'p2');
  game = battle.game;
  const groups = groupLegalAttackTargetsByOpponent(game, 'p1');
  assert(groups.length === 1, 'expected one opponent group');
  assert(groups[0].player.name === 'Player B', 'expected Player B group');
  assert(groups[0].planeswalkers.length === 1, 'expected walker target');
  assert(groups[0].battles.length === 1, 'expected battle target');
});

test('CombatPanel shows token stack assignment summary text', () => {
  let game = makeGame();
  const attacker = addBattlefieldCard(game, creatureDef, 'p1');
  game = attacker.game;
  const assignment = {
    ...createSingleAttackAssignment(game, attacker.card.instanceId, { type: 'player' as const, playerId: 'p2' }),
    assignmentId: 'stack-summary',
    sourceName: 'Goblin',
    count: 20,
    isTokenStack: true,
  };
  game = { ...game, combat: { ...game.combat, attackAssignments: [assignment] } };
  const summaries = buildCombatAssignmentSummaries(game);
  assert(summaries[0].text === '20 Goblins attacking Player B (27)', `unexpected summary: ${summaries[0].text}`);
  assert(summaries[0].isTokenStack, 'expected token stack flag');
});

test('Damage preview target labels include player, planeswalker, and battle', () => {
  let game = makeGame();
  const walker = addBattlefieldCard(game, walkerDef, 'p2');
  game = walker.game;
  const battle = addBattlefieldCard(game, battleDef, 'p2');
  game = battle.game;
  assert(formatAttackTargetLabel(game, { type: 'player', playerId: 'p2' }) === 'Player B (27)', 'expected player life label');
  assert(formatAttackTargetLabel(game, { type: 'planeswalker', permanentId: walker.card.instanceId, controllerId: 'p2' }).includes('Jace Test'), 'expected walker label');
  assert(formatAttackTargetLabel(game, { type: 'battle', permanentId: battle.card.instanceId, protectorId: 'p2' }).includes('Invasion Test'), 'expected battle label');
});

test('Blocked/unblocked badges appear from pending blockers', () => {
  const blocked = new Set(['attacker-1']);
  assert(getAttackerBlockBadge('attacker-1', blocked) === 'blocked', 'expected blocked badge');
  assert(getAttackerBlockBadge('attacker-2', blocked) === 'unblocked', 'expected unblocked badge');
});

test('Unsupported keyword warning displays as classified warning', () => {
  assert(classifyCombatWarning('Prevent requires manual combat-damage review.') === 'unsupported', 'expected unsupported warning kind');
  assert(classifyCombatWarning('Unknown or variable P/T cannot be previewed exactly.') === 'unknownPT', 'expected unknown P/T warning kind');
});

test('Illegal blocker reason displays', () => {
  const attacker = createCardState({ ...creatureDef, keywords: ['Flying'], name: 'Sky Goblin' }, 'p1', 'battlefield');
  const blocker = createCardState({ ...creatureDef, keywords: [], name: 'Ground Goblin' }, 'p2', 'battlefield');
  assert(getBlockerLegalityIssue(blocker, attacker)?.includes('flying'), 'expected flying blocker issue');
});

console.log(`\nCombat UI tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
