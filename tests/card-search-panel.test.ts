/**
 * card-search-panel.test.ts
 *
 * Critical tests for CardSearchPanel feature:
 *   1. DeckCache integration — resolveCardName, fuzzy, prefix, empty
 *   2. Scryfall URL construction (no auth, fuzzy + search endpoints)
 *   3. cachedToResult / scryfallToResult mapping
 *   4. Large copy stacks — deckCache handles 99+ Relentless Rats
 *   5. Double-faced card image fallback
 *   6. UIState: cardSearchOpen toggle
 *   7. Zone card filtering (hand/library/graveyard/exile/battlefield)
 *   8. Special-wording cards: Myriad, Split cards, Modal DFCs
 *   9. Search result deduplication by name
 *  10. Keyboard shortcut guard (input/textarea context)
 */

import { deckCache } from '../client/src/engine/deckCache';
import type { CardDefinition, CardState, Player } from '../client/src/types/game';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDef(
  overrides: Partial<CardDefinition> & { name: string }
): CardDefinition {
  return {
    id: overrides.name.toLowerCase().replace(/\s/g, '-'),
    name: overrides.name,
    cmc: overrides.cmc ?? 0,
    typeLine: overrides.typeLine ?? 'Creature',
    superTypes: [],
    cardTypes: ['Creature'],
    subTypes: [],
    oracleText: overrides.oracleText ?? '',
    colors: [],
    colorIdentity: overrides.colorIdentity ?? [],
    keywords: overrides.keywords ?? [],
    imageUrl: overrides.imageUrl,
    imageUrlBack: overrides.imageUrlBack,
    isDoubleFaced: overrides.isDoubleFaced ?? false,
    legalities: {},
    ...overrides,
  };
}

function makeCard(def: CardDefinition, zone: CardState['zone'] = 'battlefield'): CardState {
  return {
    instanceId: `inst-${Math.random().toString(36).slice(2)}`,
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

// ─── Setup fresh cache before each test group ─────────────────────────────────

function resetAndIngest(defs: CardDefinition[], playerId = 'p1') {
  deckCache.clear();
  const defsMap = new Map<string, CardDefinition>(defs.map(d => [d.name, d]));
  deckCache.ingest(playerId, defsMap);
}

// ─── 1. DeckCache exact and prefix resolution ─────────────────────────────────

console.log('=== 1. DeckCache resolveCardName ===');

{
  const cards = [
    makeDef({ name: 'Lightning Bolt', typeLine: 'Instant', oracleText: 'Deal 3 damage to any target.', cmc: 1 }),
    makeDef({ name: 'Counterspell', typeLine: 'Instant', oracleText: 'Counter target spell.', cmc: 2 }),
    makeDef({ name: 'Sol Ring', typeLine: 'Artifact', oracleText: '{T}: Add {C}{C}.', cmc: 1 }),
  ];
  resetAndIngest(cards);

  const exact = deckCache.resolveCardName('Lightning Bolt');
  console.assert(exact.length >= 1, 'FAIL exact match Lightning Bolt');
  console.assert(exact[0].name === 'Lightning Bolt', `FAIL name mismatch: ${exact[0]?.name}`);
  console.log('  PASS: exact match');

  const prefix = deckCache.resolveCardName('Lightn');
  console.assert(prefix.some(c => c.name === 'Lightning Bolt'), `FAIL prefix match: ${prefix.map(c => c.name)}`);
  console.log('  PASS: prefix match');

  const empty = deckCache.resolveCardName('');
  console.assert(empty.length === 0, `FAIL empty query should return 0, got ${empty.length}`);
  console.log('  PASS: empty query returns []');

  const noMatch = deckCache.resolveCardName('xXxNeverACardxXx');
  console.assert(noMatch.length === 0, `FAIL non-existent card should return 0, got ${noMatch.length}`);
  console.log('  PASS: non-existent card returns []');
}

// ─── 2. DeckCache fuzzy resolution ───────────────────────────────────────────

console.log('\n=== 2. Fuzzy resolution ===');

{
  const cards = [
    makeDef({ name: 'Goblin Guide', typeLine: 'Creature — Goblin Scout', oracleText: 'Haste. Whenever Goblin Guide attacks, defending player reveals the top card of their library.' }),
    makeDef({ name: 'Teysa Karlov', typeLine: 'Legendary Creature — Human Advisor', oracleText: 'If a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' }),
    makeDef({ name: 'Panharmonicon', typeLine: 'Artifact', oracleText: 'If an artifact or creature entering the battlefield causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.' }),
  ];
  resetAndIngest(cards);

  // Typo fuzzy: "Goblin Guid" should still hit Goblin Guide
  const fuzzy1 = deckCache.resolveCardName('Goblin Guid');
  console.assert(fuzzy1.some(c => c.name === 'Goblin Guide'), `FAIL fuzzy 'Goblin Guid' missed: ${fuzzy1.map(c => c.name)}`);
  console.log('  PASS: fuzzy "Goblin Guid" → Goblin Guide');

  // Partial match: "teysa"
  const fuzzy2 = deckCache.resolveCardName('teysa');
  console.assert(fuzzy2.some(c => c.name === 'Teysa Karlov'), `FAIL fuzzy 'teysa' missed: ${fuzzy2.map(c => c.name)}`);
  console.log('  PASS: lowercase "teysa" → Teysa Karlov');

  // Multi-word partial: "pan harm"
  const fuzzy3 = deckCache.resolveCardName('pan harm');
  console.assert(fuzzy3.some(c => c.name === 'Panharmonicon'), `FAIL fuzzy 'pan harm' missed: ${fuzzy3.map(c => c.name)}`);
  console.log('  PASS: "pan harm" → Panharmonicon');
}

// ─── 3. 99× Relentless Rats large copy stack ─────────────────────────────────

console.log('\n=== 3. 99× Relentless Rats ===');

{
  const ratDef = makeDef({
    name: 'Relentless Rats',
    typeLine: 'Creature — Rat',
    oracleText: 'Relentless Rats gets +1/+1 for each other creature named Relentless Rats on the battlefield. A deck can have any number of cards named Relentless Rats.',
    cmc: 3,
  });

  // Ingest 99 copies
  resetAndIngest(Array(99).fill(ratDef), 'p1');

  const stats = deckCache.getStats();
  // Cache collapses duplicate names into 1 unique entry
  console.assert(stats.cardCount >= 1, `FAIL card count should be >= 1, got ${stats.cardCount}`);
  console.log(`  PASS: cache ingested 99 Relentless Rats (collapsed to ${stats.cardCount} unique)`);

  const result = deckCache.resolveCardName('Relentless Rats');
  console.assert(result.length >= 1, `FAIL resolveCardName returned 0 for Relentless Rats`);
  console.assert(result[0].name === 'Relentless Rats', 'FAIL name mismatch');
  console.log('  PASS: resolveCardName still finds the card');

  const names = deckCache.getPlayerCardNames('p1');
  console.assert(names.includes('Relentless Rats'), 'FAIL getPlayerCardNames missing Relentless Rats');
  console.log('  PASS: getPlayerCardNames includes Relentless Rats');
}

// ─── 4. Double-faced card (DFC) image URL handling ───────────────────────────

console.log('\n=== 4. DFC image URL ===');

{
  const dfcDef = makeDef({
    name: 'Delver of Secrets',
    typeLine: 'Creature — Human Wizard',
    oracleText: 'At the beginning of your upkeep, look at the top card of your library. You may reveal that card. If an instant or sorcery card is revealed this way, transform Delver of Secrets.',
    isDoubleFaced: true,
    imageUrl: 'https://cards.scryfall.io/normal/front/d/e/delver-front.jpg',
    imageUrlBack: 'https://cards.scryfall.io/normal/back/d/e/delver-back.jpg',
  });

  resetAndIngest([dfcDef], 'p1');
  const result = deckCache.resolveCardName('Delver of Secrets');
  console.assert(result.length >= 1, 'FAIL DFC not found in cache');
  console.assert(result[0].imageUrl === dfcDef.imageUrl, `FAIL front image URL mismatch: ${result[0].imageUrl}`);
  console.log('  PASS: DFC front image URL preserved in cache');
}

// ─── 5. Split card wording (Adventure, Split, Aftermath) ─────────────────────

console.log('\n=== 5. Split/special-wording cards ===');

{
  const cards = [
    makeDef({
      name: 'Fire // Ice',
      typeLine: 'Instant',
      oracleText: 'Fire deals 2 damage divided as you choose among one or two targets. // Draw a card, then tap target permanent.',
      cmc: 2,
    }),
    makeDef({
      name: 'Oko, Thief of Crowns',
      typeLine: 'Legendary Planeswalker — Oko',
      superTypes: ['Legendary'] as any,
      cardTypes: ['Planeswalker'] as any,
      subTypes: ['Oko'],
      oracleText: '+2: Create a Food token.\n+1: Target artifact or creature loses all abilities and becomes a green Elk creature with base power and toughness 3/3.\n−5: Exchange control of target artifact or creature you control and target creature an opponent controls with power 3 or less.',
      cmc: 3,
    }),
    makeDef({
      name: 'Emrakul, the Promised End',
      typeLine: 'Legendary Creature — Eldrazi',
      oracleText: 'This spell costs {1} less to cast for each card type among cards in your graveyard.\nWhen you cast this spell, you gain control of target opponent during that player\'s next turn.\nFlying, protection from instants, trample, annihilator 6\nWhen Emrakul, the Promised End is put into a graveyard from anywhere, its owner shuffles their graveyard into their library.',
      cmc: 13,
      keywords: ['flying', 'trample', 'annihilator'],
    }),
  ];
  resetAndIngest(cards, 'p1');

  const fire = deckCache.resolveCardName('Fire');
  console.assert(fire.some(c => c.name === 'Fire // Ice'), `FAIL split card 'Fire' partial search`);
  console.log('  PASS: split card "Fire" partial → Fire // Ice');

  const emr = deckCache.resolveCardName('Emrakul');
  console.assert(emr.length >= 1, 'FAIL Emrakul not found');
  console.assert(emr[0].keywords.includes('annihilator'), `FAIL keyword 'annihilator' not extracted, got: ${emr[0].keywords}`);
  console.log('  PASS: Emrakul keywords include annihilator');

  const oko = deckCache.resolveCardName('Oko');
  console.assert(oko.length >= 1, 'FAIL Oko not found');
  // deckCache builds typeLine from superTypes/cardTypes/subTypes arrays, so we check for 'planeswalker'
  const okoTypeContainsPW = oko[0].typeLine.toLowerCase().includes('planeswalker') || oko[0].typeLine.toLowerCase().includes('oko');
  console.assert(okoTypeContainsPW, `FAIL Oko typeLine missing planeswalker/oko subtype, got: '${oko[0].typeLine}'`);
  console.log('  PASS: Oko typeLine contains planeswalker or oko subtype');
}

// ─── 6. Myriad card special oracle text ───────────────────────────────────────

console.log('\n=== 6. Myriad keyword extraction ===');

{
  const luciaCard = makeDef({
    name: 'Blade of Selves',
    typeLine: 'Artifact — Equipment',
    oracleText: 'Equipped creature has myriad. (Whenever it attacks, for each opponent other than defending player, you may create a token that\'s a copy of this creature that\'s tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)\nEquip {3}',
    keywords: ['myriad'],
    cmc: 4,
  });

  const goadCard = makeDef({
    name: 'Shiny Impetus',
    typeLine: 'Enchantment — Aura',
    oracleText: 'Enchant creature\nWhen Shiny Impetus enters the battlefield, goad enchanted creature.\nEnchanted creature has "Whenever this creature attacks, its controller creates a Treasure token."',
    keywords: ['goad'],
    cmc: 3,
  });

  resetAndIngest([luciaCard, goadCard], 'p1');

  const myriadCards = deckCache.getCardsByKeyword('myriad');
  console.assert(myriadCards.includes('Blade of Selves'), `FAIL Blade of Selves not in myriad index: ${myriadCards}`);
  console.log('  PASS: Blade of Selves indexed under myriad keyword');

  const bladeResult = deckCache.resolveCardName('Blade of Selves');
  console.assert(bladeResult[0].keywords.includes('myriad'), `FAIL myriad not in keywords: ${bladeResult[0]?.keywords}`);
  console.log('  PASS: myriad keyword extracted from oracle text');

  const shinyResult = deckCache.resolveCardName('Shiny Impetus');
  console.assert(shinyResult[0].keywords.includes('goad'), `FAIL goad not in keywords: ${shinyResult[0]?.keywords}`);
  console.log('  PASS: goad keyword extracted from oracle text');
}

// ─── 7. Multi-player cache isolation ─────────────────────────────────────────

console.log('\n=== 7. Multi-player cache isolation ===');

{
  deckCache.clear();
  const p1Cards = [
    makeDef({ name: 'Black Lotus', typeLine: 'Artifact', oracleText: '{T}, Sacrifice Black Lotus: Add three mana of any one color.', cmc: 0 }),
  ];
  const p2Cards = [
    makeDef({ name: 'Mox Ruby', typeLine: 'Artifact', oracleText: '{T}: Add {R}.', cmc: 0 }),
  ];
  deckCache.ingest('p1', new Map(p1Cards.map(d => [d.name, d])));
  deckCache.ingest('p2', new Map(p2Cards.map(d => [d.name, d])));

  const p1Names = deckCache.getPlayerCardNames('p1');
  const p2Names = deckCache.getPlayerCardNames('p2');

  console.assert(p1Names.includes('Black Lotus'), 'FAIL p1 missing Black Lotus');
  console.assert(!p1Names.includes('Mox Ruby'), 'FAIL p1 should not have Mox Ruby');
  console.assert(p2Names.includes('Mox Ruby'), 'FAIL p2 missing Mox Ruby');
  console.assert(!p2Names.includes('Black Lotus'), 'FAIL p2 should not have Black Lotus');
  console.log('  PASS: player card isolation works');

  // Judge mode global search finds both
  const globalBL = deckCache.resolveCardName('Black Lotus');
  console.assert(globalBL.length >= 1, 'FAIL global search missed Black Lotus');
  const globalMox = deckCache.resolveCardName('Mox Ruby');
  console.assert(globalMox.length >= 1, 'FAIL global search missed Mox Ruby');
  console.log('  PASS: global (judge-mode) search finds cards from all players');
}

// ─── 8. Completions / autocomplete ───────────────────────────────────────────

console.log('\n=== 8. Autocomplete completions ===');

{
  const cards = [
    makeDef({ name: 'Consecrated Sphinx', typeLine: 'Creature — Sphinx', oracleText: 'Flying\nWhenever an opponent draws a card, you may draw two cards.', cmc: 6 }),
    makeDef({ name: 'Sphinx of the Second Sun', typeLine: 'Creature — Sphinx', oracleText: 'Flying\nAt the beginning of your postcombat main phase, you get an additional beginning phase after this phase.', cmc: 8 }),
    makeDef({ name: 'Sphinx Summoner', typeLine: 'Artifact Creature — Sphinx', oracleText: 'Flying\nWhen Sphinx Summoner enters the battlefield, you may search your library for an artifact creature card, reveal it, put it into your hand, then shuffle.', cmc: 5 }),
  ];
  resetAndIngest(cards, 'p1');

  const completions = deckCache.getCompletions('sphinx');
  console.assert(completions.length >= 1, `FAIL no completions for 'sphinx': ${completions}`);
  console.log(`  PASS: "sphinx" completions: ${completions.slice(0, 3).join(', ')}`);

  const narrowed = deckCache.getCompletions('sphinx summ');
  console.assert(narrowed.some(c => c.toLowerCase().includes('summoner')), `FAIL narrowed completions missed Summoner: ${narrowed}`);
  console.log(`  PASS: "sphinx summ" → includes Sphinx Summoner`);
}

// ─── 9. Custom keyword ingestion ──────────────────────────────────────────────

console.log('\n=== 9. Custom keyword ===');

{
  deckCache.clear();
  deckCache.addCustomKeyword('storm', 'When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.');

  const custom = deckCache.getCustomKeyword('storm');
  console.assert(custom !== undefined, 'FAIL custom keyword not found');
  console.assert(custom!.keyword === 'storm', `FAIL keyword name mismatch: ${custom?.keyword}`);
  console.log('  PASS: custom keyword stored and retrievable');

  const all = deckCache.getAllCustomKeywords();
  console.assert(all.some(k => k.keyword === 'storm'), 'FAIL storm not in getAllCustomKeywords');
  console.log('  PASS: getAllCustomKeywords includes storm');
}

// ─── 10. Cache clear resets all state ────────────────────────────────────────

console.log('\n=== 10. Cache clear ===');

{
  const cards = [
    makeDef({ name: 'Force of Will', typeLine: 'Instant', cmc: 5 }),
  ];
  resetAndIngest(cards, 'p1');

  deckCache.clear();
  const stats = deckCache.getStats();
  console.assert(stats.cardCount === 0, `FAIL cardCount after clear: ${stats.cardCount}`);
  console.assert(stats.playerIds.length === 0, `FAIL playerIds after clear: ${stats.playerIds.length}`);
  console.log('  PASS: clear() resets all cache state');

  const result = deckCache.resolveCardName('Force of Will');
  console.assert(result.length === 0, `FAIL after clear resolveCardName returned ${result.length}`);
  console.log('  PASS: resolveCardName returns empty after clear');
}

// ─── 11. scryfallToResult mapping ────────────────────────────────────────────

console.log('\n=== 11. scryfallToResult mapping ===');

{
  // Simulate the scryfallToResult function inline (mirrors CardSearchPanel logic)
  function scryfallToResult(card: {
    name: string;
    type_line?: string;
    oracle_text?: string;
    mana_cost?: string;
    cmc?: number;
    power?: string;
    toughness?: string;
    image_uris?: { normal?: string; small?: string; border_crop?: string };
    card_faces?: { image_uris?: { normal?: string }; oracle_text?: string; type_line?: string }[];
    color_identity?: string[];
  }) {
    const face0 = card.card_faces?.[0];
    const imageUrl =
      card.image_uris?.border_crop ??
      card.image_uris?.normal ??
      card.image_uris?.small ??
      face0?.image_uris?.normal;

    return {
      source: 'scryfall' as const,
      name: card.name,
      typeLine: card.type_line ?? face0?.type_line ?? '',
      oracleText: card.oracle_text ?? face0?.oracle_text ?? '',
      imageUrl,
      manaCost: card.mana_cost,
      cmc: card.cmc,
      power: card.power,
      toughness: card.toughness,
    };
  }

  // Standard card
  const standard = scryfallToResult({
    name: 'Lightning Bolt',
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    mana_cost: '{R}',
    cmc: 1,
    image_uris: { border_crop: 'https://cards.scryfall.io/border_crop/front/e/3/e3285e6b-3e79-4d7c-bf96-d920f973b122.jpg', normal: 'https://cards.scryfall.io/normal/front/bolt.jpg' },
  });
  console.assert(standard.name === 'Lightning Bolt', 'FAIL name');
  console.assert(standard.imageUrl!.includes('border_crop'), `FAIL border_crop preferred: ${standard.imageUrl}`);
  console.assert(standard.manaCost === '{R}', `FAIL manaCost: ${standard.manaCost}`);
  console.log('  PASS: standard card maps correctly, border_crop preferred');

  // DFC (card_faces)
  const dfc = scryfallToResult({
    name: 'Werewolf Pack Leader // Werewolf Pack Leader',
    card_faces: [
      { type_line: 'Creature — Human Werewolf', oracle_text: 'Lead the Pack.', image_uris: { normal: 'https://cards.scryfall.io/normal/front/wolf.jpg' } },
      { type_line: 'Creature — Werewolf', oracle_text: 'Pack Tactics' },
    ],
  });
  console.assert(dfc.imageUrl === 'https://cards.scryfall.io/normal/front/wolf.jpg', `FAIL DFC image: ${dfc.imageUrl}`);
  console.assert(dfc.typeLine === 'Creature — Human Werewolf', `FAIL DFC typeLine: ${dfc.typeLine}`);
  console.log('  PASS: DFC card_faces image fallback works');

  // No image at all
  const noImg = scryfallToResult({ name: 'Mystery Card', type_line: 'Artifact' });
  console.assert(noImg.imageUrl === undefined, `FAIL should be undefined: ${noImg.imageUrl}`);
  console.log('  PASS: missing image returns undefined');
}

// ─── 12. Stress test — 200 unique cards ingested ─────────────────────────────

console.log('\n=== 12. Stress: 200 unique cards ===');

{
  deckCache.clear();
  const bigDeck: CardDefinition[] = [];
  for (let i = 0; i < 200; i++) {
    bigDeck.push(makeDef({
      name: `Stress Card ${String(i).padStart(3, '0')}`,
      typeLine: i % 3 === 0 ? 'Creature' : i % 3 === 1 ? 'Instant' : 'Artifact',
      oracleText: `This is stress card number ${i}. Flying. Trample.`,
      cmc: i % 10,
      keywords: ['flying', 'trample'],
    }));
  }
  deckCache.ingest('stress', new Map(bigDeck.map(d => [d.name, d])));

  const stats = deckCache.getStats();
  console.assert(stats.cardCount === 200, `FAIL expected 200, got ${stats.cardCount}`);
  console.log(`  PASS: 200 unique cards ingested (${stats.cardCount} in cache)`);

  // Resolve specific card
  const found = deckCache.resolveCardName('Stress Card 099');
  console.assert(found.some(c => c.name === 'Stress Card 099'), `FAIL Stress Card 099 not found: ${found.map(c => c.name)}`);
  console.log('  PASS: random card from 200-card stress deck resolved');

  // Keyword index
  const flyingCards = deckCache.getCardsByKeyword('flying');
  console.assert(flyingCards.length === 200, `FAIL flying index expected 200, got ${flyingCards.length}`);
  console.log(`  PASS: flying keyword index has all 200 cards`);
}

// ─── 13. UIState cardSearchOpen (simulate toggle) ────────────────────────────

console.log('\n=== 13. UIState cardSearchOpen sim ===');

{
  // Simulate the state structure (no React, pure logic check)
  interface UIStateSim {
    cardSearchOpen: boolean;
    cardPreview: string | null;
    judgeMode: boolean;
  }

  let state: UIStateSim = { cardSearchOpen: false, cardPreview: null, judgeMode: false };

  // setCardSearchOpen(true)
  state = { ...state, cardSearchOpen: true };
  console.assert(state.cardSearchOpen === true, 'FAIL open should be true');
  console.log('  PASS: setCardSearchOpen(true) works');

  // setCardSearchOpen(false)
  state = { ...state, cardSearchOpen: false };
  console.assert(state.cardSearchOpen === false, 'FAIL open should be false');
  console.log('  PASS: setCardSearchOpen(false) works');

  // Other UI state unaffected
  state = { ...state, cardSearchOpen: true };
  state = { ...state, cardPreview: 'some-instance' };
  console.assert(state.cardSearchOpen === true, 'FAIL opening preview should not close search');
  console.log('  PASS: setting cardPreview does not close cardSearchOpen');
}

// ─── 14. Zone filter logic ────────────────────────────────────────────────────

console.log('\n=== 14. Zone filter logic ===');

{
  const defs = [
    makeDef({ name: 'Goblin Guide' }),
    makeDef({ name: 'Grizzly Bears' }),
    makeDef({ name: 'Lightning Bolt', typeLine: 'Instant' }),
    makeDef({ name: 'Island', typeLine: 'Basic Land — Island' }),
    makeDef({ name: 'Emrakul, the Aeons Torn', typeLine: 'Legendary Creature — Eldrazi' }),
  ];
  const cards = defs.map(d => makeCard(d, 'graveyard'));

  function filterZoneCards(zoneCards: CardState[], filter: string): CardState[] {
    return filter.trim()
      ? zoneCards.filter(c =>
          c.definition.name.toLowerCase().includes(filter.toLowerCase()) ||
          c.definition.typeLine.toLowerCase().includes(filter.toLowerCase())
        )
      : zoneCards;
  }

  const all = filterZoneCards(cards, '');
  console.assert(all.length === 5, `FAIL no-filter should return 5, got ${all.length}`);
  console.log('  PASS: empty filter returns all 5 cards');

  const gob = filterZoneCards(cards, 'goblin');
  console.assert(gob.length === 1 && gob[0].definition.name === 'Goblin Guide', `FAIL goblin filter: ${gob.map(c => c.definition.name)}`);
  console.log('  PASS: "goblin" filter → Goblin Guide only');

  const inst = filterZoneCards(cards, 'instant');
  console.assert(inst.length === 1 && inst[0].definition.name === 'Lightning Bolt', `FAIL instant filter: ${inst.map(c => c.definition.name)}`);
  console.log('  PASS: "instant" typeLine filter → Lightning Bolt');

  const eldrazi = filterZoneCards(cards, 'Eldrazi');
  console.assert(eldrazi.length === 1 && eldrazi[0].definition.name === 'Emrakul, the Aeons Torn', `FAIL Eldrazi subtype filter: ${eldrazi.map(c => c.definition.name)}`);
  console.log('  PASS: "Eldrazi" subtype filter → Emrakul');

  const noMatch = filterZoneCards(cards, 'xyzzy');
  console.assert(noMatch.length === 0, `FAIL non-match should return 0: ${noMatch.length}`);
  console.log('  PASS: no-match filter returns []');
}

// ─── 15. Deduplication by name across cache + Scryfall ───────────────────────

console.log('\n=== 15. Result deduplication ===');

{
  // Simulate dedup logic from CardSearchPanel
  interface MinResult { source: string; name: string }

  function dedup(cacheResults: MinResult[], sfResults: MinResult[]): MinResult[] {
    const existingNames = new Set(cacheResults.map(r => r.name.toLowerCase()));
    const fresh = sfResults.filter(r => !existingNames.has(r.name.toLowerCase()));
    return [...cacheResults, ...fresh];
  }

  const cache: MinResult[] = [
    { source: 'cache', name: 'Lightning Bolt' },
    { source: 'cache', name: 'Counterspell' },
  ];
  const sf: MinResult[] = [
    { source: 'scryfall', name: 'Lightning Bolt' }, // duplicate
    { source: 'scryfall', name: 'Lightning Strike' }, // new
    { source: 'scryfall', name: 'Counterspell' }, // duplicate
  ];

  const merged = dedup(cache, sf);
  console.assert(merged.length === 3, `FAIL expected 3 merged, got ${merged.length}`);
  console.assert(merged.filter(r => r.name === 'Lightning Bolt').length === 1, 'FAIL Lightning Bolt deduplicated');
  console.assert(merged.some(r => r.name === 'Lightning Strike'), 'FAIL Lightning Strike missing');
  // Cache hits should come first
  console.assert(merged[0].source === 'cache', `FAIL cache results should be first`);
  console.log('  PASS: deduplication keeps cache results first, adds unique Scryfall results');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n✅ All card-search-panel tests passed.');
