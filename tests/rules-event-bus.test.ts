import assert from "node:assert/strict";
import {
  createRulesAutomationRegistry,
  createRulesEventBus,
  type RulesEvent,
} from "../client/src/engine/rulesEventBus";

const test = (name: string, run: () => void) => {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

const createDeterministicBus = () => {
  let eventSequence = 0;

  return createRulesEventBus({
    eventIdFactory: () => `event-${++eventSequence}`,
    now: () => 1000 + eventSequence,
  });
};

test("typed rules events dispatch to matching listeners", () => {
  const bus = createDeterministicBus();
  const seen: string[] = [];

  bus.on("spell.cast", (event) => {
    seen.push(`${event.payload.playerId}:${event.payload.cardId}`);
  });

  const event = bus.emit({
    type: "spell.cast",
    actorId: "p1",
    payload: {
      cardId: "card-1",
      playerId: "p1",
      castFromZone: "hand",
    },
  });

  assert.equal(event.eventId, "event-1");
  assert.deepEqual(seen, ["p1:card-1"]);
  assert.equal(bus.getHistory().length, 1);
});

test("rules event listeners can emit follow-up events", () => {
  const bus = createDeterministicBus();

  bus.on("counter.added", (event) => [
    {
      type: "state.cleanup",
      actorId: event.actorId,
      payload: {
        cleanupType: "state_based_actions",
        affectedCardIds: [event.payload.cardId],
      },
    },
  ]);

  bus.emit({
    type: "counter.added",
    actorId: "p1",
    payload: {
      cardId: "creature-1",
      counterType: "+1/+1",
      amount: 1,
    },
  });

  assert.deepEqual(
    bus.getHistory().map((event) => event.type),
    ["counter.added", "state.cleanup"],
  );
});

test("once listeners unsubscribe after first matching event", () => {
  const bus = createDeterministicBus();
  let calls = 0;

  bus.once("turn.started", () => {
    calls += 1;
  });

  bus.emit({
    type: "turn.started",
    payload: {
      playerId: "p1",
      turnNumber: 1,
    },
  });
  bus.emit({
    type: "turn.started",
    payload: {
      playerId: "p1",
      turnNumber: 2,
    },
  });

  assert.equal(calls, 1);
});

test("wildcard listeners receive all event types", () => {
  const bus = createDeterministicBus();
  const seen: string[] = [];

  bus.onAny((event) => {
    seen.push(event.type);
  });

  bus.emit({
    type: "phase.changed",
    payload: {
      toPhase: "combat",
    },
  });
  bus.emit({
    type: "mechanic.used",
    payload: {
      mechanicId: "firebending",
      playerId: "p1",
      amount: 2,
    },
  });

  assert.deepEqual(seen, ["phase.changed", "mechanic.used"]);
});

test("listener failures are captured without stopping later listeners", () => {
  const failures: string[] = [];
  const bus = createRulesEventBus({
    eventIdFactory: () => "event-error",
    now: () => 1000,
    onError: (failure) => failures.push(failure.message),
  });
  let successfulListenerCalled = false;

  bus.on("damage.dealt", () => {
    throw new Error("handler exploded");
  });
  bus.on("damage.dealt", () => {
    successfulListenerCalled = true;
  });

  bus.emit({
    type: "damage.dealt",
    payload: {
      targetId: "p2",
      targetType: "player",
      amount: 3,
    },
  });

  assert.equal(successfulListenerCalled, true);
  assert.deepEqual(failures, ["handler exploded"]);
  assert.equal(bus.getFailures().length, 1);
});

test("unknown automation handler IDs are ignored safely", () => {
  const bus = createDeterministicBus();
  const registry = createRulesAutomationRegistry();
  const event = bus.emit({
    type: "mechanic.used",
    payload: {
      mechanicId: "unknown-future-mechanic",
      playerId: "p1",
    },
  });

  const result = registry.execute("future.handler.v1", event, {
    emit: bus.emit,
    getHistory: bus.getHistory,
  });

  assert.equal(result.applied, false);
  assert.equal(result.ignored, true);
  assert.match(result.manualPrompt ?? "", /manual/i);
});

test("code-owned automation handlers can emit typed follow-up events", () => {
  const bus = createDeterministicBus();
  const registry = createRulesAutomationRegistry();

  registry.register({
    id: "test.firebending.attackMana.v1",
    eventTypes: ["combat.attacker.declared"],
    handle: (event) => ({
      applied: true,
      logEntries: [`${event.payload.controllerId} gained temporary red mana.`],
      emittedEvents: [
        {
          type: "mana.added",
          actorId: event.payload.controllerId,
          payload: {
            playerId: event.payload.controllerId,
            color: "R",
            amount: event.payload.attackerIds.length,
            temporary: true,
            expires: "combat",
          },
        },
      ],
    }),
  });

  const event: RulesEvent<"combat.attacker.declared"> = bus.emit({
    type: "combat.attacker.declared",
    payload: {
      attackerIds: ["attacker-1", "attacker-2"],
      controllerId: "p1",
      attackTarget: {
        type: "player",
        playerId: "p2",
      },
    },
  });

  const result = registry.execute("test.firebending.attackMana.v1", event, {
    emit: bus.emit,
    getHistory: bus.getHistory,
  });

  assert.equal(result.applied, true);
  assert.equal(bus.getHistory().at(-1)?.type, "mana.added");
});

test("automation handler event type mismatches are ignored safely", () => {
  const bus = createDeterministicBus();
  const registry = createRulesAutomationRegistry();

  registry.register({
    id: "test.clue.draw.v1",
    eventTypes: ["mechanic.used"],
    handle: () => ({
      applied: true,
    }),
  });

  const event = bus.emit({
    type: "damage.dealt",
    payload: {
      targetId: "p2",
      targetType: "player",
      amount: 2,
    },
  });

  const result = registry.execute("test.clue.draw.v1", event, {
    emit: bus.emit,
    getHistory: bus.getHistory,
  });

  assert.equal(result.applied, false);
  assert.equal(result.ignored, true);
});
