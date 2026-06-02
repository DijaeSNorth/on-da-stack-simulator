// ─── TutorialTooltip ──────────────────────────────────────────────────────────
// Reusable hover tooltip for new-player guidance.
// Wraps any element with a styled MTG-themed tooltip on hover.
// Respects global tutorial.enabled flag.
//
// Usage:
//   <TutorialTooltip content={TOOLTIPS.zone_graveyard}>
//     <ZoneBadge />
//   </TutorialTooltip>
//
// Props:
//   content    — TooltipContent object from tutorialStore
//   placement  — 'top' | 'bottom' | 'left' | 'right' (default: 'top')
//   delay      — ms before showing (default: 600)
//   disabled   — force-hide even if tutorials are on
//   inline     — render as inline (span) instead of block (div)

import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';
import type { TooltipContent } from '../../store/tutorialStore';
import { useTutorial } from '../../store/tutorialStore';

interface Props {
  content: TooltipContent;
  children: ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  disabled?: boolean;
  inline?: boolean;
  /** If true, show even if user has seen this step */
  alwaysShow?: boolean;
}

export function TutorialTooltip({
  content,
  children,
  placement = 'top',
  delay = 600,
  disabled = false,
  inline = false,
  alwaysShow = false,
}: Props) {
  const tutorial = useTutorial();
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapRef = useRef<HTMLElement>(null);

  const shouldShow = !disabled && tutorial.enabled &&
    (alwaysShow || !content.step || !tutorial.hasSeenStep(content.step));

  const show = useCallback(() => {
    if (!shouldShow) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [shouldShow, delay]);

  const hide = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  // Compute position relative to wrapper
  useEffect(() => {
    if (!visible || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const TIP_W = 260;
    const TIP_H = 120; // estimate

    let top = 0, left = 0;
    switch (placement) {
      case 'top':
        top = rect.top - TIP_H - 8;
        left = rect.left + rect.width / 2 - TIP_W / 2;
        break;
      case 'bottom':
        top = rect.bottom + 8;
        left = rect.left + rect.width / 2 - TIP_W / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - TIP_H / 2;
        left = rect.left - TIP_W - 8;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - TIP_H / 2;
        left = rect.right + 8;
        break;
    }

    // Clamp to viewport
    top = Math.max(8, Math.min(top, window.innerHeight - TIP_H - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - TIP_W - 8));
    setCoords({ top, left });
  }, [visible, placement]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const Wrapper = inline ? 'span' : 'div';

  return (
    <>
      <Wrapper
        ref={wrapRef as any}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        style={{ display: inline ? 'inline' : 'contents' }}
      >
        {children}
      </Wrapper>

      {visible && (
        <div
          role="tooltip"
          onMouseEnter={hide}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: 260,
            zIndex: 999999,
            background: 'linear-gradient(145deg, #1a1a2e 0%, #16213e 100%)',
            border: '1px solid #7c3aed',
            borderRadius: 10,
            boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(124,58,237,0.2)',
            padding: '10px 13px',
            pointerEvents: 'none',
            animation: 'tooltipFadeIn 0.15s ease',
          }}
        >
          {/* Arrow */}
          <ArrowIndicator placement={placement} />

          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 6,
          }}>
            <span style={{ fontSize: 13, color: '#a78bfa', userSelect: 'none' }}>📖</span>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#a78bfa',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>
              {content.title}
            </span>
          </div>

          {/* Body */}
          <p style={{
            margin: 0,
            fontSize: 12,
            color: '#cbd5e1',
            lineHeight: 1.5,
          }}>
            {content.body}
          </p>

          {/* Example */}
          {content.example && (
            <div style={{
              marginTop: 7,
              padding: '4px 8px',
              background: 'rgba(124,58,237,0.12)',
              borderLeft: '2px solid #7c3aed',
              borderRadius: '0 4px 4px 0',
              fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
              fontSize: 10,
              color: '#94a3b8',
              lineHeight: 1.4,
            }}>
              {content.example}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ArrowIndicator({ placement }: { placement: string }) {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 0,
    height: 0,
    borderStyle: 'solid',
  };
  if (placement === 'top') return <div style={{ ...base, bottom: -7, left: '50%', transform: 'translateX(-50%)', borderWidth: '7px 6px 0 6px', borderColor: '#7c3aed transparent transparent transparent' }} />;
  if (placement === 'bottom') return <div style={{ ...base, top: -7, left: '50%', transform: 'translateX(-50%)', borderWidth: '0 6px 7px 6px', borderColor: 'transparent transparent #7c3aed transparent' }} />;
  if (placement === 'left') return <div style={{ ...base, right: -7, top: '50%', transform: 'translateY(-50%)', borderWidth: '6px 0 6px 7px', borderColor: 'transparent transparent transparent #7c3aed' }} />;
  if (placement === 'right') return <div style={{ ...base, left: -7, top: '50%', transform: 'translateY(-50%)', borderWidth: '6px 7px 6px 0', borderColor: 'transparent #7c3aed transparent transparent' }} />;
  return null;
}
