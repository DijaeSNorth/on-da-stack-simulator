/**
 * custom-logic.test.ts
 *
 * Regression coverage for imported deck logic:
 *   1. JSON custom logic is parsed into Deck.logicFile shape
 *   2. Line-format custom logic supports notes, triggers, replacements, rules
 *   3. Custom ETB and attack triggers are detected by the assistant engine
 *   4. Custom replacement/rule metadata becomes active modifier warnings
 */

import { parseDeckLogicFile } from '../client/src/engine/deckImport';
import {
  detectAttackTriggers,
  detectETBTriggers,
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

console.log('Custom logic tests passed.');
