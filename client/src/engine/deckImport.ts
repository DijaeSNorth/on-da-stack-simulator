// ─── Deck Import Engine ───────────────────────────────────────────────────────
import type { Deck } from '../types/game';
import { fetchCardsByNames } from '../data/cardDatabase';

export interface ImportResult {
  deck: Deck;
  errors: string[];
  warnings: string[];
  commanders: string[];
  cardCount: number;
}

// ─── Format Parsers ───────────────────────────────────────────────────────────

interface ParsedEntry {
  count: number;
  name: string;
  section: 'main' | 'sideboard' | 'maybeboard' | 'commander';
}

/**
 * Normalize a card name from any common variation
 */
function normalizeName(name: string): string {
  return name
    .replace(/\s*\/\/\s*/g, ' // ') // DFC separator
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse Moxfield / MTGO / generic text format
 * Supports:
 *   1x Card Name
 *   1 Card Name
 *   Card Name (set) #num
 *   Section headers: Commander, Sideboard, Maybeboard
 */
function parseTextDecklist(raw: string): ParsedEntry[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const entries: ParsedEntry[] = [];
  let currentSection: ParsedEntry['section'] = 'main';

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Section headers
    if (/^(commander|companion)$/i.test(lower)) { currentSection = 'commander'; continue; }
    if (/^(sideboard|sb)$/i.test(lower)) { currentSection = 'sideboard'; continue; }
    if (/^(maybeboard|mb)$/i.test(lower)) { currentSection = 'maybeboard'; continue; }
    if (/^(main|mainboard|deck)$/i.test(lower)) { currentSection = 'main'; continue; }
    if (line.startsWith('//') || line.startsWith('#')) continue; // comment

    // Count + name pattern: "4x Lightning Bolt" or "4 Lightning Bolt"
    const match = line.match(/^(\d+)[xX]?\s+(.+?)(?:\s+\([A-Z0-9]+\))?(?:\s+\d+)?$/);
    if (match) {
      const count = parseInt(match[1], 10);
      const name = normalizeName(match[2]);
      entries.push({ count, name, section: currentSection });
      continue;
    }

    // "1 Card Name" at minimum
    const simple = line.match(/^(\d+)\s+(.+)$/);
    if (simple) {
      entries.push({ count: parseInt(simple[1], 10), name: normalizeName(simple[2]), section: currentSection });
    }
  }

  return entries;
}

/**
 * Parse CSV format: Name,Count or Count,Name
 */
function parseCSVDecklist(raw: string): ParsedEntry[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const entries: ParsedEntry[] = [];

  for (const line of lines) {
    if (line.toLowerCase().startsWith('name') || line.toLowerCase().startsWith('card')) continue;
    const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) continue;

    const a = parts[0], b = parts[1];
    if (!isNaN(Number(a))) {
      entries.push({ count: Number(a), name: normalizeName(b), section: 'main' });
    } else if (!isNaN(Number(b))) {
      entries.push({ count: Number(b), name: normalizeName(a), section: 'main' });
    }
  }

  return entries;
}

/**
 * Detect format and parse
 */
function parseRaw(raw: string): ParsedEntry[] {
  const trimmed = raw.trim();

  // CSV detection
  if (trimmed.includes(',') && !trimmed.includes('\n// ')) {
    const csvEntries = parseCSVDecklist(trimmed);
    if (csvEntries.length > 0) return csvEntries;
  }

  return parseTextDecklist(trimmed);
}

/**
 * Detect if any entries are commanders based on section or legendary status
 */
function detectCommanders(entries: ParsedEntry[]): string[] {
  const explicit = entries.filter(e => e.section === 'commander').map(e => e.name);
  if (explicit.length > 0) return explicit;
  return [];
}

/**
 * Main import function — parses raw text and fetches card data
 */
export async function importDecklist(
  raw: string,
  deckName: string = 'Imported Deck',
  source?: string
): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const entries = parseRaw(raw);

  if (entries.length === 0) {
    errors.push('No cards found. Please check your decklist format.');
    return {
      deck: createEmptyDeck(deckName),
      errors, warnings, commanders: [], cardCount: 0,
    };
  }

  // Deduplicate and group by section
  const mainMap = new Map<string, number>();
  const sideMap = new Map<string, number>();
  const maybeMap = new Map<string, number>();
  const commanderSet = new Set<string>();

  for (const entry of entries) {
    const name = entry.name;
    if (entry.section === 'commander') {
      commanderSet.add(name);
      mainMap.set(name, (mainMap.get(name) || 0) + entry.count);
    } else if (entry.section === 'sideboard') {
      sideMap.set(name, (sideMap.get(name) || 0) + entry.count);
    } else if (entry.section === 'maybeboard') {
      maybeMap.set(name, (maybeMap.get(name) || 0) + entry.count);
    } else {
      mainMap.set(name, (mainMap.get(name) || 0) + entry.count);
    }
  }

  // Check for >1 copies (non-basic)
  const basicLands = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
    'Wastes', 'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
    'Snow-Covered Mountain', 'Snow-Covered Forest']);

  for (const [name, count] of mainMap) {
    if (count > 1 && !basicLands.has(name)) {
      warnings.push(`${name} appears ${count} times — Commander requires singleton unless it's a basic land.`);
    }
  }

  // Fetch all card names
  const allNames = [...new Set([...mainMap.keys(), ...sideMap.keys(), ...maybeMap.keys()])];
  let fetchedDefs: Map<string, ReturnType<typeof Object.create>>;
  try {
    fetchedDefs = await fetchCardsByNames(allNames);
  } catch {
    warnings.push('Could not reach Scryfall — card validation skipped. Cards will load as placeholders.');
    fetchedDefs = new Map();
  }

  // Validate color identity
  const commanderNames = detectCommanders(entries).concat([...commanderSet]);

  // Check for cards not found
  for (const name of allNames) {
    if (!fetchedDefs.has(name)) {
      warnings.push(`"${name}" could not be found — it will appear as a placeholder.`);
    }
  }

  // Auto-detect commanders: legendary creatures in main deck when no explicit commander section
  let commanders = [...commanderSet];
  if (commanders.length === 0) {
    for (const [name] of mainMap) {
      const def = fetchedDefs.get(name);
      if (def && def.superTypes.includes('Legendary') &&
        (def.cardTypes.includes('Creature') || def.cardTypes.includes('Planeswalker'))) {
        commanders.push(name);
      }
    }
    if (commanders.length > 0) {
      warnings.push(`Auto-detected commander${commanders.length > 1 ? 's' : ''}: ${commanders.join(', ')}`);
    }
  }

  const cardCount = [...mainMap.values()].reduce((a, b) => a + b, 0);
  if (cardCount < 99) {
    warnings.push(`Deck has ${cardCount} cards — Commander requires exactly 100 cards (including commander).`);
  } else if (cardCount > 100) {
    warnings.push(`Deck has ${cardCount} cards — Commander requires exactly 100 cards.`);
  }

  const deck: Deck = {
    id: crypto.randomUUID(),
    name: deckName,
    format: 'commander',
    commanders,
    cards: [...mainMap.entries()].map(([name, count]) => ({ name, count })),
    sideboard: [...sideMap.entries()].map(([name, count]) => ({ name, count })),
    maybeboard: [...maybeMap.entries()].map(([name, count]) => ({ name, count })),
    colorIdentity: [],
    importSource: source,
    importedAt: Date.now(),
  };

  return { deck, errors, warnings, commanders, cardCount };
}

function createEmptyDeck(name: string): Deck {
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

// ─── LocalStorage Persistence ─────────────────────────────────────────────────

const DECKS_KEY = 'mtg_sim_decks';

export function saveDecksToStorage(decks: Deck[]): void {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
  } catch {
    // Storage full or unavailable
  }
}

export function loadDecksFromStorage(): Deck[] {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveDeck(deck: Deck): void {
  const decks = loadDecksFromStorage();
  const idx = decks.findIndex(d => d.id === deck.id);
  if (idx >= 0) decks[idx] = deck;
  else decks.push(deck);
  saveDecksToStorage(decks);
}

export function deleteDeck(id: string): void {
  const decks = loadDecksFromStorage().filter(d => d.id !== id);
  saveDecksToStorage(decks);
}

// Export deck as text
export function exportDeckAsText(deck: Deck): string {
  const lines: string[] = [];
  if (deck.commanders.length > 0) {
    lines.push('Commander');
    for (const c of deck.commanders) lines.push(`1 ${c}`);
    lines.push('');
  }
  lines.push('Deck');
  for (const { count, name } of deck.cards) {
    lines.push(`${count} ${name}`);
  }
  if (deck.sideboard.length > 0) {
    lines.push('');
    lines.push('Sideboard');
    for (const { count, name } of deck.sideboard) lines.push(`${count} ${name}`);
  }
  return lines.join('\n');
}
