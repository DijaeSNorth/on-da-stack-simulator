/**
 * Rules registry regression checks.
 *
 * Run with: npx tsx tests/rules-registry.test.ts
 */

import { buildStartedGame } from '../client/src/store/gameStore';
import { createDefaultGameConfig, createEmptyGameState } from '../client/src/engine/gameEngine';
import { DEFAULT_RULESET_VERSION, defaultRuleset } from '../client/src/rules/defaultRuleset';
import { buildFirebaseRuleset } from '../client/src/rules/firebaseRulesetSync';
import { createRulesRegistry, mergeRulesets } from '../client/src/rules/mechanicsRegistry';

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

test('default registry includes Avatar mechanics', () => {
  const registry = createRulesRegistry(defaultRuleset);
  for (const id of ['firebending', 'airbend', 'waterbend', 'earthbend']) {
    assert(registry.getMechanic(id).id === id, `expected ${id} in default registry`);
  }
});

test('unknown Firebase handler ID is ignored safely', () => {
  const remote = buildFirebaseRuleset('remote-9999', {
    publishedAt: defaultRuleset.publishedAt + 1,
    mechanics: {
      firebending: {
        ...defaultRuleset.mechanics.firebending,
        engineHandler: 'firebase.injectedHandler.v1',
        automationLevel: 'supported',
      },
    },
  });
  const merged = mergeRulesets(defaultRuleset, remote);
  const mechanic = createRulesRegistry(merged).getMechanic('firebending');
  assert(mechanic.engineHandler === undefined, 'expected unknown handler ID to be stripped');
  assert(!mechanic.executable, 'expected stripped handler not to be executable');
  assert(mechanic.automationLevel === 'manual_prompt', 'expected unknown handler to downgrade to manual_prompt');
});

test('Firebase metadata can update UI hint text', () => {
  const remote = buildFirebaseRuleset('remote-10000', {
    publishedAt: defaultRuleset.publishedAt + 2,
    mechanics: {
      waterbend: {
        ...defaultRuleset.mechanics.waterbend,
        ui: {
          ...defaultRuleset.mechanics.waterbend.ui,
          reminder: 'Updated Firebase waterbend hint.',
        },
      },
    },
  });
  const registry = createRulesRegistry(mergeRulesets(defaultRuleset, remote));
  assert(registry.getUiHint('waterbend') === 'Updated Firebase waterbend hint.', 'expected Firebase hint override');
});

test('Firebending definition maps to handler ID', () => {
  const firebending = createRulesRegistry(defaultRuleset).getMechanic('firebending');
  assert(firebending.engineHandler === 'firebending.attackMana.v1', 'expected firebending handler ID');
  assert(firebending.executable, 'expected firebending handler to be locally registered');
});

test('Lesson is metadata_only', () => {
  const lesson = createRulesRegistry(defaultRuleset).getMechanic('lesson');
  assert(lesson.automationLevel === 'metadata_only', 'expected Lesson to be metadata_only');
});

test('Clue token definition exists', () => {
  assert(Boolean(defaultRuleset.tokens.clue), 'expected Clue token definition');
  assert(defaultRuleset.mechanics.clue.engineHandler === 'clue.activatedDraw.v1', 'expected Clue handler mapping');
});

test('Game stores rulesetVersion at start', () => {
  const started = buildStartedGame(createEmptyGameState(createDefaultGameConfig(2)));
  assert(started.rulesetVersion === DEFAULT_RULESET_VERSION, `expected ${DEFAULT_RULESET_VERSION}, got ${started.rulesetVersion}`);
});

test('Unknown mechanic shows manual_prompt instead of crashing', () => {
  const unknown = createRulesRegistry(defaultRuleset).getMechanic('future-keyword');
  assert(unknown.id === 'future-keyword', 'expected requested unknown mechanic id');
  assert(unknown.automationLevel === 'manual_prompt', 'expected manual_prompt fallback');
  assert(!unknown.executable, 'expected unknown mechanic to be non-executable');
});

console.log(`\nRules registry tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
