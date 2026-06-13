import type { GameState } from '../types/game';

export interface MechanicHandlerContext {
  game: GameState;
  controllerId?: string;
  sourceInstanceId?: string;
  targetInstanceIds?: string[];
  parameters?: Record<string, unknown>;
}

export interface MechanicHandlerResult {
  game: GameState;
  prompts: string[];
  handled: boolean;
}

export type MechanicEngineHandler = (context: MechanicHandlerContext) => MechanicHandlerResult;

function promptOnly(prompt: string): MechanicEngineHandler {
  return context => ({
    game: context.game,
    prompts: [prompt],
    handled: false,
  });
}

export const engineHandlers: Record<string, MechanicEngineHandler> = {
  'firebending.attackMana.v1': promptOnly('Firebending: add the attack-generated red mana manually until the full attack trigger is automated.'),
  'airbend.exileCastForTwo.v1': promptOnly('Airbend: exile/return flow requires a manual prompt until object-specific return tracking is implemented.'),
  'waterbend.costPayment.v1': promptOnly('Waterbend: payment may involve tapping lands, creatures, or artifacts; use manual payment confirmation.'),
  'earthbend.animateLand.v1': promptOnly('Earthbend: animate the chosen land manually until temporary land-creature effects are modeled.'),
  'clue.activatedDraw.v1': promptOnly('Clue: pay 2, sacrifice this artifact, then draw a card.'),
  'exhaust.oncePerObject.v1': promptOnly('Exhaust: mark this object as having used its exhaust ability this game.'),
  'sneak.alternativeCost.v1': promptOnly('Sneak: cast for its alternative cost and apply the delayed return/sacrifice instruction manually.'),
  'warp.alternativeCost.v1': promptOnly('Warp: cast for the alternative cost and track the delayed exile/return instruction manually.'),
  'station.chargeCounters.v1': promptOnly('Station: tap creatures to add charge counters, then check the station threshold manually.'),
  'connive.drawDiscardCounter.v1': promptOnly('Connive: draw, discard, then add a +1/+1 counter if a nonland card was discarded.'),
};

export function getEngineHandler(handlerId: string | undefined): MechanicEngineHandler | undefined {
  if (!handlerId) return undefined;
  return engineHandlers[handlerId];
}

export function canExecuteHandler(handlerId: string | undefined): boolean {
  return Boolean(getEngineHandler(handlerId));
}
