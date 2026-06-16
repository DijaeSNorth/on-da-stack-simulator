import type { ActionRecord } from '../types/game';
import type {
  ReplayBookmark,
  ReplayBookmarkType,
  ReplayFile,
  ReplayReviewNote,
  ReplayReviewNoteType,
} from '../types/replay';

export const REVIEW_EXPORT_WARNING = 'Review exports include your notes. Review before sharing.';

export interface ReplayReviewMoment {
  actionIndex: number;
  turnNumber?: number;
  label: string;
  source: 'note' | 'bookmark' | 'selected';
  sourceId?: string;
}

export interface ReplayReviewSummary {
  warning: string;
  replayTitle: string;
  gameId: string;
  exportedAt: number;
  exportedAtText: string;
  players: string[];
  actionCount: number;
  turnCount: number;
  privacyMode: 'public' | 'private' | 'redacted';
  bookmarks: ReplayBookmark[];
  notesByType: Partial<Record<ReplayReviewNoteType, ReplayReviewNote[]>>;
  selectedMoments: ReplayReviewMoment[];
  highlightMoments: ReplayReviewMoment[];
  rulesQuestions: ReplayReviewNote[];
  deckIssues: ReplayReviewNote[];
  combatDecisions: ReplayReviewNote[];
  contentClips: ReplayReviewNote[];
}

const NOTE_TYPE_ORDER: ReplayReviewNoteType[] = [
  'mistake',
  'good_play',
  'rules_question',
  'deck_issue',
  'combat_decision',
  'mulligan_decision',
  'mana_issue',
  'highlight',
  'content_clip',
  'general',
];

function labelize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function privacyMode(replayFile: ReplayFile): ReplayReviewSummary['privacyMode'] {
  if (replayFile.privacy.includesPrivateZones) return 'private';
  if (replayFile.privacy.redactedPlayers?.length) return 'redacted';
  return 'public';
}

function safeActionLabel(replayFile: ReplayFile, action: ActionRecord | undefined, actionIndex: number): string {
  if (!action) return actionIndex < 0 ? 'Initial game state' : `Action ${actionIndex + 1}`;
  if (replayFile.privacy.includesPrivateZones) return action.description || action.actionType;
  const player = replayFile.players.find(summary => summary.playerId === action.playerId)?.displayName ?? 'A player';
  if (action.actionType === 'CAST' || action.actionType === 'CAST_SPELL') return `${player} cast a spell`;
  if (action.actionType === 'DRAW_CARD') return `${player} drew a card`;
  if (action.actionType === 'MOVE_CARD') return `${player} moved a card`;
  if (action.actionType === 'SEARCH_LIBRARY') return `${player} searched a library`;
  if (action.actionType === 'SCRY') return `${player} performed a private scry action`;
  if (action.actionType === 'SURVEIL') return `${player} performed a private surveil action`;
  if (action.actionType === 'DISCARD') return `${player} discarded a card`;
  return action.description || action.actionType;
}

function turnCount(replayFile: ReplayFile): number {
  const turns = new Set(replayFile.actionLog.map(action => action.turn).filter(turn => Number.isFinite(turn)));
  return Math.max(1, turns.size || replayFile.initialGameState.turn || 1);
}

function groupNotesByType(notes: ReplayReviewNote[]): Partial<Record<ReplayReviewNoteType, ReplayReviewNote[]>> {
  return notes.reduce<Partial<Record<ReplayReviewNoteType, ReplayReviewNote[]>>>((groups, note) => {
    groups[note.type] = [...(groups[note.type] ?? []), note];
    return groups;
  }, {});
}

function uniqueIndexes(...groups: number[][]): number[] {
  return Array.from(new Set(groups.flat())).sort((a, b) => a - b);
}

function buildMoment(replayFile: ReplayFile, actionIndex: number, source: ReplayReviewMoment['source'], sourceId?: string): ReplayReviewMoment {
  const action = replayFile.actionLog[actionIndex];
  return {
    actionIndex,
    turnNumber: action?.turn,
    label: safeActionLabel(replayFile, action, actionIndex),
    source,
    sourceId,
  };
}

export function generateReplayReviewSummary(
  replayFile: ReplayFile,
  notes: ReplayReviewNote[],
  bookmarks: ReplayBookmark[],
  selectedActionIndexes: number[] = [],
): ReplayReviewSummary {
  const notesByType = groupNotesByType(notes);
  const selectedMoments = uniqueIndexes(
    selectedActionIndexes,
    notes.map(note => note.actionIndex),
    bookmarks.map(bookmark => bookmark.actionIndex),
  ).map(actionIndex => buildMoment(replayFile, actionIndex, 'selected'));
  const bookmarkHighlights = bookmarks
    .filter(bookmark => ['highlight', 'combo', 'turning_point'].includes(bookmark.type))
    .map(bookmark => buildMoment(replayFile, bookmark.actionIndex, 'bookmark', bookmark.bookmarkId));
  const noteHighlights = notes
    .filter(note => note.type === 'highlight' || note.type === 'content_clip')
    .map(note => buildMoment(replayFile, note.actionIndex, 'note', note.noteId));

  return {
    warning: REVIEW_EXPORT_WARNING,
    replayTitle: replayFile.gameName || replayFile.gameId,
    gameId: replayFile.gameId,
    exportedAt: replayFile.exportedAt,
    exportedAtText: new Date(replayFile.exportedAt || Date.now()).toISOString(),
    players: replayFile.players.map(player => player.displayName),
    actionCount: replayFile.actionLog.length,
    turnCount: turnCount(replayFile),
    privacyMode: privacyMode(replayFile),
    bookmarks,
    notesByType,
    selectedMoments,
    highlightMoments: [...bookmarkHighlights, ...noteHighlights],
    rulesQuestions: notesByType.rules_question ?? [],
    deckIssues: notesByType.deck_issue ?? [],
    combatDecisions: notesByType.combat_decision ?? [],
    contentClips: notesByType.content_clip ?? [],
  };
}

function noteLine(note: ReplayReviewNote): string {
  const title = note.title ? ` - ${note.title}` : '';
  const tags = note.tags.length ? ` [${note.tags.join(', ')}]` : '';
  return `- Action ${note.actionIndex + 1}${note.turnNumber ? ` / Turn ${note.turnNumber}` : ''}${title}${tags}: ${note.body}`;
}

function bookmarkLine(bookmark: ReplayBookmark): string {
  return `- Action ${bookmark.actionIndex + 1}${bookmark.turnNumber ? ` / Turn ${bookmark.turnNumber}` : ''} - ${bookmark.label} (${labelize(bookmark.type as ReplayBookmarkType)})`;
}

function momentLine(moment: ReplayReviewMoment): string {
  return `- Action ${moment.actionIndex + 1}${moment.turnNumber ? ` / Turn ${moment.turnNumber}` : ''}: ${moment.label}`;
}

export function generateReplayReviewMarkdown(
  replayFile: ReplayFile,
  notes: ReplayReviewNote[],
  bookmarks: ReplayBookmark[],
  selectedActionIndexes: number[] = [],
): string {
  const summary = generateReplayReviewSummary(replayFile, notes, bookmarks, selectedActionIndexes);
  const lines = [
    `# Replay Review Summary: ${summary.replayTitle}`,
    '',
    `> ${summary.warning}`,
    '',
    `- Game ID: ${summary.gameId}`,
    `- Exported At: ${summary.exportedAtText}`,
    `- Players: ${summary.players.join(', ') || 'Unknown'}`,
    `- Actions: ${summary.actionCount}`,
    `- Turns: ${summary.turnCount}`,
    `- Privacy: ${labelize(summary.privacyMode)}`,
    '',
    '## Bookmarks',
    ...(summary.bookmarks.length ? summary.bookmarks.map(bookmarkLine) : ['- None']),
    '',
    '## Selected Action Moments',
    ...(summary.selectedMoments.length ? summary.selectedMoments.map(momentLine) : ['- None']),
    '',
    '## Highlight Moments',
    ...(summary.highlightMoments.length ? summary.highlightMoments.map(momentLine) : ['- None']),
    '',
    '## Rules Questions',
    ...(summary.rulesQuestions.length ? summary.rulesQuestions.map(noteLine) : ['- None']),
    '',
    '## Deck Issues',
    ...(summary.deckIssues.length ? summary.deckIssues.map(noteLine) : ['- None']),
    '',
    '## Combat Decisions',
    ...(summary.combatDecisions.length ? summary.combatDecisions.map(noteLine) : ['- None']),
    '',
    '## Content Clips',
    ...(summary.contentClips.length ? summary.contentClips.map(noteLine) : ['- None']),
    '',
    '## Notes by Type',
  ];

  for (const type of NOTE_TYPE_ORDER) {
    const group = summary.notesByType[type] ?? [];
    if (group.length === 0) continue;
    lines.push('', `### ${labelize(type)}`, ...group.map(noteLine));
  }

  if (notes.length === 0) lines.push('', '- None');
  return lines.join('\n');
}

export function generateReplayReviewJson(
  replayFile: ReplayFile,
  notes: ReplayReviewNote[],
  bookmarks: ReplayBookmark[],
  selectedActionIndexes: number[] = [],
): string {
  return JSON.stringify(generateReplayReviewSummary(replayFile, notes, bookmarks, selectedActionIndexes), null, 2);
}
