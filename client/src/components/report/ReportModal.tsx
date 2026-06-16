import React, { useEffect, useMemo, useState } from 'react';
import { submitPlayerReport } from '../../engine/firebaseReportService';
import { buildSanitizedGitHubIssueUrlFromReport } from '../../engine/issueReport';
import {
  buildPlayerReport,
  exportPlayerReportJson,
  REPORT_PRIVACY_NOTICE,
} from '../../engine/reportService';
import { useGameStore } from '../../store/gameStore';
import type { PlayerReport, PlayerReportInput, PlayerReportPrivacyMode, PlayerReportSeverity, PlayerReportType } from '../../types/report';
import { ReportPrivacyNotice } from './ReportPrivacyNotice';
import { ReportTriageExportPanel } from './ReportTriageExportPanel';

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  defaultType?: PlayerReportType;
  defaultTitle?: string;
  defaultComponent?: string;
  defaultActionType?: string;
}

const REPORT_TYPES: { id: PlayerReportType; label: string }[] = [
  { id: 'bug', label: 'Bug' },
  { id: 'multiplayer_connection', label: 'Connection' },
  { id: 'multiplayer_desync', label: 'Desync' },
  { id: 'rules_issue', label: 'Rules issue' },
  { id: 'deck_import', label: 'Deck import' },
  { id: 'player_behavior', label: 'Player behavior' },
  { id: 'cheating', label: 'Cheating' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'other', label: 'Other' },
];

const SEVERITIES: PlayerReportSeverity[] = ['low', 'medium', 'high', 'critical'];
const PRIVATE_TYPES = new Set<PlayerReportType>(['player_behavior', 'cheating']);

export function ReportModal({
  open,
  onClose,
  defaultType = 'bug',
  defaultTitle = '',
  defaultComponent,
  defaultActionType,
}: ReportModalProps) {
  const store = useGameStore();
  const [type, setType] = useState<PlayerReportType>(defaultType);
  const [severity, setSeverity] = useState<PlayerReportSeverity>('medium');
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [reportedPlayerId, setReportedPlayerId] = useState('');
  const [component, setComponent] = useState(defaultComponent ?? '');
  const [privacyMode, setPrivacyMode] = useState<PlayerReportPrivacyMode>('private');
  const [includeActionLog, setIncludeActionLog] = useState(true);
  const [includePublicSnapshot, setIncludePublicSnapshot] = useState(false);
  const [includePrivateZones, setIncludePrivateZones] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastReport, setLastReport] = useState<PlayerReport | null>(null);

  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setTitle(defaultTitle);
    setComponent(defaultComponent ?? '');
    setStatus('');
    setLastReport(null);
  }, [defaultComponent, defaultTitle, defaultType, open]);

  useEffect(() => {
    if (PRIVATE_TYPES.has(type)) {
      setPrivacyMode('private');
    }
  }, [type]);

  const canOpenGitHub = useMemo(() =>
    Boolean(lastReport && buildSanitizedGitHubIssueUrlFromReport(lastReport))
  , [lastReport]);

  if (!open) return null;

  function buildInput(): PlayerReportInput {
    return {
      type,
      severity,
      title,
      description,
      contactEmail,
      reportedPlayerId,
      component,
      actionType: defaultActionType,
      privacyMode,
      includeActionLog,
      includePublicSnapshot,
      includePrivateZones,
    };
  }

  function buildCurrentReport(): PlayerReport {
    return buildPlayerReport({
      game: store.game,
      ui: store.ui,
      multiplayer: store.multiplayer,
      localPlayerId: store.localPlayerId || store.multiplayer.playerId || undefined,
      input: buildInput(),
      browserInfo: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    });
  }

  async function submit() {
    if (!title.trim() || !description.trim()) {
      setStatus('Add a title and description before submitting.');
      return;
    }
    setBusy(true);
    const report = buildCurrentReport();
    setLastReport(report);
    const result = await submitPlayerReport(report);
    setBusy(false);
    if (result.ok && result.submittedToFirebase) {
      setStatus('Report submitted. Local export is still available if you want a copy.');
    } else if (result.ok) {
      setStatus(result.error ?? 'Report saved locally.');
    } else {
      setStatus(result.error ?? 'Report could not be submitted. Use local export.');
    }
  }

  function copyJson() {
    const report = lastReport ?? buildCurrentReport();
    setLastReport(report);
    const raw = exportPlayerReportJson(report);
    void navigator.clipboard?.writeText(raw).catch(() => {});
    setStatus('Report JSON copied locally.');
  }

  function downloadJson() {
    const report = lastReport ?? buildCurrentReport();
    setLastReport(report);
    const blob = new Blob([exportPlayerReportJson(report)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${report.reportId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus('Report JSON downloaded.');
  }

  function openGitHubFallback() {
    const report = lastReport ?? buildCurrentReport();
    setLastReport(report);
    const url = buildSanitizedGitHubIssueUrlFromReport(report);
    if (!url) {
      setStatus('Sanitized GitHub fallback is unavailable for private report types.');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      data-testid="report-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Player report"
      style={backdropStyle}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div data-testid="report-modal" style={modalStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#f8fafc' }}>Player Report</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{REPORT_PRIVACY_NOTICE}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close report modal" style={iconButtonStyle}>x</button>
        </div>

        <ReportPrivacyNotice />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Type">
            <select value={type} onChange={event => setType(event.target.value as PlayerReportType)} style={inputStyle}>
              {REPORT_TYPES.map(reportType => <option key={reportType.id} value={reportType.id}>{reportType.label}</option>)}
            </select>
          </Field>
          <Field label="Severity">
            <select value={severity} onChange={event => setSeverity(event.target.value as PlayerReportSeverity)} style={inputStyle}>
              {SEVERITIES.map(value => <option key={value} value={value}>{value}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Title">
          <input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} style={inputStyle} />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="What happened?"
            maxLength={3000}
            style={{ ...inputStyle, minHeight: 96, resize: 'vertical' }}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Contact email optional">
            <input value={contactEmail} onChange={event => setContactEmail(event.target.value)} maxLength={120} style={inputStyle} />
          </Field>
          <Field label="Reported player optional">
            <select value={reportedPlayerId} onChange={event => setReportedPlayerId(event.target.value)} style={inputStyle}>
              <option value="">None</option>
              {store.game.players.map(player => <option key={player.id} value={player.id}>{player.name}</option>)}
            </select>
          </Field>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Component optional">
            <input value={component} onChange={event => setComponent(event.target.value)} maxLength={80} style={inputStyle} />
          </Field>
          <Field label="Privacy">
            <select
              value={privacyMode}
              onChange={event => setPrivacyMode(event.target.value as PlayerReportPrivacyMode)}
              disabled={PRIVATE_TYPES.has(type)}
              style={inputStyle}
            >
              <option value="private">Private report</option>
              <option value="sanitized_public">Sanitized public fallback</option>
              <option value="local_export_only">Local export only</option>
            </select>
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Check label="Action log" checked={includeActionLog} onChange={setIncludeActionLog} />
          <Check label="Public snapshot" checked={includePublicSnapshot} onChange={setIncludePublicSnapshot} />
          <Check label="Private zones" checked={includePrivateZones} onChange={setIncludePrivateZones} />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" data-testid="btn-submit-player-report" onClick={() => void submit()} disabled={busy} style={primaryButtonStyle}>
            {busy ? 'Submitting...' : 'Submit Report'}
          </button>
          <button type="button" onClick={copyJson} style={secondaryButtonStyle}>Copy JSON</button>
          <button type="button" onClick={downloadJson} style={secondaryButtonStyle}>Download JSON</button>
          <button type="button" onClick={openGitHubFallback} disabled={!canOpenGitHub && !['bug', 'rules_issue'].includes(type)} style={secondaryButtonStyle}>
            Sanitized GitHub
          </button>
        </div>

        {status && <div data-testid="report-submit-status" style={{ fontSize: 11, color: '#93c5fd' }}>{status}</div>}

        <ReportTriageExportPanel />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#cbd5e1', fontSize: 11 }}>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 40000,
  background: 'rgba(2,6,23,0.72)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
};

const modalStyle: React.CSSProperties = {
  width: 'min(620px, 96vw)',
  maxHeight: '92vh',
  overflow: 'auto',
  display: 'grid',
  gap: 10,
  background: '#0b0f12',
  border: '1px solid #334155',
  borderRadius: 8,
  boxShadow: '0 20px 70px rgba(0,0,0,0.48)',
  padding: 14,
};

const labelStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid #334155',
  borderRadius: 6,
  background: '#111827',
  color: '#e2e8f0',
  padding: '7px 9px',
  fontSize: 12,
};

const primaryButtonStyle: React.CSSProperties = {
  border: '1px solid #2563eb',
  background: '#1d4ed8',
  color: '#eff6ff',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  border: '1px solid #334155',
  background: '#172033',
  color: '#cbd5e1',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 12,
  cursor: 'pointer',
};

const iconButtonStyle: React.CSSProperties = {
  border: '1px solid #334155',
  background: '#111827',
  color: '#94a3b8',
  borderRadius: 5,
  width: 26,
  height: 26,
  cursor: 'pointer',
};
