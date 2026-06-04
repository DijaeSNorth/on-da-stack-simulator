import type { ActionRecord, Deck } from '../types/game';

export interface PracticeScenario {
  id: string;
  name: string;
  description: string;
  decks: Deck[];
  objectives: string[];
  expectedReviewTypes: string[];
}

export interface ScenarioReviewSummary {
  actionCount: number;
  reviewCount: number;
  missedTriggers: number;
  judgeReviews: number;
  stateBasedReviews: number;
  replacementReviews: number;
}

export function summarizeScenarioReplay(actions: ActionRecord[]): ScenarioReviewSummary {
  return actions.reduce<ScenarioReviewSummary>((summary, action) => {
    const reviewTypes = getReviewTypes(action);
    if (reviewTypes.length === 0 && action.flags.length === 0) return summary;

    summary.reviewCount += 1;
    if (reviewTypes.includes('missed-trigger') || action.flags.some(flag => flag.label === 'Missed Trigger')) {
      summary.missedTriggers += 1;
    }
    if (reviewTypes.includes('judge-review') || reviewTypes.includes('illegal-action') || action.flags.length > 0) {
      summary.judgeReviews += 1;
    }
    if (reviewTypes.includes('state-based') || action.flags.some(flag => flag.label === 'State-Based')) {
      summary.stateBasedReviews += 1;
    }
    if (action.description.toLowerCase().includes('replacement') || action.description.toLowerCase().includes('instead')) {
      summary.replacementReviews += 1;
    }
    return summary;
  }, {
    actionCount: actions.length,
    reviewCount: 0,
    missedTriggers: 0,
    judgeReviews: 0,
    stateBasedReviews: 0,
    replacementReviews: 0,
  });
}

export function buildPracticeScenario(params: {
  id: string;
  name: string;
  description: string;
  decks: Deck[];
  objectives?: string[];
  expectedReviewTypes?: string[];
}): PracticeScenario {
  return {
    id: params.id,
    name: params.name,
    description: params.description,
    decks: params.decks,
    objectives: params.objectives ?? [],
    expectedReviewTypes: params.expectedReviewTypes ?? [],
  };
}

function getReviewTypes(action: ActionRecord): string[] {
  if (Array.isArray(action.data?.reviewTypes)) {
    return action.data.reviewTypes.map(type => String(type));
  }
  const reviewType = action.data?.reviewType;
  return typeof reviewType === 'string' ? [reviewType] : [];
}
