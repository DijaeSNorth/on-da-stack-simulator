// ─── PreflightModal ────────────────────────────────────────────────────────────
// Shows safety check results before game start.
// Never hard-blocks (only errors block the Start button, not the dismiss).

import type { PreflightResult, SafetyIssue, PowerAnalysis } from '../../engine/safetyChecks';

interface Props {
  result: PreflightResult;
  onProceed: () => void;   // user confirmed, start anyway
  onCancel: () => void;    // go back to lobby
}

export function PreflightModal({ result, onProceed, onCancel }: Props) {
  const { issues, blocked, powerLevels } = result;
  const errors   = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warn');
  const infos    = issues.filter(i => i.severity === 'info');
  const hasIssues = issues.length > 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 560,
        background: '#0d1117',
        border: `1px solid ${blocked ? '#7f1d1d' : warnings.length > 0 ? '#78350f' : '#166534'}`,
        borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 20px',
          background: blocked ? '#1c0a0a' : warnings.length > 0 ? '#1c1500' : '#0a1a0f',
          borderBottom: '1px solid #1e293b',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 20 }}>
            {blocked ? '🚫' : warnings.length > 0 ? '⚠️' : '✅'}
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>
              {blocked ? 'Cannot Start — Fix Required' : warnings.length > 0 ? 'Review Before Starting' : 'Ready to Start'}
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
              Pre-game safety check · Judge Assistant
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, maxHeight: '60vh', overflowY: 'auto' }}>

          {/* No issues */}
          {!hasIssues && powerLevels.length === 0 && (
            <div style={{ fontSize: 13, color: '#4ade80', textAlign: 'center', padding: '8px 0' }}>
              All checks passed. Good luck!
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <IssueGroup
              label="Must Fix"
              color="#f87171"
              bg="#2d0a0a"
              border="#7f1d1d"
              issues={errors}
            />
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <IssueGroup
              label="Warnings"
              color="#fcd34d"
              bg="#1c1500"
              border="#78350f"
              issues={warnings}
            />
          )}

          {/* Info */}
          {infos.length > 0 && (
            <IssueGroup
              label="Notes"
              color="#60a5fa"
              bg="#0f1a2d"
              border="#1e3a5f"
              issues={infos}
            />
          )}

          {/* Power Level Table */}
          {powerLevels.length > 0 && (
            <div>
              <div style={{
                fontSize: 10, color: '#475569', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8,
              }}>
                Power Level Estimates
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {powerLevels.map(a => (
                  <PowerRow key={a.seatIndex} analysis={a} />
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 8, lineHeight: 1.5 }}>
                Estimates are based on fast mana, tutors, win conditions, and avg CMC.
                These are suggestions for your Rule Zero conversation — not restrictions.
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #1e293b',
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', borderRadius: 6, cursor: 'pointer',
              border: '1px solid #334155', background: 'transparent',
              color: '#94a3b8', fontSize: 13,
            }}
          >
            ← Back to Lobby
          </button>

          {!blocked && (
            <button
              data-testid="btn-preflight-proceed"
              onClick={onProceed}
              style={{
                padding: '8px 22px', borderRadius: 6, cursor: 'pointer',
                background: warnings.length > 0
                  ? 'linear-gradient(135deg, #92400e, #78350f)'
                  : 'linear-gradient(135deg, #1d4ed8, #7c3aed)',
                color: '#fff', border: 'none',
                fontSize: 13, fontWeight: 800,
                boxShadow: '0 2px 10px rgba(124,58,237,0.3)',
              }}
            >
              {warnings.length > 0 ? 'Start Anyway' : 'Start Game'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function IssueGroup({ label, color, bg, border, issues }: {
  label: string;
  color: string;
  bg: string;
  border: string;
  issues: SafetyIssue[];
}) {
  return (
    <div>
      <div style={{
        fontSize: 10, color, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {issues.map(issue => (
          <div
            key={issue.id}
            style={{
              background: bg,
              border: `1px solid ${border}`,
              borderRadius: 7, padding: '10px 12px',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 3 }}>
              {issue.title}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.55 }}>
              {issue.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PowerRow({ analysis }: { analysis: PowerAnalysis }) {
  const bracketColor: Record<string, string> = {
    'Casual':     '#4ade80',
    'Mid Power':  '#60a5fa',
    'High Power': '#fcd34d',
    'cEDH':       '#f87171',
  };
  const color = bracketColor[analysis.bracket] ?? '#94a3b8';

  return (
    <div style={{
      background: '#111827',
      border: '1px solid #1e293b',
      borderRadius: 7, padding: '10px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{analysis.playerName}</span>
          <span style={{ fontSize: 10, color: '#475569', marginLeft: 6 }}>{analysis.deckName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Score bar */}
          <div style={{ width: 80, height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${analysis.score * 10}%`,
              background: color,
              borderRadius: 3,
              transition: 'width 0.4s',
            }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color, minWidth: 28, textAlign: 'right' }}>
            {analysis.score}/10
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: `${color}22`, color, border: `1px solid ${color}55`,
          }}>
            {analysis.bracket}
          </span>
        </div>
      </div>
      {/* Evidence bullets */}
      {analysis.reasons.map((r, i) => (
        <div key={i} style={{ fontSize: 10, color: '#475569', lineHeight: 1.4 }}>
          · {r}
        </div>
      ))}
    </div>
  );
}
