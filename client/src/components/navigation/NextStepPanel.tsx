import type { NextStep } from './navigationFlowModel';

interface NextStepPanelProps {
  breadcrumb?: string[];
  step: NextStep;
  onAction?: () => void;
}

export function NextStepPanel({ breadcrumb, step, onAction }: NextStepPanelProps) {
  return (
    <section
      data-testid="next-step-panel"
      aria-label="Recommended next step"
      style={{
        border: '1px solid #26323a',
        background: 'linear-gradient(135deg, rgba(14,116,144,0.18), rgba(15,23,42,0.95))',
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
      }}
    >
      {breadcrumb && breadcrumb.length > 0 ? (
        <div data-testid="breadcrumbs" style={{ fontSize: 10, color: '#64748b', marginBottom: 6, fontWeight: 800 }}>
          {breadcrumb.join(' > ')}
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, color: '#67e8f9', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 900 }}>
            Next step
          </div>
          <div data-testid="next-step-action" style={{ color: '#f8fafc', fontSize: 15, fontWeight: 900, marginTop: 2 }}>
            {step.label}
          </div>
          {step.detail ? <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>{step.detail}</div> : null}
        </div>
        {step.ctaLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            data-testid="next-step-cta"
            style={{
              border: '1px solid #0e7490',
              background: '#123642',
              color: '#a5f3fc',
              borderRadius: 6,
              padding: '7px 10px',
              fontSize: 11,
              fontWeight: 800,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {step.ctaLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}
