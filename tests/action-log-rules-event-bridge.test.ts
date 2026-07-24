import assert from "node:assert/strict";
import {
  actionLogToRulesEvents,
  actionRecordToRulesEvents,
  emitRulesEventsForAction,
} from "../client/src/engine/actionLogRulesEventBridge";
import { createRulesEventBus } from "../client/src/engine/rulesEventBus";
import type { ActionRecord, ActionType, Phase } from "../client/src/types/game";

const test = (name: string, run: () => void) => {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

const action = (
  actionType: ActionType,
  data: Record<string, unknown> = {},
  affectedObjects: string[] = ["card-1"],
): ActionRecord => ({
  id: `${actionType}-1`,
  turn: 2,
  phase: "combat" as Phase,
  playerId: "p1",
  actionType,
  timestamp: 1234,
  description: `${actionType} happened`,
  affectedObjects,
  data,
  flags: [],
  undone: false,
});

test("bridge maps cast spell action to spell.cast event", () => {
  const events = actionRecordToRulesEvents(action("CAST_SPELL", {
    fromZone: "hand",
    targets: ["target-1"],
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "spell.cast");

  if (events[0].type === "spell.cast") {
    assert.equal(events[0].payload.cardId, "card-1");
    assert.equal(events[0].payload.castFromZone, "hand");
  }
});

test("bridge maps airbend move action to zone change and mechanic events", () => {
  const events = actionRecordToRulesEvents(action("MOVE_CARD", {
    fromZone: "battlefield",
    toZone: "exile",
    mechanicId: "airbend",
  }));

  assert.deepEqual(events.map((event) => event.type), ["zone.changed", "mechanic.used"]);

  if (events[0].type === "zone.changed" && events[1].type === "mechanic.used") {
    assert.equal(events[0].payload.toZone, "exile");
    assert.equal(events[1].payload.mechanicId, "airbend");
  }
});

test("bridge maps earthbend counter action to counter and mechanic events", () => {
  const events = actionRecordToRulesEvents(action("ADD_COUNTER", {
    counterType: "+1/+1",
    amount: 4,
    mechanicId: "earthbend",
  }));

  assert.deepEqual(events.map((event) => event.type), ["counter.added", "mechanic.used"]);

  if (events[0].type === "counter.added" && events[1].type === "mechanic.used") {
    assert.equal(events[0].payload.amount, 4);
    assert.equal(events[1].payload.mechanicId, "earthbend");
  }
});

test("bridge maps token stack attack action to attacker declaration event", () => {
  const events = actionRecordToRulesEvents(action("DECLARE_ATTACKER", {
    targetPlayerId: "p2",
    assignmentId: "attack-1",
  }, ["goblin-1", "goblin-2"]));

  assert.equal(events[0].type, "combat.attacker.declared");

  if (events[0].type === "combat.attacker.declared") {
    assert.deepEqual(events[0].payload.attackerIds, ["goblin-1", "goblin-2"]);
    assert.deepEqual(events[0].payload.attackTarget, {
      type: "player",
      playerId: "p2",
    });
  }
});

test("bridge maps firebending mana action to mana event and mechanic event", () => {
  const events = actionRecordToRulesEvents(action("ADD_MANA", {
    color: "R",
    amount: 2,
    temporary: true,
    expires: "combat",
    mechanicId: "firebending",
  }, []));

  assert.deepEqual(events.map((event) => event.type), ["mana.added", "mechanic.used"]);

  if (events[0].type === "mana.added") {
    assert.equal(events[0].payload.color, "R");
    assert.equal(events[0].payload.amount, 2);
  }
});

test("bridge maps P/T override action to manual adjustment event", () => {
  const events = actionRecordToRulesEvents(action("OTHER", {
    powerToughnessOverride: {
      power: "5",
      toughness: "5",
    },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "manual.adjustment");
});

test("bridge can emit converted events into the rules event bus", () => {
  const bus = createRulesEventBus({
    eventIdFactory: () => "event-1",
    now: () => 1,
  });
  const emitted = emitRulesEventsForAction(bus, action("DECLARE_ATTACKER", {
    targetPlayerId: "p2",
  }));

  assert.equal(emitted.length, 1);
  assert.equal(bus.getHistory()[0].type, "combat.attacker.declared");
});

test("bridge converts action logs in order", () => {
  const events = actionLogToRulesEvents([
    action("CAST_SPELL", { fromZone: "hand" }, ["spell-1"]),
    action("MOVE_CARD", { fromZone: "stack", toZone: "battlefield" }, ["spell-1"]),
  ]);

  assert.deepEqual(events.map((event) => event.type), ["spell.cast", "zone.changed"]);
});
