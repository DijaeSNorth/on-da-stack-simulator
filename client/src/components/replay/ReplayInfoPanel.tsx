import { useGameStore } from '../../store/gameStore';

export function ReplayInfoPanel() {
  const replay = useGameStore(s => s.replay);
  if (!replay) return null;

  const file = replay.replayFile;
  const turnCount = new Set(file.actionLog.map(action => action.turn)).size;
  const privacyLabel = file.privacy.includesPrivateZones
    ? 'Private'
    : file.privacy.redactedPlayers?.length
      ? 'Redacted'
      : 'Public';

  return (
    <div data-testid="replay-info-panel" style={{
      padding: 10,
      borderTop: '1px solid #1e293b',
      background: '#0b1117',
      display: 'flex',
      flexDirection: 'column',
      gap: 7,
      fontSize: 10,
      color: '#94a3b8',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ color: '#e2e8f0', fontSize: 11 }}>{file.gameName || file.gameId}</strong>
        <span>{privacyLabel}</span>
      </div>
      <div>{file.players.map(player => player.displayName).join(' / ')}</div>
      <div>{file.actionLog.length} actions / {turnCount || 1} turns / {file.mode}</div>
      <div>
        Checkpoints: {replay.checkpoints?.length ?? 0} / every {replay.checkpointInterval} actions
        {replay.checkpoints?.length ? ' / Fast scrubbing enabled' : ''}
      </div>
      <div>{file.rulesetVersion || 'unknown ruleset'} / {file.appVersion || 'unknown app'} / {file.buildCommit || 'unknown commit'}</div>
      {replay.warnings.length > 0 && (
        <div data-testid="replay-warnings" style={{ borderTop: '1px solid #3f2f12', paddingTop: 7, color: '#fcd34d' }}>
          {replay.warnings.slice(-5).map(warning => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      )}
    </div>
  );
}
