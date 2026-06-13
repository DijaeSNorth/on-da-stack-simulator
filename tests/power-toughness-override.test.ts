/**
 * Power/toughness override checks.
 *
 * Run with: npx tsx tests/power-toughness-override.test.ts
 */

import { useGameStore } from '../client/src/store/gameStore';
import {
  addCounter,
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  createTokens,
  declareAttacker,
  generateCombatDamagePreview,
  getEffectivePowerToughness,
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

const bearDef: CardDefinition = {
  id: 'pt-bear',
  name: 'P/T Bear',
  cmc: 2,
  typeLine: 'Creature - Bear',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Bear'],
  oracleText: '',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '2',
  toughness: '2',
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

function addPermanent(game: GameState, def: CardDefinition, ownerId: string) {
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

function resetStore(game: GameState, localPlayerId = 'p1', judgeMode = false): void {
  useGameStore.setState(state => ({
    ...state,
    game,
    localPlayerId,
    ui: { ...state.ui, screen: 'game', lobbyOpen: false, judgeMode, assistantMessages: [] },
  }));
}

test('Override 2/2 to 5/5 updates effective P/T', () => {
  const added = addPermanent(makeGame(), bearDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().setPowerToughnessOverride([added.card.instanceId], '5', '5', 'manual', 'Giant Growth'), 'expected override set');
  const card = useGameStore.getState().game.cards[added.card.instanceId];
  const pt = getEffectivePowerToughness(card);
  assert(pt?.power === 5 && pt.toughness === 5, `expected 5/5, got ${pt?.power}/${pt?.toughness}`);
});

test('Damage preview uses overridden power', () => {
  const added = addPermanent(makeGame(), bearDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().setPowerToughnessOverride([added.card.instanceId], '5', '5', 'manual', 'Manual damage preview');
  const game = declareAttacker(useGameStore.getState().game, added.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlayers.p2 === 5, `expected 5 damage, got ${preview.damageToPlayers.p2}`);
  assert(preview.assignments[0].notes.some(note => note.includes('manual P/T override')), 'expected override note');
});

test('Clearing override restores base P/T plus counters', () => {
  const added = addPermanent(makeGame(), bearDef, 'p1');
  resetStore(addCounter(added.game, added.card.instanceId, '+1/+1', 1));
  useGameStore.getState().setPowerToughnessOverride([added.card.instanceId], '5', '5', 'manual');
  assert(useGameStore.getState().clearPowerToughnessOverride([added.card.instanceId]), 'expected override cleared');
  const pt = getEffectivePowerToughness(useGameStore.getState().game.cards[added.card.instanceId]);
  assert(pt?.power === 3 && pt.toughness === 3, `expected 3/3, got ${pt?.power}/${pt?.toughness}`);
});

test('+1/+1 counters stack with override as base effective value', () => {
  const added = addPermanent(makeGame(), bearDef, 'p1');
  resetStore(addCounter(added.game, added.card.instanceId, '+1/+1', 1));
  useGameStore.getState().setPowerToughnessOverride([added.card.instanceId], '5', '5', 'manual');
  const pt = getEffectivePowerToughness(useGameStore.getState().game.cards[added.card.instanceId]);
  assert(pt?.power === 6 && pt.toughness === 6, `expected 6/6, got ${pt?.power}/${pt?.toughness}`);
});

test('endOfCombat override clears at end of combat', () => {
  const added = addPermanent(makeGame(), bearDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().setPowerToughnessOverride([added.card.instanceId], '5', '5', 'endOfCombat');
  useGameStore.getState().endCombat();
  assert(!useGameStore.getState().game.cards[added.card.instanceId].powerToughnessOverride, 'expected end-of-combat override cleared');
});

test('endOfTurn override clears at cleanup', () => {
  const added = addPermanent(makeGame(), bearDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().setPowerToughnessOverride([added.card.instanceId], '5', '5', 'endOfTurn');
  useGameStore.getState().goToPhase('cleanup');
  assert(!useGameStore.getState().game.cards[added.card.instanceId].powerToughnessOverride, 'expected end-of-turn override cleared');
});

test('Manual override persists through combat and cleanup', () => {
  const added = addPermanent(makeGame(), bearDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().setPowerToughnessOverride([added.card.instanceId], '5', '5', 'manual');
  useGameStore.getState().endCombat();
  useGameStore.getState().goToPhase('cleanup');
  assert(useGameStore.getState().game.cards[added.card.instanceId].powerToughnessOverride?.expires === 'manual', 'expected manual override to persist');
});

test('Token stack override applies to selected tokens', () => {
  const created = createTokens(makeGame(), 'p1', {
    name: 'Goblin',
    typeLine: 'Token Creature - Goblin',
    cardTypes: ['Creature'],
    subTypes: ['Goblin'],
    power: '1',
    toughness: '1',
  }, 3);
  resetStore(created.state);
  const selected = created.tokenIds.slice(0, 2);
  assert(useGameStore.getState().setPowerToughnessOverride(selected, '3', '3', 'manual', 'Stack pump'), 'expected token stack override set');
  for (const id of selected) {
    const pt = getEffectivePowerToughness(useGameStore.getState().game.cards[id]);
    assert(pt?.power === 3 && pt.toughness === 3, 'expected selected token 3/3');
  }
  assert(!useGameStore.getState().game.cards[created.tokenIds[2]].powerToughnessOverride, 'expected unselected token unchanged');
});

test('Opponent cannot override your card unless judgeMode', () => {
  const added = addPermanent(makeGame(), bearDef, 'p1');
  resetStore(added.game, 'p2', false);
  assert(!useGameStore.getState().setPowerToughnessOverride([added.card.instanceId], '5', '5', 'manual'), 'expected opponent override blocked');
  resetStore(added.game, 'p2', true);
  assert(useGameStore.getState().setPowerToughnessOverride([added.card.instanceId], '5', '5', 'manual'), 'expected judge override allowed');
});

test('Unknown star P/T can be manually overridden and preview stops warning', () => {
  const star = addPermanent(makeGame(), { ...bearDef, id: 'pt-star', name: 'Star Creature', power: '*', toughness: '*' }, 'p1');
  resetStore(star.game);
  useGameStore.getState().setPowerToughnessOverride([star.card.instanceId], '4', '4', 'manual');
  const game = declareAttacker(useGameStore.getState().game, star.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlayers.p2 === 4, `expected 4 damage, got ${preview.damageToPlayers.p2}`);
  assert(!preview.warnings.some(warning => warning.includes('unknown or variable P/T')), 'expected no unknown P/T warning');
});

if (failed > 0) {
  console.error(`${failed} test(s) failed, ${passed} passed`);
  process.exit(1);
}

console.log(`${passed} tests passed`);
