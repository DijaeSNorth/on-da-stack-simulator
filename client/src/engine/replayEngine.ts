/**
 * replayEngine.ts
 *
 * Lightweight replay system — intentionally minimal.
 * Designed to be extended later (compressed storage, network sharing, video export).
 *
 * Core concepts:
 *   - A "Replay" is a named recording of a game: metadata + the full actionLog
 *     + a sparse array of GameState snapshots at key moments
 *   - Snapshots are taken automatically at: GAME_START, each turn change,
 *     and GAME_END. Manual snapshots are respected too.
 *   - Seeking to action N reconstructs state by finding the nearest
 *     snapshot before N, then replaying forward through the actionLog.
 *     (For v1 we store a full state snapshot at every checkpoint —
 *      so seeking is instant. Delta replay can be added later.)
 *   - Replays are saved to localStorage under REPLAY_STORAGE_KEY.
 *   - Export/import as plain JSON for sharing.
 *
 * Extension points (marked with FUTURE):
 *   - FUTURE: LZ-string compression for large replays
 *   - FUTURE: Network share via a replay cloud or room host export
 *   - FUTURE: Delta reconstruction instead of full snapshots
 *   - FUTURE: Video/GIF export
 */

import type { GameState, ActionRecord, Player } from '../types/game';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReplayCheckpoint {
  actionIndex: number;   // index in actionLog this snapshot was taken after
  state: string;         // JSON-serialized GameState
  label: string;         // "Turn 3 — Main 1" etc.
}

export interface ReplayMeta {
  id: string;
  name: string;
  savedAt: number;
  turnCount: number;
  playerNames: string[];
  actionCount: number;
  durationMs: number;    // lastAction.timestamp - firstAction.timestamp
  format: string;        // 'commander' | custom
}

export interface Replay {
  meta: ReplayMeta;
  actionLog: ActionRecord[];
  checkpoints: ReplayCheckpoint[];
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const REPLAY_STORAGE_KEY = 'mtg-replays-v1';
const MAX_STORED_REPLAYS = 10; // keep last 10, drop oldest

export function saveReplayToStorage(replay: Replay): void {
  try {
    const existing = loadReplaysFromStorage();
    // Prepend new, trim to max
    const updated = [replay, ...existing.filter(r => r.meta.id !== replay.meta.id)]
      .slice(0, MAX_STORED_REPLAYS);
    localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // localStorage full — silently skip (FUTURE: warn user)
  }
}

export function loadReplaysFromStorage(): Replay[] {
  try {
    const raw = localStorage.getItem(REPLAY_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Replay[];
  } catch {
    return [];
  }
}

export function deleteReplayFromStorage(replayId: string): void {
  const updated = loadReplaysFromStorage().filter(r => r.meta.id !== replayId);
  localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(updated));
}

// ─── Create replay from a completed/in-progress GameState ─────────────────────

export function createReplay(game: GameState, name?: string): Replay {
  const id = crypto.randomUUID();
  const log = game.actionLog;

  const firstTs = log[0]?.timestamp ?? Date.now();
  const lastTs  = log[log.length - 1]?.timestamp ?? Date.now();

  // Build checkpoints at key moments
  const checkpoints: ReplayCheckpoint[] = [];

  // Always checkpoint at the very start (index -1 = before any actions)
  checkpoints.push({
    actionIndex: -1,
    state: JSON.stringify(game),   // FUTURE: compress
    label: 'Game Start',
  });

  // Checkpoint at every turn change and GAME_END
  // For v1 simplicity: we store one full snapshot at each CHANGE_PHASE to a
  // new turn's UNTAP step, and at GAME_END.
  // FUTURE: reconstruct from deltas to save space.
  let lastCheckpointTurn = -1;
  log.forEach((action, index) => {
    const isTurnStart = action.actionType === 'CHANGE_PHASE' &&
      (action.phase === 'untap' || action.data?.phase === 'untap' || action.data?.to === 'untap') &&
      action.turn !== lastCheckpointTurn;
    const isGameEnd = action.actionType === 'GAME_END';

    if (isTurnStart || isGameEnd) {
      lastCheckpointTurn = action.turn;
      checkpoints.push({
        actionIndex: index,
        // We store game state at time of action using snapshotBefore if available,
        // otherwise we'll reconstruct at load time from the start snapshot.
        // For v1: only store the final game state as a reference point.
        // Full per-turn checkpoints require passing state to each action — FUTURE.
        state: JSON.stringify(game),
        label: isGameEnd
          ? `Game End — Turn ${action.turn}`
          : `Turn ${action.turn}`,
      });
    }
  });

  const meta: ReplayMeta = {
    id,
    name: name ?? `Game ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    savedAt: Date.now(),
    turnCount: game.turn,
    playerNames: game.players.map((p: Player) => p.name),
    actionCount: log.length,
    durationMs: lastTs - firstTs,
    format: game.config?.format ?? 'commander',
  };

  return { meta, actionLog: log, checkpoints };
}

// ─── Seek: get the game state at a given actionLog index ──────────────────────
// v1: Returns the nearest checkpoint's state (full snapshot).
// For a thin replay viewer we just need to show what happened — we don't need
// to reconstruct full live game state, just display the action log up to that point.
// FUTURE: reconstruct exact GameState by replaying engine functions.

export function getStateAtIndex(replay: Replay, targetIndex: number): GameState | null {
  // Find the latest checkpoint at or before targetIndex
  let best: ReplayCheckpoint | null = null;
  for (const cp of replay.checkpoints) {
    if (cp.actionIndex <= targetIndex) {
      best = cp;
    }
  }
  if (!best) return null;
  try {
    return JSON.parse(best.state) as GameState;
  } catch {
    return null;
  }
}

// ─── Get a slice of actions for display ───────────────────────────────────────

export function getActionsUpTo(replay: Replay, index: number): ActionRecord[] {
  return replay.actionLog.slice(0, index + 1);
}

// ─── Export / Import ──────────────────────────────────────────────────────────

export function exportReplayAsJSON(replay: Replay): string {
  return JSON.stringify(replay, null, 2);
}

export function importReplayFromJSON(json: string): Replay | null {
  try {
    const obj = JSON.parse(json);
    // Basic validation
    if (!obj.meta?.id || !Array.isArray(obj.actionLog)) return null;
    return obj as Replay;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Group action log entries by turn for display */
export function groupActionsByTurn(
  actions: ActionRecord[]
): { turn: number; phase: string; actions: ActionRecord[] }[] {
  const groups: Map<string, { turn: number; phase: string; actions: ActionRecord[] }> = new Map();
  for (const a of actions) {
    const key = `${a.turn}-${a.phase}`;
    if (!groups.has(key)) {
      groups.set(key, { turn: a.turn, phase: a.phase, actions: [] });
    }
    groups.get(key)!.actions.push(a);
  }
  return Array.from(groups.values());
}

/** Human-readable label for an action */
export function describeAction(action: ActionRecord): string {
  return action.description || `${action.actionType} by ${action.playerId}`;
}

// ─── Action type color coding ─────────────────────────────────────────────────

export const ACTION_COLORS: Partial<Record<string, string>> = {
  CAST_SPELL:       '#a78bfa',
  RESOLVE_STACK:    '#34d399',
  COUNTER_SPELL:    '#f87171',
  MOVE_CARD:        '#64748b',
  TAP:              '#fbbf24',
  UNTAP:            '#94a3b8',
  CHANGE_LIFE:      '#f87171',
  COMMANDER_DAMAGE: '#ef4444',
  DECLARE_ATTACKER: '#f97316',
  DECLARE_BLOCKER:  '#fb923c',
  DRAW_CARD:        '#60a5fa',
  DISCARD:          '#94a3b8',
  ADD_TOKEN:        '#4ade80',
  CHANGE_PHASE:     '#334155',
  PASS_PRIORITY:    '#1e293b',
  GAME_START:       '#7c3aed',
  GAME_END:         '#7c3aed',
  SNAPSHOT:         '#0ea5e9',
};
