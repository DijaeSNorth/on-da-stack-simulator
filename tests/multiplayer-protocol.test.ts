/**
 * Host-authoritative multiplayer protocol regression checks.
 *
 * Run with: npx tsx tests/multiplayer-protocol.test.ts
 */

import {
  prepareCommanderDeckForUse,
} from '../client/src/engine/deckImport';
import {
  createCardState,
  createDefaultGameConfig,
  createEmptyGameState,
  createPlayer,
} from '../client/src/engine/gameEngine';
import {
  canHostStartFromLobby,
  createDeckSubmission,
  createPrivatePlayerState,
  createPublicGameState,
  makeMultiplayerMessage,
  sanitizeGameStateForPlayer,
  validateDeckSubmission,
  validateMultiplayerMessage,
  type LobbyPlayer,
  type LobbyState,
} from '../client/src/engine/multiplayerProtocol';
import type { CardDefinition, Deck, GameState } from '../client/src/types/game';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function deck(playerId: string, name = `${playerId} Deck`): Deck {
  return {
    id: `deck-${playerId}`,
    name,
    format: 'commander',
    commanders: ['Vial Smasher the Fierce', 'Sakashima of a Thousand Faces'],
    cards: [
      { name: 'Vial Smasher the Fierce', count: 1 },
      { name: 'Sakashima of a Thousand Faces', count: 1 },
      { name: 'Sol Ring', count: 1 },
      { name: 'Island', count: 32 },
      { name: 'Swamp', count: 32 },
      { name: 'Mountain', count: 33 },
    ],
    sideboard: [],
    maybeboard: [],
    colorIdentity: ['U', 'B', 'R'],
    importedAt: Date.now(),
  };
}

function lobbyPlayer(playerId: string, seatIndex: number, ready: boolean, deckStatus: LobbyPlayer['deckStatus'] = 'valid'): LobbyPlayer {
  return {
    playerId,
    peerId: `peer-${playerId}`,
    sessionId: `session-${playerId}`,
    name: playerId,
    color: '#3b82f6',
    seatIndex,
    isSpectator: false,
    isHost: seatIndex === 0,
    connected: true,
    ready,
    deckStatus,
    lastSeen: Date.now(),
  };
}

function makeLobby(ready = true): LobbyState {
  const p1 = lobbyPlayer('player-one', 0, ready);
  const p2 = lobbyPlayer('player-two', 1, ready);
  const s1 = createDeckSubmission(deck(p1.playerId), p1.playerId);
  const s2 = createDeckSubmission(deck(p2.playerId), p2.playerId);
  return {
    roomId: 'ROOM12',
    roomCode: 'ROOM12',
    hostPeerId: p1.peerId,
    players: {
      [p1.playerId]: p1,
      [p2.playerId]: p2,
      spectator: {
        ...lobbyPlayer('spectator', -1, true, 'none'),
        isSpectator: true,
        seatIndex: -1,
      },
    },
    submittedDecks: {
      [p1.playerId]: {
        playerId: p1.playerId,
        deckId: s1.deckId,
        deckName: s1.deckName,
        commanderNames: s1.commanderNames,
        cardCount: s1.cardCount,
        deckHash: s1.deckHash,
        status: 'valid',
        errors: [],
        warnings: [],
      },
      [p2.playerId]: {
        playerId: p2.playerId,
        deckId: s2.deckId,
        deckName: s2.deckName,
        commanderNames: s2.commanderNames,
        cardCount: s2.cardCount,
        deckHash: s2.deckHash,
        status: 'valid',
        errors: [],
        warnings: [],
      },
    },
    minPlayers: 2,
    maxPlayers: 6,
    status: 'lobby',
    updatedAt: Date.now(),
  };
}

function def(id: string, name: string): CardDefinition {
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

function gameWithPrivateZones(): GameState {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Host', 0, '#3b82f6', config);
  const p2 = createPlayer('p2', 'Guest', 1, '#ef4444', config);
  const p1Hand = createCardState(def('host-hand-def', 'Host Hidden Card'), 'p1', 'hand');
  const p2Hand = createCardState(def('guest-hand-def', 'Guest Hidden Card'), 'p2', 'hand');
  const p2Library = createCardState(def('guest-library-def', 'Guest Library Card'), 'p2', 'library');
  const battlefield = createCardState(def('public-def', 'Public Permanent'), 'p2', 'battlefield');
  return {
    ...base,
    players: [
      { ...p1, hand: [p1Hand.instanceId], library: [], battlefield: [] },
      { ...p2, hand: [p2Hand.instanceId], library: [p2Library.instanceId], battlefield: [battlefield.instanceId] },
    ],
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
    cards: {
      [p1Hand.instanceId]: p1Hand,
      [p2Hand.instanceId]: p2Hand,
      [p2Library.instanceId]: p2Library,
      [battlefield.instanceId]: battlefield,
    },
    definitions: {
      [p1Hand.definitionId]: p1Hand.definition,
      [p2Hand.definitionId]: p2Hand.definition,
      [p2Library.definitionId]: p2Library.definition,
      [battlefield.definitionId]: battlefield.definition,
    },
  };
}

const validMessage = makeMultiplayerMessage({
  roomId: 'ROOM12',
  playerId: 'player-one',
  peerId: 'peer-one',
  sessionId: 'session-one',
  type: 'PLAYER_READY_CHANGED',
  payload: { playerId: 'player-one', ready: true },
  seq: 1,
});
assert(validateMultiplayerMessage(validMessage, 'ROOM12').ok, 'expected a complete v2 protocol message to validate');
assert(!validateMultiplayerMessage({ ...validMessage, playerId: '' }, 'ROOM12').ok, 'expected missing playerId to be rejected');
assert(!validateMultiplayerMessage({ ...validMessage, roomId: 'OTHER' }, 'ROOM12').ok, 'expected wrong roomId to be rejected');
assert(!validateMultiplayerMessage({ ...validMessage, type: 'NOPE' }, 'ROOM12').ok, 'expected unknown message type to be rejected');
assert(!validateMultiplayerMessage({ ...validMessage, protocolVersion: 99 }, 'ROOM12').ok, 'expected unsupported protocol version to be rejected');
const { sentAt: _removedSentAt, ...missingSentAtMessage } = validMessage;
assert(!validateMultiplayerMessage(missingSentAtMessage, 'ROOM12').ok, 'expected missing sentAt to stay rejected');

const protocolGame = { ...gameWithPrivateZones(), status: 'playing' as const };
const protocolMessages = [
  makeMultiplayerMessage({
    roomId: 'ROOM12',
    playerId: 'player-one',
    peerId: 'peer-one',
    sessionId: 'session-one',
    type: 'START_GAME_PREPARE',
    payload: {
      id: 'prepare-one',
      hostPeerId: 'peer-one',
      gameId: protocolGame.id,
      playerList: [],
      deckHashes: {},
      turnOrder: ['p1', 'p2'],
      requiredPeerIds: ['peer-two'],
      createdAt: Date.now(),
      deadline: Date.now() + 5000,
      deadlineAt: Date.now() + 5000,
    },
    seq: 2,
  }),
  makeMultiplayerMessage({
    roomId: 'ROOM12',
    playerId: 'player-one',
    peerId: 'peer-one',
    sessionId: 'session-one',
    type: 'START_GAME_COMMIT',
    payload: {
      id: 'commit-one',
      gameId: protocolGame.id,
      game: protocolGame,
      publicGameState: createPublicGameState(protocolGame),
      fallback: false,
      missingPeerIds: [],
      committedAt: Date.now(),
    },
    seq: 3,
  }),
  makeMultiplayerMessage({
    roomId: 'ROOM12',
    playerId: 'player-one',
    peerId: 'peer-one',
    sessionId: 'session-one',
    type: 'GAME_STATE_PATCH',
    payload: {
      seq: 1,
      publicGameState: createPublicGameState(protocolGame),
      privatePlayerState: createPrivatePlayerState(protocolGame, 'p1'),
      sanitizedGame: sanitizeGameStateForPlayer(protocolGame, 'p1'),
    },
    seq: 4,
  }),
  makeMultiplayerMessage({
    roomId: 'ROOM12',
    playerId: 'player-one',
    peerId: 'peer-one',
    sessionId: 'session-one',
    type: 'LOBBY_STATE',
    payload: makeLobby(true),
    seq: 5,
  }),
  makeMultiplayerMessage({
    roomId: 'ROOM12',
    playerId: 'player-one',
    peerId: 'peer-one',
    sessionId: 'session-one',
    type: 'DECK_SUBMITTED',
    payload: createDeckSubmission(deck('player-one'), 'player-one'),
    seq: 6,
  }),
  makeMultiplayerMessage({
    roomId: 'ROOM12',
    playerId: 'player-one',
    peerId: 'peer-one',
    sessionId: 'session-one',
    type: 'PLAYER_READY_CHANGED',
    payload: { playerId: 'player-one', ready: true },
    seq: 7,
  }),
];
for (const message of protocolMessages) {
  assert(Number.isFinite(message.sentAt), `expected ${message.type} to include sentAt after enveloping`);
  assert(validateMultiplayerMessage(message, 'ROOM12').ok, `expected enveloped ${message.type} to validate`);
}

const submission = createDeckSubmission(deck('player-one'), 'player-one');
assert(validateDeckSubmission(submission).valid, 'expected a valid 100-card commander submission to pass');
const canonicalPrep = prepareCommanderDeckForUse({
  ...deck('player-one'),
  cards: [
    { name: ' Vial Smasher the Fierce ', count: 1 },
    { name: 'Island', count: 30 },
    { name: 'Island ', count: 2 },
    { name: 'Swamp', count: 32 },
    { name: 'Mountain', count: 34 },
  ],
});
assert(canonicalPrep.valid, 'expected canonical prep to accept a 100-card commander deck after trimming and merging');
assert(canonicalPrep.deck.cards.find(card => card.name === 'Island')?.count === 32, 'expected canonical prep to merge duplicate card entries');
assert(canonicalPrep.totalCommanderCount === 100, 'expected canonical prep count to match submission count logic');
const tampered = {
  ...submission,
  cards: submission.cards.map(card => card.name === 'Island' ? { ...card, count: card.count + 1 } : card),
};
assert(!validateDeckSubmission(tampered).valid, 'expected deck hash/count validation to reject tampered deck contents');
assert(!prepareCommanderDeckForUse({ ...deck('short'), cards: deck('short').cards.slice(0, -1) }).valid, 'expected 99-card deck to fail multiplayer prep');
assert(!prepareCommanderDeckForUse({ ...deck('long'), cards: [...deck('long').cards, { name: 'Forest', count: 1 }] }).valid, 'expected 101-card deck to fail multiplayer prep');

const readyLobby = makeLobby(true);
assert(canHostStartFromLobby(readyLobby).canStart, 'expected host to start when 2 seated players have valid decks and are ready');
assert(!canHostStartFromLobby(makeLobby(false)).canStart, 'expected host start to wait for seated player ready');
const missingDeckLobby = {
  ...readyLobby,
  submittedDecks: { [Object.keys(readyLobby.submittedDecks)[0]]: Object.values(readyLobby.submittedDecks)[0] },
};
assert(!canHostStartFromLobby(missingDeckLobby).canStart, 'expected host start to require each seated player deck submission');

const game = gameWithPrivateZones();
const publicGame = createPublicGameState(game);
assert(publicGame.players[1].handCount === 1, 'expected public state to expose opponent hand count');
assert(publicGame.players[1].libraryCount === 1, 'expected public state to expose opponent library count');
assert(!publicGame.cards[game.players[1].hand[0]], 'expected public state to omit opponent hand card data');
assert(!publicGame.cards[game.players[1].library[0]], 'expected public state to omit opponent library card data');
assert(publicGame.cards[game.players[1].battlefield[0]], 'expected public state to retain public battlefield cards');

const privateP1 = createPrivatePlayerState(game, 'p1');
assert(privateP1?.hand[0] === game.players[0].hand[0], 'expected private state to include owning player hand');
const sanitizedForP1 = sanitizeGameStateForPlayer(game, 'p1');
assert(sanitizedForP1.players[0].hand[0] === game.players[0].hand[0], 'expected sanitized state to keep viewer hand real');
assert(sanitizedForP1.players[1].hand[0].startsWith('hidden-hand-p2-'), 'expected sanitized state to hide opponent hand ids');
assert(!sanitizedForP1.cards[game.players[1].hand[0]], 'expected sanitized state to remove opponent hand card object');
assert(!sanitizedForP1.cards[game.players[1].library[0]], 'expected sanitized state to remove opponent library card object');

console.log('PASS host-authoritative multiplayer protocol validation, deck hashes, start gating, and private state sanitization');
