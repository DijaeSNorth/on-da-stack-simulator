import type { ActionRecord, GameState } from '../types/game';

export const GITHUB_ISSUE_URL = 'https://github.com/DijaeSNorth/on-da-stack-simulator/issues/new';

export interface IssueAssistantMessage {
  timestamp: number;
  severity: string;
  label: string;
  text: string;
  turn: number;
  phase: string;
  ruleRef?: string;
}

export interface IssueReportOptions {
  pageUrl?: string;
  userAgent?: string;
  now?: Date;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function describeAction(action: ActionRecord): string {
  const review = [
    ...(action.flags ?? []).map(flag => flag.text),
    ...(typeof action.data?.assistantSummary === 'string' ? [action.data.assistantSummary] : []),
  ].filter(Boolean);
  const reviewText = review.length > 0 ? ` | Judge: ${review.map(text => truncate(text, 120)).join(' / ')}` : '';
  return `- T${action.turn} ${action.phase} ${action.actionType}: ${truncate(action.description, 160)}${reviewText}`;
}

function describeMessage(message: IssueAssistantMessage): string {
  const rule = message.ruleRef ? ` (${message.ruleRef})` : '';
  return `- T${message.turn} ${message.phase} ${message.label}${rule}: ${truncate(message.text, 180)}`;
}

export function buildIssueReportBody(
  game: GameState,
  assistantMessages: IssueAssistantMessage[],
  options: IssueReportOptions = {},
): string {
  const players = game.players.map(player => {
    const commanderNames = player.commanders
      .map(id => game.cards[id]?.definition.name)
      .filter(Boolean)
      .join(', ') || 'None';
    return `- ${player.name} (${player.id}): ${player.life} life, ${player.hand.length} hand, ${player.library.length} library, ${player.battlefield.length} battlefield, commanders: ${commanderNames}`;
  });
  const stack = game.stack.slice(0, 8).map(item =>
    `- ${item.sourceName} [${item.type}] controlled by ${item.controllerId}${item.targetLabels?.length ? ` -> ${item.targetLabels.join(', ')}` : ''}`
  );
  const pendingTriggers = game.triggerQueue
    .filter(trigger => !trigger.acknowledged)
    .slice(0, 10)
    .map(trigger => `- ${trigger.sourceName}: ${truncate(trigger.text, 160)}`);
  const recentActions = game.actionLog.slice(-15).map(describeAction);
  const recentJudge = assistantMessages.slice(-10).map(describeMessage);

  return [
    '## What happened?',
    '<!-- Describe the issue, what you expected, and what happened instead. -->',
    '',
    '## Table Context',
    `- Turn: ${game.turn}`,
    `- Phase: ${game.phase}`,
    `- Active player: ${game.activePlayerId}`,
    `- Priority player: ${game.priorityPlayerId}`,
    `- Status: ${game.status}`,
    `- Report time: ${(options.now ?? new Date()).toISOString()}`,
    options.pageUrl ? `- Page: ${options.pageUrl}` : undefined,
    options.userAgent ? `- Browser: ${options.userAgent}` : undefined,
    '',
    '## Players',
    players.length ? players.join('\n') : '- No players',
    '',
    '## Stack',
    stack.length ? stack.join('\n') : '- Empty',
    '',
    '## Pending Triggers',
    pendingTriggers.length ? pendingTriggers.join('\n') : '- None',
    '',
    '## Recent Actions',
    recentActions.length ? recentActions.join('\n') : '- No actions logged',
    '',
    '## Recent Judge Notes',
    recentJudge.length ? recentJudge.join('\n') : '- No judge notes',
    '',
    '## Reproduction Steps',
    '1. ',
    '2. ',
    '3. ',
  ].filter((line): line is string => line !== undefined).join('\n');
}

export function buildIssueReportUrl(
  game: GameState,
  assistantMessages: IssueAssistantMessage[],
  options: IssueReportOptions = {},
): string {
  const title = `Gameplay issue: turn ${game.turn} ${game.phase}`;
  const body = buildIssueReportBody(game, assistantMessages, options);
  const params = new URLSearchParams({
    title,
    body,
    labels: 'bug,player-report',
  });
  return `${GITHUB_ISSUE_URL}?${params.toString()}`;
}
