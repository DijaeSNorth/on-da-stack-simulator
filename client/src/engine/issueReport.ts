import type { ActionRecord, GameState } from '../types/game';
import type { PlayerReport, ReportCluster } from '../types/report';

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

function sanitizePublicIssueText(value: string): string {
  return value
    .replace(/Firebase UID:\s*[A-Za-z0-9_-]+/gi, 'Firebase UID: [redacted]')
    .replace(/participantToken["':=\s]+[A-Za-z0-9._-]+/gi, 'participantToken [redacted]')
    .replace(/\b[A-Z0-9]{6}\b/g, '[possible-room-code-redacted]')
    .replace(/\b(hand|library|sideboard|maybeboard)\s*:\s*\[[^\]]+\]/gi, '$1: [redacted]')
    .slice(0, 8000);
}

function canCreatePublicIssueForReport(report: Pick<PlayerReport, 'type' | 'privacyMode'>): boolean {
  return report.privacyMode !== 'private' &&
    report.type !== 'player_behavior' &&
    report.type !== 'cheating';
}

export function buildSanitizedGitHubIssueBodyFromReport(report: PlayerReport): string | null {
  if (!canCreatePublicIssueForReport(report)) return null;
  const actionLines = report.safeContext.actionLog?.slice(-10).map(action =>
    `- T${action.turn} ${action.phase} ${action.actionType}: ${action.description}`
  ) ?? [];
  return sanitizePublicIssueText([
    '## Sanitized Player Report',
    '',
    `- Type: ${report.type}`,
    `- Severity: ${report.severity}`,
    `- Build: ${report.buildCommit}`,
    `- App version: ${report.appVersion}`,
    `- Screen: ${report.screen}`,
    report.component ? `- Component: ${report.component}` : undefined,
    report.actionType ? `- Action type: ${report.actionType}` : undefined,
    `- Turn: ${report.turn}`,
    `- Phase: ${report.phase}`,
    '',
    '## Symptom',
    report.description,
    '',
    '## Recent Public Actions',
    actionLines.length ? actionLines.join('\n') : '- Not included',
  ].filter((line): line is string => line !== undefined).join('\n'));
}

export function buildSanitizedGitHubIssueUrlFromReport(report: PlayerReport): string | null {
  const body = buildSanitizedGitHubIssueBodyFromReport(report);
  if (!body) return null;
  const params = new URLSearchParams({
    title: `Sanitized report cluster: ${report.title}`,
    body,
    labels: 'bug,player-report,sanitized',
  });
  return `${GITHUB_ISSUE_URL}?${params.toString()}`;
}

export function buildSanitizedGitHubIssueUrlFromCluster(cluster: ReportCluster): string | null {
  if (cluster.reportType === 'player_behavior' || cluster.reportType === 'cheating') return null;
  const body = sanitizePublicIssueText([
    '## Sanitized Report Cluster',
    '',
    `- Cluster: ${cluster.clusterId}`,
    `- Type: ${cluster.reportType}`,
    `- Severity: ${cluster.severity}`,
    `- Count: ${cluster.count}`,
    `- Builds: ${cluster.affectedBuilds.join(', ') || 'unknown'}`,
    '',
    '## Symptoms',
    cluster.sanitizedSummary,
    '',
    '## Suggested Files',
    cluster.suggestedAreas.map(area => `- ${area}`).join('\n') || '- None',
  ].join('\n'));
  const params = new URLSearchParams({
    title: `Sanitized report cluster: ${cluster.title}`,
    body,
    labels: 'bug,player-report,sanitized',
  });
  return `${GITHUB_ISSUE_URL}?${params.toString()}`;
}
