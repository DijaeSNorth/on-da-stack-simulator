import type { CardDefinition, CustomCardDefinition, CustomTrigger, Deck, DeckLogic, ReplacementEffect } from '../types/game';

export type DeckBuilderSection = 'commander' | 'main' | 'sideboard' | 'maybeboard';

export interface DeckBuilderRow {
  section: DeckBuilderSection;
  name: string;
  count: number;
}

export interface DeckBuilderStats {
  totalCards: number;
  commanderCount: number;
  landCount: number;
  creatureCount: number;
  artifactCount: number;
  instantCount: number;
  sorceryCount: number;
  enchantmentCount: number;
  planeswalkerCount: number;
  battleCount: number;
  unknownTypeCount: number;
  nonCreatureCount: number;
  avgManaValue: number;
  curve: Record<number, number>;
  colorPips: Record<string, number>;
  typeCounts: Record<string, number>;
}

export function createBlankDeck(name = 'Untitled Solo Deck'): Deck {
  return {
    id: crypto.randomUUID(),
    name,
    format: 'commander',
    commanders: [],
    cards: [],
    sideboard: [],
    maybeboard: [],
    colorIdentity: [],
    importedAt: Date.now(),
  };
}

export function ensureDeckLogic(deck: Deck): DeckLogic {
  return deck.logicFile ?? {
    deckId: deck.id,
    rules: [],
    replacementEffects: [],
    cardNotes: {},
    triggers: [],
    customCards: [],
  };
}

export function setDeckEntryCount(deck: Deck, section: DeckBuilderSection, rawName: string, rawCount: number): Deck {
  const name = cleanName(rawName);
  const count = Math.max(0, Math.floor(rawCount));
  if (!name) return deck;

  if (section === 'commander') {
    const commanders = count > 0
      ? [...new Set([...deck.commanders, name])].slice(0, 2)
      : deck.commanders.filter(card => card !== name);
    return {
      ...deck,
      commanders,
      cards: setEntry(deck.cards, name, count > 0 ? 1 : 0),
      importedAt: Date.now(),
    };
  }

  const key = section === 'main' ? 'cards' : section;
  return {
    ...deck,
    [key]: setEntry(deck[key], name, count),
    importedAt: Date.now(),
  };
}

export function adjustDeckEntry(deck: Deck, section: DeckBuilderSection, name: string, delta: number): Deck {
  return setDeckEntryCount(deck, section, name, getDeckEntryCount(deck, section, name) + delta);
}

export function getDeckEntryCount(deck: Deck, section: DeckBuilderSection, rawName: string): number {
  const name = cleanName(rawName).toLowerCase();
  if (!name) return 0;
  if (section === 'commander') return deck.commanders.some(card => card.toLowerCase() === name) ? 1 : 0;
  const list = section === 'main' ? deck.cards : deck[section];
  return list.find(entry => entry.name.toLowerCase() === name)?.count ?? 0;
}

export function getDeckBuilderRows(deck: Deck): DeckBuilderRow[] {
  const commanderNames = new Set(deck.commanders.map(name => name.toLowerCase()));
  return [
    ...deck.commanders.map(name => ({ section: 'commander' as const, name, count: 1 })),
    ...deck.cards
      .filter(card => !commanderNames.has(card.name.toLowerCase()))
      .map(card => ({ section: 'main' as const, name: card.name, count: card.count })),
    ...deck.sideboard.map(card => ({ section: 'sideboard' as const, name: card.name, count: card.count })),
    ...deck.maybeboard.map(card => ({ section: 'maybeboard' as const, name: card.name, count: card.count })),
  ];
}

export function setCardNote(deck: Deck, cardName: string, note: string): Deck {
  const logic = ensureDeckLogic(deck);
  const normalized = cleanName(cardName);
  const cardNotes = { ...logic.cardNotes };
  if (note.trim()) cardNotes[normalized] = note.trim();
  else delete cardNotes[normalized];
  return withLogic(deck, { ...logic, cardNotes });
}

export function addCardTrigger(deck: Deck, trigger: Omit<CustomTrigger, 'id'>): Deck {
  const logic = ensureDeckLogic(deck);
  const sourceCard = cleanName(trigger.sourceCard);
  if (!sourceCard || !trigger.event.trim() || !trigger.effect.trim()) return deck;
  return withLogic(deck, {
    ...logic,
    triggers: [
      ...logic.triggers,
      {
        id: `solo-trigger-${Date.now()}`,
        sourceCard,
        event: trigger.event.trim(),
        effect: trigger.effect.trim(),
        reminderText: trigger.reminderText.trim() || trigger.effect.trim(),
      },
    ],
  });
}

export function addReplacement(deck: Deck, replacement: Omit<ReplacementEffect, 'id'>): Deck {
  const logic = ensureDeckLogic(deck);
  const sourceCard = cleanName(replacement.sourceCard);
  if (!sourceCard || !replacement.replaces.trim() || !replacement.replacement.trim()) return deck;
  return withLogic(deck, {
    ...logic,
    replacementEffects: [
      ...logic.replacementEffects,
      {
        id: `solo-replacement-${Date.now()}`,
        sourceCard,
        replaces: replacement.replaces.trim(),
        replacement: replacement.replacement.trim(),
      },
    ],
  });
}

export function upsertCustomCard(deck: Deck, customCard: CustomCardDefinition): Deck {
  const name = cleanName(customCard.name);
  if (!name) return deck;
  const logic = ensureDeckLogic(deck);
  const nextCard: CustomCardDefinition = {
    ...customCard,
    id: customCard.id || `custom-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
  };
  return withLogic(deck, {
    ...logic,
    customCards: [
      ...logic.customCards.filter(card => card.name.toLowerCase() !== name.toLowerCase()),
      nextCard,
    ],
  });
}

export function customCardFromDefinition(definition: CardDefinition): CustomCardDefinition {
  return {
    id: `scryfall-${definition.id}`,
    name: definition.name,
    manaCost: definition.manaCost,
    cmc: definition.cmc,
    typeLine: definition.typeLine,
    oracleText: definition.oracleText,
    power: definition.power,
    toughness: definition.toughness,
    loyalty: definition.loyalty,
    colors: definition.colors,
    colorIdentity: definition.colorIdentity,
    keywords: definition.keywords,
    imageUrl: definition.imageUrl,
    imageUrlBack: definition.imageUrlBack,
    isDoubleFaced: definition.isDoubleFaced,
    faces: definition.faces,
  };
}

export function removeCardLogic(deck: Deck, cardName: string, kind: 'note' | 'triggers' | 'replacements' | 'customCard'): Deck {
  const name = cleanName(cardName).toLowerCase();
  const logic = ensureDeckLogic(deck);
  if (kind === 'note') {
    const cardNotes = { ...logic.cardNotes };
    delete cardNotes[cardName];
    return withLogic(deck, { ...logic, cardNotes });
  }
  if (kind === 'triggers') return withLogic(deck, { ...logic, triggers: logic.triggers.filter(item => item.sourceCard.toLowerCase() !== name) });
  if (kind === 'replacements') return withLogic(deck, { ...logic, replacementEffects: logic.replacementEffects.filter(item => item.sourceCard.toLowerCase() !== name) });
  return withLogic(deck, { ...logic, customCards: logic.customCards.filter(item => item.name.toLowerCase() !== name) });
}

export function summarizeCardLogic(deck: Deck, rawName: string): { note?: string; triggers: number; replacements: number; customCard: boolean } {
  const name = cleanName(rawName);
  const lower = name.toLowerCase();
  const logic = deck.logicFile;
  if (!logic) return { triggers: 0, replacements: 0, customCard: false };
  const noteKey = Object.keys(logic.cardNotes).find(key => key.toLowerCase() === lower);
  return {
    note: noteKey ? logic.cardNotes[noteKey] : undefined,
    triggers: logic.triggers.filter(item => item.sourceCard.toLowerCase() === lower).length,
    replacements: logic.replacementEffects.filter(item => item.sourceCard.toLowerCase() === lower).length,
    customCard: logic.customCards.some(item => item.name.toLowerCase() === lower),
  };
}

export function serializeDeckLogic(deck: Deck): string {
  const logic = deck.logicFile;
  if (!logic) return '';
  const lines: string[] = [];
  for (const [card, note] of Object.entries(logic.cardNotes)) lines.push(`note: ${card} = ${note}`);
  for (const card of logic.customCards) {
    const stats = [card.power, card.toughness].filter(Boolean).join('/');
    lines.push(`card: ${card.name} | ${card.typeLine || 'Creature'} | ${singleLine(card.oracleText || '')}${stats ? ` | ${stats}` : ''}`);
  }
  for (const trigger of logic.triggers) lines.push(`trigger: ${trigger.sourceCard} | ${trigger.event} | ${trigger.effect} | ${trigger.reminderText}`);
  for (const replacement of logic.replacementEffects) lines.push(`replacement: ${replacement.sourceCard} | ${replacement.replaces} | ${replacement.replacement}`);
  for (const rule of logic.rules) lines.push(`rule: ${rule.name} | ${rule.cardFilter || 'all'} | ${rule.effect}`);
  return lines.join('\n');
}

export function analyzeDeckBuilderStats(deck: Deck): DeckBuilderStats {
  const customCards = new Map((deck.logicFile?.customCards ?? []).map(card => [card.name.toLowerCase(), card]));
  const curve: Record<number, number> = {};
  const colorPips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  const typeCounts: Record<string, number> = {};
  let totalManaValue = 0;
  let manaValueCards = 0;
  let landCount = 0;
  let creatureCount = 0;
  let artifactCount = 0;
  let instantCount = 0;
  let sorceryCount = 0;
  let enchantmentCount = 0;
  let planeswalkerCount = 0;
  let battleCount = 0;
  let unknownTypeCount = 0;

  const commanderOnlyEntries = deck.commanders
    .filter(name => !deck.cards.some(card => card.name.toLowerCase() === name.toLowerCase()))
    .map(name => ({ name, count: 1 }));
  const entries = [...deck.cards, ...commanderOnlyEntries];

  for (const entry of entries) {
    const card = customCards.get(entry.name.toLowerCase());
    const typeLine = card?.typeLine ?? '';
    const matchedTypes = getCardTypes(typeLine);
    for (const type of matchedTypes) typeCounts[type] = (typeCounts[type] ?? 0) + entry.count;
    if (matchedTypes.length === 0) {
      typeCounts.Unknown = (typeCounts.Unknown ?? 0) + entry.count;
      unknownTypeCount += entry.count;
    }
    if (matchedTypes.includes('Land')) landCount += entry.count;
    if (matchedTypes.includes('Creature')) creatureCount += entry.count;
    if (matchedTypes.includes('Artifact')) artifactCount += entry.count;
    if (matchedTypes.includes('Instant')) instantCount += entry.count;
    if (matchedTypes.includes('Sorcery')) sorceryCount += entry.count;
    if (matchedTypes.includes('Enchantment')) enchantmentCount += entry.count;
    if (matchedTypes.includes('Planeswalker')) planeswalkerCount += entry.count;
    if (matchedTypes.includes('Battle')) battleCount += entry.count;

    if (typeof card?.cmc === 'number') {
      const mv = Math.max(0, Math.min(7, Math.floor(card.cmc)));
      curve[mv] = (curve[mv] ?? 0) + entry.count;
      totalManaValue += card.cmc * entry.count;
      manaValueCards += entry.count;
    }

    const colors = card?.colorIdentity ?? card?.colors ?? [];
    for (const color of colors) colorPips[color] = (colorPips[color] ?? 0) + entry.count;
  }

  const totalCards = deck.cards.reduce((sum, card) => sum + card.count, 0) + commanderOnlyEntries.length;
  return {
    totalCards,
    commanderCount: deck.commanders.length,
    landCount,
    creatureCount,
    artifactCount,
    instantCount,
    sorceryCount,
    enchantmentCount,
    planeswalkerCount,
    battleCount,
    unknownTypeCount,
    nonCreatureCount: Math.max(0, totalCards - landCount - creatureCount),
    avgManaValue: manaValueCards ? totalManaValue / manaValueCards : 0,
    curve,
    colorPips,
    typeCounts,
  };
}

function withLogic(deck: Deck, logicFile: DeckLogic): Deck {
  return { ...deck, logicFile: { ...logicFile, deckId: deck.id }, importedAt: Date.now() };
}

function setEntry(list: { name: string; count: number }[], rawName: string, count: number): { name: string; count: number }[] {
  const name = cleanName(rawName);
  const next = list.filter(entry => entry.name.toLowerCase() !== name.toLowerCase());
  if (count > 0) next.push({ name, count });
  return next.sort((a, b) => a.name.localeCompare(b.name));
}

function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function singleLine(value: string): string {
  return value.replace(/\s*\n+\s*/g, ' / ').replace(/\|/g, '/').trim();
}

function getCardTypes(typeLine: string): string[] {
  const candidates = ['Creature', 'Land', 'Artifact', 'Enchantment', 'Planeswalker', 'Instant', 'Sorcery', 'Battle'];
  return candidates.filter(type => new RegExp(`\\b${type}\\b`, 'i').test(typeLine));
}
