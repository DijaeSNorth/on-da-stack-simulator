// ─── Zustand Game Store ───────────────────────────────────────────────────────
import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type {
  GameState, Player, CardState, Phase, StackObject, TriggerItem, ManaPool,
  AssistantFlag, Deck, GameConfig, ActionRecord, PlayerAvatarImage, CardDefinition, TokenStackAttackInput, CombatDamagePreview,
  PowerToughnessOverrideExpiration, HouseRule, DeckValidationResult, SoloDeckLabState, SoloModeTab, SoloTestMode, DummyOpponentConfig
} from '../types/game';
import {
  createEmptyGameState, createPlayer, createAction, moveCard, tapCard,
  addCounter, removeCounter, modifyLife, addCommanderDamage,
  nextPhase, setPhase, nextTurn, pushToStack, resolveTopStack,
  addTrigger, acknowledgeTrigger, drawCards, discardCard, createToken,
  createTokens, checkStateBasedActions, declareAttacker, declareBlocker, undoAction,
  loadDeckIntoPlayer, createDefaultGameConfig, createCardState,
  triggerMyriad, clearCombatAssignments, setManaPool, addManaToPool, clearManaPool,
  takeMulligan, tutorCard as tutorCardFromEngine, removeAllCountersFromCard,
  addCombatManaToPool, clearCombatMana, markExhaustUsedOnCard, resetExhaustUsedOnCard,
  applyAirbend as applyAirbendInEngine, markCastForWarp as markCastForWarpInEngine,
  getWaterbendEligiblePermanents as getWaterbendEligiblePermanentsFromEngine,
  payWaterbendCost as payWaterbendCostInEngine,
  applyEarthbend as applyEarthbendInEngine,
  declareTokenStackAttack as declareTokenStackAttackInEngine,
  getSneakReturnCandidates as getSneakReturnCandidatesFromEngine,
  canCastWithSneak as canCastWithSneakInEngine,
  castWithSneak as castWithSneakInEngine,
  generateCombatDamagePreview,
  getEffectivePowerToughness,
  setPowerToughnessOverride as setPowerToughnessOverrideInEngine,
  clearPowerToughnessOverride as clearPowerToughnessOverrideInEngine,
  clearExpiredPowerToughnessOverrides, clearMarkedDamage,
  getStationEligibleCreatures as getStationEligibleCreaturesFromEngine,
  stationSpacecraft as stationSpacecraftInEngine,
  stationSpacecraftManual as stationSpacecraftManualInEngine,
  applyBlight as applyBlightInEngine,
  getVividColorCount as getVividColorCountFromEngine,
  levelUpClass as levelUpClassInEngine,
  setClassLevel as setClassLevelInEngine,
} from '../engine/gameEngine';
import { DEFAULT_RULESET_VERSION } from '../rules/defaultRuleset';
import { getFirebendingAmount, getMechanicsForCard } from '../rules/mechanicsRegistry';
import {
  checkCastLegality, checkTapLegality, checkAttackLegality, checkBlockLegality,
  detectAttackTriggers, detectCastTriggers, detectCombatDamageTriggers, detectETBTriggers, detectUpkeepTriggers, getActiveModifiers,
  type DetectedTrigger,
} from '../engine/assistantEngine';
import { getEffectiveCardDefinition, getEffectiveCardName, getEffectiveOracleText } from '../engine/cardFaces';
import { deleteDeck, importDecklist, saveDeck, loadDecksFromStorage, normalizeCommanderDeck, prepareCommanderDeckForUse } from '../engine/deckImport';
import { createBlankDeck, validateCommanderDraft } from '../engine/soloDeckBuilder';
import {
  arrangeOpeningHandInGame,
  createOpeningHandSession,
  keepOpeningHandSession,
  mulliganOpeningHandSession,
  setOpeningHandCardsToBottom,
} from '../engine/openingHand';
import {
  addDummyOpponentToGame,
  advanceDummyTurn as advanceDummyTurnInEngine,
  autoBlockForDummy as autoBlockForDummyInEngine,
  normalizeDummyOpponentConfig,
} from '../engine/dummyOpponentEngine';
import { getBannedReason } from '../data/cardDatabase';
import {
  createReplay,
  createReplayCheckpointsWithWarnings,
  createReplayFileFromGame,
  createReplaySession,
  DEFAULT_REPLAY_CHECKPOINT_INTERVAL,
  applyReplayToIndex,
  jumpReplayToAction,
  jumpReplayToTurn,
  saveReplayToStorage,
  stepReplayBackward,
  stepReplayForward,
  validateReplayFile,
} from '../engine/replayEngine';
import { createAnimationsForAction, scaleReplayAnimations } from '../engine/replayAnimationEngine';
import type { ExportReplayOptions, ReplayAnimationMode, ReplayCheckpoint, ReplayFile, ReplaySession, ReplaySpeed } from '../types/replay';
import { getActiveProfile } from '../engine/profileStorage';
import { canAccessPrivateCard, canControlPlayer, findCardOwner, isPrivateZone } from '../engine/playerPermissions';
import {
  initMultiplayer, createRoom, joinRoom, leaveRoom,
  broadcastState, updatePresence, kickPeer, sendStartGameAck, sendStartGameCommit,
  sendStartGamePrepare, getRoomCode, getPeerId, getPlayerId, getSessionId, getIsHost,
  getSyncStatus, isConfigured,
  submitDeckToHost, setLocalPlayerReady, sendGameActionRequest, requestGameStatePatch,
  type RoomDeckSummary, type RoomPresence, type StartGameAck, type StartGameCommit,
  type StartGamePrepare, type SyncStatus,
} from '../engine/multiplayerSync';
import {
  canHostStartFromLobby,
  createSessionId,
  createStartGamePrepare,
  getOrCreateStablePlayerId,
  validateDeckSubmission,
  type DeckSubmission,
  type GameActionRequestPayload,
  type LobbyState,
} from '../engine/multiplayerProtocol';
import {
  canMoveCommanderToCommandZone,
  getCommanderCastDisabledReason,
  getCommanderTax,
} from '../engine/commanderCasting';

// ─── UI State ─────────────────────────────────────────────────────────────────

export interface UISettings {
  density: 'simple' | 'normal' | 'detailed' | 'judge';
  showMechanicBadges: boolean;
  showCombatMath: boolean;
  collapseLandsByDefault: boolean;
  collapseTokensByDefault: boolean;
  compactHandThreshold: number;
  tokenStackThreshold: number;
  showWarningBadges: boolean;
  showBuildStamp: boolean;
}

export interface UIState {
  screen: 'lobby' | 'game' | 'replay';
  soloModeTab: SoloModeTab;
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
    zone: 'graveyard' | 'exile' | 'library' | 'hand' | 'command';
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
  uiSettingsOpen: boolean;
  judgeMode: boolean;
  battlefieldView: 'normal' | 'overview';
  tableViewMode: 'table' | 'focused' | 'combat' | 'compact';
  settings: UISettings;
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
  playerId: string | null;
  sessionId: string | null;
  isHost: boolean;
  isSpectator: boolean;                 // true when lobby was full on join
  peers: Record<string, RoomPresence>; // all players in room by peerId
  lobby: LobbyState | null;
  configured: boolean;                  // always true for P2P (no env vars needed)
  startHandshake: MultiplayerStartHandshake | null;
}

export interface MultiplayerStartHandshake {
  id: string;
  status: 'preparing' | 'waiting' | 'committing';
  requiredPeerIds: string[];
  ackedPeerIds: string[];
  missingPeerIds: string[];
  startedAt: number;
  deadlineAt: number;
  pendingGame?: GameState;
}

const DEFAULT_MULTIPLAYER: MultiplayerState = {
  status: 'disconnected',
  roomCode: null,
  peerId: null,
  playerId: null,
  sessionId: null,
  isHost: false,
  isSpectator: false,
  peers: {},
  lobby: null,
  configured: false,
  startHandshake: null,
};

const PANEL_SIZES_KEY = 'mtg_sim_panel_sizes';
const UI_SETTINGS_KEY = 'mtg_sim_ui_settings_v1';
const COMBAT_PHASES_FOR_CLEANUP = new Set<Phase>([
  'beginningOfCombat',
  'declareAttackers',
  'declareBlockers',
  'combatDamage',
  'endOfCombat',
]);

function leavesCombatPhase(from: Phase, to: Phase): boolean {
  return COMBAT_PHASES_FOR_CLEANUP.has(from) && !COMBAT_PHASES_FOR_CLEANUP.has(to);
}

const DEFAULT_PANEL_SIZES: UIState['panelSizes'] = {
  left: 220,
  right: 280,
  deckBuilder: 430,
};
export const DEFAULT_UI_SETTINGS: UISettings = {
  density: 'normal',
  showMechanicBadges: true,
  showCombatMath: true,
  collapseLandsByDefault: false,
  collapseTokensByDefault: false,
  compactHandThreshold: 8,
  tokenStackThreshold: 3,
  showWarningBadges: true,
  showBuildStamp: true,
};
const MAX_TOKEN_BATCH = 250;
const START_GAME_ACK_TIMEOUT_MS = 5000;
let startGameHandshakeTimer: ReturnType<typeof setTimeout> | null = null;
let applyingRemoteMultiplayerGame = false;
let hostAuthoritativeActionActorId: string | null = null;

function clearStartGameHandshakeTimer(): void {
  if (startGameHandshakeTimer) {
    clearTimeout(startGameHandshakeTimer);
    startGameHandshakeTimer = null;
  }
}

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

function formatManaPool(mana: Partial<ManaPool>): string {
  const parts = [
    mana.W ? `${mana.W}W` : '',
    mana.U ? `${mana.U}U` : '',
    mana.B ? `${mana.B}B` : '',
    mana.R ? `${mana.R}R` : '',
    mana.G ? `${mana.G}G` : '',
    mana.C ? `${mana.C}C` : '',
    mana.generic ? `${mana.generic}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : '0';
}

function savePanelSizes(sizes: UIState['panelSizes']): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PANEL_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // Storage may be unavailable; resizing should still work for this session.
  }
}

export function normalizeUISettings(value: Partial<UISettings> | undefined | null): UISettings {
  const compactHandThreshold = Number.isFinite(value?.compactHandThreshold)
    ? Math.max(4, Math.min(30, Math.round(value!.compactHandThreshold!)))
    : DEFAULT_UI_SETTINGS.compactHandThreshold;
  const tokenStackThreshold = Number.isFinite(value?.tokenStackThreshold)
    ? Math.max(2, Math.min(20, Math.round(value!.tokenStackThreshold!)))
    : DEFAULT_UI_SETTINGS.tokenStackThreshold;
  const density = value?.density && ['simple', 'normal', 'detailed', 'judge'].includes(value.density)
    ? value.density
    : DEFAULT_UI_SETTINGS.density;
  return {
    ...DEFAULT_UI_SETTINGS,
    ...value,
    density,
    compactHandThreshold,
    tokenStackThreshold,
    showMechanicBadges: value?.showMechanicBadges ?? DEFAULT_UI_SETTINGS.showMechanicBadges,
    showCombatMath: value?.showCombatMath ?? DEFAULT_UI_SETTINGS.showCombatMath,
    collapseLandsByDefault: value?.collapseLandsByDefault ?? DEFAULT_UI_SETTINGS.collapseLandsByDefault,
    collapseTokensByDefault: value?.collapseTokensByDefault ?? DEFAULT_UI_SETTINGS.collapseTokensByDefault,
    showWarningBadges: value?.showWarningBadges ?? DEFAULT_UI_SETTINGS.showWarningBadges,
    showBuildStamp: value?.showBuildStamp ?? DEFAULT_UI_SETTINGS.showBuildStamp,
  };
}

export function loadUISettings(): UISettings {
  if (typeof localStorage === 'undefined') return DEFAULT_UI_SETTINGS;
  try {
    return normalizeUISettings(JSON.parse(localStorage.getItem(UI_SETTINGS_KEY) || '{}') as Partial<UISettings>);
  } catch {
    return DEFAULT_UI_SETTINGS;
  }
}

function saveUISettings(settings: UISettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings persistence should never block gameplay.
  }
}

export function buildStartedGame(game: GameState, now = Date.now()): GameState {
  let next = game;
  for (const player of next.players) {
    if (player.hand.length === 0 && player.library.length > 0) {
      next = drawCards(next, player.id, next.config.startingHandSize);
    }
  }
  const action = createAction(next, next.activePlayerId, 'GAME_START', 'Game started.');
  return {
    ...next,
    rulesetVersion: next.rulesetVersion || DEFAULT_RULESET_VERSION,
    status: 'playing',
    phase: 'main1',
    actionLog: [...next.actionLog, action],
    lastUpdatedAt: now,
  };
}

function withReplayAnimations(session: ReplaySession, actionIndex: number): ReplaySession {
  if (!session.animationEnabled || session.animationMode === 'off' || session.speed === 'instant') {
    return { ...session, currentAnimations: [], animationQueue: [] };
  }
  const action = session.replayFile.actionLog[actionIndex];
  if (!action) return { ...session, currentAnimations: [], animationQueue: [] };
  const before = applyReplayFrame(session.replayFile, actionIndex - 1, session.checkpoints);
  const animations = scaleReplayAnimations(
    createAnimationsForAction(action, before.currentGameState, session.currentGameState, session.replayFile.privacy, session.animationMode),
    session.animationSpeed,
  );
  return { ...session, currentAnimations: animations, animationQueue: animations };
}

function applyReplayFrame(
  replayFile: ReplayFile,
  actionIndex: number,
  checkpoints?: ReplayCheckpoint[],
): { currentGameState: GameState } {
  return applyReplayToIndex(replayFile, actionIndex, checkpoints);
}

export function getRequiredStartAckPeerIds(
  peers: Record<string, RoomPresence>,
  hostPeerId: string | null,
): string[] {
  return Object.values(peers)
    .filter(peer =>
      peer.online &&
      !peer.isSpectator &&
      peer.seatIndex >= 0 &&
      peer.peerId !== hostPeerId
    )
    .map(peer => peer.peerId)
    .sort();
}

function canLocalControlPlayer(state: GameStore, playerId: string): boolean {
  return canControlPlayer(
    hostAuthoritativeActionActorId ?? state.localPlayerId,
    playerId,
    state.multiplayer.isSpectator ? 'spectator' : state.multiplayer.status,
    state.ui.judgeMode,
  );
}

function canLocalAccessCard(state: GameStore, card: CardState | undefined): boolean {
  const viewerId = hostAuthoritativeActionActorId ?? state.localPlayerId;
  return canAccessPrivateCard(
    state.game,
    card,
    viewerId,
    state.multiplayer.isSpectator ? 'spectator' : state.multiplayer.status,
    state.ui.judgeMode,
  );
}

function canLocalControlCard(state: GameStore, card: CardState | undefined): boolean {
  if (!card) return false;
  return canLocalControlPlayer(state, findCardOwner(state.game, card) ?? card.controllerId);
}

function warnBlockedPrivateZoneAction(
  action: string,
  data: { card?: CardState; ownerId?: string | null; targetPlayerId?: string | null; zone?: CardState['zone'] },
): void {
  if (import.meta.env?.DEV !== true) return;
  console.warn('[permissions] blocked private-zone action', {
    action,
    zone: data.zone ?? data.card?.zone,
    ownerId: data.ownerId ?? (data.card ? findCardOwner(useGameStore.getState().game, data.card) : null),
    targetPlayerId: data.targetPlayerId,
  });
}

function canLocalPerformPrivateCardAction(state: GameStore, action: string, card: CardState | undefined): boolean {
  if (!card) return false;
  if (!isPrivateZone(card.zone)) return true;
  const ownerId = findCardOwner(state.game, card) ?? card.controllerId;
  const allowed = canLocalControlPlayer(state, ownerId);
  if (!allowed) warnBlockedPrivateZoneAction(action, { card, ownerId });
  return allowed;
}

function canLocalPerformPrivatePlayerAction(state: GameStore, action: string, playerId: string, zone: CardState['zone']): boolean {
  const allowed = canLocalControlPlayer(state, playerId);
  if (!allowed) warnBlockedPrivateZoneAction(action, { ownerId: playerId, targetPlayerId: playerId, zone });
  return allowed;
}

function debugStoreMultiplayer(event: string, data?: Record<string, unknown>): void {
  const debugEnabled = import.meta.env?.DEV === true ||
    (typeof localStorage !== 'undefined' && localStorage.getItem('on-da-stack-debug') === '1');
  if (!debugEnabled) return;
  console.debug(`[multiplayer] ${event}`, data ?? {});
}

const DEFAULT_UI: UIState = {
  screen: 'lobby',
  soloModeTab: 'builder',
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
  uiSettingsOpen: false,
  judgeMode: false,
  battlefieldView: 'normal',
  tableViewMode: 'table',
  settings: loadUISettings(),
  assistantMessages: [],
  actionFilter: '',
  panelSizes: loadPanelSizes(),
};

function shouldRouteToHostAuthoritativeAction(state: GameStore): boolean {
  if (state.ui.screen === 'replay') return false;
  return state.multiplayer.status === 'joined' && !applyingRemoteMultiplayerGame;
}

function routeHostAuthoritativeAction(actionType: string, params: Record<string, unknown>): boolean {
  return sendGameActionRequest(actionType, params);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function applyHostAuthoritativeGameActionRequest(
  request: GameActionRequestPayload,
  presence: RoomPresence,
): boolean {
  const state = useGameStore.getState();
  if (state.multiplayer.status !== 'host' || presence.isSpectator || presence.seatIndex < 0) return false;
  const actor = state.game.players[presence.seatIndex];
  if (!actor) return false;

  const params = request.params ?? {};
  const requestedPlayerId = asString(params.playerId);
  if (requestedPlayerId && requestedPlayerId !== actor.id) return false;

  const previousActor = hostAuthoritativeActionActorId;
  hostAuthoritativeActionActorId = actor.id;
  try {
    const store = useGameStore.getState();
    switch (request.actionType) {
      case 'activateClue':
        return store.activateClue(asString(params.instanceId) ?? '', params.options as { confirmPayment?: boolean } | undefined);
      case 'markExhaustUsed':
        return store.markExhaustUsed(asString(params.instanceId) ?? '', asString(params.exhaustId));
      case 'resetExhaust':
        return store.resetExhaust(asString(params.instanceId) ?? '', asString(params.exhaustId));
      case 'applyAirbend':
        return store.applyAirbend(asString(params.targetId) ?? '', asString(params.sourceId));
      case 'markCastForWarp':
        return store.markCastForWarp(asString(params.cardId) ?? '', asString(params.warpCost));
      case 'castExiledWithPermission':
        return store.castExiledWithPermission(actor.id, asString(params.instanceId) ?? '');
      case 'castCommanderFromCommandZone':
        return store.castCommanderFromCommandZone(actor.id, asString(params.commanderInstanceId) ?? '');
      case 'moveCommanderToCommandZone':
        return store.moveCommanderToCommandZone(actor.id, asString(params.commanderInstanceId) ?? '', asString(params.fromZone) as CardState['zone'] | undefined);
      case 'payWaterbendCost':
        return store.payWaterbendCost(actor.id, asNumber(params.amount) ?? 0, asStringArray(params.permanentIds), asString(params.sourceId));
      case 'applyEarthbend':
        return store.applyEarthbend(actor.id, asString(params.landId) ?? '', asNumber(params.amount) ?? 0, asString(params.sourceId));
      case 'stationSpacecraft':
        return store.stationSpacecraft(actor.id, asString(params.spacecraftId) ?? '', asString(params.creatureId) ?? '');
      case 'stationSpacecraftManual':
        return store.stationSpacecraftManual(actor.id, asString(params.spacecraftId) ?? '', asString(params.creatureId) ?? '', asNumber(params.amount) ?? 0);
      case 'applyBlight':
        return store.applyBlight(actor.id, asString(params.creatureId) ?? '', asNumber(params.amount) ?? 0, asString(params.sourceId));
      case 'levelUpClass':
        return store.levelUpClass(actor.id, asString(params.cardId) ?? '');
      case 'setClassLevel':
        return store.setClassLevel(actor.id, asString(params.cardId) ?? '', asNumber(params.level) ?? 1, false);
      case 'declareTokenStackAttack':
        return store.declareTokenStackAttack(
          actor.id,
          asString(params.sourceGroupId) ?? '',
          asStringArray(params.attackerIds),
          Array.isArray(params.assignments) ? params.assignments as Parameters<GameStore['declareTokenStackAttack']>[3] : [],
        );
      case 'castWithSneak':
        return store.castWithSneak(actor.id, asString(params.cardId) ?? '', asString(params.returnedAttackerId));
      case 'generateCombatPreview':
        store.generateCombatPreview();
        return true;
      case 'clearCombatPreview':
        store.clearCombatPreview();
        return true;
      case 'confirmCombatDamage':
        store.confirmCombatDamage();
        return true;
      case 'setPowerToughnessOverride':
        return store.setPowerToughnessOverride(
          asStringArray(params.instanceIds),
          asString(params.power),
          asString(params.toughness),
          asString(params.expires) as PowerToughnessOverrideExpiration | undefined,
          asString(params.reason),
        );
      case 'clearPowerToughnessOverride':
        return store.clearPowerToughnessOverride(asStringArray(params.instanceIds));
      case 'addCounterToCard':
        store.addCounterToCard(asString(params.instanceId) ?? '', asString(params.counterType) ?? '', asNumber(params.amount) ?? 1);
        return true;
      case 'removeCounterFromCard':
        store.removeCounterFromCard(asString(params.instanceId) ?? '', asString(params.counterType) ?? '', asNumber(params.amount) ?? 1);
        return true;
      case 'setCardTemporaryNote':
        return store.setCardTemporaryNote(asString(params.instanceId) ?? '', asString(params.note) ?? '');
      case 'setMarkedDamage':
        return store.setMarkedDamage(asString(params.instanceId) ?? '', asNumber(params.amount) ?? 0);
      case 'clearMarkedDamage':
        return store.clearMarkedDamage(asString(params.instanceId) ?? '');
      case 'setManualCombatRole':
        return store.setManualCombatRole(asString(params.instanceId) ?? '', asString(params.role) as CardState['combatRole']);
      case 'setCardController':
        return store.setCardController(asString(params.instanceId) ?? '', actor.id);
      case 'addManualTriggerForCard':
        return store.addManualTriggerForCard(asString(params.instanceId) ?? '', asString(params.text) ?? '');
      default:
        return false;
    }
  } finally {
    hostAuthoritativeActionActorId = previousActor;
  }
}

// ─── Store Interface ──────────────────────────────────────────────────────────

export interface GameStore {
  game: GameState;
  ui: UIState;
  replay: ReplaySession | null;
  replayLiveGame: GameState | null;
  multiplayer: MultiplayerState;
  decks: Deck[];
  soloDeckLab: SoloDeckLabState;
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
  setMultiplayerReady: (ready: boolean) => void;
  requestMultiplayerGamePatch: (reason?: string) => boolean;

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
  beginMultiplayerGameStart: () => void;
  voteToStartMultiplayerGame: () => void;
  handleMultiplayerStartPrepare: (prepare: StartGamePrepare) => void;
  handleMultiplayerStartAck: (ack: StartGameAck) => void;
  commitMultiplayerGameStart: (fallback?: boolean) => void;
  resetGame: () => void;

  castCard: (castingPlayerId: string, cardInstanceId: string, targets?: { ids?: string[]; labels?: string[] }) => void;
  castCommanderFromCommandZone: (playerId: string, commanderInstanceId: string, options?: { manualWarning?: string }) => boolean;
  moveCommanderToCommandZone: (playerId: string, commanderInstanceId: string, fromZone?: CardState['zone']) => boolean;
  playLand: (playerId: string, cardInstanceId: string, faceIndex?: number) => void;
  moveCardToZone: (instanceId: string, toZone: CardState['zone'], toController?: string) => void;
  tapCard: (instanceId: string) => void;
  untapCard: (instanceId: string) => void;
  tapCards: (instanceIds: string[]) => void;
  untapCards: (instanceIds: string[]) => void;
  tapAllLands: (playerId: string) => void;
  untapAll: (playerId: string) => void;
  setManaPool: (playerId: string, mana: Partial<ManaPool>) => void;
  addManaToPool: (playerId: string, mana: Partial<ManaPool>) => void;
  spendManaFromPool: (playerId: string, mana: Partial<ManaPool>) => void;
  clearManaPool: (playerId: string) => void;
  takeMulligan: (playerId: string) => void;
  tutorCard: (playerId: string, instanceId: string, fromZone?: CardState['zone']) => void;
  removeAllCountersFromCard: (instanceId: string, counterType?: string) => void;
  addCounterToCard: (instanceId: string, counterType: string, amount?: number) => void;
  removeCounterFromCard: (instanceId: string, counterType: string, amount?: number) => void;
  setCardTemporaryNote: (instanceId: string, note: string) => boolean;
  setMarkedDamage: (instanceId: string, amount: number) => boolean;
  clearMarkedDamage: (instanceId: string) => boolean;
  setManualCombatRole: (instanceId: string, role: CardState['combatRole']) => boolean;
  setCardController: (instanceId: string, controllerId: string) => boolean;
  setCardOwner: (instanceId: string, ownerId: string) => boolean;
  addManualTriggerForCard: (instanceId: string, text: string) => boolean;
  attachCard: (attachmentId: string, targetId: string) => void;
  detachCard: (attachmentId: string) => void;
  transformCard: (instanceId: string) => void;
  createTokenCard: (controllerId: string, tokenDef: Parameters<typeof createToken>[2]) => void;
  createTokenCards: (controllerId: string, tokenDef: Parameters<typeof createToken>[2], count?: number) => string[];
  activateClue: (instanceId: string, options?: { confirmPayment?: boolean }) => boolean;
  markExhaustUsed: (instanceId: string, exhaustId?: string) => boolean;
  resetExhaust: (instanceId: string, exhaustId?: string) => boolean;
  applyAirbend: (targetId: string, sourceId?: string) => boolean;
  markCastForWarp: (cardId: string, warpCost?: string) => boolean;
  castExiledWithPermission: (playerId: string, instanceId: string) => boolean;
  getWaterbendEligiblePermanents: (playerId: string) => CardState[];
  payWaterbendCost: (playerId: string, amount: number, permanentIds: string[], sourceId?: string) => boolean;
  applyEarthbend: (playerId: string, landId: string, amount: number, sourceId?: string) => boolean;
  getStationEligibleCreatures: (playerId: string, spacecraftId: string) => CardState[];
  stationSpacecraft: (playerId: string, spacecraftId: string, creatureId: string) => boolean;
  stationSpacecraftManual: (playerId: string, spacecraftId: string, creatureId: string, amount: number) => boolean;
  applyBlight: (playerId: string, creatureId: string, amount: number, sourceId?: string) => boolean;
  getVividColorCount: (playerId: string) => number;
  levelUpClass: (playerId: string, cardId: string) => boolean;
  setClassLevel: (playerId: string, cardId: string, level: number, judgeOverride?: boolean) => boolean;
  getSneakReturnCandidates: (playerId: string) => { attackerId: string; assignmentId: string; sourceName: string }[];
  canCastWithSneak: (playerId: string, cardId: string) => boolean;
  castWithSneak: (playerId: string, cardId: string, returnedAttackerId?: string) => boolean;
  setPowerToughnessOverride: (
    instanceIds: string[],
    power?: string,
    toughness?: string,
    expires?: PowerToughnessOverrideExpiration,
    reason?: string,
  ) => boolean;
  clearPowerToughnessOverride: (instanceIds: string[]) => boolean;

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
  declareTokenStackAttack: (
    playerId: string,
    sourceGroupId: string,
    attackerIds: string[],
    assignments: TokenStackAttackInput[],
  ) => boolean;
  /** Trigger Myriad for an attacker: create token copies attacking each OTHER opponent. */
  declareMyriadAttack: (
    attackerInstanceId: string,
    declaredDefenderId: string,
    copiesPerOpponent: number,
  ) => { copyInstanceId: string; targetPlayerId: string }[];
  declareBlock: (blockerInstanceId: string, attackerInstanceId: string) => void;
  generateCombatPreview: () => CombatDamagePreview;
  clearCombatPreview: () => void;
  confirmCombatDamage: () => void;
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
    zone: 'graveyard' | 'exile' | 'library' | 'hand' | 'command',
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
  setUiSettingsOpen: (open: boolean) => void;
  updateUISettings: (settings: Partial<UISettings>) => void;
  saveReplay: (name?: string) => void;
  exportReplayFile: (options: ExportReplayOptions) => ReplayFile;
  loadReplayFile: (file: File | string | unknown) => Promise<boolean>;
  startReplay: () => void;
  exitReplay: () => void;
  replayStepForward: () => void;
  replayStepBackward: () => void;
  replayJumpToAction: (actionIndex: number) => void;
  replayJumpToTurn: (turnNumber: number) => void;
  replayPlay: () => void;
  replayPause: () => void;
  replaySetSpeed: (speed: ReplaySpeed) => void;
  replaySetAnimationMode: (mode: ReplayAnimationMode) => void;
  replaySetAnimationSpeed: (speed: number) => void;
  replayPlayCurrentAnimation: () => void;
  replaySkipAnimation: () => void;
  replayClearAnimations: () => void;
  setJudgeMode: (on: boolean) => void;
  setTableViewMode: (mode: UIState['tableViewMode']) => void;
  toggleBattlefieldView: () => void;
  toggleCombatMode: () => void;
  enterGameScreen: () => void;
  setLobbyOpen: (open: boolean) => void;
  setDeckBuilderOpen: (open: boolean) => void;
  openSoloDeckLab: () => void;
  setSoloModeTab: (tab: SoloModeTab) => void;
  loadSoloDeck: (deck: Deck) => void;
  createSoloDraftDeck: (name?: string) => void;
  setSoloDraftDeck: (deck: Deck, options?: { unsaved?: boolean }) => void;
  saveSoloDraftDeck: () => boolean;
  importSoloDeckText: (text: string, name?: string) => Promise<boolean>;
  renameSoloDeck: (deckId: string, name: string) => boolean;
  deleteSoloDeck: (deckId: string) => boolean;
  duplicateSoloDeck: (deckId: string) => string | undefined;
  drawSoloOpeningHand: () => boolean;
  mulliganSoloOpeningHand: () => boolean;
  setSoloOpeningHandCardsToBottom: (cardIds: string[]) => boolean;
  keepSoloOpeningHand: (cardIdsToBottom?: string[]) => boolean;
  newSoloOpeningHand: () => boolean;
  startSoloGoldfishGame: (
    options?: {
      player?: {
        id?: string;
        name?: string;
        color?: string;
        avatarInitial?: string;
        avatarStyle?: Player['avatarStyle'];
        avatarImage?: PlayerAvatarImage;
      };
      startingLife?: number;
      houseRules?: HouseRule[];
      randomOpeningHand?: boolean;
      fromKeptHand?: boolean;
    },
  ) => Promise<boolean>;
  resetSoloGoldfishGame: (
    options?: {
      player?: {
        id?: string;
        name?: string;
        color?: string;
        avatarInitial?: string;
        avatarStyle?: Player['avatarStyle'];
        avatarImage?: PlayerAvatarImage;
      };
      startingLife?: number;
      houseRules?: HouseRule[];
    },
  ) => Promise<boolean>;
  canUseSoloSandboxTools: () => boolean;
  sandboxDrawCards: (count?: number) => boolean;
  sandboxRevealTopCards: (count?: number) => boolean;
  sandboxSearchLibrary: () => boolean;
  sandboxShuffleLibrary: () => boolean;
  sandboxCreateToken: (name?: string, count?: number, power?: string, toughness?: string) => string[];
  sandboxSetLifeTotal: (life: number) => boolean;
  sandboxAddCounter: (instanceId: string, counterType: string, amount?: number) => boolean;
  sandboxRemoveCounter: (instanceId: string, counterType: string, amount?: number) => boolean;
  sandboxSetPowerToughnessOverride: (
    instanceIds: string[],
    power?: string,
    toughness?: string,
    reason?: string,
    expires?: PowerToughnessOverrideExpiration,
  ) => boolean;
  sandboxClearPowerToughnessOverride: (instanceIds: string[]) => boolean;
  sandboxMoveCardToZone: (instanceId: string, zone: CardState['zone']) => boolean;
  sandboxAddManaNote: (text: string) => boolean;
  sandboxForcePhase: (phase: Phase) => boolean;
  sandboxAdvanceTurn: () => boolean;
  sandboxResetBoard: () => boolean;
  sandboxAddManualTrigger: (instanceId: string, text: string) => boolean;
  sandboxSetCardNote: (instanceId: string, note: string) => boolean;
  startSoloDummyPracticeGame: (
    dummyOpponents: Partial<DummyOpponentConfig>[],
    options?: {
      player?: {
        id?: string;
        name?: string;
        color?: string;
        avatarInitial?: string;
        avatarStyle?: Player['avatarStyle'];
        avatarImage?: PlayerAvatarImage;
      };
      startingLife?: number;
      houseRules?: HouseRule[];
    },
  ) => Promise<boolean>;
  removeDummyOpponent: (dummyPlayerId: string) => boolean;
  autoBlockForDummy: (dummyPlayerId: string) => boolean;
  advanceDummyTurn: (dummyPlayerId: string) => boolean;
  startSoloGameFromOpeningHand: (
    options?: {
      player?: {
        id?: string;
        name?: string;
        color?: string;
        avatarInitial?: string;
        avatarStyle?: Player['avatarStyle'];
        avatarImage?: PlayerAvatarImage;
      };
      startingLife?: number;
      houseRules?: HouseRule[];
    },
  ) => Promise<boolean>;
  startSoloDeckLabGame: (
    mode?: SoloTestMode,
    options?: {
      player?: {
        id?: string;
        name?: string;
        color?: string;
        avatarInitial?: string;
        avatarStyle?: Player['avatarStyle'];
        avatarImage?: PlayerAvatarImage;
      };
      startingLife?: number;
      houseRules?: HouseRule[];
    },
  ) => Promise<boolean>;
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

function canUseSoloSandboxToolsState(state: GameStore): boolean {
  if (state.ui.screen === 'replay') return false;
  if (state.ui.judgeMode) return true;
  return state.ui.screen === 'game'
    && state.multiplayer.status === 'disconnected'
    && state.game.config.playerCount === 1
    && state.game.players.length === 1;
}

function getSoloSandboxPlayer(state: GameStore): Player | undefined {
  return state.game.players.find(player => player.id === state.localPlayerId) ?? state.game.players[0];
}

function sanitizeSandboxCount(count: number | undefined, fallback = 1): number {
  return Math.max(0, Math.floor(Number.isFinite(count ?? NaN) ? Number(count) : fallback));
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
  const prepared = prepareCommanderDeckForUse(deck);
  return {
    id: prepared.deck.id,
    name: prepared.deck.name || 'Loaded deck',
    cardCount: prepared.totalCommanderCount,
    commanders: prepared.deck.commanders.slice(0, 2),
    deckHash: prepared.deckHash,
    status: prepared.valid ? 'valid' : 'rejected',
    errors: prepared.errors,
    warnings: prepared.warnings,
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

export function resolveLocalPlayerIdFromPresence(
  game: Pick<GameState, 'players'>,
  peers: Record<string, RoomPresence>,
  peerId: string | null | undefined,
  fallback = '',
  fallbackPlayerId = '',
  fallbackSessionId = '',
): string {
  const selfEntry = resolveSelfPresenceFromPeers(peers, peerId, fallbackPlayerId, fallbackSessionId);
  const self = selfEntry?.presence;
  if (!self) return fallback;
  if (self.isSpectator) return '';
  return game.players[self.seatIndex]?.id ?? fallback;
}

function resolveSelfPresenceFromPeers(
  peers: Record<string, RoomPresence>,
  peerId: string | null | undefined,
  fallbackPlayerId = '',
  fallbackSessionId = '',
): { peerId: string; presence: RoomPresence } | null {
  if (peerId && peers[peerId]) {
    return { peerId, presence: peers[peerId] };
  }

  const exactIdentityMatch = fallbackPlayerId && fallbackSessionId
    ? Object.entries(peers).find(([, presence]) => presence.playerId === fallbackPlayerId && presence.sessionId === fallbackSessionId)
    : undefined;
  if (exactIdentityMatch) {
    const [matchedPeerId, presence] = exactIdentityMatch;
    return { peerId: matchedPeerId, presence };
  }

  return null;
}

function normalizePresencePlayerCount(game: GameState, peers: Record<string, RoomPresence>): 2 | 3 | 4 | 5 | 6 {
  const highestOccupiedSeat = Math.max(
    -1,
    ...Object.values(peers)
      .filter(peer => peer.online && !peer.isSpectator && peer.seatIndex >= 0)
      .map(peer => peer.seatIndex),
  );
  const count = Math.max(2, game.config.playerCount || 0, highestOccupiedSeat + 1);
  return Math.min(6, Math.max(2, count)) as 2 | 3 | 4 | 5 | 6;
}

export function ensureGameHasSeatsForPresence(game: GameState, peers: Record<string, RoomPresence>): GameState {
  const hasSeatedPeer = Object.values(peers).some(peer => peer.online && !peer.isSpectator && peer.seatIndex >= 0);
  if (!hasSeatedPeer) return game;

  const playerCount = normalizePresencePlayerCount(game, peers);
  if (game.players.length >= playerCount) return syncGamePlayerMetadataFromPresence(game, peers);

  const config = { ...game.config, playerCount };
  const peerBySeat = new Map(
    Object.values(peers)
      .filter(peer => peer.online && !peer.isSpectator && peer.seatIndex >= 0 && peer.seatIndex < playerCount)
      .map(peer => [peer.seatIndex, peer]),
  );
  const players = Array.from({ length: playerCount }, (_, index) => {
    const existing = game.players[index];
    const peer = peerBySeat.get(index);
    const base = existing ?? createPlayer(
      `seat-${index + 1}-${crypto.randomUUID()}`,
      peer?.name ?? `Open Seat ${index + 1}`,
      index,
      peer?.color ?? PLAYER_COLORS[index] ?? '#3b82f6',
      config,
      {
        initial: peer?.avatarInitial,
        style: peer?.avatarStyle,
        image: peer?.avatarImage,
      },
    );
    return {
      ...base,
      name: peer?.name ?? base.name,
      color: peer?.color ?? base.color,
      avatarInitial: peer?.avatarInitial ?? base.avatarInitial,
      avatarStyle: peer?.avatarStyle ?? base.avatarStyle,
      avatarImage: peer?.avatarImage ?? base.avatarImage,
      seatIndex: index,
      isActive: index === 0,
      hasPriority: index === 0,
    };
  });

  return {
    ...game,
    config,
    players,
    activePlayerId: game.activePlayerId || players[0]?.id || '',
    priorityPlayerId: game.priorityPlayerId || players[0]?.id || '',
  };
}

export const useGameStore = create<GameStore>()((set, get) => ({
  game: createEmptyGameState(createDefaultGameConfig(4)),
  ui: DEFAULT_UI,
  replay: null,
  replayLiveGame: null,
  multiplayer: { ...DEFAULT_MULTIPLAYER, configured: isConfigured() },
  decks: loadDecksFromStorage(),
  soloDeckLab: {},
  localPlayerId: '',

  // ── Multiplayer ────────────────────────────────────────────────────────

  initMultiplayerListeners: () => {
    initMultiplayer(
      // onGameUpdate — remote peer pushed a new GameState
      (game: GameState) => {
        const { multiplayer, localPlayerId: currentLocalPlayerId } = get();
        const status = multiplayer.status;
        const remoteHostStateIsAuthoritative = status === 'connecting' || status === 'joined' || status === 'migrating';
        if (remoteHostStateIsAuthoritative || game.lastUpdatedAt > get().game.lastUpdatedAt) {
          const syncedGame = ensureGameHasSeatsForPresence(game, multiplayer.peers);
          const localPlayerId = resolveLocalPlayerIdFromPresence(
            syncedGame,
            multiplayer.peers,
            multiplayer.peerId,
            currentLocalPlayerId,
            multiplayer.playerId ?? '',
            multiplayer.sessionId ?? '',
          );
          if (syncedGame.status === 'playing') {
            debugStoreMultiplayer('joiner received GAME_STATE_PATCH with status playing', {
              gameId: syncedGame.id,
              localPlayerId,
            });
          }
          applyingRemoteMultiplayerGame = true;
          set(s => ({
            game: syncedGame,
            localPlayerId,
            multiplayer: syncedGame.status === 'playing' && s.multiplayer.lobby
              ? {
                ...s.multiplayer,
                lobby: { ...s.multiplayer.lobby, status: 'playing', updatedAt: Date.now() },
              }
              : s.multiplayer,
            ui: syncedGame.status === 'lobby'
              ? { ...s.ui, screen: 'lobby', lobbyOpen: true }
              : s.ui,
          }));
          if (syncedGame.status === 'playing') get().enterGameScreen();
          applyingRemoteMultiplayerGame = false;
          if (syncedGame.status === 'playing') {
            const applied = useGameStore.getState();
            debugStoreMultiplayer('joiner state after apply', {
              screen: applied.ui.screen,
              lobbyOpen: applied.ui.lobbyOpen,
              gameStatus: applied.game.status,
              localPlayerId: applied.localPlayerId,
            });
          }
        }
      },
      // onPresenceUpdate — someone joined/left
      (peers: Record<string, RoomPresence>) => {
        set(s => {
          const game = ensureGameHasSeatsForPresence(s.game, peers);
          const selfEntry = resolveSelfPresenceFromPeers(
            peers,
            s.multiplayer.peerId,
            s.multiplayer.playerId ?? '',
            s.multiplayer.sessionId ?? '',
          );
          const self = selfEntry?.presence;
          const resolvedPeerId = selfEntry?.peerId ?? s.multiplayer.peerId;
          const localPlayerId = resolveLocalPlayerIdFromPresence(
            game,
            peers,
            resolvedPeerId,
            s.localPlayerId,
            s.multiplayer.playerId ?? '',
            s.multiplayer.sessionId ?? '',
          );
          return {
            game,
            localPlayerId,
            multiplayer: {
              ...s.multiplayer,
              peerId: resolvedPeerId,
              peers,
              isSpectator: self?.isSpectator ?? s.multiplayer.isSpectator,
            },
          };
        });
      },
      // onStatusChange
      (status: SyncStatus) => {
        if (status === 'disconnected') {
          clearStartGameHandshakeTimer();
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
      (prepare: StartGamePrepare) => get().handleMultiplayerStartPrepare(prepare),
      (ack: StartGameAck) => get().handleMultiplayerStartAck(ack),
      (commit: StartGameCommit) => {
        if (!commit.game) return;
        clearStartGameHandshakeTimer();
        const committedGame: GameState = { ...commit.game, status: 'playing' };
        const syncedGame = ensureGameHasSeatsForPresence(committedGame, get().multiplayer.peers);
        const localPlayerId = resolveLocalPlayerIdFromPresence(
          syncedGame,
          get().multiplayer.peers,
          get().multiplayer.peerId,
          get().localPlayerId,
          get().multiplayer.playerId ?? '',
          get().multiplayer.sessionId ?? '',
        );
        debugStoreMultiplayer('joiner applying game screen', {
          commitId: commit.id,
          gameId: commit.gameId ?? syncedGame.id,
          status: syncedGame.status,
          localPlayerId,
        });
        applyingRemoteMultiplayerGame = true;
        set(s => ({
          game: syncedGame,
          localPlayerId,
          multiplayer: {
            ...s.multiplayer,
            lobby: s.multiplayer.lobby
              ? { ...s.multiplayer.lobby, status: 'playing', updatedAt: Date.now() }
              : s.multiplayer.lobby,
            startHandshake: null,
          },
        }));
        get().enterGameScreen();
        applyingRemoteMultiplayerGame = false;
        const applied = useGameStore.getState();
        debugStoreMultiplayer('joiner state after apply', {
          screen: applied.ui.screen,
          lobbyOpen: applied.ui.lobbyOpen,
          gameStatus: applied.game.status,
          localPlayerId: applied.localPlayerId,
        });
      },
      (lobby: LobbyState) => {
        set(s => ({ multiplayer: { ...s.multiplayer, lobby } }));
        const applied = useGameStore.getState();
        debugStoreMultiplayer('joiner lobby state after apply', {
          lobbyStatus: applied.multiplayer.lobby?.status ?? 'none',
          screen: applied.ui.screen,
          gameStatus: applied.game.status,
          multiplayerStatus: applied.multiplayer.status,
        });
      },
      (submission: DeckSubmission, presence: RoomPresence) => {
        void (async () => {
          const state = useGameStore.getState();
          if (state.multiplayer.status !== 'host' || presence.isSpectator || presence.seatIndex < 0) return;
          const targetPlayer = state.game.players[presence.seatIndex];
          if (!targetPlayer) return;
          const validation = validateDeckSubmission(submission);
          if (!validation.valid) return;
          const submittedDeck: Deck = {
            id: submission.deckId,
            name: submission.deckName,
            format: 'commander',
            commanders: submission.commanderNames,
            cards: submission.cards,
            sideboard: [],
            maybeboard: [],
            colorIdentity: [],
            importedAt: submission.submittedAt,
          };
          const nextGame = await loadDeckIntoPlayer(state.game, targetPlayer.id, normalizeCommanderDeck(submittedDeck));
          set({ game: nextGame });
        })();
      },
      (request: GameActionRequestPayload, presence: RoomPresence) => {
        if (applyHostAuthoritativeGameActionRequest(request, presence)) return;
        const state = useGameStore.getState();
        if (state.multiplayer.status !== 'host') return;
        const actor = state.game.players[presence.seatIndex];
        const action = createAction(
          state.game,
          actor?.id ?? state.game.activePlayerId,
          'OTHER',
          `Rejected or manual-only multiplayer action request: ${request.actionType}`,
          [],
          { ...request.params, multiplayerSync: 'manual_or_unsupported' },
        );
        set({ game: { ...state.game, actionLog: [...state.game.actionLog, action], lastUpdatedAt: Date.now() } });
      },
    );
  },

  createMultiplayerRoom: async (hostName, hostColor, seatIndex, avatar, asSpectator = false) => {
    const { game, decks } = get();
    const lobbyGame: GameState = { ...game, status: 'lobby' };
    const sessionId = createSessionId();
    const identityPlayerId = getOrCreateStablePlayerId();
    const peerId = `pending-host-${crypto.randomUUID()}`;
    const assignedSeatIndex = asSpectator ? -1 : Math.max(0, seatIndex);
    const localGamePlayerId = lobbyGame.players[assignedSeatIndex]?.id ?? '';
    const code = await createRoom(lobbyGame, {
      playerId: identityPlayerId,
      peerId,
      sessionId,
      name: hostName,
      color: hostColor,
      avatarInitial: avatar?.initial,
      avatarStyle: avatar?.style,
      avatarImage: avatar?.image,
      seatIndex: assignedSeatIndex,
      isSpectator: asSpectator,
      deck: asSpectator ? undefined : findLoadedDeckSummary(localGamePlayerId, lobbyGame, decks),
    });
    const actualPeerId = getPeerId() ?? peerId;
    set(s => ({
      game: lobbyGame,
      localPlayerId: asSpectator ? '' : (lobbyGame.players[assignedSeatIndex]?.id ?? lobbyGame.players[0]?.id ?? ''),
      multiplayer: {
        ...s.multiplayer,
        status: 'host',
        roomCode: code,
        peerId: actualPeerId,
        playerId: identityPlayerId,
        sessionId,
        isHost: true,
        isSpectator: asSpectator,
        configured: true,
      },
      ui: { ...s.ui, screen: 'lobby', lobbyOpen: true },
    }));
    return code;
  },

  joinMultiplayerRoom: async (code, peerName, peerColor, seatIndex, avatar, asSpectator = false) => {
    const sessionId = createSessionId();
    const identityPlayerId = getOrCreateStablePlayerId();
    const peerId = `pending-join-${crypto.randomUUID()}`;
    const requestedSeatIndex = asSpectator ? -1 : Math.max(0, seatIndex);
    const current = get();
    const requestedPlayerId = current.game.players[requestedSeatIndex]?.id ?? '';
    const { game: remoteGame, peerId: joinedPeerId, peers: joinedPeers, isSpectator, seatIndex: assignedSeatIndex } = await joinRoom(code, {
      playerId: identityPlayerId,
      peerId,
      sessionId,
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
    const selfEntry = resolveSelfPresenceFromPeers(joinedPeers, joinedPeerId, identityPlayerId, sessionId);
    const resolvedPeerId = selfEntry?.peerId ?? joinedPeerId;
    const self = selfEntry?.presence;
    const resolvedGame = ensureGameHasSeatsForPresence(remoteGame ?? currentGame, joinedPeers);
    const localSeatIndex = self && !self.isSpectator ? self.seatIndex : assignedSeatIndex;
    // Spectators get no local player id — they observe only
    const localGamePlayerId = (self?.isSpectator ?? isSpectator)
      ? ''
      : (resolvedGame.players[localSeatIndex]?.id ?? resolvedGame.players[0]?.id ?? '');
    set(s => ({
      game: resolvedGame,
      localPlayerId: localGamePlayerId,
      multiplayer: {
        ...s.multiplayer,
        status: 'joined',
        roomCode: code.toUpperCase(),
        peerId: resolvedPeerId,
        playerId: identityPlayerId,
        sessionId,
        peers: joinedPeers,
        isHost: false,
        isSpectator: self?.isSpectator ?? isSpectator,
        configured: true,
      },
      ui: { ...s.ui, screen: 'lobby', lobbyOpen: true },
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
    const selfEntry = resolveSelfPresenceFromPeers(
      current.multiplayer.peers,
      current.multiplayer.peerId,
      current.multiplayer.playerId ?? '',
      current.multiplayer.sessionId ?? '',
    );
    const peerId = selfEntry?.peerId ?? current.multiplayer.peerId;
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
          peerId: peerId ?? s.multiplayer.peerId,
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

  setMultiplayerReady: (ready) => {
    const accepted = setLocalPlayerReady(ready);
    if (!accepted) return;
    set(s => {
      const selfEntry = resolveSelfPresenceFromPeers(
        s.multiplayer.peers,
        s.multiplayer.peerId,
        s.multiplayer.playerId ?? '',
        s.multiplayer.sessionId ?? '',
      );
      const peerId = selfEntry?.peerId ?? s.multiplayer.peerId;
      const self = peerId ? s.multiplayer.peers[peerId] : undefined;
      if (!peerId || !self) return s;
      const authoritativeStatus = s.multiplayer.lobby?.submittedDecks?.[self.playerId]?.status;
      const canReady = ready ? authoritativeStatus === 'valid' || self.deckStatus === 'valid' || self.deck?.status === 'valid' : true;
      return {
        multiplayer: {
          ...s.multiplayer,
          peers: {
            ...s.multiplayer.peers,
            [peerId]: { ...self, ready: canReady ? ready : false, lastSeen: Date.now() },
          },
        },
      };
    });
  },

  requestMultiplayerGamePatch: (reason = 'lobby-fallback-button') => requestGameStatePatch(reason),

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
    const prepared = prepareCommanderDeckForUse(deck);
    const canonicalDeck = prepared.deck;
    const newState = await loadDeckIntoPlayer(get().game, playerId, canonicalDeck);
    const flags = getLoadedBannedCardFlags(newState, playerId);
    set({ game: newState, ui: withAssistantMessages(get().ui, newState, flags) });
    const state = get();
    if (
      state.multiplayer.peerId &&
      playerId === state.localPlayerId &&
      ['host', 'joined', 'migrating'].includes(state.multiplayer.status)
    ) {
      const submitted = submitDeckToHost(canonicalDeck);
      if (submitted && state.multiplayer.status === 'host') return;
      state.updateMultiplayerPresence({
        deck: submitted
          ? {
            ...createRoomDeckSummary(canonicalDeck),
            deckHash: submitted.deckHash,
            status: 'submitted',
          }
          : createRoomDeckSummary(canonicalDeck),
        deckStatus: submitted ? 'submitted' : prepared.valid ? 'valid' : 'rejected',
        ready: false,
      });
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
      state.updateMultiplayerPresence({ deck: undefined, deckStatus: 'none', ready: false });
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
    if (get().ui.screen === 'replay') return;
    const g = buildStartedGame(get().game);
    set({
      game: g,
      ui: { ...get().ui, screen: 'game', lobbyOpen: false },
    });
  },

  beginMultiplayerGameStart: () => {
    const state = get();
    if (state.multiplayer.status !== 'host' || !state.multiplayer.peerId) {
      state.startGame();
      return;
    }

    clearStartGameHandshakeTimer();
    const now = Date.now();
    const pendingGame = buildStartedGame(state.game, now);
    const requiredPeerIds = getRequiredStartAckPeerIds(state.multiplayer.peers, state.multiplayer.peerId);
    const id = crypto.randomUUID();
    const deadlineAt = now + START_GAME_ACK_TIMEOUT_MS;
    const lobby = state.multiplayer.lobby;
    if (lobby) {
      const eligibility = canHostStartFromLobby(lobby, { requirePlayerReady: false });
      if (!eligibility.canStart) return;
    }

    set(s => ({
      multiplayer: {
        ...s.multiplayer,
        startHandshake: {
          id,
          status: requiredPeerIds.length > 0 ? 'waiting' : 'committing',
          requiredPeerIds,
          ackedPeerIds: state.multiplayer.peerId ? [state.multiplayer.peerId] : [],
          missingPeerIds: requiredPeerIds,
          startedAt: now,
          deadlineAt,
          pendingGame,
        },
      },
    }));

    const protocolPrepare = lobby ? createStartGamePrepare(lobby, pendingGame.id, deadlineAt) : null;
    const prepare: StartGamePrepare = {
      id,
      hostPeerId: state.multiplayer.peerId,
      gameId: pendingGame.id,
      playerList: protocolPrepare?.playerList ?? [],
      deckHashes: protocolPrepare?.deckHashes ?? {},
      turnOrder: protocolPrepare?.turnOrder ?? pendingGame.players.map(player => player.id),
      requiredPeerIds,
      createdAt: now,
      deadline: deadlineAt,
      deadlineAt,
    };
    sendStartGamePrepare(prepare);

    if (requiredPeerIds.length === 0) {
      get().commitMultiplayerGameStart(false);
      return;
    }

    startGameHandshakeTimer = setTimeout(() => {
      const current = useGameStore.getState();
      if (current.multiplayer.startHandshake?.id === id) {
        current.commitMultiplayerGameStart(true);
      }
    }, START_GAME_ACK_TIMEOUT_MS);
  },

  handleMultiplayerStartPrepare: (prepare) => {
    const state = get();
    if (state.multiplayer.status !== 'joined' || !state.multiplayer.peerId) return;

    const selfEntry = resolveSelfPresenceFromPeers(
      state.multiplayer.peers,
      state.multiplayer.peerId,
      state.multiplayer.playerId ?? '',
      state.multiplayer.sessionId ?? '',
    );
    const self = selfEntry?.presence;
    const resolvedPeerId = selfEntry?.peerId ?? state.multiplayer.peerId;
    const seatIndex = self?.seatIndex ?? -1;
    const pendingGame = ensureGameHasSeatsForPresence(state.game, state.multiplayer.peers);
    const authoritativeDeck = self?.playerId
      ? state.multiplayer.lobby?.submittedDecks?.[self.playerId]
      : undefined;
    const expectedDeckHash = authoritativeDeck?.deckHash;
    const actualDeckHash = self?.deck?.deckHash;
    const canVote = Boolean(
      self?.isSpectator === false &&
      self?.seatIndex >= 0 &&
      expectedDeckHash &&
      actualDeckHash === expectedDeckHash &&
      authoritativeDeck?.status === 'valid' &&
      state.game.players[seatIndex]
    );

    set(s => ({
      multiplayer: {
        ...s.multiplayer,
        startHandshake: {
          id: prepare.id,
          status: 'preparing',
          requiredPeerIds: prepare.requiredPeerIds,
          ackedPeerIds: [],
          missingPeerIds: prepare.requiredPeerIds,
          startedAt: prepare.createdAt,
          deadlineAt: prepare.deadlineAt,
          pendingGame,
        },
      },
    }));

    if (canVote) {
      debugStoreMultiplayer('joiner ready to vote start', {
        id: prepare.id,
        playerId: self?.playerId,
        peerId: resolvedPeerId,
      });
    } else {
      debugStoreMultiplayer('joiner waiting for start vote', {
        id: prepare.id,
        playerId: self?.playerId,
        deckStatus: authoritativeDeck?.status ?? self?.deckStatus,
      });
    }
  },

  voteToStartMultiplayerGame: () => {
    const state = get();
    const handshake = state.multiplayer.startHandshake;
    if (!handshake || state.multiplayer.status !== 'joined' || !state.multiplayer.peerId) return;

    const selfEntry = resolveSelfPresenceFromPeers(
      state.multiplayer.peers,
      state.multiplayer.peerId,
      state.multiplayer.playerId ?? '',
      state.multiplayer.sessionId ?? '',
    );
    const self = selfEntry?.presence;
    if (!self || self.isSpectator || self.seatIndex < 0 || !handshake.id) return;

    const requiredPeerIds = handshake.requiredPeerIds;
    if (requiredPeerIds.length === 0) return;
    if (!requiredPeerIds.includes(selfEntry?.peerId ?? state.multiplayer.peerId)) {
      return;
    }

    const authoritativeDeck = self.playerId
      ? state.multiplayer.lobby?.submittedDecks?.[self.playerId]
      : undefined;
    const actualDeckHash = self.deck?.deckHash;
    const expectedDeckHash = authoritativeDeck?.deckHash;
    const seatPlayer = self.seatIndex >= 0 ? state.game.players[self.seatIndex] : undefined;
    const ready = Boolean(
      authoritativeDeck?.status === 'valid' &&
      seatPlayer &&
      expectedDeckHash &&
      actualDeckHash &&
      actualDeckHash === expectedDeckHash
    );
    const deckId = seatPlayer?.deckId ?? authoritativeDeck?.deckId ?? self.deck?.id;

    if (!ready) return;
    get().setMultiplayerReady(true);

    set(s => {
      const active = s.multiplayer.startHandshake;
      if (!active || active.id !== handshake.id) return s;
      const selfPeerId = selfEntry?.peerId ?? s.multiplayer.peerId;
      const nextAcked = new Set(active.ackedPeerIds);
      nextAcked.add(selfPeerId);
      const nextMissing = active.requiredPeerIds.filter(peerId => !nextAcked.has(peerId));
      return {
        multiplayer: {
          ...s.multiplayer,
          startHandshake: {
            ...active,
            status: nextMissing.length === 0 ? 'committing' : 'waiting',
            ackedPeerIds: [...nextAcked],
            missingPeerIds: nextMissing,
          },
        },
      };
    });

    sendStartGameAck({
      id: handshake.id,
      gameId: undefined,
      playerId: self.playerId,
      peerId: selfEntry?.peerId ?? state.multiplayer.peerId,
      sessionId: state.multiplayer.sessionId ?? undefined,
      seatIndex: self.seatIndex,
      deckId,
      deckHash: actualDeckHash,
      ready,
      reason: undefined,
      receivedAt: Date.now(),
    });
  },

  handleMultiplayerStartAck: (ack) => {
    const current = get();
    const handshake = current.multiplayer.startHandshake;
    if (!handshake || handshake.id !== ack.id || current.multiplayer.status !== 'host') return;

    const acked = new Set(handshake.ackedPeerIds);
    const peerPresence = current.multiplayer.peers[ack.peerId]
      ?? Object.values(current.multiplayer.peers).find(presence => presence.playerId === ack.playerId);
    const peerId = peerPresence?.peerId ?? ack.peerId;
    const expectedDeckHash = peerPresence?.playerId ? current.multiplayer.lobby?.submittedDecks[peerPresence.playerId]?.deckHash : undefined;
    if (ack.ready && ack.playerId === peerPresence?.playerId && (!expectedDeckHash || ack.deckHash === expectedDeckHash)) acked.add(peerId);
    const missingPeerIds = handshake.requiredPeerIds.filter(peerId => !acked.has(peerId));

    set(s => ({
      multiplayer: {
        ...s.multiplayer,
        startHandshake: s.multiplayer.startHandshake?.id === ack.id
          ? {
            ...s.multiplayer.startHandshake,
            status: missingPeerIds.length === 0 ? 'committing' : 'waiting',
            ackedPeerIds: [...acked],
            missingPeerIds,
          }
          : s.multiplayer.startHandshake,
      },
    }));

    if (missingPeerIds.length === 0) {
      get().commitMultiplayerGameStart(false);
    }
  },

  commitMultiplayerGameStart: (fallback = false) => {
    const current = get();
    const handshake = current.multiplayer.startHandshake;
    if (!handshake?.pendingGame) {
      current.startGame();
      return;
    }

    clearStartGameHandshakeTimer();
    const committedAt = Date.now();
    const missingPeerIds = handshake.requiredPeerIds.filter(peerId => !handshake.ackedPeerIds.includes(peerId));
    const game = {
      ...handshake.pendingGame,
      status: 'playing' as const,
      lastUpdatedAt: committedAt,
    };
    debugStoreMultiplayer('host committed game', {
      gameId: game.id,
      fallback,
      missingPeerIds,
      playerIds: game.players.map(player => player.id),
    });
    sendStartGameCommit({
      id: handshake.id,
      game,
      fallback,
      missingPeerIds,
      committedAt,
    });
    set(s => ({
      game,
      multiplayer: {
        ...s.multiplayer,
        lobby: s.multiplayer.lobby
          ? { ...s.multiplayer.lobby, status: 'playing', updatedAt: Date.now() }
          : s.multiplayer.lobby,
        startHandshake: null,
      },
      ui: { ...s.ui, screen: 'game', lobbyOpen: false },
    }));
  },

  resetGame: () => {
    clearStartGameHandshakeTimer();
    set({
      game: createEmptyGameState(get().game.config),
      ui: { ...DEFAULT_UI, lobbyOpen: true },
      multiplayer: { ...get().multiplayer, startHandshake: null },
    });
  },

  // ── Card Actions ──────────────────────────────────────────────────────────

  castCard: (castingPlayerId, cardInstanceId, targets) => {
    if (!canLocalControlPlayer(get(), castingPlayerId)) {
      warnBlockedPrivateZoneAction('castCard', { targetPlayerId: castingPlayerId, zone: 'hand' });
      return;
    }
    let g = get().game;
    const card = g.cards[cardInstanceId];
    if (!card) return;
    if (!canLocalPerformPrivateCardAction(get(), 'castCard', card)) return;
    const check = checkCastLegality(g, castingPlayerId, cardInstanceId);
    const flags = filterAssistantFlags(check.flags, get().ui);
    if (!canLocalAccessCard(get(), card) || findCardOwner(g, card) !== castingPlayerId) {
      warnBlockedPrivateZoneAction('castCard', { card, ownerId: findCardOwner(g, card), targetPlayerId: castingPlayerId });
      return;
    }
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
      isCommanderBeingCast
        ? `${castingPlayer?.name || castingPlayerId} cast ${cardDef.name} from the command zone. Commander tax is +${commanderTax ?? 0}.`
        : `${cardDef.name} cast by ${castingPlayer?.name || castingPlayerId}`,
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

  castCommanderFromCommandZone: (playerId, commanderInstanceId) => {
    const state = get();
    if (shouldRouteToHostAuthoritativeAction(state)) {
      if (!canLocalControlPlayer(state, playerId)) return false;
      const card = state.game.cards[commanderInstanceId];
      if (!card || card.ownerId !== playerId || card.zone !== 'command') return false;
      return routeHostAuthoritativeAction('castCommanderFromCommandZone', { playerId, commanderInstanceId });
    }

    if (!canLocalControlPlayer(state, playerId)) {
      warnBlockedPrivateZoneAction('castCommanderFromCommandZone', { targetPlayerId: playerId, zone: 'command' });
      return false;
    }
    const card = state.game.cards[commanderInstanceId];
    if (!card) return false;
    if (!canLocalControlCard(state, card)) return false;
    const reason = getCommanderCastDisabledReason(state.game, playerId, commanderInstanceId, { judgeMode: state.ui.judgeMode });
    if (reason) {
      const action = createAction(state.game, playerId, 'FLAG', reason, [commanderInstanceId], {
        commanderAction: 'cast',
        commanderId: commanderInstanceId,
      });
      set({ game: { ...state.game, actionLog: [...state.game.actionLog, action] } });
      return false;
    }
    const before = get().game;
    get().castCard(playerId, commanderInstanceId);
    return get().game !== before;
  },

  moveCommanderToCommandZone: (playerId, commanderInstanceId, fromZone) => {
    const state = get();
    if (shouldRouteToHostAuthoritativeAction(state)) {
      if (!canLocalControlPlayer(state, playerId)) return false;
      const card = state.game.cards[commanderInstanceId];
      if (!card || card.ownerId !== playerId) return false;
      return routeHostAuthoritativeAction('moveCommanderToCommandZone', { playerId, commanderInstanceId, fromZone });
    }

    if (!canLocalControlPlayer(state, playerId)) {
      warnBlockedPrivateZoneAction('moveCommanderToCommandZone', { targetPlayerId: playerId, zone: fromZone ?? 'command' });
      return false;
    }
    let g = state.game;
    const card = g.cards[commanderInstanceId];
    if (!card) return false;
    if (!canLocalPerformPrivateCardAction(state, 'moveCommanderToCommandZone', card)) return false;
    if (!canMoveCommanderToCommandZone(g, playerId, commanderInstanceId, fromZone) && !state.ui.judgeMode) return false;
    const previousTax = getCommanderTax(g, playerId, commanderInstanceId);
    g = moveCard(g, commanderInstanceId, 'command', playerId);
    const player = g.players.find(p => p.id === playerId);
    const action = createAction(
      g,
      playerId,
      'MOVE_CARD',
      `${player?.name || playerId} moved ${card.definition.name} to the command zone.`,
      [commanderInstanceId],
      {
        commanderAction: 'move-to-command',
        commanderId: commanderInstanceId,
        fromZone: card.zone,
        commanderTaxUnchanged: previousTax,
      },
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  playLand: (playerId, cardInstanceId, faceIndex) => {
    if (!canLocalControlPlayer(get(), playerId)) {
      warnBlockedPrivateZoneAction('playLand', { targetPlayerId: playerId, zone: 'hand' });
      return;
    }
    let g = get().game;
    let card = g.cards[cardInstanceId];
    if (!card) return;
    if (!canLocalPerformPrivateCardAction(get(), 'playLand', card)) return;
    if (!canLocalAccessCard(get(), card) || findCardOwner(g, card) !== playerId) {
      warnBlockedPrivateZoneAction('playLand', { card, ownerId: findCardOwner(g, card), targetPlayerId: playerId });
      return;
    }
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
    if (!canLocalPerformPrivateCardAction(get(), 'moveCardToZone', card)) return;
    const canOfflineDirectMove = get().multiplayer.status === 'disconnected'
      && toController != null
      && findCardOwner(g, card) === toController;
    if (!canLocalControlCard(get(), card) && !canOfflineDirectMove) {
      if (isPrivateZone(card.zone)) warnBlockedPrivateZoneAction('moveCardToZone', { card });
      return;
    }
    const ownerId = findCardOwner(g, card) ?? card.controllerId;
    const targetController = toController ?? ownerId;
    if (isPrivateZone(toZone) && !canLocalControlPlayer(get(), targetController)) {
      warnBlockedPrivateZoneAction('moveCardToZone', { card, ownerId, targetPlayerId: targetController, zone: toZone });
      return;
    }
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
    if (!canLocalControlCard(get(), card)) return;
    g = tapCard(g, instanceId, true);
    const action = createAction(g, card.controllerId, 'TAP', `Tapped ${card.definition.name}`, [instanceId], addReviewData({}, flags), flags);
    const nextGame = { ...g, actionLog: [...g.actionLog, action] };
    set({ game: nextGame, ui: withAssistantMessages(get().ui, nextGame, flags) });
  },

  untapCard: (instanceId) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    if (!canLocalControlCard(get(), card)) return;
    g = tapCard(g, instanceId, false);
    const action = createAction(g, card.controllerId, 'UNTAP', `Untapped ${card.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  tapCards: (instanceIds) => {
    let g = get().game;
    const ids = [...new Set(instanceIds)].filter(id => {
      const card = g.cards[id];
      return card && card.zone === 'battlefield' && !card.tapped && canLocalControlCard(get(), card);
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
      return card && card.zone === 'battlefield' && card.tapped && canLocalControlCard(get(), card);
    });
    if (ids.length === 0) return;
    for (const id of ids) g = tapCard(g, id, false);
    const names = new Set(ids.map(id => g.cards[id]?.definition.name).filter(Boolean));
    const label = names.size === 1 ? [...names][0] : 'permanent';
    const action = createAction(g, g.activePlayerId, 'UNTAP', `Untapped ${ids.length} ${label}${ids.length === 1 ? '' : 's'}`, ids, { bulk: true });
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  setManaPool: (playerId, mana) => {
    if (!canLocalControlPlayer(get(), playerId)) return;
    let g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    g = setManaPool(g, playerId, mana);
    const action = createAction(
      g,
      playerId,
      'ADD_MANA',
      `Set ${player.name}'s mana pool to ${formatManaPool(g.players.find(p => p.id === playerId)?.manaPool ?? {})}`
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  addManaToPool: (playerId, mana) => {
    if (!canLocalControlPlayer(get(), playerId)) return;
    let g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    g = addManaToPool(g, playerId, mana);
    const action = createAction(
      g,
      playerId,
      'ADD_MANA',
      `Added ${formatManaPool(mana)} to ${player.name}'s mana pool`,
      [],
      { mana }
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  spendManaFromPool: (playerId, mana) => {
    if (!canLocalControlPlayer(get(), playerId)) return;
    let g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    const requested = {
      W: Math.floor(Number(mana.W ?? 0)),
      U: Math.floor(Number(mana.U ?? 0)),
      B: Math.floor(Number(mana.B ?? 0)),
      R: Math.floor(Number(mana.R ?? 0)),
      G: Math.floor(Number(mana.G ?? 0)),
      C: Math.floor(Number(mana.C ?? 0)),
      generic: Math.floor(Number(mana.generic ?? 0)),
    };
    const nextMana = {
      W: Math.max(0, player.manaPool.W - requested.W),
      U: Math.max(0, player.manaPool.U - requested.U),
      B: Math.max(0, player.manaPool.B - requested.B),
      R: Math.max(0, player.manaPool.R - requested.R),
      G: Math.max(0, player.manaPool.G - requested.G),
      C: Math.max(0, player.manaPool.C - requested.C),
      generic: Math.max(0, player.manaPool.generic - requested.generic),
    };
    g = setManaPool(g, playerId, nextMana);
    const action = createAction(
      g,
      playerId,
      'SPEND_MANA',
      `Spent ${formatManaPool(requested)} from ${player.name}'s mana pool`,
      [],
      { mana: requested }
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  clearManaPool: (playerId) => {
    if (!canLocalControlPlayer(get(), playerId)) return;
    let g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    g = clearManaPool(g, playerId);
    const action = createAction(g, playerId, 'CLEAR_MANA', `Cleared ${player.name}'s mana pool`);
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  takeMulligan: (playerId) => {
    if (!canLocalControlPlayer(get(), playerId)) return;
    const g = get().game;
    const player = g.players.find(p => p.id === playerId);
    if (!player) return;
    const next = takeMulligan(g, playerId);
    const action = createAction(next, playerId, 'MULLIGAN', `${player.name} took a mulligan`);
    set({ game: { ...next, actionLog: [...next.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  tutorCard: (playerId, instanceId, fromZone = 'library') => {
    if (!canLocalControlPlayer(get(), playerId)) return;
    const g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    const before = card.zone;
    const next = tutorCardFromEngine(g, playerId, instanceId, fromZone);
    if (!next.cards[instanceId] || next.cards[instanceId].zone !== 'hand') return;
    const action = createAction(
      next,
      playerId,
      'TUTOR',
      `Tutored ${card.definition.name} from ${before} to hand`,
      [instanceId],
      { fromZone }
    );
    set({ game: { ...next, actionLog: [...next.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  removeAllCountersFromCard: (instanceId, counterType) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card || !canLocalControlCard(get(), card)) return;
    if (!counterType && card.counters.length === 0) return;
    if (counterType && !card.counters.some(counter => counter.type === counterType)) return;

    g = removeAllCountersFromCard(g, instanceId, counterType);
    const action = createAction(g, card.controllerId, 'REMOVE_ALL_COUNTERS',
      counterType
        ? `Removed all ${counterType} counters from ${card.definition.name}`
        : `Removed all counters from ${card.definition.name}`,
      [instanceId],
      { counterType }
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  tapAllLands: (playerId) => {
    if (!canLocalControlPlayer(get(), playerId)) return;
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
    if (!canLocalControlPlayer(get(), playerId)) return;
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
    if (!card || !counterType || !canLocalControlCard(get(), card)) return;
    if (!canLocalPerformPrivateCardAction(get(), 'addCounterToCard', card)) return;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      routeHostAuthoritativeAction('addCounterToCard', { instanceId, counterType, amount });
      return;
    }
    g = addCounter(g, instanceId, counterType, amount);
    const action = createAction(g, card.controllerId, 'ADD_COUNTER',
      `Added ${amount} ${counterType} to ${card.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  removeCounterFromCard: (instanceId, counterType, amount = 1) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card || !counterType || !canLocalControlCard(get(), card)) return;
    if (!canLocalPerformPrivateCardAction(get(), 'removeCounterFromCard', card)) return;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      routeHostAuthoritativeAction('removeCounterFromCard', { instanceId, counterType, amount });
      return;
    }
    g = removeCounter(g, instanceId, counterType, amount);
    const action = createAction(g, card.controllerId, 'REMOVE_COUNTER',
      `Removed ${amount} ${counterType} counter(s) from ${card.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  setCardTemporaryNote: (instanceId, note) => {
    const state = get();
    const card = state.game.cards[instanceId];
    const trimmed = note.trim();
    if (!card || !trimmed || !canLocalControlCard(state, card)) return false;
    if (!canLocalPerformPrivateCardAction(state, 'setCardTemporaryNote', card)) return false;
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('setCardTemporaryNote', { instanceId, note: trimmed });
    }
    const next = {
      ...state.game,
      cards: { ...state.game.cards, [instanceId]: { ...card, notes: trimmed } },
      lastUpdatedAt: Date.now(),
    };
    const action = createAction(next, card.controllerId, 'NOTE', `Manual note on ${card.definition.name}: ${trimmed}`, [instanceId], { manualTool: 'note' });
    set({ game: { ...next, actionLog: [...next.actionLog, action] } });
    return true;
  },

  setMarkedDamage: (instanceId, amount) => {
    const state = get();
    const card = state.game.cards[instanceId];
    const safeAmount = Math.max(0, Math.floor(amount));
    if (!card || !canLocalControlCard(state, card)) return false;
    if (!canLocalPerformPrivateCardAction(state, 'setMarkedDamage', card)) return false;
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('setMarkedDamage', { instanceId, amount: safeAmount });
    }
    const next = {
      ...state.game,
      cards: { ...state.game.cards, [instanceId]: { ...card, markedForDamage: safeAmount } },
      lastUpdatedAt: Date.now(),
    };
    const action = createAction(next, card.controllerId, 'OTHER', `Set ${card.definition.name} marked damage to ${safeAmount}.`, [instanceId], { manualTool: 'markedDamage', amount: safeAmount });
    set({ game: { ...next, actionLog: [...next.actionLog, action] } });
    return true;
  },

  clearMarkedDamage: (instanceId) => {
    return get().setMarkedDamage(instanceId, 0);
  },

  setManualCombatRole: (instanceId, role) => {
    const state = get();
    const card = state.game.cards[instanceId];
    if (!card || !canLocalControlCard(state, card)) return false;
    if (!canLocalPerformPrivateCardAction(state, 'setManualCombatRole', card)) return false;
    const safeRole: CardState['combatRole'] = role === 'attacker' || role === 'blocker' ? role : 'none';
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('setManualCombatRole', { instanceId, role: safeRole });
    }
    const next = {
      ...state.game,
      cards: { ...state.game.cards, [instanceId]: { ...card, combatRole: safeRole } },
      lastUpdatedAt: Date.now(),
    };
    const action = createAction(next, card.controllerId, 'OTHER', `${card.definition.name} manually marked as ${safeRole}.`, [instanceId], { manualTool: 'combatRole', role: safeRole });
    set({ game: { ...next, actionLog: [...next.actionLog, action] } });
    return true;
  },

  setCardController: (instanceId, controllerId) => {
    const state = get();
    const card = state.game.cards[instanceId];
    const player = state.game.players.find(p => p.id === controllerId);
    if (!card || !player || !canLocalControlCard(state, card)) return false;
    if (!canLocalPerformPrivateCardAction(state, 'setCardController', card)) return false;
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('setCardController', { instanceId, controllerId });
    }
    const next = {
      ...state.game,
      cards: { ...state.game.cards, [instanceId]: { ...card, controllerId } },
      lastUpdatedAt: Date.now(),
    };
    const action = createAction(next, controllerId, 'OTHER', `${card.definition.name} controller set to ${player.name}.`, [instanceId], { manualTool: 'controller', controllerId });
    set({ game: { ...next, actionLog: [...next.actionLog, action] } });
    return true;
  },

  setCardOwner: (instanceId, ownerId) => {
    const state = get();
    const card = state.game.cards[instanceId];
    const player = state.game.players.find(p => p.id === ownerId);
    if (!card || !player || !state.ui.judgeMode) return false;
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('setCardOwner', { instanceId, ownerId });
    }
    const next = {
      ...state.game,
      cards: { ...state.game.cards, [instanceId]: { ...card, ownerId } },
      lastUpdatedAt: Date.now(),
    };
    const action = createAction(next, ownerId, 'OTHER', `${card.definition.name} owner set to ${player.name}.`, [instanceId], { manualTool: 'owner', ownerId, judgeOnly: true });
    set({ game: { ...next, actionLog: [...next.actionLog, action] } });
    return true;
  },

  addManualTriggerForCard: (instanceId, text) => {
    const state = get();
    const card = state.game.cards[instanceId];
    const trimmed = text.trim();
    if (!card || !trimmed || !canLocalControlCard(state, card)) return false;
    if (!canLocalPerformPrivateCardAction(state, 'addManualTriggerForCard', card)) return false;
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('addManualTriggerForCard', { instanceId, text: trimmed });
    }
    const trigger: TriggerItem = {
      id: uuid(),
      sourceInstanceId: instanceId,
      sourceName: card.definition.name,
      controllerId: card.controllerId,
      text: trimmed,
      triggerType: 'other',
      acknowledged: false,
      missed: false,
      timestamp: Date.now(),
      data: { manualTool: true },
    };
    const next = addTrigger(state.game, trigger);
    const action = createAction(next, card.controllerId, 'OTHER', `Manual trigger added for ${card.definition.name}: ${trimmed}`, [instanceId], { triggerId: trigger.id, manualTool: 'trigger' });
    set({ game: { ...next, actionLog: [...next.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
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

  activateClue: (instanceId, options = {}) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card || !canLocalControlCard(get(), card)) return false;
    const hasClue = getMechanicsForCard(card).some(mechanic => mechanic.id === 'clue') ||
      card.definition.subTypes.some(subtype => subtype.toLowerCase() === 'clue') ||
      /\bclue\b/i.test(card.definition.typeLine);
    if (!hasClue || card.zone !== 'battlefield') return false;
    const controller = g.players.find(player => player.id === card.controllerId);
    if (!controller) return false;

    const paymentConfirmed = options.confirmPayment !== false;
    if (!paymentConfirmed) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('activateClue', { instanceId, options });
    }

    g = moveCard(g, instanceId, 'graveyard', card.controllerId);
    g = drawCards(g, card.controllerId, 1);
    const action = createAction(
      g,
      card.controllerId,
      'ACTIVATE_ABILITY',
      `${controller.name} cracked ${card.definition.name}: paid {2}, sacrificed it, and drew a card.`,
      [instanceId],
      { mechanicId: 'clue', paymentConfirmed: true, genericCost: 2, draws: 1 },
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  markExhaustUsed: (instanceId, exhaustId = 'default') => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card || !canLocalControlCard(get(), card)) return false;
    if (card.exhaustUsed?.[exhaustId]) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('markExhaustUsed', { instanceId, exhaustId });
    }
    g = markExhaustUsedOnCard(g, instanceId, exhaustId);
    const action = createAction(
      g,
      card.controllerId,
      'ACTIVATE_ABILITY',
      `${card.definition.name} exhaust marked used.`,
      [instanceId],
      { mechanicId: 'exhaust', exhaustId },
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  resetExhaust: (instanceId, exhaustId) => {
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card || !canLocalControlCard(get(), card)) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('resetExhaust', { instanceId, exhaustId });
    }
    g = resetExhaustUsedOnCard(g, instanceId, exhaustId);
    const action = createAction(
      g,
      card.controllerId,
      'OTHER',
      `${card.definition.name} exhaust ${exhaustId ? exhaustId : 'tracking'} reset.`,
      [instanceId],
      { mechanicId: 'exhaust', exhaustId, reset: true },
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },
  applyAirbend: (targetId, sourceId) => {
    let g = get().game;
    const card = g.cards[targetId];
    if (!card || !canLocalControlCard(get(), card)) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('applyAirbend', { targetId, sourceId });
    }
    const wasToken = card.token;
    g = applyAirbendInEngine(g, targetId, sourceId);
    const action = createAction(
      g,
      card.controllerId,
      'MOVE_CARD',
      wasToken
        ? `${card.definition.name} was airbended and ceased to exist as a token.`
        : `${card.definition.name} was airbended. Owner may cast it from exile for {2}.`,
      [targetId],
      { mechanicId: 'airbend', sourceId, tokenRemoved: wasToken },
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  markCastForWarp: (cardId, warpCost) => {
    let g = get().game;
    const card = g.cards[cardId];
    if (!card || !canLocalControlCard(get(), card)) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('markCastForWarp', { cardId, warpCost });
    }
    g = markCastForWarpInEngine(g, cardId, warpCost);
    const action = createAction(
      g,
      card.controllerId,
      'CAST',
      `${card.definition.name} marked as cast for warp${warpCost ? ` (${warpCost})` : ''}.`,
      [cardId],
      { mechanicId: 'warp', warpCost },
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  castExiledWithPermission: (playerId, instanceId) => {
    if (!canLocalControlPlayer(get(), playerId)) return false;
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card || card.zone !== 'exile' || !card.exilePermission) return false;
    if (card.exilePermission.ownerId !== playerId && !get().ui.judgeMode) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('castExiledWithPermission', { playerId, instanceId });
    }
    const isPermanent = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle']
      .some(t => card.definition.cardTypes.includes(t as typeof card.definition.cardTypes[number]));
    g = { ...g, cards: { ...g.cards, [instanceId]: { ...card, controllerId: playerId } } };
    g = moveCard(g, instanceId, isPermanent ? 'battlefield' : 'graveyard', playerId);
    const movedCard = g.cards[instanceId];
    if (movedCard) {
      g = {
        ...g,
        cards: {
          ...g.cards,
          [instanceId]: {
            ...movedCard,
            exilePermission: undefined,
            warpedThisTurn: false,
          },
        },
      };
    }
    const action = createAction(
      g,
      playerId,
      'CAST',
      `Cast ${card.definition.name} from exile${card.exilePermission.alternativeCost ? ` for ${card.exilePermission.alternativeCost}` : ''}.`,
      [instanceId],
      { mechanicId: card.exilePermission.sourceMechanic, exilePermission: card.exilePermission },
    );
    set({ game: { ...g, actionLog: [...g.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },
  getWaterbendEligiblePermanents: (playerId) => {
    if (!canLocalControlPlayer(get(), playerId)) return [];
    return getWaterbendEligiblePermanentsFromEngine(get().game, playerId);
  },

  payWaterbendCost: (playerId, amount, permanentIds, sourceId) => {
    if (!canLocalControlPlayer(get(), playerId)) return false;
    const g = get().game;
    for (const id of permanentIds) {
      const card = g.cards[id];
      if (!card || !canLocalControlCard(get(), card)) return false;
    }
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('payWaterbendCost', { playerId, amount, permanentIds, sourceId });
    }
    const result = payWaterbendCostInEngine(g, playerId, amount, permanentIds, sourceId);
    if (!result.valid) return false;
    const names = permanentIds.map(id => g.cards[id]?.definition.name).filter(Boolean).join(', ');
    const action = createAction(
      result.state,
      playerId,
      'TAP',
      `Waterbend paid ${result.paid} generic cost by tapping ${names || 'no permanents'}.`,
      permanentIds,
      { mechanicId: 'waterbend', amount, paid: result.paid, sourceId, notManaAbility: true },
    );
    set({ game: { ...result.state, actionLog: [...result.state.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  applyEarthbend: (playerId, landId, amount, sourceId) => {
    if (!canLocalControlPlayer(get(), playerId)) return false;
    const g = get().game;
    const card = g.cards[landId];
    if (!card || !canLocalControlCard(get(), card)) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('applyEarthbend', { playerId, landId, amount, sourceId });
    }
    const result = applyEarthbendInEngine(g, playerId, landId, amount, sourceId);
    if (!result.valid) return false;
    const safeAmount = Math.floor(amount);
    const action = createAction(
      result.state,
      playerId,
      'ADD_COUNTER',
      `${card.definition.name} was earthbended ${safeAmount}: it is a 0/0 land creature with haste and ${safeAmount} +1/+1 counter(s).`,
      [landId],
      { mechanicId: 'earthbend', amount: safeAmount, sourceId },
    );
    set({ game: { ...result.state, actionLog: [...result.state.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  getStationEligibleCreatures: (playerId, spacecraftId) => {
    if (!canLocalControlPlayer(get(), playerId)) return [];
    const spacecraft = get().game.cards[spacecraftId];
    if (!spacecraft || !canLocalControlCard(get(), spacecraft)) return [];
    return getStationEligibleCreaturesFromEngine(get().game, playerId, spacecraftId);
  },

  stationSpacecraft: (playerId, spacecraftId, creatureId) => {
    if (!canLocalControlPlayer(get(), playerId)) return false;
    const g = get().game;
    const spacecraft = g.cards[spacecraftId];
    const creature = g.cards[creatureId];
    if (!spacecraft || !creature) return false;
    if (!canLocalControlCard(get(), spacecraft) || !canLocalControlCard(get(), creature)) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('stationSpacecraft', { playerId, spacecraftId, creatureId });
    }
    const result = stationSpacecraftInEngine(g, playerId, spacecraftId, creatureId);
    if (!result.valid) return false;
    const action = createAction(
      result.state,
      playerId,
      'ADD_COUNTER',
      `${creature.definition.name} stationed ${spacecraft.definition.name}: add ${result.countersAdded ?? 0} charge counter${result.countersAdded === 1 ? '' : 's'}${result.stationed ? ' and unlock it' : ''}.`,
      [spacecraftId, creatureId],
      {
        mechanicId: 'station',
        spacecraftId,
        creatureId,
        countersAdded: result.countersAdded,
        threshold: result.threshold,
        stationed: result.stationed,
        notManaAbility: true,
      },
    );
    set({ game: { ...result.state, actionLog: [...result.state.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  stationSpacecraftManual: (playerId, spacecraftId, creatureId, amount) => {
    if (!canLocalControlPlayer(get(), playerId)) return false;
    const safeAmount = Math.floor(amount);
    if (!Number.isFinite(safeAmount) || safeAmount <= 0) return false;
    const g = get().game;
    const spacecraft = g.cards[spacecraftId];
    const creature = g.cards[creatureId];
    if (!spacecraft || !creature) return false;
    if (!canLocalControlCard(get(), spacecraft) || !canLocalControlCard(get(), creature)) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('stationSpacecraftManual', { playerId, spacecraftId, creatureId, amount: safeAmount });
    }
    const result = stationSpacecraftManualInEngine(g, playerId, spacecraftId, creatureId, safeAmount);
    if (!result.valid) return false;
    const action = createAction(
      result.state,
      playerId,
      'ADD_COUNTER',
      `${creature.definition.name} stationed ${spacecraft.definition.name} for manual amount ${safeAmount}: add ${result.countersAdded ?? safeAmount} charge counter${(result.countersAdded ?? safeAmount) === 1 ? '' : 's'}${result.stationed ? ' and unlock it' : ''}.`,
      [spacecraftId, creatureId],
      {
        mechanicId: 'station',
        spacecraftId,
        creatureId,
        countersAdded: result.countersAdded,
        threshold: result.threshold,
        stationed: result.stationed,
        manualAmount: safeAmount,
        notManaAbility: true,
      },
    );
    set({ game: { ...result.state, actionLog: [...result.state.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  applyBlight: (playerId, creatureId, amount, sourceId) => {
    if (!canLocalControlPlayer(get(), playerId)) return false;
    const g = get().game;
    const card = g.cards[creatureId];
    if (!card || !canLocalControlCard(get(), card)) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('applyBlight', { playerId, creatureId, amount, sourceId });
    }
    const result = applyBlightInEngine(g, playerId, creatureId, amount, sourceId);
    if (!result.valid) return false;
    const action = createAction(
      result.state,
      playerId,
      'ADD_COUNTER',
      `${card.definition.name} was blighted ${result.amount ?? amount}: add ${result.amount ?? amount} -1/-1 counter${(result.amount ?? amount) === 1 ? '' : 's'}.`,
      [creatureId],
      { mechanicId: 'blight', amount: result.amount ?? amount, sourceId },
    );
    set({ game: { ...result.state, actionLog: [...result.state.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  getVividColorCount: (playerId) => {
    return getVividColorCountFromEngine(get().game, playerId);
  },

  levelUpClass: (playerId, cardId) => {
    if (!canLocalControlPlayer(get(), playerId)) return false;
    const g = get().game;
    const card = g.cards[cardId];
    if (!card || !canLocalControlCard(get(), card)) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('levelUpClass', { playerId, cardId });
    }
    const result = levelUpClassInEngine(g, playerId, cardId);
    if (!result.valid) return false;
    const action = createAction(
      result.state,
      playerId,
      'OTHER',
      `${card.definition.name} advanced to Class level ${result.level}.`,
      [cardId],
      { mechanicId: 'classes', level: result.level },
    );
    set({ game: { ...result.state, actionLog: [...result.state.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  setClassLevel: (playerId, cardId, level, judgeOverride = false) => {
    const state = get();
    const effectiveJudgeOverride = judgeOverride || state.ui.judgeMode;
    if (!effectiveJudgeOverride && !canLocalControlPlayer(state, playerId)) return false;
    const card = state.game.cards[cardId];
    if (!card || (!effectiveJudgeOverride && !canLocalControlCard(state, card))) return false;
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('setClassLevel', { playerId, cardId, level });
    }
    const result = setClassLevelInEngine(state.game, playerId, cardId, level, effectiveJudgeOverride);
    if (!result.valid) return false;
    const action = createAction(
      result.state,
      playerId,
      'OTHER',
      `${card.definition.name} set to Class level ${result.level}.`,
      [cardId],
      { mechanicId: 'classes', level: result.level, judgeOverride: effectiveJudgeOverride },
    );
    set({ game: { ...result.state, actionLog: [...result.state.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  getSneakReturnCandidates: (playerId) => {
    return getSneakReturnCandidatesFromEngine(get().game, playerId).map(candidate => ({
      attackerId: candidate.attackerId,
      assignmentId: candidate.assignment.assignmentId,
      sourceName: candidate.assignment.sourceName,
    }));
  },

  canCastWithSneak: (playerId, cardId) => {
    const state = get();
    const card = state.game.cards[cardId];
    if (!canLocalControlPlayer(state, playerId)) return false;
    if (!canLocalPerformPrivateCardAction(state, 'castWithSneak', card)) return false;
    if (!canLocalAccessCard(state, card)) return false;
    return canCastWithSneakInEngine(state.game, playerId, cardId);
  },

  castWithSneak: (playerId, cardId, returnedAttackerId) => {
    const state = get();
    const card = state.game.cards[cardId];
    if (!canLocalControlPlayer(state, playerId)) return false;
    if (!canLocalPerformPrivateCardAction(state, 'castWithSneak', card)) return false;
    if (!canLocalAccessCard(state, card)) return false;

    const candidates = getSneakReturnCandidatesFromEngine(state.game, playerId);
    const selectedReturnedId = returnedAttackerId ?? (candidates.length === 1 ? candidates[0].attackerId : undefined);
    if (!selectedReturnedId) return false;
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('castWithSneak', { playerId, cardId, returnedAttackerId: selectedReturnedId });
    }

    const result = castWithSneakInEngine(state.game, playerId, cardId, selectedReturnedId);
    if (!result.valid) return false;
    const returned = state.game.cards[selectedReturnedId];
    const target = result.attackTarget;
    const targetLabel = target?.type === 'player'
      ? result.state.players.find(player => player.id === target.playerId)?.name ?? target.playerId
      : target?.type === 'planeswalker'
        ? result.state.cards[target.permanentId]?.definition.name ?? 'planeswalker'
        : target?.type === 'battle'
          ? result.state.cards[target.permanentId]?.definition.name ?? 'battle'
          : 'the same target';
    const action = createAction(
      result.state,
      playerId,
      'CAST',
      `${card?.definition.name ?? 'Sneak spell'} entered tapped and attacking ${targetLabel} via Sneak.`,
      [cardId, selectedReturnedId],
      {
        mechanicId: 'sneak',
        returnedAttackerId: selectedReturnedId,
        returnedAttackerName: returned?.definition.name,
        attackTarget: target,
        shortcut: 'immediate_battlefield',
        todo: 'Replace with full stack/resolve flow when alternative-cost casting is generalized.',
      },
    );
    set({ game: { ...result.state, actionLog: [...result.state.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  setPowerToughnessOverride: (instanceIds, power, toughness, expires = 'manual', reason) => {
    const state = get();
    const ids = [...new Set(instanceIds)].filter(Boolean);
    if (ids.length === 0) return false;
    const cards = ids.map(id => state.game.cards[id]);
    if (cards.some(card => !card || !canLocalControlCard(state, card))) return false;
    if (cards.some(card => !canLocalPerformPrivateCardAction(state, 'setPowerToughnessOverride', card))) return false;
    if (!power?.trim() && !toughness?.trim()) return false;
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('setPowerToughnessOverride', { instanceIds: ids, power, toughness, expires, reason });
    }
    const next = setPowerToughnessOverrideInEngine(state.game, ids, power, toughness, expires, reason);
    const first = cards[0];
    const action = createAction(
      next,
      first?.controllerId ?? state.game.activePlayerId,
      'NOTE',
      `${ids.length === 1 ? first?.definition.name ?? 'Card' : `${ids.length} cards`} P/T override set to ${power?.trim() || '?'}/${toughness?.trim() || '?'} (${expires}).`,
      ids,
      { power, toughness, expires, reason },
    );
    set({ game: { ...next, actionLog: [...next.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },

  clearPowerToughnessOverride: (instanceIds) => {
    const state = get();
    const ids = [...new Set(instanceIds)].filter(Boolean);
    if (ids.length === 0) return false;
    const cards = ids.map(id => state.game.cards[id]);
    if (cards.some(card => !card || !canLocalControlCard(state, card))) return false;
    if (cards.some(card => !canLocalPerformPrivateCardAction(state, 'clearPowerToughnessOverride', card))) return false;
    if (shouldRouteToHostAuthoritativeAction(state)) {
      return routeHostAuthoritativeAction('clearPowerToughnessOverride', { instanceIds: ids });
    }
    const next = clearPowerToughnessOverrideInEngine(state.game, ids);
    const first = cards[0];
    const action = createAction(
      next,
      first?.controllerId ?? state.game.activePlayerId,
      'NOTE',
      `${ids.length === 1 ? first?.definition.name ?? 'Card' : `${ids.length} cards`} P/T override cleared.`,
      ids,
    );
    set({ game: { ...next, actionLog: [...next.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
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
    if (!canLocalPerformPrivatePlayerAction(get(), 'drawCard', playerId, 'library')) return;
    let g = get().game;
    g = drawCards(g, playerId, count);
    const player = g.players.find(p => p.id === playerId);
    const action = createAction(g, playerId, 'DRAW_CARD',
      `${player?.name || playerId} drew ${count} card(s)`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  discardFromHand: (playerId, instanceId) => {
    if (!canLocalControlPlayer(get(), playerId)) return;
    let g = get().game;
    const card = g.cards[instanceId];
    if (!canLocalAccessCard(get(), card) || findCardOwner(g, card) !== playerId) return;
    g = discardCard(g, playerId, instanceId);
    const action = createAction(g, playerId, 'DISCARD', `Discarded ${card?.definition.name}`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  reorderHand: (playerId, orderedInstanceIds) => {
    if (!canLocalControlPlayer(get(), playerId)) return;
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
    if (!canLocalPerformPrivatePlayerAction(get(), 'shuffleLibrary', playerId, 'library')) return;
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
    if (get().ui.screen === 'replay') return;
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
    if (leavesCombatPhase(prev, g.phase)) {
      g = clearExpiredPowerToughnessOverrides(g, 'endOfCombat');
    }
    if (g.phase === 'cleanup') {
      g = clearExpiredPowerToughnessOverrides(g, 'endOfTurn');
      g = clearMarkedDamage(g);
    }
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
    if (get().ui.screen === 'replay') return;
    let g = get().game;
    const prev = g.phase;
    g = setPhase(g, phase);
    if (leavesCombatPhase(prev, phase)) {
      g = clearExpiredPowerToughnessOverrides(g, 'endOfCombat');
    }
    if (phase === 'cleanup') {
      g = clearExpiredPowerToughnessOverrides(g, 'endOfTurn');
      g = clearMarkedDamage(g);
    }
    const action = createAction(g, g.activePlayerId, 'CHANGE_PHASE', `Jump to: ${phase}`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] }, ui: { ...get().ui, combatMode: g.combat.active } });
  },

  advanceTurn: () => {
    if (get().ui.screen === 'replay') return;
    let g = get().game;
    if (COMBAT_PHASES_FOR_CLEANUP.has(g.phase)) {
      g = clearExpiredPowerToughnessOverrides(g, 'endOfCombat');
    }
    g = clearExpiredPowerToughnessOverrides(g, 'endOfTurn');
    g = clearMarkedDamage(g);
    g = nextTurn(g);
    const active = g.players.find(p => p.id === g.activePlayerId);
    const action = createAction(g, g.activePlayerId, 'CHANGE_PHASE', `Turn ${g.turn} — ${active?.name || '?'}`);
    set({ game: { ...g, actionLog: [...g.actionLog, action] }, ui: { ...get().ui, combatMode: false } });
  },

  passPriority: () => {
    if (get().ui.screen === 'replay') return;
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
    g = clearCombatMana(g);
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
    const firebendingAmount = card ? getFirebendingAmount(card) : 0;
    if (card && firebendingAmount > 0) {
      g = addCombatManaToPool(g, card.controllerId, { R: firebendingAmount });
    }
    const triggers = card ? detectAttackTriggers(g, card) : [];
    const newTriggers: TriggerItem[] = triggers.map(t => ({
      id: uuid(), sourceInstanceId: t.sourceCard.instanceId,
      sourceName: t.sourceCard.definition.name, controllerId: t.sourceCard.controllerId,
      text: t.triggerText, triggerType: t.triggerType,
      acknowledged: false, missed: false, timestamp: Date.now(),
    }));
    const action = createAction(g, g.activePlayerId, 'DECLARE_ATTACKER',
      `${card?.definition.name} attacks ${targetPlayerId}`, [attackerInstanceId], addReviewData({}, flags), flags);
    const actions = [action];
    if (card && firebendingAmount > 0) {
      actions.push(createAction(
        g,
        card.controllerId,
        'ADD_MANA',
        `${card.definition.name} firebends ${firebendingAmount}: add ${firebendingAmount} red combat mana.`,
        [attackerInstanceId],
        { mechanicId: 'firebending', combatMana: { R: firebendingAmount } },
      ));
    }
    g = { ...g, actionLog: [...g.actionLog, ...actions], triggerQueue: [...g.triggerQueue, ...newTriggers] };
    set({ game: g, ui: withAssistantMessages(get().ui, g, flags) });
  },

  declareTokenStackAttack: (playerId, sourceGroupId, attackerIds, assignments) => {
    if (!canLocalControlPlayer(get(), playerId)) return false;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return routeHostAuthoritativeAction('declareTokenStackAttack', { playerId, sourceGroupId, attackerIds, assignments });
    }
    let g = get().game;
    if (!g.combat.active) {
      g = clearCombatAssignments(g);
      g = {
        ...g,
        combat: { ...g.combat, active: true, attackingPlayerId: playerId, attackers: [], blockers: [], attackAssignments: [], blockAssignments: [] },
      };
      g = setPhase(g, 'declareAttackers');
    }

    const result = declareTokenStackAttackInEngine(g, playerId, sourceGroupId, attackerIds, assignments);
    if (!result.valid) return false;

    const player = result.state.players.find(p => p.id === playerId);
    const assignmentSummary = result.state.combat.attackAssignments
      .filter(assignment => result.assignmentIds.includes(assignment.assignmentId))
      .map(assignment => `${assignment.count} ${assignment.sourceName}`)
      .join(', ');
    const action = createAction(
      result.state,
      playerId,
      'DECLARE_ATTACKER',
      `${player?.name ?? playerId} attacks with token stack: ${assignmentSummary}`,
      result.selectedAttackerIds,
      { sourceGroupId, assignmentIds: result.assignmentIds },
    );
    const nextGame = { ...result.state, actionLog: [...result.state.actionLog, action] };
    set({ game: nextGame, ui: { ...get().ui, combatMode: true } });
    return true;
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

  generateCombatPreview: () => {
    const g = get().game;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      routeHostAuthoritativeAction('generateCombatPreview', {});
      return generateCombatDamagePreview(g);
    }
    const preview = generateCombatDamagePreview(g);
    const action = createAction(
      g,
      g.activePlayerId,
      'NOTE',
      'Combat damage preview generated.',
      [],
      { mechanicId: 'combat-damage-preview', previewId: preview.previewId },
    );
    const next = {
      ...g,
      combat: {
        ...g.combat,
        damagePreview: preview,
      },
      actionLog: [...g.actionLog, action],
      lastUpdatedAt: Date.now(),
    };
    set({ game: next });
    return preview;
  },

  clearCombatPreview: () => {
    const g = get().game;
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return void routeHostAuthoritativeAction('clearCombatPreview', {});
    }
    set({
      game: {
        ...g,
        combat: {
          ...g.combat,
          damagePreview: undefined,
        },
        lastUpdatedAt: Date.now(),
      },
    });
  },

  confirmCombatDamage: () => {
    if (shouldRouteToHostAuthoritativeAction(get())) {
      return void routeHostAuthoritativeAction('confirmCombatDamage', {});
    }
    const g = get().game;
    set({
      game: {
        ...g,
        combat: {
          ...g.combat,
          damagePreview: undefined,
        },
        lastUpdatedAt: Date.now(),
      },
    });
    get().resolveCombatDamage();
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
          const power = getEffectivePowerToughness(attackerCard, g)?.power ?? 0;
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
          const attackerPower = getEffectivePowerToughness(attackerCard, g)?.power ?? 0;
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
              const blockerPower = getEffectivePowerToughness(blocker, g)?.power ?? 0;
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

    g = clearExpiredPowerToughnessOverrides(g, 'endOfCombat');
    g = clearCombatAssignments(g);
    g = clearCombatMana(g);
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
  openZoneDrawer: (zone, playerId, options) => set(s => {
    if (isPrivateZone(zone) && !canLocalControlPlayer(s as GameStore, playerId)) {
      warnBlockedPrivateZoneAction('openZoneDrawer', { ownerId: playerId, targetPlayerId: playerId, zone });
      return s;
    }
    return { ui: { ...s.ui, zoneDrawer: { zone, playerId, ...options } } };
  }),
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
  setUiSettingsOpen: (open) => set(s => ({ ui: { ...s.ui, uiSettingsOpen: open } })),
  updateUISettings: (settings) => set(s => {
    const nextSettings = normalizeUISettings({ ...s.ui.settings, ...settings });
    saveUISettings(nextSettings);
    return { ui: { ...s.ui, settings: nextSettings } };
  }),
  saveReplay: (name) => {
    const { game } = get();
    const replay = createReplay(game, name);
    saveReplayToStorage(replay);
  },
  exportReplayFile: (options) => {
    const state = get();
    return createReplayFileFromGame(state.game, options, {
      gameName: state.game.id,
      appVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
      buildCommit: import.meta.env.VITE_COMMIT_SHA ?? 'dev',
      mode: state.multiplayer.status === 'disconnected' ? 'solo' : 'multiplayer',
    });
  },
  loadReplayFile: async (file) => {
    let raw: unknown = file;
    if (typeof File !== 'undefined' && file instanceof File) {
      raw = await file.text();
    }
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        set(s => ({
          replay: s.replay
            ? { ...s.replay, status: 'error', warnings: [...s.replay.warnings, 'Replay file is not valid JSON.'] }
            : null,
        }));
        return false;
      }
    }
    const validation = validateReplayFile(raw);
    if (!validation.ok || !validation.replayFile) {
      const fallback = createReplaySession(createReplayFileFromGame(get().game, {
        includePrivateZones: false,
        includeFinalSnapshot: false,
        redacted: true,
      }));
      set({
        replay: { ...fallback, status: 'error', warnings: validation.errors },
        ui: { ...get().ui, screen: 'replay', lobbyOpen: false, replayOpen: false },
      });
      return false;
    }
    const checkpointInterval = DEFAULT_REPLAY_CHECKPOINT_INTERVAL;
    const checkpointResult = validation.replayFile.actionLog.length >= checkpointInterval
      ? createReplayCheckpointsWithWarnings(validation.replayFile, checkpointInterval)
      : { checkpoints: undefined, warnings: [] as string[] };
    const session = {
      ...createReplaySession(validation.replayFile),
      checkpoints: checkpointResult.checkpoints,
      checkpointInterval,
    };
    const liveGame = get().ui.screen === 'replay' ? get().replayLiveGame : get().game;
    set({
      replay: { ...session, warnings: [...session.warnings, ...validation.warnings, ...checkpointResult.warnings] },
      replayLiveGame: liveGame,
      game: session.currentGameState,
      ui: { ...get().ui, screen: 'replay', lobbyOpen: false, replayOpen: false, rightPanelTab: 'log' },
      multiplayer: { ...get().multiplayer, startHandshake: null },
    });
    return true;
  },
  startReplay: () => {
    const replay = get().replay;
    if (!replay) return;
    set({ game: replay.currentGameState, ui: { ...get().ui, screen: 'replay', lobbyOpen: false, replayOpen: false } });
  },
  exitReplay: () => {
    const liveGame = get().replayLiveGame;
    set({
      game: liveGame ?? createEmptyGameState(createDefaultGameConfig(4)),
      replay: null,
      replayLiveGame: null,
      ui: { ...get().ui, screen: liveGame ? 'game' : 'lobby', lobbyOpen: !liveGame, replayOpen: false },
    });
  },
  replayStepForward: () => {
    const replay = get().replay;
    if (!replay) return;
    const advanced = stepReplayForward(replay);
    const next = withReplayAnimations(advanced, advanced.currentActionIndex);
    set({ replay: next, game: next.currentGameState });
  },
  replayStepBackward: () => {
    const replay = get().replay;
    if (!replay) return;
    const next = { ...stepReplayBackward(replay), currentAnimations: [], animationQueue: [] };
    set({ replay: next, game: next.currentGameState });
  },
  replayJumpToAction: (actionIndex) => {
    const replay = get().replay;
    if (!replay) return;
    const next = { ...jumpReplayToAction(replay, actionIndex), currentAnimations: [], animationQueue: [] };
    set({ replay: next, game: next.currentGameState });
  },
  replayJumpToTurn: (turnNumber) => {
    const replay = get().replay;
    if (!replay) return;
    const next = { ...jumpReplayToTurn(replay, turnNumber), currentAnimations: [], animationQueue: [] };
    set({ replay: next, game: next.currentGameState });
  },
  replayPlay: () => set(s => s.replay ? { replay: { ...s.replay, status: 'playing' } } : s),
  replayPause: () => set(s => s.replay ? { replay: { ...s.replay, status: 'paused' } } : s),
  replaySetSpeed: (speed) => set(s => s.replay ? { replay: { ...s.replay, speed, currentAnimations: speed === 'instant' ? [] : s.replay.currentAnimations } } : s),
  replaySetAnimationMode: (mode) => set(s => s.replay ? {
    replay: {
      ...s.replay,
      animationMode: mode,
      animationEnabled: mode !== 'off',
      currentAnimations: mode === 'off' ? [] : s.replay.currentAnimations,
      animationQueue: mode === 'off' ? [] : s.replay.animationQueue,
    },
  } : s),
  replaySetAnimationSpeed: (speed) => set(s => s.replay ? {
    replay: { ...s.replay, animationSpeed: Math.max(0.25, Math.min(4, speed)) },
  } : s),
  replayPlayCurrentAnimation: () => set(s => {
    if (!s.replay || s.replay.currentActionIndex < 0) return s;
    const replay = withReplayAnimations(s.replay, s.replay.currentActionIndex);
    return { replay };
  }),
  replaySkipAnimation: () => set(s => s.replay ? { replay: { ...s.replay, currentAnimations: [], animationQueue: [] } } : s),
  replayClearAnimations: () => set(s => s.replay ? { replay: { ...s.replay, currentAnimations: [], animationQueue: [] } } : s),
  setJudgeMode: (on) => set(s => ({ ui: { ...s.ui, judgeMode: on } })),
  setTableViewMode: (mode) => set(s => ({ ui: { ...s.ui, tableViewMode: mode } })),
  toggleBattlefieldView: () => set(s => ({ ui: { ...s.ui, battlefieldView: s.ui.battlefieldView === 'normal' ? 'overview' : 'normal' } })),
  toggleCombatMode: () => set(s => ({ ui: { ...s.ui, combatMode: !s.ui.combatMode } })),
  enterGameScreen: () => set(s => ({ ui: { ...s.ui, screen: 'game', lobbyOpen: false } })),
  setLobbyOpen: (open) => set(s => ({ ui: { ...s.ui, screen: open ? 'lobby' : 'game', lobbyOpen: open } })),
  setDeckBuilderOpen: (open) => set(s => ({ ui: { ...s.ui, deckBuilderOpen: open } })),
  openSoloDeckLab: () => set(s => ({
    ui: {
      ...s.ui,
      screen: 'lobby',
      lobbyOpen: true,
      soloModeTab: s.ui.soloModeTab ?? 'builder',
      deckBuilderOpen: false,
    },
  })),
  setSoloModeTab: (tab) => set(s => ({ ui: { ...s.ui, soloModeTab: tab } })),
  loadSoloDeck: (deck) => {
    const prepared = prepareCommanderDeckForUse(deck);
    const validation = validateCommanderDraft(prepared.deck);
    set(s => ({
      soloDeckLab: {
        ...s.soloDeckLab,
        activeDeckId: prepared.deck.id,
        draftDeck: prepared.deck,
        lastValidation: validation,
        unsavedChanges: false,
      },
      ui: { ...s.ui, soloModeTab: s.ui.soloModeTab ?? 'builder' },
    }));
  },
  createSoloDraftDeck: (name = 'Untitled Solo Deck') => {
    const deck = createBlankDeck(name);
    set(s => ({
      soloDeckLab: {
        ...s.soloDeckLab,
        activeDeckId: deck.id,
        draftDeck: deck,
        lastValidation: validateCommanderDraft(deck),
        unsavedChanges: true,
      },
      ui: { ...s.ui, soloModeTab: 'builder' },
    }));
  },
  setSoloDraftDeck: (deck, options = {}) => {
    const validation = validateCommanderDraft(deck);
    set(s => ({
      soloDeckLab: {
        ...s.soloDeckLab,
        activeDeckId: deck.id,
        draftDeck: deck,
        lastValidation: validation,
        unsavedChanges: options.unsaved ?? true,
      },
    }));
  },
  saveSoloDraftDeck: () => {
    const draft = get().soloDeckLab.draftDeck;
    if (!draft) return false;
    const saved = { ...draft, importedAt: Date.now() };
    saveDeck(saved);
    set(s => ({
      decks: loadDecksFromStorage(),
      soloDeckLab: {
        ...s.soloDeckLab,
        activeDeckId: saved.id,
        draftDeck: saved,
        lastValidation: validateCommanderDraft(saved),
        unsavedChanges: false,
      },
    }));
    return true;
  },
  importSoloDeckText: async (text, name = 'Solo Deck Lab Import') => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const result = await importDecklist(trimmed, name, undefined, undefined, undefined, {
      allowBannedCards: true,
      captureFetchedCardData: true,
    });
    set(s => ({
      soloDeckLab: {
        ...s.soloDeckLab,
        activeDeckId: result.deck.id,
        draftDeck: result.deck,
        lastValidation: validateCommanderDraft(result.deck),
        unsavedChanges: true,
      },
      ui: { ...s.ui, soloModeTab: s.ui.soloModeTab ?? 'builder' },
    }));
    return result.cardCount > 0 && result.errors.length === 0;
  },
  renameSoloDeck: (deckId, name) => {
    const trimmed = name.trim();
    if (!deckId || !trimmed) return false;
    const state = get();
    const current = state.soloDeckLab.draftDeck?.id === deckId
      ? state.soloDeckLab.draftDeck
      : state.decks.find(deck => deck.id === deckId);
    if (!current) return false;
    const renamed = { ...current, name: trimmed, importedAt: Date.now() };
    saveDeck(renamed);
    set(s => ({
      decks: loadDecksFromStorage(),
      soloDeckLab: {
        ...s.soloDeckLab,
        draftDeck: s.soloDeckLab.draftDeck?.id === deckId ? renamed : s.soloDeckLab.draftDeck,
        lastValidation: s.soloDeckLab.draftDeck?.id === deckId ? validateCommanderDraft(renamed) : s.soloDeckLab.lastValidation,
        unsavedChanges: s.soloDeckLab.draftDeck?.id === deckId ? false : s.soloDeckLab.unsavedChanges,
      },
    }));
    return true;
  },
  deleteSoloDeck: (deckId) => {
    if (!deckId) return false;
    deleteDeck(deckId);
    set(s => ({
      decks: loadDecksFromStorage(),
      soloDeckLab: s.soloDeckLab.activeDeckId === deckId
        ? {
          ...s.soloDeckLab,
          activeDeckId: undefined,
          draftDeck: undefined,
          lastValidation: undefined,
          unsavedChanges: false,
        }
        : s.soloDeckLab,
    }));
    return true;
  },
  duplicateSoloDeck: (deckId) => {
    const state = get();
    const source = state.soloDeckLab.draftDeck?.id === deckId
      ? state.soloDeckLab.draftDeck
      : state.decks.find(deck => deck.id === deckId);
    if (!source) return undefined;
    const copy: Deck = {
      ...source,
      id: uuid(),
      name: `${source.name} Copy`,
      importedAt: Date.now(),
    };
    saveDeck(copy);
    set(s => ({
      decks: loadDecksFromStorage(),
      soloDeckLab: {
        ...s.soloDeckLab,
        activeDeckId: copy.id,
        draftDeck: copy,
        lastValidation: validateCommanderDraft(copy),
        unsavedChanges: false,
      },
      ui: { ...s.ui, soloModeTab: s.ui.soloModeTab ?? 'builder' },
    }));
    return copy.id;
  },
  drawSoloOpeningHand: () => {
    const state = get();
    const deck = state.soloDeckLab.draftDeck
      ?? state.decks.find(candidate => candidate.id === state.soloDeckLab.activeDeckId);
    if (!deck) return false;
    const opening = createOpeningHandSession(deck);
    set(s => ({
      soloDeckLab: {
        ...s.soloDeckLab,
        activeDeckId: deck.id,
        draftDeck: deck,
        testSession: {
          id: uuid(),
          deckId: deck.id,
          startedAt: Date.now(),
          mode: 'test_hand',
          ...opening,
        },
      },
      ui: { ...s.ui, soloModeTab: 'test_hand' },
    }));
    return true;
  },
  mulliganSoloOpeningHand: () => {
    const state = get();
    const deck = state.soloDeckLab.draftDeck
      ?? state.decks.find(candidate => candidate.id === state.soloDeckLab.activeDeckId);
    const session = state.soloDeckLab.testSession;
    if (!deck || !session?.currentHand) return false;
    const opening = mulliganOpeningHandSession(deck, session);
    set(s => ({
      soloDeckLab: {
        ...s.soloDeckLab,
        testSession: {
          ...session,
          ...opening,
        },
      },
    }));
    return true;
  },
  setSoloOpeningHandCardsToBottom: (cardIds) => {
    const session = get().soloDeckLab.testSession;
    if (!session?.currentHand) return false;
    const next = setOpeningHandCardsToBottom(session, cardIds);
    set(s => ({
      soloDeckLab: {
        ...s.soloDeckLab,
        testSession: {
          ...session,
          ...next,
        },
      },
    }));
    return true;
  },
  keepSoloOpeningHand: (cardIdsToBottom) => {
    const session = get().soloDeckLab.testSession;
    if (!session?.currentHand) return false;
    const next = keepOpeningHandSession(session, cardIdsToBottom);
    set(s => ({
      soloDeckLab: {
        ...s.soloDeckLab,
        testSession: {
          ...session,
          ...next,
        },
      },
    }));
    return true;
  },
  newSoloOpeningHand: () => get().drawSoloOpeningHand(),
  startSoloGoldfishGame: async (options = {}) => {
    if (options.fromKeptHand && get().soloDeckLab.testSession?.currentHand?.length) {
      const started = await get().startSoloGameFromOpeningHand(options);
      if (started) {
        set(s => ({
          soloDeckLab: {
            ...s.soloDeckLab,
            testSession: s.soloDeckLab.testSession
              ? { ...s.soloDeckLab.testSession, mode: 'goldfish', kept: true }
              : s.soloDeckLab.testSession,
          },
        }));
      }
      return started;
    }
    if (options.randomOpeningHand) {
      const drew = get().drawSoloOpeningHand();
      if (!drew) return false;
      get().keepSoloOpeningHand([]);
      const started = await get().startSoloGameFromOpeningHand(options);
      if (started) {
        set(s => ({
          soloDeckLab: {
            ...s.soloDeckLab,
            testSession: s.soloDeckLab.testSession
              ? { ...s.soloDeckLab.testSession, mode: 'goldfish', kept: true }
              : s.soloDeckLab.testSession,
          },
        }));
      }
      return started;
    }
    return get().startSoloDeckLabGame('goldfish', options);
  },
  resetSoloGoldfishGame: async (options = {}) => get().startSoloGoldfishGame({ ...options, randomOpeningHand: true }),
  canUseSoloSandboxTools: () => canUseSoloSandboxToolsState(get()),
  sandboxDrawCards: (count = 1) => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const player = getSoloSandboxPlayer(state);
    const amount = sanitizeSandboxCount(count);
    if (!player || amount <= 0) return false;
    get().drawCard(player.id, amount);
    return true;
  },
  sandboxRevealTopCards: (count = 1) => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const player = getSoloSandboxPlayer(state);
    const amount = sanitizeSandboxCount(count);
    if (!player || amount <= 0) return false;
    get().lookAtTopCards(player.id, amount, player.id);
    get().logAction(player.id, 'SEARCH_LIBRARY', `${player.name} revealed the top ${amount} card(s) in sandbox.`);
    return true;
  },
  sandboxSearchLibrary: () => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const player = getSoloSandboxPlayer(state);
    if (!player) return false;
    get().openZoneDrawer('library', player.id, { mode: 'search', viewerId: player.id, private: true });
    get().logAction(player.id, 'SEARCH_LIBRARY', `${player.name} opened sandbox library search.`);
    return true;
  },
  sandboxShuffleLibrary: () => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const player = getSoloSandboxPlayer(state);
    if (!player) return false;
    get().shuffleLibrary(player.id);
    get().logAction(player.id, 'SHUFFLE', `${player.name} shuffled their library in sandbox.`);
    return true;
  },
  sandboxCreateToken: (name = 'Sandbox Token', count = 1, power = '1', toughness = '1') => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return [];
    const player = getSoloSandboxPlayer(state);
    const amount = sanitizeSandboxCount(count);
    const tokenName = name.trim() || 'Sandbox Token';
    if (!player || amount <= 0) return [];
    const tokenDef: Parameters<typeof createToken>[2] = {
      name: tokenName,
      typeLine: `Token Creature - ${tokenName}`,
      power: power.trim() || '1',
      toughness: toughness.trim() || '1',
      colors: [],
      colorIdentity: [],
      cardTypes: ['Creature'],
      subTypes: [tokenName],
      keywords: [],
      oracleText: '',
    };
    return get().createTokenCards(player.id, tokenDef, amount);
  },
  sandboxSetLifeTotal: (life) => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const player = getSoloSandboxPlayer(state);
    if (!player || !Number.isFinite(life)) return false;
    const nextLife = Math.floor(life);
    const nextGame: GameState = {
      ...state.game,
      players: state.game.players.map(current =>
        current.id === player.id ? { ...current, life: nextLife } : current
      ),
      lastUpdatedAt: Date.now(),
    };
    const action = createAction(
      nextGame,
      player.id,
      'CHANGE_LIFE',
      `Sandbox set ${player.name} life to ${nextLife}.`,
      [],
      { sandbox: true, previousLife: player.life, life: nextLife },
    );
    set({ game: { ...nextGame, actionLog: [...nextGame.actionLog, action] } });
    return true;
  },
  sandboxAddCounter: (instanceId, counterType, amount = 1) => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const card = state.game.cards[instanceId];
    const safeType = counterType.trim() || '+1/+1';
    const safeAmount = sanitizeSandboxCount(amount);
    if (!card || safeAmount <= 0) return false;
    get().addCounterToCard(instanceId, safeType, safeAmount);
    return true;
  },
  sandboxRemoveCounter: (instanceId, counterType, amount = 1) => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const card = state.game.cards[instanceId];
    const safeType = counterType.trim() || '+1/+1';
    const safeAmount = sanitizeSandboxCount(amount);
    if (!card || safeAmount <= 0) return false;
    get().removeCounterFromCard(instanceId, safeType, safeAmount);
    return true;
  },
  sandboxSetPowerToughnessOverride: (instanceIds, power, toughness, reason = 'Solo sandbox override', expires = 'manual') => {
    if (!canUseSoloSandboxToolsState(get())) return false;
    return get().setPowerToughnessOverride(instanceIds, power, toughness, expires, reason);
  },
  sandboxClearPowerToughnessOverride: (instanceIds) => {
    if (!canUseSoloSandboxToolsState(get())) return false;
    return get().clearPowerToughnessOverride(instanceIds);
  },
  sandboxMoveCardToZone: (instanceId, zone) => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const card = state.game.cards[instanceId];
    if (!card) return false;
    get().moveCardToZone(instanceId, zone, card.controllerId);
    return true;
  },
  sandboxAddManaNote: (text) => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const player = getSoloSandboxPlayer(state);
    const trimmed = text.trim();
    if (!player || !trimmed) return false;
    get().logAction(player.id, 'NOTE', `Sandbox resource note: ${trimmed}`);
    return true;
  },
  sandboxForcePhase: (phase) => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const player = getSoloSandboxPlayer(state);
    get().goToPhase(phase);
    if (player) {
      get().logAction(player.id, 'OTHER', `Sandbox forced phase to ${phase}.`);
    }
    return true;
  },
  sandboxAdvanceTurn: () => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const player = getSoloSandboxPlayer(state);
    get().advanceTurn();
    if (player) {
      get().logAction(player.id, 'OTHER', 'Sandbox advanced to the next turn.');
    }
    return true;
  },
  sandboxResetBoard: () => {
    const state = get();
    if (!canUseSoloSandboxToolsState(state)) return false;
    const player = getSoloSandboxPlayer(state);
    if (!player) return false;
    const resetZones = new Set<CardState['zone']>(['battlefield', 'graveyard', 'exile', 'stack']);
    const affectedIds = Object.values(state.game.cards)
      .filter(card => card.controllerId === player.id && resetZones.has(card.zone))
      .map(card => card.instanceId);
    if (affectedIds.length === 0) {
      get().logAction(player.id, 'OTHER', 'Sandbox reset board: nothing to reset.');
      return true;
    }
    const tokenIds = new Set(affectedIds.filter(id => state.game.cards[id]?.token));
    const returningIds = affectedIds.filter(id => !tokenIds.has(id));
    const nextCards = { ...state.game.cards };
    for (const id of affectedIds) {
      const card = nextCards[id];
      if (!card) continue;
      if (tokenIds.has(id)) {
        delete nextCards[id];
        continue;
      }
      nextCards[id] = {
        ...card,
        zone: 'library',
        tapped: false,
        counters: [],
        markedForDamage: 0,
        combatRole: 'none',
        attackTarget: undefined,
        blockTarget: undefined,
        powerToughnessOverride: undefined,
      };
    }
    const nextGame: GameState = {
      ...state.game,
      cards: nextCards,
      players: state.game.players.map(current => {
        if (current.id !== player.id) return current;
        return {
          ...current,
          battlefield: current.battlefield.filter(id => !affectedIds.includes(id)),
          graveyard: current.graveyard.filter(id => !affectedIds.includes(id)),
          exile: current.exile.filter(id => !affectedIds.includes(id)),
          library: [...current.library.filter(id => !affectedIds.includes(id)), ...returningIds],
        };
      }),
      lastUpdatedAt: Date.now(),
    };
    const action = createAction(
      nextGame,
      player.id,
      'OTHER',
      `Sandbox reset board: returned ${returningIds.length} card(s) to library and removed ${tokenIds.size} token(s).`,
      affectedIds,
      { sandbox: true, returnedToLibrary: returningIds.length, removedTokens: tokenIds.size },
    );
    set({ game: { ...nextGame, actionLog: [...nextGame.actionLog, action] } });
    return true;
  },
  sandboxAddManualTrigger: (instanceId, text) => {
    if (!canUseSoloSandboxToolsState(get())) return false;
    return get().addManualTriggerForCard(instanceId, text);
  },
  sandboxSetCardNote: (instanceId, note) => {
    if (!canUseSoloSandboxToolsState(get())) return false;
    return get().setCardTemporaryNote(instanceId, note);
  },
  startSoloDummyPracticeGame: async (dummyOpponents, options = {}) => {
    const before = get();
    if (before.ui.screen === 'replay') return false;
    if (before.multiplayer.status !== 'disconnected') return false;
    const configs = (dummyOpponents.length ? dummyOpponents : [{ profile: 'training' as const }])
      .slice(0, 5)
      .map(config => normalizeDummyOpponentConfig(config));
    const started = await get().startSoloDeckLabGame('dummy', options);
    if (!started) return false;
    let nextGame = get().game;
    const blockerIds: string[] = [];
    for (const config of configs) {
      const added = addDummyOpponentToGame(nextGame, config);
      nextGame = added.state;
      blockerIds.push(...added.blockerIds);
    }
    const action = createAction(
      nextGame,
      nextGame.activePlayerId,
      'OTHER',
      `Started solo dummy practice with ${configs.map(config => config.name).join(', ')}.`,
      blockerIds,
      { dummyPractice: true, dummyOpponents: configs },
    );
    nextGame = { ...nextGame, actionLog: [...nextGame.actionLog, action], lastUpdatedAt: Date.now() };
    set(s => ({
      game: nextGame,
      soloDeckLab: {
        ...s.soloDeckLab,
        testSession: s.soloDeckLab.testSession
          ? { ...s.soloDeckLab.testSession, mode: 'dummy', dummyOpponents: configs }
          : { id: uuid(), startedAt: Date.now(), mode: 'dummy', gameId: nextGame.id, dummyOpponents: configs },
      },
    }));
    return true;
  },
  removeDummyOpponent: (dummyPlayerId) => {
    const state = get();
    if (state.multiplayer.status !== 'disconnected') return false;
    const dummy = state.game.players.find(player => player.id === dummyPlayerId && player.isDummy);
    if (!dummy) return false;
    const removedCardIds = Object.values(state.game.cards)
      .filter(card => card.ownerId === dummy.id || card.controllerId === dummy.id)
      .map(card => card.instanceId);
    const removedSet = new Set(removedCardIds);
    const nextCards = Object.fromEntries(Object.entries(state.game.cards).filter(([id]) => !removedSet.has(id)));
    const remainingPlayers = state.game.players.filter(player => player.id !== dummy.id);
    const nextGame: GameState = {
      ...state.game,
      cards: nextCards,
      players: remainingPlayers,
      config: { ...state.game.config, playerCount: Math.max(1, remainingPlayers.length) as GameConfig['playerCount'] },
      combat: clearCombatAssignments(state.game).combat,
      lastUpdatedAt: Date.now(),
    };
    const action = createAction(nextGame, state.localPlayerId || nextGame.activePlayerId, 'OTHER', `Removed dummy opponent ${dummy.name}.`, removedCardIds, { dummyPractice: true });
    set(s => ({
      game: { ...nextGame, actionLog: [...nextGame.actionLog, action] },
      soloDeckLab: {
        ...s.soloDeckLab,
        testSession: s.soloDeckLab.testSession
          ? {
            ...s.soloDeckLab.testSession,
            dummyOpponents: s.soloDeckLab.testSession.dummyOpponents?.filter(config => config.id !== dummy.id),
          }
          : s.soloDeckLab.testSession,
      },
    }));
    return true;
  },
  autoBlockForDummy: (dummyPlayerId) => {
    const state = get();
    if (state.multiplayer.status !== 'disconnected') return false;
    const result = autoBlockForDummyInEngine(state.game, dummyPlayerId);
    if (!result.blocked) return false;
    const dummy = result.state.players.find(player => player.id === dummyPlayerId);
    const blocker = result.blockerId ? result.state.cards[result.blockerId] : undefined;
    const attacker = result.attackerId ? result.state.cards[result.attackerId] : undefined;
    const action = createAction(
      result.state,
      dummyPlayerId,
      'DECLARE_BLOCKER',
      `${dummy?.name ?? 'Dummy'} auto-blocks ${attacker?.definition.name ?? 'attacker'} with ${blocker?.definition.name ?? 'blocker'}.`,
      [result.blockerId, result.attackerId].filter((id): id is string => Boolean(id)),
      { dummyPractice: true, autoBlock: true },
    );
    set({ game: { ...result.state, actionLog: [...result.state.actionLog, action], lastUpdatedAt: Date.now() } });
    return true;
  },
  advanceDummyTurn: (dummyPlayerId) => {
    const state = get();
    if (state.multiplayer.status !== 'disconnected') return false;
    const dummy = state.game.players.find(player => player.id === dummyPlayerId && player.isDummy);
    if (!dummy) return false;
    const nextGame = advanceDummyTurnInEngine(state.game, dummyPlayerId);
    set({ game: nextGame });
    return nextGame !== state.game;
  },
  startSoloGameFromOpeningHand: async (options = {}) => {
    if (get().ui.screen === 'replay') return false;
    const state = get();
    const session = state.soloDeckLab.testSession;
    const activeDeck = state.soloDeckLab.draftDeck
      ?? state.decks.find(deck => deck.id === state.soloDeckLab.activeDeckId);
    if (!activeDeck || !session?.currentHand?.length) return false;
    const prepared = prepareCommanderDeckForUse(activeDeck);
    const playerInput = options.player;
    const activeProfile = (!playerInput?.name?.trim() || !playerInput?.color) ? getActiveProfile() : null;
    const playerId = playerInput?.id || state.localPlayerId || state.game.players[0]?.id || uuid();
    const config: GameConfig = {
      ...createDefaultGameConfig(1),
      startingLife: options.startingLife ?? state.game.config.startingLife ?? 40,
      houseRules: options.houseRules ?? [],
    };
    const soloPlayer = createPlayer(
      playerId,
      playerInput?.name?.trim() || activeProfile?.displayName || 'Solo Player',
      0,
      playerInput?.color || activeProfile?.color || PLAYER_COLORS[0],
      config,
      {
        initial: playerInput?.avatarInitial,
        style: playerInput?.avatarStyle,
        image: playerInput?.avatarImage,
      },
    );
    let nextGame: GameState = {
      ...createEmptyGameState(config),
      players: [soloPlayer],
      activePlayerId: soloPlayer.id,
      priorityPlayerId: soloPlayer.id,
    };
    nextGame = await loadDeckIntoPlayer(nextGame, soloPlayer.id, prepared.deck);
    nextGame = arrangeOpeningHandInGame(nextGame, soloPlayer.id, {
      ...session,
      kept: session.kept ?? true,
    });
    const startedGame = buildStartedGame(nextGame);
    set(s => ({
      game: startedGame,
      localPlayerId: soloPlayer.id,
      soloDeckLab: {
        ...s.soloDeckLab,
        activeDeckId: prepared.deck.id,
        draftDeck: prepared.deck,
        lastValidation: validateCommanderDraft(prepared.deck),
        testSession: {
          ...session,
          deckId: prepared.deck.id,
          gameId: startedGame.id,
          mode: 'test_hand',
          kept: true,
        },
      },
      ui: {
        ...s.ui,
        screen: 'game',
        lobbyOpen: false,
        deckBuilderOpen: true,
      },
    }));
    return true;
  },
  startSoloDeckLabGame: async (mode = 'goldfish', options = {}) => {
    if (get().ui.screen === 'replay') return false;

    const state = get();
    const activeDeck = state.soloDeckLab.draftDeck
      ?? state.decks.find(deck => deck.id === state.soloDeckLab.activeDeckId);
    const prepared = activeDeck ? prepareCommanderDeckForUse(activeDeck) : null;
    const playerInput = options.player;
    const activeProfile = (!playerInput?.name?.trim() || !playerInput?.color) ? getActiveProfile() : null;
    const playerId = playerInput?.id || state.localPlayerId || state.game.players[0]?.id || uuid();
    const config: GameConfig = {
      ...createDefaultGameConfig(1),
      startingLife: options.startingLife ?? state.game.config.startingLife ?? 40,
      houseRules: options.houseRules ?? [],
    };
    const soloPlayer = createPlayer(
      playerId,
      playerInput?.name?.trim() || activeProfile?.displayName || 'Solo Player',
      0,
      playerInput?.color || activeProfile?.color || PLAYER_COLORS[0],
      config,
      {
        initial: playerInput?.avatarInitial,
        style: playerInput?.avatarStyle,
        image: playerInput?.avatarImage,
      },
    );
    let nextGame: GameState = {
      ...createEmptyGameState(config),
      players: [soloPlayer],
      activePlayerId: soloPlayer.id,
      priorityPlayerId: soloPlayer.id,
    };

    if (prepared) {
      nextGame = await loadDeckIntoPlayer(nextGame, soloPlayer.id, prepared.deck);
    }

    const startedGame = buildStartedGame(nextGame);
    const validation: DeckValidationResult | undefined = prepared
      ? validateCommanderDraft(prepared.deck)
      : state.soloDeckLab.lastValidation;
    set(s => ({
      game: startedGame,
      localPlayerId: soloPlayer.id,
      soloDeckLab: {
        ...s.soloDeckLab,
        activeDeckId: prepared?.deck.id ?? s.soloDeckLab.activeDeckId,
        draftDeck: prepared?.deck ?? s.soloDeckLab.draftDeck,
        lastValidation: validation,
        testSession: {
          id: uuid(),
          deckId: prepared?.deck.id ?? s.soloDeckLab.activeDeckId,
          startedAt: Date.now(),
          gameId: startedGame.id,
          mode,
        },
      },
      ui: {
        ...s.ui,
        screen: 'game',
        lobbyOpen: false,
        deckBuilderOpen: true,
      },
    }));
    return true;
  },
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
    if (!canLocalControlPlayer(get(), playerId)) return;
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
    if (!canLocalControlPlayer(get(), playerId)) return;
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
    const actualViewer = viewerId ?? get().localPlayerId;
    if (!canLocalControlPlayer(get(), playerId) || actualViewer !== playerId) return;
    const { game } = get();
    const player = game.players.find(p => p.id === playerId);
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
    if (!canLocalControlPlayer(get(), playerId)) return;
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
    let updatedGame = get().game;
    const chosenCardIds = choices?.cardIds ?? Object.values(updatedGame.cards)
      .filter(card => card.zone === 'battlefield' && cardHasCounters(card))
      .map(card => card.instanceId);
    const chosenPlayerIds = choices?.playerIds ?? updatedGame.players
      .filter(playerHasCounters)
      .map(player => player.id);
    const cardSet = new Set(chosenCardIds);
    const playerSet = new Set(chosenPlayerIds);
    for (const id of cardSet) {
      const card = updatedGame.cards[id];
      if (!card || card.zone !== 'battlefield' || !cardHasCounters(card)) continue;
      for (const counter of card.counters) {
        if (counter.count > 0) {
          updatedGame = addCounter(updatedGame, id, counter.type, 1);
        }
      }
    }
    const players = updatedGame.players.map(player => {
      if (!playerSet.has(player.id) || !playerHasCounters(player)) return player;
      return {
        ...player,
        poisonCounters: player.poisonCounters > 0 ? player.poisonCounters + 1 : player.poisonCounters,
        energyCounters: player.energyCounters > 0 ? player.energyCounters + 1 : player.energyCounters,
        experienceCounters: player.experienceCounters > 0 ? player.experienceCounters + 1 : player.experienceCounters,
      };
    });
    const affected = [
      ...chosenCardIds.filter(id => updatedGame.cards[id] && cardHasCounters(updatedGame.cards[id])),
      ...chosenPlayerIds.filter(id => {
        const player = updatedGame.players.find(p => p.id === id);
        return Boolean(player && playerHasCounters(player));
      }),
    ];
    const action = createAction(updatedGame, controllerId, 'PROLIFERATE',
      `Proliferated ${affected.length} object${affected.length === 1 ? '' : 's'}`, affected, {
        cardIds: chosenCardIds,
        playerIds: chosenPlayerIds,
        ruleRef: 'CR 701.34a',
      });
    set({ game: { ...updatedGame, players, actionLog: [...updatedGame.actionLog, action], lastUpdatedAt: Date.now() } });
  },

  cycleCard: (playerId, instanceId) => {
    if (!canLocalControlPlayer(get(), playerId)) return;
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card || card.zone !== 'hand') return;
    if (!canLocalAccessCard(get(), card) || findCardOwner(g, card) !== playerId) return;
    g = discardCard(g, playerId, instanceId);
    g = drawCards(g, playerId, 1);
    const action = createAction(g, playerId, 'CYCLE',
      `Cycled ${card.definition.name} — drew 1`, [instanceId]);
    set({ game: { ...g, actionLog: [...g.actionLog, action] } });
  },

  castFromZone: (playerId, instanceId, fromZone) => {
    if (!canLocalControlPlayer(get(), playerId)) {
      warnBlockedPrivateZoneAction('castFromZone', { targetPlayerId: playerId, zone: fromZone });
      return;
    }
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    if (!canLocalPerformPrivateCardAction(get(), 'castFromZone', card)) return;
    if (!canLocalAccessCard(get(), card)) return;
    if (!canLocalControlCard(get(), card)) {
      if (isPrivateZone(card.zone)) warnBlockedPrivateZoneAction('castFromZone', { card });
      return;
    }
    if (isPrivateZone(card.zone) && findCardOwner(g, card) !== playerId) {
      warnBlockedPrivateZoneAction('castFromZone', { card, ownerId: findCardOwner(g, card), targetPlayerId: playerId });
      return;
    }
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
    if (!canLocalControlPlayer(get(), toControllerId)) {
      warnBlockedPrivateZoneAction('reanimateCard', { targetPlayerId: toControllerId, zone: 'battlefield' });
      return;
    }
    let g = get().game;
    const card = g.cards[instanceId];
    if (!card) return;
    if (!canLocalPerformPrivateCardAction(get(), 'reanimateCard', card)) return;
    if (!canLocalAccessCard(get(), card)) return;
    if (!canLocalControlCard(get(), card)) {
      if (isPrivateZone(card.zone)) warnBlockedPrivateZoneAction('reanimateCard', { card });
      return;
    }
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
// Host-authoritative sync: only the host publishes sanitized game patches.
// Joined clients use protocol action requests instead of broadcasting Zustand.
useGameStore.subscribe(
  (state, prevState) => {
    const game = state.game;
    const prevGame = prevState.game;
    const { multiplayer } = useGameStore.getState();
    if (state.ui.screen === 'replay') return;
    // Only broadcast if we’re in a room and it’s a real change
    if (multiplayer.status === 'host') {
      // Don’t broadcast if this was an incoming remote update (same lastUpdatedAt)
      if (game.lastUpdatedAt !== prevGame.lastUpdatedAt) {
        broadcastState(game);
      }
      return;
    }

    if (multiplayer.status === 'joined' && !applyingRemoteMultiplayerGame) {
      const latestAction = game.actionLog[game.actionLog.length - 1];
      const previousLatestAction = prevGame.actionLog[prevGame.actionLog.length - 1];
      if (latestAction && latestAction.id !== previousLatestAction?.id) {
        sendGameActionRequest(latestAction.actionType, {
          actionId: latestAction.id,
          turn: latestAction.turn,
          phase: latestAction.phase,
          playerId: latestAction.playerId,
          description: latestAction.description,
          affectedObjects: latestAction.affectedObjects,
          data: latestAction.data,
        });
      }
    }
  },
);



