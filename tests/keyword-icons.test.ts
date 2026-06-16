/**
 * Keyword/mechanic icon checks.
 *
 * Run with: npx tsx tests/keyword-icons.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CardDefinition, CardState } from '../client/src/types/game';
import { createCardState } from '../client/src/engine/gameEngine';
import { CardPreview } from '../client/src/components/cards/CardPreview';
import { KeywordBadge } from '../client/src/components/icons/KeywordBadge';
import {
  getCardSurfaceKeywordIconIds,
  getKeywordIconIdsForCard,
  getKeywordIconIdsForCards,
  getMechanicIconId,
  resolveKeywordIconId,
} from '../client/src/components/icons/keywordIconRegistry';

let passed = 0;
let failed = 0;

const storage: Record<string, string> = {};
(globalThis as typeof globalThis & { localStorage: Storage }).localStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { for (const key of Object.keys(storage)) delete storage[key]; },
  key: (index: number) => Object.keys(storage)[index] ?? null,
  get length() { return Object.keys(storage).length; },
} as Storage;

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
  id: 'keyword-icon-card',
  name: 'Keyword Icon Creature',
  cmc: 2,
  typeLine: 'Creature - Test',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Test'],
  oracleText: '',
  colors: ['G'],
  colorIdentity: ['G'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '2',
  toughness: '2',
};

function card(def: Partial<CardDefinition>, state: Partial<CardState> = {}): CardState {
  return { ...createCardState({ ...baseDef, ...def }, 'p1', 'hand'), ...state };
}

test('deathtouch maps to deathtouch icon', () => {
  assert(resolveKeywordIconId('Deathtouch') === 'deathtouch', 'expected deathtouch alias');
  assert(getKeywordIconIdsForCard(card({ keywords: ['Deathtouch'] })).includes('deathtouch'), 'expected deathtouch icon');
});

test('double strike maps to double_strike icon', () => {
  assert(getKeywordIconIdsForCard(card({ keywords: ['Double Strike'] })).includes('double_strike'), 'expected double strike icon');
});

test('first strike maps to first_strike icon', () => {
  assert(getKeywordIconIdsForCard(card({ keywords: ['First Strike'] })).includes('first_strike'), 'expected first strike icon');
});

test('menace maps to menace icon', () => {
  assert(getKeywordIconIdsForCard(card({ keywords: ['Menace'] })).includes('menace'), 'expected menace icon');
});

test('card with multiple keywords returns multiple unique icons', () => {
  const ids = getKeywordIconIdsForCard(card({ keywords: ['Flying', 'Flying', 'Vigilance', 'Trample'] }));
  assert(ids.includes('flying') && ids.includes('vigilance') && ids.includes('trample'), 'expected multiple keyword icons');
  assert(new Set(ids).size === ids.length, 'expected unique icons');
});

test('oracle text fallback detects keyword if keyword list is missing', () => {
  const ids = getKeywordIconIdsForCard(card({ oracleText: 'Flying, vigilance, and haste.' }));
  assert(ids.includes('flying'), 'expected flying from oracle text');
  assert(ids.includes('vigilance'), 'expected vigilance from oracle text');
  assert(ids.includes('haste'), 'expected haste from oracle text');
});

test('mechanic metadata maps Firebending to firebending icon', () => {
  const ids = getKeywordIconIdsForCard(card({ oracleText: 'Firebending 2' }));
  assert(ids.includes('firebending'), 'expected firebending icon');
});

test('unknown mechanic maps to manual icon fallback', () => {
  assert(getMechanicIconId('not-a-real-mechanic') === 'manual', 'expected unknown mechanic fallback to manual');
});

test('KeywordBadge renders accessible label and title', () => {
  const html = renderToStaticMarkup(React.createElement(KeywordBadge, { id: 'deathtouch', labelMode: 'icon' }));
  assert(html.includes('aria-label='), 'expected aria-label');
  assert(html.includes('<title>Deathtouch</title>'), 'expected svg title');
});

test('showMechanicBadges false hides icons on card surface', () => {
  const surfaceIds = getCardSurfaceKeywordIconIds(card({ keywords: ['Flying'] }), false, 'normal');
  assert(surfaceIds.length === 0, 'expected no compact card-surface icons');
});

test('CardPreview still shows full keyword details', () => {
  const previewCard = card({ keywords: ['Trample'], oracleText: 'Trample' });
  const html = renderToStaticMarkup(React.createElement(CardPreview, { card: previewCard }));
  assert(html.includes('Trample'), 'expected preview keyword label');
  assert(html.includes('Excess combat damage'), 'expected preview keyword description');
});

test('Token stack with shared keywords reports shared icons', () => {
  const tokens = [
    card({ name: 'Soldier Token', typeLine: 'Token Creature - Soldier', keywords: ['First Strike'] }, { token: true }),
    card({ name: 'Soldier Token', typeLine: 'Token Creature - Soldier', keywords: ['First Strike'] }, { token: true }),
  ];
  const result = getKeywordIconIdsForCards(tokens);
  assert(result.shared.includes('first_strike'), 'expected shared first strike icon');
  assert(result.mixed.length === 0, 'expected no mixed icons');
});

test('Mixed token stack reports mixed keyword icons', () => {
  const tokens = [
    card({ name: 'Goblin Token', typeLine: 'Token Creature - Goblin', keywords: ['Haste'] }, { token: true }),
    card({ name: 'Goblin Token', typeLine: 'Token Creature - Goblin', keywords: ['Menace'] }, { token: true }),
  ];
  const result = getKeywordIconIdsForCards(tokens);
  assert(result.shared.length === 0, 'expected no shared icons');
  assert(result.mixed.includes('haste') && result.mixed.includes('menace'), 'expected mixed icons');
});

test('Redacted cards do not expose hidden card names through icon labels', () => {
  const hidden = card({ name: 'Secret Bomb', keywords: ['Flying'], oracleText: 'Flying' }, { faceDown: true });
  const labels = getKeywordIconIdsForCard(hidden).join(' ');
  assert(!labels.includes('Secret Bomb'), 'expected icon ids to omit card names');
});

console.log(`\nKeyword icon tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
