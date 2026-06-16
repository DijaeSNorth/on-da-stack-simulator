import assert from 'node:assert/strict';
import {
  MULTIPLAYER_ADVANCED_LABEL,
  TOP_LEVEL_NAV_ITEMS,
  getDeckLabNextStep,
  getPlayOnlineNextStep,
  getReadyDisabledReason,
  getReplayViewerNextStep,
  getStartGameDisabledReason,
} from '../client/src/components/navigation/navigationFlowModel';

assert.deepEqual(
  TOP_LEVEL_NAV_ITEMS.slice(0, 3).map((item) => item.label),
  ['Deck Lab', 'Play Online', 'Replay Viewer'],
);

assert.equal(getDeckLabNextStep({ hasDeck: false }).label, 'Import or create a deck');

assert.equal(getPlayOnlineNextStep({ connected: true, deckStatus: 'none' }).label, 'Choose Deck');

assert.equal(getPlayOnlineNextStep({ connected: true, deckStatus: 'valid', localReady: false }).label, 'Mark Ready');

assert.equal(getReplayViewerNextStep({ hasReplay: false }).label, 'Load a replay file');

assert.match(
  getStartGameDisabledReason({
    isInRoom: true,
    isHost: true,
    connectedPlayers: 2,
    minimumPlayers: 4,
    missingDeckPlayers: [],
  }),
  /Start Game disabled because 4 players are required/,
);

assert.equal(
  getReadyDisabledReason({ deckStatus: 'none' }),
  'Ready disabled because no valid deck is selected.',
);

assert.equal(MULTIPLAYER_ADVANCED_LABEL, 'Advanced connection details');

console.log('navigation-flow tests passed');
