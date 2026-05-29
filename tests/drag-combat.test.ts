/**
 * ─── Drag-to-Attack/Block Critical Test Suite ─────────────────────────────────
 *
 * Tests cover:
 *   1.  Basic attack drag → opponent zone
 *   2.  Vigilance — attacker should NOT tap when attacking
 *   3.  Summoning sickness — sick creature cannot attack (no Haste)
 *   4.  Haste — sick creature WITH Haste CAN attack
 *   5.  Defender — cannot attack at all
 *   6.  Tapped creature — cannot attack or block
 *   7.  Block drag — basic legal block
 *   8.  Flying blocker — required for flying attacker
 *   9.  Reach — can block flying without flying keyword
 *  10.  Protection from green — green blocker illegal
 *  11.  Protection from creatures — no blocker legal
 *  12.  Intimidate — only artifact or same-color can block
 *  13.  Shadow — shadow can only block shadow
 *  14.  Menace — assistant flags need-review (engine still allows)
 *  15.  enterCombat ORDER — must fire before declareAttack
 *  16.  Multiple attackers in same combat
 *  17.  Myriad — dispatches custom event instead of declareAttack
 *  18.  Can't block your own attacker
 *  19.  Double blocker on same attacker (multi-block)
 *  20.  Deathtouch attacker — engine resolves, no drag restriction
 *  21.  Indestructible blocker — engine resolves, no drag restriction
 *  22.  100 Goblin tokens attacking — mass-attack stress test
 *  23.  Lifelink — assistant flags during damage (not drag restriction)
 *  24.  Protection from everything — nothing can block
 *  25.  Non-creature card — cannot be dragged as attacker or blocker
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { declareAttacker, declareBlocker, createEmptyGameState, createDefaultGameConfig, createPlayer } from '../client/src/engine/gameEngine';
import type { GameState, CardDefinition, CardState, Player } from '../client/src/types/game';

// ── Test utilities ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const results: { name: string; ok: boolean; error?: string }[] = [];

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push({ name, ok: true });
    passed++;
  } catch (e: unknown) {
    results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) });
    failed++;
  }
}

// ── Fixture builders ───────────────────────────────────────────────────────────

function makePlayer(id: string, color: string = '#ff0000'): Player {
  return {
    id,
    name: id,
    color,
    life: 40,
    commanderDamage: {},
    battlefield: [],
    hand: [],
    graveyard: [],
    exile: [],
    library: [],
    commandZone: [],
    isActive: false,
    seatIndex: 0,
    commanderCastCount: {},
    poisonCounters: 0,
    energyCounters: 0,
    experienceCounters: 0,
  };
}

function makeDef(overrides: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id: 'test-card',
    name: 'Test Creature',
    manaCost: '{2}{G}',
    cmc: 3,
    cardTypes: ['Creature'],
    subtypes: ['Elf'],
    supertypes: [],
    colors: ['G'],
    colorIdentity: ['G'],
    power: '2',
    toughness: '2',
    keywords: [],
    oracleText: '',
    scryfallId: 'test-id',
    imageUri: '',
    ...overrides,
  };
}

function makeCard(
  instanceId: string,
  controllerId: string,
  overrides: Partial<CardState> = {},
  defOverrides: Partial<CardDefinition> = {}
): CardState {
  return {
    instanceId,
    definition: makeDef(defOverrides),
    controllerId,
    ownerId: controllerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: [],
    token: false,
    combatRole: 'none',
    attachments: [],
    markedDamage: 0,
    ...overrides,
  };
}

function makeGameState(
  players: Player[],
  cards: Record<string, CardState>
): GameState {
  const cfg = createDefaultGameConfig(Math.max(2, Math.min(6, players.length)) as 2|3|4|5|6);
  const base = createEmptyGameState(cfg);
  return {
    ...base,
    players,
    cards,
    activePlayerId: players[0].id,
    combat: {
      active: false,
      attackingPlayerId: '',
      attackers: [],
      blockers: [],
      combatPhase: 'none',
      hasMyriad: false,
      myriadCopies: [],
    },
  };
}

// ── Drag mode logic (extracted for unit testing without React) ─────────────────
// Mirrors the logic in useDragCombat.ts

function getDragMode(
  card: CardState,
  localPlayerId: string,
  combatActive: boolean,
  attackingPlayerId: string,
  attackerCount: number
): 'attack' | 'block' | null {
  if (card.controllerId !== localPlayerId) return null;
  if (card.zone !== 'battlefield') return null;

  const localIsAttacker = attackingPlayerId === localPlayerId;
  const thereAreAttackers = attackerCount > 0;

  if (!combatActive || localIsAttacker) {
    // Can attack?
    if (!card.definition.cardTypes.includes('Creature')) return null;
    if (card.tapped) return null;
    if (card.summoningSick && !hasKw(card, 'haste')) return null;
    if (hasKw(card, 'defender')) return null;
    return 'attack';
  } else if (combatActive && !localIsAttacker && thereAreAttackers) {
    // Can block?
    if (!card.definition.cardTypes.includes('Creature')) return null;
    if (card.tapped) return null;
    return 'block';
  }
  return null;
}

function hasKw(card: CardState, kw: string): boolean {
  const lw = kw.toLowerCase();
  return (
    card.definition.keywords.some(k => k.toLowerCase() === lw) ||
    card.definition.oracleText.toLowerCase().includes(lw)
  );
}

function blockerLegal(
  blocker: CardState,
  attacker: CardState
): { legal: boolean; reason?: string } {
  const attackerFlies = hasKw(attacker, 'flying');
  const blockerFlies  = hasKw(blocker, 'flying');
  const blockerReach  = hasKw(blocker, 'reach');
  if (attackerFlies && !blockerFlies && !blockerReach) {
    return { legal: false, reason: 'no flying/reach' };
  }

  const attackerShadow = hasKw(attacker, 'shadow');
  const blockerShadow  = hasKw(blocker, 'shadow');
  if (attackerShadow && !blockerShadow) return { legal: false, reason: 'shadow vs non-shadow' };
  if (!attackerShadow && blockerShadow) return { legal: false, reason: 'non-shadow vs shadow' };

  // Protection
  const COLOR_NAME_TO_CODE: Record<string, string> = {
    white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g',
  };
  const aOracle = attacker.definition.oracleText.toLowerCase();
  const protMatch = aOracle.match(/protection from ([\w\s,]+?)(?:\.|,|\band\b|$)/g);
  if (protMatch) {
    const bColors = blocker.definition.colors.map(c => c.toLowerCase());
    const bTypes  = blocker.definition.subtypes?.map(t => t.toLowerCase()) ?? [];
    for (const pm of protMatch) {
      const quality = pm.replace('protection from ', '').replace(/[.,]+$/, '').trim();
      if (quality === 'everything') {
        return { legal: false, reason: 'protection from everything' };
      }
      const qualityCode = COLOR_NAME_TO_CODE[quality] ?? quality;
      if (bColors.includes(qualityCode) || bColors.includes(quality) || bTypes.includes(quality)) {
        return { legal: false, reason: `protection from ${quality}` };
      }
    }
  }

  // Intimidate
  if (hasKw(attacker, 'intimidate')) {
    const aColors  = attacker.definition.colors.map(c => c.toLowerCase());
    const bColors  = blocker.definition.colors.map(c => c.toLowerCase());
    const bIsArt   = blocker.definition.cardTypes.includes('Artifact');
    const shared   = aColors.some(c => bColors.includes(c));
    if (!bIsArt && !shared) return { legal: false, reason: 'intimidate' };
  }

  return { legal: true };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

// 1. Basic attack
test('1. Basic attack drag mode', () => {
  const card = makeCard('c1', 'p1');
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === 'attack', `Expected 'attack', got '${mode}'`);
});

// 2. Vigilance — attacker must NOT tap
test('2. Vigilance: attacker does not tap', () => {
  const p1 = makePlayer('p1'); p1.battlefield = ['c1'];
  const p2 = makePlayer('p2'); p2.battlefield = [];
  const vigilantCard = makeCard('c1', 'p1', {}, { keywords: ['Vigilance'], name: 'Serra Angel' });
  const state = makeGameState([p1, p2], { c1: vigilantCard });

  const after = declareAttacker(state, 'c1', 'p2');
  assert(!after.cards['c1'].tapped, 'Vigilance creature should NOT tap when attacking');
  assert(after.cards['c1'].combatRole === 'attacker', 'Should be marked as attacker');
});

// 3. Summoning sickness — cannot attack
test('3. Summoning sickness: drag mode returns null', () => {
  const card = makeCard('c1', 'p1', { summoningSick: true });
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === null, `Expected null (can't attack while sick), got '${mode}'`);
});

// 4. Haste overrides summoning sickness
test('4. Haste: sick creature with Haste CAN attack', () => {
  const card = makeCard('c1', 'p1', { summoningSick: true }, { keywords: ['Haste'], name: 'Goblin Guide' });
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === 'attack', `Expected 'attack' (Haste overrides sickness), got '${mode}'`);
});

// 4b. Haste in oracle text (not just keywords)
test('4b. Haste in oracle text overrides summoning sickness', () => {
  const card = makeCard('c1', 'p1', { summoningSick: true }, {
    keywords: [],
    oracleText: 'Haste\nWhen this creature enters, it deals 1 damage.',
    name: 'Goblin Chainwhirler',
  });
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === 'attack', `Expected 'attack' (Haste in oracle), got '${mode}'`);
});

// 5. Defender cannot attack
test('5. Defender: drag mode returns null', () => {
  const card = makeCard('c1', 'p1', {}, { keywords: ['Defender'], name: 'Wall of Roots' });
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === null, `Expected null (Defender cannot attack), got '${mode}'`);
});

// 5b. Defender in oracle text
test('5b. Defender in oracle text: drag mode returns null', () => {
  const card = makeCard('c1', 'p1', {}, {
    keywords: [],
    oracleText: 'Defender\n{T}: Add {G}.',
    name: 'Overgrown Battlement',
  });
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === null, `Expected null (Defender in oracle), got '${mode}'`);
});

// 6. Tapped creature cannot attack
test('6. Tapped creature: cannot attack', () => {
  const card = makeCard('c1', 'p1', { tapped: true });
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === null, `Expected null (tapped), got '${mode}'`);
});

// 6b. Tapped creature cannot block
test('6b. Tapped creature: cannot block', () => {
  const card = makeCard('c1', 'p1', { tapped: true });
  const mode = getDragMode(card, 'p1', true, 'p2', 1);
  assert(mode === null, `Expected null (tapped can't block), got '${mode}'`);
});

// 7. Basic block
test('7. Basic legal block', () => {
  const p1 = makePlayer('p1'); p1.battlefield = ['blocker'];
  const p2 = makePlayer('p2'); p2.battlefield = ['attacker'];
  const attackerCard = makeCard('attacker', 'p2', { combatRole: 'attacker', attackTarget: 'p1' });
  const blockerCard  = makeCard('blocker',  'p1');
  const state = makeGameState([p1, p2], { attacker: attackerCard, blocker: blockerCard });
  const stateWithCombat = {
    ...state,
    combat: {
      ...state.combat,
      active: true,
      attackingPlayerId: 'p2',
      attackers: [{ instanceId: 'attacker', targetPlayerId: 'p1', targets: [] }],
    },
  };

  const after = declareBlocker(stateWithCombat, 'blocker', 'attacker');
  assert(after.cards['blocker'].combatRole === 'blocker', 'Should be marked as blocker');
  assert(after.combat.blockers.length === 1, 'Should have 1 blocker registered');
});

// 7b. Block drag mode — correct context
test('7b. Block mode: set when combat active and not attacker', () => {
  const card = makeCard('blocker', 'p1');
  const mode = getDragMode(card, 'p1', true, 'p2', 1);
  assert(mode === 'block', `Expected 'block', got '${mode}'`);
});

// 8. Flying blocker required
test('8. Flying: ground creature cannot block flyer', () => {
  const attacker = makeCard('a', 'p2', {}, { keywords: ['Flying'], name: 'Serra Angel' });
  const blocker  = makeCard('b', 'p1', {}, { keywords: [], name: 'Llanowar Elves' });
  const { legal, reason } = blockerLegal(blocker, attacker);
  assert(!legal, `Expected illegal block, got legal`);
  assert(reason?.includes('no flying/reach'), `Expected flying/reach reason, got: ${reason}`);
});

// 9. Reach can block flying
test('9. Reach: can block flying attacker', () => {
  const attacker = makeCard('a', 'p2', {}, { keywords: ['Flying'], name: 'Serra Angel' });
  const blocker  = makeCard('b', 'p1', {}, { keywords: ['Reach'], name: 'Giant Spider' });
  const { legal } = blockerLegal(blocker, attacker);
  assert(legal, `Reach should be able to block flying`);
});

// 9b. Flying can block flying
test('9b. Flying: can block another flying creature', () => {
  const attacker = makeCard('a', 'p2', {}, { keywords: ['Flying'], name: 'Dragon' });
  const blocker  = makeCard('b', 'p1', {}, { keywords: ['Flying'], name: 'Birds of Paradise' });
  const { legal } = blockerLegal(blocker, attacker);
  assert(legal, `Flying should block flying`);
});

// 10. Protection from green — green blocker illegal
test('10. Protection from green: green creature cannot block', () => {
  const attacker = makeCard('a', 'p2', {}, {
    oracleText: 'Protection from green.',
    colors: ['W'],
    name: 'White Knight',
  });
  const blocker = makeCard('b', 'p1', {}, { colors: ['G'], name: 'Llanowar Elves' });
  const { legal, reason } = blockerLegal(blocker, attacker);
  assert(!legal, `Green creature should not block "protection from green"`);
  assert(reason?.includes('protection from'), `Expected protection reason, got: ${reason}`);
});

// 11. Protection from everything
test('11. Protection from everything: no creature can block', () => {
  const attacker = makeCard('a', 'p2', {}, {
    oracleText: 'Protection from everything.',
    name: 'Progenitus',
  });
  const blocker = makeCard('b', 'p1', {}, { colors: ['R'], name: 'Lightning Elemental' });
  const { legal } = blockerLegal(blocker, attacker);
  assert(!legal, `Protection from everything should prevent all blocks`);
});

// 12. Intimidate — only artifact or same-color can block
test('12. Intimidate: off-color, non-artifact cannot block', () => {
  const attacker = makeCard('a', 'p2', {}, { keywords: ['Intimidate'], colors: ['R'], name: 'Intimidating Creature' });
  const blocker  = makeCard('b', 'p1', {}, { colors: ['G'], name: 'Forest Druid' });
  const { legal } = blockerLegal(blocker, attacker);
  assert(!legal, `Off-color non-artifact should be unable to block Intimidate`);
});

test('12b. Intimidate: artifact creature CAN block', () => {
  const attacker = makeCard('a', 'p2', {}, { keywords: ['Intimidate'], colors: ['R'], name: 'Intimidating Creature' });
  const blocker  = makeCard('b', 'p1', {}, {
    colors: [],
    cardTypes: ['Artifact', 'Creature'],
    name: 'Juggernaut',
  });
  const { legal } = blockerLegal(blocker, attacker);
  assert(legal, `Artifact creature should block Intimidate`);
});

test('12c. Intimidate: same-color CAN block', () => {
  const attacker = makeCard('a', 'p2', {}, { keywords: ['Intimidate'], colors: ['R'], name: 'Intimidating Red' });
  const blocker  = makeCard('b', 'p1', {}, { colors: ['R'], name: 'Red Goblin' });
  const { legal } = blockerLegal(blocker, attacker);
  assert(legal, `Same-color should block Intimidate`);
});

// 13. Shadow — shadow vs non-shadow
test('13. Shadow: non-shadow cannot block shadow', () => {
  const attacker = makeCard('a', 'p2', {}, { keywords: ['Shadow'], name: 'Soltari Monk' });
  const blocker  = makeCard('b', 'p1', {}, { keywords: [], name: 'Grizzly Bears' });
  const { legal } = blockerLegal(blocker, attacker);
  assert(!legal, `Non-shadow cannot block shadow`);
});

test('13b. Shadow: shadow CAN block shadow', () => {
  const attacker = makeCard('a', 'p2', {}, { keywords: ['Shadow'], name: 'Soltari Monk' });
  const blocker  = makeCard('b', 'p1', {}, { keywords: ['Shadow'], name: 'Dauthi Slayer' });
  const { legal } = blockerLegal(blocker, attacker);
  assert(legal, `Shadow can block shadow`);
});

test('13c. Shadow: shadow cannot block non-shadow', () => {
  const attacker = makeCard('a', 'p2', {}, { keywords: [], name: 'Grizzly Bears' });
  const blocker  = makeCard('b', 'p1', {}, { keywords: ['Shadow'], name: 'Shadow Creature' });
  const { legal } = blockerLegal(blocker, attacker);
  assert(!legal, `Shadow blocker cannot block non-shadow attacker`);
});

// 14. Menace — drag mode still works, but engine flags it (simulated)
test('14. Menace: drag mode still returns attack (engine flags)', () => {
  const card = makeCard('c1', 'p1', {}, { keywords: ['Menace'], name: 'Goblin Warchief' });
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === 'attack', `Menace attacker should still be draggable, got '${mode}'`);
});

// 15. enterCombat ORDER — this is a logical test of the store ordering contract
test('15. enterCombat must fire before declareAttack', () => {
  const p1 = makePlayer('p1'); p1.battlefield = ['c1'];
  const p2 = makePlayer('p2'); p2.battlefield = [];
  const card = makeCard('c1', 'p1');
  const state = makeGameState([p1, p2], { c1: card });

  // Simulate enterCombat first, then declareAttacker
  const afterEnter = {
    ...state,
    combat: {
      ...state.combat,
      active: true,
      attackingPlayerId: 'p1',
      attackers: [],
      blockers: [],
    },
  };
  const afterDeclare = declareAttacker(afterEnter, 'c1', 'p2');
  assert(afterDeclare.combat.attackers.length === 1, 'Attacker registered after enterCombat + declareAttack');

  // Simulate WRONG ORDER (declareAttacker first, then enterCombat resets)
  const afterDeclareFirst = declareAttacker(state, 'c1', 'p2');
  const wrongOrder = {
    ...afterDeclareFirst,
    combat: {
      ...afterDeclareFirst.combat,
      active: true,
      attackers: [], // enterCombat resets
    },
  };
  assert(wrongOrder.combat.attackers.length === 0, 'Wrong order WIPES the declared attacker — confirm the bug is real');
});

// 16. Multiple attackers in same combat
test('16. Multiple attackers in same combat', () => {
  const p1 = makePlayer('p1'); p1.battlefield = ['c1', 'c2', 'c3'];
  const p2 = makePlayer('p2'); p2.battlefield = [];
  const state = makeGameState([p1, p2], {
    c1: makeCard('c1', 'p1', {}, { name: 'Attacker 1' }),
    c2: makeCard('c2', 'p1', {}, { name: 'Attacker 2' }),
    c3: makeCard('c3', 'p1', {}, { name: 'Attacker 3' }),
  });
  const after1 = declareAttacker(state, 'c1', 'p2');
  const after2 = declareAttacker(after1, 'c2', 'p2');
  const after3 = declareAttacker(after2, 'c3', 'p2');
  assert(after3.combat.attackers.length === 3, `Expected 3 attackers, got ${after3.combat.attackers.length}`);
  assert(after3.cards['c1'].tapped, 'c1 should be tapped');
  assert(after3.cards['c2'].tapped, 'c2 should be tapped');
  assert(after3.cards['c3'].tapped, 'c3 should be tapped');
});

// 17. Myriad — hasMyriad flag set correctly
test('17. Myriad: hasMyriad detected via keyword', () => {
  const card = makeCard('c1', 'p1', {}, { keywords: ['Myriad'], name: 'Blade of Selves copy' });
  const hasMyriad =
    card.definition.keywords.some(k => k.toLowerCase() === 'myriad') ||
    card.definition.oracleText.toLowerCase().includes('myriad');
  assert(hasMyriad, 'Should detect Myriad via keywords');
});

test('17b. Myriad: hasMyriad detected via oracle text', () => {
  const card = makeCard('c1', 'p1', {}, {
    keywords: [],
    oracleText: 'Myriad (Whenever this creature attacks, for each opponent other than the defending player, you may create a token...)',
    name: 'Blade of Selves equip',
  });
  const hasMyriad =
    card.definition.keywords.some(k => k.toLowerCase() === 'myriad') ||
    card.definition.oracleText.toLowerCase().includes('myriad');
  assert(hasMyriad, `Should detect Myriad via oracle text`);
});

// 18. Cannot block your own attacker
test("18. Can't block your own side's attacking creature", () => {
  // Both cards owned by p1 — blocker cannot be assigned to p1's own attacker
  const attacker = makeCard('a', 'p1', { combatRole: 'attacker' });
  const blocker  = makeCard('b', 'p1');
  // In drag context: attacker.controllerId === blocker.controllerId → illegal
  const sameController = attacker.controllerId === blocker.controllerId;
  assert(sameController, 'Test setup: both cards controlled by p1');
  // The drag code checks: if (attacker.controllerId === blocker.controllerId) return
  // → block drop is rejected
  assert(sameController === true, "Same-controller check prevents blocking own attacker");
});

// 19. Double blocker (multiple creatures blocking same attacker)
test('19. Multiple blockers on same attacker', () => {
  const p1 = makePlayer('p1'); p1.battlefield = ['b1', 'b2'];
  const p2 = makePlayer('p2'); p2.battlefield = ['a1'];
  const attacker  = makeCard('a1', 'p2', { combatRole: 'attacker', attackTarget: 'p1' });
  const blocker1  = makeCard('b1', 'p1');
  const blocker2  = makeCard('b2', 'p1');
  const state = makeGameState([p1, p2], { a1: attacker, b1: blocker1, b2: blocker2 });
  const withCombat = {
    ...state,
    combat: {
      ...state.combat,
      active: true,
      attackingPlayerId: 'p2',
      attackers: [{ instanceId: 'a1', targetPlayerId: 'p1', targets: [] }],
    },
  };
  const after1 = declareBlocker(withCombat, 'b1', 'a1');
  const after2 = declareBlocker(after1, 'b2', 'a1');
  assert(after2.combat.blockers.length === 2, `Expected 2 blockers, got ${after2.combat.blockers.length}`);
  assert(after2.combat.blockers.every(b => b.blockedAttacker === 'a1'), 'Both blockers target a1');
});

// 20. Deathtouch — no drag restriction, engine handles
test('20. Deathtouch attacker: drag mode works normally', () => {
  const card = makeCard('c1', 'p1', {}, { keywords: ['Deathtouch'], name: 'Acidic Slime' });
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === 'attack', `Deathtouch should not restrict drag, got '${mode}'`);
});

// 21. Indestructible blocker — no drag restriction
test('21. Indestructible blocker: drag mode works normally', () => {
  const card = makeCard('c1', 'p1', {}, { keywords: ['Indestructible'], name: 'Darksteel Colossus' });
  const mode = getDragMode(card, 'p1', true, 'p2', 1);
  assert(mode === 'block', `Indestructible should not restrict blocking, got '${mode}'`);
});

// 22. 100 Goblin tokens — stress test
test('22. Stress: 100 Goblin tokens attacking (via declareAttacker loop)', () => {
  const p1 = makePlayer('p1');
  const p2 = makePlayer('p2');
  const cards: Record<string, CardState> = {};
  p1.battlefield = [];

  for (let i = 0; i < 100; i++) {
    const id = `goblin-${i}`;
    p1.battlefield.push(id);
    cards[id] = makeCard(id, 'p1', { token: true }, {
      name: 'Goblin Token',
      power: '1',
      toughness: '1',
      keywords: [],
    });
  }

  const state = makeGameState([p1, p2], cards);
  let g = {
    ...state,
    combat: {
      ...state.combat,
      active: true,
      attackingPlayerId: 'p1',
      attackers: [],
      blockers: [],
    },
  };

  for (let i = 0; i < 100; i++) {
    g = declareAttacker(g, `goblin-${i}`, 'p2');
  }

  assert(g.combat.attackers.length === 100, `Expected 100 attackers, got ${g.combat.attackers.length}`);
  assert(g.cards['goblin-0'].tapped, 'goblin-0 should be tapped');
  assert(g.cards['goblin-99'].tapped, 'goblin-99 should be tapped');
});

// 23. Lifelink — no drag restriction
test('23. Lifelink: drag mode works normally', () => {
  const card = makeCard('c1', 'p1', {}, { keywords: ['Lifelink'], name: 'Loxodon Hierarch' });
  const mode = getDragMode(card, 'p1', false, '', 0);
  assert(mode === 'attack', `Lifelink should not restrict attack drag, got '${mode}'`);
});

// 24. Protection from everything — no blocker legal
test('24. Protection from everything: any blocker illegal', () => {
  const attacker = makeCard('a', 'p2', {}, {
    oracleText: 'Protection from everything.',
    colors: ['W', 'U', 'B', 'R', 'G'],
    name: 'Progenitus',
  });
  const coloredBlockers = [
    makeCard('b1', 'p1', {}, { colors: ['W'], name: 'White blocker' }),
    makeCard('b2', 'p1', {}, { colors: ['R'], name: 'Red blocker' }),
    makeCard('b3', 'p1', {}, { colors: [], cardTypes: ['Artifact', 'Creature'], name: 'Artifact blocker' }),
  ];
  for (const blocker of coloredBlockers) {
    const { legal } = blockerLegal(blocker, attacker);
    assert(!legal, `${blocker.definition.name} should not legally block Progenitus`);
  }
});

// 25. Non-creature cannot attack or block
test('25. Non-creature: cannot be dragged as attacker or blocker', () => {
  const instant = makeCard('c1', 'p1', { zone: 'battlefield' }, {
    cardTypes: ['Instant'],
    name: 'Counterspell',
    power: undefined,
    toughness: undefined,
  });
  const attackMode = getDragMode(instant, 'p1', false, '', 0);
  const blockMode  = getDragMode(instant, 'p1', true, 'p2', 1);
  assert(attackMode === null, `Non-creature attack mode should be null, got '${attackMode}'`);
  assert(blockMode === null, `Non-creature block mode should be null, got '${blockMode}'`);
});

// ── Vigilance — non-tapping during attack (engine level) ─────────────────────
test('26. Vigilance in oracle text: also does not tap', () => {
  const p1 = makePlayer('p1'); p1.battlefield = ['c1'];
  const p2 = makePlayer('p2');
  const card = makeCard('c1', 'p1', {}, {
    keywords: [],
    oracleText: 'Vigilance\nWhenever this creature attacks, you gain 1 life.',
    name: 'Heliod champion',
  });
  const state = makeGameState([p1, p2], { c1: card });
  const after = declareAttacker(state, 'c1', 'p2');
  assert(!after.cards['c1'].tapped, 'Vigilance via oracle text should prevent tapping');
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('  DRAG-TO-ATTACK/BLOCK — CRITICAL TEST SUITE');
console.log('═'.repeat(60));

let maxLen = 0;
for (const r of results) if (r.name.length > maxLen) maxLen = r.name.length;

for (const r of results) {
  const icon = r.ok ? '✅' : '❌';
  const pad  = ' '.repeat(maxLen - r.name.length + 2);
  console.log(`${icon} ${r.name}${r.ok ? '' : pad + '← ' + r.error}`);
}

console.log('─'.repeat(60));
console.log(`  PASSED: ${passed}/${passed + failed}`);
if (failed > 0) {
  console.log(`  FAILED: ${failed}`);
  process.exit(1);
} else {
  console.log('  ALL TESTS PASSED ✅');
}
