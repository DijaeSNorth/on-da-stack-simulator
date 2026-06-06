import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { AssistantMessage } from '../../store/gameStore';
import type { ActionRecord, StackObject, TriggerItem } from '../../types/game';

const SEVERITY_COLORS: Record<string, string> = {
  legal: '#22c55e',
  flagged: '#ef4444',
  needsReview: '#f59e0b',
  info: '#60a5fa',
  warning: '#f97316',
  error: '#ef4444',
  'State-Based': '#a78bfa',
};

const SEVERITY_LABEL_STYLES: Record<string, { bg: string; color: string }> = {
  Legal: { bg: '#14532d', color: '#86efac' },
  Flagged: { bg: '#7f1d1d', color: '#fca5a5' },
  'Needs Review': { bg: '#78350f', color: '#fcd34d' },
  'Why Is This Legal': { bg: '#1e3a5f', color: '#93c5fd' },
  Info: { bg: '#1e293b', color: '#94a3b8' },
  'Missed Trigger': { bg: '#581c87', color: '#d8b4fe' },
  'State-Based': { bg: '#312e81', color: '#a5b4fc' },
};

const sectionHeaderStyle: CSSProperties = {
  fontSize: 9,
  color: '#64748b',
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

type TimelineItem =
  | {
      kind: 'action';
      id: string;
      timestamp: number;
      action: ActionRecord;
      playerName?: string;
      reviewMessages: string[];
      review: boolean;
    }
  | {
      kind: 'judge';
      id: string;
      timestamp: number;
      message: AssistantMessage;
    };

function makeFlagKey(text: string, turn: number, phase: string): string {
  return `${turn}|${phase}|${text.trim().toLowerCase()}`;
}

function formatClock(timestamp: number): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function AssistantTab() {
  const messages = useGameStore(s => s.ui.assistantMessages);
  const game = useGameStore(s => s.game);
  const store = useGameStore();
  const pendingTriggers = game.triggerQueue.filter(t => !t.acknowledged);
  const missedTriggers = game.triggerQueue.filter(t => t.missed);
  const timeline = useMemo<TimelineItem[]>(() => {
    const consumedFlagKeys = new Set<string>();
    const actionItems: TimelineItem[] = game.actionLog.slice(-120).map(action => {
      const player = game.players.find(p => p.id === action.playerId);
      const reviewMessages = [
        ...(action.flags ?? []).map(flag => flag.text),
        ...(typeof action.data?.assistantSummary === 'string' ? [action.data.assistantSummary] : []),
      ].filter((text): text is string => Boolean(text));
      for (const text of reviewMessages) consumedFlagKeys.add(makeFlagKey(text, action.turn, action.phase));
      return {
        kind: 'action',
        id: action.id,
        timestamp: action.timestamp,
        action,
        playerName: player?.name,
        reviewMessages,
        review: reviewMessages.length > 0 || Array.isArray(action.data?.reviewTypes),
      };
    });
    const judgeItems: TimelineItem[] = messages
      .filter(message => !consumedFlagKeys.has(makeFlagKey(message.text, message.turn, message.phase)))
      .slice(-80)
      .map(message => ({
        kind: 'judge',
        id: message.id,
        timestamp: message.timestamp,
        message,
      }));
    return [...actionItems, ...judgeItems]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 120);
  }, [game.actionLog, game.players, messages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {(pendingTriggers.length > 0 || missedTriggers.length > 0) && (
        <div style={{
          margin: 8,
          padding: '7px 8px',
          borderRadius: 5,
          background: pendingTriggers.length > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(88,28,135,0.12)',
          border: `1px solid ${pendingTriggers.length > 0 ? '#78350f' : '#581c87'}`,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 10, color: pendingTriggers.length > 0 ? '#fcd34d' : '#d8b4fe', fontWeight: 700 }}>
              {pendingTriggers.length > 0 ? `${pendingTriggers.length} pending trigger${pendingTriggers.length === 1 ? '' : 's'}` : `${missedTriggers.length} missed trigger${missedTriggers.length === 1 ? '' : 's'}`}
            </div>
            <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
              Managed with stack objects in the Stack panel.
            </div>
          </div>
          <button
            onClick={() => store.setRightPanelTab('stack')}
            style={{
              fontSize: 9,
              padding: '3px 7px',
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              borderRadius: 4,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Open
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={sectionHeaderStyle}>Judge / Action Timeline</div>
        {timeline.length === 0 ? (
          <div style={{
            color: '#334155', fontSize: 12, fontStyle: 'italic', textAlign: 'center',
            padding: '14px 8px', border: '1px dashed #1e293b', borderRadius: 5,
          }}>
            The timeline is ready.
            <div style={{ fontSize: 10, marginTop: 5, color: '#1e293b' }}>
              Plays, judge notes, and replay breadcrumbs will appear together.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {timeline.map(item => {
              if (item.kind === 'judge') {
                const msg = item.message;
                const labelStyle = SEVERITY_LABEL_STYLES[msg.label] || { bg: '#1e293b', color: '#94a3b8' };
                return (
                  <div
                    key={`judge-${msg.id}`}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: `1px solid ${SEVERITY_COLORS[msg.severity] || '#334155'}44`,
                      borderLeft: `3px solid ${SEVERITY_COLORS[msg.severity] || '#334155'}`,
                      borderRadius: 5,
                      padding: '6px 8px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, gap: 6 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 5px',
                        borderRadius: 3, ...labelStyle,
                      }}>
                        {msg.label}
                      </span>
                      <span style={{ fontSize: 9, color: '#334155' }}>
                        T{msg.turn} - {msg.phase} - {formatClock(msg.timestamp)}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4 }}>
                      {msg.text}
                    </div>
                    {msg.ruleRef && (
                      <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
                        Rule {msg.ruleRef}
                      </div>
                    )}
                  </div>
                );
              }
              const { action } = item;
              return (
                <div
                  key={`action-${action.id}`}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 5,
                    background: item.review ? 'rgba(245,158,11,0.07)' : 'rgba(255,255,255,0.025)',
                    border: `1px solid ${item.review ? '#78350f' : '#1e293b'}`,
                    opacity: action.undone ? 0.4 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 3 }}>
                    <span style={{
                      fontSize: 8,
                      color: item.review ? '#fcd34d' : '#93c5fd',
                      background: item.review ? '#78350f' : '#1e3a5f',
                      borderRadius: 3,
                      padding: '1px 5px',
                      fontWeight: 800,
                    }}>
                      {action.actionType.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 9, color: '#334155', whiteSpace: 'nowrap' }}>
                      T{action.turn} - {action.phase} - {formatClock(action.timestamp)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: item.review ? '#fcd34d' : '#cbd5e1', lineHeight: 1.35 }}>
                    {action.description}
                    {action.undone && <span style={{ color: '#6b7280' }}> [undone]</span>}
                  </div>
                  {item.playerName && (
                    <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
                      {item.playerName}
                    </div>
                  )}
                  {item.reviewMessages.map(text => (
                    <div key={text} style={{ marginTop: 4, fontSize: 10, color: '#fbbf24', lineHeight: 1.35 }}>
                      Judge: {text}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const reversed = [...messages].reverse();
  const log = [...game.actionLog].reverse().slice(0, 80);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {(pendingTriggers.length > 0 || missedTriggers.length > 0) && (
        <div style={{
          margin: 8,
          padding: '7px 8px',
          borderRadius: 5,
          background: pendingTriggers.length > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(88,28,135,0.12)',
          border: `1px solid ${pendingTriggers.length > 0 ? '#78350f' : '#581c87'}`,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 10, color: pendingTriggers.length > 0 ? '#fcd34d' : '#d8b4fe', fontWeight: 700 }}>
              {pendingTriggers.length > 0 ? `${pendingTriggers.length} pending trigger${pendingTriggers.length === 1 ? '' : 's'}` : `${missedTriggers.length} missed trigger${missedTriggers.length === 1 ? '' : 's'}`}
            </div>
            <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
              Managed with stack objects in the Stack panel.
            </div>
          </div>
          <button
            onClick={() => store.setRightPanelTab('stack')}
            style={{
              fontSize: 9,
              padding: '3px 7px',
              background: '#1e293b',
              color: '#cbd5e1',
              border: '1px solid #334155',
              borderRadius: 4,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Open
          </button>
        </div>
      )}
      <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={sectionHeaderStyle}>Judge Flags</div>
        {reversed.length === 0 ? (
          <div style={{
            color: '#334155', fontSize: 12, fontStyle: 'italic', textAlign: 'center',
            padding: '14px 8px', border: '1px dashed #1e293b', borderRadius: 5,
          }}>
            The judge is watching.
            <div style={{ fontSize: 10, marginTop: 5, color: '#1e293b' }}>
              Mistakes and missed opportunities will appear here.
            </div>
          </div>
        ) : (
          <>
          {reversed.map((msg: AssistantMessage) => {
            const labelStyle = SEVERITY_LABEL_STYLES[msg.label] || { bg: '#1e293b', color: '#94a3b8' };
            return (
              <div
                key={msg.id}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: `1px solid ${SEVERITY_COLORS[msg.severity] || '#334155'}44`,
                  borderLeft: `3px solid ${SEVERITY_COLORS[msg.severity] || '#334155'}`,
                  borderRadius: 5,
                  padding: '6px 8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px',
                    borderRadius: 3, ...labelStyle,
                  }}>
                    {msg.label}
                  </span>
                  <span style={{ fontSize: 9, color: '#334155' }}>
                    T{msg.turn} · {msg.phase}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.4 }}>
                  {msg.text}
                </div>
                {msg.ruleRef && (
                  <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
                    Rule {msg.ruleRef}
                  </div>
                )}
              </div>
            );
          })}
          </>
        )}

        <div style={{ ...sectionHeaderStyle, marginTop: 4 }}>Action Log</div>
        {log.length === 0 ? (
          <div style={{
            color: '#334155', fontSize: 12, fontStyle: 'italic', textAlign: 'center',
            padding: '14px 8px', border: '1px dashed #1e293b', borderRadius: 5,
          }}>
            No actions logged yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {log.map(action => {
              const player = game.players.find(p => p.id === action.playerId);
              const isFlag = action.flags?.length > 0 || Array.isArray(action.data?.reviewTypes);
              return (
                <div
                  key={action.id}
                  style={{
                    display: 'flex',
                    gap: 6,
                    padding: '4px 0',
                    borderTop: '1px solid rgba(255,255,255,0.04)',
                    opacity: action.undone ? 0.4 : 1,
                  }}
                >
                  <div style={{ fontSize: 9, color: '#334155', flexShrink: 0, paddingTop: 1 }}>
                    T{action.turn}
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: isFlag ? '#f59e0b' : '#94a3b8', lineHeight: 1.35 }}>
                      {action.description}
                      {action.undone && <span style={{ color: '#6b7280' }}> [undone]</span>}
                    </div>
                    {player && (
                      <div style={{ fontSize: 9, color: '#475569' }}>
                        {player.name} - {action.phase}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StackTab() {
  const store = useGameStore();
  const { game } = store;
  const stack = game.stack;
  const previousStackRef = useRef<StackObject[]>(stack);
  const [recentResolved, setRecentResolved] = useState<{ obj: StackObject; resolvedAt: number }[]>([]);
  const turnLog = useMemo(() => game.actionLog
    .filter(action => action.turn === game.turn)
    .slice(-7)
    .reverse(), [game.actionLog, game.turn]);

  useEffect(() => {
    const previous = previousStackRef.current;
    const currentIds = new Set(stack.map(obj => obj.id));
    const removed = previous.filter(obj => !currentIds.has(obj.id));
    previousStackRef.current = stack;
    if (removed.length === 0) return;
    const now = Date.now();
    setRecentResolved(prev => [
      ...removed.map(obj => ({ obj, resolvedAt: now })),
      ...prev,
    ].slice(0, 6));
  }, [stack]);

  useEffect(() => {
    if (recentResolved.length === 0) return;
    const timer = window.setTimeout(() => {
      const cutoff = Date.now() - 8000;
      setRecentResolved(prev => prev.filter(item => item.resolvedAt >= cutoff));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [recentResolved]);

  const getTargetLabels = (obj: StackObject) => {
    const labels = [...(obj.targetLabels ?? [])];
    for (const id of obj.targets ?? []) {
      const player = game.players.find(p => p.id === id);
      const card = game.cards[id];
      const label = player?.name ?? card?.definition.name;
      if (label && !labels.includes(label)) labels.push(label);
    }
    return labels;
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 9, color: '#60a5fa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Stack ({stack.length})
      </div>
      <div style={{ fontSize: 10, color: '#475569', marginBottom: 6, textAlign: 'center' }}>
        Resolves top → bottom
      </div>
      {stack.length === 0 && (
        <div style={{
          color: '#334155', fontSize: 12, fontStyle: 'italic',
          padding: '14px 8px', textAlign: 'center',
          border: '1px dashed #1e293b',
          borderRadius: 5,
        }}>
          Stack is empty
        </div>
      )}
      {stack.map((obj: StackObject, i) => {
        const player = game.players.find(p => p.id === obj.controllerId);
        const targetLabels = getTargetLabels(obj);
        return (
          <div
            key={obj.id}
            style={{
              background: i === 0 ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${i === 0 ? '#3b82f6' : '#1e293b'}`,
              borderRadius: 5,
              padding: '7px 10px',
              marginBottom: 4,
              position: 'relative',
            }}
          >
            {i === 0 && (
              <div style={{
                position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)',
                background: '#3b82f6', color: '#fff',
                fontSize: 8, padding: '1px 6px', borderRadius: 2, fontWeight: 700,
              }}>TOP</div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                {obj.sourceName}
              </span>
              <span style={{
                fontSize: 9, padding: '1px 5px',
                background: obj.type === 'spell' ? '#1e3a5f' : '#1c1917',
                color: obj.type === 'spell' ? '#93c5fd' : '#a8a29e',
                borderRadius: 3,
              }}>
                {obj.type}
              </span>
            </div>
            <div style={{ fontSize: 10, color: '#64748b' }}>
              {player?.name || obj.controllerId}
            </div>
            {targetLabels.length > 0 && (
              <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 3, fontWeight: 700 }}>
                Target: {targetLabels.join(', ')}
              </div>
            )}
            {obj.text && (
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, lineHeight: 1.3 }}>
                {obj.text.slice(0, 80)}{obj.text.length > 80 ? '…' : ''}
              </div>
            )}
            {i === 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button
                  data-testid="btn-resolve-stack"
                  onClick={store.resolveStack}
                  style={{
                    fontSize: 9, padding: '3px 8px',
                    background: '#14532d', color: '#86efac',
                    border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 700,
                  }}
                >Resolve</button>
                <button
                  data-testid="btn-counter-spell"
                  onClick={() => store.counterSpell(obj.id)}
                  style={{
                    fontSize: 9, padding: '3px 8px',
                    background: '#7f1d1d', color: '#fca5a5',
                    border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 700,
                  }}
                >Counter</button>
              </div>
            )}
          </div>
        );
      })}
      {recentResolved.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '2px 0 4px' }}>
            Recently resolved
          </div>
          {recentResolved.map(({ obj, resolvedAt }) => {
            const labels = getTargetLabels(obj);
            return (
              <div
                key={`${obj.id}-${resolvedAt}`}
                style={{
                  background: 'rgba(20,83,45,0.08)',
                  border: '1px solid rgba(34,197,94,0.22)',
                  borderRadius: 5,
                  padding: '5px 8px',
                  marginBottom: 4,
                  opacity: 0.82,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#bbf7d0', fontWeight: 700 }}>{obj.sourceName}</span>
                  <span style={{ fontSize: 9, color: '#4ade80' }}>resolved</span>
                </div>
                {labels.length > 0 && (
                  <div style={{ fontSize: 9, color: '#a3e635', marginTop: 2 }}>
                    Target: {labels.join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div>
        <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Turn Log
        </div>
        {turnLog.length === 0 ? (
          <div style={{ color: '#334155', fontSize: 11, fontStyle: 'italic', padding: '8px 4px' }}>
            No turn actions yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {turnLog.map(action => (
              <div key={`turn-${action.id}`} style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.3, borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 3 }}>
                <span style={{ color: '#475569' }}>{action.phase}</span> - {action.description}
              </div>
            ))}
          </div>
        )}
      </div>
      <TriggersTab embedded />
    </div>
  );
}

function TriggersTab({ embedded = false }: { embedded?: boolean }) {
  const store = useGameStore();
  const { game } = store;
  const pending = game.triggerQueue.filter(t => !t.acknowledged);
  const missed   = game.triggerQueue.filter(t => t.missed);
  const acknowledged = game.triggerQueue.filter(t => t.acknowledged && !t.missed);

  return (
    <div style={embedded ? { flexShrink: 0 } : { flex: 1, overflowY: 'auto', padding: 8 }}>

      {/* Active overlay note */}
      {pending.length > 0 && (
        <div style={{
          fontSize: 9, color: '#f59e0b', background: 'rgba(245,158,11,0.08)',
          border: '1px solid #78350f', borderRadius: 4, padding: '4px 8px',
          marginBottom: 6, textAlign: 'center',
        }}>
          ⚡ Trigger Queue Panel is active on the battlefield — use it to manage ordering &amp; resolution
        </div>
      )}

      {/* Pending list (mirror of floating panel) */}
      {pending.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: '#f59e0b', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Pending ({pending.length})
          </div>
          {pending.map((t: TriggerItem, i: number) => {
            const player = game.players.find(p => p.id === t.controllerId);
            return (
              <div
                key={t.id}
                style={{
                  background: i === 0 ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${i === 0 ? '#92400e' : '#1e293b'}`,
                  borderRadius: 5,
                  padding: '6px 8px',
                  marginBottom: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                  <span style={{ fontSize: 9, color: '#475569', fontWeight: 700 }}>{i + 1}.</span>
                  {player && (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: player.color, display: 'inline-block' }} />
                  )}
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#fcd34d', flex: 1 }}>
                    {t.sourceName}
                  </span>
                  <span style={{ fontSize: 8, color: '#64748b', background: '#1e293b', padding: '1px 4px', borderRadius: 3 }}>
                    {t.triggerType}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 5, paddingLeft: 14 }}>{t.text}</div>
                <div style={{ display: 'flex', gap: 3, paddingLeft: 14 }}>
                  <button
                    data-testid={`btn-ack-trigger-${t.id}`}
                    onClick={() => store.ackTrigger(t.id)}
                    style={{ fontSize: 9, padding: '2px 8px', background: '#78350f', color: '#fcd34d', border: 'none', borderRadius: 3, cursor: 'pointer', fontWeight: 700 }}
                  >{i === 0 ? 'Resolve ↵' : 'Resolve'}</button>
                  {t.effect?.kind === 'vialSmasherDamage' && (
                    <button
                      data-testid={`btn-trigger-shortcut-panel-${t.id}`}
                      onClick={() => store.applyTriggerShortcut(t.id)}
                      title="Shortcut: choose a random opponent and apply Vial Smasher damage"
                      style={{ fontSize: 8, padding: '2px 6px', background: '#123642', color: '#67e8f9', border: '1px solid #0e7490', borderRadius: 3, cursor: 'pointer', fontWeight: 800 }}
                    >Random Damage</button>
                  )}
                  {t.effect?.kind === 'poisonFromCombatDamage' && (
                    <button
                      data-testid={`btn-trigger-shortcut-panel-${t.id}`}
                      onClick={() => store.applyTriggerShortcut(t.id)}
                      title="Shortcut: apply poison counters from combat damage"
                      style={{ fontSize: 8, padding: '2px 6px', background: '#1f2a10', color: '#bef264', border: '1px solid #4d7c0f', borderRadius: 3, cursor: 'pointer', fontWeight: 800 }}
                    >Apply Poison</button>
                  )}
                  {t.effect?.kind === 'createToken' && (
                    <button
                      data-testid={`btn-trigger-shortcut-panel-${t.id}`}
                      onClick={() => store.applyTriggerShortcut(t.id)}
                      title={`Shortcut: create ${t.effect.token.name} token${t.effect.count === 1 ? '' : 's'}`}
                      style={{ fontSize: 8, padding: '2px 6px', background: '#2e1f10', color: '#fdba74', border: '1px solid #c2410c', borderRadius: 3, cursor: 'pointer', fontWeight: 800 }}
                    >Create Token</button>
                  )}
                  <button onClick={() => store.moveTriggerUp(t.id)} disabled={i === 0}
                    style={{ fontSize: 9, padding: '2px 5px', background: 'transparent', color: i === 0 ? '#334155' : '#64748b', border: '1px solid #334155', borderRadius: 3, cursor: i === 0 ? 'default' : 'pointer' }}>↑</button>
                  <button onClick={() => store.moveTriggerDown(t.id)} disabled={i === pending.length - 1}
                    style={{ fontSize: 9, padding: '2px 5px', background: 'transparent', color: i === pending.length - 1 ? '#334155' : '#64748b', border: '1px solid #334155', borderRadius: 3, cursor: i === pending.length - 1 ? 'default' : 'pointer' }}>↓</button>
                  <button onClick={() => store.markTriggerMissed(t.id)}
                    style={{ fontSize: 8, padding: '2px 5px', background: 'transparent', color: '#475569', border: '1px solid #334155', borderRadius: 3, cursor: 'pointer', marginLeft: 'auto' }}>Missed</button>
                </div>
              </div>
            );
          })}
          {pending.length >= 2 && (
            <button
              data-testid="btn-resolve-all-triggers-panel"
              onClick={() => pending.forEach(t => store.ackTrigger(t.id))}
              style={{ width: '100%', padding: '4px 0', fontSize: 9, background: '#1e293b', color: '#64748b', border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', marginTop: 4 }}
            >Resolve All ({pending.length})</button>
          )}
        </div>
      )}

      {pending.length === 0 && (
        <div style={{ color: '#334155', fontSize: 12, textAlign: 'center', padding: 16, fontStyle: 'italic' }}>
          No pending triggers
        </div>
      )}

      {/* Missed triggers */}
      {missed.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: '#ef4444', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase' }}>
            Missed ({missed.length})
          </div>
          {missed.map(t => (
            <div key={t.id} style={{ fontSize: 10, color: '#7f1d1d', padding: '2px 0' }}>
              ✕ {t.sourceName}: {t.text.slice(0, 50)}…
            </div>
          ))}
        </div>
      )}

      {/* Acknowledged history */}
      {acknowledged.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: '#475569', marginBottom: 4, textTransform: 'uppercase' }}>
            Resolved (last {Math.min(acknowledged.length, 10)})
          </div>
          {acknowledged.slice(-10).map(t => (
            <div key={t.id} style={{ fontSize: 10, color: '#334155', padding: '2px 0' }}>
              ✓ {t.sourceName}: {t.text.slice(0, 50)}…
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DebugTab() {
  const store = useGameStore();
  const { game } = store;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 8 }}>Sandbox Tools</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button
          onClick={store.runStateBasedActions}
          style={debugBtnStyle}
        >Run State-Based Actions</button>

        {game.players.map(p => (
          <div key={p.id}>
            <div style={{ fontSize: 9, color: '#475569', marginTop: 8, marginBottom: 4 }}>
              {p.name}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button onClick={() => store.drawCard(p.id, 7)} style={debugBtnStyle}>Draw 7</button>
              <button onClick={() => store.shuffleLibrary(p.id)} style={debugBtnStyle}>Shuffle</button>
              <button onClick={() => store.modifyPlayerLife(p.id, -10)} style={{ ...debugBtnStyle, background: '#7f1d1d', color: '#fca5a5' }}>-10 Life</button>
              <button onClick={() => store.modifyPlayerLife(p.id, 10)} style={{ ...debugBtnStyle, background: '#14532d', color: '#86efac' }}>+10 Life</button>
              <button onClick={() => store.addPoisonCounter(p.id)} style={debugBtnStyle}>+Poison</button>
            </div>
          </div>
        ))}

        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: '#475569', marginBottom: 4 }}>Game</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button onClick={store.undo} style={debugBtnStyle}>Undo</button>
            <button onClick={store.advanceTurn} style={debugBtnStyle}>Next Turn</button>
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 9, color: '#334155' }}>
          <div>Cards in game: {Object.keys(game.cards).length}</div>
          <div>Turn: {game.turn}</div>
          <div>Phase: {game.phase}</div>
          <div>Stack: {game.stack.length}</div>
          <div>Actions logged: {game.actionLog.length}</div>
        </div>
      </div>
    </div>
  );
}

const debugBtnStyle: CSSProperties = {
  fontSize: 9, padding: '3px 8px',
  background: '#1e293b', color: '#94a3b8',
  border: '1px solid #334155', borderRadius: 3, cursor: 'pointer',
};

const TABS: { id: string; label: string }[] = [
  { id: 'stack', label: 'Stack' },
  { id: 'assistant', label: 'Judge / Log' },
  { id: 'debug', label: 'Tools' },
];

function getTabHelp(tabId: string) {
  if (tabId === 'stack') {
    return {
      title: 'Stack Timeline',
      body: 'Shows spells, abilities, pending triggers, and the latest turn actions. Resolve from the top, or leave items visible while players respond.',
    };
  }
  if (tabId === 'assistant') {
    return {
      title: 'Judge And Log',
      body: 'Combines player actions and assistant warnings in one timeline so missed triggers, draws, reveals, and shortcuts are easy to review.',
    };
  }
  return {
    title: 'Practice Tools',
    body: 'Solo and debugging helpers for drawing, shuffling, changing life, running state-based actions, and stress testing table workflows.',
  };
}

export function RightPanel() {
  const store = useGameStore();
  const { ui, game } = store;

  if (!ui.rightPanelOpen) return null;

  const pendingTriggers = game.triggerQueue.filter(t => !t.acknowledged).length;
  const effectiveTab = ui.rightPanelTab === 'triggers'
    ? 'stack'
    : ui.rightPanelTab === 'log'
      ? 'assistant'
      : ui.rightPanelTab;

  return (
    <div
      data-testid="right-panel"
      style={{
        width: '100%',
        background: '#111827',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #1e293b',
        overflowX: 'auto',
        flexShrink: 0,
      }}>
        {TABS.map(tab => {
          const isStackTab = tab.id === 'stack';
          const isActive = effectiveTab === tab.id;
          return (
            <button
              key={tab.id}
              data-testid={`tab-${tab.id}`}
              data-help-title={getTabHelp(tab.id).title}
              data-help-body={getTabHelp(tab.id).body}
              data-help-placement="bottom"
              onClick={() => store.setRightPanelTab(tab.id as typeof ui.rightPanelTab)}
              style={{
                flex: 1,
                padding: '7px 4px',
                background: isActive ? 'rgba(255,255,255,0.06)' : 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: 9,
                color: isActive ? '#e2e8f0' : '#475569',
                whiteSpace: 'nowrap',
                transition: 'color 0.15s',
                position: 'relative',
              }}
            >
              {tab.label}
              {isStackTab && pendingTriggers > 0 && (
                <span style={{
                  position: 'absolute', top: 4, right: 2,
                  background: '#f59e0b', color: '#000',
                  borderRadius: '50%', width: 12, height: 12,
                  fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700,
                }}>
                  {pendingTriggers}
                </span>
              )}
            </button>
          );
        })}
        <button
          data-help-title="Hide Assistant Panel"
          data-help-body="Closes the Stack, Judge / Log, and Tools panel to give the battlefield more room. Reopen it from the top bar."
          data-help-placement="bottom"
          onClick={store.toggleRightPanel}
          style={{
            background: 'none', border: 'none', color: '#475569',
            cursor: 'pointer', padding: '7px 8px', fontSize: 14,
          }}
        >›</button>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {effectiveTab === 'assistant' && <AssistantTab />}
        {effectiveTab === 'stack' && <StackTab />}
        {effectiveTab === 'debug' && <DebugTab />}
      </div>
    </div>
  );
}
