/**
 * Combat damage preview checks.
 *
 * Run with: npx tsx tests/combat-damage-preview.test.ts
 */

import { useGameStore } from '../client/src/store/gameStore';
import {
  applyEarthbend,
  applyStateBasedCounterCleanup,
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  createSingleAttackAssignment,
  createTokens,
  declareAttacker,
  declareBlocker,
  declareTokenStackAttack,
  generateCombatDamagePreview,
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
  id: 'preview-creature',
  name: 'Preview Creature',
  cmc: 3,
  typeLine: 'Creature - Test',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Test'],
  oracleText: '',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '3',
  toughness: '3',
};

const twoTwoDef: CardDefinition = {
  ...creatureDef,
  id: 'preview-two-two',
  name: 'Preview 2/2',
  power: '2',
  toughness: '2',
};

const sixSixDef: CardDefinition = {
  ...creatureDef,
  id: 'preview-six-six',
  name: 'Preview 6/6',
  power: '6',
  toughness: '6',
};

const fiveFiveDef: CardDefinition = {
  ...creatureDef,
  id: 'preview-five-five',
  name: 'Preview 5/5',
  power: '5',
  toughness: '5',
};

const tenTenDef: CardDefinition = {
  ...creatureDef,
  id: 'preview-ten-ten',
  name: 'Preview 10/10',
  power: '10',
  toughness: '10',
};

const planeswalkerDef: CardDefinition = {
  ...creatureDef,
  id: 'preview-walker',
  name: 'Preview Walker',
  typeLine: 'Legendary Planeswalker - Test',
  cardTypes: ['Planeswalker'],
  subTypes: ['Test'],
  power: undefined,
  toughness: undefined,
  loyalty: 4,
};

const landDef: CardDefinition = {
  ...creatureDef,
  id: 'preview-land',
  name: 'Preview Land',
  typeLine: 'Land',
  cardTypes: ['Land'],
  subTypes: [],
  power: undefined,
  toughness: undefined,
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

function resetStore(game: GameState): void {
  useGameStore.setState(state => ({
    ...state,
    game,
    localPlayerId: 'p1',
    ui: { ...state.ui, screen: 'game', lobbyOpen: false, judgeMode: false, assistantMessages: [] },
  }));
}

test('Unblocked 3/3 attacking player previews 3 damage', () => {
  const added = addPermanent(makeGame(), creatureDef, 'p1');
  const game = declareAttacker(added.game, added.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlayers.p2 === 3, `expected 3 damage, got ${preview.damageToPlayers.p2}`);
});

test('Token stack of 10 1/1s previews 10 damage', () => {
  const created = createTokens(makeGame(), 'p1', {
    name: 'Goblin',
    typeLine: 'Token Creature - Goblin',
    cardTypes: ['Creature'],
    subTypes: ['Goblin'],
    power: '1',
    toughness: '1',
  }, 10);
  const game = {
    ...created.state,
    cards: Object.fromEntries(Object.entries(created.state.cards).map(([id, card]) => [
      id,
      created.tokenIds.includes(id) ? { ...card, summoningSick: false } : card,
    ])),
  };
  const result = declareTokenStackAttack(game, 'p1', created.visualGroup, created.tokenIds, [
    { count: 10, attackTarget: { type: 'player', playerId: 'p2' } },
  ]);
  const preview = generateCombatDamagePreview(result.state);
  assert(preview.damageToPlayers.p2 === 10, `expected 10 damage, got ${preview.damageToPlayers.p2}`);
});

test('Creature attacking planeswalker previews damage to planeswalker', () => {
  let game = makeGame();
  const attacker = addPermanent(game, creatureDef, 'p1');
  game = attacker.game;
  const walker = addPermanent(game, planeswalkerDef, 'p2');
  game = walker.game;
  const target: AttackDefenderTarget = { type: 'planeswalker', permanentId: walker.card.instanceId, controllerId: 'p2' };
  const attackingCard = { ...game.cards[attacker.card.instanceId], tapped: true, combatRole: 'attacker' as const, attackTarget: 'p2' };
  game = {
    ...game,
    cards: { ...game.cards, [attacker.card.instanceId]: attackingCard },
    combat: {
      ...game.combat,
      active: true,
      attackingPlayerId: 'p1',
      attackers: [{ instanceId: attacker.card.instanceId, targetPlayerId: 'p2', targets: [], attackTarget: target }],
      attackAssignments: [createSingleAttackAssignment({ ...game, cards: { ...game.cards, [attacker.card.instanceId]: attackingCard } }, attacker.card.instanceId, target)],
    },
  };
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlaneswalkers[walker.card.instanceId] === 3, 'expected 3 to planeswalker');
});

test('Blocked attacker previews no damage to defending player', () => {
  let game = makeGame();
  const attacker = addPermanent(game, creatureDef, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, twoTwoDef, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert((preview.damageToPlayers.p2 ?? 0) === 0, 'expected no player damage');
  assert(preview.assignments[0].blocked, 'expected assignment marked blocked');
});

test('Blocked 3/3 vs 2/2 lists blocker as likely destroyed', () => {
  let game = makeGame();
  const attacker = addPermanent(game, creatureDef, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, twoTwoDef, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.likelyDestroyedCreatures.includes(blocker.card.instanceId), 'expected blocker likely destroyed');
});

test('Earthbent 4/4 land previews 4 damage', () => {
  const land = addPermanent(makeGame(), landDef, 'p1');
  const earthbend = applyEarthbend(land.game, 'p1', land.card.instanceId, 4);
  assert(earthbend.valid, 'expected earthbend valid');
  const game = declareAttacker(earthbend.state, land.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlayers.p2 === 4, `expected 4 damage, got ${preview.damageToPlayers.p2}`);
});

test('Counter-cleaned P/T is used by damage preview', () => {
  const added = addPermanent(makeGame(), { ...creatureDef, id: 'counter-cleaned-preview', name: 'Counter Cleaned Preview' }, 'p1');
  const withCounters = {
    ...added.game,
    cards: {
      ...added.game.cards,
      [added.card.instanceId]: {
        ...added.game.cards[added.card.instanceId],
        counters: [{ type: '+1/+1', count: 2 }, { type: '-1/-1', count: 1 }],
      },
    },
  };
  const cleaned = applyStateBasedCounterCleanup(withCounters);
  const game = declareAttacker(cleaned, added.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlayers.p2 === 4, `expected 4 damage after counter cleanup, got ${preview.damageToPlayers.p2}`);
});

test('Unknown P/T adds warning instead of crashing', () => {
  const unknown = addPermanent(makeGame(), { ...creatureDef, id: 'unknown-pt', name: 'Unknown P/T', power: '*', toughness: '*' }, 'p1');
  const game = declareAttacker(unknown.game, unknown.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(preview.warnings.some(warning => warning.includes('unknown or variable P/T')), 'expected unknown P/T warning');
});

test('Protection still adds warning/manual note for exact damage review', () => {
  const trampler = addPermanent(makeGame(), { ...creatureDef, id: 'protection-preview', name: 'Protected Preview', keywords: ['Protection'] }, 'p1');
  const game = declareAttacker(trampler.game, trampler.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(preview.warnings.some(warning => warning.toLowerCase().includes('protection')), 'expected protection warning');
});

test('Confirm damage uses existing resolution path', () => {
  const added = addPermanent(makeGame(), creatureDef, 'p1');
  const game = declareAttacker(added.game, added.card.instanceId, 'p2');
  resetStore(game);
  useGameStore.getState().generateCombatPreview();
  useGameStore.getState().confirmCombatDamage();
  const p2 = useGameStore.getState().game.players.find(player => player.id === 'p2')!;
  assert(p2.life === 37, `expected p2 life 37, got ${p2.life}`);
  assert(useGameStore.getState().game.combat.damagePreview === undefined, 'expected preview cleared after confirm');
});

test('First strike 2/2 vs normal 2/2 marks blocker likely destroyed before normal damage', () => {
  let game = makeGame();
  const attacker = addPermanent(game, { ...twoTwoDef, id: 'preview-first-strike', name: 'First Strike 2/2', keywords: ['First Strike'] }, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, twoTwoDef, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.hasFirstStrikeDamageStep, 'expected first strike damage step');
  assert(preview.firstStrikeAssignments.length === 1, 'expected first strike assignment');
  assert(preview.normalDamageAssignments.length === 0, 'expected no normal damage after first strike death');
  assert(preview.likelyDestroyedAfterFirstStrike.includes(blocker.card.instanceId), 'expected blocker destroyed after first strike');
  assert(preview.firstStrikeLikelyDestroyedCreatures.includes(blocker.card.instanceId), 'expected requested first strike destroyed alias');
  assert(preview.stepNotes.some(note => note.toLowerCase().includes('first strike')), 'expected first strike step note');
});

test('Normal 2/2 blocked by first strike 2/2 is likely destroyed before normal damage', () => {
  let game = makeGame();
  const attacker = addPermanent(game, twoTwoDef, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, { ...twoTwoDef, id: 'preview-first-strike-blocker', name: 'First Strike Blocker', keywords: ['First Strike'] }, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.hasFirstStrikeDamageStep, 'expected first strike damage step');
  assert(preview.firstStrikeAssignments.length === 1, 'expected first strike blocker assignment');
  assert(preview.firstStrikeLikelyDestroyedCreatures.includes(attacker.card.instanceId), 'expected normal attacker destroyed before normal damage');
  assert(preview.normalDamageAssignments.length === 0, 'expected destroyed normal attacker not to deal normal damage');
});

test('Double strike unblocked 2/2 previews 4 total damage', () => {
  const added = addPermanent(makeGame(), { ...twoTwoDef, id: 'preview-double-strike', name: 'Double Strike 2/2', keywords: ['Double Strike'] }, 'p1');
  const game = declareAttacker(added.game, added.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlayers.p2 === 4, `expected 4 damage, got ${preview.damageToPlayers.p2}`);
  assert(preview.firstStrikeAssignments.length === 1, 'expected first strike damage assignment');
  assert(preview.normalDamageAssignments.length === 1, 'expected normal damage assignment');
  assert(preview.assignments.some(assignment => assignment.notes.some(note => note.toLowerCase().includes('double strike'))), 'expected double strike note');
});

test('Double strike blocked by 2/2 shows first strike and normal step behavior', () => {
  let game = makeGame();
  const attacker = addPermanent(game, { ...twoTwoDef, id: 'preview-double-strike-blocked', name: 'Double Strike Blocked', keywords: ['Double Strike'] }, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, twoTwoDef, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.hasFirstStrikeDamageStep, 'expected first strike damage step');
  assert(preview.firstStrikeAssignments.length === 1, 'expected double striker in first strike step');
  assert(preview.firstStrikeLikelyDestroyedCreatures.includes(blocker.card.instanceId), 'expected blocker destroyed by first strike damage');
  assert(preview.normalDamageAssignments.length === 1, 'expected double striker still represented in normal step');
  assert(preview.normalDamageAssignments[0].notes.some(note => note.toLowerCase().includes('first-strike damage would destroy them')), 'expected normal step note about dead blocker');
});

test('Normal 3/3 unblocked still previews 3 damage in normal damage step only', () => {
  const added = addPermanent(makeGame(), creatureDef, 'p1');
  const game = declareAttacker(added.game, added.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(!preview.hasFirstStrikeDamageStep, 'expected no first strike damage step');
  assert(preview.firstStrikeAssignments.length === 0, 'expected no first strike assignments');
  assert(preview.normalDamageAssignments.length === 1, 'expected one normal assignment');
  assert(preview.damageToPlayers.p2 === 3, `expected 3 damage, got ${preview.damageToPlayers.p2}`);
});

test('Mixed first strike and normal attackers create two preview sections', () => {
  let game = makeGame();
  const firstStrike = addPermanent(game, { ...twoTwoDef, id: 'mixed-first-strike', name: 'Mixed First Strike', keywords: ['First Strike'] }, 'p1');
  game = declareAttacker(firstStrike.game, firstStrike.card.instanceId, 'p2');
  const normal = addPermanent(game, creatureDef, 'p1');
  game = declareAttacker(normal.game, normal.card.instanceId, 'p2');
  const preview = generateCombatDamagePreview(game);
  assert(preview.hasFirstStrikeDamageStep, 'expected first strike damage step');
  assert(preview.firstStrikeAssignments.length === 1, 'expected one first strike assignment');
  assert(preview.normalDamageAssignments.length === 1, 'expected one normal assignment');
  assert(preview.damageToPlayers.p2 === 5, `expected 5 total damage, got ${preview.damageToPlayers.p2}`);
});

test('Token stack with first strike previews first strike damage from token keywords', () => {
  const created = createTokens(makeGame(), 'p1', {
    name: 'First Strike Soldier',
    typeLine: 'Token Creature - Soldier',
    cardTypes: ['Creature'],
    subTypes: ['Soldier'],
    keywords: ['First Strike'],
    power: '1',
    toughness: '1',
  }, 5);
  const game = {
    ...created.state,
    cards: Object.fromEntries(Object.entries(created.state.cards).map(([id, card]) => [
      id,
      created.tokenIds.includes(id) ? { ...card, summoningSick: false } : card,
    ])),
  };
  const result = declareTokenStackAttack(game, 'p1', created.visualGroup, created.tokenIds, [
    { count: 5, attackTarget: { type: 'player', playerId: 'p2' } },
  ]);
  const preview = generateCombatDamagePreview(result.state);
  assert(preview.hasFirstStrikeDamageStep, 'expected first strike damage step for token stack');
  assert(preview.firstStrikeAssignments.length === 1, 'expected first strike token stack assignment');
  assert(preview.normalDamageAssignments.length === 0, 'expected no normal damage assignment for first strike-only tokens');
  assert(preview.damageToPlayers.p2 === 5, `expected 5 first strike damage, got ${preview.damageToPlayers.p2}`);
});

test('6/6 trample blocked by 2/2 previews 4 overflow', () => {
  let game = makeGame();
  const attacker = addPermanent(game, { ...sixSixDef, id: 'six-six-trample', name: '6/6 Trample', keywords: ['Trample'] }, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, twoTwoDef, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlayers.p2 === 4, `expected 4 overflow, got ${preview.damageToPlayers.p2}`);
  assert(preview.normalDamageAssignments[0].damageToTarget === 4, 'expected assignment overflow 4');
  assert(preview.normalDamageAssignments[0].trampleOverflow === 4, 'expected structured trample overflow 4');
  assert(preview.normalDamageAssignments[0].lethalDamageRequired?.[blocker.card.instanceId] === 2, 'expected lethal damage requirement 2');
  assert(preview.normalDamageAssignments[0].notes.some(note => note.includes('Trample overflow: 4')), 'expected trample overflow note');
});

test('6/6 trample blocked by 5/5 previews 1 overflow', () => {
  let game = makeGame();
  const attacker = addPermanent(game, { ...sixSixDef, id: 'six-six-trample-five', name: '6/6 Trample', keywords: ['Trample'] }, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, fiveFiveDef, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlayers.p2 === 1, `expected 1 overflow, got ${preview.damageToPlayers.p2}`);
  assert(preview.normalDamageAssignments[0].trampleOverflow === 1, 'expected structured trample overflow 1');
  assert(preview.normalDamageAssignments[0].lethalDamageRequired?.[blocker.card.instanceId] === 5, 'expected lethal damage requirement 5');
});

test('6/6 trample deathtouch blocked by 5/5 previews 5 overflow', () => {
  let game = makeGame();
  const attacker = addPermanent(game, { ...sixSixDef, id: 'six-six-trample-deathtouch', name: '6/6 Trample Deathtouch', keywords: ['Trample', 'Deathtouch'] }, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, fiveFiveDef, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlayers.p2 === 5, `expected 5 overflow, got ${preview.damageToPlayers.p2}`);
  assert(preview.normalDamageAssignments[0].damageToBlockers[blocker.card.instanceId] === 1, 'expected one deathtouch damage assigned to blocker');
  assert(preview.normalDamageAssignments[0].trampleOverflow === 5, 'expected structured trample overflow 5');
  assert(preview.normalDamageAssignments[0].deathtouchLethal, 'expected structured deathtouch lethal flag');
  assert(preview.normalDamageAssignments[0].lethalDamageRequired?.[blocker.card.instanceId] === 1, 'expected deathtouch lethal requirement 1');
  assert(preview.normalDamageAssignments[0].notes.some(note => note.includes('Deathtouch: 1 damage is lethal')), 'expected deathtouch note');
});

test('Deathtouch 1/1 blocked by 10/10 marks blocker likely destroyed', () => {
  let game = makeGame();
  const attacker = addPermanent(game, { ...creatureDef, id: 'one-one-deathtouch', name: '1/1 Deathtouch', keywords: ['Deathtouch'], power: '1', toughness: '1' }, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, tenTenDef, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.likelyDestroyedCreatures.includes(blocker.card.instanceId), 'expected 10/10 blocker likely destroyed by deathtouch');
  assert(preview.normalDamageAssignments[0].deathtouchLethal, 'expected deathtouch lethal flag');
});

test('0/1 deathtouch blocked by 10/10 does not mark blocker destroyed', () => {
  let game = makeGame();
  const attacker = addPermanent(game, { ...creatureDef, id: 'zero-one-deathtouch', name: '0/1 Deathtouch', keywords: ['Deathtouch'], power: '0', toughness: '1' }, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, tenTenDef, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(!preview.likelyDestroyedCreatures.includes(blocker.card.instanceId), 'expected 10/10 blocker not destroyed by zero damage deathtouch');
  assert(!preview.normalDamageAssignments[0].deathtouchLethal, 'expected deathtouch lethal flag false for zero power');
});

test('Indestructible blocker adds warning and is not confidently listed as likely destroyed', () => {
  let game = makeGame();
  const attacker = addPermanent(game, { ...sixSixDef, id: 'six-six-vs-indestructible', name: '6/6 Trample' }, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blocker = addPermanent(game, { ...twoTwoDef, id: 'indestructible-blocker', name: 'Indestructible Blocker', keywords: ['Indestructible'] }, 'p2');
  game = declareBlocker(blocker.game, blocker.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.warnings.some(warning => warning.toLowerCase().includes('indestructible')), 'expected indestructible warning');
  assert(!preview.likelyDestroyedCreatures.includes(blocker.card.instanceId), 'expected indestructible blocker not confidently listed as destroyed');
  assert(preview.normalDamageAssignments[0].combatMathNotes?.some(note => note.toLowerCase().includes('indestructible')), 'expected indestructible combat math note');
});

test('Multiple blockers with trample shows manual assignment warning', () => {
  let game = makeGame();
  const attacker = addPermanent(game, { ...sixSixDef, id: 'six-six-trample-multi', name: '6/6 Trample Multi', keywords: ['Trample'] }, 'p1');
  game = declareAttacker(attacker.game, attacker.card.instanceId, 'p2');
  const blockerA = addPermanent(game, twoTwoDef, 'p2');
  game = declareBlocker(blockerA.game, blockerA.card.instanceId, attacker.card.instanceId);
  const blockerB = addPermanent(game, { ...twoTwoDef, id: 'preview-two-two-b', name: 'Preview 2/2 B' }, 'p2');
  game = declareBlocker(blockerB.game, blockerB.card.instanceId, attacker.card.instanceId);
  const preview = generateCombatDamagePreview(game);
  assert(preview.warnings.some(warning => warning.toLowerCase().includes('multiple blockers with trample')), 'expected manual trample assignment warning');
  assert(preview.normalDamageAssignments[0].manualAssignmentRequired, 'expected structured manual assignment flag');
});

console.log(`\nCombat damage preview tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
