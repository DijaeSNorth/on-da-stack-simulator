import type { CardState, GameState } from '../../types/game';
import {
  getCommanderCastCount,
  getCommanderCastDisabledReason,
  getCommanderTax,
  getCommanderTotalCost,
} from '../../engine/commanderCasting';

interface CommanderCastButtonProps {
  game: GameState;
  playerId: string;
  commander: CardState;
  canControl: boolean;
  judgeMode?: boolean;
  onCast: () => void;
  compact?: boolean;
}

export function CommanderCastButton({
  game,
  playerId,
  commander,
  canControl,
  judgeMode,
  onCast,
  compact,
}: CommanderCastButtonProps) {
  const tax = getCommanderTax(game, playerId, commander.instanceId);
  const castCount = getCommanderCastCount(game, playerId, commander.instanceId);
  const totalCost = getCommanderTotalCost(commander, tax);
  const helperReason = getCommanderCastDisabledReason(game, playerId, commander.instanceId, { judgeMode });
  const disabledReason = canControl ? helperReason : 'View only.';
  const disabled = Boolean(disabledReason);

  return (
    <button
      type="button"
      data-testid={`cast-commander-${commander.instanceId}`}
      disabled={disabled}
      title={disabledReason ?? `Cast ${commander.definition.name} for ${totalCost}`}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onCast();
      }}
      style={{
        border: `1px solid ${disabled ? '#475569' : '#f59e0b'}`,
        background: disabled ? 'rgba(15,23,42,0.74)' : 'linear-gradient(135deg, #78350f, #92400e)',
        color: disabled ? '#64748b' : '#fde68a',
        borderRadius: 6,
        padding: compact ? '3px 6px' : '6px 8px',
        fontSize: compact ? 8 : 10,
        fontWeight: 900,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'grid',
        gap: 2,
        textAlign: 'left',
        minWidth: compact ? 92 : 130,
      }}
    >
      <span>Cast Commander</span>
      <span style={{ color: disabled ? '#475569' : '#fed7aa', fontSize: compact ? 7 : 9 }}>
        {totalCost} | tax +{tax} | cast {castCount}x
      </span>
      {disabledReason ? (
        <span style={{ color: '#94a3b8', fontSize: compact ? 7 : 9, fontWeight: 700 }}>{disabledReason}</span>
      ) : null}
    </button>
  );
}
