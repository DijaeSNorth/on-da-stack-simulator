import { useEffect, useRef, useState } from 'react';
import { useTutorial } from '../../store/tutorialStore';

interface HelpState {
  title: string;
  body: string;
  example?: string;
  top: number;
  left: number;
}

const WIDTH = 280;
const ESTIMATED_HEIGHT = 132;
const DEFAULT_DELAY = 900;

export function GlobalHelpTooltip() {
  const tutorial = useTutorial();
  const [help, setHelp] = useState<HelpState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const activeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!tutorial.enabled) {
      clearTimeout(timerRef.current);
      activeRef.current = null;
      setHelp(null);
      return;
    }

    const clear = () => {
      clearTimeout(timerRef.current);
      activeRef.current = null;
      setHelp(null);
    };

    const findHelpTarget = (target: EventTarget | null) => {
      return target instanceof HTMLElement
        ? target.closest<HTMLElement>('[data-help-title]')
        : null;
    };

    const schedule = (target: HTMLElement) => {
      const title = target.dataset.helpTitle;
      const body = target.dataset.helpBody;
      if (!title || !body) return;
      clearTimeout(timerRef.current);
      activeRef.current = target;
      const delay = Number(target.dataset.helpDelay ?? DEFAULT_DELAY);

      timerRef.current = setTimeout(() => {
        if (activeRef.current !== target) return;
        const rect = target.getBoundingClientRect();
        const placement = target.dataset.helpPlacement ?? 'top';
        let top = placement === 'bottom'
          ? rect.bottom + 10
          : rect.top - ESTIMATED_HEIGHT - 10;
        let left = rect.left + rect.width / 2 - WIDTH / 2;

        if (placement === 'left') {
          top = rect.top + rect.height / 2 - ESTIMATED_HEIGHT / 2;
          left = rect.left - WIDTH - 10;
        } else if (placement === 'right') {
          top = rect.top + rect.height / 2 - ESTIMATED_HEIGHT / 2;
          left = rect.right + 10;
        }

        top = Math.max(8, Math.min(top, window.innerHeight - ESTIMATED_HEIGHT - 8));
        left = Math.max(8, Math.min(left, window.innerWidth - WIDTH - 8));
        setHelp({
          title,
          body,
          example: target.dataset.helpExample,
          top,
          left,
        });
      }, Number.isFinite(delay) ? delay : DEFAULT_DELAY);
    };

    const onMouseOver = (event: MouseEvent) => {
      const target = findHelpTarget(event.target);
      if (target) schedule(target);
    };
    const onMouseOut = (event: MouseEvent) => {
      const active = activeRef.current;
      if (!active) return;
      if (event.relatedTarget instanceof Node && active.contains(event.relatedTarget)) return;
      clear();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = findHelpTarget(event.target);
      if (target) schedule(target);
    };
    const onFocusOut = clear;

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('resize', clear);

    return () => {
      clear();
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('scroll', clear, true);
      window.removeEventListener('resize', clear);
    };
  }, [tutorial.enabled]);

  if (!help) return null;

  return (
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        top: help.top,
        left: help.left,
        width: WIDTH,
        zIndex: 999999,
        pointerEvents: 'none',
        background: 'linear-gradient(145deg, #10161a 0%, #0b0f12 100%)',
        border: '1px solid #22d3ee',
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(34,211,238,0.18)',
        padding: '10px 13px',
        animation: 'tooltipFadeIn 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: '#67e8f9', userSelect: 'none' }}>?</span>
        <span style={{
          fontSize: 11,
          fontWeight: 800,
          color: '#67e8f9',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          {help.title}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
        {help.body}
      </p>
      {help.example && (
        <div style={{
          marginTop: 7,
          padding: '4px 8px',
          background: 'rgba(34,211,238,0.1)',
          borderLeft: '2px solid #22d3ee',
          borderRadius: '0 4px 4px 0',
          fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
          fontSize: 10,
          color: '#94a3b8',
          lineHeight: 1.4,
        }}>
          {help.example}
        </div>
      )}
    </div>
  );
}
