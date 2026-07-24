import type { RulesEventInput } from "./rulesEventBus";

export type CastingStepStatus = "satisfied" | "manual" | "blocked" | "pending";

export interface CastableCardSnapshot {
  id?: string;
  instanceId?: string;
  name?: string;
  ownerId?: string;
  controllerId?: string;
  zone?: string;
  typeLine?: string;
  manaCost?: string;
  oracleText?: string;
  keywords?: string[];
}

export interface CastingPipelineInput {
  playerId: string;
  card: CastableCardSnapshot;
  activePlayerId?: string;
  currentPhase?: string;
  stackDepth?: number;
  castFromZone?: string;
  chosenTargets?: string[];
  requiredTargetCount?: number;
  alternativeCost?: string;
  availableGenericMana?: number;
  strictTiming?: boolean;
}

export interface CastingPipelineStep {
  id:
    | "location"
    | "permissions"
    | "timing"
    | "modes_targets"
    | "cost"
    | "mana"
    | "put_on_stack"
    | "priority";
  label: string;
  status: CastingStepStatus;
  notes: string[];
  errors: string[];
}

export interface CastingPlan {
  planId: string;
  cardId?: string;
  cardName: string;
  playerId: string;
  castFromZone?: string;
  totalCost?: string;
  chosenTargets: string[];
  canProceed: boolean;
  requiresManual: boolean;
  steps: CastingPipelineStep[];
  warnings: string[];
  errors: string[];
}

const createStep = (
  id: CastingPipelineStep["id"],
  label: string,
  status: CastingStepStatus,
  notes: string[] = [],
  errors: string[] = [],
): CastingPipelineStep => ({
  id,
  label,
  status,
  notes,
  errors,
});

const getCardId = (card: CastableCardSnapshot): string | undefined =>
  card.instanceId ?? card.id;

const hasKeyword = (card: CastableCardSnapshot, keyword: string): boolean => {
  const normalizedKeyword = keyword.toLowerCase();

  return Boolean(
    card.keywords?.some((candidate) => candidate.toLowerCase() === normalizedKeyword)
    || card.oracleText?.toLowerCase().includes(normalizedKeyword),
  );
};

const isInstantLike = (card: CastableCardSnapshot): boolean =>
  Boolean(card.typeLine?.toLowerCase().includes("instant") || hasKeyword(card, "flash"));

const parseGenericCost = (cost?: string): number | undefined => {
  if (!cost) {
    return undefined;
  }

  const genericMatch = cost.match(/\{(\d+)\}/);

  if (!genericMatch) {
    return 0;
  }

  return Number.parseInt(genericMatch[1], 10);
};

export const createCastingPlan = (input: CastingPipelineInput): CastingPlan => {
  const cardId = getCardId(input.card);
  const castFromZone = input.castFromZone ?? input.card.zone;
  const totalCost = input.alternativeCost ?? input.card.manaCost ?? "manual";
  const chosenTargets = input.chosenTargets ?? [];
  const steps: CastingPipelineStep[] = [];

  steps.push(cardId
    ? createStep("location", "Identify card", "satisfied", [`Card id: ${cardId}`])
    : createStep("location", "Identify card", "blocked", [], ["Card has no instance id."]));

  steps.push(castFromZone
    ? createStep("permissions", "Check cast permission", "manual", [`Cast from zone: ${castFromZone}`])
    : createStep("permissions", "Check cast permission", "blocked", [], ["Cast zone is unknown."]));

  const timingNeedsManualReview = !isInstantLike(input.card)
    && input.currentPhase
    && input.currentPhase !== "main"
    && input.currentPhase !== "precombatMain"
    && input.currentPhase !== "postcombatMain";
  const timingBlocked = Boolean(input.strictTiming && timingNeedsManualReview);

  steps.push(createStep(
    "timing",
    "Check timing",
    timingBlocked ? "blocked" : timingNeedsManualReview ? "manual" : "satisfied",
    timingNeedsManualReview ? ["Non-instant timing needs manual confirmation."] : [],
    timingBlocked ? ["Spell cannot be cast at this timing in strict mode."] : [],
  ));

  const requiredTargetCount = input.requiredTargetCount ?? 0;
  const missingTargetCount = Math.max(0, requiredTargetCount - chosenTargets.length);

  steps.push(missingTargetCount > 0
    ? createStep("modes_targets", "Choose modes and targets", "blocked", [], [`Missing ${missingTargetCount} required target(s).`])
    : createStep("modes_targets", "Choose modes and targets", requiredTargetCount > 0 ? "satisfied" : "manual", requiredTargetCount > 0 ? [`Targets: ${chosenTargets.join(", ")}`] : ["No explicit target requirements provided."]));

  steps.push(createStep(
    "cost",
    "Determine total cost",
    totalCost === "manual" ? "manual" : "satisfied",
    [`Total cost: ${totalCost}`],
  ));

  const genericCost = parseGenericCost(totalCost);
  const availableGenericMana = input.availableGenericMana;
  const insufficientGenericMana = genericCost !== undefined
    && availableGenericMana !== undefined
    && availableGenericMana < genericCost;

  steps.push(createStep(
    "mana",
    "Pay costs",
    insufficientGenericMana ? "blocked" : availableGenericMana === undefined ? "manual" : "satisfied",
    availableGenericMana === undefined ? ["Mana payment needs manual confirmation."] : [`Available generic mana: ${availableGenericMana}`],
    insufficientGenericMana ? [`Need ${genericCost} generic mana, only ${availableGenericMana} available.`] : [],
  ));

  steps.push(createStep("put_on_stack", "Put spell on stack", "pending"));
  steps.push(createStep("priority", "Pass priority", "pending"));

  const errors = steps.flatMap((step) => step.errors);
  const warnings = steps.flatMap((step) => step.status === "manual" ? step.notes : []);
  const requiresManual = steps.some((step) => step.status === "manual");

  return {
    planId: `cast-plan-${cardId ?? "unknown"}-${input.playerId}`,
    cardId,
    cardName: input.card.name ?? "Unknown Card",
    playerId: input.playerId,
    castFromZone,
    totalCost,
    chosenTargets,
    canProceed: errors.length === 0,
    requiresManual,
    steps,
    warnings,
    errors,
  };
};

export const createSpellCastEventFromPlan = (
  plan: CastingPlan,
): RulesEventInput<"spell.cast"> | undefined => {
  if (!plan.cardId || !plan.canProceed || !plan.castFromZone) {
    return undefined;
  }

  return {
    type: "spell.cast",
    actorId: plan.playerId,
    payload: {
      cardId: plan.cardId,
      playerId: plan.playerId,
      castFromZone: plan.castFromZone,
      alternativeCost: plan.totalCost,
      targets: plan.chosenTargets,
    },
    metadata: {
      source: "rulesCastingPipeline",
    },
  };
};
