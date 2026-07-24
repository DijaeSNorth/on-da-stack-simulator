import type { ActionRecord } from "../types/game";
import type {
  RulesEventBus,
  RulesEventInput,
  RulesEventName,
} from "./rulesEventBus";

type ManaColor = "W" | "U" | "B" | "R" | "G" | "C" | "generic";
type ManaExpiry = "step" | "phase" | "turn" | "combat" | "manual";

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;

const asManaColor = (value: unknown): ManaColor => {
  const color = asString(value);

  return color === "W"
    || color === "U"
    || color === "B"
    || color === "R"
    || color === "G"
    || color === "C"
    || color === "generic"
    ? color
    : "generic";
};

const asManaExpiry = (value: unknown): ManaExpiry | undefined => {
  const expires = asString(value);

  return expires === "step"
    || expires === "phase"
    || expires === "turn"
    || expires === "combat"
    || expires === "manual"
    ? expires
    : undefined;
};

const getTargetFromAction = (
  data: Record<string, unknown>,
): unknown => {
  const attackTarget = data.attackTarget;

  if (attackTarget && typeof attackTarget === "object") {
    return attackTarget;
  }

  const targetPlayerId = asString(data.targetPlayerId) ?? asString(data.defendingPlayerId);

  if (targetPlayerId) {
    return {
      type: "player",
      playerId: targetPlayerId,
    };
  }

  const targetPermanentId = asString(data.targetPermanentId) ?? asString(data.planeswalkerId) ?? asString(data.battleId);

  if (targetPermanentId) {
    return {
      type: data.battleId ? "battle" : "planeswalker",
      permanentId: targetPermanentId,
      controllerId: asString(data.controllerId) ?? asString(data.protectorId) ?? "unknown",
    };
  }

  return {
    type: "player",
    playerId: "unknown",
  };
};

const mechanicEventFromAction = (
  action: ActionRecord,
  mechanicId: string,
): RulesEventInput<"mechanic.used"> => ({
  type: "mechanic.used",
  actorId: action.playerId,
  turn: action.turn,
  phase: action.phase,
  timestamp: action.timestamp,
  payload: {
    mechanicId,
    playerId: action.playerId,
    sourceInstanceId: action.affectedObjects[0],
    targetIds: action.affectedObjects.slice(1),
    amount: asNumber(action.data.amount) ?? asNumber(action.data.count),
  },
  metadata: {
    source: "actionLogRulesEventBridge",
    mechanicId,
    correlationId: action.id,
  },
});

export const actionRecordToRulesEvents = (
  action: ActionRecord,
): RulesEventInput<RulesEventName>[] => {
  const data = action.data ?? {};
  const events: RulesEventInput<RulesEventName>[] = [];
  const firstObjectId = action.affectedObjects[0];
  const mechanicId = asString(data.mechanicId);

  switch (action.actionType) {
    case "CHANGE_PHASE":
      events.push({
        type: "phase.changed",
        actorId: action.playerId,
        turn: action.turn,
        phase: action.phase,
        timestamp: action.timestamp,
        payload: {
          fromPhase: asString(data.fromPhase),
          toPhase: asString(data.toPhase) ?? action.phase,
          activePlayerId: asString(data.activePlayerId) ?? action.playerId,
        },
        metadata: {
          source: "actionLogRulesEventBridge",
          correlationId: action.id,
        },
      });
      break;
    case "CAST":
    case "CAST_SPELL":
      if (firstObjectId) {
        events.push({
          type: "spell.cast",
          actorId: action.playerId,
          turn: action.turn,
          phase: action.phase,
          timestamp: action.timestamp,
          payload: {
            cardId: firstObjectId,
            playerId: action.playerId,
            castFromZone: asString(data.fromZone) ?? asString(data.castFromZone) ?? "unknown",
            alternativeCost: asString(data.alternativeCost),
            mechanicId,
            targets: asStringArray(data.targets),
          },
          metadata: {
            source: "actionLogRulesEventBridge",
            mechanicId,
            correlationId: action.id,
          },
        });
      }
      break;
    case "RESOLVE_STACK":
      if (firstObjectId) {
        events.push({
          type: "spell.resolved",
          actorId: action.playerId,
          turn: action.turn,
          phase: action.phase,
          timestamp: action.timestamp,
          payload: {
            cardId: firstObjectId,
            playerId: action.playerId,
            destinationZone: asString(data.toZone),
          },
          metadata: {
            source: "actionLogRulesEventBridge",
            correlationId: action.id,
          },
        });
      }
      break;
    case "MOVE_CARD":
      if (firstObjectId) {
        events.push({
          type: "zone.changed",
          actorId: action.playerId,
          turn: action.turn,
          phase: action.phase,
          timestamp: action.timestamp,
          payload: {
            cardId: firstObjectId,
            fromZone: asString(data.fromZone),
            toZone: asString(data.toZone) ?? "unknown",
            ownerId: asString(data.ownerId),
            controllerId: asString(data.controllerId) ?? action.playerId,
            reason: mechanicId ?? action.actionType,
          },
          metadata: {
            source: "actionLogRulesEventBridge",
            mechanicId,
            correlationId: action.id,
          },
        });
      }
      break;
    case "DECLARE_ATTACKER":
      events.push({
        type: "combat.attacker.declared",
        actorId: action.playerId,
        turn: action.turn,
        phase: action.phase,
        timestamp: action.timestamp,
        payload: {
          attackerIds: action.affectedObjects,
          controllerId: action.playerId,
          attackTarget: getTargetFromAction(data),
          assignmentId: asString(data.assignmentId),
        },
        metadata: {
          source: "actionLogRulesEventBridge",
          mechanicId,
          correlationId: action.id,
        },
      });
      break;
    case "DECLARE_BLOCKER":
      events.push({
        type: "combat.blocker.declared",
        actorId: action.playerId,
        turn: action.turn,
        phase: action.phase,
        timestamp: action.timestamp,
        payload: {
          blockerIds: action.affectedObjects,
          blockerControllerId: action.playerId,
          blockedAttackAssignmentId: asString(data.blockedAttackAssignmentId),
          blockedAttackerIds: asStringArray(data.blockedAttackerIds),
        },
        metadata: {
          source: "actionLogRulesEventBridge",
          correlationId: action.id,
        },
      });
      break;
    case "ADD_COUNTER":
    case "REMOVE_COUNTER":
      if (firstObjectId) {
        events.push({
          type: action.actionType === "ADD_COUNTER" ? "counter.added" : "counter.removed",
          actorId: action.playerId,
          turn: action.turn,
          phase: action.phase,
          timestamp: action.timestamp,
          payload: {
            cardId: firstObjectId,
            counterType: asString(data.counterType) ?? "+1/+1",
            amount: asNumber(data.amount) ?? 1,
            playerId: action.playerId,
            reason: mechanicId ?? action.description,
          },
          metadata: {
            source: "actionLogRulesEventBridge",
            mechanicId,
            correlationId: action.id,
          },
        });
      }
      break;
    case "ADD_MANA":
      events.push({
        type: "mana.added",
        actorId: action.playerId,
        turn: action.turn,
        phase: action.phase,
        timestamp: action.timestamp,
        payload: {
          playerId: action.playerId,
          color: asManaColor(data.color),
          amount: asNumber(data.amount) ?? 1,
          temporary: Boolean(data.temporary),
          expires: asManaExpiry(data.expires),
        },
        metadata: {
          source: "actionLogRulesEventBridge",
          mechanicId,
          correlationId: action.id,
        },
      });
      break;
    case "COMMANDER_DAMAGE":
      events.push({
        type: "damage.dealt",
        actorId: action.playerId,
        turn: action.turn,
        phase: action.phase,
        timestamp: action.timestamp,
        payload: {
          sourceId: firstObjectId,
          targetId: asString(data.defendingPlayerId) ?? asString(data.playerId) ?? "unknown",
          targetType: "player",
          amount: asNumber(data.amount) ?? 0,
          combatDamage: true,
          commanderDamage: true,
        },
        metadata: {
          source: "actionLogRulesEventBridge",
          correlationId: action.id,
        },
      });
      break;
    case "ACTIVATE_ABILITY":
    case "OTHER":
    case "NOTE":
      if (mechanicId) {
        events.push(mechanicEventFromAction(action, mechanicId));
      }
      if (data.powerToughnessOverride || data.manualAdjustment) {
        events.push({
          type: "manual.adjustment",
          actorId: action.playerId,
          turn: action.turn,
          phase: action.phase,
          timestamp: action.timestamp,
          payload: {
            adjustmentType: asString(data.adjustmentType) ?? "manual",
            targetIds: action.affectedObjects,
            playerId: action.playerId,
            reason: action.description,
          },
          metadata: {
            source: "actionLogRulesEventBridge",
            correlationId: action.id,
          },
        });
      }
      break;
    default:
      break;
  }

  if (mechanicId && !events.some((event) => event.type === "mechanic.used")) {
    events.push(mechanicEventFromAction(action, mechanicId));
  }

  return events;
};

export const actionLogToRulesEvents = (
  actionLog: ActionRecord[],
): RulesEventInput<RulesEventName>[] =>
  actionLog.flatMap(actionRecordToRulesEvents);

export const emitRulesEventsForAction = (
  bus: RulesEventBus,
  action: ActionRecord,
): RulesEventInput<RulesEventName>[] => {
  const events = actionRecordToRulesEvents(action);

  for (const event of events) {
    bus.emit(event);
  }

  return events;
};
