/**
 * Commander UI visibility checks.
 *
 * Run with: npx tsx tests/commander-ui.test.ts
 */

import assert from 'node:assert/strict';
import { buildCommanderRosterItems } from '../client/src/components/commander/CommanderQuickCastPanel';
import { canControlPlayer } from '../client/src/engine/playerPermissions';
import { createCardState, createDefaultGameConfig, createEmptyGameState, createPlayer } from '../client/src/engine/gameEngine';
import { useGameStore } from '../client/src/store/gameStore';
import type { CardDefinition } from '../client/src/types/game';

const commanderDef: CardDefinition = {
  id: 'commander-ui-primary',
  name: 'Visible Commander',
  manaCost: { raw: '{2}{G}{U}', cmc: 4, generic: 2, G: 1, U: 1 },
  cmc: 4,
  typeLine: 'Legendary Creature - Test Commander',
  superTypes: ['Legendary'],
  cardTypes: ['Creature'],
  subTypes: ['Test', 'Commander'],
  oracleText: 'Ward 2',
  colors: ['G', 'U'],
  colorIdentity: ['G', 'U'],
  keywords: ['Ward'],
  legalities: { commander: 'legal' },
  power: '3',
  toughness: '4',
  isDoubleFaced: false,
};

const partnerDef: CardDefinition = {
  ...commanderDef,
  id: 'commander-ui-partner',
  name: 'Visible Partner',
  manaCost: { raw: '{1}{R}', cmc: 2, generic: 1, R: 1 },
  colors: ['R'],
  colorIdentity: ['R'],
  oracleText: 'Partner',
  keywords: ['Partner'],
};

function loadCommanderUiFixture(localPlayerId = 'p1'): { commanderId: string; partnerId: string } {
  const config = createDefaultGameConfig(2);
  const base = createEmptyGameState(config);
  const p1 = createPlayer('p1', 'Player 1', 0, '#3b82f6', config);
  const p2 = createPlayer('p2', 'Player 2', 1, '#ef4444', config);
  const commander = createCardState(commanderDef, 'p1', 'command', true);
  const partner = createCardState(partnerDef, 'p1', 'command', true);

  useGameStore.setState(state => ({
    ...state,
    localPlayerId,
    game: {
      ...base,
      status: 'playing',
      activePlayerId: 'p1',
      priorityPlayerId: 'p1',
      phase: 'main1',
      players: [
        { ...p1, commanders: [commander.instanceId, partner.instanceId], commandZone: [commander.instanceId, partner.instanceId] },
        p2,
      ],
      cards: {
        [commander.instanceId]: commander,
        [partner.instanceId]: partner,
      },
      definitions: {
        [commander.definitionId]: commander.definition,
        [partner.definitionId]: partner.definition,
      },
    },
    multiplayer: { ...state.multiplayer, status: 'disconnected', isSpectator: false },
    ui: { ...state.ui, judgeMode: false, screen: 'game' },
  }));

  return { commanderId: commander.instanceId, partnerId: partner.instanceId };
}

const { commanderId, partnerId } = loadCommanderUiFixture('p1');
const ownerState = useGameStore.getState();
const ownerRoster = buildCommanderRosterItems(ownerState.game, 'p1');

assert(ownerRoster.length === 2, 'expected both commanders in the always-visible roster');
assert(ownerRoster.some(item => item.commander.instanceId === commanderId), 'expected primary commander roster item');
assert(ownerRoster.some(item => item.commander.instanceId === partnerId), 'expected partner commander roster item');
assert(ownerRoster.every(item => item.inCommandZone), 'expected loaded commanders to show command-zone ready state');
assert(ownerRoster.some(item => item.commander.definition.name === 'Visible Commander'), 'expected commander name to remain visible');
assert(ownerRoster.some(item => item.commander.definition.name === 'Visible Partner'), 'expected partner name to remain visible');
assert(ownerRoster.every(item => item.totalCost.length > 0), 'expected each visible commander to include cast cost');
assert(
  canControlPlayer(ownerState.localPlayerId, 'p1', ownerState.multiplayer.status, ownerState.ui.judgeMode),
  'expected owner to control commander cast buttons',
);
assert(ownerRoster.every(item => item.castCount === 0), 'expected compact roster to track cast count without extra visible clutter');

loadCommanderUiFixture('p2');
const opponentState = useGameStore.getState();
const opponentRoster = buildCommanderRosterItems(opponentState.game, 'p1');
assert(opponentRoster.length === 2, 'expected opponents to preview all loaded commanders');
assert(
  !canControlPlayer(opponentState.localPlayerId, 'p1', opponentState.multiplayer.status, opponentState.ui.judgeMode),
  'expected opponent commander roster controls to be view-only',
);

console.log('commander-ui tests passed');
