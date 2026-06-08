// ─── Deck Import Engine ───────────────────────────────────────────────────────
import type {
  CardDefinition,
  CustomCardDefinition,
  CustomRule,
  CustomTrigger,
  Deck,
  DeckLogic,
  ReplacementEffect,
} from '../types/game';
import { fetchCardsByNames, getBannedReason } from '../data/cardDatabase';
import { deckCache } from './deckCache';

export interface ImportResult {
  deck: Deck;
  errors: string[];
  warnings: string[];
  commanders: string[];
  cardCount: number;
}

export interface DeckFileImportResult {
  deck?: Deck;
  deckText?: string;
  logicText?: string;
  warnings: string[];
  error?: string;
}

export interface PreparedCommanderDeck {
  deck: Deck;
  valid: boolean;
  errors: string[];
  warnings: string[];
  mainDeckCount: number;
  commanderCount: number;
  totalCommanderCount: number;
  deckHash: string;
}

export interface ImportOptions {
  allowBannedCards?: boolean;
  captureFetchedCardData?: boolean;
}

// ─── Format Parsers ───────────────────────────────────────────────────────────

interface ParsedEntry {
  count: number;
  name: string;
  section: 'main' | 'sideboard' | 'maybeboard' | 'commander';
}

const MAX_COMMANDERS = 2;
const MAX_DECKLIST_CHARS = 250_000;
const MAX_COPIES_PER_LINE = 250;

/**
 * Normalize a card name from any common variation
 */
function normalizeName(name: string): string {
  return name
    .replace(/\s*\/\/\s*/g, ' // ') // DFC separator
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSectionHeader(line: string): ParsedEntry['section'] | null {
  const header = line
    .replace(/^\[(.+)\]$/, '$1')
    .replace(/:$/, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (/^(commander|commanders|general|generals)$/.test(header)) return 'commander';
  if (/^(main|main deck|mainboard|main board|deck|decklist|library)$/.test(header)) return 'main';
  if (/^(sideboard|side board|side|sb)$/.test(header)) return 'sideboard';
  if (/^(maybeboard|maybe board|maybe|mb|considering)$/.test(header)) return 'maybeboard';
  if (/^companion$/.test(header)) return 'sideboard';

  if (/^(creature|creatures|instant|instants|sorcery|sorceries|artifact|artifacts|enchantment|enchantments|planeswalker|planeswalkers|land|lands|battle|battles)$/.test(header)) {
    return 'main';
  }

  return null;
}

/**
 * Parse Moxfield / MTGO / generic text format
 * Supports:
 *   1x Card Name
 *   1 Card Name
 *   Card Name (set) #num
 *   Section headers: Commander, Sideboard, Maybeboard
 */
function parseTextDecklist(raw: string, warnings?: string[]): ParsedEntry[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const entries: ParsedEntry[] = [];
  let currentSection: ParsedEntry['section'] = 'main';

  for (const line of lines) {
    const section = parseSectionHeader(line);
    if (section) {
      currentSection = section;
      continue;
    }

    // Section headers
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
      continue;
    }

    warnings?.push(`Ignored unrecognized decklist line: "${line.slice(0, 80)}"`);
  }

  return entries;
}

/**
 * Parse CSV format: Name,Count or Count,Name
 */
function parseCSVDecklist(raw: string, warnings?: string[]): ParsedEntry[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const entries: ParsedEntry[] = [];

  for (const line of lines) {
    if (line.toLowerCase().startsWith('name') || line.toLowerCase().startsWith('card')) continue;
    const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
    if (parts.length < 2) {
      warnings?.push(`Ignored malformed CSV deck line: "${line.slice(0, 80)}"`);
      continue;
    }

    const a = parts[0], b = parts[1];
    if (!isNaN(Number(a))) {
      entries.push({ count: Number(a), name: normalizeName(b), section: 'main' });
    } else if (!isNaN(Number(b))) {
      entries.push({ count: Number(b), name: normalizeName(a), section: 'main' });
    } else {
      warnings?.push(`Ignored malformed CSV deck line: "${line.slice(0, 80)}"`);
    }
  }

  return entries;
}

/**
 * Detect format and parse
 */
function parseRaw(raw: string, warnings?: string[]): ParsedEntry[] {
  const trimmed = raw.trim();

  // CSV detection
  if (trimmed.includes(',') && !trimmed.includes('\n// ')) {
    const csvWarnings: string[] = [];
    const csvEntries = parseCSVDecklist(trimmed, csvWarnings);
    if (csvEntries.length > 0) {
      warnings?.push(...csvWarnings);
      return csvEntries;
    }
  }

  return parseTextDecklist(trimmed, warnings);
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function readXmlAttribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeXmlAttribute(match[1]) : undefined;
}

function deckSectionsToText(sections: {
  commander?: ParsedEntry[];
  main?: ParsedEntry[];
  sideboard?: ParsedEntry[];
  maybeboard?: ParsedEntry[];
}): string {
  const lines: string[] = [];
  const addSection = (label: string, entries: ParsedEntry[] = []) => {
    if (entries.length === 0) return;
    if (lines.length > 0) lines.push('');
    lines.push(label);
    for (const entry of entries) lines.push(`${entry.count} ${entry.name}`);
  };
  addSection('Commander', sections.commander);
  addSection('Deck', sections.main);
  addSection('Sideboard', sections.sideboard);
  addSection('Maybeboard', sections.maybeboard);
  return lines.join('\n');
}

function parseXmlDeckText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^<\?xml|^<deck|^<cockatrice_deck/i.test(trimmed)) return null;

  const sections: Record<ParsedEntry['section'], ParsedEntry[]> = {
    commander: [],
    main: [],
    sideboard: [],
    maybeboard: [],
  };

  const addCard = (section: ParsedEntry['section'], name?: string, countValue?: string | number) => {
    const cardName = normalizeName(name ?? '');
    if (!cardName) return;
    const parsedCount = typeof countValue === 'number' ? countValue : Number.parseInt(String(countValue ?? '1'), 10);
    const count = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1;
    sections[section].push({ section, name: cardName, count });
  };

  const zoneRegex = /<zone\b[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/zone>/gi;
  let zoneMatch: RegExpExecArray | null;
  while ((zoneMatch = zoneRegex.exec(trimmed)) !== null) {
    const zoneName = zoneMatch[1].toLowerCase();
    const section: ParsedEntry['section'] =
      /command|commander|general/.test(zoneName) ? 'commander'
        : /side/.test(zoneName) ? 'sideboard'
          : /maybe/.test(zoneName) ? 'maybeboard'
            : 'main';
    const cardTags = zoneMatch[2].match(/<card\b[^>]*\/?>/gi) ?? [];
    for (const tag of cardTags) {
      addCard(section, readXmlAttribute(tag, 'name'), readXmlAttribute(tag, 'number') ?? readXmlAttribute(tag, 'quantity'));
    }
  }

  const standaloneCards = trimmed.match(/<Cards?\b[^>]*\/?>/gi) ?? [];
  for (const tag of standaloneCards) {
    const sideboard = /^(true|1|yes)$/i.test(readXmlAttribute(tag, 'Sideboard') ?? '');
    addCard(sideboard ? 'sideboard' : 'main', readXmlAttribute(tag, 'Name') ?? readXmlAttribute(tag, 'name'), readXmlAttribute(tag, 'Quantity') ?? readXmlAttribute(tag, 'number'));
  }

  const text = deckSectionsToText(sections);
  return text.trim() ? text : null;
}

function readJsonCardName(value: unknown, fallbackName?: string): string {
  if (typeof value === 'string') return normalizeName(value);
  if (!value || typeof value !== 'object') return normalizeName(fallbackName ?? '');
  const item = value as Record<string, unknown>;
  const card = item.card && typeof item.card === 'object' ? item.card as Record<string, unknown> : undefined;
  const oracleCard = card?.oracleCard && typeof card.oracleCard === 'object' ? card.oracleCard as Record<string, unknown> : undefined;
  return normalizeName(
    String(
      item.name ??
      item.cardName ??
      card?.name ??
      oracleCard?.name ??
      fallbackName ??
      '',
    ),
  );
}

function readJsonCardCount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (!value || typeof value !== 'object') return 1;
  const item = value as Record<string, unknown>;
  const raw = item.count ?? item.quantity ?? item.qty ?? item.number ?? item.amount;
  const parsed = Number.parseInt(String(raw ?? '1'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function extractJsonEntries(value: unknown, section: ParsedEntry['section']): ParsedEntry[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map(item => ({ section, name: readJsonCardName(item), count: readJsonCardCount(item) }))
      .filter(entry => entry.name);
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => ({ section, name: readJsonCardName(item, key), count: readJsonCardCount(item) }))
      .filter(entry => entry.name);
  }
  return [];
}

function parseJsonDeckText(parsed: Record<string, unknown>): string | null {
  const source = (parsed.deck && typeof parsed.deck === 'object')
    ? parsed.deck as Record<string, unknown>
    : parsed;
  const sections = {
    commander: [
      ...extractJsonEntries(source.commanders, 'commander'),
      ...extractJsonEntries(source.generals, 'commander'),
      ...extractJsonEntries(source.commandZone, 'commander'),
    ],
    main: [
      ...extractJsonEntries(source.mainboard, 'main'),
      ...extractJsonEntries(source.mainBoard, 'main'),
      ...extractJsonEntries(source.main, 'main'),
      ...extractJsonEntries(source.cards, 'main'),
      ...extractJsonEntries(source.decklist, 'main'),
    ],
    sideboard: [
      ...extractJsonEntries(source.sideboard, 'sideboard'),
      ...extractJsonEntries(source.sideBoard, 'sideboard'),
    ],
    maybeboard: [
      ...extractJsonEntries(source.maybeboard, 'maybeboard'),
      ...extractJsonEntries(source.maybeBoard, 'maybeboard'),
    ],
  };
  const text = deckSectionsToText(sections);
  return text.trim() ? text : null;
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
    customCards: [],
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
      const rawCustomCards = Array.isArray(payload.customCards)
        ? payload.customCards
        : Array.isArray(payload.cards) ? payload.cards : [];

      base.rules = rawRules.map((rule: Partial<CustomRule>, index: number) => normalizeRule(rule, index));
      base.replacementEffects = rawReplacements.map((effect: Partial<ReplacementEffect>, index: number) =>
        normalizeReplacement(effect, index)
      );
      base.triggers = rawTriggers.map((trigger: Partial<CustomTrigger>, index: number) =>
        normalizeTrigger(trigger, index)
      );
      base.customCards = rawCustomCards
        .map((card: Partial<CustomCardDefinition>, index: number) => normalizeCustomCard(card, index))
        .filter((card: CustomCardDefinition | null): card is CustomCardDefinition => Boolean(card));

      if (payload.cardNotes && typeof payload.cardNotes === 'object' && !Array.isArray(payload.cardNotes)) {
        base.cardNotes = Object.fromEntries(
          Object.entries(payload.cardNotes)
            .filter(([card, note]) => String(card).trim() && typeof note === 'string' && note.trim())
            .map(([card, note]) => [normalizeName(String(card)), String(note).trim()])
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
    if (kind === 'card') {
      if (parts.length < 2) {
        warnings.push(`Ignored card line; expected "card: Name | Type Line | optional text | optional power/toughness".`);
        continue;
      }
      const [power, toughness] = parts[3]?.includes('/') ? parts[3].split('/').map(p => p.trim()) : [];
      base.customCards.push(normalizeCustomCard({
        name: parts[0],
        typeLine: parts[1],
        oracleText: parts[2] || '',
        power,
        toughness,
      }, base.customCards.length) as CustomCardDefinition);
    } else if (kind === 'trigger') {
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
    logicFile.customCards.length > 0 ||
    Object.keys(logicFile.cardNotes).length > 0;
  return hasLogic ? { logicFile, errors, warnings } : { errors, warnings };
}

function normalizeCustomCard(card: Partial<CustomCardDefinition>, index: number): CustomCardDefinition | null {
  const name = normalizeName(String(card.name || ''));
  if (!name) return null;
  const rawCost = card.manaCost?.raw ? String(card.manaCost.raw).trim() : undefined;
  return {
    id: safeId(card.id, `custom-card-${index + 1}`),
    name,
    manaCost: rawCost ? { ...card.manaCost, raw: rawCost } : card.manaCost,
    cmc: typeof card.cmc === 'number' && Number.isFinite(card.cmc) ? card.cmc : undefined,
    typeLine: String(card.typeLine || 'Creature').trim(),
    oracleText: String(card.oracleText || '').trim(),
    power: card.power !== undefined ? String(card.power).trim() : undefined,
    toughness: card.toughness !== undefined ? String(card.toughness).trim() : undefined,
    loyalty: typeof card.loyalty === 'number' && Number.isFinite(card.loyalty) ? card.loyalty : undefined,
    colors: Array.isArray(card.colors) ? card.colors : undefined,
    colorIdentity: Array.isArray(card.colorIdentity) ? card.colorIdentity : undefined,
    keywords: Array.isArray(card.keywords) ? card.keywords.map(k => String(k).trim()).filter(Boolean) : undefined,
    imageUrl: card.imageUrl,
    imageUrlBack: card.imageUrlBack,
    isDoubleFaced: card.isDoubleFaced === true || (Array.isArray(card.faces) && card.faces.length >= 2),
    faces: Array.isArray(card.faces) ? card.faces : undefined,
  };
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

function clampCommanders(names: string[], warnings: string[], source: 'explicit' | 'auto'): string[] {
  const unique = uniqueCommanderNames(names);
  if (unique.length <= MAX_COMMANDERS) return unique;
  const kept = unique.slice(0, MAX_COMMANDERS);
  warnings.push(source === 'explicit'
    ? `Commander section contained ${unique.length} unique cards. Only ${kept.join(' and ')} will be treated as commanders; the rest remain in the deck.`
    : `Auto-detected ${unique.length} possible commanders. Only ${kept.join(' and ')} will be treated as commanders; choose commanders manually if needed.`);
  return kept;
}

function uniqueCommanderNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const seen = new Set<string>();
  const commanders: string[] = [];
  for (const value of names) {
    const name = normalizeName(String(value ?? ''));
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    commanders.push(name);
  }
  return commanders;
}

function normalizeDeckEntries(entries: unknown): Deck['cards'] {
  if (!Array.isArray(entries)) return [];
  const normalized: Deck['cards'] = [];
  for (const entry of entries) {
    const item = entry as Partial<Deck['cards'][number]>;
    const name = normalizeName(String(item?.name ?? ''));
    const count = Math.min(MAX_COPIES_PER_LINE, Math.max(0, Math.floor(Number(item?.count ?? 0))));
    if (name && count > 0) normalized.push({ name, count });
  }
  return normalized;
}

function mergeDeckEntries(entries: Deck['cards']): Deck['cards'] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const entry of entries) {
    const name = normalizeName(entry.name);
    const count = Math.max(0, Math.floor(Number(entry.count) || 0));
    if (!name || count <= 0) continue;
    const key = name.toLowerCase();
    const existing = counts.get(key);
    counts.set(key, { name: existing?.name ?? name, count: (existing?.count ?? 0) + count });
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeCommanderDeck(deck: unknown): Deck {
  const raw = (deck && typeof deck === 'object' ? deck : {}) as Partial<Deck>;
  const commanders = uniqueCommanderNames(raw.commanders).slice(0, MAX_COMMANDERS);
  const cards = normalizeDeckEntries(raw.cards);
  const sideboard = normalizeDeckEntries(raw.sideboard);
  const maybeboard = normalizeDeckEntries(raw.maybeboard);

  for (const commander of commanders) {
    if (!cards.some(card => card.name.toLowerCase() === commander.toLowerCase())) {
      cards.unshift({ name: commander, count: 1 });
    }
  }

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : crypto.randomUUID(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Imported Deck',
    format: 'commander',
    commanders,
    cards,
    sideboard,
    maybeboard,
    colorIdentity: Array.isArray(raw.colorIdentity) ? raw.colorIdentity : [],
    importSource: raw.importSource,
    importedAt: typeof raw.importedAt === 'number' ? raw.importedAt : Date.now(),
    logicFile: raw.logicFile,
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createCommanderDeckHash(deck: Pick<Deck, 'cards' | 'commanders'>): string {
  return hashText(stableStringify({
    commanderNames: uniqueCommanderNames(deck.commanders).sort((a, b) => a.localeCompare(b)),
    cards: mergeDeckEntries(normalizeDeckEntries(deck.cards)),
  }));
}

export function prepareCommanderDeckForUse(deck: Deck): PreparedCommanderDeck {
  const requestedCommanders = uniqueCommanderNames(deck.commanders);
  const normalized = normalizeCommanderDeck(deck);
  const errors: string[] = [];
  const warnings: string[] = [];
  const commanders = uniqueCommanderNames(normalized.commanders);
  const cardsWithCommanders = [...normalized.cards];

  for (const commander of commanders) {
    if (!cardsWithCommanders.some(card => card.name.toLowerCase() === commander.toLowerCase())) {
      cardsWithCommanders.push({ name: commander, count: 1 });
    }
  }

  const canonicalDeck: Deck = {
    ...normalized,
    commanders,
    cards: mergeDeckEntries(cardsWithCommanders),
    sideboard: mergeDeckEntries(normalized.sideboard),
    maybeboard: mergeDeckEntries(normalized.maybeboard),
  };
  const totalCommanderCount = canonicalDeck.cards.reduce((sum, card) => sum + card.count, 0);
  const commanderNameSet = new Set(commanders.map(name => name.toLowerCase()));
  const mainDeckCount = canonicalDeck.cards
    .filter(card => !commanderNameSet.has(card.name.toLowerCase()))
    .reduce((sum, card) => sum + card.count, 0);
  const commanderCount = requestedCommanders.length || commanders.length;

  if (commanderCount === 0) errors.push('Missing commander. Add one commander card to the Commander section.');
  if (commanderCount > MAX_COMMANDERS) errors.push(`Too many commanders. Commander allows one commander, or two only when both cards can be partners/backgrounds; found ${commanderCount}.`);
  if (totalCommanderCount !== 100) errors.push(`Card count not 100. This deck has ${totalCommanderCount} cards including commanders.`);

  return {
    deck: canonicalDeck,
    valid: errors.length === 0,
    errors,
    warnings,
    mainDeckCount,
    commanderCount,
    totalCommanderCount,
    deckHash: createCommanderDeckHash(canonicalDeck),
  };
}

function sanitizeParsedEntries(entries: ParsedEntry[], warnings: string[]): ParsedEntry[] {
  const cleaned: ParsedEntry[] = [];
  for (const entry of entries) {
    if (!entry.name) continue;
    if (!Number.isFinite(entry.count) || entry.count <= 0) {
      warnings.push(`Ignored "${entry.name}" because its quantity was not positive.`);
      continue;
    }
    const count = Math.floor(entry.count);
    if (count > MAX_COPIES_PER_LINE) {
      warnings.push(`Clamped "${entry.name}" from ${count} copies to ${MAX_COPIES_PER_LINE}. Check that line for a typo.`);
      cleaned.push({ ...entry, count: MAX_COPIES_PER_LINE });
      continue;
    }
    cleaned.push({ ...entry, count });
  }
  return cleaned;
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
  customRulesText?: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (raw.length > MAX_DECKLIST_CHARS) {
    errors.push(`Decklist is too large to import safely (${raw.length.toLocaleString()} characters). Export a plain-text decklist and try again.`);
    return {
      deck: createEmptyDeck(deckName),
      errors, warnings, commanders: [], cardCount: 0,
    };
  }

  const entries = sanitizeParsedEntries(parseRaw(raw, warnings), warnings);

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
  if (options.captureFetchedCardData && fetchedDefs.size > 0) {
    logicFile = withCapturedCardDefinitions(logicFile, deckId, fetchedDefs);
  }

  // Check for cards not found
  for (const name of allNames) {
    if (!fetchedDefs.has(name)) {
      warnings.push(`"${name}" could not be found — it will appear as a placeholder.`);
    }
  }

  if (!options.allowBannedCards) {
    for (const [, def] of fetchedDefs) {
      const reason = getBannedReason(def);
      if (reason) warnings.push(`${reason} Enable "Allow Banned Cards" if this is intentional Rule Zero tech.`);
    }
  }

  // Auto-detect commanders: legendary creatures in main deck when no explicit commander section
  let commanders = clampCommanders([...commanderSet], warnings, 'explicit');
  if (commanders.length === 0) {
    const candidates: string[] = [];
    for (const [name] of mainMap) {
      const def = fetchedDefs.get(name);
      if (def && def.superTypes.includes('Legendary') &&
        (def.cardTypes.includes('Creature') || def.cardTypes.includes('Planeswalker'))) {
        candidates.push(name);
      }
    }
    commanders = clampCommanders(candidates, warnings, 'auto');
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
      logicFile.customCards.length ? `${logicFile.customCards.length} custom card${logicFile.customCards.length === 1 ? '' : 's'}` : '',
      logicFile.rules.length ? `${logicFile.rules.length} custom rule${logicFile.rules.length === 1 ? '' : 's'}` : '',
      logicFile.triggers.length ? `${logicFile.triggers.length} custom trigger${logicFile.triggers.length === 1 ? '' : 's'}` : '',
      logicFile.replacementEffects.length ? `${logicFile.replacementEffects.length} replacement effect${logicFile.replacementEffects.length === 1 ? '' : 's'}` : '',
      Object.keys(logicFile.cardNotes).length ? `${Object.keys(logicFile.cardNotes).length} card note${Object.keys(logicFile.cardNotes).length === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(', ');
    if (counts) warnings.push(`Custom logic loaded: ${counts}.`);
  }

  const deck: Deck = normalizeCommanderDeck({
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
  });

  return { deck, errors, warnings, commanders, cardCount };
}

function withCapturedCardDefinitions(
  logicFile: DeckLogic | undefined,
  deckId: string,
  fetchedDefs: Map<string, CardDefinition>
): DeckLogic {
  const base: DeckLogic = logicFile ?? {
    deckId,
    rules: [],
    replacementEffects: [],
    cardNotes: {},
    triggers: [],
    customCards: [],
  };
  const existing = new Set(base.customCards.map(card => card.name.toLowerCase()));
  const captured = [...fetchedDefs.values()]
    .filter(def => !existing.has(def.name.toLowerCase()))
    .map(definitionToCustomCard);
  return {
    ...base,
    deckId,
    customCards: [...base.customCards, ...captured],
  };
}

function definitionToCustomCard(def: CardDefinition): CustomCardDefinition {
  return {
    id: `scryfall-${def.id}`,
    name: def.name,
    manaCost: def.manaCost,
    cmc: def.cmc,
    typeLine: def.typeLine,
    oracleText: def.oracleText,
    power: def.power,
    toughness: def.toughness,
    loyalty: def.loyalty,
    colors: def.colors,
    colorIdentity: def.colorIdentity,
    keywords: def.keywords,
    imageUrl: def.imageUrl,
    imageUrlBack: def.imageUrlBack,
    isDoubleFaced: def.isDoubleFaced,
    faces: def.faces,
  };
}

function validateDeckLogicReferences(
  logicFile: DeckLogic,
  importedNames: string[],
  fetchedDefs: Map<string, CardDefinition>
): string[] {
  const warnings: string[] = [];
  const customCardNames = new Set(logicFile.customCards.map(card => card.name.toLowerCase()));
  const names = new Set([...importedNames.map(n => n.toLowerCase()), ...customCardNames]);
  const hasCard = (name: string) => names.has(name.toLowerCase());

  for (const customCard of logicFile.customCards) {
    if (!customCard.name || !customCard.typeLine) {
      warnings.push(`Custom card "${customCard.id ?? 'unknown'}" is missing a name or typeLine.`);
    }
    if (!importedNames.some(name => name.toLowerCase() === customCard.name.toLowerCase())) {
      warnings.push(`Custom card "${customCard.name}" is defined but is not in this decklist.`);
    }
  }
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

export function parseDeckFilePayload(text: string, fallbackName = 'Imported Deck File'): DeckFileImportResult {
  const trimmed = text.trim();
  if (!trimmed) return { warnings: [], error: 'The selected file is empty.' };
  if (trimmed.length > MAX_DECKLIST_CHARS) {
    return {
      warnings: [],
      error: `The selected file is too large to import safely (${trimmed.length.toLocaleString()} characters).`,
    };
  }

  const xmlDeckText = parseXmlDeckText(trimmed);
  if (xmlDeckText) {
    return {
      deckText: xmlDeckText,
      warnings: ['Converted XML deck file to plain text for validation.'],
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const deckLike = parsed?.deck;
    if (deckLike && typeof deckLike === 'object') {
      const deck = normalizeCommanderDeck(deckLike as Deck);
      return {
        deck: { ...deck, name: deck.name || fallbackName },
        deckText: typeof parsed.deckText === 'string' ? parsed.deckText : exportDeckAsText(deck),
        logicText: typeof parsed.logicText === 'string' ? parsed.logicText : undefined,
        warnings: [],
      };
    }
    if (typeof parsed?.deckText === 'string' && parsed.deckText.trim()) {
      return {
        deckText: parsed.deckText,
        logicText: typeof parsed.logicText === 'string' ? parsed.logicText : undefined,
        warnings: ['Deck file did not include a saved deck object, so its text export was loaded into the importer.'],
      };
    }
    const jsonDeckText = parseJsonDeckText(parsed);
    if (jsonDeckText) {
      return {
        deckText: jsonDeckText,
        warnings: ['Converted JSON deck file to plain text for validation.'],
      };
    }
    return {
      warnings: [],
      error: 'This JSON file does not look like a supported deck export.',
    };
  } catch {
    return {
      deckText: text,
      warnings: ['File was not JSON, so it was loaded as a plain-text decklist.'],
    };
  }
}

const DECKS_KEY = 'mtg_sim_decks';
const FAVORITE_DECKS_KEY = 'mtg_sim_favorite_decks';
export const MAX_STORED_DECKS = 3;
export const MAX_FAVORITE_DECKS = 2;

export function loadFavoriteDeckIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITE_DECKS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string').slice(0, MAX_FAVORITE_DECKS)
      : [];
  } catch {
    return [];
  }
}

export function saveFavoriteDeckIds(deckIds: string[]): void {
  try {
    localStorage.setItem(FAVORITE_DECKS_KEY, JSON.stringify([...new Set(deckIds)].slice(0, MAX_FAVORITE_DECKS)));
  } catch {
    // Storage full or unavailable
  }
}

export function toggleFavoriteDeck(deckId: string): string[] {
  const favorites = loadFavoriteDeckIds();
  if (favorites.includes(deckId)) {
    const next = favorites.filter(id => id !== deckId);
    saveFavoriteDeckIds(next);
    return next;
  }
  if (favorites.length >= MAX_FAVORITE_DECKS) return favorites;
  const next = [...favorites, deckId];
  saveFavoriteDeckIds(next);
  return next;
}

function limitStoredDecks(decks: unknown): Deck[] {
  const favorites = new Set(loadFavoriteDeckIds());
  const list = Array.isArray(decks) ? decks : [];
  return list
    .map(deck => normalizeCommanderDeck(deck))
    .sort((a, b) => {
      const favoriteDelta = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
      if (favoriteDelta !== 0) return favoriteDelta;
      return (b.importedAt || 0) - (a.importedAt || 0);
    })
    .slice(0, MAX_STORED_DECKS);
}

export function saveDecksToStorage(decks: Deck[]): void {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(limitStoredDecks(decks)));
  } catch {
    // Storage full or unavailable
  }
}

export function loadDecksFromStorage(): Deck[] {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    return raw ? limitStoredDecks(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveDeck(deck: Deck): void {
  const canonicalDeck = prepareCommanderDeckForUse(deck).deck;
  const decks = loadDecksFromStorage();
  const idx = decks.findIndex(d => d.id === canonicalDeck.id);
  if (idx >= 0) decks[idx] = canonicalDeck;
  else decks.push(canonicalDeck);
  saveDecksToStorage(limitStoredDecks(decks));
}

export function deleteDeck(id: string): void {
  const decks = loadDecksFromStorage().filter(d => d.id !== id);
  saveFavoriteDeckIds(loadFavoriteDeckIds().filter(deckId => deckId !== id));
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
