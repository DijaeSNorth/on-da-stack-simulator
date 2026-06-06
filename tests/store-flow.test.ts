/**
 * Store flow regression checks for lobby/start/priority/phase behavior.
 *
 * Run with: npx tsx tests/store-flow.test.ts
 */

import { useGameStore } from '../client/src/store/gameStore';
import {
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
  resolveTopStack,
} from '../client/src/engine/gameEngine';
import { parseCommand } from '../client/src/engine/nlpParser';
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

function resetStore(game: GameState): void {
  useGameStore.setState(state => ({
    ...state,
    game,
    localPlayerId: game.players[0]?.id ?? '',
    ui: {
      ...state.ui,
      screen: 'game',
      lobbyOpen: false,
      assistantMessages: [],
      rightPanelOpen: false,
      rightPanelTab: 'assistant',
    },
  }));
}

function makeGame(playerCount: 2 | 3 | 4 | 5 | 6 = 2): GameState {
  const config = createDefaultGameConfig(playerCount);
  const game = createEmptyGameState(config);
  const players = Array.from({ length: playerCount }, (_, index) =>
    createPlayer(`p${index + 1}`, `Player ${index + 1}`, index, `hsl(${index * 60}, 70%, 60%)`, config)
  );
  players[0].isActive = true;
  players[0].hasPriority = true;
  return {
    ...game,
    players,
    activePlayerId: players[0].id,
    priorityPlayerId: players[0].id,
  };
}

const vanillaCreature: CardDefinition = {
  id: 'card-test',
  name: 'Test Creature',
  cmc: 1,
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
  power: '1',
  toughness: '1',
};

function resetCombatScenario(): { attackerId: string; blockerId: string } {
  const game = makeGame(2);
  const attacker = {
    ...createCardState({ ...vanillaCreature, id: 'attacker-card', name: 'Charging Test Creature', power: '3', toughness: '3' }, 'p1', 'library'),
    zone: 'battlefield' as const,
    summoningSick: false,
  };
  const blocker = {
    ...createCardState({ ...vanillaCreature, id: 'blocker-card', name: 'Blocking Test Creature', power: '2', toughness: '4' }, 'p2', 'library'),
    zone: 'battlefield' as const,
    summoningSick: false,
  };

  resetStore({
    ...game,
    cards: {
      [attacker.instanceId]: attacker,
      [blocker.instanceId]: blocker,
    },
    players: game.players.map(player => {
      if (player.id === 'p1') return { ...player, battlefield: [attacker.instanceId] };
      if (player.id === 'p2') return { ...player, battlefield: [blocker.instanceId] };
      return player;
    }),
  });

  useGameStore.getState().enterCombat();
  useGameStore.getState().declareAttack(attacker.instanceId, 'p2');
  useGameStore.getState().goToPhase('declareBlockers');
  useGameStore.getState().declareBlock(blocker.instanceId, attacker.instanceId);

  const combatState = useGameStore.getState().game;
  assert(combatState.cards[attacker.instanceId].combatRole === 'attacker', 'expected attacker role before cleanup');
  assert(combatState.cards[blocker.instanceId].combatRole === 'blocker', 'expected blocker role before cleanup');
  assert(combatState.combat.attackers.length === 1, 'expected attacker assignment before cleanup');
  assert(combatState.combat.blockers.length === 1, 'expected blocker assignment before cleanup');

  return { attackerId: attacker.instanceId, blockerId: blocker.instanceId };
}

function assertCombatAssignmentsCleared(attackerId: string, blockerId: string): void {
  const state = useGameStore.getState();
  assert(state.game.cards[attackerId].combatRole === 'none', 'expected attacker role to clear after combat');
  assert(state.game.cards[attackerId].attackTarget === undefined, 'expected attacker target to clear after combat');
  assert(state.game.cards[blockerId].combatRole === 'none', 'expected blocker role to clear after combat');
  assert((state.game.cards[blockerId].blockTarget ?? []).length === 0, 'expected blocker target to clear after combat');
  assert(state.game.combat.attackers.length === 0, 'expected combat attackers to clear');
  assert(state.game.combat.blockers.length === 0, 'expected combat blockers to clear');
  assert(!state.game.combat.active, 'expected combat to be inactive');
  assert(!state.ui.combatMode, 'expected combat UI mode to clear');
}

test('startGame draws opening hands from loaded libraries', () => {
  let game = makeGame(2);
  const cards = Array.from({ length: 10 }, (_, index) => createCardState({
    ...vanillaCreature,
    id: `card-${index}`,
    name: `Test Creature ${index}`,
  }, 'p1', 'library'));

  game = {
    ...game,
    cards: Object.fromEntries(cards.map(card => [card.instanceId, card])),
    players: game.players.map(player =>
      player.id === 'p1' ? { ...player, library: cards.map(card => card.instanceId), hand: [] } : player
    ),
  };

  resetStore(game);
  useGameStore.getState().startGame();

  const player = useGameStore.getState().game.players.find(p => p.id === 'p1')!;
  assert(player.hand.length === 7, `expected 7 cards in opening hand, got ${player.hand.length}`);
  assert(player.library.length === 3, `expected 3 cards left in library, got ${player.library.length}`);
});

test('prepareLoadedTableGame preserves loaded occupied-seat decks', () => {
  const game = makeGame(3);
  const p1Card = createCardState({ ...vanillaCreature, id: 'p1-card', name: 'P1 Card' }, 'p1', 'library');
  const p2Card = createCardState({ ...vanillaCreature, id: 'p2-card', name: 'P2 Card' }, 'p2', 'library');
  const p3Card = createCardState({ ...vanillaCreature, id: 'p3-card', name: 'P3 Card' }, 'p3', 'library');
  resetStore({
    ...game,
    cards: {
      [p1Card.instanceId]: p1Card,
      [p2Card.instanceId]: p2Card,
      [p3Card.instanceId]: p3Card,
    },
    players: game.players.map(player => {
      if (player.id === 'p1') return { ...player, deckId: 'deck-p1', library: [p1Card.instanceId] };
      if (player.id === 'p2') return { ...player, deckId: 'deck-p2', library: [p2Card.instanceId] };
      if (player.id === 'p3') return { ...player, deckId: 'deck-p3', library: [p3Card.instanceId] };
      return player;
    }),
  });

  useGameStore.getState().prepareLoadedTableGame(createDefaultGameConfig(2), [
    { id: 'p3', name: 'Seat Three', color: '#22c55e' },
    { id: 'p1', name: 'Seat One', color: '#3b82f6' },
  ]);

  const next = useGameStore.getState().game;
  assert(next.players.length === 2, `expected 2 occupied players, got ${next.players.length}`);
  assert(next.players[0].id === 'p3' && next.players[0].deckId === 'deck-p3', 'expected p3 deck to be preserved in seat 1');
  assert(next.players[1].id === 'p1' && next.players[1].deckId === 'deck-p1', 'expected p1 deck to be preserved in seat 2');
  assert(Boolean(next.cards[p3Card.instanceId]), 'expected p3 library card to remain');
  assert(Boolean(next.cards[p1Card.instanceId]), 'expected p1 library card to remain');
  assert(!next.cards[p2Card.instanceId], 'expected unoccupied p2 card to be removed');
});

test('passPriority updates lastUpdatedAt for multiplayer broadcasting', () => {
  const game = makeGame(3);
  resetStore({ ...game, lastUpdatedAt: 100 });

  useGameStore.getState().passPriority();

  const next = useGameStore.getState().game;
  assert(next.priorityPlayerId === 'p2', `expected p2 priority, got ${next.priorityPlayerId}`);
  assert(next.lastUpdatedAt > 100, 'expected lastUpdatedAt to increase after priority pass');
});

test('advancePhase allows mistakes while flagging pending stack review', () => {
  const game = {
    ...makeGame(2),
    phase: 'main1' as const,
    stack: [{
      id: 'stack-1',
      type: 'spell' as const,
      sourceName: 'Lightning Bolt',
      controllerId: 'p1',
      text: 'Lightning Bolt deals 3 damage to any target.',
      timestamp: Date.now(),
    }],
  };
  resetStore(game);

  useGameStore.getState().advancePhase();

  const state = useGameStore.getState();
  assert(state.game.phase === 'beginningOfCombat', `expected phase to advance, got ${state.game.phase}`);
  assert(state.ui.rightPanelOpen, 'expected assistant panel to open with warning');
  assert(state.ui.assistantMessages.some(message => message.text.includes('Resolve the stack')), 'expected stack warning message');
  const lastAction = state.game.actionLog[state.game.actionLog.length - 1];
  assert(Array.isArray(lastAction.data.reviewTypes), 'expected reviewTypes metadata on phase action');
  assert((lastAction.data.reviewTypes as string[]).includes('judge-review'), 'expected judge-review replay marker');
});

test('leaving combat by phase jump clears attacker and blocker assignments', () => {
  const { attackerId, blockerId } = resetCombatScenario();

  useGameStore.getState().goToPhase('main2');

  assert(useGameStore.getState().game.phase === 'main2', 'expected jump to main2');
  assertCombatAssignmentsCleared(attackerId, blockerId);
});

test('advancing past end of combat clears attacker and blocker assignments', () => {
  const { attackerId, blockerId } = resetCombatScenario();

  useGameStore.getState().goToPhase('endOfCombat');
  useGameStore.getState().advancePhase();

  assert(useGameStore.getState().game.phase === 'main2', 'expected end of combat to advance to main2');
  assertCombatAssignmentsCleared(attackerId, blockerId);
});

test('advancing turn clears attacker and blocker assignments', () => {
  const { attackerId, blockerId } = resetCombatScenario();

  useGameStore.getState().advanceTurn();

  assert(useGameStore.getState().game.phase === 'untap', 'expected next turn to start at untap');
  assertCombatAssignmentsCleared(attackerId, blockerId);
});

test('screen and lobbyOpen stay synchronized', () => {
  const game = makeGame(2);
  resetStore(game);

  useGameStore.getState().setLobbyOpen(true);
  assert(useGameStore.getState().ui.screen === 'lobby', 'expected screen lobby after opening lobby');

  useGameStore.getState().setLobbyOpen(false);
  assert(useGameStore.getState().ui.screen === 'game', 'expected screen game after closing lobby');
});

test('panel sizes clamp and reset for resizable touch layout', () => {
  useGameStore.getState().setPanelSize('left', 999);
  useGameStore.getState().setPanelSize('right', 10);
  useGameStore.getState().setPanelSize('deckBuilder', 520);

  let sizes = useGameStore.getState().ui.panelSizes;
  assert(sizes.left === 360, `expected left panel max clamp 360, got ${sizes.left}`);
  assert(sizes.right === 220, `expected right panel min clamp 220, got ${sizes.right}`);
  assert(sizes.deckBuilder === 520, `expected deck builder size 520, got ${sizes.deckBuilder}`);

  useGameStore.getState().resetPanelSizes();
  sizes = useGameStore.getState().ui.panelSizes;
  assert(sizes.left === 220, `expected left panel reset 220, got ${sizes.left}`);
  assert(sizes.right === 280, `expected right panel reset 280, got ${sizes.right}`);
  assert(sizes.deckBuilder === 430, `expected deck builder reset 430, got ${sizes.deckBuilder}`);
});

test('card preview anchor follows hovered card location', () => {
  resetStore(makeGame(2));

  useGameStore.getState().setCardPreview('preview-card', { x: 320, y: 240 });
  let ui = useGameStore.getState().ui;
  assert(ui.cardPreview === 'preview-card', 'expected card preview id to be set');
  assert(ui.cardPreviewAnchor?.x === 320 && ui.cardPreviewAnchor.y === 240, 'expected card preview anchor to be set');

  useGameStore.getState().setCardPreviewAnchor({ x: 360, y: 260 });
  ui = useGameStore.getState().ui;
  assert(ui.cardPreviewAnchor?.x === 360 && ui.cardPreviewAnchor.y === 260, 'expected card preview anchor to update');

  useGameStore.getState().setCardPreview(null);
  ui = useGameStore.getState().ui;
  assert(ui.cardPreview === null && ui.cardPreviewAnchor === null, 'expected clearing preview to clear anchor');
});

test('solo practice dummies can be created and removed without leaving solo deck lab mode', () => {
  const config = createDefaultGameConfig(1);
  const soloPlayer = createPlayer('p1', 'Solo Player', 0, '#3b82f6', config);
  resetStore({
    ...createEmptyGameState(config),
    players: [soloPlayer],
    activePlayerId: soloPlayer.id,
    priorityPlayerId: soloPlayer.id,
    status: 'playing',
  });

  useGameStore.getState().addPracticeDummy();
  useGameStore.getState().addPracticeDummy();
  let state = useGameStore.getState();
  let dummies = state.game.players.filter(player => player.id.startsWith('practice-dummy-'));
  assert(state.game.config.playerCount === 1, 'expected solo config to remain solo after adding dummies');
  assert(dummies.length === 2, `expected 2 practice dummies, got ${dummies.length}`);
  assert(dummies.every(dummy => dummy.life === config.startingLife), 'expected dummies to start at configured life');
  assert(dummies.every(dummy => dummy.battlefield.length === 2), 'expected each dummy to start with 2 creature cards');
  for (const dummy of dummies) {
    const dummyCards = dummy.battlefield.map(id => state.game.cards[id]);
    assert(dummyCards.every(Boolean), 'expected dummy battlefield cards to exist in game card state');
    assert(dummyCards.every(card => card.ownerId === dummy.id && card.controllerId === dummy.id), 'expected dummy creatures to be owned and controlled by the dummy');
    assert(dummyCards.every(card => card.zone === 'battlefield'), 'expected dummy creatures to start on battlefield');
    assert(dummyCards.every(card => card.definition.cardTypes.includes('Creature')), 'expected dummy permanents to be creatures');
  }

  useGameStore.getState().addPracticeDummy();
  useGameStore.getState().addPracticeDummy();
  state = useGameStore.getState();
  dummies = state.game.players.filter(player => player.id.startsWith('practice-dummy-'));
  assert(dummies.length === 3, `expected dummy cap of 3, got ${dummies.length}`);

  const removedDummyId = dummies[0].id;
  useGameStore.getState().removePracticeDummy(removedDummyId);
  state = useGameStore.getState();
  dummies = state.game.players.filter(player => player.id.startsWith('practice-dummy-'));
  assert(dummies.length === 2, `expected 2 dummies after removal, got ${dummies.length}`);
  assert(Object.values(state.game.cards).every(card => card.ownerId !== removedDummyId && card.controllerId !== removedDummyId), 'expected removed dummy cards to be cleaned from card state');
  assert(state.game.players.some(player => player.id === 'p1'), 'expected solo player to remain');
});

test('commander casts are tagged for dramatic table feedback', () => {
  const game = makeGame(2);
  const commander = createCardState({
    ...vanillaCreature,
    id: 'cmdr-card',
    name: 'Muldrotha, the Gravetide',
    cmc: 6,
    colors: ['B', 'G', 'U'],
    colorIdentity: ['B', 'G', 'U'],
  }, 'p1', 'command', true);

  resetStore({
    ...game,
    cards: { [commander.instanceId]: commander },
    players: game.players.map(player =>
      player.id === 'p1'
        ? { ...player, commanders: [commander.instanceId], commandZone: [commander.instanceId] }
        : player
    ),
  });

  useGameStore.getState().castCard('p1', commander.instanceId);

  const next = useGameStore.getState().game;
  const action = next.actionLog[next.actionLog.length - 1];
  const player = next.players.find(p => p.id === 'p1')!;
  assert(action.data.commanderCast === true, 'expected commander cast metadata');
  assert(action.data.cardName === 'Muldrotha, the Gravetide', 'expected commander card name metadata');
  assert(action.data.commanderCastNumber === 1, 'expected first commander cast number');
  assert(action.data.commanderTax === 0, 'expected zero commander tax on first cast');
  assert(player.commanderCastCount[commander.instanceId] === 1, 'expected commander tax count to increment');
});

test('resolving a commander spell puts it onto the battlefield as a permanent', () => {
  const game = makeGame(2);
  const commander = createCardState({
    ...vanillaCreature,
    id: 'cmdr-resolve-card',
    name: 'Atraxa, Praetors Voice',
    cmc: 4,
    colors: ['G', 'W', 'U', 'B'],
    colorIdentity: ['G', 'W', 'U', 'B'],
  }, 'p1', 'stack', true);

  const next = resolveTopStack({
    ...game,
    stack: [{
      id: 'stack-cmdr',
      type: 'spell',
      sourceInstanceId: commander.instanceId,
      sourceDefinitionId: commander.definitionId,
      sourceName: commander.definition.name,
      controllerId: 'p1',
      text: commander.definition.oracleText,
      timestamp: Date.now(),
    }],
    cards: { [commander.instanceId]: commander },
    players: game.players.map(player =>
      player.id === 'p1'
        ? { ...player, commanders: [commander.instanceId] }
        : player
    ),
  });

  const player = next.players.find(p => p.id === 'p1')!;
  assert(next.stack.length === 0, 'expected stack to be empty after resolution');
  assert(next.cards[commander.instanceId].zone === 'battlefield', 'expected commander zone battlefield');
  assert(player.battlefield.includes(commander.instanceId), 'expected commander in player battlefield list');
  assert(player.commanders.includes(commander.instanceId), 'expected commander identity to stay tracked');
});

test('targeted spells stay visible on stack and resolve to graveyard', () => {
  const game = makeGame(2);
  const bolt = createCardState({
    ...vanillaCreature,
    id: 'bolt-card',
    name: 'Lightning Bolt',
    typeLine: 'Instant',
    cardTypes: ['Instant'],
    subTypes: [],
    oracleText: 'Lightning Bolt deals 3 damage to any target.',
    cmc: 1,
    colors: ['R'],
    colorIdentity: ['R'],
    power: undefined,
    toughness: undefined,
  }, 'p1', 'hand');

  resetStore({
    ...game,
    cards: { [bolt.instanceId]: bolt },
    players: game.players.map(player =>
      player.id === 'p1'
        ? { ...player, hand: [bolt.instanceId] }
        : player
    ),
  });

  const parsed = parseCommand('cast lightning bolt targeting player 2');
  assert(parsed.targetPlayerIndex === 2, 'expected target player to parse');
  assert(parsed.targetText === 'Player 2', 'expected target text to be preserved');

  useGameStore.getState().castCard('p1', bolt.instanceId, {
    ids: ['p2'],
    labels: ['Player 2'],
  });

  let next = useGameStore.getState().game;
  assert(next.stack.length === 1, 'expected spell on stack before resolution');
  assert(next.cards[bolt.instanceId].zone === 'stack', 'expected spell card zone to be stack');
  assert(next.stack[0].targetLabels?.[0] === 'Player 2', 'expected stack target label');

  useGameStore.getState().resolveStack();
  next = useGameStore.getState().game;
  const player = next.players.find(p => p.id === 'p1')!;
  assert(next.stack.length === 0, 'expected stack empty after resolution');
  assert(next.cards[bolt.instanceId].zone === 'graveyard', 'expected instant to resolve to graveyard');
  assert(player.graveyard.includes(bolt.instanceId), 'expected instant in graveyard list');
});

test('scry opens a private top-N library view instead of the whole deck', () => {
  const game = makeGame(2);
  const cards = Array.from({ length: 5 }, (_, index) => createCardState({
    ...vanillaCreature,
    id: `scry-card-${index}`,
    name: `Scry Test ${index}`,
  }, 'p1', 'library'));

  resetStore({
    ...game,
    cards: Object.fromEntries(cards.map(card => [card.instanceId, card])),
    players: game.players.map(player =>
      player.id === 'p1' ? { ...player, library: cards.map(card => card.instanceId) } : player
    ),
  });

  useGameStore.getState().scryCards('p1', 2);

  const state = useGameStore.getState();
  assert(state.ui.zoneDrawer?.mode === 'scry', 'expected scry mode library drawer');
  assert(state.ui.zoneDrawer?.limit === 2, `expected scry limit 2, got ${state.ui.zoneDrawer?.limit}`);
  assert(state.ui.zoneDrawer?.viewerId === 'p1' && state.ui.zoneDrawer?.private, 'expected private scry view for the scrying player');
  const action = state.game.actionLog[state.game.actionLog.length - 1];
  assert(action.actionType === 'SCRY', 'expected SCRY action');
  assert(action.affectedObjects.length === 2, `expected exactly 2 visible scry cards, got ${action.affectedObjects.length}`);
  assert(action.affectedObjects[0] === cards[0].instanceId && action.affectedObjects[1] === cards[1].instanceId, 'expected only top two cards to be affected');
});

test('dredge mills exactly N cards and returns the dredge card to hand', () => {
  const game = makeGame(2);
  const dredgeCard = createCardState({
    ...vanillaCreature,
    id: 'stinkweed-imp',
    name: 'Stinkweed Imp',
    oracleText: 'Flying\nDredge 5',
  }, 'p1', 'library');
  const library = Array.from({ length: 5 }, (_, index) => createCardState({
    ...vanillaCreature,
    id: `dredge-mill-${index}`,
    name: `Mill Card ${index}`,
  }, 'p1', 'library'));

  resetStore({
    ...game,
    cards: Object.fromEntries([dredgeCard, ...library].map(card => [card.instanceId, {
      ...card,
      zone: card.instanceId === dredgeCard.instanceId ? 'graveyard' as const : card.zone,
    }])),
    players: game.players.map(player =>
      player.id === 'p1'
        ? { ...player, graveyard: [dredgeCard.instanceId], library: library.map(card => card.instanceId) }
        : player
    ),
  });

  const ok = useGameStore.getState().dredgeCard('p1', dredgeCard.instanceId);
  const state = useGameStore.getState();
  const player = state.game.players.find(p => p.id === 'p1')!;

  assert(ok, 'expected dredge to succeed');
  assert(player.hand.includes(dredgeCard.instanceId), 'expected dredge card returned to hand');
  assert(player.library.length === 0, `expected library empty after milling 5, got ${player.library.length}`);
  assert(library.every(card => player.graveyard.includes(card.instanceId)), 'expected exactly the top 5 cards milled to graveyard');
  assert(state.game.actionLog[state.game.actionLog.length - 1].actionType === 'DREDGE', 'expected DREDGE action log');
});

test('dredge fails when library has fewer cards than the dredge value', () => {
  const game = makeGame(2);
  const dredgeCard = createCardState({
    ...vanillaCreature,
    id: 'life-from-the-loam',
    name: 'Life from the Loam',
    oracleText: 'Return up to three target land cards from your graveyard to your hand.\nDredge 3',
  }, 'p1', 'library');
  const library = Array.from({ length: 2 }, (_, index) => createCardState({
    ...vanillaCreature,
    id: `short-library-${index}`,
    name: `Short Library ${index}`,
  }, 'p1', 'library'));

  resetStore({
    ...game,
    cards: Object.fromEntries([dredgeCard, ...library].map(card => [card.instanceId, {
      ...card,
      zone: card.instanceId === dredgeCard.instanceId ? 'graveyard' as const : card.zone,
    }])),
    players: game.players.map(player =>
      player.id === 'p1'
        ? { ...player, graveyard: [dredgeCard.instanceId], library: library.map(card => card.instanceId) }
        : player
    ),
  });

  const ok = useGameStore.getState().dredgeCard('p1', dredgeCard.instanceId);
  const state = useGameStore.getState();
  const player = state.game.players.find(p => p.id === 'p1')!;

  assert(!ok, 'expected dredge to fail with too few library cards');
  assert(player.graveyard.includes(dredgeCard.instanceId), 'expected dredge card to stay in graveyard');
  assert(player.library.length === 2, 'expected library not to be milled on failed dredge');
  assert(state.ui.assistantMessages.some(message => message.text.includes('cannot dredge')), 'expected judge warning for failed dredge');
});

test('proliferate adds one of each existing counter kind to chosen players and permanents', () => {
  const game = makeGame(2);
  const permanent = {
    ...createCardState({ ...vanillaCreature, id: 'counter-card', name: 'Counter Bear' }, 'p1', 'library'),
    zone: 'battlefield' as const,
    counters: [
      { type: '+1/+1', count: 2 },
      { type: 'shield', count: 1 },
    ],
  };
  const noCounterPermanent = {
    ...createCardState({ ...vanillaCreature, id: 'no-counter-card', name: 'No Counter Bear' }, 'p1', 'library'),
    zone: 'battlefield' as const,
  };

  resetStore({
    ...game,
    cards: {
      [permanent.instanceId]: permanent,
      [noCounterPermanent.instanceId]: noCounterPermanent,
    },
    players: game.players.map(player => {
      if (player.id === 'p1') return { ...player, poisonCounters: 1, energyCounters: 2, battlefield: [permanent.instanceId, noCounterPermanent.instanceId] };
      if (player.id === 'p2') return { ...player, experienceCounters: 1 };
      return player;
    }),
  });

  useGameStore.getState().proliferate('p1');
  const state = useGameStore.getState();
  const nextPermanent = state.game.cards[permanent.instanceId];
  const unchanged = state.game.cards[noCounterPermanent.instanceId];
  const p1 = state.game.players.find(player => player.id === 'p1')!;
  const p2 = state.game.players.find(player => player.id === 'p2')!;

  assert(nextPermanent.counters.find(counter => counter.type === '+1/+1')?.count === 3, 'expected +1/+1 counter to increment by one');
  assert(nextPermanent.counters.find(counter => counter.type === 'shield')?.count === 2, 'expected shield counter to increment by one');
  assert(unchanged.counters.length === 0, 'expected permanents without counters to remain unchanged');
  assert(p1.poisonCounters === 2 && p1.energyCounters === 3, 'expected existing player counters to increment');
  assert(p2.experienceCounters === 2, 'expected p2 existing experience counter to increment');
  assert(state.game.actionLog[state.game.actionLog.length - 1].actionType === 'PROLIFERATE', 'expected PROLIFERATE action log');
});

test('hand can be manually reordered and sorted by workflow command', () => {
  const game = makeGame(2);
  const forest = createCardState({ ...vanillaCreature, id: 'forest', name: 'Forest', typeLine: 'Basic Land - Forest', cardTypes: ['Land'], subTypes: ['Forest'], cmc: 0, colors: [], colorIdentity: ['G'] }, 'p1', 'hand');
  const creature = createCardState({ ...vanillaCreature, id: 'creature', name: 'Blue Test Mage', cmc: 2, colors: ['U'], colorIdentity: ['U'] }, 'p1', 'hand');
  const artifact = createCardState({ ...vanillaCreature, id: 'artifact', name: 'Sol Ring', typeLine: 'Artifact', cardTypes: ['Artifact'], subTypes: [], cmc: 1, colors: [], colorIdentity: ['C'] }, 'p1', 'hand');
  const instant = createCardState({ ...vanillaCreature, id: 'instant', name: 'Lightning Bolt', typeLine: 'Instant', cardTypes: ['Instant'], subTypes: [], cmc: 1, colors: ['R'], colorIdentity: ['R'] }, 'p1', 'hand');

  resetStore({
    ...game,
    cards: {
      [forest.instanceId]: forest,
      [creature.instanceId]: creature,
      [artifact.instanceId]: artifact,
      [instant.instanceId]: instant,
    },
    players: game.players.map(player =>
      player.id === 'p1'
        ? { ...player, hand: [instant.instanceId, artifact.instanceId, forest.instanceId, creature.instanceId] }
        : player
    ),
  });

  useGameStore.getState().reorderHand('p1', [artifact.instanceId, instant.instanceId, creature.instanceId, forest.instanceId]);
  let hand = useGameStore.getState().game.players.find(p => p.id === 'p1')!.hand;
  assert(hand[0] === artifact.instanceId && hand[3] === forest.instanceId, 'expected manual reorder to persist');

  useGameStore.getState().sortHand('p1');
  hand = useGameStore.getState().game.players.find(p => p.id === 'p1')!.hand;
  assert(hand.join(',') === [forest.instanceId, creature.instanceId, artifact.instanceId, instant.instanceId].join(','), 'expected hand sorted by type/color/mana/name');
});

test('sort command parses as hand organization', () => {
  assert(parseCommand('sort').intent === 'SORT_HAND', 'expected bare sort command');
  assert(parseCommand('sort hand').intent === 'SORT_HAND', 'expected sort hand command');
});

test('dredge command parses as replacement action, not graveyard casting', () => {
  const parsed = parseCommand('dredge stinkweed imp');
  assert(parsed.intent === 'DREDGE', `expected DREDGE intent, got ${parsed.intent}`);
  assert(parsed.cardName === 'Stinkweed Imp', `expected dredge card name, got ${parsed.cardName}`);
});

console.log(`\nStore flow tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
