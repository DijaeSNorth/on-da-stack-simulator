/**
 * Mechanic metadata hint checks.
 *
 * Run with: npx tsx tests/mechanic-hints.test.ts
 */

import type { CardDefinition, CardState } from '../client/src/types/game';
import { createCardState } from '../client/src/engine/gameEngine';
import { defaultRuleset } from '../client/src/rules/defaultRuleset';
import { buildFirebaseRuleset } from '../client/src/rules/firebaseRulesetSync';
import {
  getMechanicBadgesForCard,
  getMechanicHint,
  getMechanicsForCard,
  mergeRulesets,
} from '../client/src/rules/mechanicsRegistry';

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
  id: 'test-card',
  name: 'Test Card',
  cmc: 2,
  typeLine: 'Creature - Human Monk',
  superTypes: [],
  cardTypes: ['Creature'],
  subTypes: ['Human', 'Monk'],
  oracleText: '',
  colors: ['R'],
  colorIdentity: ['R'],
  keywords: [],
  isDoubleFaced: false,
  legalities: {},
  power: '2',
  toughness: '2',
};

function card(def: Partial<CardDefinition>): CardState {
  return createCardState({ ...baseDef, ...def }, 'p1', 'hand');
}

test('Firebending card returns Firebending mechanic', () => {
  const fire = card({ name: 'Fire Nation Striker', oracleText: 'Firebending 1' });
  assert(getMechanicsForCard(fire).some(mechanic => mechanic.id === 'firebending'), 'expected firebending mechanic');
});

test('Lesson subtype returns Lesson metadata', () => {
  const lesson = card({
    name: 'Tactical Lesson',
    typeLine: 'Sorcery - Lesson',
    cardTypes: ['Sorcery'],
    subTypes: ['Lesson'],
    colors: ['U'],
    colorIdentity: ['U'],
  });
  const mechanic = getMechanicsForCard(lesson).find(entry => entry.id === 'lesson');
  assert(mechanic?.automationLevel === 'metadata_only', 'expected Lesson metadata_only mechanic');
});

test('Unknown handler returns Manual badge/hint', () => {
  const remote = buildFirebaseRuleset('remote-hints-1', {
    publishedAt: defaultRuleset.publishedAt + 1,
    mechanics: {
      firebending: {
        ...defaultRuleset.mechanics.firebending,
        engineHandler: 'firebase.unknown.v1',
        ui: { reminder: 'Remote manual firebending hint.' },
      },
    },
  });
  const ruleset = mergeRulesets(defaultRuleset, remote);
  const fire = card({ oracleText: 'Firebending 1' });
  const badge = getMechanicBadgesForCard(fire, ruleset).find(entry => entry.id === 'firebending');
  assert(badge?.manual === true, 'expected manual badge for unknown handler');
  assert(getMechanicHint('firebending', 'manual_prompt', ruleset).includes('Remote manual'), 'expected remote manual hint');
});

test('Firebase-updated hint text can be surfaced', () => {
  const remote = buildFirebaseRuleset('remote-hints-2', {
    publishedAt: defaultRuleset.publishedAt + 2,
    mechanics: {
      waterbend: {
        ...defaultRuleset.mechanics.waterbend,
        ui: { reminder: 'Firebase says tap eligible objects for Waterbend.' },
      },
    },
  });
  const ruleset = mergeRulesets(defaultRuleset, remote);
  assert(
    getMechanicHint('waterbend', 'manual_prompt', ruleset) === 'Firebase says tap eligible objects for Waterbend.',
    'expected Firebase hint to surface',
  );
});

test('Context changes the preferred hint', () => {
  const generic = getMechanicHint('waterbend', 'manual_prompt');
  const payment = getMechanicHint('waterbend', 'cost_payment');
  assert(generic !== payment, 'expected context-specific hint to differ');
  assert(payment.includes('tapped'), 'expected cost-payment hint to mention tapped payment objects');
});

console.log(`\nMechanic hint tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
