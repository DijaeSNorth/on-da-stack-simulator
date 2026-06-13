import { v4 as uuid } from 'uuid';
import type {
  CardDefinition,
  Deck,
  DummyDeckArchetype,
  DummyDeckPower,
  DummyOpponentConfig,
  DummyOpponentProfile,
  GameConfig,
  GameState,
  Player,
} from '../types/game';
import {
  createAction,
  createCardState,
  createPlayer,
  declareAttacker,
  declareBlocker,
  getEffectivePowerToughness,
} from './gameEngine';

const DUMMY_COLORS = ['#64748b', '#dc2626', '#7c3aed', '#0891b2', '#ca8a04'];

export function normalizeDummyOpponentConfig(input: Partial<DummyOpponentConfig> = {}): DummyOpponentConfig {
  const profile = input.profile ?? 'training';
  return {
    id: input.id || `dummy-${uuid()}`,
    name: input.name?.trim() || profileLabel(profile),
    profile,
    startingLife: Math.max(1, Math.floor(input.startingLife ?? 40)),
    startingBlockers: Math.max(0, Math.floor(input.startingBlockers ?? (profile === 'blocker' ? 2 : 0))),
    pressurePerTurn: Math.max(0, Math.floor(input.pressurePerTurn ?? (profile === 'aggro' ? 2 : 0))),
    comboTurn: Math.max(1, Math.floor(input.comboTurn ?? 6)),
    autoBlock: input.autoBlock ?? profile === 'blocker',
    autoAttack: input.autoAttack ?? profile === 'aggro',
    dummyDeckMode: input.dummyDeckMode ?? 'none',
    dummyDeckArchetype: input.dummyDeckArchetype ?? defaultArchetypeForProfile(profile),
    dummyDeckPower: input.dummyDeckPower ?? 'low',
    dummyDeckId: input.dummyDeckId,
    startingHandSize: Math.max(0, Math.floor(input.startingHandSize ?? 7)),
    autoPlayLand: input.autoPlayLand ?? true,
    autoCastCreature: input.autoCastCreature ?? true,
  };
}

export function createGeneratedDummyDeck(
  profile: DummyOpponentProfile = 'training',
  archetype: DummyDeckArchetype = defaultArchetypeForProfile(profile),
  power: DummyDeckPower = 'low',
): Deck {
  const powerBonus = power === 'high' ? 1 : 0;
  const landCount = archetype === 'control' ? 26 : archetype === 'midrange' ? 25 : 24;
  const cards: Deck['cards'] = [{ name: 'Dummy Basic Land', count: landCount }];
  if (archetype === 'aggro') {
    cards.push(
      { name: powerBonus ? 'Dummy 2/1 Raider' : 'Dummy 1/1 Attacker', count: 12 },
      { name: 'Dummy 2/2 Brawler', count: 14 },
      { name: 'Dummy 3/2 Charger', count: 10 },
    );
  } else if (archetype === 'midrange') {
    cards.push(
      { name: 'Dummy 2/2 Brawler', count: 10 },
      { name: 'Dummy 3/3 Ranger', count: 12 },
      { name: powerBonus ? 'Dummy 5/5 Stomper' : 'Dummy 4/4 Stomper', count: 8 },
    );
  } else if (archetype === 'control') {
    cards.push(
      { name: 'Dummy 0/4 Wall', count: 10 },
      { name: 'Dummy Removal Placeholder', count: 10 },
      { name: powerBonus ? 'Dummy 5/5 Finisher' : 'Dummy 4/4 Finisher', count: 6 },
    );
  } else {
    cards.push(
      { name: 'Dummy Token Maker', count: 14 },
      { name: 'Dummy 1/1 Attacker', count: 10 },
      { name: 'Dummy 2/2 Brawler', count: 10 },
    );
  }
  return {
    id: `dummy-generated-${archetype}-${power}`,
    name: `Generated Dummy ${archetype}`,
    format: 'commander',
    commanders: [],
    cards,
    sideboard: [],
    maybeboard: [],
    colorIdentity: [],
    importedAt: Date.now(),
  };
}

export function createDummyOpponent(
  config: DummyOpponentConfig,
  seatIndex: number,
  gameConfig: GameConfig,
): Player {
  const normalized = normalizeDummyOpponentConfig(config);
  return {
    ...createPlayer(
      normalized.id,
      normalized.name,
      seatIndex,
      DUMMY_COLORS[(seatIndex - 1 + DUMMY_COLORS.length) % DUMMY_COLORS.length],
      { ...gameConfig, startingLife: normalized.startingLife },
      { initial: 'D', style: 'outline' },
    ),
    connected: false,
    isReady: true,
    isDummy: true,
    dummyProfile: normalized.profile,
    dummyConfig: normalized,
  };
}

export function addDummyOpponentToGame(
  game: GameState,
  input: Partial<DummyOpponentConfig>,
): { state: GameState; config: DummyOpponentConfig; playerId: string; blockerIds: string[] } {
  const config = normalizeDummyOpponentConfig(input);
  const existing = game.players.find(player => player.id === config.id);
  const seatIndex = existing?.seatIndex ?? game.players.length;
  const dummy = existing ?? createDummyOpponent(config, seatIndex, game.config);
  let next: GameState = {
    ...game,
    config: {
      ...game.config,
      playerCount: Math.min(6, Math.max(2, existing ? game.players.length : game.players.length + 1)) as GameConfig['playerCount'],
    },
    players: existing
      ? game.players.map(player => player.id === dummy.id ? { ...player, ...dummy } : player)
      : [...game.players, dummy],
    lastUpdatedAt: Date.now(),
  };
  const blockerIds: string[] = [];
  const blockers = Math.max(0, Math.floor(config.startingBlockers ?? 0));
  for (let index = 0; index < blockers; index += 1) {
    const created = addDummyCreature(next, dummy.id, `${config.name} Blocker`, config.profile === 'blocker' ? '2' : '1', config.profile === 'blocker' ? '2' : '1', 'blocker');
    next = created.state;
    blockerIds.push(created.cardId);
  }
  if (config.dummyDeckMode === 'generated') {
    next = populateGeneratedDummyDeck(next, dummy.id, config);
  }
  return { state: next, config, playerId: dummy.id, blockerIds };
}

export function autoBlockForDummy(
  game: GameState,
  dummyPlayerId: string,
): { state: GameState; blocked: boolean; blockerId?: string; attackerId?: string } {
  const dummy = game.players.find(player => player.id === dummyPlayerId && player.isDummy);
  if (!dummy) return { state: game, blocked: false };
  const blockers = dummy.battlefield
    .map(id => game.cards[id])
    .filter(card =>
      card &&
      card.zone === 'battlefield' &&
      card.controllerId === dummy.id &&
      !card.tapped &&
      card.definition.cardTypes.includes('Creature') &&
      card.combatRole !== 'blocker'
    );
  if (blockers.length === 0) return { state: game, blocked: false };
  const blockedAttackerIds = new Set(game.combat.blockers.map(block => block.blockedAttacker));
  const assignments = (game.combat.attackAssignments ?? [])
    .filter(assignment =>
      assignment.attackTarget.type === 'player' &&
      assignment.attackTarget.playerId === dummy.id &&
      assignment.attackerIds.some(id => !blockedAttackerIds.has(id))
    );
  if (assignments.length === 0) return { state: game, blocked: false };
  const attackerId = assignments
    .flatMap(assignment => assignment.attackerIds)
    .filter(id => !blockedAttackerIds.has(id))
    .sort((a, b) => (getEffectivePowerToughness(game.cards[b], game)?.power ?? 0) - (getEffectivePowerToughness(game.cards[a], game)?.power ?? 0))[0];
  const blockerId = blockers[0]?.instanceId;
  if (!attackerId || !blockerId) return { state: game, blocked: false };
  return { state: declareBlocker(game, blockerId, attackerId), blocked: true, blockerId, attackerId };
}

export function advanceDummyTurn(
  game: GameState,
  dummyPlayerId: string,
): GameState {
  const dummy = game.players.find(player => player.id === dummyPlayerId && player.isDummy);
  if (!dummy) return game;
  if (dummy.dummyConfig?.dummyDeckMode && dummy.dummyConfig.dummyDeckMode !== 'none') {
    return advanceDummyDeckTurn(game, dummyPlayerId);
  }
  const profile = dummy.dummyProfile ?? 'training';
  let next = game;
  const affected: string[] = [];
  const messages: string[] = [];

  if (profile === 'blocker') {
    const created = addDummyCreature(next, dummy.id, `${dummy.name} Guard`, '2', '2', 'blocker');
    next = created.state;
    affected.push(created.cardId);
    messages.push(`${dummy.name} creates a 2/2 blocker.`);
  } else if (profile === 'aggro') {
    const created = addDummyCreature(next, dummy.id, `${dummy.name} Raider`, '2', '2', 'aggro');
    next = created.state;
    affected.push(created.cardId);
    messages.push(`${dummy.name} adds aggro pressure with a 2/2 attacker.`);
    const soloTarget = next.players.find(player => !player.isDummy);
    if (soloTarget && next.activePlayerId === dummy.id && dummy.dummyConfig?.autoAttack) {
      next = declareAttacker(next, created.cardId, soloTarget.id);
      messages.push(`${dummy.name} attacks ${soloTarget.name}.`);
    }
  } else if (profile === 'value') {
    const created = addDummyCreature(next, dummy.id, `${dummy.name} Resource`, '0', '3', 'value');
    next = created.state;
    affected.push(created.cardId);
    messages.push(`${dummy.name} adds a value permanent.`);
  } else if (profile === 'combo_clock') {
    messages.push(`${dummy.name} combo clock checks turn ${game.turn}.`);
  } else {
    messages.push(`${dummy.name} takes no dummy action.`);
  }

  const actionText = profile === 'combo_clock'
    ? comboClockText(dummy, game)
    : messages.join(' ');
  const action = createAction(
    next,
    dummy.id,
    'OTHER',
    actionText,
    affected,
    { dummyAction: true, profile },
  );
  return { ...next, actionLog: [...next.actionLog, action], lastUpdatedAt: Date.now() };
}

function populateGeneratedDummyDeck(game: GameState, dummyPlayerId: string, config: DummyOpponentConfig): GameState {
  const deck = createGeneratedDummyDeck(config.profile, config.dummyDeckArchetype, config.dummyDeckPower);
  const expanded = interleaveDeckEntries(deck.cards);
  const cards = { ...game.cards };
  const definitions = { ...game.definitions };
  const libraryIds: string[] = [];
  for (let index = 0; index < expanded.length; index += 1) {
    const def = generatedDummyCardDefinition(expanded[index]);
    const card = createCardState(def, dummyPlayerId, 'library');
    cards[card.instanceId] = card;
    definitions[def.id] = def;
    libraryIds.push(card.instanceId);
  }
  const handSize = Math.min(config.startingHandSize ?? 7, libraryIds.length);
  const handIds = libraryIds.slice(0, handSize);
  const remainingLibrary = libraryIds.slice(handSize);
  for (const id of handIds) {
    cards[id] = { ...cards[id], zone: 'hand' };
  }
  return {
    ...game,
    cards,
    definitions,
    players: game.players.map(player =>
      player.id === dummyPlayerId
        ? { ...player, hand: handIds, library: remainingLibrary }
        : player
    ),
    lastUpdatedAt: Date.now(),
  };
}

function advanceDummyDeckTurn(game: GameState, dummyPlayerId: string): GameState {
  const dummy = game.players.find(player => player.id === dummyPlayerId && player.isDummy);
  if (!dummy) return game;
  let next = refreshDummyTurnStart(game, dummy.id);
  next = drawDummyCard(next, dummy.id);
  const updatedDummy = next.players.find(player => player.id === dummy.id);
  if (updatedDummy?.dummyConfig?.autoPlayLand !== false) next = playDummyLand(next, dummy.id);
  if (updatedDummy?.dummyConfig?.autoCastCreature !== false) next = castDummySpell(next, dummy.id);
  if (updatedDummy?.dummyConfig?.autoAttack) next = attackWithDummyCreatures(next, dummy.id);
  return next;
}

function refreshDummyTurnStart(game: GameState, dummyPlayerId: string): GameState {
  return {
    ...game,
    activePlayerId: dummyPlayerId,
    priorityPlayerId: dummyPlayerId,
    cards: Object.fromEntries(Object.entries(game.cards).map(([id, card]) => [
      id,
      card.controllerId === dummyPlayerId && card.zone === 'battlefield'
        ? { ...card, tapped: false, summoningSick: false }
        : card,
    ])),
    lastUpdatedAt: Date.now(),
  };
}

function drawDummyCard(game: GameState, dummyPlayerId: string): GameState {
  const dummy = game.players.find(player => player.id === dummyPlayerId);
  const cardId = dummy?.library[0];
  if (!dummy || !cardId) return game;
  const card = game.cards[cardId];
  const next: GameState = {
    ...game,
    cards: { ...game.cards, [cardId]: { ...card, zone: 'hand' } },
    players: game.players.map(player =>
      player.id === dummyPlayerId
        ? { ...player, library: player.library.slice(1), hand: [...player.hand, cardId] }
        : player
    ),
  };
  return appendDummyAction(next, dummyPlayerId, `${dummy.name} drew a card.`, [cardId], { kind: 'draw' });
}

function playDummyLand(game: GameState, dummyPlayerId: string): GameState {
  const dummy = game.players.find(player => player.id === dummyPlayerId);
  if (!dummy) return game;
  const landId = dummy.hand.find(id => game.cards[id]?.definition.cardTypes.includes('Land'));
  if (!landId) return game;
  const card = game.cards[landId];
  const next: GameState = {
    ...game,
    cards: { ...game.cards, [landId]: { ...card, zone: 'battlefield' } },
    players: game.players.map(player =>
      player.id === dummyPlayerId
        ? { ...player, hand: player.hand.filter(id => id !== landId), battlefield: [...player.battlefield, landId] }
        : player
    ),
  };
  return appendDummyAction(next, dummyPlayerId, `${dummy.name} played a land.`, [landId], { kind: 'playLand' });
}

function castDummySpell(game: GameState, dummyPlayerId: string): GameState {
  const dummy = game.players.find(player => player.id === dummyPlayerId);
  if (!dummy) return game;
  const availableMana = countDummyLands(game, dummyPlayerId);
  const spellId = dummy.hand.find(id => {
    const def = game.cards[id]?.definition;
    return def && !def.cardTypes.includes('Land') && def.cmc <= availableMana;
  });
  if (!spellId) return game;
  const card = game.cards[spellId];
  if (card.definition.name === 'Dummy Token Maker') {
    let next: GameState = {
      ...game,
      cards: { ...game.cards, [spellId]: { ...card, zone: 'graveyard' } },
      players: game.players.map(player =>
        player.id === dummyPlayerId
          ? { ...player, hand: player.hand.filter(id => id !== spellId), graveyard: [...player.graveyard, spellId] }
          : player
      ),
    };
    const tokenIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const created = addDummyCreature(next, dummyPlayerId, 'Dummy Token', '1', '1', 'token', true);
      next = created.state;
      tokenIds.push(created.cardId);
    }
    return appendDummyAction(next, dummyPlayerId, `${dummy.name} cast Dummy Token Maker and created two 1/1 tokens.`, [spellId, ...tokenIds], { kind: 'createToken' });
  }
  if (!card.definition.cardTypes.includes('Creature')) {
    const next: GameState = {
      ...game,
      cards: { ...game.cards, [spellId]: { ...card, zone: 'graveyard' } },
      players: game.players.map(player =>
        player.id === dummyPlayerId
          ? { ...player, hand: player.hand.filter(id => id !== spellId), graveyard: [...player.graveyard, spellId] }
          : player
      ),
    };
    return appendDummyAction(next, dummyPlayerId, `${dummy.name} cast ${card.definition.name}.`, [spellId], { kind: 'castPlaceholder' });
  }
  const next: GameState = {
    ...game,
    cards: { ...game.cards, [spellId]: { ...card, zone: 'battlefield', summoningSick: true } },
    players: game.players.map(player =>
      player.id === dummyPlayerId
        ? { ...player, hand: player.hand.filter(id => id !== spellId), battlefield: [...player.battlefield, spellId] }
        : player
    ),
  };
  return appendDummyAction(next, dummyPlayerId, `${dummy.name} cast ${card.definition.name}.`, [spellId], { kind: 'castCreature' });
}

function attackWithDummyCreatures(game: GameState, dummyPlayerId: string): GameState {
  const dummy = game.players.find(player => player.id === dummyPlayerId);
  const target = game.players.find(player => !player.isDummy);
  if (!dummy || !target) return game;
  const eligible = dummy.battlefield
    .map(id => game.cards[id])
    .filter(card =>
      card &&
      card.zone === 'battlefield' &&
      card.definition.cardTypes.includes('Creature') &&
      !card.tapped &&
      !card.summoningSick
    );
  const attackers = chooseDummyAttackers(game, dummy, eligible.map(card => card.instanceId));
  if (attackers.length === 0) return game;
  let next: GameState = {
    ...game,
    activePlayerId: dummy.id,
    priorityPlayerId: dummy.id,
    phase: 'declareAttackers' as const,
    combat: { ...game.combat, active: true, attackingPlayerId: dummy.id },
  };
  for (const attackerId of attackers) {
    next = declareAttacker(next, attackerId, target.id);
  }
  return appendDummyAction(next, dummy.id, `${dummy.name} attacked ${target.name} with ${attackers.length} creature${attackers.length === 1 ? '' : 's'}.`, attackers, { kind: 'attack' });
}

function chooseDummyAttackers(game: GameState, dummy: Player, eligibleIds: string[]): string[] {
  const archetype = dummy.dummyConfig?.dummyDeckArchetype ?? defaultArchetypeForProfile(dummy.dummyProfile ?? 'training');
  if (archetype === 'aggro') return eligibleIds;
  if (archetype === 'tokens') return eligibleIds;
  if (archetype === 'midrange') return eligibleIds.length > 1 ? eligibleIds.slice(0, -1) : [];
  const dummyCreatures = dummy.battlefield.filter(id => game.cards[id]?.definition.cardTypes.includes('Creature')).length;
  const solo = game.players.find(player => !player.isDummy);
  const soloCreatures = solo?.battlefield.filter(id => game.cards[id]?.definition.cardTypes.includes('Creature')).length ?? 0;
  return dummyCreatures > soloCreatures ? eligibleIds.slice(0, 1) : [];
}

function appendDummyAction(
  game: GameState,
  dummyPlayerId: string,
  description: string,
  affectedObjects: string[] = [],
  data: Record<string, unknown> = {},
): GameState {
  const action = createAction(game, dummyPlayerId, 'OTHER', description, affectedObjects, { ...data, dummyAction: true, dummyDeckAction: true });
  return { ...game, actionLog: [...game.actionLog, action], lastUpdatedAt: Date.now() };
}

function comboClockText(dummy: Player, game: GameState): string {
  const comboTurn = dummy.dummyConfig?.comboTurn ?? 6;
  if (game.turn >= comboTurn) return `${dummy.name} combo dummy wins on turn ${comboTurn}.`;
  return `${dummy.name} combo dummy wins on turn ${comboTurn}; current turn ${game.turn}.`;
}

function addDummyCreature(
  game: GameState,
  controllerId: string,
  name: string,
  power: string,
  toughness: string,
  role: string,
  summoningSick = false,
): { state: GameState; cardId: string } {
  const def: CardDefinition = {
    id: `dummy-${role}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    cmc: 0,
    typeLine: 'Token Creature - Dummy',
    superTypes: [],
    cardTypes: ['Creature'],
    subTypes: ['Dummy'],
    oracleText: 'Solo dummy practice token.',
    power,
    toughness,
    colors: [],
    colorIdentity: [],
    keywords: [],
    isDoubleFaced: false,
    legalities: {},
  };
  const card = {
    ...createCardState(def, controllerId, 'library', false, true),
    zone: 'battlefield' as const,
    summoningSick,
  };
  return {
    cardId: card.instanceId,
    state: {
      ...game,
      cards: { ...game.cards, [card.instanceId]: card },
      definitions: { ...game.definitions, [def.id]: def },
      players: game.players.map(player =>
        player.id === controllerId
          ? { ...player, battlefield: [...player.battlefield, card.instanceId] }
          : player
      ),
      lastUpdatedAt: Date.now(),
    },
  };
}

function interleaveDeckEntries(cards: Deck['cards']): string[] {
  const max = cards.reduce((highest, card) => Math.max(highest, card.count), 0);
  const result: string[] = [];
  for (let index = 0; index < max; index += 1) {
    for (const card of cards) {
      if (index < card.count) result.push(card.name);
    }
  }
  return result;
}

function generatedDummyCardDefinition(name: string): CardDefinition {
  if (name.includes('Land')) {
    return dummyDefinition(name, 0, 'Basic Land - Dummy', ['Land']);
  }
  if (name.includes('Removal')) {
    return dummyDefinition(name, 2, 'Sorcery', ['Sorcery'], undefined, undefined, 'Dummy removal placeholder.');
  }
  if (name.includes('Token Maker')) {
    return dummyDefinition(name, 2, 'Sorcery', ['Sorcery'], undefined, undefined, 'Create two 1/1 Dummy creature tokens.');
  }
  if (name.includes('0/4')) return dummyDefinition(name, 2, 'Creature - Dummy Wall', ['Creature'], '0', '4');
  if (name.includes('1/1')) return dummyDefinition(name, 1, 'Creature - Dummy', ['Creature'], '1', '1');
  if (name.includes('2/1')) return dummyDefinition(name, 1, 'Creature - Dummy', ['Creature'], '2', '1');
  if (name.includes('2/2')) return dummyDefinition(name, 2, 'Creature - Dummy', ['Creature'], '2', '2');
  if (name.includes('3/2')) return dummyDefinition(name, 2, 'Creature - Dummy', ['Creature'], '3', '2');
  if (name.includes('3/3')) return dummyDefinition(name, 3, 'Creature - Dummy', ['Creature'], '3', '3');
  if (name.includes('5/5')) return dummyDefinition(name, 5, 'Creature - Dummy', ['Creature'], '5', '5');
  return dummyDefinition(name, 4, 'Creature - Dummy', ['Creature'], '4', '4');
}

function dummyDefinition(
  name: string,
  cmc: number,
  typeLine: string,
  cardTypes: CardDefinition['cardTypes'],
  power?: string,
  toughness?: string,
  oracleText = 'Generated dummy practice card.',
): CardDefinition {
  return {
    id: `generated-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    cmc,
    typeLine,
    superTypes: typeLine.includes('Basic') ? ['Basic'] : [],
    cardTypes,
    subTypes: typeLine.includes('Dummy') ? ['Dummy'] : [],
    oracleText,
    power,
    toughness,
    colors: [],
    colorIdentity: [],
    keywords: [],
    isDoubleFaced: false,
    legalities: {},
  };
}

function countDummyLands(game: GameState, dummyPlayerId: string): number {
  const dummy = game.players.find(player => player.id === dummyPlayerId);
  return dummy?.battlefield.filter(id => game.cards[id]?.definition.cardTypes.includes('Land')).length ?? 0;
}

function defaultArchetypeForProfile(profile: DummyOpponentProfile): DummyDeckArchetype {
  if (profile === 'aggro') return 'aggro';
  if (profile === 'value') return 'midrange';
  if (profile === 'combo_clock') return 'control';
  return 'aggro';
}

function profileLabel(profile: DummyOpponentConfig['profile']): string {
  switch (profile) {
    case 'blocker': return 'Blocker Dummy';
    case 'aggro': return 'Aggro Dummy';
    case 'value': return 'Value Dummy';
    case 'combo_clock': return 'Combo Clock Dummy';
    default: return 'Training Dummy';
  }
}
