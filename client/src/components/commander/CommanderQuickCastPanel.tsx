import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { CardState, GameState } from '../../types/game';
import {
  canMoveCommanderToCommandZone,
  getCommanderCastCount,
  getCommanderCastSuggestions,
  getCommanderTax,
  getCommanderTotalCost,
  getPlayerCommanders,
} from '../../engine/commanderCasting';
import { canControlPlayer } from '../../engine/playerPermissions';
import { CardImage } from '../cards/CardImage';
import { CommanderCastButton } from './CommanderCastButton';

interface CommanderQuickCastPanelProps {
  playerId: string;
  compact?: boolean;
  showSuggestions?: boolean;
}

export interface CommanderRosterItem {
  commander: CardState;
  tax: number;
  castCount: number;
  totalCost: string;
  inCommandZone: boolean;
}

export function buildCommanderRosterItems(game: GameState, playerId: string): CommanderRosterItem[] {
  return getPlayerCommanders(game, playerId).map(commander => {
    const tax = getCommanderTax(game, playerId, commander.instanceId);
    return {
      commander,
      tax,
      castCount: getCommanderCastCount(game, playerId, commander.instanceId),
      totalCost: getCommanderTotalCost(commander, tax),
      inCommandZone: commander.zone === 'command',
    };
  });
}

export function CommanderQuickCastPanel({ playerId, compact, showSuggestions = true }: CommanderQuickCastPanelProps) {
  const store = useGameStore();
  const { game, localPlayerId, ui, multiplayer } = store;
  const player = game.players.find(item => item.id === playerId);
  const rosterItems = useMemo(() => buildCommanderRosterItems(game, playerId), [game, playerId]);
  const commanders = rosterItems.map(item => item.commander);
  const multiplayerStatus = multiplayer.isSpectator ? 'spectator' : multiplayer.status;
  const canControl = canControlPlayer(localPlayerId, playerId, multiplayerStatus, ui.judgeMode);
  const suggestions = useMemo(() => getCommanderCastSuggestions(game, playerId).slice(0, compact ? 1 : 2), [compact, game, playerId]);

  if (!player || commanders.length === 0) return null;

  function moveToCommand(commander: CardState) {
    store.moveCommanderToCommandZone(playerId, commander.instanceId, commander.zone);
  }

  return (
    <section
      data-testid={`commander-quick-cast-${playerId}`}
      style={{
        border: '1px solid rgba(146,64,14,0.48)',
        background: compact ? 'rgba(15,23,42,0.72)' : 'linear-gradient(135deg, rgba(120,53,15,0.24), rgba(15,23,42,0.86))',
        borderRadius: 8,
        padding: compact ? 6 : 8,
        display: 'grid',
        gap: compact ? 4 : 7,
        minWidth: compact ? 132 : 220,
        maxWidth: compact ? '100%' : 360,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={{ color: '#fbbf24', fontSize: compact ? 8 : 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Commanders
        </span>
        <span style={{ color: '#64748b', fontSize: compact ? 8 : 9 }}>{commanders.length} visible</span>
      </div>

      {showSuggestions && suggestions.length > 0 ? (
        <div style={{ display: 'grid', gap: 3 }}>
          {suggestions.map(suggestion => (
            <div
              key={`${suggestion.action}-${suggestion.commanderInstanceId}`}
              data-testid={`commander-suggestion-${suggestion.commanderInstanceId}`}
              style={{ color: '#fde68a', fontSize: compact ? 8 : 10, lineHeight: 1.25 }}
            >
              {suggestion.message}
            </div>
          ))}
        </div>
      ) : null}

      {rosterItems.map(({ commander, tax, castCount, totalCost, inCommandZone }) => {
        const canMove = canControl && canMoveCommanderToCommandZone(game, playerId, commander.instanceId);
        return (
          <div
            key={commander.instanceId}
            data-testid={`commander-roster-card-${commander.instanceId}`}
            style={{
              display: 'grid',
              gridTemplateColumns: compact ? '34px minmax(0, 1fr)' : '52px minmax(0, 1fr)',
              gap: compact ? 6 : 8,
              alignItems: 'center',
              padding: compact ? 5 : 7,
              borderRadius: 7,
              border: `1px solid ${inCommandZone ? 'rgba(251,191,36,0.48)' : 'rgba(71,85,105,0.5)'}`,
              background: inCommandZone ? 'rgba(120,53,15,0.2)' : 'rgba(15,23,42,0.58)',
            }}
          >
            <div
              data-testid={`commander-preview-card-${commander.instanceId}`}
              title={`${commander.definition.name} - ${commander.zone === 'command' ? 'command zone' : commander.zone}`}
              style={{
                width: compact ? 32 : 48,
                transform: inCommandZone ? 'rotate(-2deg)' : 'none',
                filter: inCommandZone ? 'drop-shadow(0 0 8px rgba(251,191,36,0.35))' : 'grayscale(0.12)',
              }}
            >
              <CardImage card={commander} size={compact ? 'tiny' : 'compact'} />
            </div>

            <div style={{ display: 'grid', gap: compact ? 3 : 5, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center', minWidth: 0 }}>
                <span style={{ color: '#f8fafc', fontSize: compact ? 9 : 11, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {commander.definition.name}
                </span>
                <span
                  data-testid={`commander-zone-status-${commander.instanceId}`}
                  style={{
                    color: inCommandZone ? '#fde68a' : '#94a3b8',
                    background: inCommandZone ? 'rgba(180,83,9,0.28)' : 'rgba(51,65,85,0.5)',
                    border: `1px solid ${inCommandZone ? 'rgba(251,191,36,0.35)' : 'rgba(100,116,139,0.35)'}`,
                    borderRadius: 999,
                    padding: '1px 5px',
                    fontSize: compact ? 7 : 8,
                    fontWeight: 900,
                    flexShrink: 0,
                    textTransform: 'uppercase',
                  }}
                >
                  {inCommandZone ? 'Ready' : commander.zone}
                </span>
              </div>

              <div style={{ color: '#94a3b8', fontSize: compact ? 8 : 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {compact ? `${totalCost}${tax > 0 ? ` +${tax} tax` : ''}` : `${totalCost} | tax +${tax} | cast ${castCount}x`}
              </div>

              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {canControl ? (
                  <CommanderCastButton
                    game={game}
                    playerId={playerId}
                    commander={commander}
                    canControl={canControl}
                    judgeMode={ui.judgeMode}
                    compact={compact}
                    minimal={compact}
                    showDisabledReason={!compact}
                    onCast={() => store.castCommanderFromCommandZone(playerId, commander.instanceId)}
                  />
                ) : (
                  <span
                    title="Commander preview is public. Only that player can cast it."
                    style={{
                      border: '1px solid rgba(100,116,139,0.35)',
                      background: 'rgba(15,23,42,0.52)',
                      color: '#94a3b8',
                      borderRadius: 999,
                      padding: compact ? '2px 6px' : '4px 8px',
                      fontSize: compact ? 7 : 9,
                      fontWeight: 900,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    View only
                  </span>
                )}
                {canMove ? (
                  <button
                    type="button"
                    data-testid={`move-commander-command-${commander.instanceId}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      moveToCommand(commander);
                    }}
                    style={{
                      border: '1px solid #0e7490',
                      background: 'rgba(14,116,144,0.24)',
                      color: '#a5f3fc',
                      borderRadius: 6,
                      padding: compact ? '3px 6px' : '6px 8px',
                      fontSize: compact ? 8 : 10,
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    Move to Command
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
