// ─── Zustand Game Store ───────────────────────────────────────────────────────
import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type {
  GameState, Player, CardState, Phase, StackObject, TriggerItem,
  AssistantFlag, Deck, GameConfig, ActionRecord, PlayerAvatarImage, CardDefinition
} from '../types/game';
import {
  createEmptyGameState, createPlayer, createAction, moveCard, tapCard,
  addCounter, removeCounter, modifyLife, addCommanderDamage,
  nextPhase, setPhase, nextTurn, pushToStack, resolveTopStack,
  addTrigger, acknowledgeTrigger, drawCards, discardCard, createToken,
  createTokens, checkStateBasedActions, declareAttacker, declareBlocker, undoAction,
  loadDeckIntoPlayer, createDefaultGameConfig, createCardState,
  triggerMyriad, clearCombatAssignments,
} from '../engine/gameEngine';
import {
  checkCastLegality, checkTapLegality, checkAttackLegality, checkBlockLegality,
  detectAttackTriggers, detectCastTriggers, detectCombatDamageTriggers, detectETBTriggers, detectUpkeepTriggers, getActiveModifiers,
  type DetectedTrigger,
} from '../engine/assistantEngine';
import { getEffectiveCardDefinition, getEffectiveCardName, getEffectiveOracleText } from '../engine/cardFaces';
import { saveDeck, loadDecksFromStorage, normalizeCommanderDeck } from '../engine/deckImport';
import { getBannedReason } from '../data/cardDatabase';
import { createReplay, saveReplayToStorage } from '../engine/replayEngine';
import { getActiveProfile } from '../engine/profileStorage';
import {
  initMultiplayer, createRoom, joinRoom, leaveRoom,
  broadcastState, updatePresence, kickPeer, getRoomCode, getPeerId, getIsHost,
  getSyncStatus, isConfigured,
  type RoomDeckSummary, type RoomPresence, type SyncStatus,
} from '../engine/multiplayerSync';

// ─── UI State ─────────────────────────────────────────────────────────────────

export interface UIState {
  screen: 'lobby' | 'game';
  selectedCardId: string | null;
  hoveredCardId: string | null;
  focusedPlayerId: string | null;
  rightPanelTab: 'assistant' | 'stack' | 'log' | 'triggers' | 'rules' | 'votes' | 'debug';
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  combatMode: boolean;
  deckBuilderOpen: boolean;
  lobbyOpen: boolean;
  zoneDrawer: {
    zone: 'graveyard' | 'exile' | 'library' | 'hand';
    playerId: string;
    mode?: 'normal' | 'scry' | 'surveil' | 'lookTop' | 'search';
    limit?: number;
    viewerId?: string;
    private?: boolean;
  } | null;
  cardContextMenu: { instanceId: string; x: number; y: number } | null;
  cardPreview: string | null;
  cardPreviewAnchor: { x: number; y: number } | null;
  searchQuery: string;
  showTokenEditor: boolean;
  cardSearchOpen: boolean;
  replayOpen: boolean;
  profileOpen: boolean;
  judgeMode: boolean;
  battlefieldView: 'normal' | 'overview';
  assistantMessages: AssistantMessage[];
  actionFilter: string;
  panelSizes: {
    left: number;
    right: number;
    deckBuilder: number;
  };
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

const PANEL_SIZES_KEY = 'mtg_sim_panel_sizes';
const DEFAULT_PANEL_SIZES: UIState['panelSizes'] = {
  left: 220,
  right: 280,
  deckBuilder: 430,
};
const MAX_TOKEN_BATCH = 250;

function clampPanelSize(panel: keyof UIState['panelSizes'], value: number): number {
  const limits: Record<keyof UIState['panelSizes'], [number, number]> = {
    left: [170, 360],
    right: [220, 460],
    deckBuilder: [320, 620],
  };
  const [min, max] = limits[panel];
  return Math.max(min, Math.min(max, Math.round(value)));
}

function loadPanelSizes(): UIState['panelSizes'] {
  if (typeof localStorage === 'undefined') return DEFAULT_PANEL_SIZES;
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_SIZES_KEY) || '{}') as Partial<UIState['panelSizes']>;
    return {
      left: clampPanelSize('left', parsed.left ?? DEFAULT_PANEL_SIZES.left),
      right: clampPanelSize('right', parsed.right ?? DEFAULT_PANEL_SIZES.right),
      deckBuilder: clampPanelSize('deckBuilder', parsed.deckBuilder ?? DEFAULT_PANEL_SIZES.deckBuilder),
    };
  } catch {
    return DEFAULT_PANEL_SIZES;
  }
}

function savePanelSizes(sizes: UIState['panelSizes']): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Storage may be unavailable; resizing should still work for this session.
  }
}

const DEFAULT_UI: UIState = {
  screen: 'lobby',
  selectedCardId: null,
  hoveredCardId: null,
  focusedPlayerId: null,
  rightPanelTab: 'stack',
  leftPanelOpen: true,
  rightPanelOpen: true,
  combatMode: false,
  deckBuilderOpen: false,
  lobbyOpen: true,
  zoneDrawer: null,
  cardContextMenu: null,
  cardPreview: null,
  cardPreviewAnchor: null,
  searchQuery: '',
  showTokenEditor: false,
  cardSearchOpen: false,
  replayOpen: false,
  profileOpen: false,
  judgeMode: false,
  battlefieldView: 'normal',
  assistantMessages: [],
  actionFilter: '',
  panelSizes: loadPanelSizes(),
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
    avatar?: { initial?: string; style?: Player['avatarStyle']; image?: PlayerAvatarImage },
    asSpectator?: boolean,
  ) => Promise<string>;
  joinMultiplayerRoom: (
    code: string,
    peerName: string,
    peerColor: string,
    seatIndex: number,
    avatar?: { initial?: string; style?: Player['avatarStyle']; image?: PlayerAvatarImage },
    asSpectator?: boolean,
  ) => Promise<void>;
  leaveMultiplayerRoom: () => void;
  kickMultiplayerPeer: (peerId: string) => void;
  setMultiplayerStatus: (status: SyncStatus) => void;
  setMultiplayerPeers: (peers: Record<string, RoomPresence>) => void;
  updateMultiplayerPresence: (fields: Partial<RoomPresence>) => void;

  initGame: (config: GameConfig, players: {
    id: string;
    name: string;
    color: string;
    avatarInitial?: string;
    avatarStyle?: Player['avatarStyle'];
    avatarImage?: PlayerAvatarImage;
  }[]) => void;
  prepareLoadedTableGame: (config: GameConfig, players: {
    id: string;
    name: string;
    color: string;
    avatarInitial?: string;
    avatarStyle?: Player['avatarStyle'];
    avatarImage?: PlayerAvatarImage;
  }[]) => void;
  loadDeck: (playerId: string, deck: Deck) => Promise<void>;
  clearLoadedDeck: (playerId: string) => void;
  addPracticeDummy: () => void;
  removePracticeDummy: (playerId: string) => void;
  startGame: () => void;
  resetGame: () => void;

  castCard: (castingPlayerId: string, cardInstanceId: string, targets?: { ids?: string[]; labels?: string[] }) => void;
  playLand: (playerId: string, cardInstanceId: string, faceIndex?: number) => void;
  moveCardToZone: (instanceId: string, toZone: CardState['zone'], toController?: string) => void;
  tapCard: (instanceId: string) => void;
  untapCard: (instanceId: string) => void;
  tapCards: (instanceIds: string[]) => void;
  untapCards: (instanceIds: string[]) => void;
  tapAllLands: (playerId: string) => void;
  untapAll: (playerId: string) => void;
  addCounterToCard: (instanceId: string, counterType: string, amount?: number) => void;
  removeCounterFromCard: (instanceId: string, counterType: string, amount?: number) => void;
  attachCard: (attachmentId: string, targetId: string) => void;
  detachCard: (attachmentId: string) => void;
  transformCard: (instanceId: string) => void;
  createTokenCard: (controllerId: string, tokenDef: Parameters<typeof createToken>[2]) => void;
  createTokenCards: (controllerId: string, tokenDef: Parameters<typeof createToken>[2], count?: number) => string[];

  modifyPlayerLife: (playerId: string, delta: number) => void;
  addCommanderDmg: (receivingPlayerId: string, commanderInstanceId: string, damage: number) => void;
  addPoisonCounter: (playerId: string, amount?: number) => void;
  drawCard: (playerId: string, count?: number) => void;
  discardFromHand: (playerId: string, instanceId: string) => void;
  reorderHand: (playerId: string, orderedInstanceIds: string[]) => void;
  sortHand: (playerId: string) => void;
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
  ackAllTriggers: () => void;
  applyTriggerShortcut: (triggerId: string) => void;
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
  setPanelSize: (panel: keyof UIState['panelSizes'], size: number) => void;
  resetPanelSizes: () => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  openZoneDrawer: (
    zone: 'graveyard' | 'exile' | 'library' | 'hand',
    playerId: string,
    options?: Omit<NonNullable<UIState['zoneDrawer']>, 'zone' | 'playerId'>
  ) => void;
  closeZoneDrawer: () => void;
  openCardContextMenu: (instanceId: string, x: number, y: number) => void;
  closeCardContextMenu: () => void;
  setCardPreview: (instanceId: string | null, anchor?: { x: number; y: number } | null) => void;
  setCardPreviewAnchor: (anchor: { x: number; y: number } | null) => void;
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
  /** Look at only the top N cards allowed by an effect */
  lookAtTopCards: (playerId: string, count: number, viewerId?: string) => void;
  /** Dredge N — replacement for draw: mill N, return card from GY to hand */
  dredgeCard: (playerId: string, instanceId: string) => boolean;
  /** Proliferate chosen permanents/players, or all eligible by default */
  proliferate: (controllerId: string, choices?: { cardIds?: string[]; playerIds?: string[] }) => void;
  /** Put a library card on top or bottom while preserving hidden library order */
  reorderLibraryCard: (playerId: string, instanceId: string, placement: 'top' | 'bottom') => void;
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

function getAssistantMode(ui: UIState): Player['settings']['assistantMode'] {
  if (ui.judgeMode) return 'ON';
  if (typeof localStorage === 'undefined') return 'ON';
  return getActiveProfile()?.assistantMode ?? 'ON';
}

function getAssistantVerbosity(): Player['settings']['assistantVerbosity'] {
  if (typeof localStorage === 'undefined') return 'normal';
  return getActiveProfile()?.assistantVerbosity ?? 'normal';
}

function filterAssistantFlags(flags: AssistantFlag[], ui: UIState): AssistantFlag[] {
  const mode = getAssistantMode(ui);
  if (mode === 'OFF') return [];

  const verbosity = getAssistantVerbosity();
  return flags.filter(flag => {
    if (mode === 'LIMITED') {
      return flag.severity === 'flagged' ||
        flag.severity === 'error' ||
        flag.severity === 'needsReview' ||
        flag.label === 'Missed Trigger' ||
        flag.label === 'State-Based';
    }
    if (verbosity === 'minimal') {
      return flag.severity !== 'legal' && flag.severity !== 'info';
    }
    if (verbosity === 'normal') {
      return flag.severity !== 'legal';
    }
    return true;
  });
}

function withAssistantMessages(ui: UIState, game: GameState, flags: AssistantFlag[]): UIState {
  const visibleFlags = filterAssistantFlags(flags, ui);
  if (visibleFlags.length === 0) return ui;
  return {
    ...ui,
    rightPanelOpen: true,
    assistantMessages: [...ui.assistantMessages, ...visibleFlags.map(f => makeMsg(game, f))].slice(-200),
  };
}

function hasApprovedHouseRule(game: GameState, id: string): boolean {
  return game.config.houseRules.some(rule => rule.id === id && rule.approved);
}

function getLoadedBannedCardFlags(game: GameState, playerId: string): AssistantFlag[] {
  if (hasApprovedHouseRule(game, 'allow_banned_cards')) return [];
  const player = game.players.find(item => item.id === playerId);
  if (!player) return [];

  const cardIds = [
    ...player.commandZone,
    ...player.library,
    ...player.hand,
    ...player.sideboard,
    ...player.maybeboard,
  ];
  const bannedCards = new Map<string, string>();
  for (const id of cardIds) {
    const card = game.cards[id];
    if (!card) continue;
    const reason = getBannedReason(card.definition);
    if (reason) bannedCards.set(card.definition.name, reason);
  }

  if (bannedCards.size === 0) return [];
  const names = [...bannedCards.keys()].join(', ');
  return [{
    id: uuid(),
    severity: 'flagged',
    label: 'Flagged',
    text: `${player.name} loaded banned Commander card${bannedCards.size === 1 ? '' : 's'}: ${names}. The game can continue, but this should be Rule Zero approved or enabled with Allow Banned Cards.`,
    ruleRef: 'Commander ban list',
  }];
}

function addReviewData(
  data: Record<string, unknown>,
  flags: AssistantFlag[]
): Record<string, unknown> {
  if (flags.length === 0) return data;
  const reviewTypes = [...new Set(flags.map(flag => {
    if (flag.label === 'Missed Trigger') return 'missed-trigger';
    if (flag.label === 'Needs Review') return 'judge-review';
    if (flag.label === 'Flagged') return 'illegal-action';
    if (flag.label === 'State-Based') return 'state-based';
    return flag.severity;
  }))];
  return {
    ...data,
    reviewTypes,
    assistantSummary: flags.map(flag => flag.text),
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

function appendDetectedTriggersToStack(
  game: GameState,
  triggers: DetectedTrigger[],
  actorId: string,
  label: string
): GameState {
  if (triggers.length === 0) return game;
  const triggerItems: TriggerItem[] = triggers.map(t => {
    const id = uuid();
    return {
      id,
      sourceInstanceId: t.sourceCard.instanceId,
      sourceName: getEffectiveCardName(t.sourceCard),
      controllerId: t.sourceCard.controllerId,
      text: t.triggerText,
      triggerType: t.triggerType,
      effect: t.effect,
      data: t.data,
      acknowledged: false,
      missed: false,
      timestamp: Date.now(),
    };
  });
  const stackObjects: StackObject[] = triggerItems.map(t => ({
    id: uuid(),
    type: 'triggered',
    sourceName: t.sourceName,
    controllerId: t.controllerId,
    text: t.text,
    timestamp: Date.now(),
    parentId: t.id,
  }));
  const action = createAction(
    game,
    actorId,
    'PUT_ON_STACK',
    `${triggerItems.length} ${label} trigger${triggerItems.length === 1 ? '' : 's'} added to the stack.`,
    triggerItems.flatMap(t => t.sourceInstanceId ? [t.sourceInstanceId] : []),
    { triggerIds: triggerItems.map(t => t.id) },
  );
  return {
    ...game,
    stack: [...stackObjects, ...game.stack],
    triggerQueue: [...game.triggerQueue, ...triggerItems],
    actionLog: [...game.actionLog, action],
    lastUpdatedAt: Date.now(),
  };
}

const HAND_TYPE_ORDER = ['Land', 'Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Instant', 'Sorcery'] as const;
const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
const PRACTICE_DUMMY_PREFIX = 'practice-dummy-';
const MAX_PRACTICE_DUMMIES = 3;

function normalizeMechanicCount(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(Math.floor(value), max));
}

function getDredgeValue(card: CardState): number | null {
  const match = card.definition.oracleText.match(/\bdredge\s+(\d+)\b/i);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function playerHasCounters(player: Player): boolean {
  return player.poisonCounters > 0 || player.energyCounters > 0 || player.experienceCounters > 0;
}

function cardHasCounters(card: CardState): boolean {
  return card.counters.some(counter => counter.count > 0);
}

const PRACTICE_DUMMY_CREATURES: Array<Partial<CardDefinition> & { name: string; power: string; toughness: string }> = [
  {
    id: 'practice-dummy-sparring-guard',
    name: 'Sparring Guard',
    typeLine: 'Creature - Dummy Soldier',
    subTypes: ['Dummy', 'Soldier'],
    oracleText: 'A simple practice body for combat math and targeting drills.',
    power: '2',
    toughness: '3',
  },
  {
    id: 'practice-dummy-reach-sentinel',
    name: 'Reach Sentinel',
    typeLine: 'Creature - Dummy Archer',
    subTypes: ['Dummy', 'Archer'],
    oracleText: 'Reach',
    keywords: ['Reach'],
    power: '1',
    toughness: '4',
  },
];

function createPracticeDummyCreatures(playerId: string, dummyNumber: number): CardState[] {
  return PRACTICE_DUMMY_CREATURES.map((template, index) => {
    const definition: CardDefinition = {
      id: `${template.id}-${dummyNumber}-${index + 1}`,
      name: template.name,
      cmc: 0,
      typeLine: template.typeLine ?? 'Creature - Dummy',
      superTypes: [],
      cardTypes: ['Creature'],
      subTypes: template.subTypes ?? ['Dummy'],
      oracleText: template.oracleText ?? '',
      power: template.power,
      toughness: template.toughness,
      colors: template.colors ?? [],
      colorIdentity: template.colorIdentity ?? [],
      keywords: template.keywords ?? [],
      isDoubleFaced: false,
      legalities: {},
    };
    const card = createCardState(definition, playerId, 'library');
    return {
      ...card,
      zone: 'battlefield',
      summoningSick: true,
      visualX: 28 + index * 22,
      visualY: 28 + dummyNumber * 10,
    };
  });
}

function handSortKey(card: CardState): string {
  const typeIndex = HAND_TYPE_ORDER.findIndex(type => card.definition.cardTypes.includes(type));
  const safeType = typeIndex === -1 ? HAND_TYPE_ORDER.length : typeIndex;
  const colors = card.definition.colorIdentity.length
    ? card.definition.colorIdentity
    : card.definition.colors.length
      ? card.definition.colors
      : ['C'];
  const colorKey = colors
    .map(color => COLOR_ORDER.indexOf(color as typeof COLOR_ORDER[number]))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)
    .join('.');
  const mv = String(Math.round((card.definition.cmc ?? 0) * 10)).padStart(4, '0');
  return `${String(safeType).padStart(2, '0')}|${colorKey.padStart(5, '9')}|${mv}|${card.definition.name.toLowerCase()}`;
}

function sameHandMembers(current: string[], proposed: string[]): boolean {
  if (current.length !== proposed.length) return false;
  const currentSet = new Set(current);
  return proposed.every(id => currentSet.has(id)) && new Set(proposed).size === proposed.length;
}

function createRoomDeckSummary(deck: Deck): RoomDeckSummary {
  return {
    id: deck.id,
    name: deck.name || 'Loaded deck',
    cardCount: deck.cards.reduce((sum, card) => sum + card.count, 0) + deck.commanders.length,
    commanders: deck.commanders.slice(0, 2),
  };
}

function findLoadedDeckSummary(playerId: string, game: GameState, decks: Deck[]): RoomDeckSummary | undefined {
  const player = game.players.find(item => item.id === playerId);
  if (!player?.deckId || (player.library.length === 0 && player.commandZone.length === 0)) return undefined;
  const deck = decks.find(item => item.id === player.deckId);
  if (deck) return createRoomDeckSummary(deck);
  return {
    id: player.deckId,
    name: 'Loaded deck',
    cardCount: player.library.length + player.commandZone.length,
    commanders: player.commandZone
      .map(instanceId => game.cards[instanceId]?.definition.name)
      .filter((name): name is string => Boolean(name))
      .slice(0, 2),
  };
}

export function syncGamePlayerMetadataFromPresence(game: GameState, peers: Record<string, RoomPresence>): GameState {
  const seatedPeers = Object.values(peers)
    .filter(peer => peer.online && !peer.isSpectator && peer.seatIndex >= 0 && peer.seatIndex < game.players.length)
    .sort((a, b) => a.seatIndex - b.seatIndex);
  if (seatedPeers.length === 0) return game;

  let changed = false;
  const players = game.players.map(player => player);
  for (const peer of seatedPeers) {
    const player = players[peer.seatIndex];
    if (!player) continue;
    const nextPlayer = {
      ...player,
      name: peer.name,
      color: peer.color,
      avatarInitial: peer.avatarInitial ?? player.avatarInitial,
      avatarStyle: peer.avatarStyle ?? player.avatarStyle,
      avatarImage: peer.avatarImage ?? player.avatarImage,
    };
    if (
      nextPlayer.name !== player.name ||
      nextPlayer.color !== player.color ||
      nextPlayer.avatarInitial !== player.avatarInitial ||
      nextPlayer.avatarStyle !== player.avatarStyle ||
      nextPlayer.avatarImage !== player.avatarImage
    ) {
      players[peer.seatIndex] = nextPlayer;
      changed = true;
    }
  }

  return changed ? { ...game, players } : game;
}

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
        const status = get().multiplayer.status;
        const remoteHostStateIsAuthoritative = status === 'connecting' || status === 'joined' || status === 'migrating';
        if (remoteHostStateIsAuthoritative || game.lastUpdatedAt > get().game.lastUpdatedAt) {
          set({ game });
        }
      },
      // onPresenceUpdate — someone joined/left
      (peers: Record<string, RoomPresence>) => {
        set(s => {
          const game = syncGamePlayerMetadataFromPresence(s.game, peers);
          const self = s.multiplayer.peerId ? peers[s.multiplayer.peerId] : undefined;
          const localPlayerId = self
            ? self.isSpectator
              ? ''
              : (game.players[self.seatIndex]?.id ?? s.localPlayerId)
            : s.localPlayerId;
          return {
            game,
            localPlayerId,
            multiplayer: {
              ...s.multiplayer,
              peers,
              isSpectator: self?.isSpectator ?? s.multiplayer.isSpectator,
            },
          };
        });
      },
      // onStatusChange
      (status: SyncStatus) => {
        if (status === 'disconnected') {
          set({ multiplayer: { ...DEFAULT_MULTIPLAYER, configured: isConfigured() }, localPlayerId: '' });
          return;
        }
        set(s => ({
          multiplayer: {
            ...s.multiplayer,
            status,
            isHost: status === 'host' ? true : status === 'joined' || status === 'migrating' ? false : s.multiplayer.isHost,
          },
        }));
      },
    );
  },

  createMultiplayerRoom: async (hostName, hostColor, seatIndex, avatar, asSpectator = false) => {
    const { game, decks } = get();
    const peerId = crypto.randomUUID();
    const assignedSeatIndex = asSpectator ? -1 : Math.max(0, seatIndex);
    const playerId = game.players[assignedSeatIndex]?.id ?? '';
    const code = await createRoom(game, {
      peerId,
      name: hostName,
      color: hostColor,
      avatarInitial: avatar?.initial,
      avatarStyle: avatar?.style,
      avatarImage: avatar?.image,
      seatIndex: assignedSeatIndex,
      isSpectator: asSpectator,
      deck: asSpectator ? undefined : findLoadedDeckSummary(playerId, game, decks),
    });
    set(s => ({
      localPlayerId: asSpectator ? '' : (game.players[assignedSeatIndex]?.id ?? game.players[0]?.id ?? ''),
      multiplayer: {
        ...s.multiplayer,
        status: 'host',
        roomCode: code,
        peerId,
        isHost: true,
        isSpectator: asSpectator,
        configured: true,
      },
    }));
    return code;
  },

  joinMultiplayerRoom: async (code, peerName, peerColor, seatIndex, avatar, asSpectator = false) => {
    const peerId = crypto.randomUUID();
    const requestedSeatIndex = asSpectator ? -1 : Math.max(0, seatIndex);
    const current = get();
    const requestedPlayerId = current.game.players[requestedSeatIndex]?.id ?? '';
    const { game: remoteGame, peerId: joinedPeerId, peers: joinedPeers, isSpectator, seatIndex: assignedSeatIndex } = await joinRoom(code, {
      peerId,
      name: peerName,
      color: peerColor,
      avatarInitial: avatar?.initial,
      avatarStyle: avatar?.style,
      avatarImage: avatar?.image,
      seatIndex: requestedSeatIndex,
      isSpectator: asSpectator,
      deck: asSpectator ? undefined : findLoadedDeckSummary(requestedPlayerId, current.game, current.decks),
    });
    // P2P: joinRoom returns null game — joiner keeps existing local state
    // until host broadcasts the authoritative state on next game action.
    const currentGame = get().game;
    const resolvedGame = syncGamePlayerMetadataFromPresence(remoteGame ?? currentGame, joinedPeers);
    const self = joinedPeers[joinedPeerId];
    const localSeatIndex = self && !self.isSpectator ? self.seatIndex : assignedSeatIndex;
    // Spectators get no local player id — they observe only
    const playerId = (self?.isSpectator ?? isSpectator)
      ? ''
      : (resolvedGame.players[localSeatIndex]?.id ?? resolvedGame.players[0]?.id ?? '');
    set(s => ({
      game: resolvedGame,
      localPlayerId: playerId,
      multiplayer: {
        ...s.multiplayer,
        status: 'joined',
        roomCode: code.toUpperCase(),
        peerId: joinedPeerId,
        peers: joinedPeers,
        isHost: false,
        isSpectator: self?.isSpectator ?? isSpectator,
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

  kickMultiplayerPeer: (peerId) => {
    kickPeer(peerId, 'You were removed from the lobby by the host.');
  },

  setMultiplayerStatus: (status) =>
    set(s => ({ multiplayer: { ...s.multiplayer, status } })),

  setMultiplayerPeers: (peers) =>
    set(s => ({ multiplayer: { ...s.multiplayer, peers } })),

  updateMultiplayerPresence: (fields) => {
    const current = get();
    const peerId = current.multiplayer.peerId;
    const existing = peerId ? current.multiplayer.peers[peerId] : undefined;
    const nextSeatIndex = fields.isSpectator ? -1 : (fields.seatIndex ?? existing?.seatIndex ?? -1);
    const nextLocalPlayerId = fields.isSpectator
      ? ''
      : (current.game.players[nextSeatIndex]?.id ?? current.localPlayerId);
    const nextFields: Partial<RoomPresence> = {
      ...fields,
      deck: fields.isSpectator
        ? undefined
        : fields.deck ?? findLoadedDeckSummary(nextLocalPlayerId, current.game, current.decks),
    };
    updatePresence(nextFields);
    set(s => {
      if (!peerId || !existing) return s;
      const nextSelf: RoomPresence = {
        ...existing,
        ...nextFields,
        isSpectator: nextFields.isSpectator ?? existing.isSpectator,
        seatIndex: nextFields.isSpectator ? -1 : (nextFields.seatIndex ?? existing.seatIndex),
        online: true,
        lastSeen: Date.now(),
      };
      const localPlayerId = nextSelf.isSpectator
        ? ''
        : (s.game.players[nextSelf.seatIndex]?.id ?? s.localPlayerId);
      return {
        localPlayerId,
        multiplayer: {
          ...s.multiplayer,
          isSpectator: nextSelf.isSpectator,
          peers: {
            ...s.multiplayer.peers,
            [peerId]: nextSelf,
          },
        },
      };
    });
  },

  // ── Init ────────────────────────────────────────────────────────

  initGame: (config, players) => {
    const g = createEmptyGameState(config);
    g.players = players.map((p, i) =>
      createPlayer(p.id, p.name, i, p.color || PLAYER_COLORS[i], config, {
        initial: p.avatarInitial,
        style: p.avatarStyle,
        image: p.avatarImage,
      })
    );
    g.activePlayerId = g.players[0].id;
    g.priorityPlayerId = g.players[0].id;
    g.players[0].isActive = true;
    g.players[0].hasPriority = true;
    set({ game: g, localPlayerId: players[0].id, ui: { ...get().ui, screen: 'lobby', lobbyOpen: true } });
  },

  prepareLoadedTableGame: (config, players) => {
    const current = get().game;
    const keptIds = new Set(players.map(p => p.id));
    const nextPlayers = players.map((p, i) => {
      const existing = current.players.find(player => player.id === p.id);
      const base = existing ?? createPlayer(p.id, p.name, i, p.color || PLAYER_COLORS[i], config, {
        initial: p.avatarInitial,
        style: p.avatarStyle,
        image: p.avatarImage,
      });
      return {
        ...base,
        name: p.name,
        color: p.color,
        avatarInitial: p.avatarInitial,
        avatarStyle: p.avatarStyle,
        avatarImage: p.avatarImage,
        seatIndex: i,
        isActive: i === 0,
        hasPriority: i === 0,
      };
    });
    const cards = Object.fromEntries(
      Object.entries(current.cards).filter(([, card]) =>
        keptIds.has(card.ownerId) || keptIds.has(card.controllerId)
      )
    );
    set({
      game: {
        ...current,
        config,
        players: nextPlayers,
        cards,
        activePlayerId: nextPlayers[0]?.id ?? '',
        priorityPlayerId: nextPlayers[0]?.id ?? '',
        combat: createEmptyGameState(config).combat,
        lastUpdatedAt: Date.now(),
        status: 'lobby',
      },
      localPlayerId: nextPlayers.some(player => player.id === get().localPlayerId)
        ? get().localPlayerId
        : nextPlayers[0]?.id ?? '',
      ui: { ...get().ui, screen: 'lobby', lobbyOpen: true },
    });
  },

  loadDeck: async (playerId, deck) => {
    const newState = await loadDeckIntoPlayer(get().game, playerId, normalizeCommanderDeck(deck));
    const flags = getLoadedBannedCardFlags(newState, playerId);
    set({ game: newState, ui: withAssistantMessages(get().ui, newState, flags) });
    const state = get();
    if (
      state.multiplayer.peerId &&
      playerId === state.localPlayerId &&
      ['host', 'joined', 'migrating'].includes(state.multiplayer.status)
    ) {
      state.updateMultiplayerPresence({ deck: createRoomDeckSummary(normalizeCommanderDeck(deck)) });
    }
  },

  clearLoadedDeck: (playerId) => {
    const current = get().game;
    const player = current.players.find(p => p.id === playerId);
    if (!player?.deckId) return;

    const ownedCardIds = new Set([
      ...player.library,
      ...player.hand,
      ...player.battlefield,
      ...player.graveyard,
      ...player.exile,
      ...player.commandZone,
      ...player.sideboard,
      ...player.maybeboard,
      ...player.commanders,
    ]);
    const cards = Object.fromEntries(
      Object.entries(current.cards).filter(([id, card]) => (
        !ownedCardIds.has(id) &&
        card.ownerId !== playerId &&
        card.controllerId !== playerId
      ))
    );
    const players = current.players.map(p => p.id === playerId ? {
      ...p,
      deckId: undefined,
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: [],
      sideboard: [],
      maybeboard: [],
      commanders: [],
    } : p);

    set({
      game: {
        ...current,
        players,
        cards,
        stack: current.stack.filter(item => !ownedCardIds.has(item.sourceInstanceId ?? '')),
        triggerQueue: current.triggerQueue.filter(trigger => !ownedCardIds.has(trigger.sourceInstanceId ?? '')),
        lastUpdatedAt: Date.now(),
      },
    });
    const state = get();
    if (
      state.multiplayer.peerId &&
      playerId === state.localPlayerId &&
      ['host', 'joined', 'migrating'].includes(state.multiplayer.status)
    ) {
      state.updateMultiplayerPresence({ deck: undefined });
    }
  },

  addPracticeDummy: () => {
    const current = get().game;
    if (current.config.playerCount !== 1) return;
    const existingDummies = current.players.filter(player => player.id.startsWith(PRACTICE_DUMMY_PREFIX));
    if (existingDummies.length >= MAX_PRACTICE_DUMMIES) return;

    const index = existingDummies.length + 1;
    const dummy = createPlayer(
      `${PRACTICE_DUMMY_PREFIX}${uuid()}`,
      `Practice Dummy ${index}`,
      current.players.length,
      PLAYER_COLORS[(current.players.length + 1) % PLAYER_COLORS.length] ?? '#f59e0b',
      current.config,
    );
    const dummyCreatures = createPracticeDummyCreatures(dummy.id, index);
    const dummyCreatureIds = dummyCreatures.map(card => card.instanceId);
    const dummyCreatureDefinitions = Object.fromEntries(
      dummyCreatures.map(card => [card.definitionId, card.definition])
    );
    const dummyCreatureCards = Object.fromEntries(
      dummyCreatures.map(card => [card.instanceId, card])
    );
    const nextGame = {
      ...current,
      players: [...current.players, {
        ...dummy,
        life: current.config.startingLife,
        connected: true,
        isActive: false,
        hasPriority: false,
        battlefield: dummyCreatureIds,
      }],
      cards: { ...current.cards, ...dummyCreatureCards },
      definitions: { ...current.definitions, ...dummyCreatureDefinitions },
      lastUpdatedAt: Date.now(),
    };
    const actorId = current.activePlayerId || get().localPlayerId || current.players[0]?.id || dummy.id;
    const action = createAction(nextGame, actorId, 'OTHER', `${dummy.name} added for solo practice with ${dummyCreatureIds.length} creature cards.`);
    set({ game: { ...nextGame, actionLog: [...nextGame.actionLog, action] } });
  },

  removePracticeDummy: (playerId) => {
    const current = get().game;
    if (!playerId.startsWith(PRACTICE_DUMMY_PREFIX)) return;
    const dummy = current.players.find(player => player.id === playerId);
    if (!dummy) return;
    const nextCards = Object.fromEntries(
      Object.entries(current.cards).filter(([, card]) => card.ownerId !== playerId && card.controllerId !== playerId)
    );
    const nextPlayers = current.players.filter(player => player.id !== playerId).map((player, index) => ({
      ...player,
      seatIndex: index,
    }));
    const nextCombat = {
      ...current.combat,
      attackers: current.combat.attackers.filter(attacker => attacker.targetPlayerId !== playerId),
      blockers: current.combat.blockers.filter(blocker => nextCards[blocker.instanceId] && nextCards[blocker.blockedAttacker]),
      myriadCopies: current.combat.myriadCopies.filter(copy => copy.targetId !== playerId && nextCards[copy.copyId]),
    };
    const nextGame = {
      ...current,
      players: nextPlayers,
      cards: nextCards,
      combat: nextCombat,
      activePlayerId: current.activePlayerId === playerId ? (nextPlayers[0]?.id ?? '') : current.activePlayerId,
      priorityPlayerId: current.priorityPlayerId === playerId ? (nextPlayers[0]?.id ?? '') : current.priorityPlayerId,
      lastUpdatedAt: Date.now(),
    };
    const actorId = nextGame.activePlayerId || get().localPlayerId || nextPlayers[0]?.id || playerId;
    const action = createAction(nextGame, actorId, 'OTHER', `${dummy.name} removed from solo practice.`);
    set({ game: { ...nextGame, actionLog: [...nextGame.actionLog, action] } });
  },

  startGame: () => {
    let g = get().game;
    for (const player of g.players) {
      if (player.hand.length === 0 && player.library.length > 0) {
        g = drawCards(g, player.id, g.config.startingHandSize);
      }
    }
    const action = createAction(g, g.activePlayerId, 'GAME_START', 'Game started.');
    set({
      game: { ...g, status: 'playing', phase: 'main1', actionLog: [...g.actionLog, action] },
      ui: { ...get().ui, screen: 'game', lobbyOpen: false },
    });
  },

  resetGame: () => {
    set({
      game: createEmptyGameState(get().game.config),
      ui: { ...DEFAULT_UI, lobbyOpen: true },
    });
  },

  // ── Card Actions ──────────────────────────────────────────────────────────

  castCard: (castingPlayerId, cardInstanceId, targets) => {
    let g = get().game;
    const check = checkCastLegality(g, castingPlayerId, cardInstanceId);
    const flags = filterAssistantFlags(check.flags, get().ui);
    const card = g.cards[cardInstanceId];
    if (!card) return;
    const cardDef = getEffectiveCardDefinition(card);
    const spellNumberThisTurn = g.actionLog.filter(action =>
      action.turn === g.turn &&
      action.playerId === castingPlayerId &&
      action.actionType === 'CAST_SPELL' &&
      !action.undone
    ).length + 1;
    const castingPlayerBeforeMove = g.players.find(p => p.id === castingPlayerId);
    const isCommanderBeingCast = Boolean(castingPlayerBeforeMove?.commanders.includes(cardInstanceId)) ||
      card.zone === 'command';
    const previousCommanderCastCount = castingPlayerBeforeMove?.commanderCastCount[cardInstanceId] || 0;

    const stackObj: StackObject = {
      id: uuid(), type: 'spell',
      sourceInstanceId: cardInstanceId,
      sourceDefinitionId: card.definitionId,
      sourceName: cardDef.name,
      controllerId: castingPlayerId,
      targets: targets?.ids,
      targetLabels: targets?.labels,
      text: cardDef.oracleText,
      timestamp: Date.now(),
    };

    g = moveCard(g, cardInstanceId, 'stack', castingPlayerId);
    g = pushToStack(g, stackObj);

    // Track commander cast count for tax purposes (CR 903.8)
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
    const castingPlayer = g.players.find(p => p.id === castingPlayerId);
    const commanderCastNumber = isCommanderBeingCast ? previousCommanderCastCount + 1 : undefined;
    const commanderTax = isCommanderBeingCast ? previousCommanderCastCount * 2 : undefined;
    const castData: Record<string, unknown> = {
      targets: targets?.labels,
    };
    if (isCommanderBeingCast) {
      Object.assign(castData, {
        commanderCast: true,
        commanderCastNumber,
        commanderTax,
        playerName: castingPlayer?.name || castingPlayerId,
        playerColor: castingPlayer?.color,
        cardName: cardDef.name,
      });
    }

    const action = createAction(g, castingPlayerId, 'CAST_SPELL',
      `${cardDef.name} cast by ${castingPlayer?.name || castingPlayerId}`,
      [cardInstanceId],
      addReviewData(castData, flags),
      flags);
    const detectedCastTriggers = detectCastTriggers(g, castingPlayerId, g.cards[cardInstanceId], spellNumberThisTurn);
    const castTriggers: TriggerItem[] = detectedCastTriggers.map(t => {
      const id = uuid();
      return {
        id,
        sourceInstanceId: t.sourceCard.instanceId,
        sourceName: getEffectiveCardName(t.sourceCard),
        controllerId: t.sourceCard.controllerId,
        text: t.triggerText,
        triggerType: t.triggerType,
        effect: t.effect,
        data: t.data,
        acknowledged: false,
        missed: false,
        timestamp: Date.now(),
      };
    });
    const triggerStackObjects: StackObject[] = castTriggers.map(t => ({
      id: uuid(),
      type: 'triggered',
      sourceName: t.sourceName,
      controllerId: t.controllerId,
      text: t.text,
      timestamp: Date.now(),
      parentId: t.id,
    }));
    const triggerAction = castTriggers.length
      ? createAction(
          g,
          castingPlayerId,
          'PUT_ON_STACK',
          `${castTriggers.length} cast trigger${castTriggers.length === 1 ? '' : 's'} added to the stack.`,
          castTriggers.flatMap(t => t.sourceInstanceId ? [t.sourceInstanceId] : []),
          { triggerIds: castTriggers.map(t => t.id), spellNumberThisTurn },
        )
      : null;
    g = {
      ...g,
      stack: [...triggerStackObjects, ...g.stack],
      triggerQueue: [...g.triggerQueue, ...castTriggers],
      actionLog: triggerAction ? [...g.actionLog, action, triggerAction] : [...g.actionLog, action],
    };

    set({ game: g, ui: withAssistantMessages(get().ui, g, flags) });
  },

  playLand: (playerId, cardInstanceId, faceIndex) => {
    let g = get().game;
    let card = g.cards[cardInstanceId];
    if (!card) return;
    if (faceIndex !== undefined) {
      card = { ...card, transformed: faceIndex === 1 };
      g = { ...g, cards: { ...g.cards, [cardInstanceId]: card } };
    }
    const playedDef = getEffectiveCardDefinition(card);
    g = moveCard(g, cardInstanceId, 'battlefield', playerId);
    g = { ...g, cards: { ...g.cards, [cardInstanceId]: { ...g.cards[cardInstanceId], summoningSick: false } } };
    const action = createAction(g, playerId, 'MOVE_CARD', `${playedDef.name} played as land`, [cardInstanceId], { faceIndex });
    g = { ...g, actionLog: [...g.actionLog, action] };

    g = appendDetectedTriggersToStack(g, detectETBTriggers(g, g.cards[cardInstanceId]), playerId, 'ETB');
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
    const flags = filterAssistantFlags(check.flags, get().ui);
    const card = g.cards[instanceId];
    if (!card) return;
    g = tapCard(g, instanceId, true);
    const action = createAction(g, card.controllerId, 'TAP', `Tapped ${card.definition.name}`, [instanceId], addReviewData({}, flags), flags);
    const nextGame = { ...g, actionLog: [...g.actionLog, action] };
    set({ game: nextGame, ui: withAssistantMessages(get().ui, nextGame, flags) });
  },

  untapCard: (instanceId) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    g = tapCard(g, instanceId, false);
    const action = createAction(g, card.controllerId, 'UNTAP', `Untapped ${card.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  tapCards: (instanceIds) => {
    let g = get().game;
    const ids = [...new Set(instanceIds)].filter(id => {
      const card = g.cards[id];
      return card && card.zone === 'battlefield' && !card.tapped;
    });
    if (ids.length === 0) return;
    for (const id of ids) g = tapCard(g, id, true);
    const names = new Set(ids.map(id => g.cards[id]?.definition.name).filter(Boolean));
    const label = names.size === 1 ? [...names][0] : 'permanent';
    const action = createAction(g, g.activePlayerId, 'TAP', `Tapped ${ids.length} ${label}${ids.length === 1 ? '' : 's'}`, ids, { bulk: true });
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  untapCards: (instanceIds) => {
    let g = get().game;
    const ids = [...new Set(instanceIds)].filter(id => {
      const card = g.cards[id];
      return card && card.zone === 'battlefield' && card.tapped;
    });
    if (ids.length === 0) return;
    for (const id of ids) g = tapCard(g, id, false);
    const names = new Set(ids.map(id => g.cards[id]?.definition.name).filter(Boolean));
    const label = names.size === 1 ? [...names][0] : 'permanent';
    const action = createAction(g, g.activePlayerId, 'UNTAP', `Untapped ${ids.length} ${label}${ids.length === 1 ? '' : 's'}`, ids, { bulk: true });
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
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
    const nextCard = { ...card, transformed: !card.transformed };
    const action = createAction(
      g,
      card.controllerId,
      'OTHER',
      `${getEffectiveCardName(card)} transformed into ${getEffectiveCardName(nextCard)}.`,
      [instanceId],
      { transformed: nextCard.transformed },
    );
    set({
      game: {
        ...g,
        cards: { ...g.cards, [instanceId]: nextCard },
        actionLog: [...g.actionLog, action],
        lastUpdatedAt: Date.now(),
      },
    });
  },

  createTokenCard: (controllerId, tokenDef) => {
    get().createTokenCards(controllerId, tokenDef, 1);
  },

  createTokenCards: (controllerId, tokenDef, count = 1) => {
    let g = get().game;
    const requestedCount = Math.max(0, Math.floor(count));
    const safeCount = Math.min(requestedCount, MAX_TOKEN_BATCH);
    if (safeCount === 0) return [];
    const result = createTokens(g, controllerId, tokenDef, safeCount);
    g = result.state;
    const cappedText = requestedCount > safeCount ? ` (capped from ${requestedCount})` : '';
    const action = createAction(
      g,
      controllerId,
      'ADD_TOKEN',
      `Created ${safeCount} ${tokenDef.name} token${safeCount === 1 ? '' : 's'}${cappedText}`,
      result.tokenIds,
      {
        tokenName: tokenDef.name,
        tokenCount: safeCount,
        requestedCount,
        capped: requestedCount > safeCount,
        visualGroup: result.visualGroup,
      },
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
    return result.tokenIds;
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

  reorderHand: (playerId, orderedInstanceIds) => {
    const g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player || !sameHandMembers(player.hand, orderedInstanceIds)) return;
    if (player.hand.every((id, index) => id === orderedInstanceIds[index])) return;
    const action = createAction(g, playerId, 'OTHER', `${player.name} reorganized their hand.`);
    set({
      game: {
        ...g,
        players: g.players.map(p => p.id === playerId ? { ...p, hand: orderedInstanceIds } : p),
        actionLog: [...g.actionLog, action],
        lastUpdatedAt: Date.now(),
      },
    });
  },

  sortHand: (playerId) => {
    const g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    const sorted = [...player.hand].sort((a, b) => {
      const cardA = g.cards[a];
      const cardB = g.cards[b];
      if (!cardA || !cardB) return 0;
      return handSortKey(cardA).localeCompare(handSortKey(cardB));
    });
    get().reorderHand(playerId, sorted);
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
    const reviewFlags: AssistantFlag[] = [];
    if (g.stack.length > 0) {
      reviewFlags.push({
        id: uuid(),
        severity: 'warning',
        label: 'Needs Review',
        text: `Resolve the stack before advancing phases (${g.stack.length} item${g.stack.length === 1 ? '' : 's'} pending).`,
        ruleRef: 'CR 117',
      });
    }
    const prev = g.phase;
    g = nextPhase(g);
    const phaseFlags = filterAssistantFlags(reviewFlags, get().ui);
    const action = createAction(
      g,
      g.activePlayerId,
      'CHANGE_PHASE',
      `${prev} -> ${g.phase}`,
      [],
      addReviewData({ from: prev, to: g.phase }, phaseFlags),
      phaseFlags
    );
    g = { ...g, actionLog: [...g.actionLog, action] };
    if (g.phase === 'upkeep') {
      g = appendDetectedTriggersToStack(g, detectUpkeepTriggers(g, g.activePlayerId), g.activePlayerId, 'upkeep');
    }
    const mods = filterAssistantFlags(getActiveModifiers(g), get().ui);
    const baseUi = { ...get().ui, combatMode: g.combat.active };
    set({ game: g, ui: withAssistantMessages(withAssistantMessages(baseUi, g, phaseFlags), g, mods) });
  },

  goToPhase: (phase) => {
    let g = get().game;
    g = setPhase(g, phase);
    const action = createAction(g, g.activePlayerId, 'CHANGE_PHASE', `Jump to: ${phase}`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] }, ui: { ...get().ui, combatMode: g.combat.active } });
  },

  advanceTurn: () => {
    let g = get().game;
    g = nextTurn(g);
    const active = g.players.find(p => p.id === g.activePlayerId);
    const action = createAction(g, g.activePlayerId, 'CHANGE_PHASE', `Turn ${g.turn} — ${active?.name || '?'}`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] }, ui: { ...get().ui, combatMode: false } });
  },

  passPriority: () => {
    const g = get().game;
    if (g.players.length === 0) return;
    const ids = g.players.map(p => p.id);
    const nextIdx = (ids.indexOf(g.priorityPlayerId) + 1) % ids.length;
    const nextId = ids[nextIdx];
    const newPlayers = g.players.map((p, i) => ({ ...p, hasPriority: i === nextIdx }));
    const action = createAction(g, nextId, 'PASS_PRIORITY', 'Priority passed');
    set({
      game: {
        ...g,
        priorityPlayerId: nextId,
        players: newPlayers,
        actionLog: [...g.actionLog, action],
        lastUpdatedAt: Date.now(),
      },
    });
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

    if (top.type === 'triggered') {
      g = {
        ...g,
        stack: g.stack.slice(1),
        triggerQueue: top.parentId
          ? g.triggerQueue.map(t => t.id === top.parentId ? { ...t, acknowledged: true } : t)
          : g.triggerQueue,
        lastUpdatedAt: Date.now(),
      };
    } else if (top.sourceInstanceId) {
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
    if (top.type !== 'triggered') {
      g = resolveTopStack(g);
    }
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
    const g = acknowledgeTrigger(get().game, triggerId);
    set({ game: { ...g, stack: g.stack.filter(item => item.parentId !== triggerId), lastUpdatedAt: Date.now() } });
  },

  ackAllTriggers: () => {
    const g = get().game;
    const pending = g.triggerQueue.filter(trigger => !trigger.acknowledged);
    if (pending.length === 0) return;
    const pendingIds = new Set(pending.map(trigger => trigger.id));
    const action = createAction(
      g,
      g.activePlayerId,
      'RESOLVE_STACK',
      `Resolved ${pending.length} pending trigger${pending.length === 1 ? '' : 's'}`,
      pending.flatMap(trigger => trigger.sourceInstanceId ? [trigger.sourceInstanceId] : []),
      { triggerIds: [...pendingIds], bulk: true },
    );
    set({
      game: {
        ...g,
        stack: g.stack.filter(item => !item.parentId || !pendingIds.has(item.parentId)),
        triggerQueue: g.triggerQueue.map(trigger =>
          pendingIds.has(trigger.id) ? { ...trigger, acknowledged: true } : trigger
        ),
        actionLog: [...g.actionLog, action],
        lastUpdatedAt: Date.now(),
      },
    });
  },

  applyTriggerShortcut: (triggerId) => {
    let g = get().game;
    const trigger = g.triggerQueue.find(t => t.id === triggerId);
    if (!trigger?.effect) return;

    if (trigger.effect.kind === 'vialSmasherDamage') {
      const eligible = trigger.effect.eligibleOpponentIds
        .map(id => g.players.find(player => player.id === id))
        .filter((player): player is Player => player !== undefined && !player.isSpectator);
      if (eligible.length === 0) return;
      const chosen = eligible[Math.floor(Math.random() * eligible.length)];
      const amount = trigger.effect.manaValue;
      g = modifyLife(g, chosen.id, -amount);
      g = {
        ...g,
        triggerQueue: g.triggerQueue.map(t =>
          t.id === triggerId
            ? { ...t, acknowledged: true, data: { ...t.data, shortcutApplied: true, chosenPlayerId: chosen.id, damage: amount } }
            : t
        ),
        stack: g.stack.filter(item => item.parentId !== triggerId),
      };
      const action = createAction(
        g,
        trigger.controllerId,
        'CHANGE_LIFE',
        `${trigger.sourceName} shortcut: ${chosen.name} chosen at random and dealt ${amount} damage from ${trigger.effect.spellName}.`,
        trigger.sourceInstanceId ? [trigger.sourceInstanceId, trigger.effect.spellInstanceId] : [trigger.effect.spellInstanceId],
        {
          shortcut: 'vialSmasherDamage',
          triggerId,
          chosenPlayerId: chosen.id,
          spellName: trigger.effect.spellName,
          manaValue: amount,
        },
      );
      set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
      return;
    }

    if (trigger.effect.kind === 'poisonFromCombatDamage') {
      const effect = trigger.effect;
      const target = g.players.find(player => player.id === effect.damagedPlayerId);
      if (!target) return;
      const amount = effect.amount;
      g = {
        ...g,
        players: g.players.map(player =>
          player.id === target.id ? { ...player, poisonCounters: player.poisonCounters + amount } : player
        ),
        triggerQueue: g.triggerQueue.map(t =>
          t.id === triggerId
            ? { ...t, acknowledged: true, data: { ...t.data, shortcutApplied: true, poisonedPlayerId: target.id, poisonCounters: amount } }
            : t
        ),
        stack: g.stack.filter(item => item.parentId !== triggerId),
      };
      const action = createAction(
        g,
        trigger.controllerId,
        'ADD_COUNTER',
        `${trigger.sourceName} shortcut: ${target.name} gets ${amount} poison counter${amount === 1 ? '' : 's'}.`,
        trigger.sourceInstanceId ? [trigger.sourceInstanceId] : [],
        {
          shortcut: 'poisonFromCombatDamage',
          triggerId,
          poisonedPlayerId: target.id,
          poisonCounters: amount,
        },
      );
      set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
      return;
    }

    if (trigger.effect.kind === 'createToken') {
      const effect = trigger.effect;
      const requestedCount = Math.max(0, Math.floor(effect.count));
      const safeCount = Math.min(requestedCount, MAX_TOKEN_BATCH);
      const tokenResult = createTokens(g, effect.controllerId, {
        ...effect.token,
        id: `token-${effect.token.name.toLowerCase().replace(/\s+/g, '-')}`,
        cmc: 0,
        colorIdentity: effect.token.colors,
        isDoubleFaced: false,
        legalities: {},
      }, safeCount);
      g = tokenResult.state;
      g = {
        ...g,
        triggerQueue: g.triggerQueue.map(t =>
          t.id === triggerId
            ? {
                ...t,
                acknowledged: true,
                data: {
                  ...t.data,
                  shortcutApplied: true,
                  tokenName: effect.token.name,
                  tokenCount: safeCount,
                  requestedCount,
                  capped: requestedCount > safeCount,
                  visualGroup: tokenResult.visualGroup,
                },
              }
            : t
        ),
        stack: g.stack.filter(item => item.parentId !== triggerId),
      };
      const cappedText = requestedCount > safeCount ? ` (capped from ${requestedCount})` : '';
      const action = createAction(
        g,
        trigger.controllerId,
        'ADD_TOKEN',
        `${trigger.sourceName} shortcut: created ${safeCount} ${effect.token.name} token${safeCount === 1 ? '' : 's'}${cappedText}.`,
        trigger.sourceInstanceId ? [trigger.sourceInstanceId, ...tokenResult.tokenIds] : tokenResult.tokenIds,
        {
          shortcut: 'createToken',
          triggerId,
          tokenName: effect.token.name,
          tokenCount: safeCount,
          requestedCount,
          capped: requestedCount > safeCount,
          visualGroup: tokenResult.visualGroup,
        },
      );
      set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
    }
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
    const missed = g.triggerQueue.find(t => t.id === triggerId);
    const queue = g.triggerQueue.map(t =>
      t.id === triggerId ? { ...t, missed: true, acknowledged: true } : t
    );
    const action = createAction(g, g.activePlayerId, 'OTHER',
      `Trigger missed: ${missed?.sourceName ?? triggerId}`,
      missed?.sourceInstanceId ? [missed.sourceInstanceId] : [],
      {
        reviewType: 'missed-trigger',
        triggerId,
        sourceName: missed?.sourceName,
        triggerText: missed?.text,
        controllerId: missed?.controllerId,
      });
    set({ game: { ...g, stack: g.stack.filter(item => item.parentId !== triggerId), triggerQueue: queue, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  // ── Combat ────────────────────────────────────────────────────────────────

  enterCombat: () => {
    let g = get().game;
    g = clearCombatAssignments(g);
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
    const flags = filterAssistantFlags(check.flags, get().ui);
    g = declareAttacker(g, attackerInstanceId, targetPlayerId);
    const card = g.cards[attackerInstanceId];
    const triggers = card ? detectAttackTriggers(g, card) : [];
    const newTriggers: TriggerItem[] = triggers.map(t => ({
      id: uuid(), sourceInstanceId: t.sourceCard.instanceId,
      sourceName: t.sourceCard.definition.name, controllerId: t.sourceCard.controllerId,
      text: t.triggerText, triggerType: t.triggerType,
      acknowledged: false, missed: false, timestamp: Date.now(),
    }));
    const action = createAction(g, g.activePlayerId, 'DECLARE_ATTACKER',
      `${card?.definition.name} attacks ${targetPlayerId}`, [attackerInstanceId], addReviewData({}, flags), flags);
    g = { ...g, actionLog: [...g.actionLog, action], triggerQueue: [...g.triggerQueue, ...newTriggers] };
    set({ game: g, ui: withAssistantMessages(get().ui, g, flags) });
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
    const commanderFlags: AssistantFlag[] = isCommander && g.config.useCommanderDamage
      ? [{
          id: uuid(), severity: 'info', label: 'Info',
          text: `${attackerCard.definition.name} is a commander — each Myriad copy tracks commander damage to its target independently (CR 702.116, 903.17).`,
          ruleRef: 'CR 702.116',
        }]
      : [];
    const visibleFlags = filterAssistantFlags(commanderFlags, get().ui);

    set({ game: g, ui: withAssistantMessages(get().ui, g, visibleFlags) });
    return copies;
  },

  declareBlock: (blockerInstanceId, attackerInstanceId) => {
    let g = get().game;
    const check = checkBlockLegality(g, blockerInstanceId, attackerInstanceId);
    const flags = filterAssistantFlags(check.flags, get().ui);
    g = declareBlocker(g, blockerInstanceId, attackerInstanceId);
    const blocker = g.cards[blockerInstanceId];
    const attacker = g.cards[attackerInstanceId];
    const action = createAction(g, g.activePlayerId, 'DECLARE_BLOCKER',
      `${blocker?.definition.name ?? 'Blocker'} blocks ${attacker?.definition.name ?? 'attacker'}`,
      [blockerInstanceId, attackerInstanceId],
      addReviewData({ blockerInstanceId, attackerInstanceId }, flags),
      flags);
    g = { ...g, actionLog: [...g.actionLog, action] };
    set({ game: g, ui: withAssistantMessages(get().ui, g, flags) });
  },

  resolveCombatDamage: () => {
    let g = get().game;

    // Helper: does a card have a keyword (checks keywords array + oracle text)
    const hasKw = (card: (typeof g.cards)[string], kw: string) => {
      const lc = kw.toLowerCase();
      const def = getEffectiveCardDefinition(card);
      return def.keywords.some(k => k.toLowerCase() === lc) ||
        def.oracleText.toLowerCase().includes(lc);
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
          const power = parseInt(getEffectiveCardDefinition(attackerCard).power || '0', 10) || 0;
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
          if (power > 0) {
            g = appendDetectedTriggersToStack(
              g,
              detectCombatDamageTriggers(g, attackerCard, attacker.targetPlayerId, power),
              attackerCard.controllerId,
              'combat damage',
            );
          }
        } else {
          // Blocked — assign damage to/from blockers
          // CR 510: Attacker and blocker damage is INDEPENDENT.
          // A blocker without FS deals in the normal step even if its attacker has FS.
          const attackerPower = parseInt(getEffectiveCardDefinition(attackerCard).power || '0', 10) || 0;
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
              const blockerPower = parseInt(getEffectiveCardDefinition(blocker).power || '0', 10) || 0;
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
      const visibleFlags = filterAssistantFlags(fs1Flags, get().ui);
      const firstStrikeAction = createAction(
        g,
        g.activePlayerId,
        'CHANGE_PHASE',
        'First strike damage step resolved',
        [],
        addReviewData({}, visibleFlags),
        visibleFlags
      );
      g = { ...g, actionLog: [...g.actionLog, firstStrikeAction] };
      set({ game: g, ui: withAssistantMessages(get().ui, g, visibleFlags) });
      g = get().game; // re-read after state-based actions may have removed creatures
    }

    // Regular (or double-strike second) damage step
    applyDamageForAttackers(g.combat.attackers, false);

    const { newState, flags } = checkStateBasedActions(g);
    g = newState;
    const visibleFlags = filterAssistantFlags(flags, get().ui);
    const action = createAction(
      g,
      g.activePlayerId,
      'CHANGE_PHASE',
      'Combat damage resolved',
      [],
      addReviewData({}, visibleFlags),
      visibleFlags
    );
    g = { ...g, actionLog: [...g.actionLog, action] };
    set({ game: g, ui: withAssistantMessages(get().ui, g, visibleFlags) });
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
    }

    g = clearCombatAssignments(g);
    g = setPhase(g, 'main2');
    set({ game: g, ui: { ...get().ui, combatMode: false } });
  },

  runStateBasedActions: () => {
    const { newState, flags } = checkStateBasedActions(get().game);
    const visibleFlags = filterAssistantFlags(flags, get().ui);
    set({ game: newState, ui: withAssistantMessages(get().ui, newState, visibleFlags) });
  },

  undo: () => { set({ game: undoAction(get().game) }); },

  // ── UI ────────────────────────────────────────────────────────────────────

  setSelectedCard: (id) => set(s => ({ ui: { ...s.ui, selectedCardId: id } })),
  setHoveredCard: (id) => set(s => ({ ui: { ...s.ui, hoveredCardId: id } })),
  setFocusedPlayer: (id) => set(s => ({ ui: { ...s.ui, focusedPlayerId: id } })),
  setRightPanelTab: (tab) => set(s => ({ ui: { ...s.ui, rightPanelTab: tab } })),
  setPanelSize: (panel, size) => set(s => {
    const panelSizes = { ...s.ui.panelSizes, [panel]: clampPanelSize(panel, size) };
    savePanelSizes(panelSizes);
    return { ui: { ...s.ui, panelSizes } };
  }),
  resetPanelSizes: () => set(s => {
    savePanelSizes(DEFAULT_PANEL_SIZES);
    return { ui: { ...s.ui, panelSizes: DEFAULT_PANEL_SIZES } };
  }),
  toggleLeftPanel: () => set(s => ({ ui: { ...s.ui, leftPanelOpen: !s.ui.leftPanelOpen } })),
  toggleRightPanel: () => set(s => ({ ui: { ...s.ui, rightPanelOpen: !s.ui.rightPanelOpen } })),
  openZoneDrawer: (zone, playerId, options) => set(s => ({ ui: { ...s.ui, zoneDrawer: { zone, playerId, ...options } } })),
  closeZoneDrawer: () => set(s => ({ ui: { ...s.ui, zoneDrawer: null } })),
  openCardContextMenu: (instanceId, x, y) => set(s => ({ ui: { ...s.ui, cardContextMenu: { instanceId, x, y } } })),
  closeCardContextMenu: () => set(s => ({ ui: { ...s.ui, cardContextMenu: null } })),
  setCardPreview: (id, anchor) => set(s => ({
    ui: {
      ...s.ui,
      cardPreview: id,
      cardPreviewAnchor: id ? (anchor ?? s.ui.cardPreviewAnchor) : null,
    },
  })),
  setCardPreviewAnchor: (anchor) => set(s => ({ ui: { ...s.ui, cardPreviewAnchor: anchor } })),
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
  setLobbyOpen: (open) => set(s => ({ ui: { ...s.ui, screen: open ? 'lobby' : 'game', lobbyOpen: open } })),
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
    const n = normalizeMechanicCount(count, player.library.length);
    if (n === 0) {
      const action = createAction(game, playerId, 'SCRY', 'Scry 0 — no scry event occurs', [], { count: 0, ruleRef: 'CR 701.22b' });
      set({ game: { ...game, actionLog: [...game.actionLog, action] } });
      return;
    }
    const action = createAction(game, playerId, 'SCRY',
      `Scry ${count} — privately look at top ${n} card(s)`, player.library.slice(0, n), {
        requestedCount: count,
        visibleCount: n,
        viewerId: playerId,
        private: true,
        ruleRef: 'CR 701.22a',
      });
    set({
      game: { ...game, actionLog: [...game.actionLog, action] },
      ui: { ...get().ui, zoneDrawer: { zone: 'library', playerId, mode: 'scry', limit: n, viewerId: playerId, private: true } },
    });
  },

  surveilCards: (playerId, count) => {
    const { game } = get();
    const player = game.players.find(p => p.id === playerId);
    if (!player || player.library.length === 0) return;
    const n = normalizeMechanicCount(count, player.library.length);
    if (n === 0) return;
    const action = createAction(game, playerId, 'SURVEIL',
      `Surveil ${count} — privately look at top ${n} card(s): keep or mill`, player.library.slice(0, n), {
        requestedCount: count,
        visibleCount: n,
        viewerId: playerId,
        private: true,
      });
    set({
      game: { ...game, actionLog: [...game.actionLog, action] },
      ui: { ...get().ui, zoneDrawer: { zone: 'library', playerId, mode: 'surveil', limit: n, viewerId: playerId, private: true } },
    });
  },

  lookAtTopCards: (playerId, count, viewerId) => {
    const { game } = get();
    const player = game.players.find(p => p.id === playerId);
    const actualViewer = viewerId ?? get().localPlayerId;
    if (!player || player.library.length === 0) return;
    const n = normalizeMechanicCount(count, player.library.length);
    if (n === 0) return;
    const action = createAction(game, actualViewer || playerId, 'SEARCH_LIBRARY',
      `Look at top ${n} card(s) of ${player.name}'s library`, player.library.slice(0, n), {
        requestedCount: count,
        visibleCount: n,
        viewerId: actualViewer,
        private: true,
        ruleRef: 'CR 401.5',
      });
    set({
      game: { ...game, actionLog: [...game.actionLog, action] },
      ui: { ...get().ui, zoneDrawer: { zone: 'library', playerId, mode: 'lookTop', limit: n, viewerId: actualViewer, private: true } },
    });
  },

  reorderLibraryCard: (playerId, instanceId, placement) => {
    const { game } = get();
    const player = game.players.find(p => p.id === playerId);
    const card = game.cards[instanceId];
    if (!player || !card || card.zone !== 'library' || !player.library.includes(instanceId)) return;
    const remaining = player.library.filter(id => id !== instanceId);
    const library = placement === 'top'
      ? [instanceId, ...remaining]
      : [...remaining, instanceId];
    const players = game.players.map(p => p.id === playerId ? { ...p, library } : p);
    const action = createAction(game, playerId, 'SCRY',
      `${card.definition.name} put on ${placement} of ${player.name}'s library`, [instanceId], {
        placement,
        private: true,
      });
    set({ game: { ...game, players, actionLog: [...game.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  dredgeCard: (playerId, instanceId) => {
    let g = get().game;
    const player = g.players.find(p => p.id === playerId);
    const card = g.cards[instanceId];
    const dredgeValue = card ? getDredgeValue(card) : null;
    if (!player || !card || card.zone !== 'graveyard' || !player.graveyard.includes(instanceId) || !dredgeValue) return false;
    if (player.library.length < dredgeValue) {
      const flag: AssistantFlag = {
        id: uuid(),
        severity: 'warning',
        label: 'Flagged',
        text: `${player.name} cannot dredge ${card.definition.name}: Dredge ${dredgeValue} requires at least ${dredgeValue} cards in library.`,
        ruleRef: 'CR 702.52b',
      };
      const action = createAction(g, playerId, 'DREDGE',
        `Dredge failed — ${card.definition.name} needs ${dredgeValue} library card(s)`, [instanceId], addReviewData({ dredgeValue }, [flag]), [flag]);
      g = { ...g, actionLog: [...g.actionLog, action] };
      set({ game: g, ui: withAssistantMessages(get().ui, g, [flag]) });
      return false;
    }
    const milled = player.library.slice(0, dredgeValue);
    for (const id of milled) g = moveCard(g, id, 'graveyard');
    g = moveCard(g, instanceId, 'hand');
    const action = createAction(g, playerId, 'DREDGE',
      `Dredged ${card.definition.name} — milled ${dredgeValue}, returned to hand`, [instanceId, ...milled], {
        dredgeValue,
        milled,
        ruleRef: 'CR 702.52a',
      });
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
    return true;
  },

  proliferate: (controllerId, choices) => {
    const game = get().game;
    const chosenCardIds = choices?.cardIds ?? Object.values(game.cards)
      .filter(card => card.zone === 'battlefield' && cardHasCounters(card))
      .map(card => card.instanceId);
    const chosenPlayerIds = choices?.playerIds ?? game.players
      .filter(playerHasCounters)
      .map(player => player.id);
    const cardSet = new Set(chosenCardIds);
    const playerSet = new Set(chosenPlayerIds);
    const cards = { ...game.cards };
    for (const id of cardSet) {
      const card = cards[id];
      if (!card || card.zone !== 'battlefield' || !cardHasCounters(card)) continue;
      cards[id] = {
        ...card,
        counters: card.counters.map(counter => counter.count > 0 ? { ...counter, count: counter.count + 1 } : counter),
      };
    }
    const players = game.players.map(player => {
      if (!playerSet.has(player.id) || !playerHasCounters(player)) return player;
      return {
        ...player,
        poisonCounters: player.poisonCounters > 0 ? player.poisonCounters + 1 : player.poisonCounters,
        energyCounters: player.energyCounters > 0 ? player.energyCounters + 1 : player.energyCounters,
        experienceCounters: player.experienceCounters > 0 ? player.experienceCounters + 1 : player.experienceCounters,
      };
    });
    const affected = [
      ...chosenCardIds.filter(id => cards[id] && cardHasCounters(cards[id])),
      ...chosenPlayerIds.filter(id => {
        const player = game.players.find(p => p.id === id);
        return Boolean(player && playerHasCounters(player));
      }),
    ];
    const action = createAction(game, controllerId, 'PROLIFERATE',
      `Proliferated ${affected.length} object${affected.length === 1 ? '' : 's'}`, affected, {
        cardIds: chosenCardIds,
        playerIds: chosenPlayerIds,
        ruleRef: 'CR 701.34a',
      });
    set({ game: { ...game, cards, players, actionLog: [...game.actionLog, action], lastUpdatedAt: Date.now() } });
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
      .some(t => card.definition.cardTypes.includes(t as typeof card.definition.cardTypes[number]));
    // Update controller then move
    g = { ...g, cards: { ...g.cards, [instanceId]: { ...g.cards[instanceId], controllerId: playerId } } };
    g = moveCard(g, instanceId, isPermanent ? 'battlefield' : 'graveyard');
    const check = checkCastLegality(g, playerId, instanceId);
    const flags = filterAssistantFlags(check.flags, get().ui);
    const action = createAction(
      g,
      playerId,
      'CAST',
      `Cast ${card.definition.name} from ${zoneName}`,
      [instanceId],
      addReviewData({ fromZone }, flags),
      flags
    );
    g = { ...g, actionLog: [...g.actionLog, action] };
    set({ game: g, ui: withAssistantMessages(get().ui, g, flags) });
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
// Any time game state changes while connected, broadcast it over PeerJS.
// This runs once at module load time, so individual actions do not need
// transport-specific calls.
useGameStore.subscribe(
  (state, prevState) => {
    const game = state.game;
    const prevGame = prevState.game;
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
);
