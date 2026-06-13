/**
 * Zone drawer UI model checks.
 *
 * Run with: npx tsx tests/zone-drawer-ui.test.ts
 */

import {
  LARGE_ZONE_THRESHOLD,
  buildZoneDrawerView,
  canViewZoneCards,
  getExilePermissionLabels,
  getZoneCardIds,
  groupZoneCards,
  sortZoneCards,
} from '../client/src/components/zones/zoneDrawerModel';
import { createCardState, createDefaultGameConfig, createPlayer } from '../client/src/engine/gameEngine';
import type { CardDefinition, CardState, Player } from '../client/src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}

const baseDef: CardDefinition = {
  id: 'base-zone-card',
  name: 'Base Zone Card',
  cmc: 0,
  typeLine: 'Creature - Test',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Test'],
  oracleText: '',
  colors: [],
  colorIdentity: [],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '1',
  toughness: '1',
};

function makeCard(definition: Partial<CardDefinition>, state: Partial<CardState> = {}): CardState {
  const card = createCardState({
    ...baseDef,
    ...definition,
    id: definition.id ?? definition.name ?? baseDef.id,
  }, state.ownerId ?? 'p1', state.zone ?? 'graveyard', state.tapped ?? false, state.token ?? false);
  return { ...card, ...state, definition: { ...card.definition, ...definition } };
}

function makePlayer(overrides: Partial<Player>): Player {
  return { ...createPlayer('p1', 'Player 1', 0, '#3b82f6', createDefaultGameConfig(2)), ...overrides };
}

const lightningBolt = makeCard({
  id: 'lightning-bolt-zone',
  name: 'Lightning Bolt',
  cmc: 1,
  typeLine: 'Instant',
  cardTypes: ['Instant'],
  subTypes: [],
  oracleText: 'Lightning Bolt deals 3 damage to any target.',
  colors: ['R'],
  colorIdentity: ['R'],
  power: undefined,
  toughness: undefined,
});

const island = makeCard({
  id: 'island-zone',
  name: 'Island',
  cmc: 0,
  typeLine: 'Basic Land - Island',
  superTypes: ['Basic'],
  cardTypes: ['Land'],
  subTypes: ['Island'],
  oracleText: 'Tap: Add U.',
  colors: [],
  colorIdentity: ['U'],
  power: undefined,
  toughness: undefined,
});

const bear = makeCard({
  id: 'bear-zone',
  name: 'Rune Bear',
  cmc: 2,
  typeLine: 'Creature - Bear',
  cardTypes: ['Creature'],
  subTypes: ['Bear'],
  oracleText: 'A reliable body.',
  colors: ['G'],
  colorIdentity: ['G'],
  power: '2',
  toughness: '2',
});

test('Graveyard search works', () => {
  const view = buildZoneDrawerView([lightningBolt, island, bear], {
    search: 'lightning instant',
    sortMode: 'order',
    groupMode: 'none',
    canViewCards: true,
  });
  assert(view.visibleCards.length === 1, `expected 1 result, got ${view.visibleCards.length}`);
  assert(view.visibleCards[0].instanceId === lightningBolt.instanceId, 'expected Lightning Bolt to match name/type search');
});

test('Exile shows Airbend/Warp permission labels', () => {
  const airbend = makeCard({ name: 'Lifted Adept', oracleText: 'Airbend this creature.' }, {
    zone: 'exile',
    exilePermission: { ownerId: 'p1', sourceMechanic: 'airbend', alternativeCost: '{2}', timing: 'normal', expires: 'endOfTurn', createdAtTurn: 1 },
  });
  const warp = makeCard({ name: 'Temporal Visitor', oracleText: 'Warp {1}{U}' }, {
    zone: 'exile',
    exilePermission: { ownerId: 'p1', sourceMechanic: 'warp', alternativeCost: '{1}{U}', timing: 'normal', expires: 'nextEndStep', createdAtTurn: 1 },
  });
  assert(getExilePermissionLabels(airbend).some(label => label.includes('Airbend')), 'expected Airbend label');
  assert(getExilePermissionLabels(airbend).some(label => label.includes('{2}')), 'expected alternative cost label');
  assert(getExilePermissionLabels(warp).some(label => label.includes('Warp')), 'expected Warp label');
});

test('Opponent library only shows count', () => {
  const canView = canViewZoneCards({
    zone: 'library',
    playerId: 'p2',
    localPlayerId: 'p1',
    multiplayerStatus: 'host',
    judgeMode: false,
  });
  const view = buildZoneDrawerView([lightningBolt], { canViewCards: canView, totalCount: 62 });
  assert(!canView, 'expected opponent library to be hidden');
  assert(view.visibleCards.length === 0, 'expected no visible private cards');
  assert(view.hiddenMessage === 'Hidden private zone - 62 cards', 'expected count-only hidden message');
});

test('Owner library can be browsed if allowed by simulator mode', () => {
  const canView = canViewZoneCards({
    zone: 'library',
    playerId: 'p2',
    localPlayerId: 'p2',
    multiplayerStatus: 'joined',
    judgeMode: false,
    privateView: true,
    viewerId: 'p2',
  });
  const view = buildZoneDrawerView([island, bear], { canViewCards: canView, totalCount: 2 });
  assert(canView, 'expected owner to view own library drawer');
  assert(view.visibleCards.length === 2, 'expected owner-visible library cards');
});

test('Sorting and grouping work', () => {
  const sorted = sortZoneCards([bear, lightningBolt, island], 'manaValue');
  assert(sorted[0].instanceId === island.instanceId, 'expected zero-mana land first');
  assert(sorted[2].instanceId === bear.instanceId, 'expected two-mana creature last');

  const groups = groupZoneCards([bear, lightningBolt, island], 'cardType');
  assert(groups.some(group => group.key === 'Creature' && group.cards.length === 1), 'expected creature group');
  assert(groups.some(group => group.key === 'Land' && group.cards.length === 1), 'expected land group');
});

test('Large zone compact display does not crash', () => {
  const cards = Array.from({ length: LARGE_ZONE_THRESHOLD + 1 }, (_, index) => makeCard({
    id: `large-zone-${index}`,
    name: `Large Zone Card ${index}`,
  }));
  const view = buildZoneDrawerView(cards, { canViewCards: true, totalCount: cards.length });
  assert(view.displayMode === 'compact', 'expected compact display for large zone');
  assert(view.visibleCards.length === cards.length, 'expected all large-zone cards visible');
});

test('Command zone card ids are public drawer candidates', () => {
  const player = makePlayer({ commandZone: ['cmd-1', 'cmd-2'] });
  assert(getZoneCardIds(player, 'command').length === 2, 'expected command zone ids');
});

console.log(`\nZone drawer UI tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
