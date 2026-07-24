export interface CombatDamageBlockerInput {
  blockerId: string;
  toughness: number;
  markedDamage?: number;
  keywords?: string[];
}

export interface CombatDamageAssignmentInput {
  attackerId: string;
  attackerPower: number;
  attackerKeywords?: string[];
  blockers: CombatDamageBlockerInput[];
  blockerOrder?: string[];
}

export interface CombatDamageAssignmentResult {
  attackerId: string;
  damageToBlockers: Record<string, number>;
  lethalDamageRequired: Record<string, number>;
  likelyDestroyedBlockers: string[];
  trampleOverflow: number;
  manualAssignmentRequired: boolean;
  warnings: string[];
  notes: string[];
}

const hasKeyword = (keywords: string[] | undefined, keyword: string): boolean =>
  Boolean(keywords?.some((candidate) => candidate.toLowerCase() === keyword.toLowerCase()));

export const calculateLethalDamageRequired = (
  blocker: CombatDamageBlockerInput,
  attackerHasDeathtouch: boolean,
): number => {
  if (attackerHasDeathtouch) {
    return 1;
  }

  return Math.max(1, blocker.toughness - (blocker.markedDamage ?? 0));
};

const orderBlockers = (
  blockers: CombatDamageBlockerInput[],
  blockerOrder?: string[],
): CombatDamageBlockerInput[] => {
  if (!blockerOrder || blockerOrder.length === 0) {
    return blockers;
  }

  const orderIndex = new Map(blockerOrder.map((blockerId, index) => [blockerId, index]));

  return [...blockers].sort((left, right) =>
    (orderIndex.get(left.blockerId) ?? Number.MAX_SAFE_INTEGER)
    - (orderIndex.get(right.blockerId) ?? Number.MAX_SAFE_INTEGER));
};

export const assignCombatDamage = (
  input: CombatDamageAssignmentInput,
): CombatDamageAssignmentResult => {
  const attackerHasTrample = hasKeyword(input.attackerKeywords, "Trample");
  const attackerHasDeathtouch = hasKeyword(input.attackerKeywords, "Deathtouch");
  const blockers = orderBlockers(input.blockers, input.blockerOrder);
  const damageToBlockers: Record<string, number> = {};
  const lethalDamageRequired: Record<string, number> = {};
  const likelyDestroyedBlockers: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [];
  let remainingDamage = Math.max(0, input.attackerPower);
  let manualAssignmentRequired = false;

  if (attackerHasDeathtouch && input.attackerPower > 0) {
    notes.push("Deathtouch: 1 damage is lethal to each blocker.");
  }

  if (attackerHasTrample && blockers.length > 1 && (!input.blockerOrder || input.blockerOrder.length === 0)) {
    manualAssignmentRequired = true;
    warnings.push("Multiple blockers with trample need manual blocker order or damage assignment.");
  }

  for (const blocker of blockers) {
    const blockerHasIndestructible = hasKeyword(blocker.keywords, "Indestructible");
    const blockerHasProtection = hasKeyword(blocker.keywords, "Protection");
    const lethal = calculateLethalDamageRequired(blocker, attackerHasDeathtouch);
    const assignedDamage = attackerHasTrample
      ? Math.min(remainingDamage, lethal)
      : remainingDamage;

    lethalDamageRequired[blocker.blockerId] = lethal;
    damageToBlockers[blocker.blockerId] = assignedDamage;
    remainingDamage = Math.max(0, remainingDamage - assignedDamage);

    if (blockerHasProtection) {
      warnings.push(`${blocker.blockerId} has protection-like text; exact damage result needs manual review.`);
    } else if (blockerHasIndestructible) {
      warnings.push(`${blocker.blockerId} is indestructible; lethal damage assignment will not destroy it.`);
    } else if (assignedDamage >= lethal && assignedDamage > 0) {
      likelyDestroyedBlockers.push(blocker.blockerId);
    }
  }

  const trampleOverflow = attackerHasTrample ? remainingDamage : 0;

  if (trampleOverflow > 0) {
    notes.push(`Trample overflow: ${trampleOverflow}`);
  }

  return {
    attackerId: input.attackerId,
    damageToBlockers,
    lethalDamageRequired,
    likelyDestroyedBlockers,
    trampleOverflow,
    manualAssignmentRequired,
    warnings,
    notes,
  };
};
