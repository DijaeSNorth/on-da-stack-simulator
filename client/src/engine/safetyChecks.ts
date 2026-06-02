// ─── Safety Checks Engine ─────────────────────────────────────────────────────
// Pre-game and in-game guard rails.
// Philosophy: these are WARNINGS, not hard blocks. The judge assistant
// surfaces issues and lets players decide — consistent with the "never
// block actions" design principle. The only hard block is "no deck at all"
// (you literally can't play), everything else is a warning with override.

import type { Deck } from '../types/game';
import type { MultiplayerState } from '../store/gameStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckSeverity = 'error' | 'warn' | 'info';

export interface SafetyIssue {
  id: string;
  severity: CheckSeverity;
  category: 'deck' | 'multiplayer' | 'power';
  title: string;
  detail: string;
  /** If true, startGame() should be blocked unless the user overrides */
  blocking: boolean;
}

export interface PreflightResult {
  issues: SafetyIssue[];
  /** True if any blocking issues are present (and user has not overridden) */
  blocked: boolean;
  /** Deck power analysis per seat index */
  powerLevels: PowerAnalysis[];
}

// ─── Power Level Analysis ─────────────────────────────────────────────────────

export interface PowerAnalysis {
  seatIndex: number;
  playerName: string;
  score: number;               // 1–10
  bracket: 'Casual' | 'Mid Power' | 'High Power' | 'cEDH';
  reasons: string[];           // evidence bullets shown to players
  deckName: string;
}

// Card lists used for scoring — deliberately kept flat for tree-shaking
const FAST_MANA = new Set([
  'sol ring', 'mana crypt', 'mana vault', 'chrome mox', 'mox diamond',
  'jeweled lotus', 'lotus petal', 'dark ritual', 'cabal ritual',
  'ancient tomb', 'city of traitors', 'grim monolith', 'basalt monolith',
  'mox opal', 'mox amber', 'arcane signet',                // arcane signet is fine but common
]);

// These push the score higher but aren't instant-win alone
const STRONG_MANA = new Set([
  'arcane signet', 'signets', "cultivate", "kodama's reach", "farseek",
  "nature's lore", "skyshroud claim", 'harrow', 'three visits',
]);

const TUTORS = [
  'demonic tutor', 'vampiric tutor', 'imperial seal', 'mystical tutor',
  'enlightened tutor', 'worldly tutor', 'sylvan tutor', 'grim tutor',
  'diabolic intent', 'cruel tutor', 'personal tutor', 'lim-dul\'s vault',
  'tainted pact', 'scheming symmetry', 'wishclaw talisman',
];
const TUTOR_ORACLE = 'search your library for a card';  // broad oracle text match

const WIN_CONS = new Set([
  "thassa's oracle", 'thoracle',
  'underworld breach', 'ad nauseam', 'doomsday',
  'food chain', 'isochron scepter',
  'thoracle', 'consult', "demonic consultation", "tainted pact",
  'flash', 'hulk', 'protean hulk',
  'hermit druid', 'blood pod', "living death",
  'divergent transformations', 'eldritch evolution',
]);

const STAX_PIECES = new Set([
  'winter orb', 'stasis', 'rising waters', 'kataki, war\'s wage',
  'drannith magistrate', 'collector ouphe', 'cursed totem',
  'static orb', 'sphere of resistance', 'thorn of amethyst',
  'rule of law', 'arcane laboratory', 'eidolon of rhetoric',
  'rhystic study', 'narset, parter of veils', 'hullbreacher',
  "opposition agent", 'deafening silence',
]);

const COMBO_ENABLERS = new Set([
  'isochron scepter', 'dramatic reversal', 'basalt monolith', 'power artifact',
  'rings of brighthearth', 'pemmin\'s aura', 'freed from the real',
  'dockside extortionist', 'thassa\'s oracle', 'hermit druid',
  'gitaxian probe', 'necropotence', "peer into the abyss",
  'bolas\'s citadel', "lion\'s eye diamond",
]);

function nameLower(name: string) { return name.toLowerCase(); }

function countMatches(cards: Deck['cards'], set: Set<string>): string[] {
  const found: string[] = [];
  for (const c of cards) {
    if (set.has(nameLower(c.name))) found.push(c.name);
  }
  return found;
}

function countTutors(cards: Deck['cards'], cardDefs: Map<string, { oracleText: string }>): string[] {
  const found: string[] = [];
  for (const c of cards) {
    if (TUTORS.some(t => nameLower(c.name).includes(t))) {
      found.push(c.name);
      continue;
    }
    const def = cardDefs.get(c.name);
    if (def && def.oracleText.toLowerCase().includes(TUTOR_ORACLE)) {
      found.push(c.name);
    }
  }
  return found;
}

function avgCmc(cards: Deck['cards'], cardDefs: Map<string, { cmc: number; cardTypes: string[] }>): number {
  let total = 0, count = 0;
  for (const c of cards) {
    const def = cardDefs.get(c.name);
    if (!def) continue;
    if (def.cardTypes.includes('Land')) continue;   // lands don't count
    total += def.cmc * c.count;
    count += c.count;
  }
  return count > 0 ? total / count : 3.5;
}

/**
 * Analyze a deck's power level.
 * `cardDefs` comes from the Deck's already-fetched card data stored in the game state.
 * If cardDefs is empty (cards haven't been resolved yet) the score will be conservative.
 */
export function analyzePowerLevel(
  deck: Deck,
  seatIndex: number,
  playerName: string,
  cardDefs: Map<string, { oracleText: string; cmc: number; cardTypes: string[] }>,
): PowerAnalysis {
  const cards = deck.cards;
  const reasons: string[] = [];
  let score = 0;

  // Fast mana (+2 per piece, hard to ignore)
  const fastMana = countMatches(cards, FAST_MANA);
  if (fastMana.length > 0) {
    score += Math.min(fastMana.length * 2, 6);
    reasons.push(`Fast mana: ${fastMana.join(', ')}`);
  }

  // Tutors (+1.5 per tutor, max +4)
  const tutors = countTutors(cards, cardDefs);
  if (tutors.length > 0) {
    score += Math.min(tutors.length * 1.5, 4);
    reasons.push(`Tutors (${tutors.length}): ${tutors.slice(0, 3).join(', ')}${tutors.length > 3 ? '…' : ''}`);
  }

  // Win cons (+2 each, max +5)
  const winCons = countMatches(cards, WIN_CONS);
  if (winCons.length > 0) {
    score += Math.min(winCons.length * 2, 5);
    reasons.push(`Win conditions: ${winCons.join(', ')}`);
  }

  // Stax (+1.5 per piece, max +4)
  const stax = countMatches(cards, STAX_PIECES);
  if (stax.length > 0) {
    score += Math.min(stax.length * 1.5, 4);
    reasons.push(`Interaction/stax: ${stax.join(', ')}`);
  }

  // Combo enablers (+1 per piece, max +3)
  const combos = countMatches(cards, COMBO_ENABLERS);
  if (combos.length > 0) {
    score += Math.min(combos.length, 3);
    reasons.push(`Combo pieces: ${combos.join(', ')}`);
  }

  // Average CMC — low CMC = efficient = higher power
  const cmc = avgCmc(cards, cardDefs);
  if (cmc < 2.5) {
    score += 2;
    reasons.push(`Very low avg CMC (${cmc.toFixed(1)}) — very efficient curve`);
  } else if (cmc < 3.0) {
    score += 1;
    reasons.push(`Low avg CMC (${cmc.toFixed(1)})`);
  } else if (cmc > 4.0) {
    score -= 1;
    reasons.push(`High avg CMC (${cmc.toFixed(1)}) — slower game plan`);
  }

  // Clamp 1–10
  score = Math.max(1, Math.min(10, Math.round(score)));

  let bracket: PowerAnalysis['bracket'];
  if (score <= 4) bracket = 'Casual';
  else if (score <= 6) bracket = 'Mid Power';
  else if (score <= 8) bracket = 'High Power';
  else bracket = 'cEDH';

  if (reasons.length === 0) reasons.push('No notable power indicators detected');

  return { seatIndex, playerName, score, bracket, reasons, deckName: deck.name };
}

// ─── Deck Presence Check ──────────────────────────────────────────────────────

export interface PlayerSetupBrief {
  seatIndex: number;
  name: string;
  deckId?: string;
  deck?: Deck;
}

export function checkDeckPresence(players: PlayerSetupBrief[]): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  const missingDeck = players.filter(p => !p.deckId && !p.deck);

  if (missingDeck.length === players.length) {
    issues.push({
      id: 'no-decks-at-all',
      severity: 'error',
      category: 'deck',
      title: 'No decks loaded',
      detail: 'At least one deck must be loaded before starting a game. Players without decks will have empty libraries.',
      blocking: true,
    });
  } else if (missingDeck.length > 0) {
    const names = missingDeck.map(p => `P${p.seatIndex + 1} (${p.name})`).join(', ');
    issues.push({
      id: 'some-decks-missing',
      severity: 'error',
      category: 'deck',
      title: `${missingDeck.length} player${missingDeck.length > 1 ? 's have' : ' has'} no deck`,
      detail: `${names} must load a deck before the game can start. Import a decklist and click "Save & Use" to assign it.`,
      blocking: true,
    });
  }

  return issues;
}

// ─── Multiplayer Readiness Check ──────────────────────────────────────────────

export function checkMultiplayerReadiness(
  multiplayer: MultiplayerState,
  expectedPlayerCount: number,
): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  const { status, configured, peers } = multiplayer;

  // Not using multiplayer at all — fine
  if (status === 'disconnected' || !configured) return issues;

  const connectedPeerCount = Object.values(peers).filter(p => p.online).length;

  if (status === 'host' && connectedPeerCount < expectedPlayerCount - 1) {
    const waiting = expectedPlayerCount - 1 - connectedPeerCount;
    issues.push({
      id: 'mp-not-all-joined',
      severity: 'warn',
      category: 'multiplayer',
      title: `Waiting for ${waiting} more player${waiting > 1 ? 's' : ''}`,
      detail: `Room has ${connectedPeerCount} of ${expectedPlayerCount - 1} expected remote players. You can still start — missing players can join mid-game.`,
      blocking: false,
    });
  }

  if (status === 'joined') {
    // A non-host starting is unusual — they don't control game start
    issues.push({
      id: 'mp-non-host-start',
      severity: 'info',
      category: 'multiplayer',
      title: 'You are not the host',
      detail: 'The host controls when the game starts. Your local Start will only affect your own view.',
      blocking: false,
    });
  }

  return issues;
}

// ─── Power Level Spread Check ─────────────────────────────────────────────────

export function checkPowerSpread(analyses: PowerAnalysis[]): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  if (analyses.length < 2) return issues;

  const scores = analyses.map(a => a.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const spread = max - min;

  if (spread >= 5) {
    const low = analyses.filter(a => a.score === min).map(a => `${a.playerName} (${a.score})`);
    const high = analyses.filter(a => a.score === max).map(a => `${a.playerName} (${a.score})`);
    issues.push({
      id: 'power-spread-large',
      severity: 'warn',
      category: 'power',
      title: 'Large power gap detected',
      detail: `Rule Zero conversation recommended — ${low.join(', ')} vs ${high.join(', ')} is a ${spread}-point spread. Lower-powered decks may struggle to interact.`,
      blocking: false,
    });
  } else if (spread >= 3) {
    issues.push({
      id: 'power-spread-moderate',
      severity: 'info',
      category: 'power',
      title: 'Moderate power gap',
      detail: `${spread}-point spread across the table. Games may be uneven but still enjoyable — consider Rule Zero discussion.`,
      blocking: false,
    });
  }

  // Mixed bracket warning (e.g. Casual vs cEDH)
  const brackets = new Set(analyses.map(a => a.bracket));
  if (brackets.has('cEDH') && (brackets.has('Casual') || brackets.has('Mid Power'))) {
    issues.push({
      id: 'power-cedh-mixed',
      severity: 'warn',
      category: 'power',
      title: 'cEDH deck in a non-cEDH pod',
      detail: 'One or more decks scored as cEDH alongside casual or mid-power decks. This typically creates an unfun experience. Rule Zero conversation strongly recommended.',
      blocking: false,
    });
  }

  return issues;
}

// ─── Master Pre-flight ────────────────────────────────────────────────────────

export interface PreflightOptions {
  players: PlayerSetupBrief[];
  decks: Deck[];
  multiplayer: MultiplayerState;
  /** Already-resolved card definitions from the game store or import result */
  cardDefs: Map<string, { oracleText: string; cmc: number; cardTypes: string[] }>;
  skipPowerCheck?: boolean;
}

export function runPreflightChecks(opts: PreflightOptions): PreflightResult {
  const { players, decks, multiplayer, cardDefs, skipPowerCheck } = opts;

  const allIssues: SafetyIssue[] = [];

  // 1. Deck presence
  allIssues.push(...checkDeckPresence(players));

  // 2. Multiplayer readiness
  allIssues.push(...checkMultiplayerReadiness(multiplayer, players.length));

  // 3. Power level analysis
  const powerLevels: PowerAnalysis[] = [];
  if (!skipPowerCheck) {
    for (const p of players) {
      const deck = p.deck ?? decks.find(d => d.id === p.deckId);
      if (deck) {
        const analysis = analyzePowerLevel(deck, p.seatIndex, p.name, cardDefs);
        powerLevels.push(analysis);
      }
    }
    if (powerLevels.length >= 2) {
      allIssues.push(...checkPowerSpread(powerLevels));
    }
  }

  const blocked = allIssues.some(i => i.blocking);

  return { issues: allIssues, blocked, powerLevels };
}

// ─── In-game library empty check ─────────────────────────────────────────────

export interface LibraryWarning {
  playerId: string;
  playerName: string;
  libraryCount: number;
  empty: boolean;
  critical: boolean;    // ≤ 3 cards
}

export function checkLibraries(
  players: { id: string; name: string; library: string[] }[],
): LibraryWarning[] {
  return players
    .filter(p => p.library.length <= 3)
    .map(p => ({
      playerId: p.id,
      playerName: p.name,
      libraryCount: p.library.length,
      empty: p.library.length === 0,
      critical: p.library.length <= 3,
    }));
}
