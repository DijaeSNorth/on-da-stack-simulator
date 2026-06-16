import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { replaySpeedToDelay } from '../../engine/replayEngine';
import { useGameStore } from '../../store/gameStore';
import type { ReplayAnimationMode, ReplaySpeed, ReplayViewMode } from '../../types/replay';

const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, 'instant'];
const ANIMATION_MODES: ReplayAnimationMode[] = ['off', 'simple', 'dramatic'];
const VIEW_MODES: ReplayViewMode[] = ['normal', 'review', 'creator'];

export function ReplayControls() {
  const replay = useGameStore(s => s.replay);
  const stepForward = useGameStore(s => s.replayStepForward);
  const stepBackward = useGameStore(s => s.replayStepBackward);
  const jumpToAction = useGameStore(s => s.replayJumpToAction);
  const play = useGameStore(s => s.replayPlay);
  const pause = useGameStore(s => s.replayPause);
  const setSpeed = useGameStore(s => s.replaySetSpeed);
  const setViewMode = useGameStore(s => s.replaySetViewMode);
  const setCreatorSetting = useGameStore(s => s.replaySetCreatorSetting);
  const setAnimationMode = useGameStore(s => s.replaySetAnimationMode);
  const setAnimationSpeed = useGameStore(s => s.replaySetAnimationSpeed);
  const skipAnimation = useGameStore(s => s.replaySkipAnimation);
  const exitReplay = useGameStore(s => s.exitReplay);
  const adaptivePerformance = useGameStore(s => s.adaptivePerformance);

  useEffect(() => {
    if (!replay || replay.status !== 'playing') return;
    if (replay.currentActionIndex >= replay.replayFile.actionLog.length - 1) {
      pause();
      return;
    }
    if (replay.speed === 'instant') {
      jumpToAction(replay.replayFile.actionLog.length - 1);
      pause();
      return;
    }
    const timer = window.setTimeout(stepForward, replaySpeedToDelay(replay.speed));
    return () => window.clearTimeout(timer);
  }, [jumpToAction, pause, replay, stepForward]);

  if (!replay) return null;
  const max = replay.replayFile.actionLog.length - 1;
  const atStart = replay.currentActionIndex <= -1;
  const atEnd = replay.currentActionIndex >= max;
  const playing = replay.status === 'playing';
  const animationsReduced = replay.animationMode !== 'off' &&
    (adaptivePerformance.animationQuality !== 'full' || adaptivePerformance.disableReplayDramaticEffects);

  return (
    <div data-testid="replay-controls" style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '7px 10px',
      background: '#101922',
      borderBottom: '1px solid #26323a',
      flexWrap: 'wrap',
    }}>
      <button data-testid="replay-start" onClick={() => jumpToAction(-1)} disabled={atStart} style={buttonStyle}>Start</button>
      <button data-testid="replay-step-back" onClick={stepBackward} disabled={atStart} style={buttonStyle}>Back</button>
      <button
        data-testid="replay-play-pause"
        onClick={playing ? pause : play}
        disabled={!playing && atEnd}
        style={{ ...buttonStyle, borderColor: playing ? '#f59e0b' : '#22c55e', color: playing ? '#fcd34d' : '#bbf7d0' }}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button data-testid="replay-step-forward" onClick={stepForward} disabled={atEnd} style={buttonStyle}>Forward</button>
      <button data-testid="replay-end" onClick={() => jumpToAction(max)} disabled={atEnd} style={buttonStyle}>End</button>
      <div style={{ width: 1, height: 22, background: '#26323a', margin: '0 4px' }} />
      <label style={{ color: '#64748b', fontSize: 10, fontWeight: 800 }}>Speed</label>
      <select
        data-testid="replay-speed"
        value={String(replay.speed)}
        onChange={event => setSpeed(event.target.value === 'instant' ? 'instant' : Number(event.target.value) as ReplaySpeed)}
        style={{ background: '#020617', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 5, padding: '4px 6px', fontSize: 10 }}
      >
        {SPEEDS.map(speed => <option key={String(speed)} value={String(speed)}>{speed === 'instant' ? 'Instant' : `${speed}x`}</option>)}
      </select>
      <label style={{ color: '#64748b', fontSize: 10, fontWeight: 800 }}>View</label>
      <select
        data-testid="replay-view-mode"
        value={replay.viewMode}
        onChange={event => setViewMode(event.target.value as ReplayViewMode)}
        style={{ background: '#020617', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 5, padding: '4px 6px', fontSize: 10 }}
      >
        {VIEW_MODES.map(mode => <option key={mode} value={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>)}
      </select>
      <label style={{ color: '#64748b', fontSize: 10, fontWeight: 800 }}>Animations</label>
      <select
        data-testid="replay-animation-mode"
        value={replay.animationMode}
        onChange={event => setAnimationMode(event.target.value as ReplayAnimationMode)}
        style={{ background: '#020617', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 5, padding: '4px 6px', fontSize: 10 }}
      >
        {ANIMATION_MODES.map(mode => <option key={mode} value={mode}>{mode[0].toUpperCase() + mode.slice(1)}</option>)}
      </select>
      <input
        data-testid="replay-animation-speed"
        type="number"
        min={0.25}
        max={4}
        step={0.25}
        value={replay.animationSpeed}
        onChange={event => setAnimationSpeed(Number(event.target.value))}
        title="Animation speed"
        style={{ width: 54, background: '#020617', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 5, padding: '4px 6px', fontSize: 10 }}
      />
      <button data-testid="replay-skip-animation" onClick={skipAnimation} disabled={replay.currentAnimations.length === 0} style={buttonStyle}>Skip FX</button>
      {replay.viewMode === 'creator' && (
        <div data-testid="replay-creator-toggles" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <CreatorToggle label="Timeline" checked={replay.creatorSettings.showTimeline} onChange={value => setCreatorSetting('showTimeline', value)} />
          <CreatorToggle label="Caption" checked={replay.creatorSettings.showActionCaption} onChange={value => setCreatorSetting('showActionCaption', value)} />
          <CreatorToggle label="Players" checked={replay.creatorSettings.showPlayerPanels} onChange={value => setCreatorSetting('showPlayerPanels', value)} />
          <CreatorToggle label="Life" checked={replay.creatorSettings.showLifeTotals} onChange={value => setCreatorSetting('showLifeTotals', value)} />
          <CreatorToggle label="Commanders" checked={replay.creatorSettings.showCommanderNames} onChange={value => setCreatorSetting('showCommanderNames', value)} />
          <CreatorToggle label="Streamer-safe" checked={replay.creatorSettings.streamerSafeMode} onChange={value => setCreatorSetting('streamerSafeMode', value)} />
        </div>
      )}
      {animationsReduced && (
        <span
          data-testid="replay-animation-downgrade"
          title={adaptivePerformance.reason}
          style={{
            color: '#fbbf24',
            fontSize: 10,
            fontWeight: 800,
            border: '1px solid #854d0e',
            background: '#2b1d08',
            borderRadius: 5,
            padding: '4px 6px',
          }}
        >
          Animations reduced due to connection/performance
        </span>
      )}
      <div style={{ marginLeft: 'auto', color: '#94a3b8', fontSize: 10 }}>
        {replay.currentActionIndex + 1} / {replay.replayFile.actionLog.length}
      </div>
      <button data-testid="replay-exit" onClick={exitReplay} style={{ ...buttonStyle, borderColor: '#7f1d1d', color: '#fca5a5' }}>Exit</button>
    </div>
  );
}

const buttonStyle: CSSProperties = {
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#cbd5e1',
  borderRadius: 5,
  padding: '5px 8px',
  fontSize: 10,
  fontWeight: 800,
  cursor: 'pointer',
};

function CreatorToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      border: '1px solid #334155',
      borderRadius: 999,
      padding: '3px 7px',
      background: checked ? 'rgba(20,83,45,0.42)' : 'rgba(15,23,42,0.72)',
      color: checked ? '#bbf7d0' : '#94a3b8',
      fontSize: 9,
      fontWeight: 800,
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        style={{ margin: 0 }}
      />
      {label}
    </label>
  );
}
