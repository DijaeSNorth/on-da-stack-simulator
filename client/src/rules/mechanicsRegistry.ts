import { defaultRuleset } from './defaultRuleset';
import { canExecuteHandler } from './engineHandlers';
import type { CardState } from '../types/game';
import type {
  MechanicBadgeInfo,
  MechanicDefinition,
  MechanicHintContext,
  MechanicHintOptions,
  MechanicRuntimeDefinition,
  RulesetDefinition,
} from './mechanicTypes';

export interface RulesRegistry {
  ruleset: RulesetDefinition;
  getMechanic: (id: string) => MechanicRuntimeDefinition;
  listMechanics: () => MechanicRuntimeDefinition[];
  getUiHint: (id: string) => string;
}

function versionRank(version: string): number {
  const numeric = version.match(/\d+/g)?.join('') ?? '0';
  return Number.parseInt(numeric, 10) || 0;
}

function shouldUseRemote(local: RulesetDefinition, remote: RulesetDefinition): boolean {
  if (remote.publishedAt !== local.publishedAt) return remote.publishedAt > local.publishedAt;
  return versionRank(remote.version) > versionRank(local.version);
}

function sanitizeMechanic(definition: MechanicDefinition): MechanicDefinition {
  const handlerKnown = !definition.engineHandler || canExecuteHandler(definition.engineHandler);
  return {
    ...definition,
    engineHandler: handlerKnown ? definition.engineHandler : undefined,
    automationLevel: handlerKnown ? definition.automationLevel : 'manual_prompt',
    ui: {
      ...definition.ui,
      reminder: handlerKnown
        ? definition.ui.reminder
        : definition.ui.reminder ?? 'This mechanic uses an unknown local handler. Resolve it manually.',
    },
  };
}

export function mergeRulesets(
  localRuleset: RulesetDefinition = defaultRuleset,
  remoteRuleset?: RulesetDefinition | null,
): RulesetDefinition {
  if (!remoteRuleset || !shouldUseRemote(localRuleset, remoteRuleset)) return localRuleset;

  const mechanics = { ...localRuleset.mechanics };
  for (const [id, definition] of Object.entries(remoteRuleset.mechanics ?? {})) {
    mechanics[id] = sanitizeMechanic({
      ...(mechanics[id] ?? definition),
      ...definition,
      ui: {
        ...(mechanics[id]?.ui ?? {}),
        ...(definition.ui ?? {}),
      },
      parameters: {
        ...(mechanics[id]?.parameters ?? {}),
        ...(definition.parameters ?? {}),
      },
    });
  }

  return {
    version: remoteRuleset.version,
    publishedAt: remoteRuleset.publishedAt,
    mechanics,
    tokens: {
      ...localRuleset.tokens,
      ...(remoteRuleset.tokens ?? {}),
    },
    interactionHints: {
      ...localRuleset.interactionHints,
      ...(remoteRuleset.interactionHints ?? {}),
    },
    cardOverrides: {
      ...localRuleset.cardOverrides,
      ...(remoteRuleset.cardOverrides ?? {}),
    },
  };
}

export function toRuntimeDefinition(definition: MechanicDefinition): MechanicRuntimeDefinition {
  return {
    ...definition,
    executable: canExecuteHandler(definition.engineHandler),
  };
}

export function createUnknownMechanicDefinition(id: string): MechanicRuntimeDefinition {
  return {
    id,
    name: id,
    kind: 'rules_pattern',
    setCodes: [],
    rulesText: 'Unknown mechanic. Show the printed card text and resolve manually.',
    eventHooks: ['manual'],
    parameters: {},
    ui: {
      reminder: 'Unknown mechanic. Use manual prompt handling.',
      promptText: 'Resolve this mechanic manually using the card text.',
    },
    automationLevel: 'manual_prompt',
    updatedAt: Date.now(),
    executable: false,
  };
}

export function createRulesRegistry(ruleset: RulesetDefinition = defaultRuleset): RulesRegistry {
  return {
    ruleset,
    getMechanic: (id: string) => {
      const definition = ruleset.mechanics[id];
      return definition ? toRuntimeDefinition(definition) : createUnknownMechanicDefinition(id);
    },
    listMechanics: () => Object.values(ruleset.mechanics).map(toRuntimeDefinition),
    getUiHint: (id: string) => {
      const mechanic = ruleset.mechanics[id];
      if (mechanic?.ui.promptText) return mechanic.ui.promptText;
      if (mechanic?.ui.reminder) return mechanic.ui.reminder;
      return ruleset.interactionHints['unknown-mechanic']?.text ?? 'Resolve this mechanic manually.';
    },
  };
}

export const defaultRulesRegistry = createRulesRegistry(defaultRuleset);

const DETECTION_PATTERNS: Record<string, RegExp[]> = {
  firebending: [/\bfirebending\b/i, /\bfirebend\b/i],
  airbend: [/\bairbend\b/i, /\bairbending\b/i],
  waterbend: [/\bwaterbend\b/i, /\bwaterbending\b/i],
  earthbend: [/\bearthbend\b/i, /\bearthbending\b/i],
  'double-faced-sagas': [/\bsaga\b/i],
  lesson: [/\blesson\b/i],
  exhaust: [/\bexhaust\b/i],
  clue: [/\bclue\b/i],
  shrine: [/\bshrine\b/i],
  sneak: [/\bsneak\b/i],
  disappear: [/\bdisappear\b/i],
  alliance: [/\balliance\b/i],
  'mutagen-token': [/\bmutagen\b/i],
  classes: [/\bclass\b/i],
  'partner-character-select': [/\bpartner\b.*\bcharacter select\b/i, /\bcharacter select\b/i],
  blight: [/\bblight\b/i],
  vivid: [/\bvivid\b/i],
  changeling: [/\bchangeling\b/i],
  kindred: [/\bkindred\b/i],
  station: [/\bstation\b/i],
  spacecraft: [/\bspacecraft\b/i],
  warp: [/\bwarp\b/i],
  void: [/\bvoid\b/i],
  'lander-token': [/\blander\b/i],
  connive: [/\bconnive\b/i],
  'transforming-modal-dfcs': [/\bmodal double-faced\b/i, /\bmodal dfc\b/i],
  worthy: [/\bworthy\b/i],
};

const BADGE_LABELS: Record<string, string> = {
  firebending: 'Fire',
  airbend: 'Air',
  waterbend: 'Water',
  earthbend: 'Earth',
  exhaust: 'Exhaust',
  lesson: 'Lesson',
  shrine: 'Shrine',
  clue: 'Clue',
  warp: 'Warp',
  sneak: 'Sneak',
  station: 'Station',
  connive: 'Connive',
};

function textForCard(card: CardState): string {
  const def = card.definition;
  const faceText = (def.faces ?? []).map(face => `${face.name} ${face.typeLine} ${face.oracleText} ${face.keywords.join(' ')}`).join(' ');
  return [
    def.name,
    def.typeLine,
    def.oracleText,
    def.keywords.join(' '),
    def.subTypes.join(' '),
    faceText,
  ].join(' ');
}

export function getMechanicsForCard(
  card: CardState,
  ruleset: RulesetDefinition = defaultRuleset,
): MechanicRuntimeDefinition[] {
  const registry = createRulesRegistry(ruleset);
  const matched = new Set<string>();
  const text = textForCard(card);

  for (const [id, patterns] of Object.entries(DETECTION_PATTERNS)) {
    if (patterns.some(pattern => pattern.test(text))) matched.add(id);
  }

  if (card.token && /(?:^|\s)clue(?:\s|$)/i.test(text)) matched.add('clue');
  if (card.definition.subTypes.some(subtype => subtype.toLowerCase() === 'lesson')) matched.add('lesson');
  if (card.definition.subTypes.some(subtype => subtype.toLowerCase() === 'shrine')) matched.add('shrine');

  for (const override of Object.values(ruleset.cardOverrides ?? {})) {
    if (override.cardName.toLowerCase() !== card.definition.name.toLowerCase()) continue;
    for (const mechanicId of override.mechanicIds) matched.add(mechanicId);
  }

  return Array.from(matched).map(id => registry.getMechanic(id));
}

export function getMechanicHint(
  mechanicId: string,
  context: MechanicHintContext,
  ruleset: RulesetDefinition = defaultRuleset,
  options: MechanicHintOptions = {},
): string {
  const registry = createRulesRegistry(ruleset);
  const mechanic = registry.getMechanic(mechanicId);

  if (mechanic.id === 'firebending' && (context === 'combat' || context === 'battlefield')) {
    return 'Firebending: when this attacks, use the set mechanic prompt to track attack-generated red mana.';
  }
  if (mechanic.id === 'airbend' && context === 'exile') {
    return 'Airbend: this exiled card may have a return or cast-for-two permission. Confirm the printed card text before moving it.';
  }
  if (mechanic.id === 'warp' && context === 'exile') {
    return 'Warp: this card may be cast or return from exile through its warp instruction. Track the delayed instruction manually.';
  }
  if (mechanic.id === 'waterbend' && context === 'cost_payment') {
    return 'Waterbend: confirm which lands, creatures, or artifacts are tapped to help pay this cost.';
  }
  if (mechanic.id === 'earthbend' && (context === 'battlefield' || context === 'manual_prompt')) {
    return 'Earthbend: choose the land, then manually track its temporary creature state, haste, and recovery instruction.';
  }
  if (mechanic.id === 'exhaust' && (context === 'battlefield' || context === 'manual_prompt')) {
    return options.exhaustUsed
      ? 'Exhaust: used for this object. Do not use this exhaust ability again unless the object changed zones or became a new object.'
      : 'Exhaust: available. After use, mark this object so the table knows the once-per-object ability was spent.';
  }
  if (mechanic.automationLevel === 'manual_prompt' || !mechanic.executable) {
    return mechanic.ui.promptText ?? mechanic.ui.reminder ?? registry.getUiHint(mechanicId);
  }
  return mechanic.ui.promptText ?? mechanic.ui.reminder ?? mechanic.rulesText;
}

export function getMechanicBadgesForCard(
  card: CardState,
  ruleset: RulesetDefinition = defaultRuleset,
): MechanicBadgeInfo[] {
  return getMechanicsForCard(card, ruleset).map(mechanic => {
    const manual = mechanic.automationLevel === 'manual_prompt' || mechanic.automationLevel === 'unsupported' || !mechanic.executable;
    return {
      id: mechanic.id,
      label: BADGE_LABELS[mechanic.id] ?? (manual ? 'Manual' : mechanic.ui.shortLabel ?? mechanic.name),
      title: manual ? `${mechanic.name}: manual prompt` : mechanic.name,
      automationLevel: mechanic.automationLevel,
      manual,
    };
  });
}

export function getFirebendingAmount(card: CardState): number {
  if (!getMechanicsForCard(card).some(mechanic => mechanic.id === 'firebending')) return 0;
  const text = textForCard(card);
  const match = text.match(/\bfirebending\s+(\d+)\b/i) ?? text.match(/\bfirebend\s+(\d+)\b/i);
  return match ? Math.max(0, Number.parseInt(match[1], 10) || 0) : 1;
}
