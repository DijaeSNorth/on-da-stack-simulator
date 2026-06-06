/**
 * Extensive solo + multiplayer playthrough with two difficult interaction decks.
 *
 * Run with: npx tsx tests/difficult-playthrough.test.ts
 */

import { useGameStore } from '../client/src/store/gameStore';
import { importDecklist } from '../client/src/engine/deckImport';
import { createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import { createReplay } from '../client/src/engine/replayEngine';
import type { CardDefinition, Deck, GameState, ManaColor } from '../client/src/types/game';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeScryfallCard(name: string): Record<string, unknown> {
  const lower = name.toLowerCase();
  const typeLine = typeLineFor(name);
  const colors = colorsFor(name);
  const powerToughness = powerToughnessFor(name);
  return {
    id: lower.replace(/[^a-z0-9]+/g, '-'),
    oracle_id: `${lower.replace(/[^a-z0-9]+/g, '-')}-oracle`,
    name,
    mana_cost: manaCostFor(name),
    cmc: cmcFor(name),
    type_line: typeLine,
    oracle_text: oracleTextFor(name),
    colors,
    color_identity: colors,
    keywords: keywordsFor(name),
    legalities: { commander: 'legal' },
    ...powerToughness,
  };
}

function typeLineFor(name: string): string {
  if (['Vial Smasher the Fierce', 'Sakashima of a Thousand Faces', 'Muldrotha, the Gravetide'].includes(name)) return 'Legendary Creature - Test Commander';
  if (['Harmonic Prodigy', 'Guttersnipe', 'Storm-Kiln Artist', 'Stack Lab Adept', 'Stitcher\'s Supplier', 'Tireless Provisioner', 'Evolution Sage', 'Blighted Agent', 'Satyr Wayfinder'].includes(name)) return 'Creature - Test';
  if (['Sol Ring', 'Arcane Signet', 'Dimir Signet', 'Mesmeric Orb'].includes(name)) return 'Artifact';
  if (['Rhystic Study', 'Thousand-Year Storm', 'Inexorable Tide', 'Pernicious Deed'].includes(name)) return 'Enchantment';
  if (['Command Tower', 'Exotic Orchard', 'Opulent Palace', 'Crumbling Necropolis', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(name)) return 'Land';
  if (['Ponder', 'Faithless Looting', 'Life from the Loam', 'Cultivate'].includes(name)) return 'Sorcery';
  return 'Instant';
}

function colorsFor(name: string): ManaColor[] {
  if (['Vial Smasher the Fierce', 'Sakashima of a Thousand Faces'].includes(name)) return ['U', 'B', 'R'];
  if (['Muldrotha, the Gravetide'].includes(name)) return ['U', 'B', 'G'];
  if (['Lightning Bolt', 'Chaos Warp', 'Faithless Looting', 'Guttersnipe', 'Storm-Kiln Artist'].includes(name)) return ['R'];
  if (['Counterspell', 'Ponder', 'Rhystic Study', 'Sakashima of a Thousand Faces'].includes(name)) return ['U'];
  if (['Darkblast', 'Stitcher\'s Supplier', 'Pernicious Deed'].includes(name)) return ['B'];
  if (['Life from the Loam', 'Cultivate', 'Tireless Provisioner', 'Evolution Sage'].includes(name)) return ['G'];
  if (name === 'Blighted Agent') return ['U'];
  return [];
}

function manaCostFor(name: string): string {
  if (name === 'Lightning Bolt') return '{R}';
  if (name === 'Counterspell') return '{U}{U}';
  if (name === 'Darkblast') return '{B}';
  if (name === 'Life from the Loam') return '{1}{G}';
  if (name === 'Vial Smasher the Fierce') return '{1}{B}{R}';
  if (name === 'Sakashima of a Thousand Faces') return '{3}{U}';
  if (name === 'Muldrotha, the Gravetide') return '{3}{B}{G}{U}';
  if (['Sol Ring', 'Arcane Signet'].includes(name)) return '{1}';
  return '{2}';
}

function cmcFor(name: string): number {
  if (name === 'Lightning Bolt' || name === 'Darkblast' || name === 'Sol Ring') return 1;
  if (name === 'Counterspell' || name === 'Life from the Loam') return 2;
  if (name === 'Vial Smasher the Fierce') return 3;
  if (name === 'Sakashima of a Thousand Faces') return 4;
  if (name === 'Muldrotha, the Gravetide') return 6;
  return 2;
}

function oracleTextFor(name: string): string {
  const text: Record<string, string> = {
    'Vial Smasher the Fierce': 'Whenever you cast your first spell each turn, choose an opponent at random. Vial Smasher deals damage equal to that spell\'s mana value to that player or a planeswalker they control. Partner',
    'Sakashima of a Thousand Faces': 'You may have Sakashima enter as a copy of another creature you control, except it has Sakashima\'s other abilities. Partner',
    'Harmonic Prodigy': 'If an ability of a Shaman or another Wizard you control triggers, that ability triggers an additional time.',
    'Guttersnipe': 'Whenever you cast an instant or sorcery spell, Guttersnipe deals 2 damage to each opponent.',
    'Stack Lab Adept': 'Whenever Stack Lab Adept enters the battlefield, copy target spell you control.',
    'Stitcher\'s Supplier': 'When Stitcher\'s Supplier enters the battlefield or dies, mill three cards.',
    'Muldrotha, the Gravetide': 'During each of your turns, you may play a permanent card of each permanent type from your graveyard.',
    'Darkblast': 'Target creature gets -1/-1 until end of turn. Dredge 3',
    'Life from the Loam': 'Return up to three target land cards from your graveyard to your hand. Dredge 3',
    'Evolution Sage': 'Whenever a land enters the battlefield under your control, proliferate.',
    'Inexorable Tide': 'Whenever you cast a spell, proliferate.',
    'Blighted Agent': 'Infect. Blighted Agent cannot be blocked.',
    'Lightning Bolt': 'Lightning Bolt deals 3 damage to any target.',
    'Counterspell': 'Counter target spell.',
  };
  return text[name] ?? '';
}

function keywordsFor(name: string): string[] {
  if (name === 'Blighted Agent') return ['Infect'];
  if (['Vial Smasher the Fierce', 'Sakashima of a Thousand Faces'].includes(name)) return ['Partner'];
  return [];
}

function powerToughnessFor(name: string): Partial<Record<'power' | 'toughness', string>> {
  const stats: Record<string, [string, string]> = {
    'Vial Smasher the Fierce': ['2', '3'],
    'Sakashima of a Thousand Faces': ['3', '1'],
    'Muldrotha, the Gravetide': ['6', '6'],
    'Harmonic Prodigy': ['1', '3'],
    'Guttersnipe': ['2', '2'],
    'Stack Lab Adept': ['2', '3'],
    'Stitcher\'s Supplier': ['1', '1'],
    'Tireless Provisioner': ['3', '2'],
    'Evolution Sage': ['3', '2'],
    'Blighted Agent': ['1', '1'],
    'Satyr Wayfinder': ['1', '1'],
  };
  const found = stats[name];
  return found ? { power: found[0], toughness: found[1] } : {};
}

function mockScryfall(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.includes('/cards/collection')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { identifiers?: { name?: string }[] };
      const names = (body.identifiers ?? []).map(item => item.name).filter((name): name is string => Boolean(name));
      return new Response(JSON.stringify({ data: names.map(makeScryfallCard), not_found: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (target.includes('/cards/named')) {
      const name = new URL(target).searchParams.get('fuzzy') ?? 'Unknown Card';
      return new Response(JSON.stringify(makeScryfallCard(name)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

function makeDeckList(commanders: string[], cards: string[]): string {
  return [
    'Commander',
    ...commanders.map(name => `1 ${name}`),
    '',
    'Deck',
    ...cards,
  ].join('\n');
}

const stackDeckText = makeDeckList(
  ['Vial Smasher the Fierce', 'Sakashima of a Thousand Faces'],
  [
    '1 Sol Ring',
    '1 Arcane Signet',
    '1 Dimir Signet',
    '1 Harmonic Prodigy',
    '1 Guttersnipe',
    '1 Storm-Kiln Artist',
    '1 Stack Lab Adept',
    '1 Thousand-Year Storm',
    '1 Rhystic Study',
    '1 Lightning Bolt',
    '1 Counterspell',
    '1 Chaos Warp',
    '1 Ponder',
    '1 Faithless Looting',
    '1 Command Tower',
    '1 Exotic Orchard',
    '1 Crumbling Necropolis',
    '28 Island',
    '26 Swamp',
    '27 Mountain',
  ],
);

const stackDeckLogic = [
  'note: Vial Smasher the Fierce = Track first spell each turn and missed random-damage triggers.',
  'card: Stack Lab Adept | Creature - Human Wizard | Whenever Stack Lab Adept enters the battlefield, copy target spell you control. | 2/3',
  'trigger: Stack Lab Adept | enters the battlefield | copy target spell you control | ETB: copy target spell on stack.',
  'trigger: Stack Lab Adept | attacks | scry 1, then copy the next instant or sorcery you cast this turn | Attack trigger practice.',
  'rule: Stack Timing Coach | instant | Ask whether opponents get priority before resolution.',
].join('\n');

const graveyardDeckText = makeDeckList(
  ['Muldrotha, the Gravetide'],
  [
    '1 Sol Ring',
    '1 Arcane Signet',
    '1 Mesmeric Orb',
    '1 Stitcher\'s Supplier',
    '1 Satyr Wayfinder',
    '1 Tireless Provisioner',
    '1 Evolution Sage',
    '1 Blighted Agent',
    '1 Inexorable Tide',
    '1 Pernicious Deed',
    '1 Darkblast',
    '1 Life from the Loam',
    '1 Cultivate',
    '1 Command Tower',
    '1 Exotic Orchard',
    '1 Opulent Palace',
    '27 Island',
    '27 Swamp',
    '29 Forest',
  ],
);

const graveyardDeckLogic = [
  'note: Muldrotha, the Gravetide = Track one permanent of each type cast from graveyard each turn.',
  'trigger: Evolution Sage | land enters | proliferate | Landfall proliferate reminder.',
  'replacement: Muldrotha, the Gravetide | draw a card | may replace draw with dredge if a dredge card is in graveyard',
].join('\n');

async function importPracticeDecks(): Promise<{ stackDeck: Deck; graveyardDeck: Deck }> {
  const stack = await importDecklist(stackDeckText, 'Stack Lab Vial / Sakashima', 'playtest', 'p1', stackDeckLogic, { allowBannedCards: true });
  const graveyard = await importDecklist(graveyardDeckText, 'Muldrotha Dredge Proliferate', 'playtest', 'p2', graveyardDeckLogic, { allowBannedCards: true });

  assert(stack.errors.length === 0, `stack deck import errors: ${stack.errors.join('; ')}`);
  assert(graveyard.errors.length === 0, `graveyard deck import errors: ${graveyard.errors.join('; ')}`);
  assert(stack.cardCount === 100, `expected stack deck to import 100 cards, got ${stack.cardCount}`);
  assert(graveyard.cardCount === 100, `expected graveyard deck to import 100 cards, got ${graveyard.cardCount}`);
  assert(stack.deck.commanders.length === 2, 'expected stack deck to keep two partner commanders');
  assert(graveyard.deck.commanders.length === 1, 'expected graveyard deck to keep one commander');
  return { stackDeck: stack.deck, graveyardDeck: graveyard.deck };
}

function setupStore(game: GameState, localPlayerId = game.players[0]?.id ?? ''): void {
  useGameStore.setState(state => ({
    ...state,
    game,
    localPlayerId,
    ui: {
      ...state.ui,
      screen: 'game',
      lobbyOpen: false,
      assistantMessages: [],
      rightPanelOpen: true,
      rightPanelTab: 'stack',
      combatMode: false,
      zoneDrawer: null,
    },
    multiplayer: {
      ...state.multiplayer,
      status: 'disconnected',
      isHost: false,
      peers: {},
      roomCode: null,
    },
  }));
}

async function loadTwoPlayerGame(stackDeck: Deck, graveyardDeck: Deck): Promise<void> {
  const config = createDefaultGameConfig(2);
  const p1 = createPlayer('p1', 'Stack Pilot', 0, '#ef4444', config);
  const p2 = createPlayer('p2', 'Graveyard Pilot', 1, '#22c55e', config);
  setupStore({
    ...createEmptyGameState(config),
    players: [p1, p2],
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
  });
  await useGameStore.getState().loadDeck('p1', stackDeck);
  await useGameStore.getState().loadDeck('p2', graveyardDeck);
}

function findCardId(playerId: string, name: string, zones: Array<'library' | 'hand' | 'battlefield' | 'graveyard' | 'command'> = ['library', 'hand', 'battlefield', 'graveyard', 'command']): string {
  const { game } = useGameStore.getState();
  const card = Object.values(game.cards).find(item =>
    item.ownerId === playerId &&
    item.definition.name === name &&
    zones.includes(item.zone as any)
  );
  assert(card, `expected to find ${name} for ${playerId} in ${zones.join(', ')}`);
  return card.instanceId;
}

function moveToHand(playerId: string, name: string): string {
  const id = findCardId(playerId, name);
  useGameStore.getState().moveCardToZone(id, 'hand', playerId);
  return id;
}

function moveToBattlefield(playerId: string, name: string): string {
  const id = findCardId(playerId, name);
  useGameStore.getState().moveCardToZone(id, 'battlefield', playerId);
  return id;
}

function moveToGraveyard(playerId: string, name: string): string {
  const id = findCardId(playerId, name);
  useGameStore.getState().moveCardToZone(id, 'graveyard', playerId);
  return id;
}

async function multiplayerPlaythrough(stackDeck: Deck, graveyardDeck: Deck): Promise<void> {
  await loadTwoPlayerGame(stackDeck, graveyardDeck);
  const store = useGameStore.getState();
  store.startGame();

  assert(useGameStore.getState().game.players.every(player => player.hand.length === 7), 'expected multiplayer start to draw opening hands for both players');
  assert(useGameStore.getState().ui.rightPanelTab === 'stack', 'expected stack panel to be the default during play');

  const vialId = findCardId('p1', 'Vial Smasher the Fierce', ['command']);
  useGameStore.getState().castCard('p1', vialId);
  assert(useGameStore.getState().game.stack[0]?.sourceName === 'Vial Smasher the Fierce', 'expected commander spell on stack');
  useGameStore.getState().resolveStack();
  assert(useGameStore.getState().game.cards[vialId].zone === 'battlefield', 'expected Vial Smasher to resolve as a battlefield permanent');

  const boltId = moveToHand('p1', 'Lightning Bolt');
  useGameStore.getState().castCard('p1', boltId, { ids: ['p2'], labels: ['Graveyard Pilot'] });
  const boltStack = useGameStore.getState().game.stack[0];
  assert(boltStack?.sourceName === 'Lightning Bolt', 'expected Lightning Bolt on stack before resolution');
  assert(boltStack.targetLabels?.includes('Graveyard Pilot'), 'expected stack spell to preserve target labels');
  useGameStore.getState().passPriority();
  assert(useGameStore.getState().game.priorityPlayerId === 'p2', 'expected priority to pass to player 2 in multiplayer');
  useGameStore.getState().resolveStack();
  assert(useGameStore.getState().game.cards[boltId].zone === 'graveyard', 'expected resolved instant to move to graveyard');

  const labId = moveToHand('p1', 'Stack Lab Adept');
  useGameStore.getState().castCard('p1', labId);
  useGameStore.getState().resolveStack();
  assert(useGameStore.getState().game.triggerQueue.some(trigger => trigger.sourceName === 'Stack Lab Adept'), 'expected custom ETB trigger to enter the trigger queue');

  useGameStore.getState().scryCards('p1', 2);
  const drawer = useGameStore.getState().ui.zoneDrawer;
  assert(drawer?.mode === 'scry' && drawer.limit === 2 && drawer.private, 'expected scry to open a private two-card scoped view');
  assert(useGameStore.getState().game.actionLog.some(action => action.actionType === 'SCRY'), 'expected scry action in replay timeline');

  const agentId = moveToBattlefield('p2', 'Blighted Agent');
  useGameStore.getState().addPoisonCounter('p1', 1);
  useGameStore.getState().addCounterToCard(agentId, '+1/+1', 1);
  useGameStore.getState().proliferate('p2', { cardIds: [agentId], playerIds: ['p1'] });
  const afterProliferate = useGameStore.getState().game;
  assert(afterProliferate.players.find(player => player.id === 'p1')?.poisonCounters === 2, 'expected proliferate to add one poison counter');
  assert(afterProliferate.cards[agentId].counters.find(counter => counter.type === '+1/+1')?.count === 2, 'expected proliferate to add one +1/+1 counter');

  const replay = createReplay(useGameStore.getState().game, 'Difficult Multiplayer Playthrough');
  const descriptions = replay.actionLog.map(action => action.description).join('\n');
  assert(descriptions.includes('Lightning Bolt'), 'expected replay to include targeted spell action');
  assert(descriptions.includes('Scry 2'), 'expected replay to include scry action');
  assert(replay.actionLog.some(action => action.actionType === 'PROLIFERATE'), 'expected replay to include proliferate action');
  assert(replay.meta.actionCount === useGameStore.getState().game.actionLog.length, 'expected replay metadata to match action log length');
}

async function soloPracticePlaythrough(stackDeck: Deck, graveyardDeck: Deck): Promise<void> {
  const config = createDefaultGameConfig(1);
  const solo = createPlayer('solo', 'Solo Tester', 0, '#3b82f6', config);
  setupStore({
    ...createEmptyGameState(config),
    players: [solo],
    activePlayerId: 'solo',
    priorityPlayerId: 'solo',
    config,
  }, 'solo');

  await useGameStore.getState().loadDeck('solo', graveyardDeck);
  useGameStore.getState().startGame();
  useGameStore.getState().addPracticeDummy();
  const dummy = useGameStore.getState().game.players.find(player => player.id.startsWith('practice-dummy-'));
  assert(dummy, 'expected solo mode to create a practice dummy');
  assert(dummy.battlefield.length === 2, 'expected practice dummy to create two dummy creatures');

  const darkblastId = moveToGraveyard('solo', 'Darkblast');
  const beforeDredge = useGameStore.getState().game.players.find(player => player.id === 'solo')!;
  const dredged = useGameStore.getState().dredgeCard('solo', darkblastId);
  const afterDredge = useGameStore.getState().game.players.find(player => player.id === 'solo')!;
  assert(dredged, 'expected Darkblast dredge to succeed');
  assert(afterDredge.hand.includes(darkblastId), 'expected dredged Darkblast to return to hand');
  assert(afterDredge.graveyard.length >= beforeDredge.graveyard.length + 2, 'expected dredge 3 to mill cards while moving Darkblast to hand');

  useGameStore.getState().scryCards('solo', 3);
  assert(useGameStore.getState().ui.zoneDrawer?.limit === 3, 'expected solo scry to view exactly three cards');

  const attackerId = moveToBattlefield('solo', 'Blighted Agent');
  useGameStore.getState().enterCombat();
  useGameStore.getState().declareAttack(attackerId, dummy.id);
  assert(useGameStore.getState().game.cards[attackerId].attackTarget === dummy.id, 'expected solo attacker to point at the dummy target');
  useGameStore.getState().advanceTurn();
  assert(useGameStore.getState().game.cards[attackerId].combatRole === 'none', 'expected combat role to clear after advancing turn');
  assert(useGameStore.getState().game.combat.attackers.length === 0, 'expected combat attacker assignments to clear after turn advance');

  await useGameStore.getState().loadDeck('solo', stackDeck);
  const loaded = useGameStore.getState().game.players.find(player => player.id === 'solo')!;
  assert(loaded.commanders.length === 2, 'expected solo deck swap to load both partner commanders');
  assert(loaded.commandZone.length === 2, 'expected solo deck swap to put partners in command zone');
}

const restoreFetch = mockScryfall();
try {
  const { stackDeck, graveyardDeck } = await importPracticeDecks();
  await multiplayerPlaythrough(stackDeck, graveyardDeck);
  await soloPracticePlaythrough(stackDeck, graveyardDeck);
} finally {
  restoreFetch();
}

console.log('PASS difficult multiplayer and solo playthroughs with stack/custom/dredge/proliferate interactions');
