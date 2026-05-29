// ─── Game State Engine ─────────────────────────────────────────────────────────
import { v4 as uuid } from 'uuid';
import type {
  GameState, Player, CardState, CardDefinition, ActionRecord, ActionType,
  Phase, StackObject, TriggerItem, AssistantFlag, Deck, GameConfig, Counter, CombatState
} from '../types/game';
import { fetchCardsByNames } from '../data/cardDatabase';

// ─── Factory Helpers ──────────────────────────────────────────────────────────

export function createDefaultGameConfig(playerCount: 2 | 3 | 4 | 5 | 6 = 4): GameConfig {
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
  config: GameConfig
): Player {
  return {
    id,
    name,
    color,
    seatIndex,
    life: config.startingLife,
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
    houseRules: [],
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
      (card.definition.cardTypes.includes('Creature')) ? true : false,
  };

  if (options) {
    if (options.exileReason) newCard.exileReason = options.exileReason;
    if (options.exiledBy) newCard.exiledBy = options.exiledBy;
    if (options.exileReturn) newCard.exileReturn = options.exileReturn;
    if (options.exilePermanent !== undefined) newCard.exilePermanent = options.exilePermanent;
  }

  // Remove attachments when leaving battlefield
  if (fromZone === 'battlefield' && toZone !== 'battlefield') {
    newCard.attachments = [];
    newCard.attachedTo = undefined;
    // Detach from parent
    if (card.attachedTo && state.cards[card.attachedTo]) {
      const parent = { ...state.cards[card.attachedTo] };
      parent.attachments = parent.attachments.filter(id => id !== instanceId);
      return {
        ...state,
        cards: { ...state.cards, [instanceId]: newCard, [card.attachedTo]: parent },
        lastUpdatedAt: Date.now(),
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

  return {
    ...state,
    cards: { ...state.cards, [instanceId]: newCard },
    players: newPlayers,
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

const PHASE_ORDER: Phase[] = [
  'untap', 'upkeep', 'draw', 'main1',
  'beginningOfCombat', 'declareAttackers', 'declareBlockers',
  'combatDamage', 'endOfCombat',
  'main2', 'endStep', 'cleanup',
];

export function nextPhase(state: GameState): GameState {
  const currentIdx = PHASE_ORDER.indexOf(state.phase);
  if (currentIdx < PHASE_ORDER.length - 1) {
    const nextPh = PHASE_ORDER[currentIdx + 1];
    return {
      ...state,
      phase: nextPh,
      priorityPlayerId: state.activePlayerId,
      lastUpdatedAt: Date.now(),
    };
  }
  // End of turn — advance to next player
  return nextTurn(state);
}

export function setPhase(state: GameState, phase: Phase): GameState {
  return {
    ...state,
    phase,
    priorityPlayerId: state.activePlayerId,
    lastUpdatedAt: Date.now(),
  };
}

export function nextTurn(state: GameState): GameState {
  const playerCount = state.players.length;
  const currentActiveIdx = state.players.findIndex(p => p.id === state.activePlayerId);
  const nextActiveIdx = (currentActiveIdx + 1) % playerCount;
  const nextPlayer = state.players[nextActiveIdx];

  // Untap all permanents for new active player
  const newCards = { ...state.cards };
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
    ...state,
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

export function resolveTopStack(state: GameState): GameState {
  if (state.stack.length === 0) return state;
  const [_resolved, ...remaining] = state.stack;
  return {
    ...state,
    stack: remaining,
    lastUpdatedAt: Date.now(),
  };
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
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;

  // Fetch all card definitions
  const allNames = deck.cards.map(c => c.name);
  const defsMap = await fetchCardsByNames(allNames);

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
    deckId: deck.id,
  };

  // Create card instances
  for (const { name, count } of deck.cards) {
    const def = defsMap.get(name);
    const isCommander = deck.commanders.includes(name);

    for (let i = 0; i < count; i++) {
      const d = def || createPlaceholderDef(name);
      newDefs[d.id] = d;

      if (isCommander && i === 0) {
        const cs = createCardState(d, playerId, 'command', true);
        newCards[cs.instanceId] = cs;
        newPlayer.commandZone.push(cs.instanceId);
        newPlayer.commanders.push(cs.instanceId);
      } else {
        const cs = createCardState(d, playerId, 'library');
        newCards[cs.instanceId] = cs;
        newPlayer.library.push(cs.instanceId);
      }
    }
  }

  // Sideboard
  for (const { name, count } of deck.sideboard) {
    const def = defsMap.get(name) || createPlaceholderDef(name);
    newDefs[def.id] = def;
    for (let i = 0; i < count; i++) {
      const cs = createCardState(def, playerId, 'sideboard');
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

// ─── Token Creation ────────────────────────────────────────────────────────────

export function createToken(
  state: GameState,
  controllerId: string,
  tokenDef: Partial<CardDefinition> & { name: string }
): GameState {
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

  const cs = createCardState(fullDef, controllerId, 'battlefield');
  const tokenInstance: CardState = {
    ...cs,
    token: true,
    zone: 'battlefield',
    summoningSick: true,
    visualX: Math.random() * 80 + 10,
    visualY: Math.random() * 70 + 10,
  };

  const newPlayers = state.players.map(p =>
    p.id === controllerId
      ? { ...p, battlefield: [...p.battlefield, tokenInstance.instanceId] }
      : p
  );

  return {
    ...state,
    cards: { ...state.cards, [tokenInstance.instanceId]: tokenInstance },
    definitions: { ...state.definitions, [fullDef.id]: fullDef },
    players: newPlayers,
    lastUpdatedAt: Date.now(),
  };
}

// ─── State-Based Actions ──────────────────────────────────────────────────────

export function checkStateBasedActions(state: GameState): { newState: GameState; flags: AssistantFlag[] } {
  let newState = { ...state };
  const flags: AssistantFlag[] = [];

  // Check creature death (toughness ≤ 0 or damage ≥ toughness)
  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield') continue;
    if (!card.definition.cardTypes.includes('Creature')) continue;

    const basePower = parseInt(card.definition.power || '0', 10) || 0;
    const baseToughness = parseInt(card.definition.toughness || '0', 10) || 0;

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
  const hasVigilance =
    card.definition.keywords.some(k => k.toLowerCase() === 'vigilance') ||
    card.definition.oracleText.toLowerCase().includes('vigilance');

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
