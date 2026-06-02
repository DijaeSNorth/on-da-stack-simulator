// ─── Zustand Game Store ───────────────────────────────────────────────────────
import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type {
  GameState, Player, CardState, Phase, StackObject, TriggerItem,
  AssistantFlag, Deck, GameConfig, ActionRecord
} from '../types/game';
import {
  createEmptyGameState, createPlayer, createAction, moveCard, tapCard,
  addCounter, removeCounter, modifyLife, addCommanderDamage,
  nextPhase, setPhase, nextTurn, pushToStack, resolveTopStack,
  addTrigger, acknowledgeTrigger, drawCards, discardCard, createToken,
  checkStateBasedActions, declareAttacker, declareBlocker, undoAction,
  loadDeckIntoPlayer, createDefaultGameConfig,
  triggerMyriad, exileMyriadCopies,
} from '../engine/gameEngine';
import {
  checkCastLegality, checkTapLegality, checkAttackLegality, checkBlockLegality,
  detectETBTriggers, getActiveModifiers,
} from '../engine/assistantEngine';
import { saveDeck, loadDecksFromStorage } from '../engine/deckImport';
import { createReplay, saveReplayToStorage } from '../engine/replayEngine';
import {
  initMultiplayer, createRoom, joinRoom, leaveRoom,
  broadcastState, updatePresence, getRoomCode, getPeerId, getIsHost,
  getSyncStatus, isConfigured,
  type RoomPresence, type SyncStatus,
} from '../engine/multiplayerSync';

// ─── UI State ─────────────────────────────────────────────────────────────────

export interface UIState {
  selectedCardId: string | null;
  hoveredCardId: string | null;
  focusedPlayerId: string | null;
  rightPanelTab: 'assistant' | 'stack' | 'log' | 'triggers' | 'rules' | 'votes' | 'debug';
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  combatMode: boolean;
  deckBuilderOpen: boolean;
  lobbyOpen: boolean;
  zoneDrawer: { zone: 'graveyard' | 'exile' | 'library' | 'hand'; playerId: string } | null;
  cardContextMenu: { instanceId: string; x: number; y: number } | null;
  cardPreview: string | null;
  searchQuery: string;
  showTokenEditor: boolean;
  cardSearchOpen: boolean;
  replayOpen: boolean;
  profileOpen: boolean;
  judgeMode: boolean;
  battlefieldView: 'normal' | 'overview';
  assistantMessages: AssistantMessage[];
  actionFilter: string;
}

export interface AssistantMessage {
  id: string;
  timestamp: number;
  severity: AssistantFlag['severity'];
  label: AssistantFlag['label'];
  text: string;
  ruleRef?: string;
  cardRef?: string;
  turn: number;
  phase: Phase;
}

// ─── Multiplayer State ───────────────────────────────────────────────────────

export interface MultiplayerState {
  status: SyncStatus;
  roomCode: string | null;
  peerId: string | null;
  isHost: boolean;
  isSpectator: boolean;                 // true when lobby was full on join
  peers: Record<string, RoomPresence>; // all players in room by peerId
  configured: boolean;                  // always true for P2P (no env vars needed)
}

const DEFAULT_MULTIPLAYER: MultiplayerState = {
  status: 'disconnected',
  roomCode: null,
  peerId: null,
  isHost: false,
  isSpectator: false,
  peers: {},
  configured: false,
};

const DEFAULT_UI: UIState = {
  selectedCardId: null,
  hoveredCardId: null,
  focusedPlayerId: null,
  rightPanelTab: 'assistant',
  leftPanelOpen: true,
  rightPanelOpen: true,
  combatMode: false,
  deckBuilderOpen: false,
  lobbyOpen: true,
  zoneDrawer: null,
  cardContextMenu: null,
  cardPreview: null,
  searchQuery: '',
  showTokenEditor: false,
  cardSearchOpen: false,
  replayOpen: false,
  profileOpen: false,
  judgeMode: false,
  battlefieldView: 'normal',
  assistantMessages: [],
  actionFilter: '',
};

// ─── Store Interface ──────────────────────────────────────────────────────────

export interface GameStore {
  game: GameState;
  ui: UIState;
  multiplayer: MultiplayerState;
  decks: Deck[];
  localPlayerId: string;

  // ── Multiplayer actions ──────────────────────────────────────────────────
  initMultiplayerListeners: () => void;
  createMultiplayerRoom: (
    hostName: string,
    hostColor: string,
    seatIndex: number,
  ) => Promise<string>;
  joinMultiplayerRoom: (
    code: string,
    peerName: string,
    peerColor: string,
    seatIndex: number,
  ) => Promise<void>;
  leaveMultiplayerRoom: () => void;
  setMultiplayerStatus: (status: SyncStatus) => void;
  setMultiplayerPeers: (peers: Record<string, RoomPresence>) => void;

  initGame: (config: GameConfig, players: { id: string; name: string; color: string }[]) => void;
  loadDeck: (playerId: string, deck: Deck) => Promise<void>;
  startGame: () => void;
  resetGame: () => void;

  castCard: (castingPlayerId: string, cardInstanceId: string) => void;
  playLand: (playerId: string, cardInstanceId: string) => void;
  moveCardToZone: (instanceId: string, toZone: CardState['zone'], toController?: string) => void;
  tapCard: (instanceId: string) => void;
  untapCard: (instanceId: string) => void;
  tapAllLands: (playerId: string) => void;
  untapAll: (playerId: string) => void;
  addCounterToCard: (instanceId: string, counterType: string, amount?: number) => void;
  removeCounterFromCard: (instanceId: string, counterType: string, amount?: number) => void;
  attachCard: (attachmentId: string, targetId: string) => void;
  detachCard: (attachmentId: string) => void;
  transformCard: (instanceId: string) => void;
  createTokenCard: (controllerId: string, tokenDef: Parameters<typeof createToken>[2]) => void;

  modifyPlayerLife: (playerId: string, delta: number) => void;
  addCommanderDmg: (receivingPlayerId: string, commanderInstanceId: string, damage: number) => void;
  addPoisonCounter: (playerId: string, amount?: number) => void;
  drawCard: (playerId: string, count?: number) => void;
  discardFromHand: (playerId: string, instanceId: string) => void;
  shuffleLibrary: (playerId: string) => void;
  millCards: (playerId: string, count: number) => void;

  advancePhase: () => void;
  goToPhase: (phase: Phase) => void;
  advanceTurn: () => void;
  passPriority: () => void;

  putOnStack: (item: Omit<StackObject, 'id' | 'timestamp'>) => void;
  resolveStack: () => void;
  counterSpell: (stackObjectId: string) => void;

  addTriggerToQueue: (trigger: Omit<TriggerItem, 'id' | 'timestamp' | 'acknowledged' | 'missed'>) => void;
  ackTrigger: (triggerId: string) => void;
  /** Move a trigger up (toward index 0) in the queue — for APNAP ordering. */
  moveTriggerUp: (triggerId: string) => void;
  /** Move a trigger down in the queue. */
  moveTriggerDown: (triggerId: string) => void;
  /** Mark a trigger as missed (CR 702.19 — judge mode only, still logs). */
  markTriggerMissed: (triggerId: string) => void;

  enterCombat: () => void;
  declareAttack: (attackerInstanceId: string, targetPlayerId: string) => void;
  /** Trigger Myriad for an attacker: create token copies attacking each OTHER opponent. */
  declareMyriadAttack: (
    attackerInstanceId: string,
    declaredDefenderId: string,
    copiesPerOpponent: number,
  ) => { copyInstanceId: string; targetPlayerId: string }[];
  declareBlock: (blockerInstanceId: string, attackerInstanceId: string) => void;
  resolveCombatDamage: () => void;
  endCombat: () => void;

  runStateBasedActions: () => void;
  undo: () => void;

  setSelectedCard: (instanceId: string | null) => void;
  setHoveredCard: (instanceId: string | null) => void;
  setFocusedPlayer: (playerId: string | null) => void;
  setRightPanelTab: (tab: UIState['rightPanelTab']) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  openZoneDrawer: (zone: 'graveyard' | 'exile' | 'library' | 'hand', playerId: string) => void;
  closeZoneDrawer: () => void;
  openCardContextMenu: (instanceId: string, x: number, y: number) => void;
  closeCardContextMenu: () => void;
  setCardPreview: (instanceId: string | null) => void;
  setCardSearchOpen: (open: boolean) => void;
  setReplayOpen: (open: boolean) => void;
  setProfileOpen: (open: boolean) => void;
  saveReplay: (name?: string) => void;
  setJudgeMode: (on: boolean) => void;
  toggleBattlefieldView: () => void;
  toggleCombatMode: () => void;
  setLobbyOpen: (open: boolean) => void;
  setDeckBuilderOpen: (open: boolean) => void;
  addAssistantMessage: (msg: Omit<AssistantMessage, 'id' | 'timestamp' | 'turn' | 'phase'>) => void;

  loadDecks: () => void;
  saveDeckToStorage: (deck: Deck) => void;

  /** Scry N — move top N to a holding list so player can decide via ZoneDrawer */
  scryCards: (playerId: string, count: number) => void;
  /** Surveil N — same as scry but mills to GY instead of bottom */
  surveilCards: (playerId: string, count: number) => void;
  /** Cycle a card: discard it, draw 1 */
  cycleCard: (playerId: string, instanceId: string) => void;
  /** Cast a card from a specific zone (GY, exile, command, etc.) */
  castFromZone: (playerId: string, instanceId: string, fromZone: CardState['zone']) => void;
  /** Reanimate: move any card from GY/exile directly to battlefield */
  reanimateCard: (instanceId: string, toControllerId: string) => void;
  /** Log a freeform judge note / mechanic hint (Tier 3 oracle actions) */
  logAction: (playerId: string, type: string, text: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMsg(game: GameState, flag: AssistantFlag): AssistantMessage {
  return {
    id: uuid(),
    timestamp: Date.now(),
    turn: game.turn,
    phase: game.phase,
    severity: flag.severity,
    label: flag.label,
    text: flag.text,
    ruleRef: flag.ruleRef,
    cardRef: flag.cardRef,
  };
}

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameStore>()((set, get) => ({
  game: createEmptyGameState(createDefaultGameConfig(4)),
  ui: DEFAULT_UI,
  multiplayer: { ...DEFAULT_MULTIPLAYER, configured: isConfigured() },
  decks: loadDecksFromStorage(),
  localPlayerId: '',

  // ── Multiplayer ────────────────────────────────────────────────────────

  initMultiplayerListeners: () => {
    initMultiplayer(
      // onGameUpdate — remote peer pushed a new GameState
      (game: GameState) => {
        // Only apply remote update if it's newer than ours
        if (game.lastUpdatedAt > get().game.lastUpdatedAt) {
          set({ game });
        }
      },
      // onPresenceUpdate — someone joined/left
      (peers: Record<string, RoomPresence>) => {
        set(s => ({ multiplayer: { ...s.multiplayer, peers } }));
      },
      // onStatusChange
      (status: SyncStatus) => {
        set(s => ({ multiplayer: { ...s.multiplayer, status } }));
      },
    );
  },

  createMultiplayerRoom: async (hostName, hostColor, seatIndex) => {
    const { game } = get();
    const peerId = crypto.randomUUID();
    const code = await createRoom(game, {
      peerId,
      name: hostName,
      color: hostColor,
      seatIndex,
    });
    set(s => ({
      localPlayerId: game.players[seatIndex]?.id ?? game.players[0]?.id ?? '',
      multiplayer: {
        ...s.multiplayer,
        status: 'host',
        roomCode: code,
        peerId,
        isHost: true,
        configured: true,
      },
    }));
    return code;
  },

  joinMultiplayerRoom: async (code, peerName, peerColor, seatIndex) => {
    const peerId = crypto.randomUUID();
    const { game: remoteGame, isSpectator } = await joinRoom(code, {
      peerId,
      name: peerName,
      color: peerColor,
      seatIndex,
      isSpectator: false, // host decides; we send intent
    });
    // P2P: joinRoom returns null game — joiner keeps existing local state
    // until host broadcasts the authoritative state on next game action.
    const currentGame = get().game;
    const resolvedGame = remoteGame ?? currentGame;
    // Spectators get no local player id — they observe only
    const playerId = isSpectator
      ? ''
      : (resolvedGame.players[seatIndex]?.id ?? resolvedGame.players[0]?.id ?? '');
    set(s => ({
      game: resolvedGame,
      localPlayerId: playerId,
      multiplayer: {
        ...s.multiplayer,
        status: 'joined',
        roomCode: code.toUpperCase(),
        peerId,
        isHost: false,
        isSpectator,
        configured: true,
      },
    }));
  },

  leaveMultiplayerRoom: () => {
    leaveRoom();
    set(s => ({
      multiplayer: { ...DEFAULT_MULTIPLAYER, configured: isConfigured() },
    }));
  },

  setMultiplayerStatus: (status) =>
    set(s => ({ multiplayer: { ...s.multiplayer, status } })),

  setMultiplayerPeers: (peers) =>
    set(s => ({ multiplayer: { ...s.multiplayer, peers } })),

  // ── Init ────────────────────────────────────────────────────────

  initGame: (config, players) => {
    const g = createEmptyGameState(config);
    g.players = players.map((p, i) =>
      createPlayer(p.id, p.name, i, p.color || PLAYER_COLORS[i], config)
    );
    g.activePlayerId = g.players[0].id;
    g.priorityPlayerId = g.players[0].id;
    g.players[0].isActive = true;
    g.players[0].hasPriority = true;
    set({ game: g, localPlayerId: players[0].id, ui: { ...get().ui, lobbyOpen: true } });
  },

  loadDeck: async (playerId, deck) => {
    const newState = await loadDeckIntoPlayer(get().game, playerId, deck);
    set({ game: newState });
  },

  startGame: () => {
    const g = get().game;
    const action = createAction(g, g.activePlayerId, 'GAME_START', 'Game started.');
    set({
      game: { ...g, status: 'playing', phase: 'main1', actionLog: [...g.actionLog, action] },
      ui: { ...get().ui, lobbyOpen: false },
    });
  },

  resetGame: () => {
    set({
      game: createEmptyGameState(get().game.config),
      ui: { ...DEFAULT_UI, lobbyOpen: true },
    });
  },

  // ── Card Actions ──────────────────────────────────────────────────────────

  castCard: (castingPlayerId, cardInstanceId) => {
    let g = get().game;
    const check = checkCastLegality(g, castingPlayerId, cardInstanceId);
    const card = g.cards[cardInstanceId];
    if (!card) return;

    const stackObj: StackObject = {
      id: uuid(), type: 'spell',
      sourceInstanceId: cardInstanceId,
      sourceDefinitionId: card.definitionId,
      sourceName: card.definition.name,
      controllerId: castingPlayerId,
      text: card.definition.oracleText,
      timestamp: Date.now(),
    };

    g = moveCard(g, cardInstanceId, 'stack', castingPlayerId);
    g = pushToStack(g, stackObj);

    // Track commander cast count for tax purposes (CR 903.8)
    const castingPlayer = g.players.find(p => p.id === castingPlayerId);
    const isCommanderBeingCast = castingPlayer?.commanders.includes(cardInstanceId) ||
      card.zone === 'command';
    if (isCommanderBeingCast && g.config.commanderTaxEnabled) {
      g = {
        ...g,
        players: g.players.map(p => {
          if (p.id !== castingPlayerId) return p;
          const prevCount = p.commanderCastCount[cardInstanceId] || 0;
          return {
            ...p,
            commanderCastCount: { ...p.commanderCastCount, [cardInstanceId]: prevCount + 1 },
          };
        }),
      };
    }

    const action = createAction(g, castingPlayerId, 'CAST_SPELL',
      `${card.definition.name} cast by ${castingPlayerId}`, [cardInstanceId], {}, check.flags);
    g = { ...g, actionLog: [...g.actionLog, action] };

    const newMsgs = check.flags.map(f => makeMsg(g, f));
    set({ game: g, ui: { ...get().ui, assistantMessages: [...get().ui.assistantMessages, ...newMsgs] } });
  },

  playLand: (playerId, cardInstanceId) => {
    let g = get().game;
    const card = g.cards[cardInstanceId];
    if (!card) return;
    g = moveCard(g, cardInstanceId, 'battlefield', playerId);
    g = { ...g, cards: { ...g.cards, [cardInstanceId]: { ...g.cards[cardInstanceId], summoningSick: false } } };
    const action = createAction(g, playerId, 'MOVE_CARD', `${card.definition.name} played`, [cardInstanceId]);
    g = { ...g, actionLog: [...g.actionLog, action] };

    // ETB triggers
    const triggers = detectETBTriggers(g, g.cards[cardInstanceId]);
    const newTriggers: TriggerItem[] = triggers.map(t => ({
      id: uuid(), sourceInstanceId: t.sourceCard.instanceId,
      sourceName: t.sourceCard.definition.name, controllerId: t.sourceCard.controllerId,
      text: t.triggerText, triggerType: t.triggerType,
      acknowledged: false, missed: false, timestamp: Date.now(),
    }));
    g = { ...g, triggerQueue: [...g.triggerQueue, ...newTriggers] };
    set({ game: g });
  },

  moveCardToZone: (instanceId, toZone, toController) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    g = moveCard(g, instanceId, toZone, toController);
    const action = createAction(g, g.activePlayerId, 'MOVE_CARD',
      `${card.definition.name} moved to ${toZone}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  tapCard: (instanceId) => {
    let g = get().game;
    const check = checkTapLegality(g, instanceId);
    const card = g.cards[instanceId];
    if (!card) return;
    g = tapCard(g, instanceId, true);
    const action = createAction(g, card.controllerId, 'TAP', `Tapped ${card.definition.name}`, [instanceId], {}, check.flags);
    const newMsgs = check.flags.map(f => makeMsg(g, f));
    set({ game: { ...g, actionLog: [...g.actionLog, action] }, ui: { ...get().ui, assistantMessages: [...get().ui.assistantMessages, ...newMsgs] } });
  },

  untapCard: (instanceId) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    g = tapCard(g, instanceId, false);
    const action = createAction(g, card.controllerId, 'UNTAP', `Untapped ${card.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  tapAllLands: (playerId) => {
    let g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    for (const id of player.battlefield) {
      const card = g.cards[id];
      if (card && card.definition.cardTypes.includes('Land') && !card.tapped) {
        g = tapCard(g, id, true);
      }
    }
    set({ game: g });
  },

  untapAll: (playerId) => {
    let g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    for (const id of player.battlefield) {
      g = tapCard(g, id, false);
    }
    set({ game: g });
  },

  addCounterToCard: (instanceId, counterType, amount = 1) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    g = addCounter(g, instanceId, counterType, amount);
    const action = createAction(g, card.controllerId, 'ADD_COUNTER',
      `Added ${amount} ${counterType} to ${card.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  removeCounterFromCard: (instanceId, counterType, amount = 1) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    g = removeCounter(g, instanceId, counterType, amount);
    const action = createAction(g, card.controllerId, 'REMOVE_COUNTER',
      `Removed ${counterType} from ${card.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  attachCard: (attachmentId, targetId) => {
    const g = get().game;
    const att = g.cards[attachmentId];
    const tgt = g.cards[targetId];
    if (!att || !tgt) return;
    set({
      game: {
        ...g,
        cards: {
          ...g.cards,
          [attachmentId]: { ...att, attachedTo: targetId },
          [targetId]: { ...tgt, attachments: [...tgt.attachments, attachmentId] },
        },
      },
    });
  },

  detachCard: (attachmentId) => {
    const g = get().game;
    const att = g.cards[attachmentId];
    if (!att?.attachedTo) return;
    const parent = g.cards[att.attachedTo];
    const newCards = { ...g.cards, [attachmentId]: { ...att, attachedTo: undefined } };
    if (parent) {
      newCards[att.attachedTo] = { ...parent, attachments: parent.attachments.filter(id => id !== attachmentId) };
    }
    set({ game: { ...g, cards: newCards } });
  },

  transformCard: (instanceId) => {
    const g = get().game;
    const card = g.cards[instanceId];
    if (!card || !card.definition.isDoubleFaced) return;
    set({ game: { ...g, cards: { ...g.cards, [instanceId]: { ...card, transformed: !card.transformed } } } });
  },

  createTokenCard: (controllerId, tokenDef) => {
    let g = get().game;
    g = createToken(g, controllerId, tokenDef);
    const action = createAction(g, controllerId, 'ADD_TOKEN', `Created ${tokenDef.name} token`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  // ── Player ────────────────────────────────────────────────────────────────

  modifyPlayerLife: (playerId, delta) => {
    let g = get().game;
    g = modifyLife(g, playerId, delta);
    const player = g.players.find(p => p.id === playerId);
    const action = createAction(g, playerId, 'CHANGE_LIFE',
      `${player?.name || playerId} life ${delta > 0 ? '+' : ''}${delta} → ${player?.life}`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  addCommanderDmg: (receivingPlayerId, commanderInstanceId, damage) => {
    let g = get().game;
    g = addCommanderDamage(g, receivingPlayerId, commanderInstanceId, damage);
    const action = createAction(g, g.activePlayerId, 'COMMANDER_DAMAGE',
      `${damage} commander damage → ${receivingPlayerId}`, [commanderInstanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  addPoisonCounter: (playerId, amount = 1) => {
    const g = get().game;
    set({
      game: {
        ...g,
        players: g.players.map(p =>
          p.id === playerId ? { ...p, poisonCounters: p.poisonCounters + amount } : p
        ),
      },
    });
  },

  drawCard: (playerId, count = 1) => {
    let g = get().game;
    g = drawCards(g, playerId, count);
    const player = g.players.find(p => p.id === playerId);
    const action = createAction(g, playerId, 'DRAW_CARD',
      `${player?.name || playerId} drew ${count} card(s)`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  discardFromHand: (playerId, instanceId) => {
    let g = get().game;
    g = discardCard(g, playerId, instanceId);
    const card = g.cards[instanceId];
    const action = createAction(g, playerId, 'DISCARD', `Discarded ${card?.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  shuffleLibrary: (playerId) => {
    const g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    const shuffled = [...player.library].sort(() => Math.random() - 0.5);
    const newPlayers = g.players.map(p => p.id === playerId ? { ...p, library: shuffled } : p);
    const action = createAction(g, playerId, 'SHUFFLE', `${player.name} shuffled.`);
    set({ game: { ...g, players: newPlayers, actionLog: [...g.actionLog, action] } });
  },

  millCards: (playerId, count) => {
    let g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    const milled = player.library.slice(0, count);
    for (const id of milled) g = moveCard(g, id, 'graveyard');
    set({ game: g });
  },

  // ── Phase / Turn ──────────────────────────────────────────────────────────

  advancePhase: () => {
    let g = get().game;
    const prev = g.phase;
    g = nextPhase(g);
    const action = createAction(g, g.activePlayerId, 'CHANGE_PHASE', `${prev} → ${g.phase}`);
    g = { ...g, actionLog: [...g.actionLog, action] };
    const mods = getActiveModifiers(g);
    const newMsgs = mods.map(f => makeMsg(g, f));
    set({ game: g, ui: { ...get().ui, assistantMessages: [...get().ui.assistantMessages, ...newMsgs] } });
  },

  goToPhase: (phase) => {
    let g = get().game;
    g = setPhase(g, phase);
    const action = createAction(g, g.activePlayerId, 'CHANGE_PHASE', `Jump to: ${phase}`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  advanceTurn: () => {
    let g = get().game;
    g = nextTurn(g);
    const active = g.players.find(p => p.id === g.activePlayerId);
    const action = createAction(g, g.activePlayerId, 'CHANGE_PHASE', `Turn ${g.turn} — ${active?.name || '?'}`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  passPriority: () => {
    const g = get().game;
    const ids = g.players.map(p => p.id);
    const nextIdx = (ids.indexOf(g.priorityPlayerId) + 1) % ids.length;
    const nextId = ids[nextIdx];
    const newPlayers = g.players.map((p, i) => ({ ...p, hasPriority: i === nextIdx }));
    const action = createAction(g, nextId, 'PASS_PRIORITY', 'Priority passed');
    set({ game: { ...g, priorityPlayerId: nextId, players: newPlayers, actionLog: [...g.actionLog, action] } });
  },

  // ── Stack ─────────────────────────────────────────────────────────────────

  putOnStack: (item) => {
    let g = get().game;
    const full: StackObject = { ...item, id: uuid(), timestamp: Date.now() };
    g = pushToStack(g, full);
    const action = createAction(g, item.controllerId, 'PUT_ON_STACK', `${item.sourceName} on stack`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  resolveStack: () => {
    let g = get().game;
    if (!g.stack.length) return;
    const top = g.stack[0];

    if (top.sourceInstanceId) {
      const card = g.cards[top.sourceInstanceId];
      if (card) {
        const isPerm = card.definition.cardTypes.some(t =>
          ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'].includes(t));
        const dest = isPerm ? 'battlefield' : 'graveyard';
        g = moveCard(g, top.sourceInstanceId, dest);
        if (dest === 'battlefield') {
          const triggers = detectETBTriggers(g, g.cards[top.sourceInstanceId]);
          const newTriggers: TriggerItem[] = triggers.map(t => ({
            id: uuid(), sourceInstanceId: t.sourceCard.instanceId,
            sourceName: t.sourceCard.definition.name, controllerId: t.sourceCard.controllerId,
            text: t.triggerText, triggerType: t.triggerType,
            acknowledged: false, missed: false, timestamp: Date.now(),
          }));
          g = { ...g, triggerQueue: [...g.triggerQueue, ...newTriggers] };
        }
      }
    }
    g = resolveTopStack(g);
    const action = createAction(g, g.activePlayerId, 'RESOLVE_STACK', `${top.sourceName} resolved`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  counterSpell: (stackObjectId) => {
    let g = get().game;
    const obj = g.stack.find(s => s.id === stackObjectId);
    if (!obj) return;
    g = { ...g, stack: g.stack.filter(s => s.id !== stackObjectId) };
    if (obj.sourceInstanceId) g = moveCard(g, obj.sourceInstanceId, 'graveyard');
    const action = createAction(g, g.activePlayerId, 'COUNTER_SPELL', `${obj.sourceName} countered`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  // ── Triggers ──────────────────────────────────────────────────────────────

  addTriggerToQueue: (trigger) => {
    const g = get().game;
    const full: TriggerItem = { ...trigger, id: uuid(), timestamp: Date.now(), acknowledged: false, missed: false };
    set({ game: addTrigger(g, full) });
  },

  ackTrigger: (triggerId) => {
    set({ game: acknowledgeTrigger(get().game, triggerId) });
  },

  moveTriggerUp: (triggerId) => {
    const g = get().game;
    const queue = [...g.triggerQueue];
    const idx = queue.findIndex(t => t.id === triggerId);
    if (idx <= 0) return;
    [queue[idx - 1], queue[idx]] = [queue[idx], queue[idx - 1]];
    set({ game: { ...g, triggerQueue: queue, lastUpdatedAt: Date.now() } });
  },

  moveTriggerDown: (triggerId) => {
    const g = get().game;
    const queue = [...g.triggerQueue];
    const idx = queue.findIndex(t => t.id === triggerId);
    if (idx < 0 || idx >= queue.length - 1) return;
    [queue[idx], queue[idx + 1]] = [queue[idx + 1], queue[idx]];
    set({ game: { ...g, triggerQueue: queue, lastUpdatedAt: Date.now() } });
  },

  markTriggerMissed: (triggerId) => {
    const g = get().game;
    const queue = g.triggerQueue.map(t =>
      t.id === triggerId ? { ...t, missed: true, acknowledged: true } : t
    );
    const action = createAction(g, g.activePlayerId, 'OTHER',
      `Trigger missed: ${g.triggerQueue.find(t => t.id === triggerId)?.sourceName ?? triggerId}`);
    set({ game: { ...g, triggerQueue: queue, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  // ── Combat ────────────────────────────────────────────────────────────────

  enterCombat: () => {
    let g = get().game;
    g = {
      ...g,
      combat: { ...g.combat, active: true, attackingPlayerId: g.activePlayerId, attackers: [], blockers: [] },
    };
    g = setPhase(g, 'declareAttackers');
    const action = createAction(g, g.activePlayerId, 'CHANGE_PHASE', 'Entering combat');
    set({ game: { ...g, actionLog: [...g.actionLog, action] }, ui: { ...get().ui, combatMode: true } });
  },

  declareAttack: (attackerInstanceId, targetPlayerId) => {
    let g = get().game;
    const check = checkAttackLegality(g, attackerInstanceId);
    g = declareAttacker(g, attackerInstanceId, targetPlayerId);
    const card = g.cards[attackerInstanceId];
    const action = createAction(g, g.activePlayerId, 'DECLARE_ATTACKER',
      `${card?.definition.name} attacks ${targetPlayerId}`, [attackerInstanceId], {}, check.flags);
    g = { ...g, actionLog: [...g.actionLog, action] };
    const newMsgs = check.flags.map(f => makeMsg(g, f));
    set({ game: g, ui: { ...get().ui, assistantMessages: [...get().ui.assistantMessages, ...newMsgs] } });
  },

  declareMyriadAttack: (attackerInstanceId, declaredDefenderId, copiesPerOpponent) => {
    let g = get().game;
    const attackerCard = g.cards[attackerInstanceId];
    if (!attackerCard) return [];

    const { newState, copies } = triggerMyriad(g, attackerInstanceId, declaredDefenderId, copiesPerOpponent);
    g = newState;

    // Log myriad trigger
    const opponentNames = copies
      .map(c => g.players.find(p => p.id === c.targetPlayerId)?.name ?? c.targetPlayerId)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ');
    const copyCount = copies.length;
    const action = createAction(
      g, g.activePlayerId, 'DECLARE_ATTACKER',
      `Myriad — ${attackerCard.definition.name} creates ${copyCount} cop${copyCount === 1 ? 'y' : 'ies'} attacking ${opponentNames}`,
      [attackerInstanceId],
      { myriadCopies: copies },
    );
    g = { ...g, actionLog: [...g.actionLog, action] };

    // Commander damage note: flag if attacker is a commander (copies track separately)
    const isCommander = g.players.some(p => p.commanders.includes(attackerInstanceId));
    const msgs = isCommander && g.config.useCommanderDamage
      ? [makeMsg(g, {
          id: uuid(), severity: 'info', label: 'Info',
          text: `${attackerCard.definition.name} is a commander — each Myriad copy tracks commander damage to its target independently (CR 702.116, 903.17).`,
          ruleRef: 'CR 702.116',
        })]
      : [];

    set({ game: g, ui: { ...get().ui, assistantMessages: [...get().ui.assistantMessages, ...msgs] } });
    return copies;
  },

  declareBlock: (blockerInstanceId, attackerInstanceId) => {
    let g = get().game;
    const check = checkBlockLegality(g, blockerInstanceId, attackerInstanceId);
    g = declareBlocker(g, blockerInstanceId, attackerInstanceId);
    const action = createAction(g, g.activePlayerId, 'DECLARE_BLOCKER',
      `Block declared`, [blockerInstanceId, attackerInstanceId], {}, check.flags);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  resolveCombatDamage: () => {
    let g = get().game;

    // Helper: does a card have a keyword (checks keywords array + oracle text)
    const hasKw = (card: (typeof g.cards)[string], kw: string) => {
      const lc = kw.toLowerCase();
      return card.definition.keywords.some(k => k.toLowerCase() === lc) ||
        card.definition.oracleText.toLowerCase().includes(lc);
    };

    // CR 510.1–510.4: First Strike / Double Strike create a separate damage step
    // Step 1 — First-strike & double-strike creatures deal damage
    // Step 2 — Normal + double-strike creatures deal damage
    const applyDamageForAttackers = (attackers: typeof g.combat.attackers, firstStrikeStep: boolean) => {
      for (const attacker of attackers) {
        const attackerCard = g.cards[attacker.instanceId];
        if (!attackerCard) continue;
        const hasFirstStrike = hasKw(attackerCard, 'First Strike');
        const hasDoubleStrike = hasKw(attackerCard, 'Double Strike');

        // Which steps this attacker deals damage in
        const dealsInFirstStep = hasFirstStrike || hasDoubleStrike;
        const dealsInSecondStep = !hasFirstStrike || hasDoubleStrike;
        // CR 510: attackerDealsNow — whether THIS attacker deals damage in this step
        const attackerDealsNow = firstStrikeStep ? dealsInFirstStep : dealsInSecondStep;

        const blockers = g.combat.blockers
          .filter(b => b.blockedAttacker === attacker.instanceId)
          .map(b => g.cards[b.instanceId]).filter(Boolean) as typeof attackerCard[];

        // Unblocked — skip if attacker doesn't deal in this step
        if (blockers.length === 0) {
          if (!attackerDealsNow) continue;
          // Unblocked — deal damage to target player
          const power = parseInt(attackerCard.definition.power || '0', 10) || 0;
          const hasInfect = hasKw(attackerCard, 'Infect');
          const hasPoison = hasKw(attackerCard, 'Poisonous');
          const hasLifelink = hasKw(attackerCard, 'Lifelink');
          if (hasInfect) {
            g = { ...g, players: g.players.map(p =>
              p.id === attacker.targetPlayerId ? { ...p, poisonCounters: p.poisonCounters + power } : p
            )};
          } else {
            g = modifyLife(g, attacker.targetPlayerId, -power);
          }
          // Lifelink — controller gains life equal to damage dealt
          if (hasLifelink && power > 0) {
            g = modifyLife(g, attackerCard.controllerId, power);
          }
          // Commander damage tracking
          const isCommander = g.players.some(p => p.commanders.includes(attacker.instanceId));
          if (isCommander && g.config.useCommanderDamage && !hasInfect && power > 0) {
            g = addCommanderDamage(g, attacker.targetPlayerId, attacker.instanceId, power);
          }
        } else {
          // Blocked — assign damage to/from blockers
          // CR 510: Attacker and blocker damage is INDEPENDENT.
          // A blocker without FS deals in the normal step even if its attacker has FS.
          const attackerPower = parseInt(attackerCard.definition.power || '0', 10) || 0;
          const hasDeathtouch = hasKw(attackerCard, 'Deathtouch');
          const hasLifelink = hasKw(attackerCard, 'Lifelink');
          let totalDamageDealt = 0;

          for (const blocker of blockers) {
            const blkDealsInFirstStep = hasKw(blocker, 'First Strike') || hasKw(blocker, 'Double Strike');
            const blkDealsInSecondStep = !hasKw(blocker, 'First Strike') || hasKw(blocker, 'Double Strike');
            const blockerDealsNow = firstStrikeStep ? blkDealsInFirstStep : blkDealsInSecondStep;

            // Attacker marks damage on blocker (only when attacker deals in this step)
            if (attackerDealsNow) {
              const dmgToBlocker = hasDeathtouch ? 1 : attackerPower;
              g = { ...g, cards: { ...g.cards,
                [blocker.instanceId]: {
                  ...g.cards[blocker.instanceId],
                  markedForDamage: (g.cards[blocker.instanceId].markedForDamage || 0) + dmgToBlocker,
                },
              }};
              totalDamageDealt += dmgToBlocker;
            }

            // Blocker marks damage on attacker (independently per CR 510)
            if (blockerDealsNow) {
              const blockerPower = parseInt(blocker.definition.power || '0', 10) || 0;
              const blockerDeathtouch = hasKw(blocker, 'Deathtouch');
              const dmgToAttacker = blockerDeathtouch ? 1 : blockerPower;
              g = { ...g, cards: { ...g.cards,
                [attacker.instanceId]: {
                  ...g.cards[attacker.instanceId],
                  markedForDamage: (g.cards[attacker.instanceId].markedForDamage || 0) + dmgToAttacker,
                },
              }};
              // Blocker lifelink
              if (hasKw(blocker, 'Lifelink') && blockerPower > 0) {
                g = modifyLife(g, blocker.controllerId, blockerPower);
              }
            }
          }

          // Attacker lifelink — gains life for damage it dealt to blockers
          if (hasLifelink && totalDamageDealt > 0) {
            g = modifyLife(g, attackerCard.controllerId, totalDamageDealt);
          }
        }
      }
    };

    // Determine if any first/double strike creatures are in combat
    const anyFirstStrike = g.combat.attackers.some(a => {
      const c = g.cards[a.instanceId];
      return c && (hasKw(c, 'First Strike') || hasKw(c, 'Double Strike'));
    }) || g.combat.blockers.some(b => {
      const c = g.cards[b.instanceId];
      return c && (hasKw(c, 'First Strike') || hasKw(c, 'Double Strike'));
    });

    if (anyFirstStrike) {
      // First-strike damage step
      applyDamageForAttackers(g.combat.attackers, true);
      const { newState: afterFirstStrike, flags: fs1Flags } = checkStateBasedActions(g);
      g = afterFirstStrike;
      const firstStrikeAction = createAction(g, g.activePlayerId, 'CHANGE_PHASE', 'First strike damage step resolved');
      g = { ...g, actionLog: [...g.actionLog, firstStrikeAction] };
      const fs1Msgs = fs1Flags.map(f => makeMsg(g, f));
      set({ game: g, ui: { ...get().ui, assistantMessages: [...get().ui.assistantMessages, ...fs1Msgs] } });
      g = get().game; // re-read after state-based actions may have removed creatures
    }

    // Regular (or double-strike second) damage step
    applyDamageForAttackers(g.combat.attackers, false);

    const { newState, flags } = checkStateBasedActions(g);
    g = newState;
    const action = createAction(g, g.activePlayerId, 'CHANGE_PHASE', 'Combat damage resolved');
    g = { ...g, actionLog: [...g.actionLog, action] };
    const newMsgs = flags.map(f => makeMsg(g, f));
    set({ game: g, ui: { ...get().ui, assistantMessages: [...get().ui.assistantMessages, ...newMsgs] } });
  },

  endCombat: () => {
    let g = get().game;

    // CR 702.116d — Exile Myriad token copies at end of combat (before resetting combat state)
    if (g.combat.hasMyriad && g.combat.myriadCopies.length > 0) {
      const myriadLog = createAction(
        g, g.activePlayerId, 'MOVE_CARD',
        `Myriad copies exiled (${g.combat.myriadCopies.length} token${g.combat.myriadCopies.length !== 1 ? 's' : ''}) — CR 702.116d`,
        g.combat.myriadCopies.map(m => m.copyId),
      );
      g = { ...g, actionLog: [...g.actionLog, myriadLog] };
      g = exileMyriadCopies(g);
    }

    // Clear combat roles from remaining cards
    const newCards = { ...g.cards };
    for (const [id, card] of Object.entries(newCards)) {
      if (card.combatRole !== 'none') {
        newCards[id] = { ...card, combatRole: 'none', attackTarget: undefined, blockTarget: [] };
      }
    }
    g = {
      ...g,
      cards: newCards,
      combat: { active: false, attackingPlayerId: '', attackers: [], blockers: [], combatPhase: 'none', hasMyriad: false, myriadCopies: [] },
    };
    g = setPhase(g, 'main2');
    set({ game: g, ui: { ...get().ui, combatMode: false } });
  },

  runStateBasedActions: () => {
    const { newState, flags } = checkStateBasedActions(get().game);
    const newMsgs = flags.map(f => makeMsg(newState, f));
    set({ game: newState, ui: { ...get().ui, assistantMessages: [...get().ui.assistantMessages, ...newMsgs] } });
  },

  undo: () => { set({ game: undoAction(get().game) }); },

  // ── UI ────────────────────────────────────────────────────────────────────

  setSelectedCard: (id) => set(s => ({ ui: { ...s.ui, selectedCardId: id } })),
  setHoveredCard: (id) => set(s => ({ ui: { ...s.ui, hoveredCardId: id } })),
  setFocusedPlayer: (id) => set(s => ({ ui: { ...s.ui, focusedPlayerId: id } })),
  setRightPanelTab: (tab) => set(s => ({ ui: { ...s.ui, rightPanelTab: tab } })),
  toggleLeftPanel: () => set(s => ({ ui: { ...s.ui, leftPanelOpen: !s.ui.leftPanelOpen } })),
  toggleRightPanel: () => set(s => ({ ui: { ...s.ui, rightPanelOpen: !s.ui.rightPanelOpen } })),
  openZoneDrawer: (zone, playerId) => set(s => ({ ui: { ...s.ui, zoneDrawer: { zone, playerId } } })),
  closeZoneDrawer: () => set(s => ({ ui: { ...s.ui, zoneDrawer: null } })),
  openCardContextMenu: (instanceId, x, y) => set(s => ({ ui: { ...s.ui, cardContextMenu: { instanceId, x, y } } })),
  closeCardContextMenu: () => set(s => ({ ui: { ...s.ui, cardContextMenu: null } })),
  setCardPreview: (id) => set(s => ({ ui: { ...s.ui, cardPreview: id } })),
  setCardSearchOpen: (open) => set(s => ({ ui: { ...s.ui, cardSearchOpen: open } })),
  setReplayOpen: (open) => set(s => ({ ui: { ...s.ui, replayOpen: open } })),
  setProfileOpen: (open) => set(s => ({ ui: { ...s.ui, profileOpen: open } })),
  saveReplay: (name) => {
    const { game } = get();
    const replay = createReplay(game, name);
    saveReplayToStorage(replay);
  },
  setJudgeMode: (on) => set(s => ({ ui: { ...s.ui, judgeMode: on } })),
  toggleBattlefieldView: () => set(s => ({ ui: { ...s.ui, battlefieldView: s.ui.battlefieldView === 'normal' ? 'overview' : 'normal' } })),
  toggleCombatMode: () => set(s => ({ ui: { ...s.ui, combatMode: !s.ui.combatMode } })),
  setLobbyOpen: (open) => set(s => ({ ui: { ...s.ui, lobbyOpen: open } })),
  setDeckBuilderOpen: (open) => set(s => ({ ui: { ...s.ui, deckBuilderOpen: open } })),
  addAssistantMessage: (msg) => set(s => {
    const g = s.game;
    const msgs = [...s.ui.assistantMessages, { ...msg, id: uuid(), timestamp: Date.now(), turn: g.turn, phase: g.phase }];
    return { ui: { ...s.ui, assistantMessages: msgs.slice(-200) } };
  }),

  // ── Decks ─────────────────────────────────────────────────────────────────

  loadDecks: () => set({ decks: loadDecksFromStorage() }),
  saveDeckToStorage: (deck) => {
    saveDeck(deck);
    set({ decks: loadDecksFromStorage() });
  },

  // ── Scry / Surveil / Cycle / Cast-from-zone / Reanimate ──────────────────

  scryCards: (playerId, count) => {
    const { game } = get();
    const player = game.players.find(p => p.id === playerId);
    if (!player || player.library.length === 0) return;
    const n = Math.min(count, player.library.length);
    const action = createAction(game, playerId, 'SCRY',
      `Scry ${count} — look at top ${n} card(s)`);
    set({
      game: { ...game, actionLog: [...game.actionLog, action] },
      ui: { ...get().ui, zoneDrawer: { zone: 'library', playerId } },
    });
  },

  surveilCards: (playerId, count) => {
    const { game } = get();
    const player = game.players.find(p => p.id === playerId);
    if (!player || player.library.length === 0) return;
    const n = Math.min(count, player.library.length);
    const action = createAction(game, playerId, 'SURVEIL',
      `Surveil ${count} — top ${n} card(s): keep or mill`);
    set({
      game: { ...game, actionLog: [...game.actionLog, action] },
      ui: { ...get().ui, zoneDrawer: { zone: 'library', playerId } },
    });
  },

  cycleCard: (playerId, instanceId) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card || card.zone !== 'hand') return;
    g = discardCard(g, playerId, instanceId);
    g = drawCards(g, playerId, 1);
    const action = createAction(g, playerId, 'CYCLE',
      `Cycled ${card.definition.name} — drew 1`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  castFromZone: (playerId, instanceId, fromZone) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    const zoneName = fromZone === 'graveyard' ? 'graveyard'
      : fromZone === 'exile' ? 'exile'
      : fromZone === 'command' ? 'command zone' : fromZone;
    const isPermanent = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle']
      .some(t => card.definition.cardTypes.includes(t));
    // Update controller then move
    g = { ...g, cards: { ...g.cards, [instanceId]: { ...g.cards[instanceId], controllerId: playerId } } };
    g = moveCard(g, instanceId, isPermanent ? 'battlefield' : 'graveyard');
    const action = createAction(g, playerId, 'CAST',
      `Cast ${card.definition.name} from ${zoneName}`, [instanceId]);
    const flags = checkCastLegality(g, playerId, instanceId);
    const newMsgs = flags.map(f => makeMsg(g, f));
    g = { ...g, actionLog: [...g.actionLog, action] };
    set({ game: g, ui: { ...get().ui, assistantMessages: [...get().ui.assistantMessages, ...newMsgs].slice(-200) } });
  },

  reanimateCard: (instanceId, toControllerId) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    g = { ...g, cards: { ...g.cards, [instanceId]: { ...g.cards[instanceId], controllerId: toControllerId } } };
    g = moveCard(g, instanceId, 'battlefield');
    const player = g.players.find(p => p.id === toControllerId);
    const action = createAction(g, toControllerId, 'REANIMATE',
      `${player?.name || toControllerId} reanimated ${card.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  logAction: (playerId, type, text) => {
    const g = get().game;
    const action = createAction(g, playerId, type as any, text);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },
}));

// ─── Broadcast subscriber ─────────────────────────────────────────────────────────────
// Any time game state changes AND we’re in a room, push to Firebase.
// This is outside the store so it runs once at module load time —
// no need to patch every individual action.
useGameStore.subscribe(
  (state) => state.game,
  (game, prevGame) => {
    const { multiplayer } = useGameStore.getState();
    // Only broadcast if we’re in a room and it’s a real change
    if (
      multiplayer.status === 'host' ||
      multiplayer.status === 'joined'
    ) {
      // Don’t broadcast if this was an incoming remote update (same lastUpdatedAt)
      if (game.lastUpdatedAt !== prevGame.lastUpdatedAt) {
        broadcastState(game);
      }
    }
  },
  { equalityFn: (a, b) => a === b },
);
