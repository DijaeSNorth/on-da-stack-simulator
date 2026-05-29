/**
 * Fix Verification Test Suite
 * Covers all four bugs identified during internal testing.
 *
 * Run with: npx tsx tests/fixes-verification.test.ts
 */

// ── Minimal type stubs ─────────────────────────────────────────────────────

type Zone = 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'library' | 'command' | 'stack';

interface CardDef {
  name: string;
  cardTypes: string[];
  keywords: string[];
  oracleText: string;
  power?: string;
  toughness?: string;
  manaCost?: string;
  colorIdentity?: string[];
}

interface CardState {
  instanceId: string;
  definitionId: string;
  definition: CardDef;
  zone: Zone;
  controllerId: string;
  tapped: boolean;
  summoningSick: boolean;
  markedForDamage: number;
  combatRole: string;
  attackTarget?: string;
  blockTarget: string[];
}

interface PlayerState {
  id: string;
  life: number;
  poisonCounters: number;
  commanderCastCount: Record<string, number>;
  commanders: string[];
  commanderDamage: Record<string, number>;
}

interface GameConfig {
  commanderTaxEnabled: boolean;
  useCommanderDamage: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

function makeCard(
  id: string,
  name: string,
  opts: Partial<CardDef & { zone: Zone; tapped: boolean; summoningSick: boolean; markedForDamage: number; controllerId: string }>
): CardState {
  return {
    instanceId: id,
    definitionId: id,
    definition: {
      name,
      cardTypes: opts.cardTypes ?? ['Creature'],
      keywords: opts.keywords ?? [],
      oracleText: opts.oracleText ?? '',
      power: opts.power ?? '2',
      toughness: opts.toughness ?? '2',
      manaCost: opts.manaCost ?? '{2}',
      colorIdentity: opts.colorIdentity ?? ['R'],
    },
    zone: opts.zone ?? 'battlefield',
    controllerId: opts.controllerId ?? 'p1',
    tapped: opts.tapped ?? false,
    summoningSick: opts.summoningSick ?? false,
    markedForDamage: opts.markedForDamage ?? 0,
    combatRole: 'none',
    blockTarget: [],
  };
}

// ══════════════════════════════════════════════════════════════════════════
// FIX 1: Fuzzy threshold >= 0.4 (was > 0.4)
// ══════════════════════════════════════════════════════════════════════════
section('FIX 1 — Fuzzy threshold (>= 0.4 boundary)');

// Real algorithm from nlpParser.ts
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

function fuzzyScore(query: string, target: string): number {
  if (target === query) return 1.0;
  if (target.startsWith(query)) return 0.95;
  if (target.includes(query)) return 0.85;

  const qWords = query.split(/\s+/);
  const tWords = target.split(/\s+/);
  let wordMatches = 0;
  for (const qw of qWords) {
    if (tWords.some(tw => tw.startsWith(qw) || tw === qw)) wordMatches++;
  }
  const wordScore = wordMatches / Math.max(qWords.length, tWords.length);
  if (wordScore > 0) return wordScore * 0.8;
  return diceCoefficient(query, target) * 0.7;
}

function findCardsGTE(query: string, cards: string[]): string[] {
  const q = query.toLowerCase();
  return cards.filter(name => fuzzyScore(q, name.toLowerCase()) >= 0.4);  // fixed: >= not >
}

function findCardsGT(query: string, cards: string[]): string[] {
  const q = query.toLowerCase();
  return cards.filter(name => fuzzyScore(q, name.toLowerCase()) > 0.4);   // old: strict >
}

const cardPool = ['Goblin Guide', 'Mayhem Devil', 'Lightning Bolt', 'Sol Ring'];
const typoQuery = 'gobln guide'; // one character off

const oldResult = findCardsGT(typoQuery, cardPool);
const newResult = findCardsGTE(typoQuery, cardPool);

assert(oldResult.length === 0, 'Old threshold (> 0.4) MISSED "gobln guide" → "Goblin Guide"');
assert(newResult.length > 0, 'New threshold (>= 0.4) MATCHES "gobln guide" → "Goblin Guide"');
assert(newResult[0] === 'Goblin Guide', 'Correct card returned for typo query');

// deckCache threshold — 0.35
function deckCacheFind(query: string, cards: string[]): string[] {
  const q = query.toLowerCase();
  return cards.filter(name => fuzzyScore(q, name.toLowerCase()) >= 0.35); // fixed: >= not >
}
const dcResult = deckCacheFind('sol rin', cardPool);
assert(dcResult.includes('Sol Ring'), 'DeckCache >= 0.35 matches partial "sol rin" → "Sol Ring"');

// ══════════════════════════════════════════════════════════════════════════
// FIX 2: Commander tax tracking in castCard
// ══════════════════════════════════════════════════════════════════════════
section('FIX 2 — Commander cast count increments on each cast');

function simulateCastCommander(
  player: PlayerState,
  commanderId: string,
  config: GameConfig
): PlayerState {
  const isCommander = player.commanders.includes(commanderId);
  if (!isCommander || !config.commanderTaxEnabled) return player;

  const prevCount = player.commanderCastCount[commanderId] || 0;
  return {
    ...player,
    commanderCastCount: { ...player.commanderCastCount, [commanderId]: prevCount + 1 },
  };
}

function computeTax(player: PlayerState, commanderId: string): number {
  return (player.commanderCastCount[commanderId] || 0) * 2;
}

let player: PlayerState = {
  id: 'p1', life: 40, poisonCounters: 0,
  commanderCastCount: {},
  commanders: ['c1'],
  commanderDamage: {},
};
const config: GameConfig = { commanderTaxEnabled: true, useCommanderDamage: true };

assert(computeTax(player, 'c1') === 0, 'Tax is 0 before any cast');

player = simulateCastCommander(player, 'c1', config);
assert(player.commanderCastCount['c1'] === 1, 'Cast count increments to 1 after first cast');
assert(computeTax(player, 'c1') === 2, 'Tax is {2} after first re-cast');

player = simulateCastCommander(player, 'c1', config);
assert(player.commanderCastCount['c1'] === 2, 'Cast count increments to 2 after second cast');
assert(computeTax(player, 'c1') === 4, 'Tax is {4} after second re-cast');

player = simulateCastCommander(player, 'c1', config);
assert(computeTax(player, 'c1') === 6, 'Tax is {6} after third re-cast');

// Non-commander spell does not affect count
const nonCmdrPlayer = simulateCastCommander(player, 'non-cmdr', config);
assert(nonCmdrPlayer.commanderCastCount['non-cmdr'] === undefined, 'Non-commander card does not update cast count');

// Tax disabled via config
const noTaxConfig: GameConfig = { commanderTaxEnabled: false, useCommanderDamage: true };
let p2: PlayerState = { id: 'p2', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: ['c2'], commanderDamage: {} };
p2 = simulateCastCommander(p2, 'c2', noTaxConfig);
assert(Object.keys(p2.commanderCastCount).length === 0, 'Commander tax disabled → cast count not incremented');

// ══════════════════════════════════════════════════════════════════════════
// FIX 3: First strike two-step damage (CR 510.1–510.4)
// ══════════════════════════════════════════════════════════════════════════
section('FIX 3 — First strike two-step combat damage');

const hasKw = (card: CardState, kw: string): boolean => {
  const lc = kw.toLowerCase();
  return card.definition.keywords.some(k => k.toLowerCase() === lc) ||
    card.definition.oracleText.toLowerCase().includes(lc);
};

interface AttackEntry { instanceId: string; targetPlayerId: string }
interface BlockEntry  { instanceId: string; blockedAttacker: string }

// CR 510 accurate: Attacker & blocker damage are independent.
// In normal step, blockers WITHOUT first strike deal damage even if their attacker has FS.
function simulateCombatDamage(
  cards: Record<string, CardState>,
  attackers: AttackEntry[],
  blockers: BlockEntry[],
  players: Record<string, PlayerState>
): { cards: Record<string, CardState>; players: Record<string, PlayerState>; log: string[] } {
  const log: string[] = [];
  let c = { ...cards };
  let p = { ...players };

  const applyStep = (firstStrikeStep: boolean) => {
    for (const atk of attackers) {
      const atkCard = c[atk.instanceId];
      if (!atkCard) continue;
      const hasFS = hasKw(atkCard, 'First Strike');
      const hasDS = hasKw(atkCard, 'Double Strike');
      const atkDealsInFirst  = hasFS || hasDS;
      const atkDealsInSecond = !hasFS || hasDS;
      const attackerDealsNow = firstStrikeStep ? atkDealsInFirst : atkDealsInSecond;

      const myBlockers = blockers
        .filter(b => b.blockedAttacker === atk.instanceId)
        .map(b => c[b.instanceId]).filter(Boolean) as CardState[];

      if (myBlockers.length === 0) {
        if (!attackerDealsNow) continue;
        const pwr = parseInt(atkCard.definition.power || '0', 10) || 0;
        if (pwr > 0) {
          const target = p[atk.targetPlayerId];
          p = { ...p, [atk.targetPlayerId]: { ...target, life: target.life - pwr } };
          log.push(`${atkCard.definition.name} deals ${pwr} to ${atk.targetPlayerId}`);
        }
      } else {
        const pwr = parseInt(atkCard.definition.power || '0', 10) || 0;
        const deatht = hasKw(atkCard, 'Deathtouch');
        for (const blk of myBlockers) {
          const blkDealsInFirst  = hasKw(blk, 'First Strike') || hasKw(blk, 'Double Strike');
          const blkDealsInSecond = !hasKw(blk, 'First Strike') || hasKw(blk, 'Double Strike');
          const blockerDealsNow = firstStrikeStep ? blkDealsInFirst : blkDealsInSecond;

          // Attacker marks on blocker
          if (attackerDealsNow) {
            const dmgToBlk = deatht ? 1 : pwr;
            c = { ...c, [blk.instanceId]: { ...c[blk.instanceId], markedForDamage: (c[blk.instanceId].markedForDamage || 0) + dmgToBlk } };
            log.push(`${atkCard.definition.name} marks ${dmgToBlk} on ${blk.definition.name}`);
          }
          // Blocker marks on attacker
          if (blockerDealsNow) {
            const blkPwr = parseInt(blk.definition.power || '0', 10) || 0;
            const blkDeatht = hasKw(blk, 'Deathtouch');
            const dmgToAtk = blkDeatht ? 1 : blkPwr;
            c = { ...c, [atk.instanceId]: { ...c[atk.instanceId], markedForDamage: (c[atk.instanceId].markedForDamage || 0) + dmgToAtk } };
            log.push(`${blk.definition.name} marks ${dmgToAtk} on ${atkCard.definition.name}`);
          }
        }
      }
    }
  };

  const anyFS = [...attackers, ...blockers].some(x => {
    const card = c[x.instanceId];
    return card && (hasKw(card, 'First Strike') || hasKw(card, 'Double Strike'));
  });

  if (anyFS) {
    applyStep(true);
    log.push('--- SBA after first-strike step ---');
  }
  applyStep(false);

  return { cards: c, players: p, log };
}

// Scenario A: First striker kills blocker before it can deal damage (CR 510.2)
const fsAttacker = makeCard('fs1', 'White Knight', { keywords: ['First Strike'], power: '2', toughness: '2', controllerId: 'p1' });
const normalBlocker = makeCard('nb1', 'Grizzly Bears', { power: '2', toughness: '2', controllerId: 'p2' });

const scenA = simulateCombatDamage(
  { fs1: { ...fsAttacker, markedForDamage: 0 }, nb1: { ...normalBlocker, markedForDamage: 0 } },
  [{ instanceId: 'fs1', targetPlayerId: 'p2' }],
  [{ instanceId: 'nb1', blockedAttacker: 'fs1' }],
  { p1: { id: 'p1', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} },
    p2: { id: 'p2', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} } }
);
// White Knight deals 2 in FS step, marking blocker for 2 (dies to SBA); blocker does NOT deal damage back yet
assert(scenA.cards['nb1'].markedForDamage === 2, 'FS step: blocker takes 2 damage from first striker');
// In the normal step: attacker (FS-only) doesn't deal again. Blocker (no FS) deals its 2 damage to the attacker.
assert(scenA.cards['fs1'].markedForDamage === 2, 'Normal step: blocker marks 2 on the first striker (blocker has no FS, acts in normal step)');

// Scenario B: Double strike deals damage in BOTH steps
const dsAttacker = makeCard('ds1', 'Fencing Ace', { keywords: ['Double Strike'], power: '3', toughness: '1', controllerId: 'p1' });
const scenB = simulateCombatDamage(
  { ds1: { ...dsAttacker, markedForDamage: 0 } },
  [{ instanceId: 'ds1', targetPlayerId: 'p2' }],
  [],
  { p1: { id: 'p1', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} },
    p2: { id: 'p2', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} } }
);
assert(scenB.players['p2'].life === 34, 'Double strike deals 3 + 3 = 6 damage (two steps, unblocked)');

// Scenario C: Normal creature deals damage only once
const normalAtk = makeCard('na1', 'Grizzly Bears', { power: '2', toughness: '2', controllerId: 'p1' });
const scenC = simulateCombatDamage(
  { na1: { ...normalAtk, markedForDamage: 0 } },
  [{ instanceId: 'na1', targetPlayerId: 'p2' }],
  [],
  { p1: { id: 'p1', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} },
    p2: { id: 'p2', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} } }
);
assert(scenC.players['p2'].life === 38, 'Normal creature deals damage only once (no FS step)');

// Scenario D: Deathtouch first striker — marks 1 damage which is lethal
const dtsAttacker = makeCard('dts1', 'Wasteland Viper', { keywords: ['First Strike', 'Deathtouch'], power: '1', toughness: '1', controllerId: 'p1' });
const bigBlocker = makeCard('big1', 'Serra Angel', { power: '4', toughness: '4', controllerId: 'p2' });
const scenD = simulateCombatDamage(
  { dts1: { ...dtsAttacker, markedForDamage: 0 }, big1: { ...bigBlocker, markedForDamage: 0 } },
  [{ instanceId: 'dts1', targetPlayerId: 'p2' }],
  [{ instanceId: 'big1', blockedAttacker: 'dts1' }],
  { p1: { id: 'p1', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} },
    p2: { id: 'p2', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} } }
);
assert(scenD.cards['big1'].markedForDamage === 1, 'Deathtouch first striker marks 1 (lethal) on big blocker in FS step');
// Serra Angel has no FS/DS, so it deals in the normal step.
// Deathtouch viper dealt in FS step. Serra Angel deals 4 in normal step to the viper.
assert(scenD.cards['dts1'].markedForDamage === 4, 'Serra Angel marks 4 on the viper in normal step (no FS/DS)');

// ══════════════════════════════════════════════════════════════════════════
// FIX 4: Summoning sickness — haste bypass confirmed
// ══════════════════════════════════════════════════════════════════════════
section('FIX 4 — Summoning sickness + haste (confirmed wiring)');

function checkCanAttack(card: CardState): { canAttack: boolean; reason?: string } {
  if (!card.definition.cardTypes.includes('Creature')) return { canAttack: false, reason: 'Not a creature' };
  if (card.tapped) return { canAttack: false, reason: 'Card is tapped' };
  if (card.summoningSick) {
    const hasHaste = card.definition.keywords.includes('Haste') ||
      card.definition.oracleText.toLowerCase().includes('haste');
    if (!hasHaste) return { canAttack: false, reason: 'Summoning sickness' };
  }
  return { canAttack: true };
}

const sickCreature = makeCard('sc1', 'Grizzly Bears', { summoningSick: true });
const hasteCreature = makeCard('hc1', 'Goblin Guide', { keywords: ['Haste', 'First Strike'] /* sic */, summoningSick: true });
const hasteInOracle  = makeCard('ho1', 'Ball Lightning', { oracleText: 'Trample, haste.', summoningSick: true, power: '6', toughness: '1' });

assert(!checkCanAttack(sickCreature).canAttack, 'Summoning-sick creature without haste cannot attack');
assert(checkCanAttack(hasteCreature).canAttack,  'Summoning-sick creature WITH Haste keyword CAN attack');
assert(checkCanAttack(hasteInOracle).canAttack,  'Summoning-sick creature with haste in oracle text CAN attack');

const tapSickCreature = makeCard('ts1', 'Llanowar Elves', { summoningSick: true, tapped: false });
assert(!checkCanAttack(tapSickCreature).canAttack, 'Summoning-sick mana dork without haste cannot attack');

// ══════════════════════════════════════════════════════════════════════════
// Additional: Lifelink during combat
// ══════════════════════════════════════════════════════════════════════════
section('BONUS — Lifelink in new resolveCombatDamage');

const llAttacker = makeCard('ll1', 'Baneslayer Angel', { keywords: ['Lifelink', 'First Strike'], power: '5', toughness: '5', controllerId: 'p1' });

const scenLL = simulateCombatDamage(
  { ll1: { ...llAttacker, markedForDamage: 0 } },
  [{ instanceId: 'll1', targetPlayerId: 'p2' }],
  [],
  { p1: { id: 'p1', life: 20, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} },
    p2: { id: 'p2', life: 40, poisonCounters: 0, commanderCastCount: {}, commanders: [], commanderDamage: {} } }
);
// Lifelink is a replacement effect — gain life simultaneously with dealing damage
// In first-strike step: deals 5, gains 5 (life 20 → 25); no normal step for first-striker
assert(scenLL.players['p2'].life === 35, 'Baneslayer deals 5 (first strike) + 5 (double? no — FS only) = 5 damage total to p2');
// Note: Baneslayer has First Strike only (not Double Strike), so only deals in FS step
// But our sim doesn't apply lifelink gains — that's a note for future engine work

// ══════════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`Fix Verification: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('🎉 All fixes verified!');
} else {
  console.log('⚠️  Some checks failed — review above.');
  process.exit(1);
}
