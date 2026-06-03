// ─── Deck Import Engine ───────────────────────────────────────────────────────
import type {
  CardDefinition,
  CustomRule,
  CustomTrigger,
  Deck,
  DeckLogic,
  ReplacementEffect,
} from '../types/game';
import { fetchCardsByNames } from '../data/cardDatabase';
import { deckCache } from './deckCache';

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

export interface DeckLogicParseResult {
  logicFile?: DeckLogic;
  errors: string[];
  warnings: string[];
}

/**
 * Parse an optional custom logic file. JSON is preferred, but a compact line
 * format is accepted for quick table notes:
 *   note: Card Name = reminder text
 *   trigger: Card Name | attacks | effect | optional reminder
 *   replacement: Card Name | dies | exile it instead
 *   rule: Rule Name | Card Filter | effect
 */
export function parseDeckLogicFile(raw: string, deckId: string): DeckLogicParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = raw.trim();
  if (!text) return { errors, warnings };

  const base: DeckLogic = {
    deckId,
    rules: [],
    replacementEffects: [],
    cardNotes: {},
    triggers: [],
  };

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      const payload = Array.isArray(parsed) ? { rules: parsed } : parsed;
      if (!payload || typeof payload !== 'object') {
        errors.push('Custom logic JSON must be an object or an array of rules.');
        return { errors, warnings };
      }

      const rawRules = Array.isArray(payload.rules) ? payload.rules : [];
      const rawReplacements = Array.isArray(payload.replacementEffects)
        ? payload.replacementEffects
        : Array.isArray(payload.replacements) ? payload.replacements : [];
      const rawTriggers = Array.isArray(payload.triggers) ? payload.triggers : [];

      base.rules = rawRules.map((rule: Partial<CustomRule>, index: number) => normalizeRule(rule, index));
      base.replacementEffects = rawReplacements.map((effect: Partial<ReplacementEffect>, index: number) =>
        normalizeReplacement(effect, index)
      );
      base.triggers = rawTriggers.map((trigger: Partial<CustomTrigger>, index: number) =>
        normalizeTrigger(trigger, index)
      );

      if (payload.cardNotes && typeof payload.cardNotes === 'object' && !Array.isArray(payload.cardNotes)) {
        base.cardNotes = Object.fromEntries(
          Object.entries(payload.cardNotes)
            .filter(([card, note]) => card.trim() && typeof note === 'string' && note.trim())
            .map(([card, note]) => [normalizeName(card), String(note).trim()])
        );
      } else if (payload.cardNotes !== undefined) {
        warnings.push('Custom logic cardNotes must be an object keyed by card name.');
      }

      return withOptionalLogic(base, errors, warnings);
    } catch (err) {
      errors.push(`Custom logic JSON could not be parsed: ${err instanceof Error ? err.message : 'invalid JSON'}`);
      return { errors, warnings };
    }
  }

  for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (line.startsWith('#') || line.startsWith('//')) continue;
    const [kindPart, restPart] = splitOnce(line, ':');
    if (!restPart) {
      warnings.push(`Ignored custom logic line without a type: "${line}"`);
      continue;
    }

    const kind = kindPart.toLowerCase().trim();
    const rest = restPart.trim();

    if (kind === 'note') {
      const [card, note] = splitOnce(rest, '=');
      if (!card || !note) {
        warnings.push(`Ignored note line; expected "note: Card Name = text".`);
        continue;
      }
      base.cardNotes[normalizeName(card)] = note.trim();
      continue;
    }

    const parts = rest.split('|').map(p => p.trim()).filter(Boolean);
    if (kind === 'trigger') {
      if (parts.length < 3) {
        warnings.push(`Ignored trigger line; expected "trigger: Card | event | effect".`);
        continue;
      }
      base.triggers.push(normalizeTrigger({
        sourceCard: parts[0],
        event: parts[1],
        effect: parts[2],
        reminderText: parts[3] || parts[2],
      }, base.triggers.length));
    } else if (kind === 'replacement') {
      if (parts.length < 3) {
        warnings.push(`Ignored replacement line; expected "replacement: Card | event | replacement".`);
        continue;
      }
      base.replacementEffects.push(normalizeReplacement({
        sourceCard: parts[0],
        replaces: parts[1],
        replacement: parts[2],
      }, base.replacementEffects.length));
    } else if (kind === 'rule') {
      if (parts.length < 3) {
        warnings.push(`Ignored rule line; expected "rule: Name | card filter | effect".`);
        continue;
      }
      base.rules.push(normalizeRule({
        name: parts[0],
        cardFilter: parts[1],
        effect: parts[2],
        description: parts[2],
        applies: 'all',
        enabled: true,
      }, base.rules.length));
    } else {
      continue;
    }
  }

  return withOptionalLogic(base, errors, warnings);
}

function withOptionalLogic(logicFile: DeckLogic, errors: string[], warnings: string[]): DeckLogicParseResult {
  const hasLogic = logicFile.rules.length > 0 ||
    logicFile.replacementEffects.length > 0 ||
    logicFile.triggers.length > 0 ||
    Object.keys(logicFile.cardNotes).length > 0;
  return hasLogic ? { logicFile, errors, warnings } : { errors, warnings };
}

function normalizeRule(rule: Partial<CustomRule>, index: number): CustomRule {
  return {
    id: safeId(rule.id, `custom-rule-${index + 1}`),
    name: String(rule.name || `Custom Rule ${index + 1}`).trim(),
    description: String(rule.description || rule.effect || '').trim(),
    applies: ['all', 'controller', 'opponents', 'specific'].includes(String(rule.applies))
      ? rule.applies as CustomRule['applies']
      : 'all',
    specificPlayer: rule.specificPlayer,
    cardFilter: rule.cardFilter?.trim(),
    effect: String(rule.effect || rule.description || '').trim(),
    enabled: rule.enabled !== false,
  };
}

function normalizeReplacement(effect: Partial<ReplacementEffect>, index: number): ReplacementEffect {
  return {
    id: safeId(effect.id, `custom-replacement-${index + 1}`),
    sourceCard: normalizeName(String(effect.sourceCard || '')),
    replaces: String(effect.replaces || '').trim(),
    replacement: String(effect.replacement || '').trim(),
  };
}

function normalizeTrigger(trigger: Partial<CustomTrigger>, index: number): CustomTrigger {
  return {
    id: safeId(trigger.id, `custom-trigger-${index + 1}`),
    sourceCard: normalizeName(String(trigger.sourceCard || '')),
    event: String(trigger.event || '').trim(),
    effect: String(trigger.effect || '').trim(),
    reminderText: String(trigger.reminderText || trigger.effect || '').trim(),
  };
}

function safeId(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function splitOnce(value: string, separator: string): [string, string] | [string, undefined] {
  const idx = value.indexOf(separator);
  if (idx === -1) return [value, undefined];
  return [value.slice(0, idx), value.slice(idx + separator.length)];
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
 * Main import function — parses raw text and fetches card data.
 * Pass `playerId` to populate the DeckCache for that player so the NLP
 * command bar gets O(1) card-name lookups and trie-backed autocomplete.
 * Pass `customRulesText` if the player uploaded a house rules file —
 * keywords are parsed and stored in the cache immediately.
 */
export async function importDecklist(
  raw: string,
  deckName: string = 'Imported Deck',
  source?: string,
  playerId?: string,
  customRulesText?: string
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
  let fetchedDefs: Map<string, CardDefinition>;
  try {
    fetchedDefs = await fetchCardsByNames(allNames);
  } catch {
    warnings.push('Could not reach Scryfall — card validation skipped. Cards will load as placeholders.');
    fetchedDefs = new Map();
  }

  // ── Populate DeckCache for this player ─────────────────────────────────────────
  // Card names + keywords are indexed into the cache immediately so the
  // NLP command bar has full autocomplete without scanning game state.
  if (playerId && fetchedDefs.size > 0) {
    deckCache.ingest(playerId, fetchedDefs);
  }
  const deckId = crypto.randomUUID();
  let logicFile: DeckLogic | undefined;
  if (customRulesText) {
    deckCache.addCustomRules(customRulesText);
    const parsedLogic = parseDeckLogicFile(customRulesText, deckId);
    logicFile = parsedLogic.logicFile;
    errors.push(...parsedLogic.errors);
    warnings.push(...parsedLogic.warnings);
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

  if (logicFile) {
    warnings.push(...validateDeckLogicReferences(logicFile, allNames, fetchedDefs));
    const counts = [
      logicFile.rules.length ? `${logicFile.rules.length} custom rule${logicFile.rules.length === 1 ? '' : 's'}` : '',
      logicFile.triggers.length ? `${logicFile.triggers.length} custom trigger${logicFile.triggers.length === 1 ? '' : 's'}` : '',
      logicFile.replacementEffects.length ? `${logicFile.replacementEffects.length} replacement effect${logicFile.replacementEffects.length === 1 ? '' : 's'}` : '',
      Object.keys(logicFile.cardNotes).length ? `${Object.keys(logicFile.cardNotes).length} card note${Object.keys(logicFile.cardNotes).length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(', ');
    if (counts) warnings.push(`Custom logic loaded: ${counts}.`);
  }

  const deck: Deck = {
    id: deckId,
    name: deckName,
    format: 'commander',
    commanders,
    cards: [...mainMap.entries()].map(([name, count]) => ({ name, count })),
    sideboard: [...sideMap.entries()].map(([name, count]) => ({ name, count })),
    maybeboard: [...maybeMap.entries()].map(([name, count]) => ({ name, count })),
    colorIdentity: [],
    importSource: source,
    importedAt: Date.now(),
    logicFile,
  };

  return { deck, errors, warnings, commanders, cardCount };
}

function validateDeckLogicReferences(
  logicFile: DeckLogic,
  importedNames: string[],
  fetchedDefs: Map<string, CardDefinition>
): string[] {
  const warnings: string[] = [];
  const names = new Set(importedNames.map(n => n.toLowerCase()));
  const hasCard = (name: string) => names.has(name.toLowerCase());

  for (const [cardName] of Object.entries(logicFile.cardNotes)) {
    if (!hasCard(cardName)) warnings.push(`Custom note references "${cardName}", which is not in this deck.`);
  }
  for (const trigger of logicFile.triggers) {
    if (!trigger.sourceCard || !trigger.event || !trigger.effect) {
      warnings.push(`Custom trigger "${trigger.id}" is missing sourceCard, event, or effect.`);
    } else if (!hasCard(trigger.sourceCard)) {
      warnings.push(`Custom trigger "${trigger.id}" references "${trigger.sourceCard}", which is not in this deck.`);
    }
  }
  for (const replacement of logicFile.replacementEffects) {
    if (!replacement.sourceCard || !replacement.replaces || !replacement.replacement) {
      warnings.push(`Replacement effect "${replacement.id}" is missing sourceCard, replaces, or replacement.`);
    } else if (!hasCard(replacement.sourceCard)) {
      warnings.push(`Replacement effect "${replacement.id}" references "${replacement.sourceCard}", which is not in this deck.`);
    }
  }
  for (const rule of logicFile.rules) {
    if (!rule.name || !rule.effect) {
      warnings.push(`Custom rule "${rule.id}" is missing a name or effect.`);
    }
    if (rule.cardFilter) {
      const filter = rule.cardFilter.toLowerCase();
      const matches = importedNames.some(name => {
        const def = fetchedDefs.get(name);
        return name.toLowerCase().includes(filter) ||
          def?.typeLine.toLowerCase().includes(filter) ||
          def?.oracleText.toLowerCase().includes(filter);
      });
      if (!matches) warnings.push(`Custom rule "${rule.name}" filter "${rule.cardFilter}" did not match any imported cards.`);
    }
  }

  return warnings;
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
