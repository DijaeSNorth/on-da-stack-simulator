import type { Deck, GameState } from '../types/game';

const EXIT_PROGRESS_KEY = 'mtg_sim_exit_progress';
const MAX_EXIT_PROGRESS = 5;

export interface ExitProgressSnapshot {
  id: string;
  savedAt: number;
  gameId: string;
  status: GameState['status'];
  turn: number;
  phase: GameState['phase'];
  playerCount: number;
  actionCount: number;
  deckSummaries: {
    playerId: string;
    playerName: string;
    deckId?: string;
    deckName?: string;
    libraryCount: number;
    handCount: number;
    commandZoneCount: number;
    graveyardCount: number;
    exileCount: number;
  }[];
}

export function createExitProgressSnapshot(game: GameState, savedDecks: Deck[] = []): ExitProgressSnapshot {
  return {
    id: crypto.randomUUID(),
    savedAt: Date.now(),
    gameId: game.id,
    status: game.status,
    turn: game.turn,
    phase: game.phase,
    playerCount: game.players.length,
    actionCount: game.actionLog.length,
    deckSummaries: game.players.map(player => {
      const deck = savedDecks.find(saved => saved.id === player.deckId);
      return {
        playerId: player.id,
        playerName: player.name,
        deckId: player.deckId,
        deckName: deck?.name,
        libraryCount: player.library.length,
        handCount: player.hand.length,
        commandZoneCount: player.commandZone.length,
        graveyardCount: player.graveyard.length,
        exileCount: player.exile.length,
      };
    }),
  };
}

export function loadExitProgressSnapshots(): ExitProgressSnapshot[] {
  try {
    const raw = localStorage.getItem(EXIT_PROGRESS_KEY);
    return raw ? JSON.parse(raw) as ExitProgressSnapshot[] : [];
  } catch {
    return [];
  }
}

export function saveExitProgressSnapshot(snapshot: ExitProgressSnapshot): void {
  try {
    const existing = loadExitProgressSnapshots();
    localStorage.setItem(
      EXIT_PROGRESS_KEY,
      JSON.stringify([snapshot, ...existing.filter(item => item.id !== snapshot.id)].slice(0, MAX_EXIT_PROGRESS))
    );
  } catch {
    // Storage full or unavailable.
  }
}
