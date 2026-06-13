import type { Deck, DeckValidationResult } from '../types/game';
import { normalizeCommanderDeck } from './deckImport';
import { validateCommanderDraft } from './soloDeckBuilder';

export const SOLO_DECK_EXPORT_VERSION = 1;

export interface SoloDeckJsonExport {
  deckVersion: number;
  name: string;
  format: Deck['format'];
  commanders: Deck['commanders'];
  cards: Deck['cards'];
  sideboard: Deck['sideboard'];
  maybeboard: Deck['maybeboard'];
  colorIdentity: Deck['colorIdentity'];
  createdAt: number;
  updatedAt: number;
  validation: DeckValidationResult;
}

export function exportDeckText(deck?: Deck): string {
  if (!deck) return '';
  const normalized = normalizeCommanderDeck(deck);
  const commanderNames = new Set(normalized.commanders.map(name => name.toLowerCase()));
  const lines: string[] = [];
  if (normalized.commanders.length > 0) {
    lines.push('Commander');
    for (const commander of normalized.commanders) lines.push(`1 ${commander}`);
    lines.push('');
  }
  lines.push('Deck');
  for (const card of normalized.cards) {
    if (commanderNames.has(card.name.toLowerCase())) continue;
    lines.push(`${card.count} ${card.name}`);
  }
  if (normalized.sideboard.length > 0) {
    lines.push('');
    lines.push('Sideboard');
    for (const card of normalized.sideboard) lines.push(`${card.count} ${card.name}`);
  }
  if (normalized.maybeboard.length > 0) {
    lines.push('');
    lines.push('Maybeboard');
    for (const card of normalized.maybeboard) lines.push(`${card.count} ${card.name}`);
  }
  return lines.join('\n');
}

export function exportDeckJson(deck: Deck, validation?: DeckValidationResult): SoloDeckJsonExport {
  const normalized = normalizeCommanderDeck(deck);
  const timestamp = Date.now();
  return {
    deckVersion: SOLO_DECK_EXPORT_VERSION,
    name: normalized.name,
    format: normalized.format,
    commanders: normalized.commanders,
    cards: normalized.cards,
    sideboard: normalized.sideboard,
    maybeboard: normalized.maybeboard,
    colorIdentity: normalized.colorIdentity,
    createdAt: normalized.importedAt || timestamp,
    updatedAt: timestamp,
    validation: validation ?? validateCommanderDraft(normalized),
  };
}

export function exportDeckJsonText(deck?: Deck, validation?: DeckValidationResult): string {
  return deck ? JSON.stringify(exportDeckJson(deck, validation), null, 2) : '';
}

export function importDeckFromJsonExport(raw: string, fallbackName = 'Imported Solo Deck'): Deck | null {
  const parsed = JSON.parse(raw) as Partial<SoloDeckJsonExport> & { deck?: Partial<Deck> };
  if (parsed.deck && typeof parsed.deck === 'object') {
    return normalizeCommanderDeck({
      ...parsed.deck,
      id: crypto.randomUUID(),
      name: parsed.deck.name || fallbackName,
      importedAt: Date.now(),
    } as Deck);
  }
  if (!Array.isArray(parsed.cards) && !Array.isArray(parsed.commanders)) return null;
  return normalizeCommanderDeck({
    id: crypto.randomUUID(),
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fallbackName,
    format: parsed.format === 'brawl' || parsed.format === 'oathbreaker' ? parsed.format : 'commander',
    commanders: Array.isArray(parsed.commanders) ? parsed.commanders.filter((name: unknown): name is string => typeof name === 'string') : [],
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
    sideboard: Array.isArray(parsed.sideboard) ? parsed.sideboard : [],
    maybeboard: Array.isArray(parsed.maybeboard) ? parsed.maybeboard : [],
    colorIdentity: Array.isArray(parsed.colorIdentity) ? parsed.colorIdentity : [],
    importedAt: Date.now(),
  });
}

export function makeDeckDownloadName(deck?: Deck, extension = 'txt'): string {
  const base = (deck?.name || 'solo-deck')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'solo-deck';
  return `${base}.${extension}`;
}
