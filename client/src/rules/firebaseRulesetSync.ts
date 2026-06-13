import { child, get, ref } from 'firebase/database';
import { getFirebaseDatabase, isFirebaseRecoveryConfigured } from '../config/firebase';
import { defaultRuleset } from './defaultRuleset';
import { mergeRulesets } from './mechanicsRegistry';
import type { RulesetDefinition } from './mechanicTypes';

export const FIREBASE_RULESET_PATHS = {
  currentVersion: 'rulesets/mtg/currentVersion',
  mechanics: (version: string) => `rulesets/mtg/versions/${version}/mechanics`,
  tokens: (version: string) => `rulesets/mtg/versions/${version}/tokens`,
  interactionHints: (version: string) => `rulesets/mtg/versions/${version}/interactionHints`,
  cardOverrides: (version: string) => `rulesets/mtg/versions/${version}/cardOverrides`,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asRecord<T>(value: unknown): Record<string, T> {
  return isRecord(value) ? value as Record<string, T> : {};
}

export function buildFirebaseRuleset(version: string, raw: {
  mechanics?: unknown;
  tokens?: unknown;
  interactionHints?: unknown;
  cardOverrides?: unknown;
  publishedAt?: unknown;
}): RulesetDefinition {
  return {
    version,
    publishedAt: typeof raw.publishedAt === 'number' ? raw.publishedAt : Date.now(),
    mechanics: asRecord(raw.mechanics),
    tokens: asRecord(raw.tokens),
    interactionHints: asRecord(raw.interactionHints),
    cardOverrides: asRecord(raw.cardOverrides),
  };
}

export async function loadMergedRulesetFromFirebase(localRuleset: RulesetDefinition = defaultRuleset): Promise<RulesetDefinition> {
  if (!isFirebaseRecoveryConfigured()) return localRuleset;

  const database = getFirebaseDatabase();
  if (!database) return localRuleset;

  const root = ref(database);
  const versionSnapshot = await get(child(root, FIREBASE_RULESET_PATHS.currentVersion));
  const version = versionSnapshot.val();
  if (typeof version !== 'string' || version.length === 0 || version === localRuleset.version) {
    return localRuleset;
  }

  const basePath = `rulesets/mtg/versions/${version}`;
  const [mechanics, tokens, interactionHints, cardOverrides, publishedAt] = await Promise.all([
    get(child(root, `${basePath}/mechanics`)),
    get(child(root, `${basePath}/tokens`)),
    get(child(root, `${basePath}/interactionHints`)),
    get(child(root, `${basePath}/cardOverrides`)),
    get(child(root, `${basePath}/publishedAt`)),
  ]);

  return mergeRulesets(localRuleset, buildFirebaseRuleset(version, {
    mechanics: mechanics.val(),
    tokens: tokens.val(),
    interactionHints: interactionHints.val(),
    cardOverrides: cardOverrides.val(),
    publishedAt: publishedAt.val(),
  }));
}
