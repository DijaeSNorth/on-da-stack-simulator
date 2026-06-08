/**
 * Deck import regression checks.
 *
 * Run with: npx tsx tests/deck-import.test.ts
 */

import { importDecklist, normalizeCommanderDeck, parseDeckFilePayload } from '../client/src/engine/deckImport';
import { createDefaultGameConfig, createEmptyGameState, createPlayer, loadDeckIntoPlayer } from '../client/src/engine/gameEngine';
import type { Deck } from '../client/src/types/game';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mockScryfallCard(name: string): Record<string, unknown> {
  const legendary = [
    'Vial Smasher the Fierce',
    'Sakashima of a Thousand Faces',
    'Lutri, the Spellchaser',
  ].includes(name);
  const commanderBanned = ['Chaos Orb', 'Dockside Extortionist'].includes(name);
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
    legalities: { commander: commanderBanned ? 'banned' : 'legal' },
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
    const fuzzyOnly = new Set(['Birgi, God of Storytelling', 'Expansion // Explosion']);
    const foundNames = names.filter(name => !fuzzyOnly.has(name));
    const notFound = names.filter(name => fuzzyOnly.has(name)).map(name => ({ name }));
    return new Response(JSON.stringify({ data: foundNames.map(mockScryfallCard), not_found: notFound }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (target.includes('/cards/named')) {
    const fuzzyName = new URL(target).searchParams.get('fuzzy') ?? 'Unknown Card';
    return new Response(JSON.stringify(mockScryfallCard(fuzzyName)), {
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
      'Deck',
      '1 Birgi, God of Storytelling',
      '1 Expansion // Explosion',
      '1 Sol Ring',
    ].join('\n'), 'Fuzzy Fallback Test');

    assert(result.warnings.every(warning => !warning.includes('Birgi, God of Storytelling') && !warning.includes('Expansion // Explosion')), 'expected fuzzy fallback to prevent placeholder warnings for DFC/split names');
  }

  {
    const result = await importDecklist([
      'Deck',
      '1 Chaos Orb',
      '1 Sol Ring',
    ].join('\n'), 'Banned Warning Test');

    assert(result.deck.cards.some(card => card.name === 'Chaos Orb'), 'expected banned card to still import');
    assert(result.warnings.some(warning => warning.includes('Chaos Orb is banned in Commander')), 'expected banned card warning when Allow Banned Cards is off');
  }

  {
    const result = await importDecklist([
      'Deck',
      '1 Chaos Orb',
      '1 Sol Ring',
    ].join('\n'), 'Banned Allowed Test', undefined, undefined, undefined, { allowBannedCards: true });

    assert(result.deck.cards.some(card => card.name === 'Chaos Orb'), 'expected banned card to still import when allowed');
    assert(result.warnings.every(warning => !warning.includes('Chaos Orb is banned in Commander')), 'expected Allow Banned Cards to suppress banned-card warning');
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

  {
    const result = await importDecklist([
      'Deck',
      '0 Sol Ring',
      '9999 Island',
      'x Lightning Bolt',
      '-2 Swamp',
      '1 Counterspell',
    ].join('\n'), 'Safeguard Test');

    const island = result.deck.cards.find(card => card.name === 'Island');
    assert(!result.deck.cards.some(card => card.name === 'Sol Ring'), 'expected zero-count lines to be ignored');
    assert(island?.count === 250, 'expected absurd quantities to be clamped');
    assert(result.warnings.some(warning => warning.includes('Ignored "Sol Ring"')), 'expected warning for zero-count lines');
    assert(result.warnings.some(warning => warning.includes('Clamped "Island"')), 'expected warning for clamped quantities');
    assert(result.warnings.some(warning => warning.includes('Ignored unrecognized decklist line: "x Lightning Bolt"')), 'expected warning for malformed count lines');
    assert(result.warnings.some(warning => warning.includes('Ignored unrecognized decklist line: "-2 Swamp"')), 'expected warning for negative count lines');
  }

  {
    const parsed = parseDeckFilePayload(JSON.stringify({
      deck: {
        id: 'file-deck',
        name: 'File Deck',
        format: 'commander',
        commanders: ['Vial Smasher the Fierce', 'Sakashima of a Thousand Faces', 'Sol Ring'],
        cards: [{ name: 'Vial Smasher the Fierce', count: 1 }, { name: 'Sol Ring', count: 9999 }],
      },
      logicText: 'note: Sol Ring | mana test',
    }));

    assert(parsed.deck?.commanders.join('|') === 'Vial Smasher the Fierce|Sakashima of a Thousand Faces', 'expected deck file commanders to be normalized');
    assert(parsed.deck?.cards.find(card => card.name === 'Sol Ring')?.count === 250, 'expected deck file counts to be clamped');
    assert(parsed.logicText?.includes('Sol Ring'), 'expected deck file logic text to be preserved');
  }

  {
    const textFile = parseDeckFilePayload('Deck\n1 Sol Ring');
    assert(textFile.deckText?.includes('Sol Ring'), 'expected non-JSON files to load as deck text');
    assert(textFile.warnings.some(warning => warning.includes('plain-text decklist')), 'expected non-JSON import warning');

    const mtgoXml = parseDeckFilePayload([
      '<?xml version="1.0" encoding="utf-8"?>',
      '<Deck>',
      '<Cards Quantity="1" Name="Sol Ring" Sideboard="false" />',
      '<Cards Quantity="2" Name="Counterspell" Sideboard="true" />',
      '</Deck>',
    ].join('\n'));
    assert(mtgoXml.deckText?.includes('Deck\n1 Sol Ring'), 'expected MTGO XML deck file to convert main deck cards to text');
    assert(mtgoXml.deckText?.includes('Sideboard\n2 Counterspell'), 'expected MTGO XML sideboard cards to convert to text');

    const cockatriceXml = parseDeckFilePayload([
      '<cockatrice_deck>',
      '<zone name="command"><card number="1" name="Atraxa, Praetors&apos; Voice"/></zone>',
      '<zone name="main"><card number="1" name="Command Tower"/><card number="1" name="Sol Ring"/></zone>',
      '</cockatrice_deck>',
    ].join('\n'));
    assert(cockatriceXml.deckText?.includes("Commander\n1 Atraxa, Praetors' Voice"), 'expected Cockatrice command zone to convert to commander text');
    assert(cockatriceXml.deckText?.includes('Deck\n1 Command Tower'), 'expected Cockatrice main zone to convert to deck text');

    const genericJson = parseDeckFilePayload(JSON.stringify({
      commanders: { 'Vial Smasher the Fierce': { quantity: 1 } },
      mainboard: {
        'Command Tower': { quantity: 1 },
        'Sol Ring': { quantity: 1 },
      },
      sideboard: [{ name: 'Pyroblast', count: 1 }],
    }));
    assert(genericJson.deckText?.includes('Commander\n1 Vial Smasher the Fierce'), 'expected generic JSON commanders to convert to text');
    assert(genericJson.deckText?.includes('Deck\n1 Command Tower'), 'expected generic JSON mainboard to convert to text');
    assert(genericJson.deckText?.includes('Sideboard\n1 Pyroblast'), 'expected generic JSON sideboard to convert to text');

    const invalidJson = parseDeckFilePayload('{"notDeck":true}');
    assert(Boolean(invalidJson.error), 'expected unrelated JSON to be rejected with an error');
  }

  {
    const rawCorruptedDeck: Deck = {
      id: 'corrupt-vial',
      name: 'Corrupt Vial Import',
      format: 'commander',
      commanders: [
        'Vial Smasher the Fierce',
        'Sakashima of a Thousand Faces',
        'Sol Ring',
        'Lightning Bolt',
        'Command Tower',
      ],
      cards: [
        { name: 'Vial Smasher the Fierce', count: 1 },
        { name: 'Sakashima of a Thousand Faces', count: 1 },
        { name: 'Sol Ring', count: 1 },
        { name: 'Lightning Bolt', count: 1 },
        { name: 'Command Tower', count: 1 },
      ],
      sideboard: [],
      maybeboard: [],
      colorIdentity: [],
      importedAt: 1,
    };
    const corrupted = normalizeCommanderDeck(rawCorruptedDeck);

    assert(corrupted.commanders.join('|') === 'Vial Smasher the Fierce|Sakashima of a Thousand Faces', 'expected corrupt deck commander list to be clamped');
    assert(corrupted.cards.some(card => card.name === 'Sol Ring'), 'expected non-commander cards to remain in the deck');

    const config = createDefaultGameConfig(2);
    const player = createPlayer('p1', 'Player 1', 0, '#3b82f6', config);
    const game = {
      ...createEmptyGameState(config),
      players: [player, createPlayer('p2', 'Player 2', 1, '#ef4444', config)],
      activePlayerId: player.id,
      priorityPlayerId: player.id,
    };
    const loaded = await loadDeckIntoPlayer(game, player.id, rawCorruptedDeck);
    const loadedPlayer = loaded.players.find(item => item.id === player.id);
    assert(loadedPlayer?.commandZone.length === 2, 'expected gameplay loader to create only two command-zone commanders');
    assert(loadedPlayer?.commanders.length === 2, 'expected gameplay loader to track only two commander instance ids');
    assert(loadedPlayer?.library.length === 3, 'expected non-commander cards to stay in the library');
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('PASS deck imports keep commander sections bounded and recognize main deck headers');
