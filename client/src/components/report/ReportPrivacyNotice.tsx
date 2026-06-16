import { REPORT_PRIVACY_NOTICE, REPORT_RETENTION_NOTICE } from '../../engine/reportService';
import React from 'react';

export function ReportPrivacyNotice() {
  return (
    <div
      data-testid="report-privacy-notice"
      style={{
        border: '1px solid #334155',
        background: '#0f172a',
        color: '#cbd5e1',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 11,
        lineHeight: 1.45,
      }}
    >
      <div>{REPORT_PRIVACY_NOTICE}</div>
      <div style={{ color: '#94a3b8', marginTop: 3 }}>{REPORT_RETENTION_NOTICE}</div>
    </div>
  );
}
