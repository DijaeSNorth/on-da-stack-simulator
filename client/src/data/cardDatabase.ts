// ─── Scryfall API Integration & Card Lookup ──────────────────────────────────
import type { CardDefinition, ManaCost, ManaColor, CardType, SuperType } from '../types/game';

const SCRYFALL_BASE = 'https://api.scryfall.com';

// Simple in-memory cache
const cardCache = new Map<string, CardDefinition>();
const pendingRequests = new Map<string, Promise<CardDefinition | null>>();

export function parseMana(manaCostStr: string): ManaCost {
  const raw = manaCostStr || '';
  let cmc = 0;
  const result: ManaCost = { raw, cmc: 0 };
  const matches = raw.matchAll(/\{([^}]+)\}/g);
  for (const match of matches) {
    const sym = match[1];
    if (sym === 'X') { result.X = true; }
    else if (sym === 'W') { result.W = (result.W || 0) + 1; cmc += 1; }
    else if (sym === 'U') { result.U = (result.U || 0) + 1; cmc += 1; }
    else if (sym === 'B') { result.B = (result.B || 0) + 1; cmc += 1; }
    else if (sym === 'R') { result.R = (result.R || 0) + 1; cmc += 1; }
    else if (sym === 'G') { result.G = (result.G || 0) + 1; cmc += 1; }
    else if (sym === 'C') { result.C = (result.C || 0) + 1; cmc += 1; }
    else if (!isNaN(Number(sym))) { result.generic = (result.generic || 0) + Number(sym); cmc += Number(sym); }
    else if (sym.includes('/')) {
      // Hybrid/phyrexian — approximate
      cmc += 1;
    }
  }
  result.cmc = cmc;
  return result;
}

function parseTypeLine(typeLine: string): { superTypes: SuperType[]; cardTypes: CardType[]; subTypes: string[] } {
  const superTypeList: SuperType[] = ['Legendary', 'Basic', 'Snow', 'World', 'Historic'];
  const cardTypeList: CardType[] = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle', 'Tribal'];

  const [beforeDash, afterDash] = typeLine.split('—').map(s => s.trim());
  const words = beforeDash?.split(' ') || [];

  const superTypes = words.filter(w => superTypeList.includes(w as SuperType)) as SuperType[];
  const cardTypes = words.filter(w => cardTypeList.includes(w as CardType)) as CardType[];
  const subTypes = afterDash ? afterDash.split(' ').filter(Boolean) : [];

  return { superTypes, cardTypes, subTypes };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scryfallToDefinition(data: any): CardDefinition {
  const typeParts = parseTypeLine(data.type_line || '');
  const manaCost = parseMana(data.mana_cost || '');

  // Handle double-faced cards
  const isDoubleFaced = data.card_faces && data.card_faces.length >= 2;
  let imageUrl = data.image_uris?.normal || data.image_uris?.large;
  let imageUrlBack: string | undefined;
  let oracleText = data.oracle_text || '';

  if (isDoubleFaced && data.card_faces) {
    imageUrl = data.card_faces[0]?.image_uris?.normal || imageUrl;
    imageUrlBack = data.card_faces[1]?.image_uris?.normal;
    oracleText = data.card_faces.map((f: any) => f.oracle_text || '').join('\n---\n');
  }

  return {
    id: data.oracle_id || data.id,
    name: data.name,
    manaCost,
    cmc: data.cmc || 0,
    typeLine: data.type_line || '',
    superTypes: typeParts.superTypes,
    cardTypes: typeParts.cardTypes,
    subTypes: typeParts.subTypes,
    oracleText,
    flavorText: data.flavor_text,
    power: data.power,
    toughness: data.toughness,
    loyalty: data.loyalty ? Number(data.loyalty) : undefined,
    colors: (data.colors || []) as ManaColor[],
    colorIdentity: (data.color_identity || []) as ManaColor[],
    keywords: data.keywords || [],
    imageUrl,
    imageUrlBack,
    isDoubleFaced,
    legalities: data.legalities || {},
    relatedCards: data.all_parts?.map((p: any) => p.name),
  };
}

export async function fetchCardByName(name: string): Promise<CardDefinition | null> {
  const normalized = name.trim().toLowerCase();
  const cached = cardCache.get(normalized);
  if (cached) return cached;

  if (pendingRequests.has(normalized)) {
    return pendingRequests.get(normalized)!;
  }

  const request = (async () => {
    try {
      const url = `${SCRYFALL_BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const def = scryfallToDefinition(data);
      cardCache.set(normalized, def);
      return def;
    } catch {
      return null;
    } finally {
      pendingRequests.delete(normalized);
    }
  })();

  pendingRequests.set(normalized, request);
  return request;
}

export async function fetchCardAutocomplete(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(`${SCRYFALL_BASE}/cards/autocomplete?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.data)
      ? data.data.filter((name: unknown): name is string => typeof name === 'string').slice(0, 10)
      : [];
  } catch {
    return [];
  }
}

export async function fetchCardsByNames(names: string[]): Promise<Map<string, CardDefinition>> {
  const result = new Map<string, CardDefinition>();
  const toBatch: string[] = [];

  for (const name of names) {
    const n = name.trim().toLowerCase();
    if (cardCache.has(n)) {
      result.set(name, cardCache.get(n)!);
    } else {
      toBatch.push(name);
    }
  }

  if (toBatch.length === 0) return result;

  // Scryfall allows batches of up to 75
  const chunks: string[][] = [];
  for (let i = 0; i < toBatch.length; i += 75) {
    chunks.push(toBatch.slice(i, i + 75));
  }

  for (const chunk of chunks) {
    try {
      const res = await fetch(`${SCRYFALL_BASE}/cards/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers: chunk.map(n => ({ name: n })) }),
      });
      if (!res.ok) throw new Error(`Collection lookup failed with HTTP ${res.status}`);
      const data = await res.json();
      for (const card of data.data || []) {
        const def = scryfallToDefinition(card);
        result.set(card.name, def);
        cardCache.set(card.name.toLowerCase(), def);
      }
      const foundKeys = new Set([...result.keys()].map(name => name.toLowerCase()));
      const notFoundNames = Array.isArray(data.not_found)
        ? data.not_found.map((item: { name?: string }) => item.name).filter((name: unknown): name is string => typeof name === 'string')
        : [];
      const missing = [...new Set([
        ...chunk.filter(name => !foundKeys.has(name.toLowerCase())),
        ...notFoundNames,
      ])];
      for (const name of missing) {
        const fallback = await fetchCardByName(name);
        if (fallback) result.set(name, fallback);
      }
    } catch {
      // Fall through — partial results OK
    }
  }

  return result;
}

// Banlist check using Scryfall legalities
export function isLegalInCommander(def: CardDefinition): boolean {
  return def.legalities?.commander === 'legal';
}

export function getBannedReason(def: CardDefinition): string | null {
  const leg = def.legalities?.commander;
  if (leg === 'banned') return `${def.name} is banned in Commander.`;
  if (leg === 'not_legal') return `${def.name} is not legal in Commander.`;
  return null;
}

// Check color identity compliance given commander's color identity
export function isColorIdentityLegal(def: CardDefinition, commanderIdentity: ManaColor[]): boolean {
  return def.colorIdentity.every(c => commanderIdentity.includes(c));
}

// Generate a stable image placeholder for cards without art
export function getCardPlaceholderStyle(def: CardDefinition): string {
  const colorMap: Record<string, string> = {
    W: '#f9f6ee', U: '#0e68ab', B: '#150b00', R: '#d3202a', G: '#00733e', C: '#ccc2c2'
  };
  if (def.colors.length === 0) return '#888';
  if (def.colors.length === 1) return colorMap[def.colors[0]] || '#888';
  return `linear-gradient(135deg, ${def.colors.slice(0, 2).map(c => colorMap[c]).join(', ')})`;
}

export { cardCache };
