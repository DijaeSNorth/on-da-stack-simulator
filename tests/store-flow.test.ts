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

console.log(`\nStore flow tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
