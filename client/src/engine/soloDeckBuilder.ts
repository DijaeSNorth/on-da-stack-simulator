import type { CustomCardDefinition, CustomTrigger, Deck, DeckLogic, ReplacementEffect } from '../types/game';

export type DeckBuilderSection = 'commander' | 'main' | 'sideboard' | 'maybeboard';

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
    lines.push(`card: ${card.name} | ${card.typeLine || 'Creature'} | ${card.oracleText || ''}${stats ? ` | ${stats}` : ''}`);
  }
  for (const trigger of logic.triggers) lines.push(`trigger: ${trigger.sourceCard} | ${trigger.event} | ${trigger.effect} | ${trigger.reminderText}`);
  for (const replacement of logic.replacementEffects) lines.push(`replacement: ${replacement.sourceCard} | ${replacement.replaces} | ${replacement.replacement}`);
  for (const rule of logic.rules) lines.push(`rule: ${rule.name} | ${rule.cardFilter || 'all'} | ${rule.effect}`);
  return lines.join('\n');
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
