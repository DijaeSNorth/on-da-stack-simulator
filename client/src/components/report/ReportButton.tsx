import React, { useState } from 'react';
import type { PlayerReportType } from '../../types/report';
import { ReportModal } from './ReportModal';

interface ReportButtonProps {
  defaultType?: PlayerReportType;
  defaultTitle?: string;
  defaultComponent?: string;
  defaultActionType?: string;
  variant?: 'topbar' | 'inline';
  label?: string;
}

export function ReportButton({
  defaultType = 'bug',
  defaultTitle = '',
  defaultComponent,
  defaultActionType,
  variant = 'inline',
  label = 'Report',
}: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="btn-open-report-modal"
        aria-label="Open player report"
        title="Report an issue or feedback"
        onClick={() => setOpen(true)}
        style={variant === 'topbar' ? topbarButtonStyle : inlineButtonStyle}
      >
        {label}
      </button>
      <ReportModal
        open={open}
        onClose={() => setOpen(false)}
        defaultType={defaultType}
        defaultTitle={defaultTitle}
        defaultComponent={defaultComponent}
        defaultActionType={defaultActionType}
      />
    </>
  );
}

const topbarButtonStyle: React.CSSProperties = {
  background: 'none',
  color: '#fca5a5',
  border: '1px solid #26323a',
  borderRadius: 4,
  padding: '3px 8px',
  fontSize: 10,
  cursor: 'pointer',
  fontWeight: 700,
  lineHeight: 1.4,
};

const inlineButtonStyle: React.CSSProperties = {
  border: '1px solid #7f1d1d',
  background: '#2a1014',
  color: '#fecaca',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};
