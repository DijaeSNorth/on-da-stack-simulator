import { useGameStore } from '../../store/gameStore';
import type { ActionRecord } from '../../types/game';
import type { SoloDeckLabStartOptions } from './SoloDeckLab';
import { SoloPerformancePanel } from './SoloPerformancePanel';

interface SoloGoldfishPanelProps {
  startOptions?: SoloDeckLabStartOptions;
}

export function SoloGoldfishPanel({ startOptions }: SoloGoldfishPanelProps) {
  const store = useGameStore();
  const activeDeck = store.soloDeckLab.draftDeck
    ?? store.decks.find(deck => deck.id === store.soloDeckLab.activeDeckId);
  const player = store.game.players.find(p => p.id === (store.localPlayerId || store.game.players[0]?.id)) ?? store.game.players[0];
  const inGoldfishGame = store.game.status === 'playing' && store.game.config.playerCount === 1 && Boolean(player);
  const keptHandAvailable = Boolean(store.soloDeckLab.testSession?.currentHand?.length);
  const summary = player ? getGoldfishSummary(store.game.actionLog, store.game.turn, player) : null;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={panelStyle}>
        <div style={titleStyle}>Goldfish playtest</div>
        <div style={{ color: '#94a3b8', fontSize: 11 }}>
          Start a one-player table with the selected deck. Use the normal hand and battlefield for lands, casts, manual moves, and combat testing.
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button
            type="button"
            data-testid="solo-start-goldfish"
            onClick={() => void store.startSoloGoldfishGame(startOptions)}
            disabled={!activeDeck}
            style={buttonStyle(activeDeck ? '#14532d' : '#1e293b', activeDeck ? '#dcfce7' : '#64748b')}
          >
            Start Test
          </button>
          <button
            type="button"
            data-testid="solo-start-random-hand"
            onClick={() => void store.startSoloGoldfishGame({ ...startOptions, randomOpeningHand: true })}
            disabled={!activeDeck}
            style={buttonStyle(activeDeck ? '#083344' : '#1e293b', activeDeck ? '#cffafe' : '#64748b')}
          >
            Start Random Hand
          </button>
          <button
            type="button"
            data-testid="solo-start-kept-hand"
            onClick={() => void store.startSoloGoldfishGame({ ...startOptions, fromKeptHand: true })}
            disabled={!keptHandAvailable}
            style={buttonStyle(keptHandAvailable ? '#4c1d95' : '#1e293b', keptHandAvailable ? '#ddd6fe' : '#64748b')}
          >
            Start Kept Hand
          </button>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={titleStyle}>Controls</div>
            <div style={{ color: '#64748b', fontSize: 10 }}>
              {inGoldfishGame ? `Testing ${activeDeck?.name ?? 'solo deck'}` : 'Start a test to enable controls.'}
            </div>
          </div>
          <div style={{ color: '#86efac', fontSize: 10, fontWeight: 900 }}>
            No opponent required
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button type="button" data-testid="solo-goldfish-draw" onClick={() => player && store.drawCard(player.id, 1)} disabled={!inGoldfishGame} style={controlButtonStyle(inGoldfishGame)}>
            Draw
          </button>
          <button type="button" data-testid="solo-goldfish-next-phase" onClick={() => store.advancePhase()} disabled={!inGoldfishGame} style={controlButtonStyle(inGoldfishGame)}>
            Next Phase
          </button>
          <button type="button" data-testid="solo-goldfish-next-turn" onClick={() => store.advanceTurn()} disabled={!inGoldfishGame} style={controlButtonStyle(inGoldfishGame)}>
            Next Turn
          </button>
          <button type="button" data-testid="solo-goldfish-reset" onClick={() => void store.resetSoloGoldfishGame(startOptions)} disabled={!activeDeck} style={buttonStyle(activeDeck ? '#332511' : '#1e293b', activeDeck ? '#fde68a' : '#64748b')}>
            Reset
          </button>
          <button type="button" data-testid="solo-goldfish-undo" onClick={() => store.undo()} disabled={!inGoldfishGame || store.game.actionLog.length === 0} style={controlButtonStyle(inGoldfishGame && store.game.actionLog.length > 0)}>
            Undo
          </button>
          <button type="button" data-testid="solo-goldfish-export-replay" onClick={() => store.saveReplay('Solo Goldfish Playtest')} disabled={!inGoldfishGame} style={controlButtonStyle(inGoldfishGame)}>
            Export Replay
          </button>
        </div>
      </div>

      {summary && (
        <div style={summaryGridStyle}>
          <Summary label="Turn" value={summary.turn} />
          <Summary label="Lands played" value={summary.landsPlayed} />
          <Summary label="Hand" value={summary.handCount} />
          <Summary label="Battlefield" value={summary.battlefieldCount} />
          <Summary label="Graveyard" value={summary.graveyardCount} />
          <Summary label="Exile" value={summary.exileCount} />
        </div>
      )}

      <div style={panelStyle}>
        <div style={titleStyle}>Manual play reminders</div>
        <div style={{ color: '#94a3b8', fontSize: 11 }}>
          Play lands from the visible hand, cast or move cards with existing card actions, advance phases/turns here, and add practice dummies from the in-game solo panel for combat testing.
        </div>
      </div>

      {inGoldfishGame && <SoloPerformancePanel sessionType="goldfish" />}
    </div>
  );
}

function getGoldfishSummary(actionLog: ActionRecord[], turn: number, player: {
  id: string;
  hand: string[];
  battlefield: string[];
  graveyard: string[];
  exile: string[];
}) {
  const landsPlayed = actionLog.filter(action =>
    action.turn === turn &&
    action.playerId === player.id &&
    action.actionType === 'MOVE_CARD' &&
    action.description.toLowerCase().includes('played as land') &&
    !action.undone
  ).length;
  return {
    turn,
    landsPlayed,
    handCount: player.hand.length,
    battlefieldCount: player.battlefield.length,
    graveyardCount: player.graveyard.length,
    exileCount: player.exile.length,
  };
}

function Summary({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={summaryStyle}>
      <div style={{ color: '#64748b', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#f8fafc', fontSize: 17, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: 10,
};

const titleStyle: React.CSSProperties = {
  color: '#e2e8f0',
  fontSize: 11,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
  gap: 7,
};

const summaryStyle: React.CSSProperties = {
  background: '#0b0f12',
  border: '1px solid #26323a',
  borderRadius: 7,
  padding: 8,
};

function controlButtonStyle(enabled: boolean): React.CSSProperties {
  return buttonStyle(enabled ? '#1e3a5f' : '#1e293b', enabled ? '#bfdbfe' : '#64748b');
}

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    background,
    color,
    border: `1px solid ${color}44`,
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 10,
    fontWeight: 900,
    cursor: color === '#64748b' ? 'not-allowed' : 'pointer',
    textTransform: 'uppercase',
  };
}
