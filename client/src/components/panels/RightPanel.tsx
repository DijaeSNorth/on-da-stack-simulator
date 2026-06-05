import { useGameStore } from '../../store/gameStore';
import type { AssistantMessage } from '../../store/gameStore';
import type { StackObject, TriggerItem } from '../../types/game';

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

function AssistantTab() {
  const messages = useGameStore(s => s.ui.assistantMessages);
  const game = useGameStore(s => s.game);
  const store = useGameStore();
  const reversed = [...messages].reverse();
  const pendingTriggers = game.triggerQueue.filter(t => !t.acknowledged);
  const missedTriggers = game.triggerQueue.filter(t => t.missed);

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
      {reversed.length === 0 ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#334155', fontSize: 12, fontStyle: 'italic', textAlign: 'center', padding: 16,
        }}>
          <div>The judge is watching.</div>
          <div style={{ fontSize: 10, marginTop: 6, color: '#1e293b' }}>
            Actions will be evaluated here.
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
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
        </div>
      )}
    </div>
  );
}

function StackTab() {
  const store = useGameStore();
  const { game } = store;
  const stack = game.stack;

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
      <TriggersTab embedded />
    </div>
  );
}

function LogTab() {
  const { game } = useGameStore();
  const log = [...game.actionLog].reverse().slice(0, 100);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
      {log.map((action, i) => {
        const player = game.players.find(p => p.id === action.playerId);
        const isFlag = action.flags?.length > 0;
        return (
          <div
            key={action.id}
            style={{
              display: 'flex',
              gap: 6,
              padding: '3px 0',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              opacity: action.undone ? 0.4 : 1,
            }}
          >
            <div style={{ fontSize: 9, color: '#334155', flexShrink: 0, paddingTop: 1 }}>
              T{action.turn}
            </div>
            <div>
              <div style={{ fontSize: 10, color: isFlag ? '#f59e0b' : '#94a3b8', lineHeight: 1.3 }}>
                {action.description}
                {action.undone && <span style={{ color: '#6b7280' }}> [undone]</span>}
              </div>
              {player && (
                <div style={{ fontSize: 9, color: '#475569' }}>
                  {player.name} · {action.phase}
                </div>
              )}
            </div>
          </div>
        );
      })}
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

const debugBtnStyle: React.CSSProperties = {
  fontSize: 9, padding: '3px 8px',
  background: '#1e293b', color: '#94a3b8',
  border: '1px solid #334155', borderRadius: 3, cursor: 'pointer',
};

const TABS: { id: string; label: string }[] = [
  { id: 'assistant', label: 'Judge' },
  { id: 'stack', label: 'Stack' },
  { id: 'log', label: 'Log' },
  { id: 'debug', label: 'Tools' },
];

export function RightPanel() {
  const store = useGameStore();
  const { ui, game } = store;

  if (!ui.rightPanelOpen) return null;

  const pendingTriggers = game.triggerQueue.filter(t => !t.acknowledged).length;
  const effectiveTab = ui.rightPanelTab === 'triggers' ? 'stack' : ui.rightPanelTab;

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
        {effectiveTab === 'log' && <LogTab />}
        {effectiveTab === 'debug' && <DebugTab />}
      </div>
    </div>
  );
}
