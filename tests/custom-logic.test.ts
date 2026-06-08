/**
 * custom-logic.test.ts
 *
 * Regression coverage for imported deck logic:
 *   1. JSON custom logic is parsed into Deck.logicFile shape
 *   2. Line-format custom logic supports notes, triggers, replacements, rules
 *   3. Custom ETB and attack triggers are detected by the assistant engine
 *   4. Custom replacement/rule metadata becomes active modifier warnings
 */

import { detectDeckUrl, fetchDecklistFromUrl, parseDeckLogicFile } from '../client/src/engine/deckImport';
import {
  detectAttackTriggers,
  detectCastTriggers,
  detectCombatDamageTriggers,
  detectETBTriggers,
  detectUpkeepTriggers,
  getActiveModifiers,
} from '../client/src/engine/assistantEngine';
import { createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import type { CardDefinition, CardState, GameState } from '../client/src/types/game';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function makeDef(overrides: Partial<CardDefinition> & { name: string }): CardDefinition {
  return {
    id: overrides.name.toLowerCase().replace(/\s+/g, '-'),
    name: overrides.name,
    cmc: 0,
    typeLine: 'Creature',
    superTypes: [],
    cardTypes: ['Creature'],
    subTypes: [],
    oracleText: '',
    colors: [],
    colorIdentity: [],
    keywords: [],
    isDoubleFaced: false,
    legalities: {},
    ...overrides,
  };
}

function makeCard(def: CardDefinition, zone: CardState['zone'] = 'battlefield'): CardState {
  return {
    instanceId: `inst-${def.id}`,
    definitionId: def.id,
    definition: def,
    zone,
    ownerId: 'p1',
    controllerId: 'p1',
    tapped: false,
    faceDown: false,
    transformed: false,
    phased: false,
    counters: [],
    attachments: [],
    markedForDamage: 0,
    summoningSick: false,
    token: false,
    copy: false,
    notes: '',
    exilePermanent: false,
    combatRole: 'none',
    combatDamageAssigned: 0,
  };
}

function makeState(cards: CardState[]): GameState {
  const config = createDefaultGameConfig(2);
  const p1 = createPlayer('p1', 'Player 1', 0, '#ef4444', config);
  const p2 = createPlayer('p2', 'Player 2', 1, '#3b82f6', config);
  return {
    ...createEmptyGameState(config),
    players: [
      { ...p1, battlefield: cards.filter(c => c.controllerId === 'p1' && c.zone === 'battlefield').map(c => c.instanceId) },
      p2,
    ],
    cards: Object.fromEntries(cards.map(c => [c.instanceId, c])),
    definitions: Object.fromEntries(cards.map(c => [c.definitionId, c.definition])),
    activePlayerId: 'p1',
    priorityPlayerId: 'p1',
  };
}

console.log('=== Custom logic parser ===');
{
  const result = parseDeckLogicFile(JSON.stringify({
    cardNotes: { 'Omnath, Locus of Creation': 'Track landfall count.' },
    triggers: [
      { sourceCard: 'Omnath, Locus of Creation', event: 'whenever this enters', effect: 'draw a card' },
    ],
    replacementEffects: [
      { sourceCard: 'Rest in Peace', replaces: 'card would go to graveyard', replacement: 'exile it instead' },
    ],
    rules: [
      { name: 'Table Rule', effect: 'Treasures enter tapped.', enabled: true },
    ],
    customCards: [
      { name: 'Stack Lab Adept', typeLine: 'Creature - Human Wizard', oracleText: 'Whenever you cast your second spell each turn, copy target triggered ability.', power: '2', toughness: '3' },
    ],
  }), 'deck-1');

  assert(result.errors.length === 0, `Expected no parser errors, got ${result.errors.join(', ')}`);
  assert(result.logicFile?.triggers.length === 1, 'Expected one custom trigger');
  assert(result.logicFile?.replacementEffects.length === 1, 'Expected one replacement effect');
  assert(result.logicFile?.rules.length === 1, 'Expected one custom rule');
  assert(result.logicFile?.customCards[0].name === 'Stack Lab Adept', 'Expected one custom card');
  assert(result.logicFile?.cardNotes['Omnath, Locus of Creation'] === 'Track landfall count.', 'Expected card note');
}

console.log('=== Custom logic line format ===');
{
  const result = parseDeckLogicFile([
    'note: Custom Commander = Track copied spells.',
    'card: Stack Lab Adept | Creature - Human Wizard | Whenever you copy a spell, investigate. | 2/3',
    'trigger: Custom Commander | attacks | create a tapped Treasure | Attack trigger reminder',
    'replacement: Custom Commander | would die | return it to command zone',
    'rule: Copy Watch | spell | Copies are not cast',
  ].join('\n'), 'deck-2');

  assert(result.errors.length === 0, 'Line format should not produce parser errors');
  assert(result.logicFile?.customCards[0].power === '2', 'Expected custom card power from line format');
  assert(result.logicFile?.triggers[0].event === 'attacks', 'Expected attack trigger event');
  assert(result.logicFile?.cardNotes['Custom Commander'] === 'Track copied spells.', 'Expected line note');
}

console.log('=== Vial-style cast trigger detection ===');
{
  const vial = makeCard(makeDef({
    name: 'Vial Smasher the Fierce',
    oracleText: 'Whenever you cast your first spell each turn, choose an opponent at random. Vial Smasher the Fierce deals damage equal to that spell\'s mana value to that player or a planeswalker that player controls.',
    cmc: 3,
  }));
  const spell = makeCard(makeDef({
    name: 'Treasure Cruise',
    typeLine: 'Sorcery',
    cardTypes: ['Sorcery'],
    oracleText: 'Draw three cards.',
    cmc: 8,
  }), 'stack');
  const state = makeState([vial, spell]);

  const firstSpellTriggers = detectCastTriggers(state, 'p1', spell, 1);
  assert(firstSpellTriggers.length === 1, 'Expected Vial to trigger on first spell');
  assert(firstSpellTriggers[0].triggerType === 'cast', 'Expected cast trigger type');
  assert(firstSpellTriggers[0].effect?.kind === 'vialSmasherDamage', 'Expected Vial shortcut effect metadata');
  assert(firstSpellTriggers[0].effect?.manaValue === 8, 'Expected Vial damage to use spell mana value');

  const secondSpellTriggers = detectCastTriggers(state, 'p1', spell, 2);
  assert(secondSpellTriggers.length === 0, 'Expected Vial not to trigger on second spell in same turn');
}

console.log('=== Difficult cast trigger reminder patterns ===');
{
  const rhystic = makeCard(makeDef({
    name: 'Rhystic Study',
    typeLine: 'Enchantment',
    cardTypes: ['Enchantment'],
    oracleText: 'Whenever an opponent casts a spell, you may draw a card unless that player pays {1}.',
    cmc: 3,
  }));
  const remora = makeCard(makeDef({
    name: 'Mystic Remora',
    typeLine: 'Enchantment',
    cardTypes: ['Enchantment'],
    oracleText: 'Whenever an opponent casts a noncreature spell, you may draw a card unless that player pays {4}.',
    cmc: 1,
  }));
  const talrand = makeCard(makeDef({
    name: 'Talrand, Sky Summoner',
    oracleText: 'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    cmc: 4,
  }));
  const stormKiln = makeCard(makeDef({
    name: 'Storm-Kiln Artist',
    oracleText: 'Magecraft - Whenever you cast or copy an instant or sorcery spell, create a Treasure token.',
    cmc: 4,
  }));
  const swiftspear = makeCard(makeDef({
    name: 'Monastery Swiftspear',
    oracleText: 'Haste\nProwess (Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.)',
    cmc: 1,
  }));
  const joriEn = makeCard(makeDef({
    name: 'Jori En, Ruin Diver',
    oracleText: 'Whenever you cast your second spell each turn, draw a card.',
    cmc: 3,
  }));
  const ledger = makeCard(makeDef({
    name: 'Ledger Shredder',
    oracleText: 'Flying\nWhenever a player casts their second spell each turn, Ledger Shredder connives.',
    cmc: 2,
  }));
  const opponentInstant = {
    ...makeCard(makeDef({
      name: 'Counterspell',
      typeLine: 'Instant',
      cardTypes: ['Instant'],
      oracleText: 'Counter target spell.',
      cmc: 2,
    }), 'stack'),
    ownerId: 'p2',
    controllerId: 'p2',
  };
  const ownInstant = makeCard(makeDef({
    name: 'Opt',
    typeLine: 'Instant',
    cardTypes: ['Instant'],
    oracleText: 'Scry 1. Draw a card.',
    cmc: 1,
  }), 'stack');
  const ownCreature = makeCard(makeDef({
    name: 'Goblin Electromancer',
    oracleText: 'Instant and sorcery spells you cast cost {1} less to cast.',
    cmc: 2,
  }), 'stack');
  const state = makeState([rhystic, remora, talrand, stormKiln, swiftspear, joriEn, ledger, opponentInstant, ownInstant, ownCreature]);

  const opponentTriggers = detectCastTriggers(state, 'p2', opponentInstant, 1).map(t => t.sourceCard.definition.name);
  assert(opponentTriggers.includes('Rhystic Study'), 'Expected Rhystic Study to see opponent cast');
  assert(opponentTriggers.includes('Mystic Remora'), 'Expected Mystic Remora to see opponent noncreature cast');
  assert(!opponentTriggers.includes('Talrand, Sky Summoner'), 'Talrand should not trigger from opponent cast');
  assert(!opponentTriggers.includes('Ledger Shredder'), 'Ledger Shredder should wait for a player\'s second spell');

  const opponentSecondTriggers = detectCastTriggers(state, 'p2', opponentInstant, 2).map(t => t.sourceCard.definition.name);
  assert(opponentSecondTriggers.includes('Ledger Shredder'), 'Expected Ledger Shredder to see an opponent\'s second spell');

  const ownInstantTriggers = detectCastTriggers(state, 'p1', ownInstant, 1).map(t => t.sourceCard.definition.name);
  assert(ownInstantTriggers.includes('Talrand, Sky Summoner'), 'Expected Talrand to see own instant');
  assert(ownInstantTriggers.includes('Storm-Kiln Artist'), 'Expected Storm-Kiln Artist to see own instant');
  assert(ownInstantTriggers.includes('Monastery Swiftspear'), 'Expected prowess to see own noncreature spell');
  assert(!ownInstantTriggers.includes('Rhystic Study'), 'Rhystic should not trigger from controller cast');
  assert(!ownInstantTriggers.includes('Jori En, Ruin Diver'), 'Jori En should wait for your second spell');
  assert(!ownInstantTriggers.includes('Ledger Shredder'), 'Ledger Shredder should wait for the second spell');

  const ownSecondTriggers = detectCastTriggers(state, 'p1', ownInstant, 2).map(t => t.sourceCard.definition.name);
  assert(ownSecondTriggers.includes('Jori En, Ruin Diver'), 'Expected Jori En to see your second spell');
  assert(ownSecondTriggers.includes('Ledger Shredder'), 'Expected Ledger Shredder to see your second spell');

  const ownCreatureTriggers = detectCastTriggers(state, 'p1', ownCreature, 1).map(t => t.sourceCard.definition.name);
  assert(!ownCreatureTriggers.includes('Talrand, Sky Summoner'), 'Talrand should ignore creature spells');
  assert(!ownCreatureTriggers.includes('Storm-Kiln Artist'), 'Storm-Kiln should ignore creature spells');
  assert(!ownCreatureTriggers.includes('Monastery Swiftspear'), 'Prowess should ignore creature spells');
}

console.log('=== Custom trigger detection ===');
{
  const entrant = makeCard(makeDef({
    name: 'Custom Commander',
    oracleText: '',
    customTriggers: [
      { id: 'custom-etb', sourceCard: 'Custom Commander', event: 'enters the battlefield', effect: 'scry 1', reminderText: 'Custom Commander ETB: scry 1.' },
      { id: 'custom-attack', sourceCard: 'Custom Commander', event: 'attacks', effect: 'make a Treasure', reminderText: 'Custom Commander attacks: make a Treasure.' },
    ],
  }));
  const state = makeState([entrant]);

  const etb = detectETBTriggers(state, entrant);
  assert(etb.some(t => t.triggerText.includes('scry 1')), 'Expected custom ETB trigger');

  const attack = detectAttackTriggers(state, entrant);
  assert(attack.some(t => t.triggerText.includes('make a Treasure')), 'Expected custom attack trigger');
}

console.log('=== Double-faced card active-face trigger detection ===');
{
  const etali = makeCard(makeDef({
    name: 'Etali, Primal Conqueror // Etali, Primal Sickness',
    typeLine: 'Legendary Creature - Elder Dinosaur',
    cardTypes: ['Creature'],
    oracleText: 'When Etali, Primal Conqueror enters, each player exiles cards until they exile a nonland card.\n---\nWhenever Etali, Primal Sickness deals combat damage to a player, they get that many poison counters.',
    isDoubleFaced: true,
    power: '7',
    toughness: '7',
    faces: [
      {
        name: 'Etali, Primal Conqueror',
        typeLine: 'Legendary Creature - Elder Dinosaur',
        superTypes: ['Legendary'],
        cardTypes: ['Creature'],
        subTypes: ['Elder', 'Dinosaur'],
        oracleText: 'Trample\nWhen Etali, Primal Conqueror enters, each player exiles cards from the top of their library until they exile a nonland card. You may cast any number of spells from among the nonland cards exiled this way without paying their mana costs.',
        power: '7',
        toughness: '7',
        colors: ['R'],
        keywords: ['Trample'],
      },
      {
        name: 'Etali, Primal Sickness',
        typeLine: 'Legendary Creature - Phyrexian Elder Dinosaur',
        superTypes: ['Legendary'],
        cardTypes: ['Creature'],
        subTypes: ['Phyrexian', 'Elder', 'Dinosaur'],
        oracleText: 'Trample, indestructible\nWhenever Etali, Primal Sickness deals combat damage to a player, they get that many poison counters.',
        power: '11',
        toughness: '11',
        colors: ['G', 'R'],
        keywords: ['Trample', 'Indestructible'],
      },
    ],
  }));
  const state = makeState([etali]);
  const frontEtb = detectETBTriggers(state, etali);
  assert(frontEtb.length === 1 && frontEtb[0].triggerText.includes('exiles cards'), 'Expected Etali front-face ETB trigger');

  const transformedEtali = { ...etali, transformed: true };
  const transformedState = makeState([transformedEtali]);
  const transformedEtb = detectETBTriggers(transformedState, transformedEtali);
  assert(transformedEtb.length === 0, 'Back face should not reuse front-face ETB text');
  const damageTriggers = detectCombatDamageTriggers(transformedState, transformedEtali, 'p2', 11);
  assert(damageTriggers.length === 1, 'Expected transformed Etali combat damage trigger');
  assert(damageTriggers[0].sourceCard.definition.name.includes('Etali'), 'Expected trigger to keep source card reference');
  assert(damageTriggers[0].effect?.kind === 'poisonFromCombatDamage', 'Expected Etali poison shortcut metadata');
  assert(damageTriggers[0].effect?.amount === 11, 'Expected poison amount to match combat damage');
}

console.log('=== Landfall and upkeep land trigger detection ===');
{
  const field = makeCard(makeDef({
    name: 'Field of the Dead',
    typeLine: 'Land',
    cardTypes: ['Land'],
    oracleText: 'Field of the Dead enters the battlefield tapped.\nWhenever Field of the Dead or another land enters the battlefield under your control, if you control seven or more lands with different names, create a 2/2 black Zombie creature token.',
    cmc: 0,
  }));
  const lands = ['Island', 'Swamp', 'Mountain', 'Forest', 'Plains', 'Command Tower'].map(name => makeCard(makeDef({
    name,
    typeLine: 'Land',
    cardTypes: ['Land'],
    oracleText: '',
  })));
  const stateWithSixNames = makeState([field, ...lands.slice(0, 5)]);
  assert(detectETBTriggers(stateWithSixNames, field).length === 0, 'Field should wait for seven different land names');

  const stateWithSevenNames = makeState([field, ...lands]);
  const fieldTriggers = detectETBTriggers(stateWithSevenNames, field);
  assert(fieldTriggers.length === 1, 'Expected Field trigger at seven different land names');
  assert(fieldTriggers[0].effect?.kind === 'createToken', 'Expected Field trigger to expose token shortcut metadata');

  const glacial = makeCard(makeDef({
    name: 'Glacial Chasm',
    typeLine: 'Land',
    cardTypes: ['Land'],
    oracleText: 'Cumulative upkeep—Pay 2 life.\nWhen this land enters, sacrifice a land.\nCreatures you control can\'t attack.\nPrevent all damage that would be dealt to you.',
  }));
  const glacialState = makeState([glacial]);
  assert(detectETBTriggers(glacialState, glacial).some(t => t.triggerText.includes('sacrifice a land')), 'Expected Glacial Chasm ETB sacrifice reminder');
  assert(detectUpkeepTriggers(glacialState, 'p1').some(t => t.triggerText.includes('cumulative upkeep')), 'Expected Glacial Chasm cumulative upkeep reminder');
  const modifiers = getActiveModifiers(glacialState).map(flag => flag.text);
  assert(modifiers.some(text => text.includes("can't attack")), 'Expected Glacial Chasm attack restriction modifier');
  assert(modifiers.some(text => text.includes('prevent all damage')), 'Expected Glacial Chasm damage prevention modifier');
}

console.log('=== Custom modifier detection ===');
{
  const card = makeCard(makeDef({
    name: 'House Rule Engine',
    customRules: [
      { id: 'rule-1', name: 'Tapped Treasure', description: '', applies: 'all', effect: 'Treasures enter tapped.', enabled: true },
    ],
    replacementEffects: [
      { id: 'replace-1', sourceCard: 'House Rule Engine', replaces: 'tokens would die', replacement: 'exile them instead' },
    ],
  }));
  const flags = getActiveModifiers(makeState([card]));
  assert(flags.some(f => f.text.includes('Tapped Treasure')), 'Expected custom rule modifier flag');
  assert(flags.some(f => f.text.includes('tokens would die')), 'Expected replacement modifier flag');
}

console.log('=== Deck URL detection and import adapters ===');
{
  assert(detectDeckUrl('https://www.moxfield.com/decks/abc123')?.source === 'moxfield', 'Expected Moxfield URL detection');
  assert(detectDeckUrl('https://archidekt.com/decks/123456/example')?.id === '123456', 'Expected Archidekt deck id detection');
  assert(detectDeckUrl('https://www.mtggoldfish.com/deck/7443928#paper')?.source === 'mtggoldfish', 'Expected MTGGoldfish URL detection');
  assert(detectDeckUrl('https://tappedout.net/mtg-decks/sample-deck/')?.source === 'tappedout', 'Expected TappedOut URL detection');

  const originalFetch = globalThis.fetch;
  const fetchedTargets: string[] = [];
  const archidektPayload = {
    name: 'Archidekt Practice',
    cards: [
      { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Muldrotha, the Gravetide' } } },
      { quantity: 1, categories: ['Ramp'], card: { oracleCard: { name: 'Command Tower' } } },
    ],
  };
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const target = String(url);
    fetchedTargets.push(target);
    if (target.includes('api2.moxfield.com')) {
      return new Response(JSON.stringify({
        name: 'Moxfield Practice',
        commanders: {
          commander: { quantity: 1, card: { name: 'Atraxa, Praetors\' Voice' } },
        },
        mainboard: {
          sol: { quantity: 1, card: { name: 'Sol Ring' } },
        },
        sideboard: {},
        maybeboard: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (target === 'https://archidekt.com/api/decks/123456/') {
      throw new TypeError('Failed to fetch');
    }
    if (target.includes('api.allorigins.win') && decodeURIComponent(target).includes('https://archidekt.com/api/decks/123456/')) {
      return new Response(JSON.stringify(archidektPayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Deck\n1 Lightning Bolt\nSideboard\n1 Pyroblast', { status: 200 });
  }) as typeof fetch;

  const moxfield = await fetchDecklistFromUrl('https://www.moxfield.com/decks/abc123');
  assert(moxfield.name === 'Moxfield Practice', 'Expected Moxfield deck name');
  assert(moxfield.text.includes('Commander'), 'Expected Moxfield commander section');
  assert(moxfield.text.includes('1 Sol Ring'), 'Expected Moxfield mainboard card');

  const archidekt = await fetchDecklistFromUrl('https://archidekt.com/decks/123456/example');
  assert(archidekt.text.includes('1 Muldrotha, the Gravetide'), 'Expected Archidekt commander card');
  assert(archidekt.text.includes('1 Command Tower'), 'Expected Archidekt main card');
  assert(fetchedTargets.includes('https://archidekt.com/api/decks/123456/'), 'Expected full Archidekt endpoint, not small metadata endpoint');
  assert(!fetchedTargets.some(target => target.includes('/small/')), 'Archidekt import should not use the small endpoint');

  const goldfish = await fetchDecklistFromUrl('https://www.mtggoldfish.com/deck/7443928');
  assert(goldfish.text.includes('1 Lightning Bolt'), 'Expected text-export deck card');

  globalThis.fetch = originalFetch;
}

console.log('Custom logic tests passed.');
