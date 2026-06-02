// test-safety.ts — validate safetyChecks logic
import {
  checkDeckPresence,
  checkMultiplayerReadiness,
  analyzePowerLevel,
  checkPowerSpread,
  checkLibraries,
  runPreflightChecks,
} from './client/src/engine/safetyChecks';
import type { MultiplayerState } from './client/src/store/gameStore';
import type { Deck } from './client/src/types/game';

let pass = 0;
let fail = 0;

function assert(desc: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ ${desc}`);
    pass++;
  } else {
    console.error(`  ❌ ${desc}`);
    fail++;
  }
}

const DISCONNECTED_MP: MultiplayerState = {
  status: 'disconnected',
  roomCode: null,
  peerId: null,
  isHost: false,
  peers: {},
  configured: false,
};

// ─── 1. Deck presence checks ─────────────────────────────────────────────────
console.log('\n[1] Deck presence checks');

const noDecks = checkDeckPresence([
  { seatIndex: 0, name: 'Alice' },
  { seatIndex: 1, name: 'Bob' },
]);
assert('No decks → 1 blocking error', noDecks.length === 1 && noDecks[0].blocking);
assert('No decks error is "error" severity', noDecks[0].severity === 'error');

const someDecks = checkDeckPresence([
  { seatIndex: 0, name: 'Alice', deckId: 'deck-1' },
  { seatIndex: 1, name: 'Bob' },
]);
assert('Some decks → 1 non-blocking warn', someDecks.length === 1 && !someDecks[0].blocking);
assert('Missing deck warn mentions Bob', someDecks[0].detail.includes('Bob'));

const allDecks = checkDeckPresence([
  { seatIndex: 0, name: 'Alice', deckId: 'deck-1' },
  { seatIndex: 1, name: 'Bob', deckId: 'deck-2' },
]);
assert('All decks → no issues', allDecks.length === 0);

// ─── 2. Multiplayer readiness ─────────────────────────────────────────────────
console.log('\n[2] Multiplayer readiness');

const mpIssues = checkMultiplayerReadiness(DISCONNECTED_MP, 4);
assert('Disconnected multiplayer → no issues', mpIssues.length === 0);

const hostMp: MultiplayerState = {
  ...DISCONNECTED_MP,
  status: 'host',
  configured: true,
  peers: {
    'peer-1': { peerId: 'peer-1', name: 'Bob', color: '#f00', seatIndex: 1, online: true },
  },
};
const hostIssues = checkMultiplayerReadiness(hostMp, 4);
assert('Host with 1/3 joined → warn (not blocking)', hostIssues.length > 0 && !hostIssues[0].blocking);
assert('Warn mentions waiting count', hostIssues[0].detail.includes('2'));

// ─── 3. Power level analysis ─────────────────────────────────────────────────
console.log('\n[3] Power level analysis');

function makeDeck(cards: string[]): Deck {
  return {
    id: 'test-deck', name: 'Test Deck', format: 'commander',
    commanders: [], cards: cards.map(name => ({ name, count: 1 })),
    sideboard: [], maybeboard: [], colorIdentity: [], importedAt: Date.now(),
  };
}

const emptyDefs = new Map<string, { oracleText: string; cmc: number; cardTypes: string[] }>();

// Casual deck — no power cards
const casualDeck = makeDeck(['Lightning Bolt', 'Forest', 'Island', 'Mountain', 'Plains', 'Swamp']);
const casualAnalysis = analyzePowerLevel(casualDeck, 0, 'Alice', emptyDefs);
assert('Casual deck → score ≤ 4', casualAnalysis.score <= 4);
assert('Casual deck → Casual bracket', casualAnalysis.bracket === 'Casual');

// High power deck — Sol Ring + Mana Crypt + Demonic Tutor + Thassa's Oracle
const highPowerDeck = makeDeck([
  "sol ring", "mana crypt", "mana vault", "jeweled lotus",
  "demonic tutor", "vampiric tutor", "imperial seal",
  "thassa's oracle", "underworld breach", "ad nauseam",
  "doomsday",
]);
const highAnalysis = analyzePowerLevel(highPowerDeck, 0, 'Bob', emptyDefs);
assert('High power deck → score ≥ 8', highAnalysis.score >= 8);
assert('High power deck → High Power or cEDH', ['High Power', 'cEDH'].includes(highAnalysis.bracket));
assert('High power deck has reasons', highAnalysis.reasons.length > 1);

// cEDH deck — maximum density
const cedhDeck = makeDeck([
  "sol ring", "mana crypt", "mana vault", "chrome mox", "jeweled lotus",
  "demonic tutor", "vampiric tutor", "imperial seal", "mystical tutor",
  "thassa's oracle", "underworld breach", "ad nauseam", "doomsday",
  "drannith magistrate", "collector ouphe", "winter orb",
  "isochron scepter", "dramatic reversal",
]);
const cedhAnalysis = analyzePowerLevel(cedhDeck, 0, 'Charlie', emptyDefs);
assert('cEDH deck → score 10', cedhAnalysis.score === 10);
assert('cEDH bracket', cedhAnalysis.bracket === 'cEDH');

// Oracle text tutor detection
const defsWithTutor = new Map([
  ['Strixhaven Tutor', { oracleText: 'Search your library for a card, put it into your hand.', cmc: 2, cardTypes: ['Sorcery'] }],
]);
const tutorDeck = makeDeck(['Strixhaven Tutor']);
const tutorAnalysis = analyzePowerLevel(tutorDeck, 0, 'Dave', defsWithTutor);
assert('Oracle text tutor → detected', tutorAnalysis.reasons.some(r => r.toLowerCase().includes('tutor')));

// ─── 4. Power spread ─────────────────────────────────────────────────────────
console.log('\n[4] Power spread');

const spread5 = checkPowerSpread([
  { seatIndex: 0, playerName: 'Alice', score: 2, bracket: 'Casual', reasons: [], deckName: 'A' },
  { seatIndex: 1, playerName: 'Bob', score: 9, bracket: 'High Power', reasons: [], deckName: 'B' },
]);
assert('Spread ≥5 → large gap warning', spread5.some(i => i.id === 'power-spread-large'));

const cedhVsCasual = checkPowerSpread([
  { seatIndex: 0, playerName: 'Alice', score: 2, bracket: 'Casual', reasons: [], deckName: 'A' },
  { seatIndex: 1, playerName: 'Bob', score: 10, bracket: 'cEDH', reasons: [], deckName: 'B' },
]);
assert('cEDH vs Casual → mixed bracket warning', cedhVsCasual.some(i => i.id === 'power-cedh-mixed'));

const evenSpread = checkPowerSpread([
  { seatIndex: 0, playerName: 'Alice', score: 5, bracket: 'Mid Power', reasons: [], deckName: 'A' },
  { seatIndex: 1, playerName: 'Bob', score: 6, bracket: 'Mid Power', reasons: [], deckName: 'B' },
]);
assert('Even spread → no spread issues', evenSpread.length === 0);

// ─── 5. Library warnings ──────────────────────────────────────────────────────
console.log('\n[5] Library warnings');

const libWarnings = checkLibraries([
  { id: 'p1', name: 'Alice', library: [] },
  { id: 'p2', name: 'Bob', library: ['card1', 'card2'] },
  { id: 'p3', name: 'Charlie', library: ['c1', 'c2', 'c3', 'c4'] },
]);
assert('Empty library → critical + empty flags', libWarnings.some(w => w.empty && w.playerId === 'p1'));
assert('2-card library → critical but not empty', libWarnings.some(w => !w.empty && w.critical && w.playerId === 'p2'));
assert('4-card library → not flagged', !libWarnings.some(w => w.playerId === 'p3'));

// ─── 6. Full preflight with a hard block ────────────────────────────────────
console.log('\n[6] Full preflight — hard block');

const blocked = runPreflightChecks({
  players: [
    { seatIndex: 0, name: 'Alice' },
    { seatIndex: 1, name: 'Bob' },
  ],
  decks: [],
  multiplayer: DISCONNECTED_MP,
  cardDefs: emptyDefs,
});
assert('No decks at all → blocked=true', blocked.blocked);

// ─── 7. Full preflight — warnings only, not blocked ──────────────────────────
console.log('\n[7] Full preflight — warnings but passable');

const warned = runPreflightChecks({
  players: [
    { seatIndex: 0, name: 'Alice', deckId: 'deck-1', deck: casualDeck },
    { seatIndex: 1, name: 'Bob', deckId: 'deck-2', deck: cedhDeck },
  ],
  decks: [],
  multiplayer: DISCONNECTED_MP,
  cardDefs: emptyDefs,
});
assert('Mixed pod → not blocked', !warned.blocked);
assert('Mixed pod → has warnings', warned.issues.some(i => i.severity === 'warn'));
assert('Mixed pod → power levels computed', warned.powerLevels.length === 2);
assert('Power spread detected in issues', warned.issues.some(i => i.category === 'power'));

// ─── 8. Difficult card interaction: fast mana with oracle text ───────────────
console.log('\n[8] Difficult interactions');

// Chrome Mox — named card lookup
const chromeMoxDeck = makeDeck(['Chrome Mox', 'Mox Diamond', 'Ancient Tomb']);
const chromeMoxAnalysis = analyzePowerLevel(chromeMoxDeck, 0, 'Alice', emptyDefs);
assert('Chrome Mox + Mox Diamond + Ancient Tomb → score ≥ 5', chromeMoxAnalysis.score >= 5);

// Large number of stax pieces
const staxDeck = makeDeck([
  'winter orb', 'stasis', 'static orb', 'sphere of resistance',
  'thorn of amethyst', 'rule of law', 'collector ouphe',
  'drannith magistrate', 'cursed totem', 'rhystic study',
]);
const staxAnalysis = analyzePowerLevel(staxDeck, 0, 'Alice', emptyDefs);
assert('Heavy stax deck → score ≥ 6', staxAnalysis.score >= 6);
assert('Stax mentions interaction pieces', staxAnalysis.reasons.some(r => r.includes('stax')));

// Edge: skip power check flag
const skipped = runPreflightChecks({
  players: [{ seatIndex: 0, name: 'Alice', deckId: 'deck-1', deck: casualDeck }],
  decks: [],
  multiplayer: DISCONNECTED_MP,
  cardDefs: emptyDefs,
  skipPowerCheck: true,
});
assert('skipPowerCheck → no power levels', skipped.powerLevels.length === 0);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
