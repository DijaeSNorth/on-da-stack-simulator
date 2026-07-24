import assert from "node:assert/strict";
import { assignCombatDamage } from "../client/src/engine/combatDamageAssignmentEngine";
import {
  applyContinuousEffects,
  createPowerToughnessOverrideEffect,
  type ContinuousCardSnapshot,
} from "../client/src/engine/continuousEffectsEngine";
import {
  applyReplacementEffects,
  findApplicableReplacementEffects,
  type ReplacementEffectDefinition,
} from "../client/src/engine/replacementEffectsEngine";
import {
  createCastingPlan,
  createSpellCastEventFromPlan,
} from "../client/src/engine/rulesCastingPipeline";
import {
  createPriorityState,
  orderTriggeredAbilitiesApnap,
  passPriority,
  reopenPriorityAfterResolution,
  takePriorityAction,
} from "../client/src/engine/rulesPriorityEngine";

const test = (name: string, run: () => void) => {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

test("priority starts in APNAP order from the active player", () => {
  const priority = createPriorityState(["p1", "p2", "p3"], "p2");

  assert.deepEqual(priority.priorityOrder, ["p2", "p3", "p1"]);
  assert.equal(priority.currentPlayerId, "p2");
});

test("priority pass cycle marks stack item ready to resolve after all players pass", () => {
  let priority = createPriorityState(["p1", "p2"], "p1", 1);

  priority = passPriority(priority, "p1");
  priority = passPriority(priority, "p2");

  assert.equal(priority.status, "pending_resolution");
  assert.equal(priority.currentPlayerId, undefined);

  priority = reopenPriorityAfterResolution(priority, 0);

  assert.equal(priority.status, "open");
  assert.equal(priority.stackDepth, 0);
  assert.equal(priority.currentPlayerId, "p1");
});

test("priority action resets passes and keeps priority with acting player", () => {
  let priority = createPriorityState(["p1", "p2"], "p1");

  priority = takePriorityAction(priority, "p1", "Cast Lightning Bolt", 1);

  assert.deepEqual(priority.passedPlayerIds, []);
  assert.equal(priority.currentPlayerId, "p1");
  assert.equal(priority.stackDepth, 1);
});

test("trigger ordering groups triggered abilities by APNAP order", () => {
  const ordered = orderTriggeredAbilitiesApnap("p2", ["p1", "p2", "p3"], [
    { triggerId: "p1-old", controllerId: "p1", createdAt: 1 },
    { triggerId: "p3", controllerId: "p3", createdAt: 1 },
    { triggerId: "p2", controllerId: "p2", createdAt: 1 },
    { triggerId: "p1-new", controllerId: "p1", createdAt: 2 },
  ]);

  assert.deepEqual(ordered.map((trigger) => trigger.triggerId), ["p2", "p3", "p1-old", "p1-new"]);
});

test("casting pipeline blocks missing required targets", () => {
  const plan = createCastingPlan({
    playerId: "p1",
    currentPhase: "main",
    card: {
      instanceId: "spell-1",
      name: "Target Spell",
      zone: "hand",
      manaCost: "{2}",
    },
    requiredTargetCount: 1,
    chosenTargets: [],
    availableGenericMana: 2,
  });

  assert.equal(plan.canProceed, false);
  assert.match(plan.errors.join(" "), /Missing 1 required target/);
});

test("casting pipeline creates typed spell cast event for a complete plan", () => {
  const plan = createCastingPlan({
    playerId: "p1",
    currentPhase: "main",
    card: {
      instanceId: "spell-1",
      name: "Bear",
      zone: "hand",
      manaCost: "{2}",
    },
    availableGenericMana: 2,
  });
  const event = createSpellCastEventFromPlan(plan);

  assert.equal(plan.canProceed, true);
  assert.equal(event?.type, "spell.cast");
  assert.equal(event?.payload.cardId, "spell-1");
});

test("continuous effects apply P/T set, modifications, counters, and switch in layer order", () => {
  const base: ContinuousCardSnapshot = {
    cardId: "creature-1",
    cardTypes: ["Creature"],
    subtypes: ["Bear"],
    colors: ["G"],
    keywords: [],
    power: 2,
    toughness: 2,
    counters: {
      "+1/+1": 1,
    },
  };

  const result = applyContinuousEffects(base, [
    createPowerToughnessOverrideEffect("creature-1", 4, 4, 1),
    {
      id: "giant-growth",
      layer: "powerToughnessModify",
      timestamp: 2,
      operation: {
        kind: "modifyPowerToughness",
        powerDelta: 3,
        toughnessDelta: 3,
      },
    },
    {
      id: "switch",
      layer: "powerToughnessSwitch",
      timestamp: 3,
      operation: {
        kind: "switchPowerToughness",
      },
    },
  ]);

  assert.equal(result.card.power, 8);
  assert.equal(result.card.toughness, 8);
  assert.deepEqual(result.appliedEffectIds, ["creature-1:pt-override:1", "giant-growth", "switch"]);
});

test("continuous effects preserve type additions in the type layer", () => {
  const base: ContinuousCardSnapshot = {
    cardId: "land-1",
    cardTypes: ["Land"],
    subtypes: ["Forest"],
    colors: [],
    keywords: [],
    power: null,
    toughness: null,
  };

  const result = applyContinuousEffects(base, [
    {
      id: "earthbend-type",
      layer: "type",
      timestamp: 1,
      operation: {
        kind: "addCardTypes",
        cardTypes: ["Creature"],
      },
    },
    {
      id: "earthbend-pt",
      layer: "powerToughnessSet",
      timestamp: 2,
      operation: {
        kind: "setPowerToughness",
        power: 0,
        toughness: 0,
      },
    },
  ]);

  assert.deepEqual(result.card.cardTypes, ["Land", "Creature"]);
  assert.equal(result.card.power, 0);
  assert.equal(result.card.toughness, 0);
});

test("replacement engine applies commander command-zone replacement", () => {
  const effect: ReplacementEffectDefinition = {
    id: "commander-replacement",
    eventType: "zone.changed",
    match: {
      cardId: "commander-1",
      toZone: "graveyard",
    },
    operation: {
      kind: "commanderToCommandZone",
      commanderId: "commander-1",
    },
  };

  const result = applyReplacementEffects({
    type: "zone.changed",
    payload: {
      cardId: "commander-1",
      fromZone: "battlefield",
      toZone: "graveyard",
    },
  }, [effect]);

  assert.equal(result.manualRequired, false);
  assert.equal(result.event.payload.toZone, "command");
  assert.deepEqual(result.appliedEffectIds, ["commander-replacement"]);
});

test("replacement engine requires manual choice for competing replacement effects", () => {
  const effects: ReplacementEffectDefinition[] = [
    {
      id: "to-exile",
      eventType: "zone.changed",
      operation: {
        kind: "replaceZoneDestination",
        toZone: "exile",
      },
    },
    {
      id: "to-command",
      eventType: "zone.changed",
      operation: {
        kind: "replaceZoneDestination",
        toZone: "command",
      },
    },
  ];
  const result = applyReplacementEffects({
    type: "zone.changed",
    payload: {
      cardId: "card-1",
      fromZone: "battlefield",
      toZone: "graveyard",
    },
  }, effects);

  assert.equal(findApplicableReplacementEffects(result.event, effects).length, 2);
  assert.equal(result.manualRequired, true);
});

test("replacement engine can prevent damage", () => {
  const result = applyReplacementEffects({
    type: "damage.dealt",
    payload: {
      sourceId: "creature-1",
      targetId: "p1",
      targetType: "player",
      amount: 5,
    },
  }, [
    {
      id: "prevent-two",
      eventType: "damage.dealt",
      operation: {
        kind: "preventDamage",
        amount: 2,
      },
    },
  ]);

  assert.equal(result.event.payload.amount, 3);
  assert.equal(result.preventedDamage, 2);
});

test("combat assignment helper calculates trample and deathtouch overflow", () => {
  const result = assignCombatDamage({
    attackerId: "attacker-1",
    attackerPower: 6,
    attackerKeywords: ["Trample", "Deathtouch"],
    blockers: [
      {
        blockerId: "blocker-1",
        toughness: 5,
      },
    ],
  });

  assert.equal(result.damageToBlockers["blocker-1"], 1);
  assert.equal(result.trampleOverflow, 5);
  assert.deepEqual(result.likelyDestroyedBlockers, ["blocker-1"]);
});

test("combat assignment helper warns when trample has multiple blockers and no order", () => {
  const result = assignCombatDamage({
    attackerId: "attacker-1",
    attackerPower: 6,
    attackerKeywords: ["Trample"],
    blockers: [
      {
        blockerId: "blocker-1",
        toughness: 2,
      },
      {
        blockerId: "blocker-2",
        toughness: 2,
      },
    ],
  });

  assert.equal(result.manualAssignmentRequired, true);
  assert.match(result.warnings.join(" "), /manual blocker order/);
});
