// ─── Core MTG Types ───────────────────────────────────────────────────────────

export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';
export type CardType = 'Creature' | 'Instant' | 'Sorcery' | 'Artifact' | 'Enchantment' | 'Planeswalker' | 'Land' | 'Battle' | 'Tribal';
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
}

export interface Counter {
  type: string; // '+1/+1', '-1/-1', 'loyalty', 'poison', 'stun', 'shield', 'charge', etc.
  count: number;
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
  visualX?: number;         // battlefield position (%)
  visualY?: number;
  visualGroup?: string;     // group key for token clouds
}

export interface StackObject {
  id: string;
  type: 'spell' | 'ability' | 'triggered' | 'activated';
  sourceInstanceId?: string;
  sourceDefinitionId?: string;
  sourceName: string;
  controllerId: string;
  targets?: string[];
  text: string;
  timestamp: number;
  parentId?: string;       // for triggered-in-response chains
}

export interface TriggerItem {
  id: string;
  sourceInstanceId?: string;
  sourceName: string;
  controllerId: string;
  text: string;
  triggerType: 'ETB' | 'attack' | 'upkeep' | 'graveyard' | 'exile' | 'damage' | 'other';
  acknowledged: boolean;
  missed: boolean;
  timestamp: number;
}

export interface Player {
  id: string;
  name: string;
  color: string;           // hex display color (seat color)
  seatIndex: number;       // 0 = local player (bottom)
  life: number;
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
  | 'VOTE' | 'CHOOSE_MODE'
  | 'UNDO' | 'REDO' | 'SNAPSHOT'
  | 'GAME_START' | 'GAME_END' | 'MULLIGAN'
  | 'NOTE' | 'FLAG';

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
  playerCount: 2 | 3 | 4 | 5 | 6;
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
  attackers: { instanceId: string; targetPlayerId: string; targets: string[] }[];
  blockers: { instanceId: string; blockedAttacker: string }[];
  combatPhase: 'none' | 'declareAttackers' | 'declareBlockers' | 'firstStrikeDamage' | 'combatDamage' | 'endOfCombat';
  hasMyriad: boolean;
  myriadCopies: { originalId: string; copyId: string; targetId: string }[];
}

export interface GameState {
  id: string;
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
  snapshots: Record<string, string>;    // id → compressed state
  undoPointer: number;                  // index into actionLog for undo
  createdAt: number;
  lastUpdatedAt: number;
  status: 'lobby' | 'mulligans' | 'playing' | 'ended';
  winnerId?: string;
}
