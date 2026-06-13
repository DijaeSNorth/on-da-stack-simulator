export type AutomationLevel =
  | 'metadata_only'
  | 'hint_only'
  | 'manual_prompt'
  | 'semi_automated'
  | 'supported'
  | 'unsupported';

export type MechanicKind =
  | 'keyword'
  | 'ability_word'
  | 'action'
  | 'token'
  | 'subtype'
  | 'card_type'
  | 'card_frame'
  | 'cost'
  | 'counter'
  | 'rules_pattern';

export type MechanicEventHook =
  | 'onAttackDeclared'
  | 'onCast'
  | 'onActivateAbility'
  | 'onCostPayment'
  | 'onZoneChange'
  | 'onEnterBattlefield'
  | 'onCounterAdded'
  | 'onTurnCleanup'
  | 'manual';

export interface MechanicUiHints {
  shortLabel?: string;
  reminder?: string;
  actionLabel?: string;
  zoneHint?: string;
  promptText?: string;
  badge?: string;
}

export interface MechanicDefinition {
  id: string;
  name: string;
  kind: MechanicKind;
  setCodes: string[];
  rulesText: string;
  engineHandler?: string;
  eventHooks: MechanicEventHook[];
  parameters: Record<string, unknown>;
  ui: MechanicUiHints;
  automationLevel: AutomationLevel;
  updatedAt: number;
}

export interface TokenDefinition {
  id: string;
  name: string;
  setCodes: string[];
  rulesText: string;
  ui: MechanicUiHints;
  updatedAt: number;
}

export interface InteractionHint {
  id: string;
  mechanicId?: string;
  text: string;
  severity: 'info' | 'warning' | 'manual';
  updatedAt: number;
}

export interface CardOverride {
  id: string;
  cardName: string;
  setCodes: string[];
  mechanicIds: string[];
  ui?: MechanicUiHints;
  updatedAt: number;
}

export interface RulesetDefinition {
  version: string;
  publishedAt: number;
  mechanics: Record<string, MechanicDefinition>;
  tokens: Record<string, TokenDefinition>;
  interactionHints: Record<string, InteractionHint>;
  cardOverrides: Record<string, CardOverride>;
}

export interface MechanicRuntimeDefinition extends MechanicDefinition {
  executable: boolean;
}

export type MechanicHintContext =
  | 'battlefield'
  | 'combat'
  | 'cost_payment'
  | 'exile'
  | 'graveyard'
  | 'deck_import'
  | 'manual_prompt';

export interface MechanicHintOptions {
  cardZone?: string;
  phase?: string;
  exhaustUsed?: boolean;
}

export interface MechanicBadgeInfo {
  id: string;
  label: string;
  title: string;
  automationLevel: AutomationLevel;
  manual: boolean;
}
