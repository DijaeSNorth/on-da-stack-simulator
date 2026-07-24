export interface PriorityPlayer {
  playerId: string;
  eliminated?: boolean;
}

export type PriorityWindowStatus = "open" | "pending_resolution" | "complete";

export interface PriorityState {
  activePlayerId: string;
  turnOrder: string[];
  priorityOrder: string[];
  currentPlayerId?: string;
  passedPlayerIds: string[];
  stackDepth: number;
  status: PriorityWindowStatus;
  priorityCycle: number;
  lastAction?: string;
  warnings: string[];
}

export interface PriorityTrigger {
  triggerId: string;
  controllerId: string;
  sourceId?: string;
  description?: string;
  createdAt?: number;
  mandatory?: boolean;
}

export const normalizePriorityPlayers = (players: Array<string | PriorityPlayer>): string[] =>
  players
    .map((player) => (typeof player === "string" ? player : player.eliminated ? undefined : player.playerId))
    .filter((playerId): playerId is string => Boolean(playerId));

export const getApnapOrder = (turnOrder: string[], activePlayerId: string): string[] => {
  const activeIndex = turnOrder.indexOf(activePlayerId);

  if (activeIndex < 0) {
    return [...turnOrder];
  }

  return [
    ...turnOrder.slice(activeIndex),
    ...turnOrder.slice(0, activeIndex),
  ];
};

export const createPriorityState = (
  players: Array<string | PriorityPlayer>,
  activePlayerId: string,
  stackDepth = 0,
): PriorityState => {
  const turnOrder = normalizePriorityPlayers(players);
  const priorityOrder = getApnapOrder(turnOrder, activePlayerId);

  return {
    activePlayerId,
    turnOrder,
    priorityOrder,
    currentPlayerId: priorityOrder[0],
    passedPlayerIds: [],
    stackDepth,
    status: priorityOrder.length > 0 ? "open" : "complete",
    priorityCycle: 0,
    warnings: turnOrder.includes(activePlayerId)
      ? []
      : [`Active player ${activePlayerId} is not in turn order.`],
  };
};

export const getNextPriorityPlayer = (
  state: PriorityState,
  fromPlayerId = state.currentPlayerId,
): string | undefined => {
  if (!fromPlayerId || state.priorityOrder.length === 0) {
    return undefined;
  }

  const currentIndex = state.priorityOrder.indexOf(fromPlayerId);

  if (currentIndex < 0) {
    return state.priorityOrder[0];
  }

  for (let offset = 1; offset <= state.priorityOrder.length; offset += 1) {
    const nextPlayerId = state.priorityOrder[(currentIndex + offset) % state.priorityOrder.length];

    if (!state.passedPlayerIds.includes(nextPlayerId)) {
      return nextPlayerId;
    }
  }

  return undefined;
};

export const haveAllPlayersPassed = (state: PriorityState): boolean =>
  state.priorityOrder.length > 0
  && state.priorityOrder.every((playerId) => state.passedPlayerIds.includes(playerId));

export const passPriority = (state: PriorityState, playerId: string): PriorityState => {
  if (state.status !== "open") {
    return {
      ...state,
      warnings: [...state.warnings, "Priority is not currently open."],
    };
  }

  if (state.currentPlayerId !== playerId) {
    return {
      ...state,
      warnings: [...state.warnings, `${playerId} cannot pass priority while ${state.currentPlayerId ?? "no one"} has priority.`],
    };
  }

  const passedPlayerIds = state.passedPlayerIds.includes(playerId)
    ? state.passedPlayerIds
    : [...state.passedPlayerIds, playerId];
  const nextState = {
    ...state,
    passedPlayerIds,
    lastAction: `${playerId} passed priority`,
  };

  if (haveAllPlayersPassed(nextState)) {
    return {
      ...nextState,
      currentPlayerId: undefined,
      status: state.stackDepth > 0 ? "pending_resolution" : "complete",
    };
  }

  return {
    ...nextState,
    currentPlayerId: getNextPriorityPlayer(nextState, playerId),
  };
};

export const takePriorityAction = (
  state: PriorityState,
  playerId: string,
  description: string,
  stackDepth = state.stackDepth,
): PriorityState => {
  if (state.status !== "open") {
    return {
      ...state,
      warnings: [...state.warnings, "Priority action attempted while priority is not open."],
    };
  }

  if (state.currentPlayerId !== playerId) {
    return {
      ...state,
      warnings: [...state.warnings, `${playerId} cannot act while ${state.currentPlayerId ?? "no one"} has priority.`],
    };
  }

  return {
    ...state,
    stackDepth,
    passedPlayerIds: [],
    currentPlayerId: playerId,
    priorityCycle: state.priorityCycle + 1,
    lastAction: description,
  };
};

export const reopenPriorityAfterResolution = (
  state: PriorityState,
  stackDepth = Math.max(0, state.stackDepth - 1),
): PriorityState => ({
  ...state,
  stackDepth,
  passedPlayerIds: [],
  currentPlayerId: state.priorityOrder[0],
  status: state.priorityOrder.length > 0 ? "open" : "complete",
  priorityCycle: state.priorityCycle + 1,
  lastAction: "Priority reopened after resolution",
});

export const orderTriggeredAbilitiesApnap = (
  activePlayerId: string,
  turnOrder: string[],
  triggers: PriorityTrigger[],
): PriorityTrigger[] => {
  const apnapOrder = getApnapOrder(turnOrder, activePlayerId);
  const playerOrder = new Map(apnapOrder.map((playerId, index) => [playerId, index]));

  return [...triggers].sort((left, right) => {
    const leftPlayerOrder = playerOrder.get(left.controllerId) ?? Number.MAX_SAFE_INTEGER;
    const rightPlayerOrder = playerOrder.get(right.controllerId) ?? Number.MAX_SAFE_INTEGER;

    if (leftPlayerOrder !== rightPlayerOrder) {
      return leftPlayerOrder - rightPlayerOrder;
    }

    return (left.createdAt ?? 0) - (right.createdAt ?? 0);
  });
};
