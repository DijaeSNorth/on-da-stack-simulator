/**
 * Deck import regression checks.
 *
 * Run with: npx tsx tests/deck-import.test.ts
 */

import { importDecklist } from '../client/src/engine/deckImport';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mockScryfallCard(name: string): Record<string, unknown> {
  const legendary = [
    'Vial Smasher the Fierce',
    'Sakashima of a Thousand Faces',
    'Lutri, the Spellchaser',
  ].includes(name);
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    oracle_id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-oracle`,
    name,
    mana_cost: legendary ? '{1}{U/R}{B}' : '{1}',
    cmc: legendary ? 3 : 1,
    type_line: legendary ? 'Legendary Creature — Test' : typeLineFor(name),
    oracle_text: '',
    colors: legendary ? ['U', 'B', 'R'] : [],
    color_identity: legendary ? ['U', 'B', 'R'] : [],
    keywords: [],
    legalities: { commander: 'legal' },
  };
}

function typeLineFor(name: string): string {
  if (/command tower|island|swamp|mountain/i.test(name)) return 'Land';
  if (/lightning bolt|counterspell|pyroblast/i.test(name)) return 'Instant';
  if (/harmonic prodigy/i.test(name)) return 'Creature — Human Wizard';
  return 'Artifact';
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const target = String(url);
  if (target.includes('/cards/collection')) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { identifiers?: { name?: string }[] };
    const names = (body.identifiers ?? []).map(item => item.name).filter((name): name is string => Boolean(name));
    return new Response(JSON.stringify({ data: names.map(mockScryfallCard) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

try {
  {
    const result = await importDecklist([
      'Commander',
      '1 Vial Smasher the Fierce',
      '1 Sakashima of a Thousand Faces',
      '',
      'Main Deck',
      '1 Sol Ring',
      '1 Lightning Bolt',
      '1 Command Tower',
      '',
      'Sideboard',
      '1 Pyroblast',
    ].join('\n'), 'Vial Test');

    assert(result.deck.commanders.join('|') === 'Vial Smasher the Fierce|Sakashima of a Thousand Faces', 'expected only the two commander entries to be commanders');
    assert(!result.deck.commanders.includes('Sol Ring'), 'expected Main Deck header to stop commander parsing');
    assert(!result.deck.commanders.includes('Lightning Bolt'), 'expected main spells not to become commanders');
    assert(result.deck.cards.some(card => card.name === 'Sol Ring'), 'expected main card to import into deck cards');
    assert(result.deck.sideboard.some(card => card.name === 'Pyroblast'), 'expected sideboard card to import into sideboard');
  }

  {
    const result = await importDecklist([
      'Commanders:',
      '1 Vial Smasher the Fierce',
      '1 Sakashima of a Thousand Faces',
      '',
      'Creatures (1)',
      '1 Harmonic Prodigy',
      '',
      'Lands (1)',
      '1 Command Tower',
    ].join('\n'), 'Category Header Test');

    assert(result.deck.commanders.length === 2, 'expected plural commander header to import partner commanders');
    assert(!result.deck.commanders.includes('Harmonic Prodigy'), 'expected category headers after commanders to reset to main deck');
    assert(result.deck.cards.some(card => card.name === 'Harmonic Prodigy'), 'expected category card to stay in main deck');
  }

  {
    const result = await importDecklist([
      'Commander',
      '1 Vial Smasher the Fierce',
      '1 Sakashima of a Thousand Faces',
      '1 Sol Ring',
      '1 Lightning Bolt',
    ].join('\n'), 'Commander Clamp Test');

    assert(result.deck.commanders.length === 2, 'expected imported commanders to be clamped at two');
    assert(result.warnings.some(warning => warning.includes('Commander section contained 4 unique cards')), 'expected warning when commander section has too many cards');
    assert(result.deck.cards.some(card => card.name === 'Lightning Bolt'), 'expected extra commander-section cards to remain in deck cards');
  }

  {
    const result = await importDecklist([
      'Companion',
      '1 Lutri, the Spellchaser',
      '',
      'Deck',
      '1 Island',
    ].join('\n'), 'Companion Test');

    assert(result.deck.commanders.length === 0, 'expected Companion section not to create a commander');
    assert(result.deck.sideboard.some(card => card.name === 'Lutri, the Spellchaser'), 'expected companion to import outside the main deck');
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS deck imports keep commander sections bounded and recognize main deck headers');
