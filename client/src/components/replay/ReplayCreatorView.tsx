import type { CSSProperties } from 'react';
import { CommanderTable } from '../battlefield/CommanderTable';
import { useGameStore } from '../../store/gameStore';
import type { ActionRecord } from '../../types/game';
import type { ReplaySession } from '../../types/replay';
import { ReplayAnimationOverlay } from './ReplayAnimationOverlay';

interface ReplayCreatorPlayerPanel {
  seatIndex: number;
  displayName: string;
  lifeTotal?: number;
  commanderNames: string[];
  color?: string;
}

export interface ReplayCreatorViewModel {
  caption: string;
  turnPhaseBanner: string;
  privacyLabel: 'private' | 'public' | 'redacted';
  players: ReplayCreatorPlayerPanel[];
  timeline: Array<{ actionIndex: number; label: string; active: boolean }>;
}

const PHASE_LABELS: Record<string, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main1: 'Main Phase',
  beginningOfCombat: 'Beginning of Combat',
  declareAttackers: 'Declare Attackers',
  declareBlockers: 'Declare Blockers',
  combatDamage: 'Combat Damage',
  endOfCombat: 'End of Combat',
  main2: 'Second Main',
  end: 'End Step',
  cleanup: 'Cleanup',
};

function privacyLabel(replay: ReplaySession): ReplayCreatorViewModel['privacyLabel'] {
  if (replay.replayFile.privacy.includesPrivateZones) return 'private';
  if (replay.replayFile.privacy.redactedPlayers?.length) return 'redacted';
  return 'public';
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/\b(room|code)\s*[:#-]?\s*[A-Z0-9-]{4,}\b/gi, '$1 [hidden]')
    .replace(/\b(peer|player|firebase|session|uid|id)\s*[:#-]?\s*[a-z0-9_-]{6,}\b/gi, '$1 [hidden]')
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, '[hidden-id]');
}

export function getReplayCreatorActionCaption(replay: ReplaySession): string {
  const action = replay.replayFile.actionLog[replay.currentActionIndex];
  if (!action) return 'Initial board state';
  return safeActionLabel(replay, action);
}

function safeActionLabel(replay: ReplaySession, action: ActionRecord): string {
  const streamerSafe = replay.creatorSettings.streamerSafeMode;
  const publicOnly = streamerSafe || !replay.replayFile.privacy.includesPrivateZones;
  const player = replay.replayFile.players.find(summary => summary.playerId === action.playerId)?.displayName ?? 'A player';
  if (publicOnly) {
    if (action.actionType === 'CAST' || action.actionType === 'CAST_SPELL') return `${player} cast a spell`;
    if (action.actionType === 'DRAW_CARD') return `${player} drew a card`;
    if (action.actionType === 'MOVE_CARD') return `${player} moved a card`;
    if (action.actionType === 'SEARCH_LIBRARY') return `${player} searched a library`;
    if (action.actionType === 'SCRY') return `${player} made a private scry decision`;
    if (action.actionType === 'SURVEIL') return `${player} made a private surveil decision`;
    if (action.actionType === 'DISCARD') return `${player} discarded a card`;
  }
  return redactSensitiveText(action.description || action.actionType);
}

export function buildReplayCreatorViewModel(replay: ReplaySession): ReplayCreatorViewModel {
  const current = replay.currentGameState;
  const safeMode = replay.creatorSettings.streamerSafeMode;
  const timelineStart = Math.max(0, replay.currentActionIndex - 4);
  const timelineEnd = Math.min(replay.replayFile.actionLog.length, Math.max(replay.currentActionIndex + 5, 8));
  return {
    caption: replay.creatorSettings.showActionCaption ? getReplayCreatorActionCaption(replay) : '',
    turnPhaseBanner: `Turn ${current.turn} - ${PHASE_LABELS[current.phase] ?? current.phase}`,
    privacyLabel: privacyLabel(replay),
    players: replay.replayFile.players
      .slice()
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map(summary => {
        const player = current.players.find(item => item.id === summary.playerId);
        return {
          seatIndex: summary.seatIndex,
          displayName: redactSensitiveText(summary.displayName),
          lifeTotal: replay.creatorSettings.showLifeTotals ? player?.life : undefined,
          commanderNames: replay.creatorSettings.showCommanderNames && !safeMode
            ? summary.commanderNames ?? []
            : replay.creatorSettings.showCommanderNames
              ? (summary.commanderNames ?? []).map(name => redactSensitiveText(name))
              : [],
          color: player?.color,
        };
      }),
    timeline: replay.replayFile.actionLog.slice(timelineStart, timelineEnd).map((action, offset) => {
      const actionIndex = timelineStart + offset;
      return {
        actionIndex,
        label: safeActionLabel(replay, action),
        active: actionIndex === replay.currentActionIndex,
      };
    }),
  };
}

export function ReplayCreatorView() {
  const replay = useGameStore(s => s.replay);
  const jumpToAction = useGameStore(s => s.replayJumpToAction);
  if (!replay) return null;
  const model = buildReplayCreatorViewModel(replay);
  const settings = replay.creatorSettings;

  return (
    <div data-testid="replay-creator-view" style={creatorShellStyle}>
      <div style={boardFrameStyle}>
        <CommanderTable />
        <ReplayAnimationOverlay />
        <div data-testid="replay-creator-turn-phase" style={turnBannerStyle}>{model.turnPhaseBanner}</div>
        {settings.showActionCaption && (
          <div data-testid="replay-creator-action-caption" style={captionStyle}>{model.caption}</div>
        )}
        {settings.showPlayerPanels && (
          <div data-testid="replay-creator-player-panels" style={playerPanelRailStyle}>
            {model.players.map(player => (
              <div key={`${player.seatIndex}-${player.displayName}`} style={{ ...playerPlateStyle, borderColor: `${player.color ?? '#64748b'}88` }}>
                <div style={{ minWidth: 0 }}>
                  <div style={playerNameStyle}>{player.displayName}</div>
                  {settings.showCommanderNames && player.commanderNames.length > 0 && (
                    <div style={commanderNameStyle}>{player.commanderNames.join(' / ')}</div>
                  )}
                </div>
                {settings.showLifeTotals && (
                  <div style={{ ...lifeTotalStyle, color: player.color ?? '#f8fafc' }}>{player.lifeTotal ?? '-'}</div>
                )}
              </div>
            ))}
          </div>
        )}
        {settings.showTimeline && (
          <div data-testid="replay-creator-timeline" style={timelineStripStyle}>
            {model.timeline.map(item => (
              <button
                key={item.actionIndex}
                type="button"
                onClick={() => jumpToAction(item.actionIndex)}
                style={{
                  ...timelinePipStyle,
                  background: item.active ? '#facc15' : 'rgba(148,163,184,0.26)',
                  color: item.active ? '#111827' : '#cbd5e1',
                }}
                title={item.label}
                aria-label={`Jump to creator timeline action ${item.actionIndex + 1}`}
              >
                {item.actionIndex + 1}
              </button>
            ))}
          </div>
        )}
        {settings.streamerSafeMode && (
          <div data-testid="replay-creator-streamer-safe" style={safeChipStyle}>Streamer-safe</div>
        )}
      </div>
    </div>
  );
}

const creatorShellStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  height: '100%',
  position: 'relative',
  background: 'radial-gradient(circle at 50% 38%, rgba(14,116,144,0.22), transparent 48%), #020617',
  padding: 14,
  overflow: 'hidden',
};

const boardFrameStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  borderRadius: 18,
  border: '1px solid rgba(148,163,184,0.24)',
  background: '#080d11',
  boxShadow: '0 28px 90px rgba(0,0,0,0.44)',
};

const turnBannerStyle: CSSProperties = {
  position: 'absolute',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 80,
  border: '1px solid rgba(250,204,21,0.55)',
  borderRadius: 999,
  background: 'rgba(2,6,23,0.78)',
  color: '#fde68a',
  padding: '7px 18px',
  fontSize: 14,
  fontWeight: 950,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  backdropFilter: 'blur(8px)',
};

const captionStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 72,
  transform: 'translateX(-50%)',
  zIndex: 80,
  maxWidth: 'min(760px, 78%)',
  border: '1px solid rgba(96,165,250,0.42)',
  borderRadius: 16,
  background: 'linear-gradient(180deg, rgba(15,23,42,0.92), rgba(2,6,23,0.82))',
  color: '#eff6ff',
  padding: '13px 20px',
  textAlign: 'center',
  fontSize: 20,
  fontWeight: 950,
  boxShadow: '0 18px 48px rgba(0,0,0,0.34)',
};

const playerPanelRailStyle: CSSProperties = {
  position: 'absolute',
  left: 16,
  right: 16,
  top: 58,
  zIndex: 75,
  display: 'flex',
  gap: 8,
  justifyContent: 'center',
  flexWrap: 'wrap',
  pointerEvents: 'none',
};

const playerPlateStyle: CSSProperties = {
  minWidth: 168,
  maxWidth: 240,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  border: '1px solid rgba(148,163,184,0.35)',
  borderRadius: 12,
  padding: '8px 11px',
  background: 'rgba(2,6,23,0.78)',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 12px 30px rgba(0,0,0,0.24)',
};

const playerNameStyle: CSSProperties = {
  color: '#f8fafc',
  fontSize: 13,
  fontWeight: 950,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const commanderNameStyle: CSSProperties = {
  color: '#94a3b8',
  fontSize: 9,
  fontWeight: 800,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const lifeTotalStyle: CSSProperties = {
  fontSize: 27,
  fontWeight: 1000,
  lineHeight: 1,
};

const timelineStripStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 18,
  transform: 'translateX(-50%)',
  zIndex: 82,
  display: 'flex',
  gap: 5,
  padding: 7,
  borderRadius: 999,
  background: 'rgba(2,6,23,0.82)',
  border: '1px solid rgba(100,116,139,0.38)',
  backdropFilter: 'blur(8px)',
};

const timelinePipStyle: CSSProperties = {
  width: 28,
  height: 22,
  border: 'none',
  borderRadius: 999,
  fontSize: 9,
  fontWeight: 950,
  cursor: 'pointer',
};

const safeChipStyle: CSSProperties = {
  position: 'absolute',
  right: 18,
  top: 18,
  zIndex: 84,
  border: '1px solid rgba(34,197,94,0.38)',
  borderRadius: 999,
  background: 'rgba(20,83,45,0.72)',
  color: '#bbf7d0',
  padding: '5px 10px',
  fontSize: 10,
  fontWeight: 950,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};
