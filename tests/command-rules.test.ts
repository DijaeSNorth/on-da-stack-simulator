/**
 * Command parser / rules regression checks.
 *
 * Run with: npx tsx tests/command-rules.test.ts
 */

import { parseCommand } from '../client/src/engine/nlpParser';

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

test('mulligan command parses to the mulligan intent', () => {
  const parsed = parseCommand('mulligan');
  assert(parsed.intent === 'MULLIGAN', `expected MULLIGAN, got ${parsed.intent}`);
  const parsedWithTarget = parseCommand('player 2 take mulligan');
  assert(parsedWithTarget.intent === 'MULLIGAN', `expected targeted MULLIGAN, got ${parsedWithTarget.intent}`);
  assert(parsedWithTarget.targetPlayerIndex === 2, `expected target player 2, got ${parsedWithTarget.targetPlayerIndex}`);
});

test('tutor command resolves with and without player target', () => {
  const parsed = parseCommand('tutor black lotus');
  assert(parsed.intent === 'TUTOR', `expected TUTOR, got ${parsed.intent}`);
  assert(parsed.cardName === 'Black Lotus', `expected card name Black Lotus, got ${parsed.cardName}`);
  const targeted = parseCommand('player 1 find black lotus');
  assert(targeted.intent === 'TUTOR', `expected TUTOR for player-specific tutor, got ${targeted.intent}`);
  assert(targeted.targetPlayerIndex === 1, `expected target player 1, got ${targeted.targetPlayerIndex}`);
});

test('dredge command parses as DREDGE intent', () => {
  const parsed = parseCommand('dredge stinkweed imp');
  assert(parsed.intent === 'DREDGE', `expected DREDGE, got ${parsed.intent}`);
  assert(parsed.cardName === 'Stinkweed Imp', `expected card name Stinkweed Imp, got ${parsed.cardName}`);
});

test('token commands include create count and lookup hints', () => {
  const parsed = parseCommand('create 3 zombie tokens');
  assert(parsed.intent === 'CREATE_TOKEN', `expected CREATE_TOKEN, got ${parsed.intent}`);
  assert(parsed.count === 3, `expected 3 tokens, got ${parsed.count}`);
  assert(parsed.token?.name === 'Zombie', `expected Zombie token, got ${parsed.token?.name}`);
  assert(parsed.token?.preferScryfall === true, 'expected Scryfall lookup path');
});

test('mana commands parse add / spend / clear variants', () => {
  const parsedAdd = parseCommand('add mana 2w 1r');
  assert(parsedAdd.intent === 'ADD_MANA', `expected ADD_MANA, got ${parsedAdd.intent}`);
  assert(parsedAdd.mana?.W === 2 && parsedAdd.mana?.R === 1, `expected 2W1R, got W=${parsedAdd.mana?.W} R=${parsedAdd.mana?.R}`);
  const parsedSpend = parseCommand('spend 3G');
  assert(parsedSpend.intent === 'SPEND_MANA', `expected SPEND_MANA, got ${parsedSpend.intent}`);
  assert(parsedSpend.mana?.G === 3, `expected 3G, got ${parsedSpend.mana?.G}`);
  const parsedClear = parseCommand('clear player 2 mana');
  assert(parsedClear.intent === 'CLEAR_MANA', `expected CLEAR_MANA, got ${parsedClear.intent}`);
  assert(parsedClear.targetPlayerIndex === 2, `expected target player 2, got ${parsedClear.targetPlayerIndex}`);
});

test('counter command parsing supports add, remove, and remove-all patterns', () => {
  const addCounter = parseCommand('add 2 +1/+1 counters on goblin guide');
  assert(addCounter.intent === 'ADD_COUNTER', `expected ADD_COUNTER, got ${addCounter.intent}`);
  assert(addCounter.counterType === '+1/+1', `expected +1/+1, got ${addCounter.counterType}`);
  assert(addCounter.counterAmount === 2, `expected amount 2, got ${addCounter.counterAmount}`);
  assert(addCounter.cardName === 'Goblin Guide', `expected Goblin Guide, got ${addCounter.cardName}`);

  const removeCounter = parseCommand('remove 1 -1/-1 counter from golem');
  assert(removeCounter.intent === 'REMOVE_COUNTER', `expected REMOVE_COUNTER, got ${removeCounter.intent}`);
  assert(removeCounter.counterType === '-1/-1', `expected -1/-1, got ${removeCounter.counterType}`);
  assert(removeCounter.counterAmount === 1, `expected amount 1, got ${removeCounter.counterAmount}`);

  const removeAllCounters = parseCommand('remove all counters from goblin guide');
  assert(removeAllCounters.intent === 'REMOVE_ALL_COUNTERS', `expected REMOVE_ALL_COUNTERS, got ${removeAllCounters.intent}`);
  assert(!removeAllCounters.counterType, `expected no specific counter type for global all-counters, got ${removeAllCounters.counterType}`);

  const removeAllOfType = parseCommand('remove all loyalty counters from goblin guide');
  assert(removeAllOfType.intent === 'REMOVE_ALL_COUNTERS', `expected REMOVE_ALL_COUNTERS with typed clear, got ${removeAllOfType.intent}`);
  assert(removeAllOfType.counterType === 'loyalty', `expected loyalty type, got ${removeAllOfType.counterType}`);
});

test('combat declaration commands parse explicit attack and block language', () => {
  const declareSingleAttack = parseCommand('declare goblin guide attacking player 2');
  assert(declareSingleAttack.intent === 'ATTACK', `expected ATTACK, got ${declareSingleAttack.intent}`);
  assert(declareSingleAttack.cardName === 'Goblin Guide', `expected Goblin Guide, got ${declareSingleAttack.cardName}`);
  assert(declareSingleAttack.targetPlayerIndex === 2, `expected target player 2, got ${declareSingleAttack.targetPlayerIndex}`);

  const declareMultiAttack = parseCommand('declare attackers with goblin guide, mayhem devil against player 3');
  assert(declareMultiAttack.intent === 'MULTI_ATTACK', `expected MULTI_ATTACK, got ${declareMultiAttack.intent}`);
  assert(declareMultiAttack.cardNames?.length === 2, `expected 2 attackers, got ${declareMultiAttack.cardNames?.length}`);
  assert(declareMultiAttack.targetPlayerIndex === 3, `expected target player 3, got ${declareMultiAttack.targetPlayerIndex}`);

  const declareSingleBlock = parseCommand('declare llanowar elves blocking goblin guide');
  assert(declareSingleBlock.intent === 'BLOCK', `expected BLOCK, got ${declareSingleBlock.intent}`);
  assert(declareSingleBlock.cardName === 'Llanowar Elves', `expected Llanowar Elves, got ${declareSingleBlock.cardName}`);
  assert(declareSingleBlock.targetName === 'Goblin Guide', `expected target Goblin Guide, got ${declareSingleBlock.targetName}`);

  const declareMultiBlock = parseCommand('declare blockers with llanowar elves, wall of blossoms on goblin guide');
  assert(declareMultiBlock.intent === 'MULTI_BLOCK', `expected MULTI_BLOCK, got ${declareMultiBlock.intent}`);
  assert(declareMultiBlock.cardName === 'Goblin Guide', `expected attacker Goblin Guide, got ${declareMultiBlock.cardName}`);
  assert(declareMultiBlock.cardNames?.length === 2, `expected 2 blockers, got ${declareMultiBlock.cardNames?.length}`);
});

console.log(`\nCommand-rules tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
