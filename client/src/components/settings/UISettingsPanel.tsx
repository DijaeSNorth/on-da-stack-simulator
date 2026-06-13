import { useGameStore, DEFAULT_UI_SETTINGS, type UISettings } from '../../store/gameStore';

const DENSITY_OPTIONS: Array<{ value: UISettings['density']; label: string; note: string }> = [
  { value: 'simple', label: 'Simple', note: 'Fewer badges, compact cards, minimal rules text.' },
  { value: 'normal', label: 'Normal', note: 'Default table readability.' },
  { value: 'detailed', label: 'Detailed', note: 'More hints and combat math.' },
  { value: 'judge', label: 'Judge', note: 'Advanced warnings and manual review surfaces.' },
];

export function UISettingsPanel() {
  const ui = useGameStore(s => s.ui);
  const updateUISettings = useGameStore(s => s.updateUISettings);
  const setUiSettingsOpen = useGameStore(s => s.setUiSettingsOpen);
  const setJudgeMode = useGameStore(s => s.setJudgeMode);
  const settings = ui.settings;

  if (!ui.uiSettingsOpen) return null;

  function updateDensity(density: UISettings['density']) {
    updateUISettings({
      density,
      showMechanicBadges: density === 'simple' ? false : settings.showMechanicBadges,
      showCombatMath: density === 'simple' ? false : density === 'detailed' || density === 'judge' ? true : settings.showCombatMath,
      showWarningBadges: density === 'judge' ? true : settings.showWarningBadges,
    });
  }

  return (
    <div data-testid="ui-settings-backdrop" style={backdropStyle} onClick={() => setUiSettingsOpen(false)}>
      <section data-testid="ui-settings-panel" style={panelStyle} onClick={event => event.stopPropagation()}>
        <header style={headerStyle}>
          <div>
            <div style={{ color: '#f8fafc', fontSize: 15, fontWeight: 900 }}>UI Settings</div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>Local display preferences only. Not synced over multiplayer.</div>
          </div>
          <button type="button" onClick={() => setUiSettingsOpen(false)} style={closeStyle}>x</button>
        </header>
        <div style={bodyStyle}>
          <div style={sectionStyle}>
            <Label>Density</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              {DENSITY_OPTIONS.map(option => (
                <button key={option.value} type="button" data-testid={`density-${option.value}`} onClick={() => updateDensity(option.value)} style={densityButtonStyle(settings.density === option.value)}>
                  <span style={{ fontWeight: 900 }}>{option.label}</span>
                  <span style={{ color: '#64748b', fontSize: 10, lineHeight: 1.25 }}>{option.note}</span>
                </button>
              ))}
            </div>
            {settings.density === 'judge' && !ui.judgeMode && (
              <button type="button" onClick={() => setJudgeMode(true)} style={judgeButtonStyle}>Enable existing Judge Mode</button>
            )}
          </div>
          <div style={sectionStyle}>
            <Label>Display</Label>
            <Toggle label="Mechanic badges" checked={settings.showMechanicBadges} onChange={showMechanicBadges => updateUISettings({ showMechanicBadges })} />
            <Toggle label="Combat math details" checked={settings.showCombatMath} onChange={showCombatMath => updateUISettings({ showCombatMath })} />
            <Toggle label="Warning badges" checked={settings.showWarningBadges} onChange={showWarningBadges => updateUISettings({ showWarningBadges })} />
            <Toggle label="Build stamp" checked={settings.showBuildStamp} onChange={showBuildStamp => updateUISettings({ showBuildStamp })} />
          </div>
          <div style={sectionStyle}>
            <Label>Large-board defaults</Label>
            <Toggle label="Collapse lands by default" checked={settings.collapseLandsByDefault} onChange={collapseLandsByDefault => updateUISettings({ collapseLandsByDefault })} />
            <Toggle label="Collapse tokens by default" checked={settings.collapseTokensByDefault} onChange={collapseTokensByDefault => updateUISettings({ collapseTokensByDefault })} />
            <NumberSetting label="Compact hand threshold" value={settings.compactHandThreshold} min={4} max={30} onChange={compactHandThreshold => updateUISettings({ compactHandThreshold })} />
            <NumberSetting label="Token stack threshold" value={settings.tokenStackThreshold} min={2} max={20} onChange={tokenStackThreshold => updateUISettings({ tokenStackThreshold })} />
          </div>
        </div>
        <footer style={footerStyle}>
          <button type="button" onClick={() => updateUISettings(DEFAULT_UI_SETTINGS)} style={secondaryButtonStyle}>Reset Defaults</button>
          <button type="button" onClick={() => setUiSettingsOpen(false)} style={primaryButtonStyle}>Done</button>
        </footer>
      </section>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>{children}</div>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label style={toggleStyle}><span>{label}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /></label>;
}
function NumberSetting({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label style={toggleStyle}><span>{label}</span><input type="number" min={min} max={max} value={value} onChange={event => onChange(Number.parseInt(event.target.value, 10) || min)} style={numberStyle} /></label>;
}

const backdropStyle: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 30000, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: 14 };
const panelStyle: React.CSSProperties = { width: 'min(430px, calc(100vw - 28px))', maxHeight: 'calc(100vh - 28px)', overflow: 'hidden', background: '#0f172a', border: '1px solid #334155', borderRadius: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.55)', display: 'flex', flexDirection: 'column' };
const headerStyle: React.CSSProperties = { padding: '14px 16px', borderBottom: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', gap: 10 };
const closeStyle: React.CSSProperties = { border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: 18 };
const bodyStyle: React.CSSProperties = { padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 };
const sectionStyle: React.CSSProperties = { border: '1px solid #1e293b', borderRadius: 10, padding: 12, background: 'rgba(2,6,23,0.36)' };
const footerStyle: React.CSSProperties = { padding: 12, borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end', gap: 8 };
const toggleStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', color: '#cbd5e1', fontSize: 12, padding: '6px 0' };
const numberStyle: React.CSSProperties = { width: 70, background: '#020617', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '4px 6px' };
const primaryButtonStyle: React.CSSProperties = { border: '1px solid #2563eb', background: '#1d4ed8', color: '#dbeafe', borderRadius: 8, padding: '7px 12px', fontWeight: 800, cursor: 'pointer' };
const secondaryButtonStyle: React.CSSProperties = { border: '1px solid #334155', background: '#111827', color: '#94a3b8', borderRadius: 8, padding: '7px 12px', fontWeight: 800, cursor: 'pointer' };
const judgeButtonStyle: React.CSSProperties = { marginTop: 8, border: '1px solid #92400e', background: '#78350f', color: '#fde68a', borderRadius: 8, padding: '7px 10px', fontWeight: 800, cursor: 'pointer', width: '100%' };
function densityButtonStyle(active: boolean): React.CSSProperties {
  return { textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, border: `1px solid ${active ? '#60a5fa' : '#334155'}`, background: active ? 'rgba(37,99,235,0.24)' : '#111827', color: active ? '#dbeafe' : '#cbd5e1', borderRadius: 9, padding: 9, cursor: 'pointer' };
}
