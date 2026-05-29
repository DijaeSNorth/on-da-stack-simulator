// ─── CommandInput ─────────────────────────────────────────────────────────────
// Bottom-bar natural language command bar.
// Features: autocomplete dropdown, command history (↑↓), suggestion chips.
// Wired to useNLPCommand + useCombatFlow.
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback, useEffect } from 'react';
import { useNLPCommand } from '../../hooks/useNLPCommand';
import { useCombatFlow } from '../../hooks/useCombatFlow';
import { CombatPanel } from '../combat/CombatPanel';
import type { ResolvedIntent } from '../../engine/nlpParser';

const MAX_HISTORY = 50;
const MAX_SUGGESTIONS = 8;

export function CommandInput() {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [feedback, setFeedback] = useState<{ text: string; success: boolean } | null>(null);
  const [completions, setCompletions] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout>>();

  const { combatFlow, handleCombatIntent, closeCombat } = useCombatFlow();

  const onCombatIntent = useCallback((intent: ResolvedIntent) => {
    handleCombatIntent(intent);
  }, [handleCombatIntent]);

  const { execute, suggestions } = useNLPCommand(onCombatIntent);

  // ── Autocomplete ────────────────────────────────────────────────────────────

  const updateCompletions = useCallback((val: string) => {
    if (!val.trim()) {
      setCompletions([]);
      setDropdownOpen(false);
      return;
    }
    const hits = suggestions(val).slice(0, MAX_SUGGESTIONS);
    setCompletions(hits);
    setDropdownOpen(hits.length > 0);
    setActiveIdx(-1);
  }, [suggestions]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setValue(val);
    setHistoryIdx(-1);
    updateCompletions(val);
  }, [updateCompletions]);

  // ── Execute ─────────────────────────────────────────────────────────────────

  const submit = useCallback((cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    // Add to history (deduplicate consecutive)
    setHistory(prev => {
      const deduped = prev[0] === trimmed ? prev : [trimmed, ...prev].slice(0, MAX_HISTORY);
      return deduped;
    });
    setHistoryIdx(-1);
    setValue('');
    setDropdownOpen(false);

    const result = execute(trimmed);
    setFeedback({ text: result.message, success: result.success });
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 3000);
  }, [execute]);

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Submit
    if (e.key === 'Enter') {
      e.preventDefault();
      if (dropdownOpen && activeIdx >= 0 && completions[activeIdx]) {
        submit(completions[activeIdx]);
      } else {
        submit(value);
      }
      return;
    }

    // Escape
    if (e.key === 'Escape') {
      setDropdownOpen(false);
      setActiveIdx(-1);
      return;
    }

    // Dropdown navigation
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (dropdownOpen) {
        setActiveIdx(i => Math.min(i + 1, completions.length - 1));
      } else {
        updateCompletions(value);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (dropdownOpen && activeIdx > 0) {
        setActiveIdx(i => i - 1);
        return;
      }
      // History navigation when dropdown is closed or at top
      if (!dropdownOpen || activeIdx <= 0) {
        setDropdownOpen(false);
        const nextIdx = historyIdx + 1;
        if (nextIdx < history.length) {
          setHistoryIdx(nextIdx);
          setValue(history[nextIdx]);
        }
      }
      return;
    }

    // Tab — accept first completion
    if (e.key === 'Tab' && dropdownOpen && completions.length > 0) {
      e.preventDefault();
      const pick = completions[Math.max(activeIdx, 0)];
      setValue(pick);
      setDropdownOpen(false);
      inputRef.current?.focus();
    }
  }, [dropdownOpen, activeIdx, completions, value, history, historyIdx, submit, updateCompletions]);

  const selectCompletion = useCallback((text: string) => {
    submit(text);
    inputRef.current?.focus();
  }, [submit]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = document.getElementById('command-input-root');
      if (el && !el.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Suggestion chips (contextual, shown when input is empty) ────────────────

  const chipSuggestions = !value ? suggestions('').slice(0, 6) : [];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Combat panel overlay */}
      {combatFlow.panelOpen && (
        <CombatPanel
          attackerIds={combatFlow.attackerIds}
          preAssignments={combatFlow.preAssignments}
          onClose={closeCombat}
        />
      )}

      {/* Command bar */}
      <div
        id="command-input-root"
        style={{
          position: 'relative',
          background: '#0f172a',
          borderTop: '1px solid #1e293b',
          padding: '8px 12px',
          flexShrink: 0,
        }}
      >
        {/* Suggestion chips */}
        {chipSuggestions.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
            {chipSuggestions.map(chip => (
              <button
                key={chip}
                onClick={() => submit(chip)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  border: '1px solid #334155',
                  background: '#1e293b',
                  color: '#94a3b8',
                  fontSize: 11,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, color 0.15s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#475569';
                  (e.currentTarget as HTMLButtonElement).style.color = '#e2e8f0';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#334155';
                  (e.currentTarget as HTMLButtonElement).style.color = '#94a3b8';
                }}
              >
                {chip}
              </button>
            ))}
          </div>
        )}

        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#475569', fontSize: 14, userSelect: 'none', flexShrink: 0 }}>⌘</span>
          <input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => value && updateCompletions(value)}
            placeholder={`Type a command… "attack with Goblin Guide, Mayhem Devil" · "cast Sol Ring" · "draw 3"`}
            autoComplete="off"
            spellCheck={false}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e2e8f0',
              fontSize: 13,
              fontFamily: 'inherit',
              caretColor: '#38bdf8',
            }}
          />
          {value && (
            <button
              onClick={() => { setValue(''); setDropdownOpen(false); inputRef.current?.focus(); }}
              style={{
                color: '#475569', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 4px',
              }}
            >
              ✕
            </button>
          )}
          {value && (
            <button
              onClick={() => submit(value)}
              style={{
                padding: '4px 14px',
                borderRadius: 8,
                border: '1px solid #334155',
                background: '#1e293b',
                color: '#e2e8f0',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
                flexShrink: 0,
              }}
            >
              Run ↵
            </button>
          )}
        </div>

        {/* Autocomplete dropdown */}
        {dropdownOpen && completions.length > 0 && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            left: 12,
            right: 12,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 -8px 24px rgba(0,0,0,0.5)',
            zIndex: 100,
            marginBottom: 4,
          }}>
            {completions.map((c, i) => (
              <button
                key={c}
                onClick={() => selectCompletion(c)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  width: '100%',
                  padding: '9px 14px',
                  textAlign: 'left',
                  background: i === activeIdx ? '#334155' : 'transparent',
                  border: 'none',
                  color: i === activeIdx ? '#e2e8f0' : '#94a3b8',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  borderBottom: i < completions.length - 1 ? '1px solid #0f172a' : 'none',
                  transition: 'background 0.1s',
                }}
              >
                <HighlightMatch text={c} query={value} />
              </button>
            ))}
          </div>
        )}

        {/* Feedback toast */}
        {feedback && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            right: 12,
            marginBottom: 8,
            padding: '6px 14px',
            borderRadius: 8,
            background: feedback.success ? '#14532d' : '#450a0a',
            border: `1px solid ${feedback.success ? '#166534' : '#7f1d1d'}`,
            color: feedback.success ? '#86efac' : '#fca5a5',
            fontSize: 12,
            fontFamily: 'inherit',
            pointerEvents: 'none',
            zIndex: 101,
            maxWidth: 320,
            animation: 'fadeIn 0.15s ease',
          }}>
            {feedback.success ? '✓ ' : '✗ '}{feedback.text}
          </div>
        )}
      </div>
    </>
  );
}

// ── Highlight matching portion of a suggestion ────────────────────────────────

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ color: '#38bdf8', fontWeight: 600 }}>{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}
