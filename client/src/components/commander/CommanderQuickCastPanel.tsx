import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { CardState } from '../../types/game';
import {
  canMoveCommanderToCommandZone,
  getCommanderCastSuggestions,
  getPlayerCommanders,
} from '../../engine/commanderCasting';
import { canControlPlayer } from '../../engine/playerPermissions';
import { CommanderCastButton } from './CommanderCastButton';

interface CommanderQuickCastPanelProps {
  playerId: string;
  compact?: boolean;
  showSuggestions?: boolean;
}

export function CommanderQuickCastPanel({ playerId, compact, showSuggestions = true }: CommanderQuickCastPanelProps) {
  const store = useGameStore();
  const { game, localPlayerId, ui, multiplayer } = store;
  const player = game.players.find(item => item.id === playerId);
  const commanders = getPlayerCommanders(game, playerId);
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
        minWidth: compact ? 140 : 220,
      }}
    >
      {!compact ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span style={{ color: '#fbbf24', fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Command Zone
          </span>
          <span style={{ color: '#64748b', fontSize: 9 }}>{commanders.length} commander{commanders.length === 1 ? '' : 's'}</span>
        </div>
      ) : null}

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

      {commanders.map(commander => {
        const canMove = canControl && canMoveCommanderToCommandZone(game, playerId, commander.instanceId);
        return (
          <div key={commander.instanceId} style={{ display: 'grid', gap: 5 }}>
            <div style={{ color: '#f8fafc', fontSize: compact ? 9 : 11, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {commander.definition.name}
            </div>
            <div style={{ color: '#94a3b8', fontSize: compact ? 8 : 10 }}>
              Zone: {commander.zone === 'command' ? 'command zone' : commander.zone}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <CommanderCastButton
                game={game}
                playerId={playerId}
                commander={commander}
                canControl={canControl}
                judgeMode={ui.judgeMode}
                compact={compact}
                onCast={() => store.castCommanderFromCommandZone(playerId, commander.instanceId)}
              />
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
                  Move Commander to Command Zone
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
