// ─── Deck Cache ────────────────────────────────────────────────────────────────
// Built at deck-load time. Provides O(1) card name lookups, keyword indexes,
// and pre-sorted autocomplete prefixes for the NLP command bar.
//
// Lifecycle:
//   importDecklist()    → deckCache.ingest(deck, fetchedDefs)
//   custom rule upload  → deckCache.addCustomKeyword(keyword, ruleText)
//   parseCommand()      → deckCache.resolveCardName(partial)
//   getSuggestions()    → deckCache.getCompletions(prefix)
// ──────────────────────────────────────────────────────────────────────────────

import type { CardDefinition } from '../types/game';

// ─── Known MTG keywords (oracle / reminder text) ──────────────────────────────
// Used to extract keyword abilities from card text at ingest time.
const KNOWN_KEYWORDS = new Set([
  // Evasion
  'flying', 'reach', 'shadow', 'fear', 'intimidate', 'menace', 'horsemanship',
  'landwalk', 'islandwalk', 'swampwalk', 'mountainwalk', 'forestwalk', 'plainswalk',
  // Protection
  'protection', 'hexproof', 'shroud', 'indestructible', 'ward',
  // Combat
  'first strike', 'double strike', 'trample', 'deathtouch', 'lifelink', 'vigilance',
  'haste', 'flash', 'defender', 'unblockable', 'banding',
  // Activated / triggered
  'tap', 'untap', 'sacrifice', 'exile', 'draw', 'discard', 'mill',
  // Mechanics
  'annihilator', 'cascade', 'convoke', 'delve', 'dredge', 'emerge', 'entwine',
  'escape', 'evoke', 'fuse', 'improvise', 'kicker', 'madness', 'miracle',
  'morph', 'mutate', 'ninjutsu', 'overload', 'phasing', 'proliferate',
  'prowl', 'replicate', 'riot', 'scry', 'spectacle', 'splice', 'storm',
  'suspend', 'threshold', 'transmute', 'undying', 'unleash', 'vanishing',
  'wither', 'cipher', 'detain', 'evolve', 'extort', 'populate', 'tribute',
  // Counter types
  '+1/+1', '-1/-1', 'loyalty', 'poison', 'energy', 'experience', 'charge',
  'stun', 'shield', 'fate', 'time', 'age', 'quest',
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CachedCard {
  /** Exact card name, title-cased */
  name: string;
  /** Lowercase for fast comparison */
  nameLower: string;
  /** Every word token, lowercase */
  nameTokens: string[];
  /** Keywords found in oracle text */
  keywords: string[];
  /** Card type line, lowercase */
  typeLine: string;
  /** Color identity (WUBRG letters) */
  colorIdentity: string[];
  /** Mana value */
  mv: number;
  /** P/T if creature */
  power?: number;
  toughness?: number;
  /** Oracle text, lowercase */
  oracleLower: string;
  /** Image URL for the card */
  imageUrl?: string;
}

export interface CustomKeyword {
  keyword: string;
  keywordLower: string;
  ruleText: string;
  addedAt: number;
}

export interface CacheStats {
  cardCount: number;
  keywordCount: number;
  customKeywordCount: number;
  playerIds: string[];
  lastUpdated: number;
}

// ─── Prefix Trie Node ─────────────────────────────────────────────────────────

class TrieNode {
  children: Map<string, TrieNode> = new Map();
  completions: string[] = []; // up to 10 best completions at this prefix
}

class PrefixTrie {
  private root = new TrieNode();

  insert(word: string, completion: string) {
    let node = this.root;
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, new TrieNode());
      node = node.children.get(ch)!;
      if (node.completions.length < 10 && !node.completions.includes(completion)) {
        node.completions.push(completion);
      }
    }
  }

  search(prefix: string): string[] {
    let node = this.root;
    for (const ch of prefix) {
      if (!node.children.has(ch)) return [];
      node = node.children.get(ch)!;
    }
    return node.completions;
  }
}

// ─── DeckCache Singleton ──────────────────────────────────────────────────────

class DeckCache {
  // Per-player card maps: playerId → card name (lower) → CachedCard[]
  // Multiple copies of the same card name are collapsed into one entry
  private playerCards: Map<string, Map<string, CachedCard>> = new Map();

  // Global card lookup across all players (for judge mode)
  private allCards: Map<string, CachedCard> = new Map();

  // Keywords found across all decks
  private keywordIndex: Map<string, Set<string>> = new Map(); // keyword → Set<cardName>

  // Custom keywords added by players
  private customKeywords: Map<string, CustomKeyword> = new Map();

  // Autocomplete trie — built once, rebuilt on ingest
  private trie = new PrefixTrie();
  private commandTrie = new PrefixTrie();

  // Timestamp
  private lastUpdated = 0;

  // ── Ingest ──────────────────────────────────────────────────────────────────

  /**
   * Call this when a player uploads their deck.
   * `defs` is the Map<cardName, CardDefinition> returned by Scryfall fetch.
   */
  ingest(playerId: string, defs: Map<string, CardDefinition>) {
    const playerMap = new Map<string, CachedCard>();

    for (const [name, def] of defs) {
      const cached = this.buildCachedCard(def);
      playerMap.set(cached.nameLower, cached);
      this.allCards.set(cached.nameLower, cached);

      // Index keywords
      for (const kw of cached.keywords) {
        if (!this.keywordIndex.has(kw)) this.keywordIndex.set(kw, new Set());
        this.keywordIndex.get(kw)!.add(cached.name);
      }

      // Trie insertions for autocomplete
      // Insert the card name itself
      this.trie.insert(cached.nameLower, cached.name);
      // Insert each word token as a secondary prefix
      for (const tok of cached.nameTokens) {
        if (tok.length >= 2) this.trie.insert(tok, cached.name);
      }

      // Insert command prefixes: "cast X", "tap X", "attack with X"
      this.commandTrie.insert(`cast ${cached.nameLower}`, `cast ${cached.name}`);
      this.commandTrie.insert(`play ${cached.nameLower}`, `play ${cached.name}`);
      this.commandTrie.insert(`tap ${cached.nameLower}`, `tap ${cached.name}`);
      this.commandTrie.insert(`untap ${cached.nameLower}`, `untap ${cached.name}`);
      this.commandTrie.insert(`attack with ${cached.nameLower}`, `attack with ${cached.name}`);
      this.commandTrie.insert(`exile ${cached.nameLower}`, `exile ${cached.name}`);
      this.commandTrie.insert(`sacrifice ${cached.nameLower}`, `sacrifice ${cached.name}`);
      this.commandTrie.insert(`bounce ${cached.nameLower}`, `bounce ${cached.name}`);
      this.commandTrie.insert(`destroy ${cached.nameLower}`, `destroy ${cached.name}`);
      this.commandTrie.insert(`return ${cached.nameLower} to hand`, `return ${cached.name} to hand`);
      this.commandTrie.insert(`counter ${cached.nameLower}`, `counter ${cached.name}`);
    }

    this.playerCards.set(playerId, playerMap);
    this.lastUpdated = Date.now();
  }

  /**
   * Called when a player uploads a custom rule set.
   * Parses the text for keyword definitions and caches them.
   */
  addCustomRules(ruleText: string) {
    // Parse "KEYWORD: rule text" lines  or  "KEYWORD — rule text" lines
    const lines = ruleText.split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Za-z][A-Za-z '\-]{1,30}?)\s*[:\u2014\u2013]\s*(.+)$/);
      if (!match) continue;
      const keyword = match[1].trim();
      const definition = match[2].trim();
      const kwLower = keyword.toLowerCase();
      this.customKeywords.set(kwLower, {
        keyword,
        keywordLower: kwLower,
        ruleText: definition,
        addedAt: Date.now(),
      });
      // Add to trie for autocomplete
      this.trie.insert(kwLower, keyword);
    }
    this.lastUpdated = Date.now();
  }

  /**
   * Add a single custom keyword.
   */
  addCustomKeyword(keyword: string, ruleText: string) {
    const kwLower = keyword.toLowerCase();
    this.customKeywords.set(kwLower, {
      keyword,
      keywordLower: kwLower,
      ruleText,
      addedAt: Date.now(),
    });
    this.trie.insert(kwLower, keyword);
    this.lastUpdated = Date.now();
  }

  // ── Lookups ─────────────────────────────────────────────────────────────────

  /**
   * Resolve a partial or fuzzy card name to the best matching CachedCard(s).
   * Returns up to 5 matches, sorted by score.
   * If playerId is given, prioritizes that player's deck.
   */
  resolveCardName(query: string, playerId?: string): CachedCard[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const scored: Array<{ card: CachedCard; score: number }> = [];
    const source = playerId && this.playerCards.has(playerId)
      ? this.playerCards.get(playerId)!
      : this.allCards;

    for (const card of source.values()) {
      const score = this.scoreMatch(q, card);
      if (score > 0.35) scored.push({ card, score });
    }

    // If scoped to player and no results, fall back to all cards
    if (scored.length === 0 && playerId) {
      for (const card of this.allCards.values()) {
        const score = this.scoreMatch(q, card);
        if (score > 0.35) scored.push({ card, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5).map(s => s.card);
  }

  /**
   * Get autocomplete completions for a command prefix.
   * Checks command trie first (e.g. "cast sol r"), then card name trie.
   */
  getCompletions(prefix: string): string[] {
    const p = prefix.toLowerCase().trim();
    if (!p) return [];

    // Try command trie first (more specific)
    const cmdResults = this.commandTrie.search(p);
    if (cmdResults.length > 0) return cmdResults.slice(0, 8);

    // Fall back to card name trie
    return this.trie.search(p).slice(0, 8);
  }

  /**
   * Returns all card names for a player (for suggestions).
   */
  getPlayerCardNames(playerId: string): string[] {
    const map = this.playerCards.get(playerId);
    if (!map) return [];
    return [...map.values()].map(c => c.name);
  }

  /**
   * Returns all cards that have a given keyword.
   */
  getCardsByKeyword(keyword: string): string[] {
    return [...(this.keywordIndex.get(keyword.toLowerCase()) ?? [])];
  }

  /**
   * Look up a custom keyword definition.
   */
  getCustomKeyword(keyword: string): CustomKeyword | undefined {
    return this.customKeywords.get(keyword.toLowerCase());
  }

  /**
   * All custom keywords, sorted alphabetically.
   */
  getAllCustomKeywords(): CustomKeyword[] {
    return [...this.customKeywords.values()].sort((a, b) =>
      a.keyword.localeCompare(b.keyword)
    );
  }

  /**
   * Cache stats for debug / UI display.
   */
  getStats(): CacheStats {
    return {
      cardCount: this.allCards.size,
      keywordCount: this.keywordIndex.size,
      customKeywordCount: this.customKeywords.size,
      playerIds: [...this.playerCards.keys()],
      lastUpdated: this.lastUpdated,
    };
  }

  /**
   * Check if the cache has been populated for a player.
   */
  hasPlayer(playerId: string): boolean {
    return this.playerCards.has(playerId) && (this.playerCards.get(playerId)?.size ?? 0) > 0;
  }

  /**
   * Clear all data (e.g. on new game).
   */
  clear() {
    this.playerCards.clear();
    this.allCards.clear();
    this.keywordIndex.clear();
    this.customKeywords.clear();
    this.trie = new PrefixTrie();
    this.commandTrie = new PrefixTrie();
    this.lastUpdated = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private buildCachedCard(def: CardDefinition): CachedCard {
    const oracle = (def.oracleText ?? '').toLowerCase();
    const keywords: string[] = [];

    for (const kw of KNOWN_KEYWORDS) {
      // Match whole word / phrase in oracle text or keywords array
      if (oracle.includes(kw)) keywords.push(kw);
    }
    // Also add any explicit keywords from the definition
    if (Array.isArray((def as any).keywords)) {
      for (const kw of (def as any).keywords as string[]) {
        const kwl = kw.toLowerCase();
        if (!keywords.includes(kwl)) keywords.push(kwl);
      }
    }

    const nameLower = def.name.toLowerCase();
    const nameTokens = nameLower.split(/[\s,'\-/]+/).filter(t => t.length >= 2);

    const typeLine = [
      ...(def.superTypes ?? []),
      ...(def.cardTypes ?? []),
      ...(def.subTypes ?? []),
    ].join(' ').toLowerCase();

    return {
      name: def.name,
      nameLower,
      nameTokens,
      keywords: [...new Set(keywords)],
      typeLine,
      colorIdentity: def.colorIdentity ?? [],
      mv: def.manaCost ? def.manaCost.cmc : def.cmc ?? 0,
      power: def.power !== undefined ? Number(def.power) : undefined,
      toughness: def.toughness !== undefined ? Number(def.toughness) : undefined,
      oracleLower: oracle,
      imageUrl: def.imageUrl,
    };
  }

  private scoreMatch(query: string, card: CachedCard): number {
    const name = card.nameLower;

    // Exact match
    if (name === query) return 1.0;

    // Exact prefix
    if (name.startsWith(query)) return 0.95;

    // Contains
    if (name.includes(query)) return 0.85;

    // Every query word appears in the name
    const qTokens = query.split(/\s+/);
    const allWordsMatch = qTokens.every(qt =>
      card.nameTokens.some(nt => nt.startsWith(qt))
    );
    if (allWordsMatch) return 0.80;

    // Some query words match
    const matchCount = qTokens.filter(qt =>
      card.nameTokens.some(nt => nt.startsWith(qt))
    ).length;
    if (matchCount > 0) return (matchCount / qTokens.length) * 0.75;

    // Dice coefficient character-level similarity
    const dice = diceCoefficient(query, name);
    if (dice > 0.5) return dice * 0.65;

    return 0;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function diceCoefficient(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return 0;
  const aBigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    aBigrams.set(bg, (aBigrams.get(bg) || 0) + 1);
  }
  let intersections = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = aBigrams.get(bg) || 0;
    if (count > 0) { intersections++; aBigrams.set(bg, count - 1); }
  }
  return (2 * intersections) / (a.length + b.length - 2);
}

// ─── Export singleton ─────────────────────────────────────────────────────────

export const deckCache = new DeckCache();
