// ─── Game State Engine ─────────────────────────────────────────────────────────
import { v4 as uuid } from 'uuid';
import type {
  GameState, Player, CardState, CardDefinition, ActionRecord, ActionType,
  Phase, StackObject, TriggerItem, AssistantFlag, Deck, GameConfig, Counter, CombatState, CustomCardDefinition,
  PlayerAvatarImage, ManaPool,
} from '../types/game';
import { fetchCardsByNames } from '../data/cardDatabase';
import { getEffectiveCardDefinition, getEffectiveOracleText } from './cardFaces';
import { normalizeCommanderDeck } from './deckImport';
import { PHASE_ORDER } from './phaseMeta';

// ─── Factory Helpers ──────────────────────────────────────────────────────────

const EMPTY_MANA_POOL: ManaPool = {
  W: 0,
  U: 0,
  B: 0,
  R: 0,
  G: 0,
  C: 0,
  generic: 0,
};

export function createDefaultGameConfig(playerCount: 1 | 2 | 3 | 4 | 5 | 6 = 4): GameConfig {
  return {
    playerCount,
    format: 'commander',
    startingLife: 40,
    useCommanderDamage: true,
    useInfect: true,
    startingHandSize: 7,
    maxMulligans: 6,
    commanderTaxEnabled: true,
    houseRules: [],
    timerEnabled: false,
  };
}

export function createPlayer(
  id: string,
  name: string,
  seatIndex: number,
  color: string,
  config: GameConfig,
  avatar?: { initial?: string; style?: Player['avatarStyle']; image?: PlayerAvatarImage }
): Player {
  return {
    id,
    name,
    color,
    avatarInitial: avatar?.initial,
    avatarStyle: avatar?.style,
    avatarImage: avatar?.image,
    seatIndex,
    life: config.startingLife,
    mulliganCount: 0,
    manaPool: { ...EMPTY_MANA_POOL },
    commanderDamage: {},
    poisonCounters: 0,
    energyCounters: 0,
    experienceCounters: 0,
    commanderCastCount: {},
    commanders: [],
    isReady: false,
    isActive: false,
    hasPriority: false,
    hand: [],
    library: [],
    graveyard: [],
    exile: [],
    sideboard: [],
    maybeboard: [],
    commandZone: [],
    battlefield: [],
    connected: true,
    isSpectator: false,
    settings: {
      assistantMode: 'ON',
      assistantVerbosity: 'normal',
      showTriggerReminders: true,
      showStackExplanations: true,
      coachingLevel: 'intermediate',
      isJudgeMode: false,
    },
  };
}

export function createCardState(
  def: CardDefinition,
  ownerId: string,
  zone: 'library' | 'hand' | 'command' | 'sideboard' | 'maybeboard' = 'library',
  isCommander = false,
  isToken = false
): CardState {
  return {
    instanceId: uuid(),
    definitionId: def.id,
    definition: def,
    zone,
    ownerId,
    controllerId: ownerId,
    tapped: false,
    faceDown: false,
    transformed: false,
    phased: false,
    counters: [],
    attachments: [],
    attachedTo: undefined,
    markedForDamage: 0,
    summoningSick: false,
    token: isToken,
    copy: false,
    notes: '',
    exilePermanent: false,
    combatRole: 'none',
    combatDamageAssigned: 0,
    visualX: Math.random() * 80 + 10,
    visualY: Math.random() * 80 + 10,
  };
}

export function createEmptyGameState(config: GameConfig): GameState {
  return {
    id: uuid(),
    config,
    players: [],
    cards: {},
    definitions: {},
    turn: 1,
    activePlayerId: '',
    priorityPlayerId: '',
    phase: 'main1',
    stack: [],
    triggerQueue: [],
    actionLog: [],
    assistantFlags: [],
    combat: createEmptyCombat(),
    houseRules: config.houseRules,
    snapshots: {},
    undoPointer: 0,
    createdAt: Date.now(),
    lastUpdatedAt: Date.now(),
    status: 'lobby',
  };
}

function createEmptyCombat(): CombatState {
  return {
    active: false,
    attackingPlayerId: '',
    attackers: [],
    blockers: [],
    combatPhase: 'none',
    hasMyriad: false,
    myriadCopies: [],
  };
}

function isCombatPhase(phase: Phase): boolean {
  return [
    'beginningOfCombat',
    'declareAttackers',
    'declareBlockers',
    'combatDamage',
    'endOfCombat',
  ].includes(phase);
}

export function clearCombatAssignments(state: GameState): GameState {
  let g = state;
  if (g.combat.hasMyriad && g.combat.myriadCopies.length > 0) {
    g = exileMyriadCopies(g);
  }

  const newCards = { ...g.cards };
  let changedCards = false;
  for (const [id, card] of Object.entries(newCards)) {
    if (card.combatRole !== 'none' || card.attackTarget || (card.blockTarget?.length ?? 0) > 0) {
      newCards[id] = { ...card, combatRole: 'none', attackTarget: undefined, blockTarget: [] };
      changedCards = true;
    }
  }

  return {
    ...g,
    cards: changedCards ? newCards : g.cards,
    combat: createEmptyCombat(),
    lastUpdatedAt: Date.now(),
  };
}

// ─── Action Logging ────────────────────────────────────────────────────────────

export function createAction(
  state: GameState,
  playerId: string,
  actionType: ActionType,
  description: string,
  affectedObjects: string[] = [],
  data: Record<string, unknown> = {},
  flags: AssistantFlag[] = []
): ActionRecord {
  return {
    id: uuid(),
    turn: state.turn,
    phase: state.phase,
    playerId,
    actionType,
    timestamp: Date.now(),
    description,
    affectedObjects,
    data,
    flags,
    undone: false,
  };
}

// ─── Card Operations ──────────────────────────────────────────────────────────

export function getCard(state: GameState, instanceId: string): CardState | undefined {
  return state.cards[instanceId];
}

export function getPlayerCards(state: GameState, playerId: string, zone: CardState['zone']): CardState[] {
  return Object.values(state.cards).filter(
    c => c.controllerId === playerId && c.zone === zone
  );
}

export function getBattlefieldCards(state: GameState): CardState[] {
  return Object.values(state.cards).filter(c => c.zone === 'battlefield');
}

export function moveCard(
  state: GameState,
  instanceId: string,
  toZone: CardState['zone'],
  toControllerId?: string,
  options?: { exileReason?: string; exiledBy?: string; exileReturn?: string; exilePermanent?: boolean }
): GameState {
  const card = state.cards[instanceId];
  if (!card) return state;

  const fromZone = card.zone;
  const newCard: CardState = {
    ...card,
    zone: toZone,
    controllerId: toControllerId || card.controllerId,
    tapped: toZone === 'battlefield' ? false : card.tapped,
    summoningSick: toZone === 'battlefield' &&
      (getEffectiveCardDefinition(card).cardTypes.includes('Creature')) ? true : false,
  };

  if (options) {
    if (options.exileReason) newCard.exileReason = options.exileReason;
    if (options.exiledBy) newCard.exiledBy = options.exiledBy;
    if (options.exileReturn) newCard.exileReturn = options.exileReturn;
    if (options.exilePermanent !== undefined) newCard.exilePermanent = options.exilePermanent;
  }

  // Remove attachments when leaving battlefield
  let detachedParent: CardState | undefined;
  if (fromZone === 'battlefield' && toZone !== 'battlefield') {
    newCard.attachments = [];
    newCard.attachedTo = undefined;
    // Detach from parent
    if (card.attachedTo && state.cards[card.attachedTo]) {
      detachedParent = {
        ...state.cards[card.attachedTo],
        attachments: state.cards[card.attachedTo].attachments.filter(id => id !== instanceId),
      };
    }
  }

  // Update zone arrays on players
  const newPlayers = state.players.map(p => {
    let updated = { ...p };

    // Remove from old zone
    const removeFrom = (arr: string[]) => arr.filter(id => id !== instanceId);
    if (card.controllerId === p.id) {
      updated = {
        ...updated,
        hand: removeFrom(updated.hand),
        library: removeFrom(updated.library),
        graveyard: removeFrom(updated.graveyard),
        exile: removeFrom(updated.exile),
        battlefield: removeFrom(updated.battlefield),
        commandZone: removeFrom(updated.commandZone),
        sideboard: removeFrom(updated.sideboard),
        maybeboard: removeFrom(updated.maybeboard),
      };
    }

    // Add to new zone
    const newOwner = toControllerId || card.controllerId;
    if (p.id === newOwner) {
      const addTo = (arr: string[]) => [...arr, instanceId];
      switch (toZone) {
        case 'hand': updated.hand = addTo(updated.hand); break;
        case 'library': updated.library = addTo(updated.library); break;
        case 'graveyard': updated.graveyard = addTo(updated.graveyard); break;
        case 'exile': updated.exile = addTo(updated.exile); break;
        case 'battlefield': updated.battlefield = addTo(updated.battlefield); break;
        case 'command': updated.commandZone = addTo(updated.commandZone); break;
        case 'sideboard': updated.sideboard = addTo(updated.sideboard); break;
        case 'maybeboard': updated.maybeboard = addTo(updated.maybeboard); break;
      }
    }

    return updated;
  });

  let nextCards = { ...state.cards, [instanceId]: newCard };
  if (detachedParent) {
    nextCards = { ...nextCards, [detachedParent.instanceId]: detachedParent };
  }

  let nextCombat = state.combat;
  if (fromZone === 'battlefield' && toZone !== 'battlefield') {
    const removedAsAttacker = state.combat.attackers.some(a => a.instanceId === instanceId);
    const removedAsBlocker = state.combat.blockers.some(b => b.instanceId === instanceId);
    const blockersOnRemovedAttacker = removedAsAttacker
      ? state.combat.blockers.filter(b => b.blockedAttacker === instanceId).map(b => b.instanceId)
      : [];

    nextCards = {
      ...nextCards,
      [instanceId]: {
        ...nextCards[instanceId],
        combatRole: 'none',
        attackTarget: undefined,
        blockTarget: [],
      },
    };

    if (blockersOnRemovedAttacker.length > 0) {
      for (const blockerId of blockersOnRemovedAttacker) {
        const blocker = nextCards[blockerId];
        if (!blocker) continue;
        nextCards = {
          ...nextCards,
          [blockerId]: {
            ...blocker,
            combatRole: 'none',
            blockTarget: [],
          },
        };
      }
    }

    if (removedAsAttacker || removedAsBlocker || blockersOnRemovedAttacker.length > 0) {
      nextCombat = {
        ...state.combat,
        attackers: state.combat.attackers.filter(a => a.instanceId !== instanceId),
        blockers: state.combat.blockers.filter(b => b.instanceId !== instanceId && b.blockedAttacker !== instanceId),
      };
    }
  }

  return {
    ...state,
    cards: nextCards,
    players: newPlayers,
    combat: nextCombat,
    lastUpdatedAt: Date.now(),
  };
}

export function tapCard(state: GameState, instanceId: string, tapped: boolean): GameState {
  const card = state.cards[instanceId];
  if (!card) return state;
  return {
    ...state,
    cards: { ...state.cards, [instanceId]: { ...card, tapped } },
    lastUpdatedAt: Date.now(),
  };
}

export function addCounter(state: GameState, instanceId: string, counterType: string, amount = 1): GameState {
  const card = state.cards[instanceId];
  if (!card) return state;
  const existing = card.counters.find(c => c.type === counterType);
  let newCounters: Counter[];
  if (existing) {
    newCounters = card.counters.map(c =>
      c.type === counterType ? { ...c, count: c.count + amount } : c
    );
  } else {
    newCounters = [...card.counters, { type: counterType, count: amount }];
  }
  return {
    ...state,
    cards: { ...state.cards, [instanceId]: { ...card, counters: newCounters } },
    lastUpdatedAt: Date.now(),
  };
}

export function removeCounter(state: GameState, instanceId: string, counterType: string, amount = 1): GameState {
  const card = state.cards[instanceId];
  if (!card) return state;
  const newCounters = card.counters
    .map(c => c.type === counterType ? { ...c, count: Math.max(0, c.count - amount) } : c)
    .filter(c => c.count > 0);
  return {
    ...state,
    cards: { ...state.cards, [instanceId]: { ...card, counters: newCounters } },
    lastUpdatedAt: Date.now(),
  };
}

export function modifyLife(state: GameState, playerId: string, delta: number): GameState {
  return {
    ...state,
    players: state.players.map(p =>
      p.id === playerId ? { ...p, life: p.life + delta } : p
    ),
    lastUpdatedAt: Date.now(),
  };
}

export function addCommanderDamage(
  state: GameState,
  receivingPlayerId: string,
  commanderInstanceId: string,
  damage: number
): GameState {
  return {
    ...state,
    players: state.players.map(p => {
      if (p.id !== receivingPlayerId) return p;
      return {
        ...p,
        life: p.life - damage,
        commanderDamage: {
          ...p.commanderDamage,
          [commanderInstanceId]: (p.commanderDamage[commanderInstanceId] || 0) + damage,
        },
      };
    }),
    lastUpdatedAt: Date.now(),
  };
}

// ─── Phase Management ─────────────────────────────────────────────────────────

export function nextPhase(state: GameState): GameState {
  const currentIdx = PHASE_ORDER.indexOf(state.phase);
  if (currentIdx < PHASE_ORDER.length - 1) {
    const nextPh = PHASE_ORDER[currentIdx + 1];
    const nextState = {
      ...state,
      phase: nextPh,
      priorityPlayerId: state.activePlayerId,
      lastUpdatedAt: Date.now(),
    };
    return isCombatPhase(state.phase) && !isCombatPhase(nextPh)
      ? clearCombatAssignments(nextState)
      : nextState;
  }
  // End of turn — advance to next player
  return nextTurn(state);
}

export function setPhase(state: GameState, phase: Phase): GameState {
  const nextState = {
    ...state,
    phase,
    priorityPlayerId: state.activePlayerId,
    lastUpdatedAt: Date.now(),
  };
  return isCombatPhase(state.phase) && !isCombatPhase(phase)
    ? clearCombatAssignments(nextState)
    : nextState;
}

export function nextTurn(state: GameState): GameState {
  const baseState = clearCombatAssignments(state);
  const playerCount = state.players.length;
  const currentActiveIdx = state.players.findIndex(p => p.id === state.activePlayerId);
  const nextActiveIdx = (currentActiveIdx + 1) % playerCount;
  const nextPlayer = state.players[nextActiveIdx];

  // Untap all permanents for new active player
  const newCards = { ...baseState.cards };
  for (const [id, card] of Object.entries(newCards)) {
    if (card.controllerId === nextPlayer.id && card.zone === 'battlefield') {
      newCards[id] = { ...card, tapped: false, summoningSick: false };
    }
  }

  const newPlayers = state.players.map(p => ({
    ...p,
    isActive: p.id === nextPlayer.id,
    hasPriority: p.id === nextPlayer.id,
  }));

  return {
    ...baseState,
    players: newPlayers,
    cards: newCards,
    turn: state.turn + 1,
    activePlayerId: nextPlayer.id,
    priorityPlayerId: nextPlayer.id,
    phase: 'untap',
    combat: createEmptyCombat(),
    lastUpdatedAt: Date.now(),
  };
}

// ─── Stack Operations ─────────────────────────────────────────────────────────

export function pushToStack(state: GameState, item: StackObject): GameState {
  return {
    ...state,
    stack: [item, ...state.stack],
    lastUpdatedAt: Date.now(),
  };
}

function isPermanentSpell(card: CardState): boolean {
  return getEffectiveCardDefinition(card).cardTypes.some(type =>
    ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle'].includes(type)
  );
}

export function resolveTopStack(state: GameState): GameState {
  if (state.stack.length === 0) return state;
  const [resolved, ...remaining] = state.stack;
  let next: GameState = {
    ...state,
    stack: remaining,
    lastUpdatedAt: Date.now(),
  };

  if (resolved.sourceInstanceId) {
    const card = next.cards[resolved.sourceInstanceId];
    if (card?.zone === 'stack') {
      next = moveCard(
        next,
        resolved.sourceInstanceId,
        isPermanentSpell(card) ? 'battlefield' : 'graveyard',
        resolved.controllerId,
      );
      next = { ...next, stack: remaining, lastUpdatedAt: Date.now() };
    }
  }

  return next;
}

// ─── Trigger Queue ────────────────────────────────────────────────────────────

export function addTrigger(state: GameState, trigger: TriggerItem): GameState {
  return {
    ...state,
    triggerQueue: [...state.triggerQueue, trigger],
    lastUpdatedAt: Date.now(),
  };
}

export function acknowledgeTrigger(state: GameState, triggerId: string): GameState {
  return {
    ...state,
    triggerQueue: state.triggerQueue.map(t =>
      t.id === triggerId ? { ...t, acknowledged: true } : t
    ),
    lastUpdatedAt: Date.now(),
  };
}

// ─── Deck Loading ─────────────────────────────────────────────────────────────

export async function loadDeckIntoPlayer(
  state: GameState,
  playerId: string,
  deck: Deck
): Promise<GameState> {
  const normalizedDeck = normalizeCommanderDeck(deck);
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;

  // Fetch all card definitions
  const allNames = normalizedDeck.cards.map(c => c.name);
  const defsMap = await fetchCardsByNames(allNames);
  const customDefs = getCustomCardDefinitionMap(normalizedDeck);

  let newState = { ...state };
  const newCards: Record<string, CardState> = { ...newState.cards };
  const newDefs: Record<string, CardDefinition> = { ...newState.definitions };

  const newPlayer: Player = {
    ...player,
    library: [],
    hand: [],
    commandZone: [],
    sideboard: [],
    maybeboard: [],
    commanders: [],
    deckId: normalizedDeck.id,
  };

  // Create card instances
  for (const { name, count } of normalizedDeck.cards) {
    const def = customDefs.get(name.toLowerCase()) ?? defsMap.get(name);
    const isCommander = normalizedDeck.commanders.includes(name);

    for (let i = 0; i < count; i++) {
      const d = applyDeckLogicToDefinition(def || createPlaceholderDef(name), normalizedDeck);
      newDefs[d.id] = d;

      if (isCommander && i === 0) {
        const cs = applyDeckLogicToCard(createCardState(d, playerId, 'command', true), d);
        newCards[cs.instanceId] = cs;
        newPlayer.commandZone.push(cs.instanceId);
        newPlayer.commanders.push(cs.instanceId);
      } else {
        const cs = applyDeckLogicToCard(createCardState(d, playerId, 'library'), d);
        newCards[cs.instanceId] = cs;
        newPlayer.library.push(cs.instanceId);
      }
    }
  }

  // Sideboard
  for (const { name, count } of normalizedDeck.sideboard) {
    const def = applyDeckLogicToDefinition(customDefs.get(name.toLowerCase()) ?? defsMap.get(name) ?? createPlaceholderDef(name), normalizedDeck);
    newDefs[def.id] = def;
    for (let i = 0; i < count; i++) {
      const cs = applyDeckLogicToCard(createCardState(def, playerId, 'sideboard'), def);
      newCards[cs.instanceId] = cs;
      newPlayer.sideboard.push(cs.instanceId);
    }
  }

  // Shuffle library
  newPlayer.library = shuffle(newPlayer.library);

  const newPlayers = newState.players.map(p => p.id === playerId ? newPlayer : p);

  return {
    ...newState,
    players: newPlayers,
    cards: newCards,
    definitions: newDefs,
    lastUpdatedAt: Date.now(),
  };
}

function createPlaceholderDef(name: string): CardDefinition {
  return {
    id: `placeholder-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    cmc: 0,
    typeLine: 'Unknown',
    superTypes: [],
    cardTypes: [],
    subTypes: [],
    oracleText: '',
    colors: [],
    colorIdentity: [],
    keywords: [],
    isDoubleFaced: false,
    legalities: {},
  };
}

function getCustomCardDefinitionMap(deck: Deck): Map<string, CardDefinition> {
  const customCards = deck.logicFile?.customCards ?? [];
  return new Map(customCards.map(card => [card.name.toLowerCase(), createCustomCardDef(card)]));
}

function createCustomCardDef(card: CustomCardDefinition): CardDefinition {
  const typeLine = card.typeLine || 'Creature';
  const superTypes = ['Legendary', 'Basic', 'Snow', 'World', 'Historic']
    .filter(type => typeLine.includes(type)) as CardDefinition['superTypes'];
  const cardTypes = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle', 'Tribal']
    .filter(type => typeLine.includes(type)) as CardDefinition['cardTypes'];
  const subTypes = typeLine.includes('—')
    ? typeLine.split('—').slice(1).join('—').trim().split(/\s+/).filter(Boolean)
    : [];

  return {
    id: card.id || `custom-${card.name.toLowerCase().replace(/\s+/g, '-')}`,
    name: card.name,
    manaCost: card.manaCost?.raw ? {
      W: card.manaCost.W,
      U: card.manaCost.U,
      B: card.manaCost.B,
      R: card.manaCost.R,
      G: card.manaCost.G,
      C: card.manaCost.C,
      generic: card.manaCost.generic,
      X: card.manaCost.X,
      raw: card.manaCost.raw,
      cmc: card.cmc ?? card.manaCost.cmc ?? 0,
    } : undefined,
    cmc: card.cmc ?? card.manaCost?.cmc ?? 0,
    typeLine,
    superTypes,
    cardTypes,
    subTypes,
    oracleText: card.oracleText || '',
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    colors: card.colors ?? [],
    colorIdentity: card.colorIdentity ?? card.colors ?? [],
    keywords: card.keywords ?? [],
    imageUrl: card.imageUrl,
    imageUrlBack: card.imageUrlBack,
    isDoubleFaced: card.isDoubleFaced === true || (card.faces?.length ?? 0) >= 2,
    faces: card.faces,
    legalities: {},
  };
}

function applyDeckLogicToDefinition(def: CardDefinition, deck: Deck): CardDefinition {
  const logic = deck.logicFile;
  if (!logic) return def;

  const cardName = def.name.toLowerCase();
  const customTriggers = logic.triggers.filter(t => t.sourceCard.toLowerCase() === cardName);
  const replacementEffects = logic.replacementEffects.filter(r => r.sourceCard.toLowerCase() === cardName);
  const customRules = logic.rules.filter(rule => {
    if (!rule.enabled) return false;
    if (!rule.cardFilter) return true;
    const filter = rule.cardFilter.toLowerCase();
    return def.name.toLowerCase().includes(filter) ||
      def.typeLine.toLowerCase().includes(filter) ||
      def.oracleText.toLowerCase().includes(filter);
  });
  const note = getCardNote(logic.cardNotes, def.name);

  if (!customTriggers.length && !replacementEffects.length && !customRules.length && !note) return def;

  return {
    ...def,
    customTriggers: [...(def.customTriggers ?? []), ...customTriggers],
    replacementEffects: [...(def.replacementEffects ?? []), ...replacementEffects],
    customRules: [...(def.customRules ?? []), ...customRules],
    customNotes: note ? [...(def.customNotes ?? []), note] : def.customNotes,
  };
}

function getCardNote(notes: Record<string, string>, cardName: string): string | undefined {
  const exact = notes[cardName];
  if (exact) return exact;
  const cardNameLower = cardName.toLowerCase();
  const matched = Object.entries(notes).find(([name]) => name.toLowerCase() === cardNameLower);
  return matched?.[1];
}

function applyDeckLogicToCard(card: CardState, def: CardDefinition): CardState {
  if (!def.customNotes?.length) return card;
  return {
    ...card,
    notes: [card.notes, ...def.customNotes].filter(Boolean).join('\n'),
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export { shuffle };

// ─── Draw & Mulligan ──────────────────────────────────────────────────────────

export function drawCards(state: GameState, playerId: string, count: number): GameState {
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.library.length === 0) return state;

  const drawn = player.library.slice(0, count);
  const remaining = player.library.slice(count);

  const newCards = { ...state.cards };
  for (const id of drawn) {
    if (newCards[id]) {
      newCards[id] = { ...newCards[id], zone: 'hand' };
    }
  }

  const newPlayers = state.players.map(p => {
    if (p.id !== playerId) return p;
    return {
      ...p,
      library: remaining,
      hand: [...p.hand, ...drawn],
    };
  });

  return { ...state, cards: newCards, players: newPlayers, lastUpdatedAt: Date.now() };
}

export function discardCard(state: GameState, playerId: string, instanceId: string): GameState {
  return moveCard(state, instanceId, 'graveyard');
}

function clampMana(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeManaPool(raw?: Partial<ManaPool>): ManaPool {
  if (!raw) return EMPTY_MANA_POOL;
  return {
    W: clampMana(raw.W ?? 0),
    U: clampMana(raw.U ?? 0),
    B: clampMana(raw.B ?? 0),
    R: clampMana(raw.R ?? 0),
    G: clampMana(raw.G ?? 0),
    C: clampMana(raw.C ?? 0),
    generic: clampMana(raw.generic ?? 0),
  };
}

export function setManaPool(state: GameState, playerId: string, mana: Partial<ManaPool>): GameState {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;
  const normalized = normalizeManaPool(mana);
  return {
    ...state,
    players: state.players.map(p =>
      p.id === playerId
        ? { ...p, manaPool: normalized }
        : p
    ),
    lastUpdatedAt: Date.now(),
  };
}

export function addManaToPool(state: GameState, playerId: string, mana: Partial<ManaPool>): GameState {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;
  const next = normalizeManaPool({
    W: player.manaPool.W + clampMana(mana.W ?? 0),
    U: player.manaPool.U + clampMana(mana.U ?? 0),
    B: player.manaPool.B + clampMana(mana.B ?? 0),
    R: player.manaPool.R + clampMana(mana.R ?? 0),
    G: player.manaPool.G + clampMana(mana.G ?? 0),
    C: player.manaPool.C + clampMana(mana.C ?? 0),
    generic: player.manaPool.generic + clampMana(mana.generic ?? 0),
  });
  return {
    ...state,
    players: state.players.map(p =>
      p.id === playerId
        ? { ...p, manaPool: next }
        : p
    ),
    lastUpdatedAt: Date.now(),
  };
}

export function clearManaPool(state: GameState, playerId: string): GameState {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;
  return setManaPool(state, playerId, EMPTY_MANA_POOL);
}

export function takeMulligan(state: GameState, playerId: string): GameState {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;

  let nextState = state;
  for (const id of [...player.hand]) {
    nextState = moveCard(nextState, id, 'library');
  }
  const shuffled = shuffle(nextState.players.find(p => p.id === playerId)?.library ?? []);
  nextState = {
    ...nextState,
    players: nextState.players.map(p =>
      p.id === playerId
        ? { ...p, library: shuffled, mulliganCount: p.mulliganCount + 1 }
        : p
    ),
  };

  const targetSize = Math.max(0, player.mulliganCount + 1);
  const maxSize = nextState.config.startingHandSize ?? 7;
  const drawCount = Math.max(0, maxSize - targetSize);
  return drawCards(nextState, playerId, drawCount);
}

export function tutorCard(state: GameState, playerId: string, instanceId: string, fromZone: CardState['zone'] = 'library'): GameState {
  const card = state.cards[instanceId];
  if (!card || card.zone !== fromZone) return state;
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;
  if (!player.library.includes(instanceId) && !player.graveyard.includes(instanceId) && !player.exile.includes(instanceId)) return state;
  return moveCard(state, instanceId, 'hand', playerId);
}

export function removeAllCountersFromCard(
  state: GameState,
  instanceId: string,
  counterType?: string,
): GameState {
  const card = state.cards[instanceId];
  if (!card) return state;

  if (!counterType) {
    if (card.counters.length === 0) return state;
    return {
      ...state,
      cards: { ...state.cards, [instanceId]: { ...card, counters: [] } },
      lastUpdatedAt: Date.now(),
    };
  }

  const remainingCounters = card.counters.filter(counter => counter.type !== counterType);
  if (remainingCounters.length === card.counters.length) return state;

  return {
    ...state,
    cards: { ...state.cards, [instanceId]: { ...card, counters: remainingCounters } },
    lastUpdatedAt: Date.now(),
  };
}

// ─── Token Creation ────────────────────────────────────────────────────────────

export function createToken(
  state: GameState,
  controllerId: string,
  tokenDef: Partial<CardDefinition> & { name: string }
): GameState {
  return createTokens(state, controllerId, tokenDef, 1).state;
}

export function createTokens(
  state: GameState,
  controllerId: string,
  tokenDef: Partial<CardDefinition> & { name: string },
  count: number
): { state: GameState; tokenIds: string[]; visualGroup: string } {
  const safeCount = Math.max(0, Math.floor(count));
  const tokenIds: string[] = [];
  const visualGroup = `token-${tokenDef.name.toLowerCase().replace(/\s+/g, '-')}-${uuid()}`;
  if (safeCount === 0) return { state, tokenIds, visualGroup };

  const fullDef: CardDefinition = {
    id: `token-${tokenDef.name.toLowerCase().replace(/\s+/g, '-')}-${uuid()}`,
    cmc: 0,
    typeLine: tokenDef.typeLine || 'Token Creature',
    superTypes: [],
    cardTypes: ['Creature'],
    subTypes: tokenDef.subTypes || [],
    oracleText: tokenDef.oracleText || '',
    colors: tokenDef.colors || [],
    colorIdentity: tokenDef.colorIdentity || [],
    keywords: tokenDef.keywords || [],
    isDoubleFaced: false,
    legalities: {},
    ...tokenDef,
  };

  const newCards = { ...state.cards };
  for (let index = 0; index < safeCount; index++) {
    const cs = createCardState(fullDef, controllerId, 'library');
    const tokenInstance: CardState = {
      ...cs,
      token: true,
      zone: 'battlefield',
      summoningSick: true,
      visualGroup,
      visualX: Math.random() * 80 + 10,
      visualY: Math.random() * 70 + 10,
    };
    tokenIds.push(tokenInstance.instanceId);
    newCards[tokenInstance.instanceId] = tokenInstance;
  }

  const newPlayers = state.players.map(p =>
    p.id === controllerId
      ? { ...p, battlefield: [...p.battlefield, ...tokenIds] }
      : p
  );

  return {
    state: {
      ...state,
      cards: newCards,
      definitions: { ...state.definitions, [fullDef.id]: fullDef },
      players: newPlayers,
      lastUpdatedAt: Date.now(),
    },
    tokenIds,
    visualGroup,
  };
}

// ─── State-Based Actions ──────────────────────────────────────────────────────

export function checkStateBasedActions(state: GameState): { newState: GameState; flags: AssistantFlag[] } {
  let newState = { ...state };
  const flags: AssistantFlag[] = [];

  // Check creature death (toughness ≤ 0 or damage ≥ toughness)
  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield') continue;
    const def = getEffectiveCardDefinition(card);
    if (!def.cardTypes.includes('Creature')) continue;

    const basePower = parseInt(def.power || '0', 10) || 0;
    const baseToughness = parseInt(def.toughness || '0', 10) || 0;

    const plusCounters = card.counters.find(c => c.type === '+1/+1')?.count || 0;
    const minusCounters = card.counters.find(c => c.type === '-1/-1')?.count || 0;
    const effectiveToughness = baseToughness + plusCounters - minusCounters;

    if (effectiveToughness <= 0 || card.markedForDamage >= effectiveToughness) {
      newState = moveCard(newState, card.instanceId, 'graveyard');
      flags.push({
        id: uuid(),
        severity: 'info',
        label: 'State-Based',
        text: `${card.definition.name} died (toughness: ${effectiveToughness}, damage: ${card.markedForDamage})`,
        cardRef: card.instanceId,
      });
    }
  }

  // Check player death
  for (const player of state.players) {
    if (player.life <= 0) {
      flags.push({
        id: uuid(),
        severity: 'warning',
        label: 'State-Based',
        text: `${player.name} has 0 or less life and should lose the game.`,
      });
    }
    if (player.poisonCounters >= 10) {
      flags.push({
        id: uuid(),
        severity: 'warning',
        label: 'State-Based',
        text: `${player.name} has 10 or more poison counters and should lose the game.`,
      });
    }
    // Commander damage
    for (const [cmdId, dmg] of Object.entries(player.commanderDamage)) {
      if (dmg >= 21) {
        const cmdCard = state.cards[cmdId];
        flags.push({
          id: uuid(),
          severity: 'warning',
          label: 'State-Based',
          text: `${player.name} has received 21+ commander damage from ${cmdCard?.definition.name || 'a commander'}.`,
        });
      }
    }
  }

  return { newState, flags };
}

// ─── Combat Operations ────────────────────────────────────────────────────────

export function declareAttacker(
  state: GameState,
  attackerInstanceId: string,
  targetPlayerId: string
): GameState {
  const card = state.cards[attackerInstanceId];
  if (!card || card.zone !== 'battlefield') return state;

  const newCombat: CombatState = {
    ...state.combat,
    active: true,
    attackingPlayerId: state.activePlayerId,
    attackers: [
      ...state.combat.attackers,
      { instanceId: attackerInstanceId, targetPlayerId, targets: [] },
    ],
  };

  // CR 702.20: Vigilance — attacking doesn't cause creature to tap
  const def = getEffectiveCardDefinition(card);
  const hasVigilance =
    def.keywords.some(k => k.toLowerCase() === 'vigilance') ||
    getEffectiveOracleText(card).toLowerCase().includes('vigilance');

  return {
    ...state,
    combat: newCombat,
    cards: {
      ...state.cards,
      [attackerInstanceId]: {
        ...card,
        tapped: hasVigilance ? card.tapped : true,
        combatRole: 'attacker',
        attackTarget: targetPlayerId,
      },
    },
    lastUpdatedAt: Date.now(),
  };
}

export function declareBlocker(
  state: GameState,
  blockerInstanceId: string,
  attackerInstanceId: string
): GameState {
  const blocker = state.cards[blockerInstanceId];
  if (!blocker || blocker.zone !== 'battlefield') return state;

  const newCombat: CombatState = {
    ...state.combat,
    blockers: [
      ...state.combat.blockers,
      { instanceId: blockerInstanceId, blockedAttacker: attackerInstanceId },
    ],
  };

  return {
    ...state,
    combat: newCombat,
    cards: {
      ...state.cards,
      [blockerInstanceId]: { ...blocker, combatRole: 'blocker', blockTarget: [attackerInstanceId] },
    },
    lastUpdatedAt: Date.now(),
  };
}

// ─── Snapshot / Undo / Redo ───────────────────────────────────────────────────

export function takeSnapshot(state: GameState, label: string): GameState {
  const snapshotId = uuid();
  const compressed = JSON.stringify(state);
  return {
    ...state,
    snapshots: { ...state.snapshots, [snapshotId]: compressed },
    actionLog: [
      ...state.actionLog,
      createAction(state, state.activePlayerId, 'SNAPSHOT', `Snapshot: ${label}`, [], { snapshotId }),
    ],
  };
}

export function undoAction(state: GameState): GameState {
  // Find last undoable action
  for (let i = state.actionLog.length - 1; i >= 0; i--) {
    const action = state.actionLog[i];
    if (!action.undone && action.snapshotBefore) {
      try {
        const restored: GameState = JSON.parse(action.snapshotBefore);
        return {
          ...restored,
          actionLog: state.actionLog.map((a, idx) =>
            idx === i ? { ...a, undone: true } : a
          ),
        };
      } catch {
        break;
      }
    }
  }
  return state; // Nothing to undo
}

// ─── Myriad ───────────────────────────────────────────────────────────────────

/**
 * CR 702.116 — Myriad
 *
 * When a Myriad creature attacks, for each OTHER opponent (not the declared
 * defender) create a token copy of that creature attacking that opponent.
 * The copies are exiled at end of combat.
 *
 * copyCount lets the controlling player declare how many copies to create per
 * opponent (default 1; >1 models multiple Myriad triggers stacked via effects
 * like Strionic Resonator, or simply a large-copy-stack sandbox).
 *
 * Returns the updated state AND a list of all created myriad copy instanceIds
 * grouped by target player.
 */
export function triggerMyriad(
  state: GameState,
  attackerInstanceId: string,
  /** Player who is being DIRECTLY attacked (declared defender). Copies attack everyone else. */
  declaredDefenderId: string,
  /** How many copies to create per opponent (default 1). */
  copiesPerOpponent: number = 1,
): {
  newState: GameState;
  copies: { copyInstanceId: string; targetPlayerId: string }[];
} {
  const attackerCard = state.cards[attackerInstanceId];
  if (!attackerCard) return { newState: state, copies: [] };

  const attackingPlayerId = attackerCard.controllerId;
  const opponents = state.players.filter(
    p => p.id !== attackingPlayerId && p.id !== declaredDefenderId,
  );

  let g = state;
  const copies: { copyInstanceId: string; targetPlayerId: string }[] = [];

  for (const opponent of opponents) {
    for (let i = 0; i < copiesPerOpponent; i++) {
      // Build token copy definition — mirrors original but flagged as copy
      const origDef = attackerCard.definition;
      const copyDefId = `copy-${origDef.id}-${uuid()}`;
      const copyDef: CardDefinition = {
        ...origDef,
        id: copyDefId,
        name: `${origDef.name} (Myriad copy)`,
      };

      const copyInstanceId = `myriad-${attackerInstanceId}-${opponent.id}-${i}-${uuid()}`;
      const copyCard: CardState = {
        ...attackerCard,
        instanceId: copyInstanceId,
        definitionId: copyDefId,
        definition: copyDef,
        zone: 'battlefield',
        tapped: true,           // Attacking creatures are tapped
        summoningSick: false,   // Tokens entering via Myriad are attacking — no SS check
        combatRole: 'attacker',
        attackTarget: opponent.id,
        markedForDamage: 0,
        token: true,
        copy: true,
      };

      // Place copy on battlefield for attacking player
      g = {
        ...g,
        definitions: { ...g.definitions, [copyDefId]: copyDef },
        cards: { ...g.cards, [copyInstanceId]: copyCard },
        players: g.players.map(p =>
          p.id === attackingPlayerId
            ? { ...p, battlefield: [...p.battlefield, copyInstanceId] }
            : p,
        ),
        combat: {
          ...g.combat,
          hasMyriad: true,
          attackers: [
            ...g.combat.attackers,
            { instanceId: copyInstanceId, targetPlayerId: opponent.id, targets: [] },
          ],
          myriadCopies: [
            ...g.combat.myriadCopies,
            { originalId: attackerInstanceId, copyId: copyInstanceId, targetId: opponent.id },
          ],
        },
      };

      copies.push({ copyInstanceId, targetPlayerId: opponent.id });
    }
  }

  return { newState: g, copies };
}

/**
 * Exile all myriad token copies at end of combat. (CR 702.116d)
 * Removes them from battlefield + cards map + myriadCopies list.
 */
export function exileMyriadCopies(state: GameState): GameState {
  if (!state.combat.hasMyriad || state.combat.myriadCopies.length === 0) return state;

  let g = state;
  const copyIds = new Set(state.combat.myriadCopies.map(m => m.copyId));

  // Remove copies from player battlefields
  g = {
    ...g,
    players: g.players.map(p => ({
      ...p,
      battlefield: p.battlefield.filter(id => !copyIds.has(id)),
    })),
  };

  // Remove copy cards entirely (tokens cease to exist in exile — CR 702.116d)
  const newCards = { ...g.cards };
  for (const id of copyIds) delete newCards[id];

  return { ...g, cards: newCards };
}
