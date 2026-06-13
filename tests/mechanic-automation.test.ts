/**
 * Safe mechanic automation checks.
 *
 * Run with: npx tsx tests/mechanic-automation.test.ts
 */

import { useGameStore } from '../client/src/store/gameStore';
import {
  applyCounterAnnihilation,
  applyStateBasedCounterCleanup,
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  getClassLevel,
  getPermanentColors,
  hasVividCondition,
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
  id: 'test-creature',
  name: 'Test Creature',
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

const clueDef: CardDefinition = {
  id: 'clue-token',
  name: 'Clue',
  cmc: 0,
  typeLine: 'Token Artifact - Clue',
  superTypes: [],
  cardTypes: ['Artifact'],
  subTypes: ['Clue'],
  oracleText: '{2}, Sacrifice this artifact: Draw a card.',
  colors: [],
  colorIdentity: [],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
};

const exhaustDef: CardDefinition = {
  ...creatureDef,
  id: 'exhaust-card',
  name: 'Exhaust Test Pilot',
  oracleText: 'Exhaust - Draw a card. Activate only once.',
};

const artifactDef: CardDefinition = {
  ...creatureDef,
  id: 'test-artifact',
  name: 'Test Artifact',
  typeLine: 'Artifact',
  cardTypes: ['Artifact'],
  subTypes: [],
  oracleText: '',
  colors: [],
  colorIdentity: [],
  power: undefined,
  toughness: undefined,
};

const landDef: CardDefinition = {
  ...creatureDef,
  id: 'test-land',
  name: 'Test Land',
  typeLine: 'Land',
  cardTypes: ['Land'],
  subTypes: [],
  oracleText: '',
  colors: [],
  colorIdentity: [],
  power: undefined,
  toughness: undefined,
};

const enchantmentDef: CardDefinition = {
  ...creatureDef,
  id: 'test-enchantment',
  name: 'Test Enchantment',
  typeLine: 'Enchantment',
  cardTypes: ['Enchantment'],
  subTypes: [],
  oracleText: '',
  colors: ['G'],
  colorIdentity: ['G'],
  power: undefined,
  toughness: undefined,
};

const stationCreatureDef: CardDefinition = {
  ...creatureDef,
  id: 'station-creature',
  name: 'Station Crew',
  power: '3',
  toughness: '3',
};

const spacecraftDef: CardDefinition = {
  ...artifactDef,
  id: 'test-spacecraft',
  name: 'Test Spacecraft',
  typeLine: 'Artifact - Spacecraft',
  subTypes: ['Spacecraft'],
  oracleText: 'Station 3',
  power: '5',
  toughness: '5',
};

const classDef: CardDefinition = {
  ...enchantmentDef,
  id: 'test-class',
  name: 'Test Class',
  typeLine: 'Enchantment - Class',
  cardTypes: ['Enchantment'],
  subTypes: ['Class'],
  oracleText: 'Level 2\nLevel 3',
};

const blightCreatureDef: CardDefinition = {
  ...creatureDef,
  id: 'blight-creature',
  name: 'Blight Creature',
  oracleText: 'Blight 2',
};

const redPermanentDef: CardDefinition = {
  ...creatureDef,
  id: 'vivid-red',
  name: 'Vivid Red',
  colors: ['R'],
  colorIdentity: ['R'],
};

const bluePermanentDef: CardDefinition = {
  ...creatureDef,
  id: 'vivid-blue',
  name: 'Vivid Blue',
  colors: ['U'],
  colorIdentity: ['U'],
};

const greenPermanentDef: CardDefinition = {
  ...creatureDef,
  id: 'vivid-green',
  name: 'Vivid Green',
  colors: ['G'],
  colorIdentity: ['G'],
};

const multicolorPermanentDef: CardDefinition = {
  ...creatureDef,
  id: 'vivid-multicolor',
  name: 'Vivid Multicolor',
  colors: ['R', 'U', 'G'],
  colorIdentity: ['R', 'U', 'G'],
};

const colorlessPermanentDef: CardDefinition = {
  ...artifactDef,
  id: 'vivid-colorless',
  name: 'Vivid Colorless',
  colors: [],
  colorIdentity: [],
};

function makeGame(): GameState {
  const config = createDefaultGameConfig(2);
  const game = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Player 1', 0, '#ef4444', config);
  const p2 = createPlayer('p2', 'Player 2', 1, '#3b82f6', config);
  p1.isActive = true;
  p1.hasPriority = true;
  return {
    ...game,
    players: [p1, p2],
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
  };
}

function resetStore(game: GameState, localPlayerId = 'p1', judgeMode = false): void {
  useGameStore.setState(state => ({
    ...state,
    game,
    localPlayerId,
    ui: {
      ...state.ui,
      screen: 'game',
      lobbyOpen: false,
      judgeMode,
      assistantMessages: [],
    },
  }));
}

function addBattlefieldCard(game: GameState, def: CardDefinition, ownerId: string, overrides: Partial<ReturnType<typeof createCardState>> = {}) {
  const card = {
    ...createCardState(def, ownerId, 'library', false, def.subTypes.includes('Clue')),
    zone: 'battlefield' as const,
    summoningSick: false,
    ...overrides,
  };
  return {
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
    card,
  };
}

test('Player activates own Clue and draws a card', () => {
  let game = makeGame();
  const added = addBattlefieldCard(game, clueDef, 'p1');
  game = added.game;
  const drawCard = createCardState({ ...creatureDef, id: 'draw-card', name: 'Draw Card' }, 'p1', 'library');
  game = {
    ...game,
    cards: { ...game.cards, [drawCard.instanceId]: drawCard },
    players: game.players.map(player => player.id === 'p1' ? { ...player, library: [drawCard.instanceId] } : player),
  };
  resetStore(game);

  const ok = useGameStore.getState().activateClue(added.card.instanceId);
  const state = useGameStore.getState().game;
  const p1 = state.players.find(player => player.id === 'p1')!;
  assert(ok, 'expected clue activation to succeed');
  assert(p1.hand.includes(drawCard.instanceId), 'expected player to draw one card');
});

test('Clue moves to graveyard', () => {
  let game = makeGame();
  const added = addBattlefieldCard(game, clueDef, 'p1');
  game = added.game;
  resetStore(game);

  useGameStore.getState().activateClue(added.card.instanceId);
  const state = useGameStore.getState().game;
  const p1 = state.players.find(player => player.id === 'p1')!;
  assert(state.cards[added.card.instanceId].zone === 'graveyard', 'expected clue in graveyard');
  assert(p1.graveyard.includes(added.card.instanceId), 'expected clue id in graveyard list');
});

test('Opponent cannot activate your Clue unless judgeMode', () => {
  let game = makeGame();
  const added = addBattlefieldCard(game, clueDef, 'p1');
  game = added.game;
  resetStore(game, 'p2', false);
  assert(!useGameStore.getState().activateClue(added.card.instanceId), 'expected opponent clue activation to fail');

  resetStore(game, 'p2', true);
  assert(useGameStore.getState().activateClue(added.card.instanceId), 'expected judge mode clue activation to succeed');
});

test('Exhaust ability can be marked used', () => {
  const added = addBattlefieldCard(makeGame(), exhaustDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().markExhaustUsed(added.card.instanceId), 'expected exhaust mark to succeed');
  assert(useGameStore.getState().game.cards[added.card.instanceId].exhaustUsed?.default === true, 'expected exhaust used flag');
});

test('Used exhaust cannot be marked used twice without reset', () => {
  const added = addBattlefieldCard(makeGame(), exhaustDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().markExhaustUsed(added.card.instanceId), 'expected first exhaust mark');
  assert(!useGameStore.getState().markExhaustUsed(added.card.instanceId), 'expected second exhaust mark to fail');
  assert(useGameStore.getState().resetExhaust(added.card.instanceId), 'expected reset to succeed');
  assert(useGameStore.getState().markExhaustUsed(added.card.instanceId), 'expected mark after reset');
});

test('New instance can exhaust again', () => {
  let game = makeGame();
  const first = addBattlefieldCard(game, exhaustDef, 'p1');
  game = first.game;
  const second = addBattlefieldCard(game, exhaustDef, 'p1');
  resetStore(second.game);
  assert(useGameStore.getState().markExhaustUsed(first.card.instanceId), 'expected first instance exhaust');
  assert(useGameStore.getState().markExhaustUsed(second.card.instanceId), 'expected second instance exhaust');
});

test('Opponent cannot mark your exhaust card unless judgeMode', () => {
  const added = addBattlefieldCard(makeGame(), exhaustDef, 'p1');
  resetStore(added.game, 'p2', false);
  assert(!useGameStore.getState().markExhaustUsed(added.card.instanceId), 'expected opponent exhaust mark to fail');
  resetStore(added.game, 'p2', true);
  assert(useGameStore.getState().markExhaustUsed(added.card.instanceId), 'expected judge exhaust mark to succeed');
});

test('Declaring attacker with Firebending 2 adds 2 red combat mana', () => {
  const fireDef = { ...creatureDef, id: 'firebend-2', name: 'Firebender', oracleText: 'Firebending 2' };
  const added = addBattlefieldCard(makeGame(), fireDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().enterCombat();
  useGameStore.getState().declareAttack(added.card.instanceId, 'p2');
  const p1 = useGameStore.getState().game.players.find(player => player.id === 'p1')!;
  assert(p1.combatMana?.R === 2, `expected 2R combat mana, got ${p1.combatMana?.R}`);
});

test('Multiple firebending attackers add together', () => {
  let game = makeGame();
  const first = addBattlefieldCard(game, { ...creatureDef, id: 'fire-a', name: 'Fire A', oracleText: 'Firebending 1' }, 'p1');
  game = first.game;
  const second = addBattlefieldCard(game, { ...creatureDef, id: 'fire-b', name: 'Fire B', oracleText: 'Firebending 3' }, 'p1');
  resetStore(second.game);
  useGameStore.getState().enterCombat();
  useGameStore.getState().declareAttack(first.card.instanceId, 'p2');
  useGameStore.getState().declareAttack(second.card.instanceId, 'p2');
  const p1 = useGameStore.getState().game.players.find(player => player.id === 'p1')!;
  assert(p1.combatMana?.R === 4, `expected 4R combat mana, got ${p1.combatMana?.R}`);
});

test('Combat mana clears at end of combat', () => {
  const added = addBattlefieldCard(makeGame(), { ...creatureDef, id: 'fire-clear', name: 'Fire Clear', oracleText: 'Firebending 2' }, 'p1');
  resetStore(added.game);
  useGameStore.getState().enterCombat();
  useGameStore.getState().declareAttack(added.card.instanceId, 'p2');
  useGameStore.getState().endCombat();
  const p1 = useGameStore.getState().game.players.find(player => player.id === 'p1')!;
  assert((p1.combatMana?.R ?? 0) === 0, 'expected combat mana to clear');
});

test('Non-attacking firebending creature does not add mana', () => {
  const added = addBattlefieldCard(makeGame(), { ...creatureDef, id: 'fire-idle', name: 'Fire Idle', oracleText: 'Firebending 2' }, 'p1');
  resetStore(added.game);
  useGameStore.getState().enterCombat();
  const p1 = useGameStore.getState().game.players.find(player => player.id === 'p1')!;
  assert((p1.combatMana?.R ?? 0) === 0, 'expected no combat mana before attack declaration');
});

test('Opponent firebending is credited to correct controller', () => {
  const game = { ...makeGame(), activePlayerId: 'p2', priorityPlayerId: 'p2' };
  const added = addBattlefieldCard(game, { ...creatureDef, id: 'enemy-fire', name: 'Enemy Firebender', oracleText: 'Firebending 2' }, 'p2');
  resetStore(added.game, 'p2');
  useGameStore.getState().enterCombat();
  useGameStore.getState().declareAttack(added.card.instanceId, 'p1');
  const p2 = useGameStore.getState().game.players.find(player => player.id === 'p2')!;
  assert(p2.combatMana?.R === 2, `expected p2 to receive 2R, got ${p2.combatMana?.R}`);
});

test('Airbending a non-token permanent moves it to exile', () => {
  const added = addBattlefieldCard(makeGame(), { ...creatureDef, id: 'airbend-target', name: 'Airbend Target' }, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().applyAirbend(added.card.instanceId), 'expected airbend to succeed');
  const state = useGameStore.getState().game;
  const p1 = state.players.find(player => player.id === 'p1')!;
  assert(state.cards[added.card.instanceId].zone === 'exile', 'expected target to move to exile');
  assert(p1.exile.includes(added.card.instanceId), 'expected target id in exile list');
});

test('Airbended card gains cast permission for owner with alternativeCost {2}', () => {
  const added = addBattlefieldCard(makeGame(), { ...creatureDef, id: 'airbend-permission', name: 'Airbend Permission' }, 'p1');
  resetStore(added.game);
  useGameStore.getState().applyAirbend(added.card.instanceId);
  const permission = useGameStore.getState().game.cards[added.card.instanceId].exilePermission;
  assert(permission?.ownerId === 'p1', 'expected owner cast permission');
  assert(permission?.sourceMechanic === 'airbend', 'expected airbend source mechanic');
  assert(permission?.alternativeCost === '{2}', `expected {2} alternative cost, got ${permission?.alternativeCost}`);
});

test('Airbending a token removes it and gives no cast permission', () => {
  const tokenDef = { ...creatureDef, id: 'air-token', name: 'Air Token' };
  const added = addBattlefieldCard(makeGame(), tokenDef, 'p1', { token: true });
  resetStore(added.game);
  assert(useGameStore.getState().applyAirbend(added.card.instanceId), 'expected token airbend to succeed');
  const state = useGameStore.getState().game;
  const p1 = state.players.find(player => player.id === 'p1')!;
  assert(!state.cards[added.card.instanceId], 'expected token to be removed from game');
  assert(!p1.exile.includes(added.card.instanceId), 'expected token not to remain in exile');
});

test('Opponent cannot cast your airbended card from exile unless judgeMode', () => {
  const added = addBattlefieldCard(makeGame(), { ...creatureDef, id: 'airbend-private', name: 'Airbend Private' }, 'p1');
  resetStore(added.game);
  useGameStore.getState().applyAirbend(added.card.instanceId);
  const exiledGame = useGameStore.getState().game;
  resetStore(exiledGame, 'p2', false);
  assert(!useGameStore.getState().castExiledWithPermission('p2', added.card.instanceId), 'expected opponent cast to fail');
  resetStore(exiledGame, 'p2', true);
  assert(useGameStore.getState().castExiledWithPermission('p2', added.card.instanceId), 'expected judge mode cast to succeed');
});

test('Owner can cast their airbended card from exile', () => {
  const added = addBattlefieldCard(makeGame(), { ...creatureDef, id: 'airbend-cast', name: 'Airbend Cast' }, 'p1');
  resetStore(added.game);
  useGameStore.getState().applyAirbend(added.card.instanceId);
  assert(useGameStore.getState().castExiledWithPermission('p1', added.card.instanceId), 'expected owner cast from exile');
  const state = useGameStore.getState().game;
  assert(state.cards[added.card.instanceId].zone === 'battlefield', 'expected permanent cast onto battlefield');
  assert(state.cards[added.card.instanceId].exilePermission === undefined, 'expected permission cleared after cast');
});

test('Warp-marked permanent exiles at next end step', () => {
  const added = addBattlefieldCard(makeGame(), { ...creatureDef, id: 'warp-target', name: 'Warp Target', oracleText: 'Warp {1}{R}' }, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().markCastForWarp(added.card.instanceId, '{1}{R}'), 'expected warp mark');
  useGameStore.getState().goToPhase('endStep');
  const state = useGameStore.getState().game;
  assert(state.cards[added.card.instanceId].zone === 'exile', 'expected warped permanent to exile at end step');
});

test('Warped card in exile has cast permission', () => {
  const added = addBattlefieldCard(makeGame(), { ...creatureDef, id: 'warp-permission', name: 'Warp Permission', oracleText: 'Warp {1}{R}' }, 'p1');
  resetStore(added.game);
  useGameStore.getState().markCastForWarp(added.card.instanceId, '{1}{R}');
  useGameStore.getState().goToPhase('endStep');
  const permission = useGameStore.getState().game.cards[added.card.instanceId].exilePermission;
  assert(permission?.sourceMechanic === 'warp', 'expected warp exile permission');
  assert(permission?.ownerId === 'p1', 'expected owner permission');
  assert(permission?.alternativeCost === undefined, 'expected normal-cost permission, not warp cost');
});

test('spellsWarpedThisTurn is tracked', () => {
  const added = addBattlefieldCard(makeGame(), { ...creatureDef, id: 'warp-tracker', name: 'Warp Tracker', oracleText: 'Warp {1}{R}' }, 'p1');
  resetStore(added.game);
  useGameStore.getState().markCastForWarp(added.card.instanceId, '{1}{R}');
  const trackers = useGameStore.getState().game.turnTrackers;
  assert(trackers.spellsWarpedThisTurn.includes(added.card.instanceId), 'expected warped spell tracked this turn');
});

test('Player can tap untapped creature to pay waterbend', () => {
  const added = addBattlefieldCard(makeGame(), creatureDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().payWaterbendCost('p1', 1, [added.card.instanceId]), 'expected waterbend payment');
  assert(useGameStore.getState().game.cards[added.card.instanceId].tapped, 'expected creature tapped');
});

test('Player can tap summoning-sick creature to pay waterbend', () => {
  const added = addBattlefieldCard(makeGame(), creatureDef, 'p1', { summoningSick: true });
  resetStore(added.game);
  assert(useGameStore.getState().payWaterbendCost('p1', 1, [added.card.instanceId]), 'expected summoning-sick creature to pay waterbend');
});

test('Player can tap artifact to pay waterbend', () => {
  const added = addBattlefieldCard(makeGame(), artifactDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().payWaterbendCost('p1', 1, [added.card.instanceId]), 'expected artifact to pay waterbend');
});

test('Cannot tap tapped permanent for waterbend', () => {
  const added = addBattlefieldCard(makeGame(), creatureDef, 'p1', { tapped: true });
  resetStore(added.game);
  assert(!useGameStore.getState().payWaterbendCost('p1', 1, [added.card.instanceId]), 'expected tapped permanent rejected');
});

test('Cannot tap opponent permanent for waterbend', () => {
  const added = addBattlefieldCard(makeGame(), creatureDef, 'p2');
  resetStore(added.game, 'p1');
  assert(!useGameStore.getState().payWaterbendCost('p1', 1, [added.card.instanceId]), 'expected opponent permanent rejected');
});

test('Cannot tap non-artifact non-creature permanent for waterbend', () => {
  const added = addBattlefieldCard(makeGame(), enchantmentDef, 'p1');
  resetStore(added.game);
  assert(!useGameStore.getState().payWaterbendCost('p1', 1, [added.card.instanceId]), 'expected enchantment rejected');
});

test('waterbend tracker updates', () => {
  const added = addBattlefieldCard(makeGame(), artifactDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().payWaterbendCost('p1', 1, [added.card.instanceId], 'source-waterbend');
  const events = useGameStore.getState().game.turnTrackers.waterbendEventsThisTurn;
  assert(events.length === 1, `expected one waterbend event, got ${events.length}`);
  assert(events[0].sourceId === 'source-waterbend', 'expected source id tracked');
});

test('Waterbend does not count as tapping for mana', () => {
  const added = addBattlefieldCard(makeGame(), artifactDef, 'p1');
  resetStore(added.game);
  const before = useGameStore.getState().game.players.find(player => player.id === 'p1')!.manaPool;
  useGameStore.getState().payWaterbendCost('p1', 1, [added.card.instanceId]);
  const after = useGameStore.getState().game.players.find(player => player.id === 'p1')!.manaPool;
  assert(JSON.stringify(before) === JSON.stringify(after), 'expected mana pool unchanged');
  assert(useGameStore.getState().game.actionLog.at(-1)?.data.notManaAbility === true, 'expected notManaAbility marker');
});

test('Earthbend target land you control', () => {
  const added = addBattlefieldCard(makeGame(), landDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().applyEarthbend('p1', added.card.instanceId, 2), 'expected earthbend controlled land');
});

test('Earthbent land becomes land creature', () => {
  const added = addBattlefieldCard(makeGame(), landDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().applyEarthbend('p1', added.card.instanceId, 2);
  const card = useGameStore.getState().game.cards[added.card.instanceId];
  assert(card.definition.cardTypes.includes('Land'), 'expected still land');
  assert(card.definition.cardTypes.includes('Creature'), 'expected creature type added');
});

test('Earthbent land gets haste', () => {
  const added = addBattlefieldCard(makeGame(), landDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().applyEarthbend('p1', added.card.instanceId, 2);
  assert(useGameStore.getState().game.cards[added.card.instanceId].definition.keywords.includes('Haste'), 'expected haste');
});

test('Earthbent land gets N +1/+1 counters', () => {
  const added = addBattlefieldCard(makeGame(), landDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().applyEarthbend('p1', added.card.instanceId, 3);
  const counter = useGameStore.getState().game.cards[added.card.instanceId].counters.find(c => c.type === '+1/+1');
  assert(counter?.count === 3, `expected three +1/+1 counters, got ${counter?.count}`);
});

test('Effective earthbent P/T becomes N/N from 0/0 plus counters', () => {
  const added = addBattlefieldCard(makeGame(), landDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().applyEarthbend('p1', added.card.instanceId, 4);
  const card = useGameStore.getState().game.cards[added.card.instanceId];
  const counters = card.counters.find(c => c.type === '+1/+1')?.count ?? 0;
  const effectivePower = (parseInt(card.definition.power ?? '0', 10) || 0) + counters;
  const effectiveToughness = (parseInt(card.definition.toughness ?? '0', 10) || 0) + counters;
  assert(effectivePower === 4 && effectiveToughness === 4, `expected 4/4, got ${effectivePower}/${effectiveToughness}`);
});

test('Cannot earthbend opponent land', () => {
  const added = addBattlefieldCard(makeGame(), landDef, 'p2');
  resetStore(added.game, 'p1');
  assert(!useGameStore.getState().applyEarthbend('p1', added.card.instanceId, 2), 'expected opponent land rejected');
});

test('Cannot earthbend non-land', () => {
  const added = addBattlefieldCard(makeGame(), creatureDef, 'p1');
  resetStore(added.game);
  assert(!useGameStore.getState().applyEarthbend('p1', added.card.instanceId, 2), 'expected non-land rejected');
});

test('Earthbent land dying returns tapped under earthbend controller', () => {
  const added = addBattlefieldCard(makeGame(), landDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().applyEarthbend('p1', added.card.instanceId, 2);
  useGameStore.getState().moveCardToZone(added.card.instanceId, 'graveyard', 'p1');
  const state = useGameStore.getState().game;
  const card = state.cards[added.card.instanceId];
  const p1 = state.players.find(player => player.id === 'p1')!;
  assert(card.zone === 'battlefield', `expected returned to battlefield, got ${card.zone}`);
  assert(card.tapped, 'expected returned tapped');
  assert(p1.battlefield.includes(added.card.instanceId), 'expected returned land in battlefield list');
});

test('earthbend tracker updates', () => {
  const added = addBattlefieldCard(makeGame(), landDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().applyEarthbend('p1', added.card.instanceId, 2, 'earth-source');
  const events = useGameStore.getState().game.turnTrackers.earthbentThisTurn;
  assert(events.length === 1, `expected one earthbend event, got ${events.length}`);
  assert(events[0].sourceId === 'earth-source', 'expected earthbend source tracked');
});

test('Tapping a 3/3 creature adds 3 charge counters to Spacecraft', () => {
  let game = makeGame();
  const spacecraft = addBattlefieldCard(game, spacecraftDef, 'p1');
  game = spacecraft.game;
  const crew = addBattlefieldCard(game, stationCreatureDef, 'p1');
  resetStore(crew.game);
  assert(useGameStore.getState().stationSpacecraft('p1', spacecraft.card.instanceId, crew.card.instanceId), 'expected station action');
  const state = useGameStore.getState().game;
  const counter = state.cards[spacecraft.card.instanceId].counters.find(c => c.type === 'charge');
  assert(counter?.count === 3, `expected 3 charge counters, got ${counter?.count}`);
  assert(state.cards[crew.card.instanceId].tapped, 'expected station creature tapped');
});

test('Summoning-sick creature can station', () => {
  let game = makeGame();
  const spacecraft = addBattlefieldCard(game, spacecraftDef, 'p1');
  game = spacecraft.game;
  const crew = addBattlefieldCard(game, stationCreatureDef, 'p1', { summoningSick: true });
  resetStore(crew.game);
  assert(useGameStore.getState().stationSpacecraft('p1', spacecraft.card.instanceId, crew.card.instanceId), 'expected summoning-sick crew to station');
});

test('Tapped creature cannot station', () => {
  let game = makeGame();
  const spacecraft = addBattlefieldCard(game, spacecraftDef, 'p1');
  game = spacecraft.game;
  const crew = addBattlefieldCard(game, stationCreatureDef, 'p1', { tapped: true });
  resetStore(crew.game);
  assert(!useGameStore.getState().stationSpacecraft('p1', spacecraft.card.instanceId, crew.card.instanceId), 'expected tapped crew rejected');
});

test('Opponent creature cannot station your Spacecraft', () => {
  let game = makeGame();
  const spacecraft = addBattlefieldCard(game, spacecraftDef, 'p1');
  game = spacecraft.game;
  const crew = addBattlefieldCard(game, stationCreatureDef, 'p2');
  resetStore(crew.game, 'p1');
  assert(!useGameStore.getState().stationSpacecraft('p1', spacecraft.card.instanceId, crew.card.instanceId), 'expected opponent crew rejected');
});

test('Noncreature cannot station', () => {
  let game = makeGame();
  const spacecraft = addBattlefieldCard(game, spacecraftDef, 'p1');
  game = spacecraft.game;
  const noncreature = addBattlefieldCard(game, artifactDef, 'p1');
  resetStore(noncreature.game);
  assert(!useGameStore.getState().stationSpacecraft('p1', spacecraft.card.instanceId, noncreature.card.instanceId), 'expected noncreature rejected');
});

test('Spacecraft marks stationed when threshold is met', () => {
  let game = makeGame();
  const spacecraft = addBattlefieldCard(game, spacecraftDef, 'p1');
  game = spacecraft.game;
  const crew = addBattlefieldCard(game, stationCreatureDef, 'p1');
  resetStore(crew.game);
  assert(useGameStore.getState().stationSpacecraft('p1', spacecraft.card.instanceId, crew.card.instanceId), 'expected station action');
  const card = useGameStore.getState().game.cards[spacecraft.card.instanceId];
  assert(card.spacecraft?.stationed === true, 'expected spacecraft stationed');
  assert(card.spacecraft?.stationThreshold === 3, `expected threshold 3, got ${card.spacecraft?.stationThreshold}`);
  assert(card.definition.cardTypes.includes('Creature'), 'expected printed P/T spacecraft to become artifact creature when stationed');
});

test('Manual station amount works for unknown power', () => {
  let game = makeGame();
  const spacecraft = addBattlefieldCard(game, spacecraftDef, 'p1');
  game = spacecraft.game;
  const crew = addBattlefieldCard(game, { ...stationCreatureDef, id: 'unknown-station-crew', name: 'Unknown Station Crew', power: '*', toughness: '3' }, 'p1');
  resetStore(crew.game);
  assert(!useGameStore.getState().stationSpacecraft('p1', spacecraft.card.instanceId, crew.card.instanceId), 'expected automatic station rejected for unknown power');
  assert(useGameStore.getState().stationSpacecraftManual('p1', spacecraft.card.instanceId, crew.card.instanceId, 4), 'expected manual station amount accepted');
  const state = useGameStore.getState().game;
  const counter = state.cards[spacecraft.card.instanceId].counters.find(c => c.type === 'charge');
  assert(counter?.count === 4, `expected 4 manual charge counters, got ${counter?.count}`);
  assert(state.cards[crew.card.instanceId].tapped, 'expected manual station creature tapped');
});

test('Station action logs notManaAbility and tracks source event', () => {
  let game = makeGame();
  const spacecraft = addBattlefieldCard(game, spacecraftDef, 'p1');
  game = spacecraft.game;
  const crew = addBattlefieldCard(game, stationCreatureDef, 'p1');
  resetStore(crew.game);
  assert(useGameStore.getState().stationSpacecraft('p1', spacecraft.card.instanceId, crew.card.instanceId), 'expected station action');
  const state = useGameStore.getState().game;
  const action = state.actionLog.at(-1);
  const card = state.cards[spacecraft.card.instanceId];
  assert(action?.data.notManaAbility === true, 'expected station action marked notManaAbility');
  assert(state.turnTrackers.stationEventsThisTurn?.length === 1, 'expected station event tracked this turn');
  assert(card.spacecraft?.stationSourceIds?.includes(crew.card.instanceId), 'expected station source id tracked');
});

test('Class enters and initializes at level 1', () => {
  const added = addBattlefieldCard(makeGame(), classDef, 'p1');
  assert(getClassLevel(added.game.cards[added.card.instanceId]) === 1, 'expected class level 1');
  assert(added.game.cards[added.card.instanceId].classLevel === 1, 'expected class state initialized to 1');
});

test('Level up Class increments to 2', () => {
  const added = addBattlefieldCard(makeGame(), classDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().levelUpClass('p1', added.card.instanceId), 'expected class level up');
  assert(useGameStore.getState().game.cards[added.card.instanceId].classLevel === 2, 'expected class level 2');
});

test('Cannot skip Class levels without judge override', () => {
  const added = addBattlefieldCard(makeGame(), classDef, 'p1');
  resetStore(added.game);
  assert(!useGameStore.getState().setClassLevel('p1', added.card.instanceId, 3), 'expected class skip rejected');
  assert(useGameStore.getState().game.cards[added.card.instanceId].classLevel === 1, 'expected class level unchanged');
});

test('Opponent cannot level your Class', () => {
  const added = addBattlefieldCard(makeGame(), classDef, 'p1');
  resetStore(added.game, 'p2', false);
  assert(!useGameStore.getState().levelUpClass('p2', added.card.instanceId), 'expected opponent class level rejected');
});

test('Judge mode can set Class level', () => {
  const added = addBattlefieldCard(makeGame(), classDef, 'p1');
  resetStore(added.game, 'p2', true);
  assert(useGameStore.getState().setClassLevel('p1', added.card.instanceId, 3, true), 'expected judge class set');
  assert(useGameStore.getState().game.cards[added.card.instanceId].classLevel === 3, 'expected class level 3');
});

test('Judge mode can level opponent Class', () => {
  const added = addBattlefieldCard(makeGame(), classDef, 'p1');
  resetStore(added.game, 'p2', true);
  assert(useGameStore.getState().levelUpClass('p1', added.card.instanceId), 'expected judge to level opponent class for controller');
  assert(useGameStore.getState().game.cards[added.card.instanceId].classLevel === 2, 'expected opponent class level 2 after judge action');
});

test('Class level is not stored as a counter', () => {
  const added = addBattlefieldCard(makeGame(), classDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().levelUpClass('p1', added.card.instanceId), 'expected class level up');
  const card = useGameStore.getState().game.cards[added.card.instanceId];
  assert(card.classLevel === 2, 'expected class level state 2');
  assert(!card.counters.some(counter => counter.type.toLowerCase() === 'level'), 'expected no level counter');
});

test('Non-Class card cannot be leveled', () => {
  const added = addBattlefieldCard(makeGame(), enchantmentDef, 'p1');
  resetStore(added.game);
  assert(!useGameStore.getState().levelUpClass('p1', added.card.instanceId), 'expected non-Class level up rejected');
  assert(!useGameStore.getState().setClassLevel('p1', added.card.instanceId, 2), 'expected non-Class set level rejected');
});

test('Class helper reports current level after leveling', () => {
  const added = addBattlefieldCard(makeGame(), classDef, 'p1');
  resetStore(added.game);
  useGameStore.getState().levelUpClass('p1', added.card.instanceId);
  const card = useGameStore.getState().game.cards[added.card.instanceId];
  assert(getClassLevel(card) === 2, `expected helper level 2, got ${getClassLevel(card)}`);
});

test('Counter annihilation leaves one +1/+1 from two plus and one minus', () => {
  const added = addBattlefieldCard(makeGame(), creatureDef, 'p1', {
    counters: [{ type: '+1/+1', count: 2 }, { type: '-1/-1', count: 1 }],
  });
  const cleaned = applyStateBasedCounterCleanup(added.game);
  const card = cleaned.cards[added.card.instanceId];
  assert(card.counters.find(c => c.type === '+1/+1')?.count === 1, 'expected one +1/+1 counter');
  assert(!card.counters.some(c => c.type === '-1/-1'), 'expected no -1/-1 counters');
});

test('Counter annihilation leaves two -1/-1 from one plus and three minus', () => {
  const added = addBattlefieldCard(makeGame(), creatureDef, 'p1', {
    counters: [{ type: '+1/+1', count: 1 }, { type: '-1/-1', count: 3 }],
  });
  const cleaned = applyStateBasedCounterCleanup(added.game);
  const card = cleaned.cards[added.card.instanceId];
  assert(card.counters.find(c => c.type === '-1/-1')?.count === 2, 'expected two -1/-1 counters');
  assert(!card.counters.some(c => c.type === '+1/+1'), 'expected no +1/+1 counters');
});

test('Counter annihilation removes equal +1/+1 and -1/-1 counters', () => {
  const added = addBattlefieldCard(makeGame(), creatureDef, 'p1', {
    counters: [{ type: '+1/+1', count: 2 }, { type: '-1/-1', count: 2 }],
  });
  const cleaned = applyStateBasedCounterCleanup(added.game);
  assert(cleaned.cards[added.card.instanceId].counters.length === 0, 'expected all paired counters removed');
});

test('applyCounterAnnihilation handles missing counters safely', () => {
  const card = createCardState(creatureDef, 'p1', 'battlefield') as any;
  delete card.counters;
  const cleaned = applyCounterAnnihilation(card);
  assert(!cleaned.counters, 'expected missing counters to remain safe and unchanged');
});

test('Blight 2 adds two -1/-1 counters', () => {
  const added = addBattlefieldCard(makeGame(), blightCreatureDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().applyBlight('p1', added.card.instanceId, 2), 'expected blight action');
  const counter = useGameStore.getState().game.cards[added.card.instanceId].counters.find(c => c.type === '-1/-1');
  assert(counter?.count === 2, `expected two -1/-1 counters, got ${counter?.count}`);
});

test('Blight can lethally reduce your own creature', () => {
  const added = addBattlefieldCard(makeGame(), { ...blightCreatureDef, id: 'lethal-blight', name: 'Lethal Blight', power: '1', toughness: '1' }, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().applyBlight('p1', added.card.instanceId, 2), 'expected lethal blight allowed');
  const counter = useGameStore.getState().game.cards[added.card.instanceId].counters.find(c => c.type === '-1/-1');
  assert(counter?.count === 2, `expected two -1/-1 counters, got ${counter?.count}`);
});

test('Blight interacts with +1/+1 counters through annihilation', () => {
  const added = addBattlefieldCard(makeGame(), blightCreatureDef, 'p1', {
    counters: [{ type: '+1/+1', count: 2 }],
  });
  resetStore(added.game);
  assert(useGameStore.getState().applyBlight('p1', added.card.instanceId, 1), 'expected blight action');
  const card = useGameStore.getState().game.cards[added.card.instanceId];
  assert(card.counters.find(c => c.type === '+1/+1')?.count === 1, 'expected one +1/+1 remaining');
  assert(!card.counters.some(c => c.type === '-1/-1'), 'expected no -1/-1 remaining');
});

test('Cannot blight opponent creature unless judgeMode', () => {
  const added = addBattlefieldCard(makeGame(), blightCreatureDef, 'p1');
  resetStore(added.game, 'p2', false);
  assert(!useGameStore.getState().applyBlight('p2', added.card.instanceId, 1), 'expected opponent blight rejected');
  resetStore(added.game, 'p2', true);
  assert(useGameStore.getState().applyBlight('p1', added.card.instanceId, 1), 'expected judge mode blight allowed');
});

test('Cannot blight noncreature permanent', () => {
  const added = addBattlefieldCard(makeGame(), artifactDef, 'p1');
  resetStore(added.game);
  assert(!useGameStore.getState().applyBlight('p1', added.card.instanceId, 1), 'expected noncreature blight rejected');
});

test('Vivid counts red, blue, and green permanents as three colors', () => {
  let game = makeGame();
  game = addBattlefieldCard(game, redPermanentDef, 'p1').game;
  game = addBattlefieldCard(game, bluePermanentDef, 'p1').game;
  game = addBattlefieldCard(game, greenPermanentDef, 'p1').game;
  resetStore(game);
  assert(useGameStore.getState().getVividColorCount('p1') === 3, 'expected three vivid colors');
});

test('Vivid multicolor permanent contributes multiple colors', () => {
  const added = addBattlefieldCard(makeGame(), multicolorPermanentDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().getVividColorCount('p1') === 3, 'expected multicolor permanent to count three colors');
});

test('Vivid colorless permanent contributes zero colors', () => {
  const added = addBattlefieldCard(makeGame(), colorlessPermanentDef, 'p1');
  resetStore(added.game);
  assert(useGameStore.getState().getVividColorCount('p1') === 0, 'expected colorless permanent to count zero colors');
});

test('Vivid helper handles missing color data and color identity fallback', () => {
  const missingColors = addBattlefieldCard(makeGame(), {
    ...colorlessPermanentDef,
    id: 'missing-vivid-colors',
    name: 'Missing Vivid Colors',
    colors: undefined as any,
    colorIdentity: ['W', 'U'],
  }, 'p1');
  resetStore(missingColors.game);
  const card = useGameStore.getState().game.cards[missingColors.card.instanceId];
  assert(getPermanentColors(card).length === 2, 'expected color identity fallback when colors are missing');
  assert(useGameStore.getState().getVividColorCount('p1') === 2, 'expected vivid count from fallback colors');
});

test('Vivid helper only counts permanents controlled by that player', () => {
  let game = makeGame();
  game = addBattlefieldCard(game, redPermanentDef, 'p1').game;
  game = addBattlefieldCard(game, bluePermanentDef, 'p2').game;
  resetStore(game);
  assert(useGameStore.getState().getVividColorCount('p1') === 1, 'expected only p1 permanent colors');
  assert(useGameStore.getState().getVividColorCount('p2') === 1, 'expected only p2 permanent colors');
});

test('hasVividCondition checks required vivid color count', () => {
  let game = makeGame();
  game = addBattlefieldCard(game, redPermanentDef, 'p1').game;
  game = addBattlefieldCard(game, bluePermanentDef, 'p1').game;
  resetStore(game);
  const state = useGameStore.getState().game;
  assert(hasVividCondition(state, 'p1', 2), 'expected vivid condition met for two colors');
  assert(!hasVividCondition(state, 'p1', 3), 'expected vivid condition unmet for three colors');
});

console.log(`\nMechanic automation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
