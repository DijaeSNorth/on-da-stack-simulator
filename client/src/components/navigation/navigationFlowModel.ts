export type TopLevelNavMode = 'deckLab' | 'playOnline' | 'replayViewer' | 'settings';

export type MultiplayerDeckStatus = 'none' | 'submitted' | 'valid' | 'rejected' | 'unknown';

export interface NavigationItem {
  id: TopLevelNavMode;
  label: string;
}

export interface NextStep {
  label: string;
  detail?: string;
  ctaLabel?: string;
}

export const TOP_LEVEL_NAV_ITEMS: NavigationItem[] = [
  { id: 'deckLab', label: 'Deck Lab' },
  { id: 'playOnline', label: 'Play Online' },
  { id: 'replayViewer', label: 'Replay Viewer' },
  { id: 'settings', label: 'Settings' },
];

export function getDeckLabNextStep(options: {
  hasDeck: boolean;
  hasValidationErrors?: boolean;
  activeTab?: string;
}): NextStep {
  if (!options.hasDeck) {
    return {
      label: 'Import or create a deck',
      detail: 'Start with a deck before testing hands, validation, or reports.',
      ctaLabel: 'Open Deck Lab',
    };
  }

  if (options.hasValidationErrors) {
    return {
      label: 'Fix deck validation errors',
      detail: 'Resolve deck issues before moving into multiplayer or reports.',
      ctaLabel: 'Review validation',
    };
  }

  if (options.activeTab === 'reports') {
    return {
      label: 'Generate performance report',
      detail: 'Use saved test data to review deck performance.',
      ctaLabel: 'Generate report',
    };
  }

  return {
    label: 'Test an opening hand',
    detail: 'Goldfish the deck and check early-game consistency.',
    ctaLabel: 'Test hand',
  };
}

export function getPlayOnlineNextStep(options: {
  connected: boolean;
  deckStatus: MultiplayerDeckStatus;
  localReady?: boolean;
  isHost?: boolean;
  canStart?: boolean;
  startHandshakeActive?: boolean;
  gameStarted?: boolean;
}): NextStep {
  if (!options.connected) {
    return {
      label: 'Host or join a game',
      detail: 'Create a room or enter a room code to play online.',
      ctaLabel: 'Open multiplayer',
    };
  }

  if (options.gameStarted) {
    return {
      label: 'Enter the game',
      detail: 'The room has started. Return to the table when ready.',
      ctaLabel: 'Enter table',
    };
  }

  if (options.deckStatus !== 'valid') {
    return {
      label: 'Choose Deck',
      detail: 'Ready is available after your selected deck passes validation.',
      ctaLabel: 'Choose deck',
    };
  }

  if (!options.localReady) {
    return {
      label: 'Mark Ready',
      detail: 'Confirm your deck and seat so the host can start.',
      ctaLabel: 'Mark ready',
    };
  }

  if (options.startHandshakeActive) {
    return {
      label: 'Waiting for start sync',
      detail: 'The room is confirming every player received the start payload.',
    };
  }

  if (options.isHost && options.canStart) {
    return {
      label: 'Start game',
      detail: 'All required players are ready with valid decks.',
      ctaLabel: 'Start game',
    };
  }

  return {
    label: 'Waiting for host',
    detail: 'You are ready. The host starts the game when the table is prepared.',
  };
}

export function getReplayViewerNextStep(options: { hasReplay: boolean }): NextStep {
  if (!options.hasReplay) {
    return {
      label: 'Load a replay file',
      detail: 'Import or select a saved replay before reviewing turns.',
      ctaLabel: 'Load replay',
    };
  }

  return {
    label: 'Press play or scrub the timeline',
    detail: 'Use the replay controls to inspect actions turn by turn.',
  };
}

export function getBreadcrumb(parts: Array<string | undefined | null | false>): string[] {
  return parts.filter((part): part is string => Boolean(part));
}

export function getStartGameDisabledReason(options: {
  isInRoom: boolean;
  isHost: boolean;
  connectedPlayers: number;
  minimumPlayers: number;
  missingDeckPlayers: string[];
  waitingForConnections?: boolean;
  startHandshakeActive?: boolean;
  syncWaitSeconds?: number;
}): string {
  if (!options.isInRoom) {
    return 'Start Game disabled because you need to create or join a room first.';
  }
  if (!options.isHost) {
    return 'Start Game disabled because only the host can start the room.';
  }
  if (options.startHandshakeActive) {
    return 'Start Game disabled because the start handshake is already syncing.';
  }
  if (options.connectedPlayers < options.minimumPlayers) {
    return `Start Game disabled because ${options.minimumPlayers} players are required.`;
  }
  if (options.missingDeckPlayers.length > 0) {
    return `Start Game disabled because ${options.missingDeckPlayers.join(', ')} need valid decks.`;
  }
  if (options.waitingForConnections) {
    return `Start Game disabled because player connections are still syncing${options.syncWaitSeconds ? ` (${options.syncWaitSeconds}s)` : ''}.`;
  }
  return 'Start Game disabled until the table is ready.';
}

export function getReadyDisabledReason(options: {
  isSpectator?: boolean;
  deckStatus: MultiplayerDeckStatus;
}): string | null {
  if (options.isSpectator) {
    return 'Ready disabled because spectators do not submit decks.';
  }
  if (options.deckStatus !== 'valid') {
    return 'Ready disabled because no valid deck is selected.';
  }
  return null;
}

export const MULTIPLAYER_ADVANCED_LABEL = 'Advanced connection details';
