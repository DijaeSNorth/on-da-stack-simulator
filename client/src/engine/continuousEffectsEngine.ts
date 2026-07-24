export type ContinuousEffectLayer =
  | "copy"
  | "control"
  | "text"
  | "type"
  | "color"
  | "ability"
  | "powerToughnessSet"
  | "powerToughnessModify"
  | "powerToughnessCounters"
  | "powerToughnessSwitch";

export const CONTINUOUS_EFFECT_LAYER_ORDER: ContinuousEffectLayer[] = [
  "copy",
  "control",
  "text",
  "type",
  "color",
  "ability",
  "powerToughnessSet",
  "powerToughnessModify",
  "powerToughnessCounters",
  "powerToughnessSwitch",
];

export interface ContinuousCardSnapshot {
  cardId: string;
  name?: string;
  ownerId?: string;
  controllerId?: string;
  typeLine?: string;
  cardTypes: string[];
  subtypes: string[];
  colors: string[];
  keywords: string[];
  power: number | null;
  toughness: number | null;
  counters?: Record<string, number>;
  damageMarked?: number;
}

export type ContinuousEffectOperation =
  | { kind: "setController"; controllerId: string }
  | { kind: "setCardTypes"; cardTypes: string[]; preserveExisting?: boolean }
  | { kind: "addCardTypes"; cardTypes: string[] }
  | { kind: "removeCardTypes"; cardTypes: string[] }
  | { kind: "addSubtypes"; subtypes: string[] }
  | { kind: "setColors"; colors: string[] }
  | { kind: "addKeyword"; keyword: string }
  | { kind: "removeKeyword"; keyword: string }
  | { kind: "setPowerToughness"; power: number; toughness: number }
  | { kind: "modifyPowerToughness"; powerDelta: number; toughnessDelta: number }
  | { kind: "addCounters"; counters: Record<string, number> }
  | { kind: "switchPowerToughness" };

export interface ContinuousEffect {
  id: string;
  layer: ContinuousEffectLayer;
  timestamp: number;
  operation: ContinuousEffectOperation;
  sourceId?: string;
  dependencyIds?: string[];
  expires?: "manual" | "endOfCombat" | "endOfTurn" | "whileSourceExists";
}

export interface ContinuousEffectResult {
  card: ContinuousCardSnapshot;
  appliedEffectIds: string[];
  warnings: string[];
}

const unique = (values: string[]): string[] =>
  Array.from(new Set(values.filter(Boolean)));

const removeCaseInsensitive = (values: string[], toRemove: string[]): string[] => {
  const removeSet = new Set(toRemove.map((value) => value.toLowerCase()));

  return values.filter((value) => !removeSet.has(value.toLowerCase()));
};

const cloneCard = (card: ContinuousCardSnapshot): ContinuousCardSnapshot => ({
  ...card,
  cardTypes: [...card.cardTypes],
  subtypes: [...card.subtypes],
  colors: [...card.colors],
  keywords: [...card.keywords],
  counters: { ...(card.counters ?? {}) },
});

const orderLayerEffects = (
  effects: ContinuousEffect[],
  warnings: string[],
): ContinuousEffect[] => {
  const ordered: ContinuousEffect[] = [];
  const remaining = [...effects].sort((left, right) => left.timestamp - right.timestamp);
  const applied = new Set<string>();
  let progressed = true;

  while (remaining.length > 0 && progressed) {
    progressed = false;

    for (let index = 0; index < remaining.length; index += 1) {
      const effect = remaining[index];
      const dependencies = effect.dependencyIds ?? [];
      const dependenciesSatisfied = dependencies.every((dependencyId) =>
        applied.has(dependencyId) || !effects.some((candidate) => candidate.id === dependencyId));

      if (dependenciesSatisfied) {
        ordered.push(effect);
        applied.add(effect.id);
        remaining.splice(index, 1);
        progressed = true;
        index -= 1;
      }
    }
  }

  if (remaining.length > 0) {
    warnings.push("Continuous effect dependency cycle detected; unresolved effects were applied by timestamp.");
    ordered.push(...remaining.sort((left, right) => left.timestamp - right.timestamp));
  }

  return ordered;
};

const applyOperation = (
  card: ContinuousCardSnapshot,
  operation: ContinuousEffectOperation,
): ContinuousCardSnapshot => {
  switch (operation.kind) {
    case "setController":
      return {
        ...card,
        controllerId: operation.controllerId,
      };
    case "setCardTypes":
      return {
        ...card,
        cardTypes: operation.preserveExisting
          ? unique([...card.cardTypes, ...operation.cardTypes])
          : unique(operation.cardTypes),
      };
    case "addCardTypes":
      return {
        ...card,
        cardTypes: unique([...card.cardTypes, ...operation.cardTypes]),
      };
    case "removeCardTypes":
      return {
        ...card,
        cardTypes: removeCaseInsensitive(card.cardTypes, operation.cardTypes),
      };
    case "addSubtypes":
      return {
        ...card,
        subtypes: unique([...card.subtypes, ...operation.subtypes]),
      };
    case "setColors":
      return {
        ...card,
        colors: unique(operation.colors),
      };
    case "addKeyword":
      return {
        ...card,
        keywords: unique([...card.keywords, operation.keyword]),
      };
    case "removeKeyword":
      return {
        ...card,
        keywords: removeCaseInsensitive(card.keywords, [operation.keyword]),
      };
    case "setPowerToughness":
      return {
        ...card,
        power: operation.power,
        toughness: operation.toughness,
      };
    case "modifyPowerToughness":
      return {
        ...card,
        power: card.power === null ? null : card.power + operation.powerDelta,
        toughness: card.toughness === null ? null : card.toughness + operation.toughnessDelta,
      };
    case "addCounters":
      return {
        ...card,
        counters: {
          ...(card.counters ?? {}),
          ...Object.fromEntries(
            Object.entries(operation.counters).map(([counterType, amount]) => [
              counterType,
              (card.counters?.[counterType] ?? 0) + amount,
            ]),
          ),
        },
      };
    case "switchPowerToughness":
      return {
        ...card,
        power: card.toughness,
        toughness: card.power,
      };
    default:
      return card;
  }
};

const applyCounterPowerToughnessLayer = (
  card: ContinuousCardSnapshot,
): ContinuousCardSnapshot => {
  const plusOne = card.counters?.["+1/+1"] ?? 0;
  const minusOne = card.counters?.["-1/-1"] ?? 0;
  const delta = plusOne - minusOne;

  return {
    ...card,
    power: card.power === null ? null : card.power + delta,
    toughness: card.toughness === null ? null : card.toughness + delta,
  };
};

export const applyContinuousEffects = (
  baseCard: ContinuousCardSnapshot,
  effects: ContinuousEffect[],
): ContinuousEffectResult => {
  let card = cloneCard(baseCard);
  const warnings: string[] = [];
  const appliedEffectIds: string[] = [];

  for (const layer of CONTINUOUS_EFFECT_LAYER_ORDER) {
    const layerEffects = orderLayerEffects(
      effects.filter((effect) => effect.layer === layer),
      warnings,
    );

    for (const effect of layerEffects) {
      card = applyOperation(card, effect.operation);
      appliedEffectIds.push(effect.id);
    }

    if (layer === "powerToughnessCounters") {
      card = applyCounterPowerToughnessLayer(card);
    }
  }

  return {
    card,
    appliedEffectIds,
    warnings,
  };
};

export const createPowerToughnessOverrideEffect = (
  cardId: string,
  power: number,
  toughness: number,
  timestamp: number,
  expires: ContinuousEffect["expires"] = "manual",
): ContinuousEffect => ({
  id: `${cardId}:pt-override:${timestamp}`,
  layer: "powerToughnessSet",
  timestamp,
  expires,
  operation: {
    kind: "setPowerToughness",
    power,
    toughness,
  },
});
