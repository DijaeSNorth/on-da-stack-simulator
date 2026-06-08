/**
 * Token creation regression checks.
 *
 * Run with: npx tsx tests/token-creation.test.ts
 */

import { getTokenDefinitionByName } from '../client/src/engine/tokenRegistry';
import { buildScryfallTokenSearchUrl, scryfallTokenToDefinition } from '../client/src/engine/scryfallTokens';
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

test('direct artifact tokens resolve as artifacts, not fake creatures', () => {
  const treasure = getTokenDefinitionByName('Treasure');
  assert(treasure !== null, 'expected Treasure local token template');
  assert(treasure.cardTypes.includes('Artifact'), 'expected Treasure to be an Artifact');
  assert(!treasure.cardTypes.includes('Creature'), 'expected Treasure not to be a Creature');
  assert(treasure.subTypes.includes('Treasure'), 'expected Treasure subtype');
});

test('create token phrasing parses as token lookup', () => {
  const parsed = parseCommand('create token Treasure');
  assert(parsed.intent === 'CREATE_TOKEN', `expected CREATE_TOKEN, got ${parsed.intent}`);
  assert(parsed.token?.lookupQuery === 'treasure', `expected lookup query treasure, got ${parsed.token?.lookupQuery}`);
  assert(parsed.token?.preferScryfall === true, 'expected Scryfall-backed lookup path');

  const generated = parseCommand('generate token Zombie');
  assert(generated.intent === 'CREATE_TOKEN', `expected CREATE_TOKEN, got ${generated.intent}`);
  assert(generated.token?.name === 'Zombie', `expected Zombie token name, got ${generated.token?.name}`);
});

test('custom power and toughness tokens stay local and preserve stats', () => {
  const parsed = parseCommand('create 3 2/2 black Zombie tokens');
  assert(parsed.intent === 'CREATE_TOKEN', `expected CREATE_TOKEN, got ${parsed.intent}`);
  assert(parsed.count === 3, `expected count 3, got ${parsed.count}`);
  assert(parsed.token?.power === 2 && parsed.token?.toughness === 2, 'expected 2/2 stats');
  assert(parsed.token?.colors.includes('B'), 'expected black color');
  assert(parsed.token?.subTypes.includes('zombie'), 'expected zombie subtype');
  assert(parsed.token?.preferScryfall === false, 'expected custom P/T token to stay local');
});

test('Scryfall token search includes extras and token filter', () => {
  const url = buildScryfallTokenSearchUrl('Zombie');
  assert(url.includes('include_extras=true'), 'expected Scryfall extras parameter for tokens');
  assert(decodeURIComponent(url).includes('is:token Zombie'), `expected is:token query, got ${url}`);
});

test('Scryfall token mapper preserves real token metadata and art', () => {
  const definition = scryfallTokenToDefinition({
    id: 'sf-zombie-token',
    oracle_id: 'oracle-zombie-token',
    name: 'Zombie Token',
    type_line: 'Token Creature - Zombie',
    oracle_text: 'This token cannot block.',
    power: '2',
    toughness: '2',
    colors: ['B'],
    color_identity: ['B'],
    keywords: ['Decayed'],
    image_uris: { normal: 'https://cards.scryfall.io/normal/front/zombie.jpg' },
  });
  assert(definition.name === 'Zombie', `expected stripped name Zombie, got ${definition.name}`);
  assert(definition.cardTypes.includes('Creature'), 'expected Creature card type');
  assert(definition.subTypes.includes('Zombie'), 'expected Zombie subtype');
  assert(definition.power === '2' && definition.toughness === '2', 'expected 2/2 stats');
  assert(definition.colors.includes('B'), 'expected black color');
  assert(definition.keywords.includes('Decayed'), 'expected keyword preservation');
  assert(definition.imageUrl?.includes('zombie.jpg') === true, 'expected image URL preservation');
});

console.log(`\nToken creation tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
