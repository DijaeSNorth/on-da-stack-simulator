import React, { useMemo, useState } from 'react';
import { createCodexTriageExport, createCodexTriageMarkdown } from '../../engine/reportExport';
import { clearLocalReports, isPlayerReport, loadLocalReports } from '../../engine/reportService';
import { cleanupExpiredLocalReports, shouldRunLocalReportCleanup } from '../../engine/firebaseReportService';
import { clusterReports, createClusterCodexPrompt } from '../../engine/reportTriage';
import type { PlayerReport } from '../../types/report';

export function ReportTriageExportPanel() {
  const [reports, setReports] = useState<PlayerReport[]>(() => loadLocalReports());
  const [importText, setImportText] = useState('');
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState('');

  const clusters = useMemo(() => clusterReports(reports), [reports]);
  const nextCleanup = shouldRunLocalReportCleanup() ? 'ready' : 'recently checked';

  function importReports() {
    try {
      const parsed = JSON.parse(importText);
      const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed.reports) ? parsed.reports : [parsed];
      const imported = values.filter(isPlayerReport);
      setReports(prev => [...imported, ...prev].filter((report, index, all) =>
        all.findIndex(candidate => candidate.reportId === report.reportId) === index
      ));
      setStatus(`Imported ${imported.length} report${imported.length === 1 ? '' : 's'}.`);
    } catch {
      setStatus('Import JSON could not be parsed.');
    }
  }

  function exportJson() {
    const triage = createCodexTriageExport(reports);
    setOutput(JSON.stringify(triage, null, 2));
    setStatus('Sanitized triage JSON ready.');
  }

  function exportMarkdown() {
    setOutput(createCodexTriageMarkdown(reports));
    setStatus('Sanitized triage Markdown ready.');
  }

  function copyPrompt() {
    const prompt = clusters[0] ? createClusterCodexPrompt(clusters[0]) : 'No report clusters available.';
    setOutput(prompt);
    void navigator.clipboard?.writeText(prompt).catch(() => {});
    setStatus('Codex prompt prepared for the top cluster.');
  }

  function cleanupLocal() {
    const result = cleanupExpiredLocalReports(reports);
    setReports(result.reports);
    setStatus(`Cleanup removed ${result.summary.deletedReportCount} expired local report${result.summary.deletedReportCount === 1 ? '' : 's'}.`);
  }

  function clearLocal() {
    clearLocalReports();
    setReports([]);
    setStatus('Local report cache cleared.');
  }

  return (
    <details data-testid="report-triage-export-panel" style={{ border: '1px solid #26323a', borderRadius: 6, padding: 8 }}>
      <summary style={{ cursor: 'pointer', color: '#93c5fd', fontSize: 12, fontWeight: 800 }}>
        Maintainer triage export
      </summary>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', color: '#94a3b8', fontSize: 11 }}>
          <span>Total reports: {reports.length}</span>
          <span>Clusters: {clusters.length}</span>
          <span>Cleanup: {nextCleanup}</span>
        </div>
        <textarea
          value={importText}
          onChange={event => setImportText(event.target.value)}
          placeholder="Paste local report JSON"
          style={inputStyle}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" onClick={importReports} style={smallButtonStyle}>Import JSON</button>
          <button type="button" onClick={exportJson} disabled={reports.length === 0} style={smallButtonStyle}>Export JSON</button>
          <button type="button" onClick={exportMarkdown} disabled={reports.length === 0} style={smallButtonStyle}>Export Markdown</button>
          <button type="button" onClick={copyPrompt} disabled={clusters.length === 0} style={smallButtonStyle}>Copy Prompt</button>
          <button type="button" onClick={cleanupLocal} style={smallButtonStyle}>Cleanup Local</button>
          <button type="button" onClick={clearLocal} style={dangerButtonStyle}>Clear Local</button>
        </div>
        {status && <div style={{ color: '#94a3b8', fontSize: 11 }}>{status}</div>}
        {output && <textarea readOnly value={output} style={{ ...inputStyle, minHeight: 120, fontFamily: 'Consolas, monospace' }} />}
      </div>
    </details>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 72,
  boxSizing: 'border-box',
  border: '1px solid #334155',
  borderRadius: 6,
  background: '#0f172a',
  color: '#e2e8f0',
  padding: 8,
  fontSize: 11,
};

const smallButtonStyle: React.CSSProperties = {
  border: '1px solid #334155',
  background: '#172033',
  color: '#cbd5e1',
  borderRadius: 5,
  padding: '5px 8px',
  fontSize: 11,
  cursor: 'pointer',
};

const dangerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: '1px solid #7f1d1d',
  background: '#2a1014',
  color: '#fca5a5',
};
