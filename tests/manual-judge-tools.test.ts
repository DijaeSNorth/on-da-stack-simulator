import { useGameStore } from '../client/src/store/gameStore';
import {
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
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

const testDef: CardDefinition = {
  id: 'manual-test-creature',
  name: 'Manual Test Creature',
  cmc: 2,
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
  power: '2',
  toughness: '2',
};

function makeGame(): { game: GameState; ownPermanentId: string; opponentPrivateId: string } {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const players = [
    createPlayer('p1', 'Player 1', 0, '#3b82f6', config),
    createPlayer('p2', 'Player 2', 1, '#ef4444', config),
  ];
  const ownPermanent = {
    ...createCardState(testDef, 'p1', 'battlefield'),
    zone: 'battlefield' as const,
    summoningSick: false,
  };
  const opponentPrivate = createCardState({ ...testDef, id: 'opponent-hidden', name: 'Opponent Hidden Card' }, 'p2', 'library');
  return {
    ownPermanentId: ownPermanent.instanceId,
    opponentPrivateId: opponentPrivate.instanceId,
    game: {
      ...base,
      status: 'playing',
      players: players.map(player => {
        if (player.id === 'p1') return { ...player, battlefield: [ownPermanent.instanceId] };
        if (player.id === 'p2') return { ...player, library: [opponentPrivate.instanceId] };
        return player;
      }),
      cards: {
        [ownPermanent.instanceId]: ownPermanent,
        [opponentPrivate.instanceId]: opponentPrivate,
      },
      definitions: {
        [testDef.id]: testDef,
      },
      activePlayerId: 'p1',
      priorityPlayerId: 'p1',
    },
  };
}

function resetStore(localPlayerId = 'p1', judgeMode = false): { ownPermanentId: string; opponentPrivateId: string } {
  const fixture = makeGame();
  useGameStore.setState(state => ({
    ...state,
    game: fixture.game,
    localPlayerId,
    multiplayer: {
      ...state.multiplayer,
      status: localPlayerId === 'p1' ? 'host' : 'joined',
      isHost: localPlayerId === 'p1',
      isSpectator: false,
      configured: true,
    },
    ui: {
      ...state.ui,
      judgeMode,
      screen: 'game',
      lobbyOpen: false,
      cardContextMenu: null,
    },
  }));
  return fixture;
}

test('player can tap own permanent', () => {
  const { ownPermanentId } = resetStore('p1');
  useGameStore.getState().tapCard(ownPermanentId);
  assert(useGameStore.getState().game.cards[ownPermanentId].tapped, 'expected own permanent to tap');
});

test('player cannot move opponent private card', () => {
  const { opponentPrivateId } = resetStore('p1');
  useGameStore.getState().moveCardToZone(opponentPrivateId, 'battlefield', 'p1');
  const state = useGameStore.getState().game;
  assert(state.cards[opponentPrivateId].zone === 'library', 'expected opponent private card to remain in library');
  assert(!state.players[0].battlefield.includes(opponentPrivateId), 'expected opponent private card not to enter p1 battlefield');
});

test('judge mode can move private card', () => {
  const { opponentPrivateId } = resetStore('p1', true);
  useGameStore.getState().moveCardToZone(opponentPrivateId, 'battlefield', 'p1');
  const state = useGameStore.getState().game;
  assert(state.cards[opponentPrivateId].zone === 'battlefield', 'expected judge mode move to battlefield');
  assert(state.players[0].battlefield.includes(opponentPrivateId), 'expected judge mode card on selected battlefield');
});

test('manual counter changes affect effective power toughness', () => {
  const { ownPermanentId } = resetStore('p1');
  useGameStore.getState().addCounterToCard(ownPermanentId, '+1/+1', 2);
  const pt = getEffectivePowerToughness(useGameStore.getState().game.cards[ownPermanentId]);
  assert(pt?.power === 4 && pt.toughness === 4, `expected effective 4/4, got ${pt?.power}/${pt?.toughness}`);
});

test('manual note appears on card state for preview', () => {
  const { ownPermanentId } = resetStore('p1');
  assert(useGameStore.getState().setCardTemporaryNote(ownPermanentId, 'Preview-visible manual note'), 'expected manual note update to succeed');
  assert(useGameStore.getState().game.cards[ownPermanentId].notes === 'Preview-visible manual note', 'expected preview note on card state');
});

console.log(`\nManual / Judge tools tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
