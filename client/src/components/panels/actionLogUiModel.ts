import type { ActionRecord, CardState, Player } from '../../types/game';

export type ActionLogCategory =
  | 'turn'
  | 'combat'
  | 'spell'
  | 'ability'
  | 'draw'
  | 'zone-change'
  | 'life'
  | 'counter'
  | 'token'
  | 'mechanic'
  | 'manual'
  | 'multiplayer'
  | 'warning'
  | 'other';

export type ActionLogFilter =
  | 'all'
  | 'turns'
  | 'combat'
  | 'spells-abilities'
  | 'abilities'
  | 'zone-changes'
  | 'draws'
  | 'damage'
  | 'damage-life'
  | 'manual-judge'
  | 'multiplayer-sync'
  | 'warnings'
  | 'mechanic';

export const ACTION_LOG_FILTERS: { id: ActionLogFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'turns', label: 'Turns' },
  { id: 'combat', label: 'Combat' },
  { id: 'spells-abilities', label: 'Spells' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'damage-life', label: 'Damage' },
  { id: 'zone-changes', label: 'Zone Changes' },
  { id: 'mechanic', label: 'Mechanics' },
  { id: 'manual-judge', label: 'Manual/Judge' },
  { id: 'warnings', label: 'Warnings' },
];

export interface ActionLogRow {
  action: ActionRecord;
  actionIndex: number;
  category: ActionLogCategory;
  playerName: string;
  text: string;
  searchText: string;
}

export interface ActionLogGroup {
  key: string;
  label: string;
  actions: ActionLogRow[];
}

export interface ActionLogViewModel {
  rows: ActionLogRow[];
  groups: ActionLogGroup[];
  totalCount: number;
  visibleCount: number;
}

export interface BuildActionLogViewOptions {
  players?: Player[];
  cards?: Record<string, CardState>;
  filter?: ActionLogFilter;
  query?: string;
  groupByTurn?: boolean;
  currentTurn?: number;
}

const MECHANIC_TYPES = new Set(['SCRY', 'SURVEIL', 'CYCLE', 'DREDGE', 'PROLIFERATE', 'TUTOR', 'REANIMATE']);
const MULTIPLAYER_PATTERNS = /\b(peer|sync|remote|host|join|joined|room|multiplayer|spectator|connection|disconnect|reconnect)\b/i;
const MECHANIC_PATTERNS = /\b(airbend|warp|firebend|firebending|waterbend|earthbend|sneak|spacecraft|station|blight|vivid|dredge|proliferate|scry|surveil|cycle)\b/i;

export function inferActionCategory(action: ActionRecord): ActionLogCategory {
  const type = action.actionType;
  const text = `${type} ${action.description ?? ''}`.toLowerCase();
  const hasWarnings = (action.flags ?? []).some(flag => flag.severity === 'warning' || flag.severity === 'error' || flag.severity === 'needsReview') ||
    Array.isArray(action.data?.reviewTypes);

  if (hasWarnings || type === 'FLAG') return 'warning';
  if (type === 'CHANGE_PHASE' || type === 'PASS_PRIORITY' || type === 'GAME_START' || type === 'GAME_END') return 'turn';
  if (type === 'DECLARE_ATTACKER' || type === 'DECLARE_BLOCKER' || text.includes('combat') || text.includes('attack') || text.includes('block')) return 'combat';
  if (type === 'CAST_SPELL' || type === 'CAST' || type === 'PUT_ON_STACK' || type === 'RESOLVE_STACK' || type === 'COUNTER_SPELL') return 'spell';
  if (type === 'ACTIVATE_ABILITY' || type === 'CHOOSE_MODE') return 'ability';
  if (type === 'DRAW_CARD' || text.includes('drew') || text.includes('draw')) return 'draw';
  if (type === 'MOVE_CARD' || type === 'DISCARD' || type === 'SHUFFLE' || type === 'SEARCH_LIBRARY') return 'zone-change';
  if (type === 'CHANGE_LIFE' || type === 'COMMANDER_DAMAGE' || text.includes('damage') || text.includes('life')) return 'life';
  if (type === 'ADD_COUNTER' || type === 'REMOVE_COUNTER' || type === 'REMOVE_ALL_COUNTERS' || text.includes('counter')) return 'counter';
  if (type === 'ADD_TOKEN' || type === 'REMOVE_TOKEN' || text.includes('token')) return 'token';
  if (MECHANIC_TYPES.has(type) || MECHANIC_PATTERNS.test(text)) return 'mechanic';
  if (MULTIPLAYER_PATTERNS.test(text)) return 'multiplayer';
  if (type === 'NOTE' || type === 'OTHER' || type === 'UNDO' || type === 'REDO' || type === 'SNAPSHOT') return 'manual';
  return 'other';
}

export function actionMatchesFilter(category: ActionLogCategory, filter: ActionLogFilter = 'all'): boolean {
  if (filter === 'all') return true;
  if (filter === 'turns') return category === 'turn';
  if (filter === 'combat') return category === 'combat';
  if (filter === 'spells-abilities') return category === 'spell' || category === 'ability';
  if (filter === 'abilities') return category === 'ability';
  if (filter === 'zone-changes') return category === 'zone-change';
  if (filter === 'draws') return category === 'draw';
  if (filter === 'damage') return category === 'life';
  if (filter === 'damage-life') return category === 'life' || category === 'combat';
  if (filter === 'manual-judge') return category === 'manual' || category === 'warning';
  if (filter === 'multiplayer-sync') return category === 'multiplayer';
  if (filter === 'warnings') return category === 'warning';
  if (filter === 'mechanic') return category === 'mechanic';
  return true;
}

export function compactActionText(action: ActionRecord, playerName?: string): string {
  const description = action.description?.trim();
  if (description) return description;
  const actor = playerName || action.playerId || 'A player';
  return `${actor} ${action.actionType.toLowerCase().replace(/_/g, ' ')}.`;
}

export function getActionLogSearchText(
  action: ActionRecord,
  players: Player[] = [],
  cards: Record<string, CardState> = {},
): string {
  const player = players.find(p => p.id === action.playerId);
  const affectedCardText = (action.affectedObjects ?? [])
    .map(id => cards[id]?.definition?.name)
    .filter(Boolean)
    .join(' ');
  const flagText = (action.flags ?? []).map(flag => `${flag.label} ${flag.text} ${flag.ruleRef ?? ''}`).join(' ');
  const dataText = Object.values(action.data ?? {})
    .filter(value => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .join(' ');
  return [
    action.actionType,
    action.description,
    player?.name,
    action.playerId,
    affectedCardText,
    flagText,
    dataText,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function matchesActionLogSearch(row: ActionLogRow, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (row.searchText.includes(normalized)) return true;
  if (normalized.includes(' ')) return false;
  return normalized.split(/\s+/).every(part => row.searchText.includes(part));
}

export function buildActionLogRows(
  actions: ActionRecord[],
  players: Player[] = [],
  cards: Record<string, CardState> = {},
): ActionLogRow[] {
  return actions.map((action, actionIndex) => {
    const player = players.find(p => p.id === action.playerId);
    const category = inferActionCategory(action);
    return {
      action,
      actionIndex,
      category,
      playerName: player?.name ?? action.playerId,
      text: compactActionText(action, player?.name),
      searchText: getActionLogSearchText(action, players, cards),
    };
  });
}

export function groupActionLogRowsByTurn(rows: ActionLogRow[], currentTurn?: number): ActionLogGroup[] {
  const groups = new Map<number, ActionLogRow[]>();
  for (const row of rows) {
    const turn = Number.isFinite(row.action.turn) ? row.action.turn : 0;
    groups.set(turn, [...(groups.get(turn) ?? []), row]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => b - a)
    .map(([turn, actions]) => ({
      key: `turn-${turn}`,
      label: turn === currentTurn ? `Current Turn (${turn})` : `Turn ${turn}`,
      actions,
    }));
}

export function buildActionLogViewModel(
  actions: ActionRecord[],
  options: BuildActionLogViewOptions = {},
): ActionLogViewModel {
  const allRows = buildActionLogRows(actions, options.players, options.cards);
  const visibleRows = allRows
    .filter(row => actionMatchesFilter(row.category, options.filter))
    .filter(row => matchesActionLogSearch(row, options.query ?? ''))
    .reverse();
  const groups = options.groupByTurn
    ? groupActionLogRowsByTurn(visibleRows, options.currentTurn)
    : [{ key: 'all', label: 'Visible Actions', actions: visibleRows }];
  return {
    rows: visibleRows,
    groups,
    totalCount: allRows.length,
    visibleCount: visibleRows.length,
  };
}

export function serializeVisibleActionLog(groups: ActionLogGroup[]): string {
  return groups
    .flatMap(group => [
      group.label,
      ...group.actions.map(row => `T${row.action.turn} ${row.playerName}: ${row.text}`),
    ])
    .join('\n');
}
