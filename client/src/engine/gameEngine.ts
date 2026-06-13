// â”€â”€â”€ Game State Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { v4 as uuid } from 'uuid';
import type {
  GameState, Player, CardState, CardDefinition, ActionRecord, ActionType,
  Phase, StackObject, TriggerItem, AssistantFlag, Deck, GameConfig, Counter, CombatState, CustomCardDefinition,
  PlayerAvatarImage, ManaPool, AttackDefenderTarget, CombatAttackAssignment, TokenStackAttackInput, CombatDamagePreview,
  CombatDamagePreviewAssignment, PowerToughnessOverrideExpiration, CardType, ManaColor,
} from '../types/game';
import { fetchCardsByNames } from '../data/cardDatabase';
import { getEffectiveCardDefinition, getEffectiveOracleText } from './cardFaces';
import { normalizeCommanderDeck } from './deckImport';
import { PHASE_ORDER } from './phaseMeta';
import { DEFAULT_RULESET_VERSION } from '../rules/defaultRuleset';

// â”€â”€â”€ Factory Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    combatMana: { ...EMPTY_MANA_POOL },
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
    exhaustUsed: {},
    classLevel: isClassDefinition(def) ? 1 : undefined,
  };
}

export function createEmptyGameState(config: GameConfig): GameState {
  return {
    id: uuid(),
    rulesetVersion: DEFAULT_RULESET_VERSION,
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
    turnTrackers: {
      spellsWarpedThisTurn: [],
      cardsAirbendedThisTurn: [],
      waterbendEventsThisTurn: [],
      earthbentThisTurn: [],
      sneakCastsThisTurn: [],
      stationEventsThisTurn: [],
    },
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
    attackAssignments: [],
    blockAssignments: [],
    damagePreview: undefined,
    combatPhase: 'none',
    hasMyriad: false,
    myriadCopies: [],
  };
}

export function toAttackDefenderTarget(targetPlayerId: string): AttackDefenderTarget {
  return { type: 'player', playerId: targetPlayerId };
}

export function getTargetPlayerIdFromAttackTarget(target: AttackDefenderTarget): string | undefined {
  return target.type === 'player' ? target.playerId : undefined;
}

function assignmentIdForAttacker(attackerId: string): string {
  return `attack-${attackerId}`;
}

function blockAssignmentIdForBlocker(blockerId: string, attackerId: string): string {
  return `block-${blockerId}-${attackerId}`;
}

function parsePowerPreview(card: CardState | undefined): number | undefined {
  if (!card) return undefined;
  const parsed = Number.parseInt(getEffectiveCardDefinition(card).power ?? '', 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createSingleAttackAssignment(
  state: GameState,
  attackerId: string,
  target: AttackDefenderTarget,
  legal = true,
  legalityWarnings: string[] = [],
): CombatAttackAssignment {
  const card = state.cards[attackerId];
  const def = card ? getEffectiveCardDefinition(card) : undefined;
  return {
    assignmentId: assignmentIdForAttacker(attackerId),
    controllerId: card?.controllerId ?? '',
    attackerIds: [attackerId],
    sourceGroupId: card?.visualGroup,
    sourceName: def?.name ?? card?.definition.name ?? attackerId,
    count: 1,
    isTokenStack: Boolean(card?.token && card.visualGroup),
    powerDisplay: def?.power,
    toughnessDisplay: def?.toughness,
    totalPowerPreview: parsePowerPreview(card),
    attackTarget: target,
    tappedOnDeclare: Boolean(card?.tapped),
    legal,
    legalityWarnings,
  };
}

export function getAssignmentsFromLegacyCombat(state: GameState): CombatAttackAssignment[] {
  return state.combat.attackers.map(attacker =>
    createSingleAttackAssignment(
      state,
      attacker.instanceId,
      attacker.attackTarget ?? toAttackDefenderTarget(attacker.targetPlayerId),
    )
  );
}

export function getLegalAttackTargetsForPlayer(state: GameState, attackingPlayerId: string): AttackDefenderTarget[] {
  const targets: AttackDefenderTarget[] = state.players
    .filter(player => player.id !== attackingPlayerId)
    .map(player => ({ type: 'player', playerId: player.id }));

  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield') continue;
    const def = getEffectiveCardDefinition(card);
    if (card.controllerId === attackingPlayerId) continue;
    if (def.cardTypes.includes('Planeswalker')) {
      targets.push({ type: 'planeswalker', permanentId: card.instanceId, controllerId: card.controllerId });
    }
    if (def.cardTypes.includes('Battle')) {
      targets.push({ type: 'battle', permanentId: card.instanceId, protectorId: card.controllerId });
    }
  }

  return targets;
}

export function getUnblockedAttackAssignments(state: GameState, playerId: string): CombatAttackAssignment[] {
  const attackAssignments = state.combat.attackAssignments ?? [];
  const blockAssignments = state.combat.blockAssignments ?? [];
  const assignments = attackAssignments.length > 0
    ? state.combat.attackAssignments
    : getAssignmentsFromLegacyCombat(state);
  const blocked = new Set(
    blockAssignments.length > 0
      ? blockAssignments.flatMap(block => block.blockedAttackerIds)
      : state.combat.blockers.map(block => block.blockedAttacker)
  );
  return assignments.filter(assignment =>
    assignment.controllerId === playerId &&
    assignment.attackerIds.every(attackerId => !blocked.has(attackerId))
  );
}

const KNOWN_CARD_TYPES: CardType[] = [
  'Artifact',
  'Battle',
  'Creature',
  'Enchantment',
  'Instant',
  'Kindred',
  'Land',
  'Planeswalker',
  'Sorcery',
  'Tribal',
];

const ALL_CREATURE_TYPES = [
  'Advisor', 'Aetherborn', 'Alien', 'Ally', 'Angel', 'Antelope', 'Ape', 'Archer', 'Archon',
  'Army', 'Artificer', 'Assassin', 'Assembly-Worker', 'Astartes', 'Atog', 'Aurochs', 'Avatar',
  'Azra', 'Badger', 'Balloon', 'Barbarian', 'Bard', 'Basilisk', 'Bat', 'Bear', 'Beast',
  'Beaver', 'Beeble', 'Beholder', 'Berserker', 'Bird', 'Blinkmoth', 'Boar', 'Bringer',
  'Brushwagg', 'Camarid', 'Camel', 'Caribou', 'Carrier', 'Cat', 'Centaur', 'Cephalid',
  'Child', 'Chimera', 'Citizen', 'Cleric', 'Clown', 'Cockatrice', 'Construct', 'Coward',
  'Coyote', 'Crab', 'Crocodile', 'Custodes', 'Cyberman', 'Cyclops', 'Dalek', 'Dauthi',
  'Demigod', 'Demon', 'Deserter', 'Detective', 'Devil', 'Dinosaur', 'Djinn', 'Doctor',
  'Dog', 'Dragon', 'Drake', 'Dreadnought', 'Drone', 'Druid', 'Dryad', 'Dwarf', 'Efreet',
  'Egg', 'Elder', 'Eldrazi', 'Elemental', 'Elephant', 'Elf', 'Elk', 'Employee', 'Eye',
  'Faerie', 'Ferret', 'Fish', 'Flagbearer', 'Fox', 'Fractal', 'Frog', 'Fungus', 'Gamer',
  'Gargoyle', 'Germ', 'Giant', 'Gith', 'Gnoll', 'Gnome', 'Goat', 'Goblin', 'God', 'Golem',
  'Gorgon', 'Graveborn', 'Gremlin', 'Griffin', 'Guest', 'Hag', 'Halfling', 'Hamster',
  'Harpy', 'Hellion', 'Hippo', 'Hippogriff', 'Homarid', 'Homunculus', 'Horror', 'Horse',
  'Human', 'Hydra', 'Hyena', 'Illusion', 'Imp', 'Incarnation', 'Inkling', 'Inquisitor',
  'Insect', 'Jackal', 'Jellyfish', 'Juggernaut', 'Kavu', 'Kirin', 'Kithkin', 'Knight',
  'Kobold', 'Kor', 'Kraken', 'Lamia', 'Lammasu', 'Leech', 'Leviathan', 'Lhurgoyf',
  'Licid', 'Lizard', 'Manticore', 'Masticore', 'Mercenary', 'Merfolk', 'Metathran',
  'Minion', 'Minotaur', 'Mite', 'Mole', 'Monger', 'Mongoose', 'Monk', 'Monkey', 'Moonfolk',
  'Mouse', 'Mutant', 'Myr', 'Mystic', 'Nautilus', 'Necron', 'Nephilim', 'Nightmare',
  'Nightstalker', 'Ninja', 'Noble', 'Noggle', 'Nomad', 'Nymph', 'Octopus', 'Ogre', 'Ooze',
  'Orb', 'Orc', 'Orgg', 'Otter', 'Ouphe', 'Ox', 'Oyster', 'Pangolin', 'Peasant', 'Pegasus',
  'Pentavite', 'Performer', 'Pest', 'Phelddagrif', 'Phoenix', 'Phyrexian', 'Pilot',
  'Pincher', 'Pirate', 'Plant', 'Porcupine', 'Possum', 'Praetor', 'Primarch', 'Prism',
  'Processor', 'Rabbit', 'Raccoon', 'Ranger', 'Rat', 'Rebel', 'Reflection', 'Rhino',
  'Rigger', 'Robot', 'Rogue', 'Sable', 'Salamander', 'Samurai', 'Sand', 'Saproling',
  'Satyr', 'Scarecrow', 'Scientist', 'Scion', 'Scorpion', 'Scout', 'Sculpture', 'Serf',
  'Serpent', 'Servo', 'Shade', 'Shaman', 'Shapeshifter', 'Shark', 'Sheep', 'Siren',
  'Skeleton', 'Slith', 'Sliver', 'Slug', 'Snail', 'Snake', 'Soldier', 'Soltari', 'Spawn',
  'Specter', 'Spellshaper', 'Sphinx', 'Spider', 'Spike', 'Spirit', 'Splinter', 'Sponge',
  'Squid', 'Squirrel', 'Starfish', 'Surrakar', 'Survivor', 'Synth', 'Tentacle', 'Tetravite',
  'Thalakos', 'Thopter', 'Thrull', 'Tiefling', 'Toy', 'Treefolk', 'Trilobite', 'Triskelavite',
  'Troll', 'Turtle', 'Tyranid', 'Unicorn', 'Vampire', 'Vedalken', 'Viashino', 'Volver',
  'Wall', 'Walrus', 'Warlock', 'Warrior', 'Weasel', 'Weird', 'Werewolf', 'Whale', 'Wizard',
  'Wolf', 'Wolverine', 'Wombat', 'Worm', 'Wraith', 'Wurm', 'Yeti', 'Zombie', 'Zubera',
];

function normalizeTypeName(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeTypeName(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function parseTypeLineParts(typeLine: string | undefined): { cardTypes: string[]; subTypes: string[] } {
  if (!typeLine) return { cardTypes: [], subTypes: [] };
  const [left = '', right = ''] = typeLine.split(/\s+(?:-|—|–|â€”|â€“|â€”-|â€“- )\s+/, 2);
  const superTypes = new Set(['legendary', 'basic', 'snow', 'world', 'historic']);
  return {
    cardTypes: left.split(/\s+/).filter(Boolean).filter(type => !superTypes.has(normalizeTypeName(type))),
    subTypes: right.split(/\s+/).filter(Boolean),
  };
}

export function getTypeLine(card: CardState | undefined): string {
  return card ? getEffectiveCardDefinition(card).typeLine ?? '' : '';
}

export function getCardTypes(card: CardState | undefined): string[] {
  if (!card) return [];
  const def = getEffectiveCardDefinition(card);
  return uniqueCaseInsensitive([...def.cardTypes, ...parseTypeLineParts(def.typeLine).cardTypes]);
}

export function getSubtypes(card: CardState | undefined): string[] {
  if (!card) return [];
  const def = getEffectiveCardDefinition(card);
  return uniqueCaseInsensitive([...def.subTypes, ...parseTypeLineParts(def.typeLine).subTypes]);
}

export function hasCardType(card: CardState | undefined, cardType: CardType | string): boolean {
  if (!card) return false;
  const target = normalizeTypeName(cardType);
  return getCardTypes(card).some(type => normalizeTypeName(type) === target);
}

export function hasSubtype(card: CardState | undefined, subtype: string): boolean {
  if (!card) return false;
  const target = normalizeTypeName(subtype);
  return getSubtypes(card).some(type => normalizeTypeName(type) === target);
}

export function isCreature(card: CardState | undefined): boolean {
  return hasCardType(card, 'Creature');
}

export function isArtifact(card: CardState | undefined): boolean {
  return hasCardType(card, 'Artifact');
}

export function isEnchantment(card: CardState | undefined): boolean {
  return hasCardType(card, 'Enchantment');
}

export function isLand(card: CardState | undefined): boolean {
  return hasCardType(card, 'Land');
}

export function isPlaneswalker(card: CardState | undefined): boolean {
  return hasCardType(card, 'Planeswalker');
}

export function isBattle(card: CardState | undefined): boolean {
  return hasCardType(card, 'Battle');
}

export function isKindred(card: CardState | undefined): boolean {
  return hasCardType(card, 'Kindred') || hasCardType(card, 'Tribal');
}

export function isToken(card: CardState | undefined): boolean {
  return Boolean(card?.token || /\btoken\b/i.test(getTypeLine(card)));
}

export function getCreatureTypes(card: CardState | undefined): string[] {
  if (!card) return [];
  const subTypes = getSubtypes(card);
  if (!isCreature(card) && !isKindred(card)) return [];
  const known = new Set(ALL_CREATURE_TYPES.map(normalizeTypeName));
  return subTypes.filter(subtype => known.has(normalizeTypeName(subtype)));
}

export function getKindredSubtypes(card: CardState | undefined): string[] {
  return isKindred(card) ? getCreatureTypes(card) : [];
}

export function isChangeling(card: CardState | undefined): boolean {
  if (!card) return false;
  const def = getEffectiveCardDefinition(card);
  return def.keywords.some(keyword => normalizeTypeName(keyword) === 'changeling') ||
    /\bchangeling\b/i.test(getEffectiveOracleText(card));
}

export function getEffectiveCreatureTypes(card: CardState | undefined): string[] {
  if (!card) return [];
  return isChangeling(card) ? [...ALL_CREATURE_TYPES] : getCreatureTypes(card);
}

export function hasCreatureType(card: CardState | undefined, type: string): boolean {
  if (!card) return false;
  if (isChangeling(card)) return true;
  const target = normalizeTypeName(type);
  return getCreatureTypes(card).some(creatureType => normalizeTypeName(creatureType) === target);
}

export function sharesCreatureType(cardA: CardState | undefined, cardB: CardState | undefined): boolean {
  if (!cardA || !cardB) return false;
  if (isChangeling(cardA) && getCreatureTypes(cardB).length > 0) return true;
  if (isChangeling(cardB) && getCreatureTypes(cardA).length > 0) return true;
  const aTypes = new Set(getCreatureTypes(cardA).map(normalizeTypeName));
  return getCreatureTypes(cardB).some(type => aTypes.has(normalizeTypeName(type)));
}

export function isSpacecraft(card: CardState | undefined): boolean {
  if (!card) return false;
  return hasSubtype(card, 'Spacecraft') ||
    hasCardType(card, 'Spacecraft') ||
    /\bspacecraft\b/i.test(getEffectiveOracleText(card));
}

export function isVehicle(card: CardState | undefined): boolean {
  return hasSubtype(card, 'Vehicle') || hasCardType(card, 'Vehicle');
}

export function hasPrintedPowerToughness(card: CardState | undefined): boolean {
  if (!card) return false;
  const def = getEffectiveCardDefinition(card);
  return def.power !== undefined && def.toughness !== undefined;
}

export function isLegendary(card: CardState | undefined): boolean {
  if (!card) return false;
  const def = getEffectiveCardDefinition(card);
  return def.superTypes.some(superType => normalizeTypeName(superType) === 'legendary') ||
    /\blegendary\b/i.test(def.typeLine);
}

export function canBeCommander(card: CardState | undefined): boolean {
  if (!isLegendary(card)) return false;
  if (hasCardType(card, 'Creature')) return true;
  if (hasCardType(card, 'Planeswalker')) return true;
  return hasPrintedPowerToughness(card) && (isVehicle(card) || isSpacecraft(card));
}

function isClassDefinition(def: CardDefinition): boolean {
  const parsed = parseTypeLineParts(def.typeLine);
  return [...def.subTypes, ...parsed.subTypes].some(subtype => normalizeTypeName(subtype) === 'class') ||
    /\bclass\b/i.test(def.typeLine);
}

export function isClassCard(card: CardState | undefined): boolean {
  if (!card) return false;
  const def = getEffectiveCardDefinition(card);
  return isClassDefinition(def) || hasSubtype(card, 'Class');
}

export function getClassLevel(card: CardState | undefined): number | undefined {
  if (!isClassCard(card)) return undefined;
  const level = card?.classLevel;
  return typeof level === 'number' && Number.isFinite(level) && level > 0 ? Math.floor(level) : 1;
}

export function setClassLevel(
  state: GameState,
  playerId: string,
  cardId: string,
  level: number,
  judgeOverride = false,
): { state: GameState; valid: boolean; reason?: string; level?: number } {
  const card = state.cards[cardId];
  const safeLevel = Math.floor(level);
  if (!card) return { state, valid: false, reason: 'missing_class' };
  if (!isClassCard(card)) return { state, valid: false, reason: 'not_class' };
  if (card.zone !== 'battlefield') return { state, valid: false, reason: 'not_on_battlefield' };
  if (!judgeOverride && card.controllerId !== playerId) return { state, valid: false, reason: 'wrong_controller' };
  if (!judgeOverride && !isSorcerySpeedStationWindow(state, playerId)) return { state, valid: false, reason: 'not_sorcery_speed' };
  if (safeLevel < 1) return { state, valid: false, reason: 'invalid_level' };

  const currentLevel = getClassLevel(card) ?? 1;
  if (!judgeOverride && safeLevel !== currentLevel + 1) {
    return { state, valid: false, reason: 'must_level_in_order', level: currentLevel };
  }

  return {
    state: {
      ...state,
      cards: {
        ...state.cards,
        [cardId]: { ...card, classLevel: safeLevel },
      },
      lastUpdatedAt: Date.now(),
    },
    valid: true,
    level: safeLevel,
  };
}

export function levelUpClass(
  state: GameState,
  playerId: string,
  cardId: string,
): { state: GameState; valid: boolean; reason?: string; level?: number } {
  const currentLevel = getClassLevel(state.cards[cardId]) ?? 1;
  return setClassLevel(state, playerId, cardId, currentLevel + 1);
}

export function getEffectivePowerToughness(
  card: CardState | undefined,
  _state?: GameState,
): { power: number; toughness: number } | null {
  if (!card) return null;
  const def = getEffectiveCardDefinition(card);
  const overridePower = card.powerToughnessOverride?.power;
  const overrideToughness = card.powerToughnessOverride?.toughness;
  const rawPower = overridePower ?? (card.earthbend ? card.earthbend.basePower : def.power);
  const rawToughness = overrideToughness ?? (card.earthbend ? card.earthbend.baseToughness : def.toughness);
  const power = typeof rawPower === 'number' ? rawPower : Number.parseInt(String(rawPower ?? ''), 10);
  const toughness = typeof rawToughness === 'number' ? rawToughness : Number.parseInt(String(rawToughness ?? ''), 10);
  if (!Number.isFinite(power) || !Number.isFinite(toughness)) return null;
  const counters = card.counters ?? [];
  const plusCounters = counters.find(counter => counter.type === '+1/+1')?.count ?? 0;
  const minusCounters = counters.find(counter => counter.type === '-1/-1')?.count ?? 0;
  return {
    power: power + plusCounters - minusCounters,
    toughness: toughness + plusCounters - minusCounters,
  };
}

export function setPowerToughnessOverride(
  state: GameState,
  instanceIds: string[],
  power?: string,
  toughness?: string,
  expires: PowerToughnessOverrideExpiration = 'manual',
  reason?: string,
): GameState {
  const ids = [...new Set(instanceIds)].filter(id => Boolean(state.cards[id]));
  if (ids.length === 0) return state;
  const cards = { ...state.cards };
  for (const id of ids) {
    cards[id] = {
      ...cards[id],
      powerToughnessOverride: {
        power: power?.trim() || undefined,
        toughness: toughness?.trim() || undefined,
        reason: reason?.trim() || undefined,
        expires,
        createdAtTurn: state.turn,
      },
    };
  }
  return { ...state, cards, lastUpdatedAt: Date.now() };
}

export function clearPowerToughnessOverride(state: GameState, instanceIds: string[]): GameState {
  const ids = [...new Set(instanceIds)].filter(id => Boolean(state.cards[id]?.powerToughnessOverride));
  if (ids.length === 0) return state;
  const cards = { ...state.cards };
  for (const id of ids) {
    const { powerToughnessOverride: _override, ...rest } = cards[id];
    cards[id] = rest;
  }
  return { ...state, cards, lastUpdatedAt: Date.now() };
}

export function clearExpiredPowerToughnessOverrides(
  state: GameState,
  expires: PowerToughnessOverrideExpiration,
): GameState {
  const ids = Object.values(state.cards)
    .filter(card => card.powerToughnessOverride?.expires === expires)
    .map(card => card.instanceId);
  return clearPowerToughnessOverride(state, ids);
}

function isSpacecraftCard(card: CardState | undefined): boolean {
  return isSpacecraft(card);
}

export function getStationThreshold(card: CardState | undefined): number | undefined {
  if (!card) return undefined;
  const explicit = card.spacecraft?.stationThreshold;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  const text = `${getEffectiveCardDefinition(card).typeLine} ${getEffectiveOracleText(card)}`;
  const match = text.match(/\bstation\s+(\d+)\b/i);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export function getStationEligibleCreatures(state: GameState, playerId: string, spacecraftId: string): CardState[] {
  const spacecraft = state.cards[spacecraftId];
  if (!spacecraft || spacecraft.controllerId !== playerId || spacecraft.zone !== 'battlefield') return [];
  return Object.values(state.cards).filter(card => {
    const def = getEffectiveCardDefinition(card);
    return card.instanceId !== spacecraftId &&
      card.zone === 'battlefield' &&
      card.controllerId === playerId &&
      !card.tapped &&
      def.cardTypes.includes('Creature');
  });
}

function isSorcerySpeedStationWindow(state: GameState, playerId: string): boolean {
  return state.activePlayerId === playerId &&
    state.priorityPlayerId === playerId &&
    (state.phase === 'main1' || state.phase === 'main2') &&
    state.stack.length === 0;
}

export function stationSpacecraft(
  state: GameState,
  playerId: string,
  spacecraftId: string,
  creatureId: string,
): { state: GameState; valid: boolean; reason?: string; countersAdded?: number; threshold?: number; stationed?: boolean } {
  return stationSpacecraftWithAmount(state, playerId, spacecraftId, creatureId);
}

export function stationSpacecraftManual(
  state: GameState,
  playerId: string,
  spacecraftId: string,
  creatureId: string,
  amount: number,
): { state: GameState; valid: boolean; reason?: string; countersAdded?: number; threshold?: number; stationed?: boolean } {
  const safeAmount = Math.floor(amount);
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) return { state, valid: false, reason: 'invalid_amount' };
  return stationSpacecraftWithAmount(state, playerId, spacecraftId, creatureId, safeAmount);
}

function stationSpacecraftWithAmount(
  state: GameState,
  playerId: string,
  spacecraftId: string,
  creatureId: string,
  manualAmount?: number,
): { state: GameState; valid: boolean; reason?: string; countersAdded?: number; threshold?: number; stationed?: boolean } {
  const spacecraft = state.cards[spacecraftId];
  const creature = state.cards[creatureId];
  if (!spacecraft) return { state, valid: false, reason: 'missing_spacecraft' };
  if (!creature) return { state, valid: false, reason: 'missing_creature' };
  if (!isSorcerySpeedStationWindow(state, playerId)) return { state, valid: false, reason: 'not_sorcery_speed' };
  if (spacecraft.zone !== 'battlefield') return { state, valid: false, reason: 'spacecraft_not_on_battlefield' };
  if (spacecraft.controllerId !== playerId) return { state, valid: false, reason: 'wrong_spacecraft_controller' };
  if (!isSpacecraftCard(spacecraft)) return { state, valid: false, reason: 'not_spacecraft' };
  if (creatureId === spacecraftId) return { state, valid: false, reason: 'same_object' };
  if (creature.zone !== 'battlefield') return { state, valid: false, reason: 'creature_not_on_battlefield' };
  if (creature.controllerId !== playerId) return { state, valid: false, reason: 'wrong_creature_controller' };
  if (creature.tapped) return { state, valid: false, reason: 'creature_tapped' };
  if (!getEffectiveCardDefinition(creature).cardTypes.includes('Creature')) return { state, valid: false, reason: 'not_creature' };
  const power = manualAmount ?? getEffectivePowerToughness(creature, state)?.power;
  if (typeof power !== 'number' || power <= 0) return { state, valid: false, reason: 'invalid_power' };

  let next = addCounter({
    ...state,
    cards: {
      ...state.cards,
      [creatureId]: { ...creature, tapped: true },
    },
  }, spacecraftId, 'charge', power);

  const currentSpacecraft = next.cards[spacecraftId];
  const threshold = getStationThreshold(currentSpacecraft);
  const chargeCount = currentSpacecraft.counters.find(counter => counter.type === 'charge')?.count ?? 0;
  const stationed = typeof threshold === 'number' ? chargeCount >= threshold : (currentSpacecraft.spacecraft?.stationed ?? false);
  const def = getEffectiveCardDefinition(currentSpacecraft);
  const shouldAnimate = stationed && def.power !== undefined && def.toughness !== undefined && !def.cardTypes.includes('Creature');
  next = {
    ...next,
    cards: {
      ...next.cards,
      [spacecraftId]: {
        ...currentSpacecraft,
        definition: shouldAnimate
          ? {
              ...currentSpacecraft.definition,
              cardTypes: Array.from(new Set([...currentSpacecraft.definition.cardTypes, 'Creature' as const])),
              typeLine: currentSpacecraft.definition.typeLine.includes('Creature')
                ? currentSpacecraft.definition.typeLine
                : `${currentSpacecraft.definition.typeLine} Creature`,
            }
          : currentSpacecraft.definition,
        spacecraft: {
          ...(currentSpacecraft.spacecraft ?? {}),
          stationThreshold: threshold,
          stationed,
          chargeCountersAddedByStation: (currentSpacecraft.spacecraft?.chargeCountersAddedByStation ?? 0) + power,
          stationSourceIds: [...new Set([...(currentSpacecraft.spacecraft?.stationSourceIds ?? []), creatureId])],
        },
      },
    },
    turnTrackers: {
      ...next.turnTrackers,
      stationEventsThisTurn: [
        ...(next.turnTrackers.stationEventsThisTurn ?? []),
        { playerId, spacecraftId, creatureId, amount: power, manual: manualAmount !== undefined },
      ],
    },
    lastUpdatedAt: Date.now(),
  };

  return { state: next, valid: true, countersAdded: power, threshold, stationed };
}

export function applyBlight(
  state: GameState,
  playerId: string,
  creatureId: string,
  amount: number,
  sourceId?: string,
): { state: GameState; valid: boolean; reason?: string; amount?: number } {
  const card = state.cards[creatureId];
  const safeAmount = Math.max(0, Math.floor(amount));
  if (!card) return { state, valid: false, reason: 'missing_creature' };
  if (card.zone !== 'battlefield') return { state, valid: false, reason: 'not_on_battlefield' };
  if (card.controllerId !== playerId) return { state, valid: false, reason: 'wrong_controller' };
  if (!getEffectiveCardDefinition(card).cardTypes.includes('Creature')) return { state, valid: false, reason: 'not_creature' };
  if (safeAmount <= 0) return { state, valid: false, reason: 'invalid_amount' };
  return {
    state: addCounter(state, creatureId, '-1/-1', safeAmount),
    valid: true,
    amount: safeAmount,
  };
}

export function getVividColorCount(state: GameState, playerId: string): number {
  const colors = new Set<string>();
  for (const card of Object.values(state.cards)) {
    if (card.zone !== 'battlefield' || card.controllerId !== playerId) continue;
    for (const color of getPermanentColors(card)) {
      colors.add(color);
    }
  }
  return colors.size;
}

export function getPermanentColors(card: CardState | undefined): ManaColor[] {
  if (!card || card.zone !== 'battlefield') return [];
  const def = getEffectiveCardDefinition(card);
  if (Array.isArray(def.colors)) return [...def.colors];
  return Array.isArray(def.colorIdentity) ? [...def.colorIdentity] : [];
}

export function hasVividCondition(state: GameState, playerId: string, requiredCount = 1): boolean {
  return getVividColorCount(state, playerId) >= Math.max(0, Math.floor(requiredCount));
}

function addDamage(record: Record<string, number>, id: string, amount: number): void {
  if (amount <= 0) return;
  record[id] = (record[id] ?? 0) + amount;
}

function uniqueKeywordsForCards(cards: CardState[]): string[] {
  const known = new Set<string>();
  for (const card of cards) {
    const text = `${getEffectiveCardDefinition(card).keywords.join(' ')} ${getEffectiveOracleText(card)}`.toLowerCase();
    for (const keyword of ['trample', 'deathtouch', 'first strike', 'double strike', 'protection', 'indestructible', 'prevent']) {
      if (text.includes(keyword)) known.add(keyword);
    }
  }
  return [...known];
}

function unsupportedCombatWarnings(keywords: string[], subject: string): string[] {
  const warnings: string[] = [];
  for (const keyword of keywords) {
    if (keyword === 'first strike' || keyword === 'double strike' || keyword === 'trample' || keyword === 'deathtouch') continue;
    if (keyword === 'prevent') warnings.push(`${subject}: damage prevention is not fully previewed.`);
    else warnings.push(`${subject}: ${keyword} requires manual combat-damage review.`);
  }
  return warnings;
}

export function hasKeyword(card: CardState, keyword: string): boolean {
  const lowerKeyword = keyword.toLowerCase();
  return getEffectiveCardDefinition(card).keywords.some(k => k.toLowerCase() === lowerKeyword) ||
    getEffectiveOracleText(card).toLowerCase().includes(lowerKeyword);
}

function hasCombatPreviewKeyword(card: CardState, keyword: string): boolean {
  return hasKeyword(card, keyword);
}

function dealsCombatDamageInPreviewStep(card: CardState, step: 'firstStrike' | 'normal'): boolean {
  const firstStrike = hasCombatPreviewKeyword(card, 'first strike');
  const doubleStrike = hasCombatPreviewKeyword(card, 'double strike');
  return step === 'firstStrike'
    ? firstStrike || doubleStrike
    : !firstStrike || doubleStrike;
}

export function generateCombatDamagePreview(state: GameState): CombatDamagePreview {
  const assignments = (state.combat.attackAssignments?.length ?? 0) > 0
    ? state.combat.attackAssignments
    : getAssignmentsFromLegacyCombat(state);
  const blockAssignments = state.combat.blockAssignments ?? [];
  const warnings: string[] = [];
  const stepNotes: string[] = [];
  const damageToPlayers: Record<string, number> = {};
  const damageToPlaneswalkers: Record<string, number> = {};
  const damageToBattles: Record<string, number> = {};
  const likelyDestroyed = new Set<string>();
  const likelyDestroyedAfterFirstStrike = new Set<string>();
  const allCombatCards = [
    ...assignments.flatMap(assignment => assignment.attackerIds.map(id => state.cards[id]).filter(Boolean) as CardState[]),
    ...state.combat.blockers.map(block => state.cards[block.instanceId]).filter(Boolean) as CardState[],
    ...(blockAssignments.map(block => state.cards[block.blockerId]).filter(Boolean) as CardState[]),
  ];
  const hasFirstStrikeDamageStep = allCombatCards.some(card =>
    hasCombatPreviewKeyword(card, 'first strike') || hasCombatPreviewKeyword(card, 'double strike')
  );
  const hasNormalDamageStep = true;
  if (hasFirstStrikeDamageStep) {
    stepNotes.push('First strike and double strike creatures deal damage before normal combat damage.');
  }

  const buildStepAssignments = (
    step: 'firstStrike' | 'normal',
    firstStrikeDeadIds: Set<string>,
  ): CombatDamagePreviewAssignment[] => assignments.flatMap(assignment => {
    const attackers = assignment.attackerIds.map(id => state.cards[id]).filter(Boolean) as CardState[];
    const blockersFromAssignments = blockAssignments
      .filter(block =>
        block.blockedAttackAssignmentId === assignment.assignmentId ||
        block.blockedAttackerIds.some(attackerId => assignment.attackerIds.includes(attackerId))
      )
      .map(block => block.blockerId);
    const blockersFromLegacy = state.combat.blockers
      .filter(block => assignment.attackerIds.includes(block.blockedAttacker))
      .map(block => block.instanceId);
    const blockerIds = [...new Set([...blockersFromAssignments, ...blockersFromLegacy])]
      .filter(id => Boolean(state.cards[id]));
    const blockers = blockerIds.map(id => state.cards[id]).filter(Boolean) as CardState[];
    const attackersEligibleThisStep = attackers.filter(card =>
      dealsCombatDamageInPreviewStep(card, step) && !(step === 'normal' && firstStrikeDeadIds.has(card.instanceId))
    );
    const blockersEligibleThisStep = blockers.filter(card =>
      dealsCombatDamageInPreviewStep(card, step) && !(step === 'normal' && firstStrikeDeadIds.has(card.instanceId))
    );
    const firstPT = getEffectivePowerToughness(attackersEligibleThisStep[0] ?? attackers[0], state);
    const powerPerAttacker = firstPT?.power ?? 0;
    const hasUnknownPower = attackers.some(card => getEffectivePowerToughness(card, state) === null);
    const totalPower = hasUnknownPower ? 0 : attackersEligibleThisStep.reduce((sum, card) => sum + (getEffectivePowerToughness(card, state)?.power ?? 0), 0);
    const keywords = uniqueKeywordsForCards([...attackers, ...blockers]);
    const notes: string[] = [];
    const damageToBlockers: Record<string, number> = {};
    const damageToAttackers: Record<string, number> = {};
    const lethalDamageRequired: Record<string, number> = {};
    const blocked = blockerIds.length > 0;
    let damageToTarget = 0;
    let trampleOverflow = 0;
    let deathtouchLethal = false;
    let manualAssignmentRequired = false;
    const attackerHasTrample = attackersEligibleThisStep.some(card => hasCombatPreviewKeyword(card, 'trample'));
    const attackerHasDeathtouch = attackersEligibleThisStep.some(card => hasCombatPreviewKeyword(card, 'deathtouch'));

    if (attackersEligibleThisStep.length === 0 && blockersEligibleThisStep.length === 0) {
      return [];
    }

    if ([...attackers, ...blockers].some(card => card.powerToughnessOverride)) {
      notes.push('Using manual P/T override.');
    }

    if (keywords.includes('double strike')) {
      notes.push('Double strike deals combat damage in both first strike and normal damage steps.');
    }
    if (step === 'firstStrike') {
      notes.push('First Strike Damage step.');
    }
    if (step === 'normal' && attackers.some(card => firstStrikeDeadIds.has(card.instanceId))) {
      notes.push('One or more attackers may not deal normal combat damage because first-strike damage would destroy them.');
    }
    if (step === 'normal' && blockers.some(card => firstStrikeDeadIds.has(card.instanceId))) {
      notes.push('One or more blockers may not deal normal combat damage because first-strike damage would destroy them.');
    }

    if (hasUnknownPower) {
      notes.push('Unknown or variable power/toughness. Resolve this assignment manually.');
      warnings.push(`${assignment.sourceName}: unknown or variable P/T cannot be previewed exactly.`);
    }

    warnings.push(...unsupportedCombatWarnings(keywords, assignment.sourceName));

    if (!blocked) {
      damageToTarget = totalPower;
      if (assignment.attackTarget.type === 'player') addDamage(damageToPlayers, assignment.attackTarget.playerId, damageToTarget);
      if (assignment.attackTarget.type === 'planeswalker') addDamage(damageToPlaneswalkers, assignment.attackTarget.permanentId, damageToTarget);
      if (assignment.attackTarget.type === 'battle') addDamage(damageToBattles, assignment.attackTarget.permanentId, damageToTarget);
    } else {
      const hasExactDamageCaveat = keywords.some(keyword => keyword === 'protection' || keyword === 'prevent' || keyword === 'indestructible');

      if (attackerHasDeathtouch) {
        deathtouchLethal = totalPower > 0;
        notes.push('Deathtouch: 1 damage is lethal.');
      }

      if (attackerHasTrample && blockerIds.length > 1) {
        const warning = `${assignment.sourceName}: multiple blockers with trample need manual damage assignment order.`;
        manualAssignmentRequired = true;
        notes.push('Multiple blockers with trample: verify assignment order manually.');
        warnings.push(warning);
      }

      if (keywords.includes('indestructible')) {
        notes.push('Indestructible: lethal damage may be assigned, but the creature will not be destroyed by damage.');
      }

      if (keywords.includes('protection') || keywords.includes('prevent')) {
        manualAssignmentRequired = true;
        notes.push('Protection/prevention effect present: verify final damage manually.');
      }

      if (attackerHasTrample) {
        let remainingAttackerDamage = totalPower;
        for (const blocker of blockers) {
          const toughness = getEffectivePowerToughness(blocker, state)?.toughness;
          const lethalDamage = attackerHasDeathtouch
            ? 1
            : typeof toughness === 'number'
              ? Math.max(1, toughness - (blocker.markedForDamage ?? 0))
              : remainingAttackerDamage;
          lethalDamageRequired[blocker.instanceId] = lethalDamage;
          const assignedToBlocker = Math.min(remainingAttackerDamage, lethalDamage);
          damageToBlockers[blocker.instanceId] = assignedToBlocker;
          remainingAttackerDamage = Math.max(0, remainingAttackerDamage - assignedToBlocker);

          if (!hasExactDamageCaveat && assignedToBlocker > 0 && (
            attackerHasDeathtouch ||
            (typeof toughness === 'number' && (blocker.markedForDamage ?? 0) + assignedToBlocker >= toughness)
          )) {
            likelyDestroyed.add(blocker.instanceId);
            if (step === 'firstStrike') likelyDestroyedAfterFirstStrike.add(blocker.instanceId);
          }
        }
        damageToTarget = remainingAttackerDamage;
        trampleOverflow = damageToTarget;
        if (assignment.attackTarget.type === 'player') addDamage(damageToPlayers, assignment.attackTarget.playerId, damageToTarget);
        if (assignment.attackTarget.type === 'planeswalker') addDamage(damageToPlaneswalkers, assignment.attackTarget.permanentId, damageToTarget);
        if (assignment.attackTarget.type === 'battle') addDamage(damageToBattles, assignment.attackTarget.permanentId, damageToTarget);
        notes.push(`Trample overflow: ${damageToTarget}.`);
      } else {
        for (const blocker of blockers) {
          damageToBlockers[blocker.instanceId] = totalPower;
          const toughness = getEffectivePowerToughness(blocker, state)?.toughness;
          lethalDamageRequired[blocker.instanceId] = attackerHasDeathtouch ? 1 : typeof toughness === 'number' ? Math.max(1, toughness - (blocker.markedForDamage ?? 0)) : totalPower;
          if (!hasExactDamageCaveat && totalPower > 0 && (
            attackerHasDeathtouch ||
            (typeof toughness === 'number' && (blocker.markedForDamage ?? 0) + totalPower >= toughness)
          )) {
            likelyDestroyed.add(blocker.instanceId);
            if (step === 'firstStrike') likelyDestroyedAfterFirstStrike.add(blocker.instanceId);
          }
        }
      }

      const totalBlockerPower = blockersEligibleThisStep.reduce((sum, blocker) => sum + (getEffectivePowerToughness(blocker, state)?.power ?? 0), 0);
      for (const attacker of attackers) {
        damageToAttackers[attacker.instanceId] = totalBlockerPower;
        const toughness = getEffectivePowerToughness(attacker, state)?.toughness;
        if (!hasExactDamageCaveat && typeof toughness === 'number' && (attacker.markedForDamage ?? 0) + totalBlockerPower >= toughness) {
          likelyDestroyed.add(attacker.instanceId);
          if (step === 'firstStrike') likelyDestroyedAfterFirstStrike.add(attacker.instanceId);
        }
      }
      notes.push(`${step === 'firstStrike' ? 'First strike' : 'Normal'} blocked assignment preview uses simple damage${attackerHasTrample ? ' with trample overflow' : ''}.`);
    }

    return {
      attackAssignmentId: assignment.assignmentId,
      attackerIds: assignment.attackerIds,
      blockerIds,
      attackTarget: assignment.attackTarget,
      attackerName: assignment.sourceName,
      count: assignment.count,
      powerPerAttacker,
      totalPower,
      blocked,
      damageToTarget,
      damageToBlockers,
      damageToAttackers,
      trampleOverflow: attackerHasTrample ? trampleOverflow : undefined,
      lethalDamageRequired,
      deathtouchLethal,
      manualAssignmentRequired,
      combatMathNotes: notes,
      keywords,
      notes,
      damageStep: step,
    };
  });

  const firstStrikeAssignments = hasFirstStrikeDamageStep
    ? buildStepAssignments('firstStrike', new Set<string>())
    : [];
  const normalDamageAssignments = buildStepAssignments('normal', likelyDestroyedAfterFirstStrike);
  const previewAssignments = hasFirstStrikeDamageStep
    ? [...firstStrikeAssignments, ...normalDamageAssignments]
    : normalDamageAssignments;

  return {
    previewId: uuid(),
    generatedAt: Date.now(),
    attackingPlayerId: state.combat.attackingPlayerId || state.activePlayerId,
    assignments: previewAssignments,
    firstStrikeAssignments,
    normalDamageAssignments,
    hasFirstStrikeDamageStep,
    hasNormalDamageStep,
    damageToPlayers,
    damageToPlaneswalkers,
    damageToBattles,
    likelyDestroyedCreatures: [...likelyDestroyed],
    likelyDestroyedAfterFirstStrike: [...likelyDestroyedAfterFirstStrike],
    firstStrikeLikelyDestroyedCreatures: [...likelyDestroyedAfterFirstStrike],
    normalLikelyDestroyedCreatures: [...likelyDestroyed],
    stepNotes,
    warnings: [...new Set(warnings)],
  };
}

function attackTargetToLegacyPlayerId(target: AttackDefenderTarget): string {
  if (target.type === 'player') return target.playerId;
  if (target.type === 'planeswalker') return target.controllerId;
  return target.protectorId;
}

function cardHasCombatKeyword(card: CardState, keyword: string): boolean {
  const lowerKeyword = keyword.toLowerCase();
  return (
    getEffectiveCardDefinition(card).keywords.some(k => k.toLowerCase() === lowerKeyword) ||
    getEffectiveOracleText(card).toLowerCase().includes(lowerKeyword)
  );
}

function isEligibleTokenStackAttacker(card: CardState, playerId: string): boolean {
  const def = getEffectiveCardDefinition(card);
  if (!card.token) return false;
  if (card.zone !== 'battlefield') return false;
  if (card.controllerId !== playerId) return false;
  if (!def.cardTypes.includes('Creature')) return false;
  if (card.tapped) return false;
  if (cardHasCombatKeyword(card, 'defender')) return false;
  if (card.summoningSick && !cardHasCombatKeyword(card, 'haste')) return false;
  return true;
}

function tokenStackAssignmentId(sourceGroupId: string, index: number, ids: string[]): string {
  return `token-stack-${sourceGroupId}-${index}-${ids.join('-')}`;
}

export function declareTokenStackAttack(
  state: GameState,
  playerId: string,
  sourceGroupId: string,
  attackerIds: string[],
  assignments: TokenStackAttackInput[],
): { state: GameState; valid: boolean; reason?: string; selectedAttackerIds: string[]; assignmentIds: string[] } {
  const requestedIds = [...new Set(attackerIds)];
  const requestedCards = requestedIds.map(id => state.cards[id]).filter(Boolean) as CardState[];
  if (requestedCards.some(card => card.controllerId !== playerId)) {
    return { state, valid: false, reason: 'Token stack contains cards not controlled by player.', selectedAttackerIds: [], assignmentIds: [] };
  }

  const normalizedAssignments = assignments
    .map(assignment => ({ ...assignment, count: Math.max(0, Math.floor(assignment.count)) }))
    .filter(assignment => assignment.count > 0);
  const eligible = requestedCards.filter(card => isEligibleTokenStackAttacker(card, playerId));
  const eligibleIdSet = new Set(eligible.map(card => card.instanceId));
  const totalRequested = normalizedAssignments.reduce((sum, assignment) => sum + assignment.count, 0);
  if (totalRequested > eligible.length) {
    return { state, valid: false, reason: 'Assigned token count exceeds eligible attackers.', selectedAttackerIds: [], assignmentIds: [] };
  }

  const consumed = new Set<string>();
  const newCards = { ...state.cards };
  const legacyAttackers = [...state.combat.attackers];
  const attackAssignments = [...(state.combat.attackAssignments ?? [])];
  const selectedAttackerIds: string[] = [];
  const assignmentIds: string[] = [];

  normalizedAssignments.forEach((assignment, index) => {
    let selectedIds: string[];
    if (assignment.attackerIds && assignment.attackerIds.length > 0) {
      selectedIds = assignment.attackerIds.slice(0, assignment.count);
      const invalidExactId = selectedIds.some(id => !eligibleIdSet.has(id) || consumed.has(id));
      if (invalidExactId || selectedIds.length < assignment.count) return;
    } else {
      selectedIds = eligible
        .map(card => card.instanceId)
        .filter(id => !consumed.has(id))
        .slice(0, assignment.count);
    }
    if (selectedIds.length !== assignment.count) return;

    selectedIds.forEach(id => consumed.add(id));
    selectedAttackerIds.push(...selectedIds);
    const firstCard = state.cards[selectedIds[0]];
    const firstDef = firstCard ? getEffectiveCardDefinition(firstCard) : undefined;
    const power = parsePowerPreview(firstCard);
    const assignmentId = tokenStackAssignmentId(sourceGroupId, index, selectedIds);
    const legacyTargetPlayerId = attackTargetToLegacyPlayerId(assignment.attackTarget);
    const tappedOnDeclare = selectedIds.some(id => !cardHasCombatKeyword(state.cards[id], 'vigilance'));

    for (const id of selectedIds) {
      const card = state.cards[id];
      if (!card) continue;
      const hasVigilance = cardHasCombatKeyword(card, 'vigilance');
      newCards[id] = {
        ...card,
        tapped: hasVigilance ? card.tapped : true,
        combatRole: 'attacker',
        attackTarget: legacyTargetPlayerId,
      };
      legacyAttackers.push({
        instanceId: id,
        targetPlayerId: legacyTargetPlayerId,
        targets: [],
        attackTarget: assignment.attackTarget,
      });
    }

    attackAssignments.push({
      assignmentId,
      controllerId: playerId,
      attackerIds: selectedIds,
      sourceGroupId,
      sourceName: firstDef?.name ?? firstCard?.definition.name ?? 'Token stack',
      count: selectedIds.length,
      isTokenStack: true,
      powerDisplay: firstDef?.power,
      toughnessDisplay: firstDef?.toughness,
      totalPowerPreview: typeof power === 'number' ? power * selectedIds.length : undefined,
      attackTarget: assignment.attackTarget,
      tappedOnDeclare,
      legal: true,
      legalityWarnings: [],
    });
    assignmentIds.push(assignmentId);
  });

  if (selectedAttackerIds.length !== totalRequested) {
    return { state, valid: false, reason: 'Unable to select enough eligible token attackers.', selectedAttackerIds: [], assignmentIds: [] };
  }

  return {
    state: {
      ...state,
      cards: newCards,
      combat: {
        ...state.combat,
        active: true,
        attackingPlayerId: state.combat.attackingPlayerId || playerId,
        attackers: legacyAttackers,
        attackAssignments,
      },
      lastUpdatedAt: Date.now(),
    },
    valid: true,
    selectedAttackerIds,
    assignmentIds,
  };
}

function cardHasSneak(card: CardState): boolean {
  return Boolean(card.sneak?.cost || card.sneak?.castWithSneak || /\bsneak\b/i.test([
    getEffectiveCardDefinition(card).oracleText,
    getEffectiveCardDefinition(card).keywords.join(' '),
    getEffectiveCardDefinition(card).typeLine,
  ].join(' ')));
}

export function getSneakReturnCandidates(
  state: GameState,
  playerId: string,
): { attackerId: string; assignment: CombatAttackAssignment }[] {
  if (state.activePlayerId !== playerId) return [];
  if (state.phase !== 'declareBlockers' && state.combat.combatPhase !== 'declareBlockers') return [];
  return getUnblockedAttackAssignments(state, playerId).flatMap(assignment =>
    assignment.attackerIds
      .filter(attackerId => {
        const attacker = state.cards[attackerId];
        return Boolean(attacker && attacker.controllerId === playerId && attacker.combatRole === 'attacker');
      })
      .map(attackerId => ({ attackerId, assignment }))
  );
}

export function canCastWithSneak(state: GameState, playerId: string, cardId: string): boolean {
  const player = state.players.find(p => p.id === playerId);
  const card = state.cards[cardId];
  if (!player || !card) return false;
  if (state.activePlayerId !== playerId) return false;
  if (state.phase !== 'declareBlockers' && state.combat.combatPhase !== 'declareBlockers') return false;
  if (card.zone !== 'hand' || !player.hand.includes(cardId)) return false;
  if (!cardHasSneak(card)) return false;
  return getSneakReturnCandidates(state, playerId).length > 0;
}

export function castWithSneak(
  state: GameState,
  playerId: string,
  cardId: string,
  returnedAttackerId: string,
): { state: GameState; valid: boolean; reason?: string; attackTarget?: AttackDefenderTarget } {
  if (!canCastWithSneak(state, playerId, cardId)) {
    return { state, valid: false, reason: 'Sneak is not currently available for this card.' };
  }
  const candidate = getSneakReturnCandidates(state, playerId)
    .find(item => item.attackerId === returnedAttackerId);
  if (!candidate) {
    return { state, valid: false, reason: 'Returned creature must be an unblocked attacker you control.' };
  }

  const returnedAttacker = state.cards[returnedAttackerId];
  const sneakCard = state.cards[cardId];
  if (!returnedAttacker || !sneakCard) return { state, valid: false, reason: 'Sneak card or returned attacker missing.' };

  const attackTarget = candidate.assignment.attackTarget;
  let next = moveCard(state, returnedAttackerId, 'hand', returnedAttacker.ownerId);
  const effectiveDef = getEffectiveCardDefinition(sneakCard);
  const isPermanent = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle']
    .some(type => effectiveDef.cardTypes.includes(type as CardDefinition['cardTypes'][number]));
  const isCreature = effectiveDef.cardTypes.includes('Creature');
  next = moveCard(next, cardId, isPermanent ? 'battlefield' : 'graveyard', playerId);

  const enteredCard = next.cards[cardId];
  if (!enteredCard) return { state, valid: false, reason: 'Sneak card failed to move.' };

  const legacyTargetPlayerId = attackTargetToLegacyPlayerId(attackTarget);
  const nextCards = {
    ...next.cards,
    [cardId]: {
      ...enteredCard,
      tapped: isCreature ? true : enteredCard.tapped,
      combatRole: isCreature ? 'attacker' as const : enteredCard.combatRole,
      attackTarget: isCreature ? legacyTargetPlayerId : enteredCard.attackTarget,
      summoningSick: isCreature ? false : enteredCard.summoningSick,
      sneak: {
        ...(enteredCard.sneak ?? {}),
        cost: enteredCard.sneak?.cost,
        castWithSneak: true,
        returnedAttackerId,
        attackTarget,
      },
    },
  };

  const nextCombat = isCreature
    ? {
        ...next.combat,
        attackers: [
          ...next.combat.attackers,
          { instanceId: cardId, targetPlayerId: legacyTargetPlayerId, targets: [], attackTarget },
        ],
        attackAssignments: [
          ...(next.combat.attackAssignments ?? []),
          {
            ...createSingleAttackAssignment({ ...next, cards: nextCards }, cardId, attackTarget),
            tappedOnDeclare: true,
          },
        ],
      }
    : next.combat;

  return {
    state: {
      ...next,
      cards: nextCards,
      combat: nextCombat,
      turnTrackers: {
        ...(next.turnTrackers ?? { spellsWarpedThisTurn: [], cardsAirbendedThisTurn: [], waterbendEventsThisTurn: [], earthbentThisTurn: [] }),
        sneakCastsThisTurn: [
          ...(next.turnTrackers?.sneakCastsThisTurn ?? []),
          { playerId, cardId, returnedAttackerId, attackTarget },
        ],
      },
      lastUpdatedAt: Date.now(),
    },
    valid: true,
    attackTarget,
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

  const players = g.players.map(player => ({
    ...player,
    combatMana: { ...EMPTY_MANA_POOL },
  }));

  return {
    ...g,
    players,
    cards: changedCards ? newCards : g.cards,
    combat: createEmptyCombat(),
    lastUpdatedAt: Date.now(),
  };
}

// â”€â”€â”€ Action Logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Card Operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const earthbendReturns =
    fromZone === 'battlefield' &&
    (toZone === 'graveyard' || toZone === 'exile') &&
    card.earthbend?.returnTappedIfDiesOrExiled;
  const resolvedToZone = earthbendReturns ? 'battlefield' : toZone;
  const resolvedControllerId = earthbendReturns ? card.earthbend!.controllerOfEffect : toControllerId;
  const newCard: CardState = {
    ...card,
    zone: resolvedToZone,
    controllerId: resolvedControllerId || card.controllerId,
    tapped: earthbendReturns ? true : resolvedToZone === 'battlefield' ? false : card.tapped,
    earthbend: earthbendReturns ? undefined : card.earthbend,
    summoningSick: resolvedToZone === 'battlefield' &&
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
  if (fromZone === 'battlefield' && resolvedToZone !== 'battlefield') {
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
    const newOwner = resolvedControllerId || card.controllerId;
    if (p.id === newOwner) {
      const addTo = (arr: string[]) => [...arr, instanceId];
      switch (resolvedToZone) {
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
  if (fromZone === 'battlefield' && resolvedToZone !== 'battlefield') {
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
        attackAssignments: (state.combat.attackAssignments ?? []).filter(a => !a.attackerIds.includes(instanceId)),
        blockAssignments: (state.combat.blockAssignments ?? []).filter(b =>
          b.blockerId !== instanceId && !b.blockedAttackerIds.includes(instanceId)
        ),
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

export function applyCounterAnnihilation(card: CardState): CardState {
  const def = getEffectiveCardDefinition(card);
  if (!def.cardTypes.includes('Creature')) return card;
  const sourceCounters = card.counters ?? [];
  const plus = sourceCounters.find(counter => counter.type === '+1/+1')?.count ?? 0;
  const minus = sourceCounters.find(counter => counter.type === '-1/-1')?.count ?? 0;
  const cancel = Math.min(plus, minus);
  if (cancel <= 0) return card;
  const counters = sourceCounters
    .map(counter => {
      if (counter.type === '+1/+1') return { ...counter, count: counter.count - cancel };
      if (counter.type === '-1/-1') return { ...counter, count: counter.count - cancel };
      return counter;
    })
    .filter(counter => counter.count > 0);
  return { ...card, counters };
}

export function applyStateBasedCounterCleanup(state: GameState): GameState {
  let changed = false;
  const cards = { ...state.cards };
  for (const [id, card] of Object.entries(state.cards)) {
    const cleaned = applyCounterAnnihilation(card);
    if (cleaned !== card) {
      cards[id] = cleaned;
      changed = true;
    }
  }
  return changed ? { ...state, cards, lastUpdatedAt: Date.now() } : state;
}

export function addCounter(state: GameState, instanceId: string, counterType: string, amount = 1): GameState {
  const card = state.cards[instanceId];
  if (!card) return state;
  const sourceCounters = card.counters ?? [];
  const existing = sourceCounters.find(c => c.type === counterType);
  let newCounters: Counter[];
  if (existing) {
    newCounters = sourceCounters.map(c =>
      c.type === counterType ? { ...c, count: c.count + amount } : c
    );
  } else {
    newCounters = [...sourceCounters, { type: counterType, count: amount }];
  }
  const nextCard = applyCounterAnnihilation({ ...card, counters: newCounters });
  return {
    ...state,
    cards: { ...state.cards, [instanceId]: nextCard },
    lastUpdatedAt: Date.now(),
  };
}

export function removeCounter(state: GameState, instanceId: string, counterType: string, amount = 1): GameState {
  const card = state.cards[instanceId];
  if (!card) return state;
  const newCounters = (card.counters ?? [])
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

// â”€â”€â”€ Phase Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  // End of turn â€” advance to next player
  return nextTurn(state);
}

export function setPhase(state: GameState, phase: Phase): GameState {
  let nextState = {
    ...state,
    phase,
    priorityPlayerId: state.activePlayerId,
    lastUpdatedAt: Date.now(),
  };
  if (phase === 'endStep') {
    nextState = exileWarpedPermanentsForEndStep(nextState);
  }
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
    turnTrackers: {
      spellsWarpedThisTurn: [],
      cardsAirbendedThisTurn: [],
      waterbendEventsThisTurn: [],
      earthbentThisTurn: [],
      sneakCastsThisTurn: [],
      stationEventsThisTurn: [],
    },
    lastUpdatedAt: Date.now(),
  };
}

// â”€â”€â”€ Stack Operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Trigger Queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Deck Loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  const subTypes = typeLine.includes('â€”')
    ? typeLine.split('â€”').slice(1).join('â€”').trim().split(/\s+/).filter(Boolean)
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

// â”€â”€â”€ Draw & Mulligan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

export function addCombatManaToPool(state: GameState, playerId: string, mana: Partial<ManaPool>): GameState {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return state;
  const current = normalizeManaPool(player.combatMana);
  const next = normalizeManaPool({
    W: current.W + clampMana(mana.W ?? 0),
    U: current.U + clampMana(mana.U ?? 0),
    B: current.B + clampMana(mana.B ?? 0),
    R: current.R + clampMana(mana.R ?? 0),
    G: current.G + clampMana(mana.G ?? 0),
    C: current.C + clampMana(mana.C ?? 0),
    generic: current.generic + clampMana(mana.generic ?? 0),
  });
  return {
    ...state,
    players: state.players.map(p =>
      p.id === playerId
        ? { ...p, combatMana: next }
        : p
    ),
    lastUpdatedAt: Date.now(),
  };
}

function removeTokenCard(state: GameState, instanceId: string): GameState {
  const card = state.cards[instanceId];
  if (!card?.token) return state;
  const cards = { ...state.cards };
  delete cards[instanceId];
  const players = state.players.map(player => ({
    ...player,
    hand: player.hand.filter(id => id !== instanceId),
    library: player.library.filter(id => id !== instanceId),
    graveyard: player.graveyard.filter(id => id !== instanceId),
    exile: player.exile.filter(id => id !== instanceId),
    battlefield: player.battlefield.filter(id => id !== instanceId),
    commandZone: player.commandZone.filter(id => id !== instanceId),
    sideboard: player.sideboard.filter(id => id !== instanceId),
    maybeboard: player.maybeboard.filter(id => id !== instanceId),
  }));
  return { ...state, cards, players, lastUpdatedAt: Date.now() };
}

export function applyAirbend(state: GameState, targetId: string, sourceId?: string): GameState {
  const card = state.cards[targetId];
  if (!card) return state;
  if (card.token) {
    const removed = removeTokenCard(state, targetId);
    return {
      ...removed,
      turnTrackers: {
        ...(removed.turnTrackers ?? { spellsWarpedThisTurn: [], cardsAirbendedThisTurn: [], waterbendEventsThisTurn: [], earthbentThisTurn: [] }),
        cardsAirbendedThisTurn: [...(removed.turnTrackers?.cardsAirbendedThisTurn ?? []), targetId],
      },
    };
  }

  let next = moveCard(state, targetId, 'exile', card.controllerId, {
    exileReason: 'Airbend',
    exiledBy: sourceId,
    exileReturn: 'Owner may cast this from exile for {2}.',
    exilePermanent: false,
  });
  const exiled = next.cards[targetId];
  if (!exiled) return next;
  return {
    ...next,
    cards: {
      ...next.cards,
      [targetId]: {
        ...exiled,
        exilePermission: {
          ownerId: card.ownerId,
          sourceMechanic: 'airbend',
          alternativeCost: '{2}',
          timing: 'normal',
          expires: 'never',
          createdAtTurn: state.turn,
          sourceInstanceId: sourceId,
        },
      },
    },
    turnTrackers: {
      ...(next.turnTrackers ?? { spellsWarpedThisTurn: [], cardsAirbendedThisTurn: [], waterbendEventsThisTurn: [], earthbentThisTurn: [] }),
      cardsAirbendedThisTurn: [...(next.turnTrackers?.cardsAirbendedThisTurn ?? []), targetId],
    },
    lastUpdatedAt: Date.now(),
  };
}

export function markCastForWarp(state: GameState, cardId: string, warpCost?: string): GameState {
  const card = state.cards[cardId];
  if (!card) return state;
  return {
    ...state,
    cards: {
      ...state.cards,
      [cardId]: { ...card, warpedThisTurn: true },
    },
    turnTrackers: {
      ...(state.turnTrackers ?? { spellsWarpedThisTurn: [], cardsAirbendedThisTurn: [], waterbendEventsThisTurn: [], earthbentThisTurn: [] }),
      spellsWarpedThisTurn: [...(state.turnTrackers?.spellsWarpedThisTurn ?? []), cardId],
    },
    triggerQueue: [
      ...state.triggerQueue,
      {
        id: uuid(),
        sourceInstanceId: cardId,
        sourceName: card.definition.name,
        controllerId: card.controllerId,
        text: `${card.definition.name} was cast for warp${warpCost ? ` (${warpCost})` : ''}. Exile it at the next end step.`,
        triggerType: 'exile',
        acknowledged: false,
        missed: false,
        timestamp: Date.now(),
        data: { mechanicId: 'warp', warpCost },
      },
    ],
    lastUpdatedAt: Date.now(),
  };
}

export function getWaterbendEligiblePermanents(state: GameState, playerId: string): CardState[] {
  return Object.values(state.cards).filter(card => {
    const def = getEffectiveCardDefinition(card);
    return card.zone === 'battlefield' &&
      card.controllerId === playerId &&
      !card.tapped &&
      (def.cardTypes.includes('Artifact') || def.cardTypes.includes('Creature'));
  });
}

export function markWaterbent(
  state: GameState,
  playerId: string,
  sourceId?: string,
  amount = 0,
  permanentIds: string[] = [],
): GameState {
  return {
    ...state,
    turnTrackers: {
      ...(state.turnTrackers ?? { spellsWarpedThisTurn: [], cardsAirbendedThisTurn: [], waterbendEventsThisTurn: [], earthbentThisTurn: [] }),
      waterbendEventsThisTurn: [
        ...(state.turnTrackers?.waterbendEventsThisTurn ?? []),
        { playerId, sourceId, amount, permanentIds },
      ],
    },
    lastUpdatedAt: Date.now(),
  };
}

export function payWaterbendCost(
  state: GameState,
  playerId: string,
  amount: number,
  permanentIds: string[],
  sourceId?: string,
): { state: GameState; paid: number; valid: boolean; reason?: string } {
  const safeAmount = Math.max(0, Math.floor(amount));
  const chosen = [...new Set(permanentIds)];
  if (chosen.length > safeAmount) return { state, paid: 0, valid: false, reason: 'too_many_permanents' };

  let next = state;
  for (const id of chosen) {
    const card = next.cards[id];
    if (!card) return { state, paid: 0, valid: false, reason: 'missing_permanent' };
    const def = getEffectiveCardDefinition(card);
    if (card.zone !== 'battlefield') return { state, paid: 0, valid: false, reason: 'not_on_battlefield' };
    if (card.controllerId !== playerId) return { state, paid: 0, valid: false, reason: 'wrong_controller' };
    if (card.tapped) return { state, paid: 0, valid: false, reason: 'already_tapped' };
    if (!def.cardTypes.includes('Artifact') && !def.cardTypes.includes('Creature')) {
      return { state, paid: 0, valid: false, reason: 'not_artifact_or_creature' };
    }
  }

  for (const id of chosen) {
    next = tapCard(next, id, true);
  }
  next = markWaterbent(next, playerId, sourceId, chosen.length, chosen);
  return { state: next, paid: chosen.length, valid: true };
}

export function applyEarthbend(
  state: GameState,
  playerId: string,
  landId: string,
  amount: number,
  sourceId?: string,
): { state: GameState; valid: boolean; reason?: string } {
  const card = state.cards[landId];
  const safeAmount = Math.max(0, Math.floor(amount));
  if (!card) return { state, valid: false, reason: 'missing_land' };
  if (card.zone !== 'battlefield') return { state, valid: false, reason: 'not_on_battlefield' };
  if (card.controllerId !== playerId) return { state, valid: false, reason: 'wrong_controller' };
  if (!getEffectiveCardDefinition(card).cardTypes.includes('Land')) return { state, valid: false, reason: 'not_land' };
  if (safeAmount <= 0) return { state, valid: false, reason: 'invalid_amount' };

  const def = getEffectiveCardDefinition(card);
  const cardTypes = Array.from(new Set([...def.cardTypes, 'Creature' as const]));
  const keywords = Array.from(new Set([...def.keywords, 'Haste']));
  let next: GameState = {
    ...state,
    cards: {
      ...state.cards,
      [landId]: {
        ...card,
        definition: {
          ...card.definition,
          cardTypes,
          typeLine: card.definition.typeLine.includes('Creature') ? card.definition.typeLine : `${card.definition.typeLine} Creature`,
          power: '0',
          toughness: '0',
          keywords,
        },
        summoningSick: false,
        earthbend: {
          amount: safeAmount,
          controllerOfEffect: playerId,
          basePower: 0,
          baseToughness: 0,
          hasHaste: true,
          returnTappedIfDiesOrExiled: true,
          sourceInstanceId: sourceId,
        },
      },
    },
    turnTrackers: {
      ...(state.turnTrackers ?? { spellsWarpedThisTurn: [], cardsAirbendedThisTurn: [], waterbendEventsThisTurn: [], earthbentThisTurn: [] }),
      earthbentThisTurn: [
        ...(state.turnTrackers?.earthbentThisTurn ?? []),
        { playerId, landId, amount: safeAmount, sourceId },
      ],
    },
    lastUpdatedAt: Date.now(),
  };
  next = addCounter(next, landId, '+1/+1', safeAmount);
  return { state: next, valid: true };
}

function exileWarpedPermanentsForEndStep(state: GameState): GameState {
  let next = state;
  const warpedIds = Object.values(state.cards)
    .filter(card => card.warpedThisTurn && card.zone === 'battlefield')
    .map(card => card.instanceId);
  for (const id of warpedIds) {
    const card = next.cards[id];
    if (!card) continue;
    next = moveCard(next, id, 'exile', card.controllerId, {
      exileReason: 'Warp',
      exileReturn: 'Owner may cast this from exile for its normal cost.',
      exilePermanent: false,
    });
    const exiled = next.cards[id];
    if (!exiled) continue;
    next = {
      ...next,
      cards: {
        ...next.cards,
        [id]: {
          ...exiled,
          warpedThisTurn: false,
          exilePermission: {
            ownerId: card.ownerId,
            sourceMechanic: 'warp',
            timing: 'normal',
            expires: 'never',
            createdAtTurn: state.turn,
            sourceInstanceId: id,
          },
        },
      },
      lastUpdatedAt: Date.now(),
    };
  }
  return next;
}

export function clearCombatMana(state: GameState, playerId?: string): GameState {
  return {
    ...state,
    players: state.players.map(p =>
      !playerId || p.id === playerId
        ? { ...p, combatMana: { ...EMPTY_MANA_POOL } }
        : p
    ),
    lastUpdatedAt: Date.now(),
  };
}

export function markExhaustUsedOnCard(state: GameState, instanceId: string, exhaustId = 'default'): GameState {
  const card = state.cards[instanceId];
  if (!card) return state;
  return {
    ...state,
    cards: {
      ...state.cards,
      [instanceId]: {
        ...card,
        exhaustUsed: {
          ...(card.exhaustUsed ?? {}),
          [exhaustId]: true,
        },
      },
    },
    lastUpdatedAt: Date.now(),
  };
}

export function resetExhaustUsedOnCard(state: GameState, instanceId: string, exhaustId?: string): GameState {
  const card = state.cards[instanceId];
  if (!card) return state;
  const nextExhaust = { ...(card.exhaustUsed ?? {}) };
  if (exhaustId) {
    delete nextExhaust[exhaustId];
  }
  return {
    ...state,
    cards: {
      ...state.cards,
      [instanceId]: {
        ...card,
        exhaustUsed: exhaustId ? nextExhaust : {},
      },
    },
    lastUpdatedAt: Date.now(),
  };
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

// â”€â”€â”€ Token Creation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ State-Based Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function checkStateBasedActions(state: GameState): { newState: GameState; flags: AssistantFlag[] } {
  let newState = applyStateBasedCounterCleanup(state);
  const flags: AssistantFlag[] = [];

  // Check creature death (toughness â‰¤ 0 or damage â‰¥ toughness)
  for (const card of Object.values(newState.cards)) {
    if (card.zone !== 'battlefield') continue;
    const def = getEffectiveCardDefinition(card);
    if (!def.cardTypes.includes('Creature')) continue;

    const effectiveToughness = getEffectivePowerToughness(card, state)?.toughness;
    if (typeof effectiveToughness !== 'number') continue;

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

// â”€â”€â”€ Combat Operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function declareAttacker(
  state: GameState,
  attackerInstanceId: string,
  targetPlayerId: string
): GameState {
  const card = state.cards[attackerInstanceId];
  if (!card || card.zone !== 'battlefield') return state;
  const target = toAttackDefenderTarget(targetPlayerId);

  const newCombat: CombatState = {
    ...state.combat,
    active: true,
    attackingPlayerId: state.activePlayerId,
    attackers: [
      ...state.combat.attackers,
      { instanceId: attackerInstanceId, targetPlayerId, targets: [], attackTarget: target },
    ],
    attackAssignments: [
      ...(state.combat.attackAssignments ?? []),
      createSingleAttackAssignment(state, attackerInstanceId, target),
    ],
  };

  // CR 702.20: Vigilance â€” attacking doesn't cause creature to tap
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
    blockAssignments: [
      ...(state.combat.blockAssignments ?? []),
      {
        assignmentId: blockAssignmentIdForBlocker(blockerInstanceId, attackerInstanceId),
        blockerId: blockerInstanceId,
        blockerControllerId: blocker.controllerId,
        blockedAttackAssignmentId: assignmentIdForAttacker(attackerInstanceId),
        blockedAttackerIds: [attackerInstanceId],
        legal: true,
        legalityWarnings: [],
      },
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

// â”€â”€â”€ Snapshot / Undo / Redo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Myriad â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * CR 702.116 â€” Myriad
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
      // Build token copy definition â€” mirrors original but flagged as copy
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
        summoningSick: false,   // Tokens entering via Myriad are attacking â€” no SS check
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
            { instanceId: copyInstanceId, targetPlayerId: opponent.id, targets: [], attackTarget: toAttackDefenderTarget(opponent.id) },
          ],
          attackAssignments: [
            ...(g.combat.attackAssignments ?? []),
            createSingleAttackAssignment(
              {
                ...g,
                cards: {
                  ...g.cards,
                  [copyInstanceId]: copyCard,
                },
              },
              copyInstanceId,
              toAttackDefenderTarget(opponent.id),
            ),
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

  // Remove copy cards entirely (tokens cease to exist in exile â€” CR 702.116d)
  const newCards = { ...g.cards };
  for (const id of copyIds) delete newCards[id];

  return { ...g, cards: newCards };
}






