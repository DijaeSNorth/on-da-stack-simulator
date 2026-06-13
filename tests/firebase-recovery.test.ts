/**
 * Firebase multiplayer recovery snapshot regression checks.
 *
 * Run with: npx tsx tests/firebase-recovery.test.ts
 */

import { buildFirebasePrivateStartSnapshots, buildFirebasePublicStartSnapshot, isFirebaseRecoveryConfigured } from '../client/src/engine/firebaseSync';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import type { CardDefinition, GameState } from '../client/src/types/game';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function makeDef(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    manaCost: { raw: '{1}', cmc: 1, generic: 1 },
    cmc: 1,
    typeLine: 'Artifact',
    superTypes: [],
    cardTypes: ['Artifact'],
    subTypes: [],
    oracleText: '',
    colors: [],
    colorIdentity: [],
    keywords: [],
    legalities: {},
    isDoubleFaced: false,
  };
}

function makeRecoveryGame(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Host', 0, '#3b82f6', config);
  const p2 = createPlayer('p2', 'Joiner', 1, '#ef4444', config);
  const hostHand = createCardState(makeDef('host-hand', 'Host Hidden Card'), 'p1', 'hand');
  const hostLibrary = createCardState(makeDef('host-library', 'Host Library Card'), 'p1', 'library');
  const joinerHand = createCardState(makeDef('joiner-hand', 'Joiner Hidden Card'), 'p2', 'hand');
  const joinerLibrary = createCardState(makeDef('joiner-library', 'Joiner Library Card'), 'p2', 'library');
  const publicPermanent = createCardState(makeDef('joiner-rock', 'Joiner Public Rock'), 'p2', 'battlefield');
  return {
    ...base,
    id: 'game-recovery',
    status: 'playing',
    players: [
      { ...p1, hand: [hostHand.instanceId], library: [hostLibrary.instanceId] },
      { ...p2, hand: [joinerHand.instanceId], library: [joinerLibrary.instanceId], battlefield: [publicPermanent.instanceId] },
    ],
    cards: {
      [hostHand.instanceId]: hostHand,
      [hostLibrary.instanceId]: hostLibrary,
      [joinerHand.instanceId]: joinerHand,
      [joinerLibrary.instanceId]: joinerLibrary,
      [publicPermanent.instanceId]: publicPermanent,
    },
    definitions: {
      [hostHand.definitionId]: hostHand.definition,
      [hostLibrary.definitionId]: hostLibrary.definition,
      [joinerHand.definitionId]: joinerHand.definition,
      [joinerLibrary.definitionId]: joinerLibrary.definition,
      [publicPermanent.definitionId]: publicPermanent.definition,
    },
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
  };
}

const game = makeRecoveryGame();
assert(!isFirebaseRecoveryConfigured(), 'Firebase recovery should be disabled when VITE_FIREBASE_* env vars are missing');

const publicSnapshot = buildFirebasePublicStartSnapshot(game, 'snapshot-1', 1000);
const publicJson = JSON.stringify(publicSnapshot);

assert(publicSnapshot.status === 'playing', 'public recovery snapshot should be marked playing');
assert(publicSnapshot.players[0].handCount === 1, 'public recovery snapshot should expose hand count');
assert(publicSnapshot.players[1].libraryCount === 1, 'public recovery snapshot should expose library count');
assert(publicSnapshot.players[1].battlefield[0].name === 'Joiner Public Rock', 'public zones should include public card names');
assert(!publicJson.includes('Host Hidden Card'), 'public recovery snapshot must not include host hand card names');
assert(!publicJson.includes('Host Library Card'), 'public recovery snapshot must not include host library card names');
assert(!publicJson.includes('Joiner Hidden Card'), 'public recovery snapshot must not include joiner hand card names');
assert(!publicJson.includes('Joiner Library Card'), 'public recovery snapshot must not include joiner library card names');

const privateSnapshots = buildFirebasePrivateStartSnapshots(game, 'snapshot-1', 1000);
assert(privateSnapshots.p1.hand.length === 1, 'host private snapshot should include host hand ids');
assert(privateSnapshots.p1.library.length === 1, 'host private snapshot should include host library ids');
assert(privateSnapshots.p2.hand.length === 1, 'joiner private snapshot should include joiner hand ids');
assert(privateSnapshots.p2.library.length === 1, 'joiner private snapshot should include joiner library ids');

const joinerPrivateJson = JSON.stringify(privateSnapshots.p2);
assert(joinerPrivateJson.includes('Joiner Hidden Card'), 'joiner private recovery snapshot should include own hand card data');
assert(joinerPrivateJson.includes('Joiner Library Card'), 'joiner private recovery snapshot should include own library card data');
assert(!joinerPrivateJson.includes('Host Hidden Card'), 'joiner private recovery snapshot must not include host hand card data');
assert(!joinerPrivateJson.includes('Host Library Card'), 'joiner private recovery snapshot must not include host library card data');
assert(privateSnapshots.p2.sanitizedGame?.status === 'playing', 'private recovery snapshot should carry a playing sanitized game');

console.log('PASS Firebase recovery snapshots split public and private multiplayer data');
