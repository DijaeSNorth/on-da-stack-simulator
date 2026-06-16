import type { ReplayBookmark, ReplayFile, ReplayReviewNote } from '../types/replay';

const REVIEW_STORAGE_KEY = 'on-da-stack-replay-review-v1';

export const REPLAY_REVIEW_STORAGE_COPY = 'Replay notes and bookmarks are stored in this browser. Export anything you want to keep.';

export interface ReplayReviewData {
  replayId: string;
  notes: ReplayReviewNote[];
  bookmarks: ReplayBookmark[];
  updatedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readAllReviews(): Record<string, ReplayReviewData> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEW_STORAGE_KEY) || '{}') as unknown;
    if (!isRecord(parsed)) return {};
    const reviews: Record<string, ReplayReviewData> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      const notes = Array.isArray(value.notes) ? value.notes.filter(isReplayNote) : [];
      const bookmarks = Array.isArray(value.bookmarks) ? value.bookmarks.filter(isReplayBookmark) : [];
      reviews[key] = {
        replayId: typeof value.replayId === 'string' ? value.replayId : key,
        notes,
        bookmarks,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      };
    }
    return reviews;
  } catch {
    return {};
  }
}

function writeAllReviews(reviews: Record<string, ReplayReviewData>): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(reviews));
}

function isReplayNote(value: unknown): value is ReplayReviewNote {
  return isRecord(value) &&
    typeof value.noteId === 'string' &&
    typeof value.replayId === 'string' &&
    typeof value.actionIndex === 'number' &&
    typeof value.createdAt === 'number' &&
    typeof value.body === 'string' &&
    Array.isArray(value.tags);
}

function isReplayBookmark(value: unknown): value is ReplayBookmark {
  return isRecord(value) &&
    typeof value.bookmarkId === 'string' &&
    typeof value.replayId === 'string' &&
    typeof value.actionIndex === 'number' &&
    typeof value.createdAt === 'number' &&
    typeof value.label === 'string';
}

export function getReplayReviewId(replayFile: ReplayFile): string {
  return `${replayFile.gameId}:${replayFile.exportedAt}`;
}

export function saveReplayReview(replayId: string, notes: ReplayReviewNote[], bookmarks: ReplayBookmark[]): ReplayReviewData {
  const reviews = readAllReviews();
  const review = {
    replayId,
    notes,
    bookmarks,
    updatedAt: Date.now(),
  };
  reviews[replayId] = review;
  writeAllReviews(reviews);
  return review;
}

export function loadReplayReview(replayId: string): { notes: ReplayReviewNote[]; bookmarks: ReplayBookmark[] } {
  const review = readAllReviews()[replayId];
  return {
    notes: review?.notes ?? [],
    bookmarks: review?.bookmarks ?? [],
  };
}

export function deleteReplayReview(replayId: string): void {
  const reviews = readAllReviews();
  delete reviews[replayId];
  writeAllReviews(reviews);
}

export function exportReplayReview(replayId: string): ReplayReviewData {
  const review = loadReplayReview(replayId);
  return {
    replayId,
    notes: review.notes,
    bookmarks: review.bookmarks,
    updatedAt: Date.now(),
  };
}
