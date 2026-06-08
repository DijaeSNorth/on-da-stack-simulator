import type { CardDefinition, CardType, ManaColor, SuperType } from '../types/game';

const SCRYFALL_BASE = 'https://api.scryfall.com';
const SCRYFALL_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'On-Da-Stack Simulator/1.0',
};

interface ScryfallTokenCard {
  id: string;
  oracle_id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  power?: string;
  toughness?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  image_uris?: {
    normal?: string;
    large?: string;
    art_crop?: string;
    border_crop?: string;
  };
  card_faces?: Array<{
    name?: string;
    type_line?: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    colors?: string[];
    image_uris?: {
      normal?: string;
      large?: string;
      art_crop?: string;
      border_crop?: string;
    };
  }>;
}

interface ScryfallSearchResponse {
  data?: ScryfallTokenCard[];
}

const CARD_TYPES: CardType[] = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle', 'Tribal'];
const SUPER_TYPES: SuperType[] = ['Legendary', 'Basic', 'Snow', 'World', 'Historic'];
const COLOR_WORDS: Record<string, ManaColor> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
  colorless: 'C',
};

const TOKEN_CACHE = new Map<string, CardDefinition | null>();
const TOKEN_PENDING = new Map<string, Promise<CardDefinition | null>>();

export function buildScryfallTokenSearchUrl(query: string): string {
  const clean = cleanTokenQuery(query);
  const words = clean
    .replace(/\btoken(s)?\b/gi, '')
    .split(/\s+/)
    .map(word => word.trim())
    .filter(Boolean)
    .join(' ');
  const q = `is:token ${words}`;
  return `${SCRYFALL_BASE}/cards/search?q=${encodeURIComponent(q)}&unique=cards&order=name&include_extras=true`;
}

export async function fetchScryfallTokenDefinition(query: string): Promise<CardDefinition | null> {
  const cacheKey = cleanTokenQuery(query).toLowerCase();
  if (!cacheKey) return null;
  if (TOKEN_CACHE.has(cacheKey)) return TOKEN_CACHE.get(cacheKey) ?? null;
  if (TOKEN_PENDING.has(cacheKey)) return TOKEN_PENDING.get(cacheKey)!;

  const request = (async () => {
    try {
      const res = await fetch(buildScryfallTokenSearchUrl(cacheKey), { headers: SCRYFALL_HEADERS });
      if (!res.ok) return null;
      const data = await res.json() as ScryfallSearchResponse;
      const match = chooseBestTokenMatch(cacheKey, data.data ?? []);
      const definition = match ? scryfallTokenToDefinition(match) : null;
      TOKEN_CACHE.set(cacheKey, definition);
      return definition;
    } catch {
      TOKEN_CACHE.set(cacheKey, null);
      return null;
    } finally {
      TOKEN_PENDING.delete(cacheKey);
    }
  })();

  TOKEN_PENDING.set(cacheKey, request);
  return request;
}

export function scryfallTokenToDefinition(card: ScryfallTokenCard): CardDefinition {
  const face = card.card_faces?.[0];
  const typeLine = face?.type_line || card.type_line || 'Token';
  const typeParts = parseTypeLine(typeLine);
  const colors = normalizeColors(face?.colors ?? card.colors ?? inferColors(typeLine));
  const imageUrl = card.image_uris?.normal
    || card.image_uris?.large
    || face?.image_uris?.normal
    || face?.image_uris?.large;

  return {
    id: card.oracle_id || card.id,
    name: stripTokenSuffix(face?.name || card.name),
    cmc: 0,
    typeLine,
    superTypes: typeParts.superTypes,
    cardTypes: typeParts.cardTypes.length ? typeParts.cardTypes : ['Creature'],
    subTypes: typeParts.subTypes,
    oracleText: face?.oracle_text || card.oracle_text || '',
    power: face?.power || card.power,
    toughness: face?.toughness || card.toughness,
    colors,
    colorIdentity: normalizeColors(card.color_identity ?? colors),
    keywords: card.keywords ?? [],
    imageUrl,
    isDoubleFaced: false,
    legalities: {},
  };
}

function chooseBestTokenMatch(query: string, cards: ScryfallTokenCard[]): ScryfallTokenCard | null {
  if (cards.length === 0) return null;
  const normalizedQuery = normalizeForScore(stripTokenSuffix(query));
  return [...cards].sort((a, b) => scoreTokenMatch(normalizedQuery, b) - scoreTokenMatch(normalizedQuery, a))[0] ?? null;
}

function scoreTokenMatch(query: string, card: ScryfallTokenCard): number {
  const name = normalizeForScore(stripTokenSuffix(card.card_faces?.[0]?.name || card.name));
  const typeLine = normalizeForScore(card.card_faces?.[0]?.type_line || card.type_line || '');
  if (name === query) return 100;
  if (name.startsWith(query)) return 90;
  if (name.includes(query)) return 80;
  if (typeLine.includes(query)) return 70;
  const words = query.split(/\s+/).filter(Boolean);
  return words.reduce((score, word) => score + (name.includes(word) || typeLine.includes(word) ? 8 : 0), 0);
}

function cleanTokenQuery(query: string): string {
  return query
    .trim()
    .replace(/^(?:create|make|generate|add)\s+/i, '')
    .replace(/^(?:(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?/i, '')
    .replace(/^(?:custom\s+)?tokens?\s*(?:named|called|of|for)?\s*/i, '')
    .replace(/\s+tokens?$/i, '')
    .trim();
}

function stripTokenSuffix(name: string): string {
  return name.replace(/\s+token$/i, '').trim();
}

function parseTypeLine(typeLine: string): { superTypes: SuperType[]; cardTypes: CardType[]; subTypes: string[] } {
  const [beforeDash = '', afterDash = ''] = typeLine.split(/[—-]/).map(part => part.trim());
  const words = beforeDash.split(/\s+/).filter(Boolean);
  return {
    superTypes: words.filter(word => SUPER_TYPES.includes(word as SuperType)) as SuperType[],
    cardTypes: words.filter(word => CARD_TYPES.includes(word as CardType)) as CardType[],
    subTypes: afterDash.split(/\s+/).filter(Boolean),
  };
}

function inferColors(text: string): ManaColor[] {
  const lower = text.toLowerCase();
  const colors = Object.entries(COLOR_WORDS)
    .filter(([word]) => lower.includes(word))
    .map(([, color]) => color);
  return [...new Set(colors)];
}

function normalizeColors(colors: string[]): ManaColor[] {
  return colors.filter((color): color is ManaColor => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color));
}

function normalizeForScore(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 /-]/g, '').replace(/\s+/g, ' ').trim();
}
