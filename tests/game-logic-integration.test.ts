/**
 * Cross-system game logic integration checks.
 *
 * Run with: npx tsx tests/game-logic-integration.test.ts
 */

import { applyHostAuthoritativeGameActionRequest, useGameStore } from '../client/src/store/gameStore';
import {
  addCommanderDamage,
  applyEarthbend,
  checkStateBasedActions,
  clearExpiredPowerToughnessOverrides,
  createAction,
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  createTokens,
  declareAttacker,
  declareBlocker,
  generateCombatDamagePreview,
  moveCard,
  nextTurn,
  setPowerToughnessOverride,
} from '../client/src/engine/gameEngine';
import { buildFirebasePrivateStartSnapshots, buildFirebasePublicStartSnapshot, stripFirebaseUndefined } from '../client/src/engine/firebaseSync';
import { sanitizeGameStateForPlayer } from '../client/src/engine/multiplayerProtocol';
import { applyReplayToIndex, createReplayFileFromGame } from '../client/src/engine/replayEngine';
import { getBlockerLegalityIssue } from '../client/src/components/combat/combatUiModel';
import type { AttackDefenderTarget, CardDefinition, CardState, GameState, Player } from '../client/src/types/game';
import type { RoomPresence } from '../client/src/engine/multiplayerSync';

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

function makePresence(peerId: string, seatIndex: number, isSpectator = false): RoomPresence {
  return {
    peerId,
    name: peerId,
    color: '#3b82f6',
    seatIndex,
    isSpectator,
    online: true,
    lastSeen: Date.now(),
  };
}

function makeDef(overrides: Partial<CardDefinition> & { id: string; name: string }): CardDefinition {
  const cmc = overrides.cmc ?? overrides.manaCost?.cmc ?? 2;
  return {
    id: overrides.id,
    name: overrides.name,
    manaCost: { raw: `{${cmc}}`, cmc, generic: cmc },
    cmc,
    typeLine: 'Creature - Test',
    superTypes: [],
    cardTypes: ['Creature'],
    subTypes: ['Test'],
    oracleText: '',
    colors: [],
    colorIdentity: [],
    keywords: [],
    legalities: {},
    isDoubleFaced: false,
    power: '2',
    toughness: '2',
    ...overrides,
  } as CardDefinition;
}

function makeGame(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Player 1', 0, '#3b82f6', config);
  const p2 = createPlayer('p2', 'Player 2', 1, '#ef4444', config);
  return {
    ...base,
    id: 'game-logic-integration',
    status: 'playing',
    players: [
      { ...p1, isActive: true, hasPriority: true },
      { ...p2, isActive: false, hasPriority: false },
    ],
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
    phase: 'main1',
  };
}

function addZoneId(player: Player, zone: CardState['zone'], cardId: string): Player {
  const add = (ids: string[]) => ids.includes(cardId) ? ids : [...ids, cardId];
  switch (zone) {
    case 'hand': return { ...player, hand: add(player.hand) };
    case 'library': return { ...player, library: add(player.library) };
    case 'battlefield': return { ...player, battlefield: add(player.battlefield) };
    case 'graveyard': return { ...player, graveyard: add(player.graveyard) };
    case 'exile': return { ...player, exile: add(player.exile) };
    case 'command': return { ...player, commandZone: add(player.commandZone) };
    case 'sideboard': return { ...player, sideboard: add(player.sideboard) };
    case 'maybeboard': return { ...player, maybeboard: add(player.maybeboard) };
    default: return player;
  }
}

function addCard(game: GameState, card: CardState): GameState {
  return {
    ...game,
    cards: { ...game.cards, [card.instanceId]: card },
    definitions: { ...game.definitions, [card.definitionId]: card.definition },
    players: game.players.map(player =>
      player.id === card.controllerId ? addZoneId(player, card.zone, card.instanceId) : player
    ),
  };
}

function addCards(game: GameState, cards: CardState[]): GameState {
  return cards.reduce((next, card) => addCard(next, card), game);
}

function battlefieldCard(def: CardDefinition, playerId: string, patch: Partial<CardState> = {}): CardState {
  return {
    ...createCardState(def, playerId, 'battlefield'),
    summoningSick: false,
    ...patch,
  };
}

function resetStore(game: GameState, localPlayerId = 'p1', isHost = true, judgeMode = false): void {
  useGameStore.setState(state => ({
    ...state,
    game,
    localPlayerId,
    multiplayer: {
      ...state.multiplayer,
      status: isHost ? 'host' : 'joined',
      roomCode: 'GLTEST',
      peerId: isHost ? 'host' : 'peer-local',
      isHost,
      isSpectator: false,
      configured: true,
      peers: {
        host: makePresence('host', 0),
        'peer-local': makePresence('peer-local', 1),
      },
    },
    ui: {
      ...state.ui,
      screen: 'game',
      lobbyOpen: false,
      judgeMode,
      combatMode: false,
      assistantMessages: [],
    },
  }));
}

function counterCount(card: CardState | undefined, type: string): number {
  return card?.counters.find(counter => counter.type === type)?.count ?? 0;
}

function addManualAttackAssignment(game: GameState, attackerId: string, target: AttackDefenderTarget): GameState {
  const attacker = game.cards[attackerId];
  assert(Boolean(attacker), `missing attacker ${attackerId}`);
  const legacyTargetPlayerId =
    target.type === 'player' ? target.playerId :
    target.type === 'planeswalker' ? target.controllerId :
    target.protectorId;
  return {
    ...game,
    combat: {
      ...game.combat,
      active: true,
      attackingPlayerId: attacker.controllerId,
      attackers: [
        ...game.combat.attackers,
        { instanceId: attackerId, targetPlayerId: legacyTargetPlayerId, targets: [], attackTarget: target },
      ],
      attackAssignments: [
        ...(game.combat.attackAssignments ?? []),
        {
          assignmentId: `assignment-${attackerId}`,
          controllerId: attacker.controllerId,
          attackerIds: [attackerId],
          sourceName: attacker.definition.name,
          count: 1,
          isTokenStack: false,
          attackTarget: target,
          tappedOnDeclare: true,
          legal: true,
          legalityWarnings: [],
        },
      ],
    },
    cards: {
      ...game.cards,
      [attackerId]: { ...attacker, tapped: true, combatRole: 'attacker', attackTarget: legacyTargetPlayerId },
    },
  };
}

test('host-authoritative mechanic and combat actions sanitize into public patches', () => {
  const clue = battlefieldCard(makeDef({
    id: 'sync-clue',
    name: 'Joiner Clue',
    typeLine: 'Token Artifact - Clue',
    cardTypes: ['Artifact'],
    subTypes: ['Clue'],
    power: undefined,
    toughness: undefined,
  }), 'p2', { token: true });
  const drawCard = createCardState(makeDef({ id: 'sync-draw', name: 'Joiner Drawn Spell' }), 'p2', 'library');
  const hostHidden = createCardState(makeDef({ id: 'sync-host-hidden', name: 'Host Hidden Spell' }), 'p1', 'hand');
  const joinerHidden = createCardState(makeDef({ id: 'sync-joiner-hidden', name: 'Joiner Hidden Spell' }), 'p2', 'hand');
  const airTarget = battlefieldCard(makeDef({ id: 'sync-air-target', name: 'Airbend Target' }), 'p2');
  const land = battlefieldCard(makeDef({
    id: 'sync-earth-land',
    name: 'Earthbend Land',
    typeLine: 'Land - Forest',
    cardTypes: ['Land'],
    subTypes: ['Forest'],
    power: undefined,
    toughness: undefined,
  }), 'p2');

  let game = addCards(makeGame(), [clue, drawCard, hostHidden, joinerHidden, airTarget, land]);
  const tokens = createTokens(game, 'p2', {
    name: 'Goblin',
    typeLine: 'Token Creature - Goblin',
    cardTypes: ['Creature'],
    subTypes: ['Goblin'],
    power: '1',
    toughness: '1',
  }, 3);
  game = {
    ...tokens.state,
    cards: Object.fromEntries(Object.entries(tokens.state.cards).map(([id, card]) => [
      id,
      tokens.tokenIds.includes(id) ? { ...card, summoningSick: false } : card,
    ])) as GameState['cards'],
  };

  resetStore(game, 'p2', false, false);
  assert(
    !useGameStore.getState().setPowerToughnessOverride([hostHidden.instanceId], '5', '5', 'manual', 'blocked integration check'),
    'joiner must not directly mutate another player private card',
  );
  assert(!useGameStore.getState().game.cards[hostHidden.instanceId].powerToughnessOverride, 'blocked private card should remain unchanged');

  resetStore(game, 'p1', true, false);
  const joiner = makePresence('peer-local', 1);
  assert(
    applyHostAuthoritativeGameActionRequest(
      { actionSeq: 1, actionType: 'activateClue', params: { instanceId: clue.instanceId, options: { confirmPayment: true } } },
      joiner,
    ),
    'host should apply joined player Clue activation',
  );
  assert(
    applyHostAuthoritativeGameActionRequest(
      { actionSeq: 2, actionType: 'applyAirbend', params: { targetId: airTarget.instanceId } },
      joiner,
    ),
    'host should apply joined player Airbend action',
  );
  assert(
    applyHostAuthoritativeGameActionRequest(
      { actionSeq: 3, actionType: 'applyEarthbend', params: { landId: land.instanceId, amount: 3 } },
      joiner,
    ),
    'host should apply joined player Earthbend action',
  );
  assert(
    applyHostAuthoritativeGameActionRequest(
      {
        actionSeq: 4,
        actionType: 'declareTokenStackAttack',
        params: {
          playerId: 'p2',
          sourceGroupId: tokens.visualGroup,
          attackerIds: tokens.tokenIds,
          assignments: [{ count: 2, attackTarget: { type: 'player', playerId: 'p1' } }],
        },
      },
      joiner,
    ),
    'host should apply joined player token stack attack',
  );
  assert(
    applyHostAuthoritativeGameActionRequest(
      {
        actionSeq: 5,
        actionType: 'setPowerToughnessOverride',
        params: { instanceIds: [tokens.tokenIds[0]], power: '3', toughness: '3', expires: 'manual', reason: 'integration sync' },
      },
      joiner,
    ),
    'host should apply joined player P/T override',
  );
  assert(
    applyHostAuthoritativeGameActionRequest({ actionSeq: 6, actionType: 'generateCombatPreview', params: {} }, joiner),
    'host should generate combat preview from joined player request',
  );
  assert(
    applyHostAuthoritativeGameActionRequest({ actionSeq: 7, actionType: 'confirmCombatDamage', params: {} }, joiner),
    'host should confirm combat damage from joined player request',
  );

  const final = useGameStore.getState().game;
  assert(final.cards[clue.instanceId].zone === 'graveyard', 'Clue should move to graveyard after activation');
  assert(final.players.find(player => player.id === 'p2')?.hand.includes(drawCard.instanceId), 'Clue activation should draw from joined player library');
  assert(final.cards[airTarget.instanceId].zone === 'exile', 'Airbend target should be in exile');
  assert(final.cards[airTarget.instanceId].exilePermission?.alternativeCost === '{2}', 'Airbend target should have cast permission metadata');
  assert(final.cards[land.instanceId].earthbend?.amount === 3, 'Earthbend should store land animation state');
  assert(final.combat.attackAssignments.some(assignment => assignment.isTokenStack && assignment.count === 2), 'token stack attack assignment should be preserved');
  assert(final.cards[tokens.tokenIds[0]].powerToughnessOverride?.power === '3', 'P/T override should be applied to public token');
  assert((final.players.find(player => player.id === 'p1')?.life ?? 40) < 40, 'confirmed combat damage should affect defending player life');
  assert(final.combat.damagePreview === undefined, 'confirming combat damage should clear preview state');

  const publicForP1 = sanitizeGameStateForPlayer(final, 'p1');
  const publicForP2 = sanitizeGameStateForPlayer(final, 'p2');
  const publicP1Json = JSON.stringify(publicForP1);
  const publicP2Json = JSON.stringify(publicForP2);
  assert(publicForP1.cards[land.instanceId].earthbend?.amount === 3, 'sanitized public patch should carry Earthbend state');
  assert(publicForP1.cards[tokens.tokenIds[0]].powerToughnessOverride?.power === '3', 'sanitized public patch should carry P/T override');
  assert(!publicP1Json.includes('Joiner Hidden Spell'), 'public patch for host must not expose joiner private hand identity');
  assert(!publicP2Json.includes('Host Hidden Spell'), 'public patch for joiner must not expose host private hand identity');
  assert(final.actionLog.some(action => action.data?.mechanicId === 'clue'), 'Clue action should be logged with mechanic metadata');
  assert(final.actionLog.some(action => action.data?.mechanicId === 'airbend'), 'Airbend action should be logged with mechanic metadata');
  assert(final.actionLog.some(action => action.actionType === 'DECLARE_ATTACKER'), 'token stack combat action should be logged');
});

test('full turn cycle clears temporary combat and cleanup state', () => {
  const draw = createCardState(makeDef({ id: 'turn-draw', name: 'Drawn Card' }), 'p1', 'library');
  const land = createCardState(makeDef({
    id: 'turn-land',
    name: 'Test Forest',
    typeLine: 'Land - Forest',
    cardTypes: ['Land'],
    subTypes: ['Forest'],
    power: undefined,
    toughness: undefined,
  }), 'p1', 'hand');
  const spell = createCardState(makeDef({ id: 'turn-creature', name: 'Main Phase Creature' }), 'p1', 'hand');
  const attacker = battlefieldCard(makeDef({
    id: 'turn-firebender',
    name: 'Turn Firebender',
    oracleText: 'Firebending 2',
    power: '2',
    toughness: '2',
  }), 'p1');
  const game = addCards(makeGame(), [draw, land, spell, attacker]);

  resetStore(game, 'p1', true, false);
  useGameStore.getState().drawCard('p1', 1);
  useGameStore.getState().goToPhase('main1');
  useGameStore.getState().playLand('p1', land.instanceId);
  useGameStore.getState().castCard('p1', spell.instanceId);
  useGameStore.getState().resolveStack();
  useGameStore.getState().setPowerToughnessOverride([attacker.instanceId], '5', '5', 'endOfCombat', 'temporary pump');
  useGameStore.getState().goToPhase('beginningOfCombat');
  useGameStore.getState().goToPhase('declareAttackers');
  useGameStore.getState().declareAttack(attacker.instanceId, 'p2');

  let state = useGameStore.getState().game;
  assert(state.players.find(player => player.id === 'p1')?.hand.includes(draw.instanceId), 'draw step should move top library card into hand');
  assert(state.cards[land.instanceId].zone === 'battlefield', 'played land should be on battlefield');
  assert(state.cards[spell.instanceId].zone === 'battlefield', 'resolved creature should be on battlefield');
  assert(state.cards[spell.instanceId].summoningSick, 'creature cast this turn should remain summoning sick');
  assert(state.cards[attacker.instanceId].combatRole === 'attacker', 'declared attacker should be marked attacking');
  assert((state.players.find(player => player.id === 'p1')?.combatMana?.R ?? 0) === 2, 'Firebending should add temporary red combat mana');

  useGameStore.getState().generateCombatPreview();
  useGameStore.getState().confirmCombatDamage();
  state = useGameStore.getState().game;
  assert((state.players.find(player => player.id === 'p2')?.life ?? 40) === 35, 'combat damage should use temporary P/T override');
  useGameStore.getState().goToPhase('main2');
  state = useGameStore.getState().game;
  assert((state.players.find(player => player.id === 'p1')?.combatMana?.R ?? 0) === 0, 'combat mana should clear after combat damage is confirmed');
  assert(!state.cards[attacker.instanceId].powerToughnessOverride, 'end-of-combat P/T override should clear');

  useGameStore.getState().setPowerToughnessOverride([spell.instanceId], '4', '4', 'endOfTurn', 'cleanup pump');
  useGameStore.setState(current => ({
    ...current,
    game: {
      ...current.game,
      cards: {
        ...current.game.cards,
        [spell.instanceId]: { ...current.game.cards[spell.instanceId], markedForDamage: 1 },
      },
    },
  }));
  useGameStore.getState().goToPhase('cleanup');
  state = useGameStore.getState().game;
  assert(!state.cards[spell.instanceId].powerToughnessOverride, 'end-of-turn P/T override should clear at cleanup');
  assert(state.cards[spell.instanceId].markedForDamage === 0, 'marked damage should clear at cleanup');

  const actionTypes = new Set(state.actionLog.map(action => action.actionType));
  assert(actionTypes.has('DRAW_CARD'), 'turn cycle should log draw action');
  assert(actionTypes.has('CHANGE_PHASE'), 'turn cycle should log phase changes');
  assert(actionTypes.has('DECLARE_ATTACKER'), 'turn cycle should log attacker declaration');
  assert(state.actionLog.some(action => action.data?.mechanicId === 'firebending'), 'turn cycle should log Firebending mana');
});

test('state-based cleanup handles deaths, counters, temporary overrides, and earthbent lands', () => {
  const zero = battlefieldCard(makeDef({ id: 'sba-zero', name: 'Zero Toughness', power: '0', toughness: '0' }), 'p1');
  const damaged = battlefieldCard(makeDef({ id: 'sba-damaged', name: 'Damaged Creature', power: '2', toughness: '2' }), 'p1', { markedForDamage: 2 });
  const countered = battlefieldCard(makeDef({ id: 'sba-counters', name: 'Counter Creature', power: '2', toughness: '2' }), 'p1', {
    counters: [
      { type: '+1/+1', count: 2 },
      { type: '-1/-1', count: 1 },
    ],
  });
  const land = battlefieldCard(makeDef({
    id: 'sba-earth-land',
    name: 'Returning Land',
    typeLine: 'Land - Mountain',
    cardTypes: ['Land'],
    subTypes: ['Mountain'],
    power: undefined,
    toughness: undefined,
  }), 'p1');
  let game = addCards(makeGame(), [zero, damaged, countered, land]);
  const earthbend = applyEarthbend(game, 'p1', land.instanceId, 2);
  assert(earthbend.valid, 'Earthbend setup should be valid');
  game = moveCard(earthbend.state, land.instanceId, 'graveyard');
  assert(game.cards[land.instanceId].zone === 'battlefield', 'earthbent land should return to battlefield instead of graveyard');
  assert(game.cards[land.instanceId].tapped, 'earthbent land should return tapped');
  assert(!game.cards[land.instanceId].earthbend, 'earthbend return should clear earthbend state');

  const sba = checkStateBasedActions(game);
  game = sba.newState;
  assert(game.cards[zero.instanceId].zone === 'graveyard', '0 toughness creature should die to state-based actions');
  assert(game.cards[damaged.instanceId].zone === 'graveyard', 'lethally damaged creature should die to state-based actions');
  assert(counterCount(game.cards[countered.instanceId], '+1/+1') === 1, '+1/+1 and -1/-1 counters should annihilate in pairs');
  assert(counterCount(game.cards[countered.instanceId], '-1/-1') === 0, 'annihilation should remove canceled -1/-1 counters');
  assert(sba.flags.some(flag => flag.text.includes('Zero Toughness')), 'state-based death should create assistant flag');

  game = setPowerToughnessOverride(game, [countered.instanceId], '5', '5', 'endOfCombat', 'combat pump');
  game = clearExpiredPowerToughnessOverrides(game, 'endOfCombat');
  assert(!game.cards[countered.instanceId].powerToughnessOverride, 'end-of-combat override should clear through cleanup helper');
  game = setPowerToughnessOverride(game, [countered.instanceId], '6', '6', 'endOfTurn', 'turn pump');
  game = nextTurn(game);
  assert(!game.cards[countered.instanceId].powerToughnessOverride, 'end-of-turn override should clear when turn advances');
  assert(game.cards[countered.instanceId].markedForDamage === 0, 'marked damage should clear when turn advances');
});

test('commander cast, command-zone replacement, tax, and commander damage flow together', () => {
  const commander = createCardState(makeDef({
    id: 'integration-commander',
    name: 'Integration Commander',
    typeLine: 'Legendary Creature - Elder Dragon',
    superTypes: ['Legendary'],
    subTypes: ['Elder', 'Dragon'],
    power: '6',
    toughness: '6',
    cmc: 6,
  }), 'p1', 'command', true);
  const base = makeGame();
  const game = {
    ...addCard(base, commander),
    players: base.players.map(player =>
      player.id === 'p1'
        ? { ...player, commanders: [commander.instanceId], commandZone: [commander.instanceId] }
        : player
    ),
  };

  resetStore(game, 'p1', true, false);
  useGameStore.getState().castCard('p1', commander.instanceId);
  let state = useGameStore.getState().game;
  assert(state.players[0].commanderCastCount[commander.instanceId] === 1, 'first commander cast should increment cast count');
  assert(state.actionLog.at(-1)?.data.commanderTax === 0, 'first commander cast should have no tax');
  useGameStore.getState().resolveStack();
  state = useGameStore.getState().game;
  assert(state.cards[commander.instanceId].zone === 'battlefield', 'commander spell should resolve to battlefield');

  useGameStore.getState().moveCardToZone(commander.instanceId, 'graveyard', 'p1');
  useGameStore.getState().moveCardToZone(commander.instanceId, 'command', 'p1');
  state = useGameStore.getState().game;
  assert(state.players[0].commandZone.includes(commander.instanceId), 'manual command-zone replacement should put commander in command zone');
  useGameStore.getState().castCard('p1', commander.instanceId);
  state = useGameStore.getState().game;
  assert(state.players[0].commanderCastCount[commander.instanceId] === 2, 'second commander cast should increment tax count');
  assert(state.actionLog.at(-1)?.data.commanderTax === 2, 'second commander cast should apply two mana commander tax');

  const damaged = addCommanderDamage(state, 'p2', commander.instanceId, 7);
  const p2 = damaged.players.find(player => player.id === 'p2');
  assert(p2?.life === 33, 'commander damage should reduce defending player life');
  assert(p2?.commanderDamage[commander.instanceId] === 7, 'commander damage should track by commander source');
});

test('complex combat preview combines keyword math, legality hints, and non-player targets', () => {
  let game = makeGame();
  const trampler = battlefieldCard(makeDef({
    id: 'combat-trample-dt',
    name: 'Trample Deathtouch Attacker',
    keywords: ['Trample', 'Deathtouch'],
    power: '6',
    toughness: '6',
  }), 'p1');
  const blocker = battlefieldCard(makeDef({ id: 'combat-five-five', name: 'Five Five Blocker', power: '5', toughness: '5' }), 'p2');
  game = addCards(game, [trampler, blocker]);
  game = declareBlocker(declareAttacker(game, trampler.instanceId, 'p2'), blocker.instanceId, trampler.instanceId);
  let preview = generateCombatDamagePreview(game);
  assert(preview.normalDamageAssignments[0].trampleOverflow === 5, 'trample plus deathtouch should preview five overflow damage');
  assert(preview.normalDamageAssignments[0].deathtouchLethal, 'deathtouch should mark one damage as lethal');

  game = makeGame();
  const multiTrampler = battlefieldCard(makeDef({ id: 'combat-multi-trample', name: 'Multi Trampler', keywords: ['Trample'], power: '6', toughness: '6' }), 'p1');
  const blockA = battlefieldCard(makeDef({ id: 'combat-block-a', name: 'Blocker A', power: '2', toughness: '2' }), 'p2');
  const blockB = battlefieldCard(makeDef({ id: 'combat-block-b', name: 'Blocker B', power: '2', toughness: '2' }), 'p2');
  game = addCards(game, [multiTrampler, blockA, blockB]);
  game = declareBlocker(declareBlocker(declareAttacker(game, multiTrampler.instanceId, 'p2'), blockA.instanceId, multiTrampler.instanceId), blockB.instanceId, multiTrampler.instanceId);
  preview = generateCombatDamagePreview(game);
  assert(preview.normalDamageAssignments[0].manualAssignmentRequired, 'multiple blockers without order should require manual trample assignment');

  game = makeGame();
  const firstStrikeDt = battlefieldCard(makeDef({
    id: 'combat-fs-dt',
    name: 'First Strike Deathtouch',
    keywords: ['First Strike', 'Deathtouch'],
    power: '1',
    toughness: '1',
  }), 'p1');
  const largeBlocker = battlefieldCard(makeDef({ id: 'combat-large-blocker', name: 'Large Blocker', power: '10', toughness: '10' }), 'p2');
  game = addCards(game, [firstStrikeDt, largeBlocker]);
  game = declareBlocker(declareAttacker(game, firstStrikeDt.instanceId, 'p2'), largeBlocker.instanceId, firstStrikeDt.instanceId);
  preview = generateCombatDamagePreview(game);
  assert(preview.firstStrikeLikelyDestroyedCreatures.includes(largeBlocker.instanceId), 'first strike deathtouch should likely destroy blocker before normal damage');

  game = makeGame();
  const doubleStriker = battlefieldCard(makeDef({
    id: 'combat-double-strike',
    name: 'Double Striker',
    keywords: ['Double Strike'],
    power: '2',
    toughness: '2',
  }), 'p1');
  game = declareAttacker(addCard(game, doubleStriker), doubleStriker.instanceId, 'p2');
  preview = generateCombatDamagePreview(game);
  assert(preview.hasFirstStrikeDamageStep, 'double strike should create first strike damage step');
  assert(preview.damageToPlayers.p2 === 4, 'unblocked double strike 2/2 should preview four total damage');

  const flyingAttacker = battlefieldCard(makeDef({ id: 'combat-flyer', name: 'Flying Attacker', keywords: ['Flying'] }), 'p1');
  const groundBlocker = battlefieldCard(makeDef({ id: 'combat-ground', name: 'Ground Blocker' }), 'p2');
  const reachBlocker = battlefieldCard(makeDef({ id: 'combat-reach', name: 'Reach Blocker', keywords: ['Reach'] }), 'p2');
  assert(getBlockerLegalityIssue(groundBlocker, flyingAttacker)?.toLowerCase().includes('flying'), 'ground blocker should get flying legality warning');
  assert(!getBlockerLegalityIssue(reachBlocker, flyingAttacker), 'reach blocker should legally block flying attacker');

  game = makeGame();
  const walkerAttacker = battlefieldCard(makeDef({ id: 'combat-walker-attacker', name: 'Walker Attacker', power: '3', toughness: '3' }), 'p1');
  const battleAttacker = battlefieldCard(makeDef({ id: 'combat-battle-attacker', name: 'Battle Attacker', power: '3', toughness: '3' }), 'p1');
  const walker = battlefieldCard(makeDef({
    id: 'combat-walker',
    name: 'Target Walker',
    typeLine: 'Legendary Planeswalker - Test',
    cardTypes: ['Planeswalker'],
    subTypes: ['Test'],
    power: undefined,
    toughness: undefined,
    loyalty: 4,
  }), 'p2');
  const battle = battlefieldCard(makeDef({
    id: 'combat-battle',
    name: 'Target Battle',
    typeLine: 'Battle - Siege',
    cardTypes: ['Battle'],
    subTypes: ['Siege'],
    power: undefined,
    toughness: undefined,
  }), 'p2');
  game = addCards(game, [walkerAttacker, battleAttacker, walker, battle]);
  game = addManualAttackAssignment(game, walkerAttacker.instanceId, { type: 'planeswalker', permanentId: walker.instanceId, controllerId: 'p2' });
  game = addManualAttackAssignment(game, battleAttacker.instanceId, { type: 'battle', permanentId: battle.instanceId, protectorId: 'p2' });
  preview = generateCombatDamagePreview(game);
  assert(preview.damageToPlaneswalkers[walker.instanceId] === 3, 'planeswalker target should receive preview damage');
  assert(preview.damageToBattles[battle.instanceId] === 3, 'battle target should receive preview damage');
});

test('replay reconstruction and redaction preserve public game logic without private identities', () => {
  const draw = createCardState(makeDef({ id: 'replay-draw', name: 'Replay Draw' }), 'p1', 'library');
  const attacker = battlefieldCard(makeDef({ id: 'replay-attacker', name: 'Replay Attacker', power: '2', toughness: '2' }), 'p1');
  const tokenA = battlefieldCard(makeDef({ id: 'replay-token-a', name: 'Replay Goblin', typeLine: 'Token Creature - Goblin', subTypes: ['Goblin'], power: '1', toughness: '1' }), 'p1', { token: true });
  const tokenB = battlefieldCard(makeDef({ id: 'replay-token-b', name: 'Replay Goblin', typeLine: 'Token Creature - Goblin', subTypes: ['Goblin'], power: '1', toughness: '1' }), 'p1', { token: true });
  const initial = addCards(makeGame(), [draw, attacker, tokenA, tokenB]);
  const actions = [
    createAction(initial, 'p1', 'DRAW_CARD', 'Player 1 drew Replay Draw.', [draw.instanceId], { toZone: 'hand', playerId: 'p1' }),
    createAction(initial, 'p1', 'DECLARE_ATTACKER', 'Replay token stack attacked.', [attacker.instanceId, tokenA.instanceId, tokenB.instanceId], { targetPlayerId: 'p2' }),
    createAction(initial, 'p1', 'CHANGE_LIFE', 'Replay combat damage dealt.', [], { playerId: 'p2', delta: -4 }),
  ];
  const replayFile = {
    ...createReplayFileFromGame(initial, { includePrivateZones: true, includeFinalSnapshot: false, redacted: false }),
    actionLog: actions,
  };
  const reconstructed = applyReplayToIndex(replayFile, actions.length - 1).currentGameState;
  assert(reconstructed.players[0].hand.includes(draw.instanceId), 'replay should reconstruct drawn card in hand');
  assert(reconstructed.players[1].life === 36, 'replay should reconstruct combat life change');
  assert(reconstructed.cards[attacker.instanceId].combatRole === 'attacker', 'replay should reconstruct attacker role');
  assert(reconstructed.cards[tokenA.instanceId].combatRole === 'attacker', 'replay should reconstruct token stack attacker role');

  const hidden = createCardState(makeDef({ id: 'replay-hidden', name: 'Secret Combo Piece' }), 'p2', 'hand');
  const air = { ...createCardState(makeDef({ id: 'replay-air', name: 'Public Airbended Card' }), 'p1', 'exile'), exilePermission: { ownerId: 'p1', sourceMechanic: 'airbend' as const, alternativeCost: '{2}', timing: 'normal' as const, expires: 'never' as const, createdAtTurn: 3 } };
  const land = battlefieldCard(makeDef({
    id: 'replay-earth',
    name: 'Public Earthbent Land',
    typeLine: 'Land - Island',
    cardTypes: ['Land'],
    subTypes: ['Island'],
    power: undefined,
    toughness: undefined,
  }), 'p1', { earthbend: { amount: 4, controllerOfEffect: 'p1', basePower: 0, baseToughness: 0, hasHaste: true, returnTappedIfDiesOrExiled: true } });
  const sneak = battlefieldCard(makeDef({ id: 'replay-sneak', name: 'Public Sneak Creature' }), 'p1', {
    tapped: true,
    combatRole: 'attacker',
    sneak: { castWithSneak: true, returnedAttackerId: attacker.instanceId, attackTarget: { type: 'player', playerId: 'p2' } },
  });
  let final = addCards(makeGame(), [hidden, air, land, sneak]);
  final = {
    ...final,
    actionLog: [
      createAction(final, 'p1', 'MOVE_CARD', 'Public Airbended Card was airbended.', [air.instanceId], { mechanicId: 'airbend', toZone: 'exile' }),
      createAction(final, 'p1', 'ADD_COUNTER', 'Public Earthbent Land was earthbended.', [land.instanceId], { mechanicId: 'earthbend' }),
      createAction(final, 'p1', 'DECLARE_ATTACKER', 'Public Sneak Creature entered attacking via Sneak.', [sneak.instanceId], { mechanicId: 'sneak', targetPlayerId: 'p2' }),
      createAction(final, 'p2', 'SEARCH_LIBRARY', 'Secret Combo Piece tutored.', [hidden.instanceId], { private: true, privateChoice: 'Secret Combo Piece' }),
    ],
  };
  const publicReplay = createReplayFileFromGame(final, { includePrivateZones: false, includeFinalSnapshot: true, redacted: true });
  const publicJson = JSON.stringify(publicReplay);
  assert(publicReplay.initialGameState.players[1].hand.length === 1, 'public replay should preserve hidden hand count');
  assert(!publicJson.includes('Secret Combo Piece'), 'public replay should not expose private card identity');
  assert(publicReplay.finalGameState?.cards[air.instanceId]?.zone === 'exile', 'public replay final snapshot should preserve public Airbend state');
  assert(publicReplay.finalGameState?.cards[land.instanceId]?.earthbend?.amount === 4, 'public replay final snapshot should preserve public Earthbend state');
  assert(publicReplay.finalGameState?.cards[sneak.instanceId]?.combatRole === 'attacker', 'public replay final snapshot should preserve public Sneak combat role');
});

test('mid-game Firebase recovery snapshots preserve public state and owner private zones', () => {
  const hostHidden = createCardState(makeDef({ id: 'fb-host-hidden', name: 'Firebase Host Secret' }), 'p1', 'hand');
  const joinerHidden = createCardState(makeDef({ id: 'fb-joiner-hidden', name: 'Firebase Joiner Secret' }), 'p2', 'hand');
  const hostLibrary = createCardState(makeDef({ id: 'fb-host-library', name: 'Firebase Host Library Secret' }), 'p1', 'library');
  const joinerLibrary = createCardState(makeDef({ id: 'fb-joiner-library', name: 'Firebase Joiner Library Secret' }), 'p2', 'library');
  const publicPermanent = battlefieldCard(makeDef({ id: 'fb-public', name: 'Firebase Public Creature' }), 'p2');
  let game = addCards(makeGame(), [hostHidden, joinerHidden, hostLibrary, joinerLibrary, publicPermanent]);
  game = {
    ...game,
    turn: 5,
    phase: 'combatDamage',
    players: game.players.map(player => player.id === 'p2' ? { ...player, life: 34 } : player),
    actionLog: [
      createAction(game, 'p1', 'DRAW_CARD', 'Mid-game draw.', [hostHidden.instanceId], { toZone: 'hand', playerId: 'p1' }),
      createAction(game, 'p2', 'DECLARE_ATTACKER', 'Mid-game attack.', [publicPermanent.instanceId], { targetPlayerId: 'p1' }),
    ],
  };

  const publicSnapshot = buildFirebasePublicStartSnapshot(game, 'midgame-snapshot', 5000);
  const privateSnapshots = buildFirebasePrivateStartSnapshots(game, 'midgame-snapshot', 5000);
  const publicJson = JSON.stringify(publicSnapshot);
  const joinerPrivateJson = JSON.stringify(privateSnapshots.p2);
  assert(publicSnapshot.turn === 5, 'public recovery snapshot should capture mid-game turn');
  assert(publicSnapshot.phase === 'combatDamage', 'public recovery snapshot should capture mid-game phase');
  assert(publicSnapshot.actionSeq === 2, 'public recovery snapshot should capture action sequence after actions');
  assert(publicSnapshot.players[1].battlefield[0].name === 'Firebase Public Creature', 'public recovery snapshot should keep public battlefield identities');
  assert(!publicJson.includes('Firebase Host Secret'), 'public recovery snapshot must hide host hand identity');
  assert(!publicJson.includes('Firebase Joiner Secret'), 'public recovery snapshot must hide joiner hand identity');
  assert(joinerPrivateJson.includes('Firebase Joiner Secret'), 'joiner private snapshot should include own hand identity');
  assert(joinerPrivateJson.includes('Firebase Joiner Library Secret'), 'joiner private snapshot should include own library identity');
  assert(!joinerPrivateJson.includes('Firebase Host Secret'), 'joiner private snapshot must not include host hand identity');
  assert(privateSnapshots.p2.sanitizedGame?.turn === 5, 'joiner sanitized recovery game should preserve mid-game turn');
  assert(privateSnapshots.p2.sanitizedGame?.phase === 'combatDamage', 'joiner sanitized recovery game should preserve mid-game phase');
  assert(!JSON.stringify(privateSnapshots.p2.sanitizedGame).includes('Firebase Host Secret'), 'joiner sanitized recovery game must hide host private cards');
  assert(!JSON.stringify(stripFirebaseUndefined(privateSnapshots.p2)).includes('undefined'), 'Firebase private snapshot sanitizer should remove undefined values');
});

if (failed > 0) {
  console.error(`FAIL ${failed} game-logic integration check(s) failed`);
  process.exit(1);
}

console.log(`PASS ${passed} game-logic integration checks`);
