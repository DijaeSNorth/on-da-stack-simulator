// ─── Core MTG Types ───────────────────────────────────────────────────────────

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type CardType = 'Creature' | 'Instant' | 'Sorcery' | 'Artifact' | 'Enchantment' | 'Planeswalker' | 'Land' | 'Battle' | 'Tribal' | 'Kindred';
export type SuperType = 'Legendary' | 'Basic' | 'Snow' | 'World' | 'Historic';
export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command' | 'stack' | 'sideboard' | 'maybeboard';

export type Phase =
  | 'untap' | 'upkeep' | 'draw'
  | 'main1'
  | 'beginningOfCombat' | 'declareAttackers' | 'declareBlockers' | 'combatDamage' | 'endOfCombat'
  | 'main2'
  | 'endStep' | 'cleanup';

export type Priority = 'active' | 'responding' | 'none';

export interface ManaCost {
  W?: number; U?: number; B?: number; R?: number; G?: number; C?: number;
  generic?: number; X?: boolean;
  raw: string; // '{2}{W}{U}' etc
  cmc: number;
}

export interface CardDefinition {
  id: string; // oracle ID
  name: string;
  manaCost?: ManaCost;
  cmc: number;
  typeLine: string;
  superTypes: SuperType[];
  cardTypes: CardType[];
  subTypes: string[];
  oracleText: string;
  flavorText?: string;
  power?: string;
  toughness?: string;
  loyalty?: number;
  colors: ManaColor[];
  colorIdentity: ManaColor[];
  keywords: string[];
  imageUrl?: string;
  imageUrlBack?: string;
  isDoubleFaced: boolean;
  legalities: Record<string, 'legal' | 'not_legal' | 'banned' | 'restricted'>;
  rulings?: { date: string; text: string }[];
  relatedCards?: string[];
  faces?: CardFaceDefinition[];
  customTriggers?: CustomTrigger[];
  replacementEffects?: ReplacementEffect[];
  customRules?: CustomRule[];
  customNotes?: string[];
}

export interface CardFaceDefinition {
  name: string;
  manaCost?: ManaCost;
  cmc?: number;
  typeLine: string;
  superTypes: SuperType[];
  cardTypes: CardType[];
  subTypes: string[];
  oracleText: string;
  flavorText?: string;
  power?: string;
  toughness?: string;
  loyalty?: number;
  colors: ManaColor[];
  keywords: string[];
  imageUrl?: string;
}

export interface Counter {
  type: string; // '+1/+1', '-1/-1', 'loyalty', 'poison', 'stun', 'shield', 'charge', etc.
  count: number;
}

export interface ManaPool {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
  generic: number;
}

export type PowerToughnessOverrideExpiration = 'manual' | 'endOfTurn' | 'endOfCombat' | 'whileAttached';

export interface PowerToughnessOverride {
  power?: string;
  toughness?: string;
  reason?: string;
  expires: PowerToughnessOverrideExpiration;
  createdAtTurn?: number;
}

export interface CardState {
  instanceId: string;       // unique per-game instance
  definitionId: string;     // links to CardDefinition
  definition: CardDefinition;
  zone: Zone;
  ownerId: string;          // player who owns the card
  controllerId: string;     // player who controls the card
  tapped: boolean;
  faceDown: boolean;
  transformed: boolean;     // DFC
  phased: boolean;
  counters: Counter[];
  attachments: string[];    // instanceIds of attached cards (auras, equipment)
  attachedTo?: string;      // instanceId of what this card is attached to
  markedForDamage: number;
  summoningSick: boolean;
  token: boolean;
  copy: boolean;
  notes: string;            // player notes
  exileReason?: string;     // why exiled
  exiledBy?: string;        // card/effect that exiled it
  exileReturn?: string;     // condition to return
  exilePermanent: boolean;  // true = permanent exile
  castingPlayer?: string;   // who cast if on stack
  targets?: string[];       // targets if on stack
  modeIndex?: number;       // chosen mode
  kicker?: boolean;
  xValue?: number;
  combatRole?: 'attacker' | 'blocker' | 'none';
  attackTarget?: string;    // player or planeswalker being attacked
  blockTarget?: string[];   // what this is blocking
  combatDamageAssigned: number;
  powerToughnessOverride?: PowerToughnessOverride;
  visualX?: number;         // battlefield position (%)
  visualY?: number;
  visualGroup?: string;     // group key for token clouds
  exhaustUsed?: Record<string, boolean>;
  exilePermission?: ExileCastPermission;
  warpedThisTurn?: boolean;
  earthbend?: EarthbendState;
  sneak?: SneakState;
  spacecraft?: SpacecraftState;
  classLevel?: number;
}

export interface ExileCastPermission {
  ownerId: string;
  sourceMechanic: 'airbend' | 'warp' | 'manual';
  alternativeCost?: string;
  timing: 'normal' | 'anytime';
  expires: 'never' | 'endOfTurn' | 'nextEndStep';
  createdAtTurn: number;
  sourceInstanceId?: string;
}

export interface EarthbendState {
  amount: number;
  controllerOfEffect: string;
  basePower: 0;
  baseToughness: 0;
  hasHaste: true;
  returnTappedIfDiesOrExiled: true;
  sourceInstanceId?: string;
}

export interface SneakState {
  cost?: string;
  castWithSneak?: boolean;
  returnedAttackerId?: string;
  attackTarget?: AttackDefenderTarget;
}

export interface SpacecraftState {
  stationThreshold?: number;
  stationed?: boolean;
  chargeCountersAddedByStation?: number;
  stationSourceIds?: string[];
}

export interface StackObject {
  id: string;
  type: 'spell' | 'ability' | 'triggered' | 'activated';
  sourceInstanceId?: string;
  sourceDefinitionId?: string;
  sourceName: string;
  controllerId: string;
  targets?: string[];
  targetLabels?: string[];
  text: string;
  timestamp: number;
  parentId?: string;       // for triggered-in-response chains
}

export type KnownTriggerEffect =
  | {
      kind: 'vialSmasherDamage';
      spellInstanceId: string;
      spellName: string;
      manaValue: number;
      eligibleOpponentIds: string[];
    }
  | {
      kind: 'poisonFromCombatDamage';
      damagedPlayerId: string;
      amount: number;
    }
  | {
      kind: 'createToken';
      controllerId: string;
      count: number;
      token: {
        name: string;
        power?: string;
        toughness?: string;
        colors: ManaColor[];
        cardTypes: CardType[];
        subTypes: string[];
        keywords: string[];
        oracleText?: string;
        typeLine: string;
      };
    };

export interface TriggerItem {
  id: string;
  sourceInstanceId?: string;
  sourceName: string;
  controllerId: string;
  text: string;
  triggerType: 'ETB' | 'attack' | 'cast' | 'upkeep' | 'graveyard' | 'exile' | 'damage' | 'other';
  effect?: KnownTriggerEffect;
  data?: Record<string, unknown>;
  acknowledged: boolean;
  missed: boolean;
  timestamp: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;           // hex display color (seat color)
  avatarInitial?: string;
  avatarStyle?: 'solid' | 'gradient' | 'outline';
  avatarImage?: PlayerAvatarImage;
  seatIndex: number;       // 0 = local player (bottom)
  life: number;
  mulliganCount: number;
  manaPool: ManaPool;
  combatMana?: ManaPool;
  commanderDamage: Record<string, number>; // commanderId -> damage received
  poisonCounters: number;
  energyCounters: number;
  experienceCounters: number;
  commanderCastCount: Record<string, number>; // commanderId -> cast count (tax)
  commanders: string[];    // instanceIds in command zone
  isReady: boolean;
  isActive: boolean;       // is active player this turn
  hasPriority: boolean;
  deckId?: string;
  hand: string[];          // instanceIds
  library: string[];       // instanceIds (ordered)
  graveyard: string[];
  exile: string[];
  sideboard: string[];
  maybeboard: string[];
  commandZone: string[];
  battlefield: string[];
  connected: boolean;
  isSpectator: boolean;
  settings: PlayerSettings;
}

export interface PlayerSettings {
  assistantMode: 'ON' | 'LIMITED' | 'OFF';
  assistantVerbosity: 'minimal' | 'normal' | 'verbose';
  showTriggerReminders: boolean;
  showStackExplanations: boolean;
  coachingLevel: 'none' | 'beginner' | 'intermediate' | 'advanced';
  isJudgeMode: boolean;
}

export type ActionType =
  | 'CAST_SPELL' | 'ACTIVATE_ABILITY' | 'PUT_ON_STACK'
  | 'RESOLVE_STACK' | 'COUNTER_SPELL'
  | 'MOVE_CARD' | 'TAP' | 'UNTAP' | 'ATTACH' | 'DETACH'
  | 'ADD_COUNTER' | 'REMOVE_COUNTER'
  | 'CHANGE_LIFE' | 'COMMANDER_DAMAGE'
  | 'DECLARE_ATTACKER' | 'DECLARE_BLOCKER'
  | 'PASS_PRIORITY' | 'CHANGE_PHASE'
  | 'DRAW_CARD' | 'DISCARD'
  | 'SHUFFLE' | 'SEARCH_LIBRARY'
  | 'FLIP_COIN' | 'ROLL_DICE'
  | 'ADD_TOKEN' | 'REMOVE_TOKEN'
  | 'ADD_MANA' | 'SPEND_MANA' | 'CLEAR_MANA' | 'TUTOR' | 'REMOVE_ALL_COUNTERS'
  | 'VOTE' | 'CHOOSE_MODE'
  | 'UNDO' | 'REDO' | 'SNAPSHOT'
  | 'GAME_START' | 'GAME_END' | 'MULLIGAN'
  | 'NOTE' | 'FLAG'
  | 'SCRY' | 'SURVEIL' | 'CYCLE' | 'DREDGE' | 'PROLIFERATE' | 'CAST' | 'REANIMATE' | 'OTHER';

export interface ActionRecord {
  id: string;
  turn: number;
  phase: Phase;
  playerId: string;
  actionType: ActionType;
  timestamp: number;
  description: string;
  affectedObjects: string[];  // instanceIds
  data: Record<string, unknown>;
  flags: AssistantFlag[];
  undone: boolean;
  snapshotBefore?: string;   // compressed game state ref
}

export type FlagSeverity = 'info' | 'warning' | 'error' | 'legal' | 'flagged' | 'needsReview';

export interface AssistantFlag {
  id: string;
  severity: FlagSeverity;
  label: 'Legal' | 'Flagged' | 'Needs Review' | 'Why Is This Legal' | 'Info' | 'Missed Trigger' | 'State-Based' | 'Tax';
  text: string;
  ruleRef?: string;
  cardRef?: string;
  actionRef?: string;
}

export interface Deck {
  id: string;
  name: string;
  format: 'commander' | 'brawl' | 'oathbreaker';
  commanders: string[];   // card names
  cards: { name: string; count: number }[];
  sideboard: { name: string; count: number }[];
  maybeboard: { name: string; count: number }[];
  colorIdentity: ManaColor[];
  importSource?: string;
  importedAt: number;
  logicFile?: DeckLogic;
}

export interface DeckLogic {
  deckId: string;
  rules: CustomRule[];
  replacementEffects: ReplacementEffect[];
  cardNotes: Record<string, string>;
  triggers: CustomTrigger[];
  customCards: CustomCardDefinition[];
}

export interface PlayerAvatarImage {
  source: 'upload' | 'card';
  url: string;
  label?: string;
  byteSize?: number;
}

export interface CustomCardDefinition {
  id?: string;
  name: string;
  manaCost?: Partial<ManaCost> & { raw?: string };
  cmc?: number;
  typeLine?: string;
  oracleText?: string;
  power?: string;
  toughness?: string;
  loyalty?: number;
  colors?: ManaColor[];
  colorIdentity?: ManaColor[];
  keywords?: string[];
  imageUrl?: string;
  imageUrlBack?: string;
  isDoubleFaced?: boolean;
  faces?: CardFaceDefinition[];
}

export interface CustomRule {
  id: string;
  name: string;
  description: string;
  applies: 'all' | 'controller' | 'opponents' | 'specific';
  specificPlayer?: string;
  cardFilter?: string;    // type, name, or oracle text filter
  effect: string;         // freeform description
  enabled: boolean;
}

export interface ReplacementEffect {
  id: string;
  sourceCard: string;
  replaces: string;       // event description
  replacement: string;    // what happens instead
}

export interface CustomTrigger {
  id: string;
  sourceCard: string;
  event: string;
  effect: string;
  reminderText: string;
}

export interface HouseRule {
  id: string;
  name: string;
  description: string;
  votes: Record<string, boolean>;
  approved: boolean;
  appliesTo: 'all' | string[];
}

export interface GameConfig {
  playerCount: 1 | 2 | 3 | 4 | 5 | 6;
  format: 'commander' | 'brawl' | 'oathbreaker';
  startingLife: number;
  useCommanderDamage: boolean;
  useInfect: boolean;
  startingHandSize: number;
  maxMulligans: number;
  commanderTaxEnabled: boolean;
  houseRules: HouseRule[];
  timerEnabled: boolean;
  timerSeconds?: number;
}

export interface CombatState {
  active: boolean;
  attackingPlayerId: string;
  attackers: { instanceId: string; targetPlayerId: string; targets: string[]; attackTarget?: AttackDefenderTarget }[];
  blockers: { instanceId: string; blockedAttacker: string }[];
  attackAssignments: CombatAttackAssignment[];
  blockAssignments: CombatBlockAssignment[];
  damagePreview?: CombatDamagePreview;
  combatPhase: 'none' | 'declareAttackers' | 'declareBlockers' | 'firstStrikeDamage' | 'combatDamage' | 'endOfCombat';
  hasMyriad: boolean;
  myriadCopies: { originalId: string; copyId: string; targetId: string }[];
}

export type AttackDefenderTarget =
  | { type: 'player'; playerId: string }
  | { type: 'planeswalker'; permanentId: string; controllerId: string }
  | { type: 'battle'; permanentId: string; protectorId: string };

export interface TokenStackAttackInput {
  count: number;
  attackTarget: AttackDefenderTarget;
  attackerIds?: string[];
}

export interface CombatAttackAssignment {
  assignmentId: string;
  controllerId: string;
  attackerIds: string[];
  sourceGroupId?: string;
  sourceName: string;
  count: number;
  isTokenStack: boolean;
  powerDisplay?: string;
  toughnessDisplay?: string;
  totalPowerPreview?: number;
  attackTarget: AttackDefenderTarget;
  tappedOnDeclare: boolean;
  legal: boolean;
  legalityWarnings: string[];
}

export interface CombatBlockAssignment {
  assignmentId: string;
  blockerId: string;
  blockerControllerId: string;
  blockedAttackAssignmentId: string;
  blockedAttackerIds: string[];
  legal: boolean;
  legalityWarnings: string[];
}

export interface CombatDamagePreview {
  previewId: string;
  generatedAt: number;
  attackingPlayerId: string;
  assignments: CombatDamagePreviewAssignment[];
  firstStrikeAssignments: CombatDamagePreviewAssignment[];
  normalDamageAssignments: CombatDamagePreviewAssignment[];
  hasFirstStrikeDamageStep: boolean;
  hasNormalDamageStep: boolean;
  damageToPlayers: Record<string, number>;
  damageToPlaneswalkers: Record<string, number>;
  damageToBattles: Record<string, number>;
  likelyDestroyedCreatures: string[];
  likelyDestroyedAfterFirstStrike: string[];
  firstStrikeLikelyDestroyedCreatures: string[];
  normalLikelyDestroyedCreatures: string[];
  stepNotes: string[];
  warnings: string[];
}

export interface CombatDamagePreviewAssignment {
  attackAssignmentId: string;
  attackerIds: string[];
  blockerIds: string[];
  attackTarget: AttackDefenderTarget;
  attackerName: string;
  count: number;
  powerPerAttacker: number;
  totalPower: number;
  blocked: boolean;
  damageToTarget: number;
  damageToBlockers: Record<string, number>;
  damageToAttackers: Record<string, number>;
  trampleOverflow?: number;
  lethalDamageRequired?: Record<string, number>;
  deathtouchLethal?: boolean;
  manualAssignmentRequired?: boolean;
  combatMathNotes?: string[];
  keywords: string[];
  notes: string[];
  damageStep?: 'firstStrike' | 'normal';
}

export interface GameState {
  id: string;
  rulesetVersion: string;
  config: GameConfig;
  players: Player[];
  cards: Record<string, CardState>;      // instanceId → CardState
  definitions: Record<string, CardDefinition>; // definitionId → CardDefinition
  turn: number;
  activePlayerId: string;
  priorityPlayerId: string;
  phase: Phase;
  stack: StackObject[];
  triggerQueue: TriggerItem[];
  actionLog: ActionRecord[];
  assistantFlags: AssistantFlag[];
  combat: CombatState;
  houseRules: HouseRule[];
  turnTrackers: {
    spellsWarpedThisTurn: string[];
    cardsAirbendedThisTurn: string[];
    waterbendEventsThisTurn: { playerId: string; sourceId?: string; amount: number; permanentIds: string[] }[];
    earthbentThisTurn: { playerId: string; landId: string; amount: number; sourceId?: string }[];
    sneakCastsThisTurn?: { playerId: string; cardId: string; returnedAttackerId: string; attackTarget: AttackDefenderTarget }[];
    stationEventsThisTurn?: { playerId: string; spacecraftId: string; creatureId: string; amount: number; manual: boolean }[];
  };
  snapshots: Record<string, string>;    // id → compressed state
  undoPointer: number;                  // index into actionLog for undo
  createdAt: number;
  lastUpdatedAt: number;
  status: 'lobby' | 'mulligans' | 'playing' | 'ended';
  winnerId?: string;
}

