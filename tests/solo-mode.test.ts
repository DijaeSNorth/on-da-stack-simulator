import { useGameStore } from '../client/src/store/gameStore';
import {
  createDefaultGameConfig,
  createEmptyGameState,
} from '../client/src/engine/gameEngine';
import type { Deck } from '../client/src/types/game';

let passed = 0;
let failed = 0;
const pending: Promise<void>[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      pending.push((result as Promise<void>)
        .then(() => {
          console.log(`PASS ${name}`);
          passed++;
        })
        .catch(error => {
          console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
          failed++;
        }));
      return;
    }
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

function resetStore(): void {
  const initial = useGameStore.getInitialState();
  useGameStore.setState({
    ...initial,
    game: createEmptyGameState(createDefaultGameConfig(1)),
    ui: {
      ...initial.ui,
      screen: 'lobby',
      lobbyOpen: true,
      soloModeTab: 'builder',
    },
    decks: [],
    soloDeckLab: {},
    multiplayer: {
      ...initial.multiplayer,
      status: 'disconnected',
      peerId: null,
      playerId: null,
      sessionId: null,
      peers: {},
      lobby: null,
      startHandshake: null,
    },
    localPlayerId: '',
  });
}

function makeDeck(id = 'solo-deck'): Deck {
  return {
    id,
    name: 'Solo Deck',
    format: 'commander',
    commanders: ['Atraxa, Praetors\' Voice'],
    cards: [
      { name: 'Atraxa, Praetors\' Voice', count: 1 },
      { name: 'Forest', count: 99 },
    ],
    sideboard: [],
    maybeboard: [],
    colorIdentity: ['W', 'U', 'B', 'G'],
    importedAt: Date.now(),
  };
}

test('solo mode opens Deck Lab', () => {
  resetStore();
  useGameStore.getState().openSoloDeckLab();
  const state = useGameStore.getState();
  assert(state.ui.screen === 'lobby', 'expected Solo Deck Lab to stay in lobby shell');
  assert(state.ui.lobbyOpen, 'expected lobby shell to remain open for Deck Lab');
  assert(state.ui.soloModeTab === 'builder', 'expected builder tab by default');
});

test('tab switching preserves active deck', () => {
  resetStore();
  const deck = makeDeck();
  useGameStore.getState().loadSoloDeck(deck);
  useGameStore.getState().setSoloModeTab('stats');
  useGameStore.getState().setSoloModeTab('goldfish');
  const state = useGameStore.getState();
  assert(state.soloDeckLab.activeDeckId === deck.id, 'expected active deck to survive tab switches');
  assert(state.ui.soloModeTab === 'goldfish', 'expected requested solo tab');
});

test('no deck loaded shows empty Deck Lab state', () => {
  resetStore();
  const state = useGameStore.getState();
  assert(!state.soloDeckLab.activeDeckId, 'expected no active deck');
  assert(!state.soloDeckLab.draftDeck, 'expected no draft deck');
});

test('loading deck stores active deck', () => {
  resetStore();
  const deck = makeDeck('loaded-deck');
  useGameStore.getState().loadSoloDeck(deck);
  const lab = useGameStore.getState().soloDeckLab;
  assert(lab.activeDeckId === deck.id, 'expected active deck id to be stored');
  assert(lab.draftDeck?.id === deck.id, 'expected prepared draft deck to be stored');
  assert(lab.lastValidation?.cardCount === 100, 'expected validation summary to be stored');
});

test('starting test game from SoloDeckLab creates solo game', async () => {
  resetStore();
  const deck = makeDeck('start-deck');
  useGameStore.getState().loadSoloDeck(deck);
  const started = await useGameStore.getState().startSoloDeckLabGame('goldfish', {
    player: { id: 'solo-player', name: 'Solo Player', color: '#22c55e' },
    startingLife: 30,
  });
  const state = useGameStore.getState();
  assert(started, 'expected solo deck lab game to start');
  assert(state.game.status === 'playing', 'expected game to be playing');
  assert(state.game.config.playerCount === 1, 'expected one-player solo config');
  assert(state.game.config.startingLife === 30, 'expected selected solo life total');
  assert(state.localPlayerId === 'solo-player', 'expected local player to be the solo player');
  assert(state.soloDeckLab.testSession?.mode === 'goldfish', 'expected goldfish test session');
  assert(state.ui.screen === 'game', 'expected game screen after starting test game');
});

test('multiplayer state is not modified by SoloDeckLab', () => {
  resetStore();
  const before = useGameStore.getState().multiplayer;
  useGameStore.getState().openSoloDeckLab();
  useGameStore.getState().loadSoloDeck(makeDeck('mp-safe-deck'));
  useGameStore.getState().setSoloModeTab('export');
  const after = useGameStore.getState().multiplayer;
  assert(after === before, 'expected Deck Lab UI/deck actions not to replace multiplayer state');
});

void Promise.all(pending).then(() => {
  console.log(`\nSolo mode tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
