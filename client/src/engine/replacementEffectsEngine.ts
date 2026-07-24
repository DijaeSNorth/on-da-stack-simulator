import type { RulesEvent, RulesEventInput, RulesEventName } from "./rulesEventBus";

export type ReplacementEvent = RulesEvent | RulesEventInput<RulesEventName>;

export type ReplacementEffectOperation =
  | { kind: "replaceZoneDestination"; toZone: string }
  | { kind: "commanderToCommandZone"; commanderId?: string }
  | { kind: "preventDamage"; amount?: number | "all" }
  | { kind: "modifyDamage"; delta?: number; multiplier?: number; setAmount?: number }
  | { kind: "redirectDamage"; targetId: string; targetType: "player" | "planeswalker" | "battle" | "creature" | "permanent" };

export interface ReplacementEffectMatch {
  cardId?: string;
  sourceId?: string;
  targetId?: string;
  fromZone?: string;
  toZone?: string;
}

export interface ReplacementEffectDefinition {
  id: string;
  eventType: RulesEventName;
  controllerId?: string;
  optional?: boolean;
  priority?: number;
  match?: ReplacementEffectMatch;
  operation: ReplacementEffectOperation;
  expires?: "manual" | "endOfTurn" | "untilApplied";
}

export interface ReplacementEffectChoice {
  effectId: string;
  apply: boolean;
}

export interface ReplacementEffectResult<TEvent extends ReplacementEvent = ReplacementEvent> {
  event: TEvent;
  appliedEffectIds: string[];
  skippedEffectIds: string[];
  preventedDamage: number;
  manualRequired: boolean;
  warnings: string[];
}

const getPayloadValue = (event: ReplacementEvent, key: string): unknown => {
  const payload = "payload" in event ? event.payload as Record<string, unknown> : undefined;

  return payload?.[key];
};

const eventTypeOf = (event: ReplacementEvent): RulesEventName => event.type;

const matchesEffect = (
  event: ReplacementEvent,
  effect: ReplacementEffectDefinition,
): boolean => {
  if (eventTypeOf(event) !== effect.eventType) {
    return false;
  }

  const match = effect.match;

  if (!match) {
    return true;
  }

  if (match.cardId && getPayloadValue(event, "cardId") !== match.cardId) {
    return false;
  }

  if (match.sourceId && getPayloadValue(event, "sourceId") !== match.sourceId) {
    return false;
  }

  if (match.targetId && getPayloadValue(event, "targetId") !== match.targetId) {
    return false;
  }

  if (match.fromZone && getPayloadValue(event, "fromZone") !== match.fromZone) {
    return false;
  }

  if (match.toZone && getPayloadValue(event, "toZone") !== match.toZone) {
    return false;
  }

  return true;
};

const cloneEvent = <TEvent extends ReplacementEvent>(event: TEvent): TEvent => ({
  ...event,
  payload: {
    ...(event.payload as Record<string, unknown>),
  },
}) as TEvent;

const applyOperation = <TEvent extends ReplacementEvent>(
  event: TEvent,
  operation: ReplacementEffectOperation,
): { event: TEvent; preventedDamage: number; warnings: string[] } => {
  const nextEvent = cloneEvent(event);
  const payload = nextEvent.payload as Record<string, unknown>;
  const warnings: string[] = [];
  let preventedDamage = 0;

  switch (operation.kind) {
    case "replaceZoneDestination":
      if (nextEvent.type === "zone.changed") {
        payload.toZone = operation.toZone;
      } else {
        warnings.push("Zone replacement effect ignored for non-zone event.");
      }
      break;
    case "commanderToCommandZone":
      if (nextEvent.type === "zone.changed") {
        const cardId = payload.cardId;
        const destination = String(payload.toZone ?? "");
        const replacementDestinations = new Set(["graveyard", "exile", "hand", "library"]);

        if ((!operation.commanderId || operation.commanderId === cardId) && replacementDestinations.has(destination)) {
          payload.toZone = "command";
          payload.replacementApplied = "commanderToCommandZone";
        }
      } else {
        warnings.push("Commander replacement effect ignored for non-zone event.");
      }
      break;
    case "preventDamage":
      if (nextEvent.type === "damage.dealt") {
        const amount = Number(payload.amount ?? 0);
        const preventionAmount = operation.amount === "all"
          ? amount
          : Math.min(amount, operation.amount ?? amount);

        payload.amount = Math.max(0, amount - preventionAmount);
        preventedDamage = preventionAmount;
      } else {
        warnings.push("Damage prevention effect ignored for non-damage event.");
      }
      break;
    case "modifyDamage":
      if (nextEvent.type === "damage.dealt") {
        const amount = Number(payload.amount ?? 0);
        const multipliedAmount = operation.multiplier === undefined
          ? amount
          : amount * operation.multiplier;
        const modifiedAmount = operation.setAmount ?? multipliedAmount + (operation.delta ?? 0);

        payload.amount = Math.max(0, modifiedAmount);
      } else {
        warnings.push("Damage modification effect ignored for non-damage event.");
      }
      break;
    case "redirectDamage":
      if (nextEvent.type === "damage.dealt") {
        payload.targetId = operation.targetId;
        payload.targetType = operation.targetType;
      } else {
        warnings.push("Damage redirection effect ignored for non-damage event.");
      }
      break;
    default:
      break;
  }

  return {
    event: nextEvent,
    preventedDamage,
    warnings,
  };
};

export const findApplicableReplacementEffects = (
  event: ReplacementEvent,
  effects: ReplacementEffectDefinition[],
): ReplacementEffectDefinition[] =>
  effects
    .filter((effect) => matchesEffect(event, effect))
    .sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));

export const applyReplacementEffects = <TEvent extends ReplacementEvent>(
  event: TEvent,
  effects: ReplacementEffectDefinition[],
  choices: ReplacementEffectChoice[] = [],
): ReplacementEffectResult<TEvent> => {
  const applicableEffects = findApplicableReplacementEffects(event, effects);
  const choiceMap = new Map(choices.map((choice) => [choice.effectId, choice.apply]));
  const optionalEffectsWithoutChoice = applicableEffects.filter((effect) =>
    effect.optional && !choiceMap.has(effect.id));
  const competingEffectsNeedChoice = applicableEffects.length > 1 && choices.length === 0;
  const manualRequired = optionalEffectsWithoutChoice.length > 0 || competingEffectsNeedChoice;

  if (manualRequired) {
    return {
      event,
      appliedEffectIds: [],
      skippedEffectIds: [],
      preventedDamage: 0,
      manualRequired: true,
      warnings: ["Replacement/prevention choice requires manual ordering or confirmation."],
    };
  }

  let nextEvent = cloneEvent(event);
  const appliedEffectIds: string[] = [];
  const skippedEffectIds: string[] = [];
  const warnings: string[] = [];
  let preventedDamage = 0;

  for (const effect of applicableEffects) {
    if (choiceMap.get(effect.id) === false) {
      skippedEffectIds.push(effect.id);
      continue;
    }

    const result = applyOperation(nextEvent, effect.operation);
    nextEvent = result.event;
    appliedEffectIds.push(effect.id);
    preventedDamage += result.preventedDamage;
    warnings.push(...result.warnings);
  }

  return {
    event: nextEvent,
    appliedEffectIds,
    skippedEffectIds,
    preventedDamage,
    manualRequired: false,
    warnings,
  };
};
