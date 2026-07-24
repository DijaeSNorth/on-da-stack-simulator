export type RulesEventName = keyof RulesEventPayloadMap;

export interface RulesEventPayloadMap {
  "turn.started": TurnStartedPayload;
  "turn.ended": TurnEndedPayload;
  "phase.changed": PhaseChangedPayload;
  "zone.changed": ZoneChangedPayload;
  "spell.cast": SpellCastPayload;
  "spell.resolved": SpellResolvedPayload;
  "permanent.entered": PermanentEnteredPayload;
  "permanent.left": PermanentLeftPayload;
  "combat.attacker.declared": CombatAttackerDeclaredPayload;
  "combat.blocker.declared": CombatBlockerDeclaredPayload;
  "combat.damage.previewed": CombatDamagePreviewedPayload;
  "combat.damage.confirmed": CombatDamageConfirmedPayload;
  "damage.dealt": DamageDealtPayload;
  "counter.added": CounterChangedPayload;
  "counter.removed": CounterChangedPayload;
  "mana.added": ManaChangedPayload;
  "cost.paid": CostPaidPayload;
  "mechanic.used": MechanicUsedPayload;
  "state.cleanup": StateCleanupPayload;
  "manual.adjustment": ManualAdjustmentPayload;
}

export interface RulesEventMetadata {
  source?: string;
  sourceInstanceId?: string;
  handlerId?: string;
  mechanicId?: string;
  correlationId?: string;
  automationLevel?: string;
  tags?: string[];
}

export interface RulesEventBase<TType extends RulesEventName, TPayload> {
  eventId: string;
  type: TType;
  payload: TPayload;
  timestamp: number;
  gameId?: string;
  actorId?: string;
  turn?: number;
  phase?: string;
  metadata?: RulesEventMetadata;
}

export type RulesEvent<TType extends RulesEventName = RulesEventName> = {
  [K in RulesEventName]: RulesEventBase<K, RulesEventPayloadMap[K]>;
}[TType];

export interface RulesEventInput<TType extends RulesEventName> {
  type: TType;
  payload: RulesEventPayloadMap[TType];
  eventId?: string;
  timestamp?: number;
  gameId?: string;
  actorId?: string;
  turn?: number;
  phase?: string;
  metadata?: RulesEventMetadata;
}

export interface TurnStartedPayload {
  playerId: string;
  turnNumber: number;
}

export interface TurnEndedPayload {
  playerId: string;
  turnNumber: number;
}

export interface PhaseChangedPayload {
  fromPhase?: string;
  toPhase: string;
  activePlayerId?: string;
}

export interface ZoneChangedPayload {
  cardId: string;
  fromZone?: string;
  toZone: string;
  ownerId?: string;
  controllerId?: string;
  reason?: string;
  replacementApplied?: string;
}

export interface SpellCastPayload {
  cardId: string;
  playerId: string;
  castFromZone: string;
  alternativeCost?: string;
  mechanicId?: string;
  targets?: string[];
}

export interface SpellResolvedPayload {
  cardId: string;
  playerId: string;
  destinationZone?: string;
}

export interface PermanentEnteredPayload {
  cardId: string;
  controllerId: string;
  fromZone?: string;
  tapped?: boolean;
  attacking?: boolean;
}

export interface PermanentLeftPayload {
  cardId: string;
  controllerId?: string;
  fromZone: string;
  toZone: string;
}

export interface CombatAttackerDeclaredPayload {
  attackerIds: string[];
  controllerId: string;
  attackTarget: unknown;
  assignmentId?: string;
}

export interface CombatBlockerDeclaredPayload {
  blockerIds: string[];
  blockerControllerId: string;
  blockedAttackAssignmentId?: string;
  blockedAttackerIds?: string[];
}

export interface CombatDamagePreviewedPayload {
  previewId: string;
  attackingPlayerId?: string;
  warnings?: string[];
}

export interface CombatDamageConfirmedPayload {
  previewId?: string;
  attackingPlayerId?: string;
}

export interface DamageDealtPayload {
  sourceId?: string;
  targetId: string;
  targetType: "player" | "planeswalker" | "battle" | "creature" | "permanent";
  amount: number;
  combatDamage?: boolean;
  commanderDamage?: boolean;
}

export interface CounterChangedPayload {
  cardId: string;
  counterType: string;
  amount: number;
  playerId?: string;
  reason?: string;
}

export interface ManaChangedPayload {
  playerId: string;
  color: "W" | "U" | "B" | "R" | "G" | "C" | "generic";
  amount: number;
  temporary?: boolean;
  expires?: "step" | "phase" | "turn" | "combat" | "manual";
}

export interface CostPaidPayload {
  playerId: string;
  sourceId?: string;
  cost: string;
  paidWith?: string[];
  mechanicId?: string;
}

export interface MechanicUsedPayload {
  mechanicId: string;
  playerId?: string;
  sourceInstanceId?: string;
  targetIds?: string[];
  amount?: number;
}

export interface StateCleanupPayload {
  cleanupType: "state_based_actions" | "end_of_combat" | "end_of_turn" | "manual";
  affectedCardIds?: string[];
  notes?: string[];
}

export interface ManualAdjustmentPayload {
  adjustmentType: string;
  targetIds: string[];
  playerId?: string;
  reason?: string;
}

export interface RulesEventContext<TGame = unknown> {
  game?: TGame;
  emit: <TType extends RulesEventName>(event: RulesEventInput<TType>) => RulesEvent<TType>;
  getHistory: () => readonly RulesEvent[];
}

export type RulesEventListenerResult = void | RulesEventInput<RulesEventName>[];
export type RulesEventListener<TType extends RulesEventName = RulesEventName> = (
  event: RulesEvent<TType>,
  context: RulesEventContext,
) => RulesEventListenerResult;

export interface RulesEventDispatchFailure {
  eventId: string;
  eventType: RulesEventName;
  listenerId: string;
  message: string;
}

export interface RulesEventBusOptions {
  eventIdFactory?: () => string;
  now?: () => number;
  historyLimit?: number;
  onError?: (failure: RulesEventDispatchFailure, error: unknown) => void;
}

interface StoredRulesEventListener {
  id: string;
  type: RulesEventName | "*";
  once: boolean;
  listener: RulesEventListener;
}

export interface RulesEventBus<TGame = unknown> {
  emit: <TType extends RulesEventName>(event: RulesEventInput<TType>) => RulesEvent<TType>;
  on: <TType extends RulesEventName>(
    type: TType,
    listener: RulesEventListener<TType>,
  ) => () => void;
  onAny: (listener: RulesEventListener) => () => void;
  once: <TType extends RulesEventName>(
    type: TType,
    listener: RulesEventListener<TType>,
  ) => () => void;
  clear: () => void;
  getHistory: () => readonly RulesEvent[];
  getFailures: () => readonly RulesEventDispatchFailure[];
  setGame: (game?: TGame) => void;
}

export interface RulesAutomationResult {
  applied: boolean;
  ignored?: boolean;
  warnings?: string[];
  logEntries?: string[];
  emittedEvents?: RulesEventInput<RulesEventName>[];
  manualPrompt?: string;
}

export interface RulesAutomationContext<TGame = unknown> extends RulesEventContext<TGame> {
  handlerId: string;
}

export interface RulesAutomationHandler<TType extends RulesEventName = RulesEventName> {
  id: string;
  eventTypes: readonly TType[];
  description?: string;
  handle: (
    event: RulesEvent<TType>,
    context: RulesAutomationContext,
  ) => RulesAutomationResult;
}

export class RulesAutomationRegistry {
  private readonly handlers = new Map<string, RulesAutomationHandler>();

  register<TType extends RulesEventName>(handler: RulesAutomationHandler<TType>): void {
    if (this.handlers.has(handler.id)) {
      throw new Error(`Rules automation handler already registered: ${handler.id}`);
    }

    this.handlers.set(handler.id, handler as unknown as RulesAutomationHandler);
  }

  has(handlerId: string): boolean {
    return this.handlers.has(handlerId);
  }

  get(handlerId: string): RulesAutomationHandler | undefined {
    return this.handlers.get(handlerId);
  }

  unregister(handlerId: string): boolean {
    return this.handlers.delete(handlerId);
  }

  execute<TType extends RulesEventName>(
    handlerId: string,
    event: RulesEvent<TType>,
    context: RulesEventContext,
  ): RulesAutomationResult {
    const handler = this.handlers.get(handlerId);

    if (!handler) {
      return {
        applied: false,
        ignored: true,
        warnings: [`Unknown rules automation handler ignored: ${handlerId}`],
        manualPrompt: "This mechanic needs manual resolution.",
      };
    }

    if (!handler.eventTypes.includes(event.type)) {
      return {
        applied: false,
        ignored: true,
        warnings: [
          `Rules automation handler ${handlerId} does not handle event type ${event.type}.`,
        ],
        manualPrompt: "This mechanic needs manual resolution.",
      };
    }

    const result = handler.handle(event as never, {
      ...context,
      handlerId,
    });

    for (const emittedEvent of result.emittedEvents ?? []) {
      context.emit(emittedEvent);
    }

    return result;
  }

  executeAllForEvent<TType extends RulesEventName>(
    event: RulesEvent<TType>,
    context: RulesEventContext,
  ): RulesAutomationResult[] {
    const results: RulesAutomationResult[] = [];

    for (const handler of this.handlers.values()) {
      if (handler.eventTypes.includes(event.type)) {
        results.push(
          this.execute(handler.id, event, context),
        );
      }
    }

    return results;
  }
}

export const createRulesEventBus = <TGame = unknown>(
  options: RulesEventBusOptions = {},
): RulesEventBus<TGame> => {
  let game: TGame | undefined;
  let sequence = 0;
  const history: RulesEvent[] = [];
  const failures: RulesEventDispatchFailure[] = [];
  const listeners: StoredRulesEventListener[] = [];

  const nextEventId = () => options.eventIdFactory?.() ?? `rules-event-${++sequence}`;
  const now = () => options.now?.() ?? Date.now();

  const trimHistory = () => {
    if (options.historyLimit && history.length > options.historyLimit) {
      history.splice(0, history.length - options.historyLimit);
    }
  };

  const unsubscribe = (listenerId: string) => {
    const index = listeners.findIndex((listener) => listener.id === listenerId);

    if (index >= 0) {
      listeners.splice(index, 1);
    }
  };

  const getContext = (): RulesEventContext<TGame> => ({
    game,
    emit,
    getHistory: () => history,
  });

  const dispatch = (event: RulesEvent) => {
    const matchingListeners = listeners.filter(
      (listener) => listener.type === "*" || listener.type === event.type,
    );

    for (const storedListener of matchingListeners) {
      try {
        const emittedEvents = storedListener.listener(event, getContext());

        if (storedListener.once) {
          unsubscribe(storedListener.id);
        }

        for (const emittedEvent of emittedEvents ?? []) {
          emit(emittedEvent);
        }
      } catch (error) {
        const failure = {
          eventId: event.eventId,
          eventType: event.type,
          listenerId: storedListener.id,
          message: error instanceof Error ? error.message : String(error),
        };

        failures.push(failure);
        options.onError?.(failure, error);
      }
    }
  };

  function emit<TType extends RulesEventName>(input: RulesEventInput<TType>): RulesEvent<TType> {
    const event: RulesEvent<TType> = {
      ...input,
      eventId: input.eventId ?? nextEventId(),
      timestamp: input.timestamp ?? now(),
    } as RulesEvent<TType>;

    history.push(event);
    trimHistory();
    dispatch(event);

    return event;
  }

  const addListener = <TType extends RulesEventName>(
    type: TType | "*",
    listener: RulesEventListener<TType>,
    once = false,
  ) => {
    const listenerId = `rules-listener-${listeners.length + 1}-${Date.now()}`;
    listeners.push({
      id: listenerId,
      type,
      once,
      listener: listener as RulesEventListener,
    });

    return () => unsubscribe(listenerId);
  };

  return {
    emit,
    on: (type, listener) => addListener(type, listener),
    onAny: (listener) => addListener("*", listener),
    once: (type, listener) => addListener(type, listener, true),
    clear: () => {
      history.splice(0, history.length);
      failures.splice(0, failures.length);
      listeners.splice(0, listeners.length);
    },
    getHistory: () => history,
    getFailures: () => failures,
    setGame: (nextGame) => {
      game = nextGame;
    },
  };
};

export const createRulesAutomationRegistry = () => new RulesAutomationRegistry();
