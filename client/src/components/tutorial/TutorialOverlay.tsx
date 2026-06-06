// ─── TutorialOverlay ──────────────────────────────────────────────────────────
// Two modes:
//
// 1. WELCOME MODAL — shown once on first launch. Explains what the app is,
//    gives 3 key tips, offers to start the walkthrough or skip.
//
// 2. COACH MARK — lightweight step-by-step cards positioned near the UI element
//    they describe. Shown during the guided walkthrough. No spotlight/dim —
//    keeps gameplay fully visible so players can follow along.

import { useTutorial } from '../../store/tutorialStore';
import type { TutorialStep } from '../../store/tutorialStore';

// ─── Step content ─────────────────────────────────────────────────────────────

interface StepCard {
  title: string;
  body: string;
  tip?: string;
  example?: string;
  position: 'center' | 'top' | 'bottom' | 'left' | 'right';
  anchor?: string; // CSS selector for the element to point near (best-effort)
}

const STEP_CARDS: Partial<Record<TutorialStep, StepCard>> = {
  welcome: {
    title: 'Welcome to On-Da-Stack',
    body: 'A Commander simulator designed to feel like a real game table — not a video game.\n\nYou always control the game flow. The built-in judge watches for rules issues and suggestions, but never blocks your actions.',
    tip: 'New player? Hit "Start Tour" for a quick 60-second walkthrough.',
    position: 'center',
  },
  phase_bar: {
    title: 'Phase Guide Bar',
    body: 'The bar at the top shows which phase you\'re in. Click any phase pill to jump there, or use the Next Phase button to advance.\n\nPhase hints and reminders update automatically.',
    tip: 'The simulator never auto-advances phases — you stay in control.',
    example: 'Click "Main 1" → cast spells → click "Combat"',
    position: 'top',
  },
  hand: {
    title: 'Your Hand',
    body: 'Cards fan out at the bottom of the screen. Hover to preview art and rules text. Right-click any card for a full action menu — cast, cycle, discard, or move it anywhere.',
    tip: 'Drag a card from your hand onto the battlefield to cast it instantly.',
    position: 'bottom',
  },
  command_bar: {
    title: 'Command Bar',
    body: 'The most powerful feature. Type anything in plain English — the judge assistant parses it.\n\nUse it to attack, cast, draw, scry, create tokens, adjust life totals, and more.',
    example: '"attack with Goblin Guide" · "scry 3" · "create 2 goblin tokens" · "gain 5 life"',
    tip: 'Press ↑ to scroll command history. Tab to autocomplete.',
    position: 'bottom',
  },
  zones: {
    title: 'Zone Badges',
    body: 'Each player\'s area shows badges for their graveyard, exile, and library counts. Click any badge to open that zone.\n\nFrom inside, you can flashback, reanimate, or move individual cards.',
    tip: 'Right-click a card inside a zone for the full action menu.',
    position: 'bottom',
  },
  right_panel: {
    title: 'Judge Panel',
    body: 'The right panel keeps Judge flags and the action log together, with Stack for spells and triggers, plus Tools for sandbox actions.\n\nThe assistant never blocks your moves — it only advises.',
    tip: 'Use Judge / Log to review both flagged mistakes and the full table history.',
    position: 'right',
  },
  left_panel: {
    title: 'Players & Decks',
    body: 'The left panel shows all players at the table — life totals, commander damage, and deck info.\n\nClick any player\'s life total to edit it directly.',
    tip: 'Commander damage tracks automatically when your commander deals combat damage.',
    position: 'left',
  },
  context_menu: {
    title: 'Right-Click Menus',
    body: 'Right-click any card for smart action buttons. Options change based on where the card is:\n\n• On battlefield: tap, attack, add counters, token shortcuts\n• In graveyard: cast from GY, reanimate, return to hand\n• In exile: cast from exile, put onto battlefield',
    tip: 'Tier badges (T1/T2/T3) show how common a mechanic is.',
    position: 'center',
  },
  token_shortcuts: {
    title: 'Token Shortcuts',
    body: 'Known token producers show a "✨ Create Token" button directly in the right-click menu.\n\nFor variable amounts (like Krenko), use the command bar.',
    example: '"activate krenko" · "create 4 goblin tokens" · "make treasure token"',
    tip: 'Academy Manufactor shows all 3 token types — Treasure + Clue + Food.',
    position: 'center',
  },
  judge_mode: {
    title: 'Judge Assistant',
    body: 'The assistant is always watching. It flags timing violations, tapped-mana issues, invalid attacks, and rules interactions.\n\nAdjust verbosity in your Profile card (👤 top right) or use the Judge Mode toggle.',
    tip: 'Set to "Limited" during casual games, "Full" when learning or resolving disputes.',
    position: 'right',
  },
  done: {
    title: 'You\'re All Set!',
    body: 'That\'s the full tour. The simulator supports 2–6 players in Commander, with peer-to-peer multiplayer.\n\nHover any element with a 📖 icon for quick tips at any time.',
    tip: 'Use "?" in the top bar to restart the tour or toggle tooltips.',
    position: 'center',
  },
};

// ─── Welcome Modal ────────────────────────────────────────────────────────────

export function WelcomeModal() {
  const tutorial = useTutorial();

  if (!tutorial.isFirstLaunch) return null;

  const card = STEP_CARDS.welcome!;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(4px)',
      animation: 'tooltipFadeIn 0.2s ease',
    }}>
      <div style={{
        background: 'linear-gradient(160deg, #10161a 0%, #0b0f12 100%)',
        border: '1px solid #22d3ee',
        borderRadius: 16,
        boxShadow: '0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(34,211,238,0.22)',
        padding: 32,
        maxWidth: 480,
        width: 'calc(100vw - 32px)',
      }}>
        {/* Badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(34,211,238,0.12)',
          border: '1px solid rgba(34,211,238,0.36)',
          borderRadius: 999,
          padding: '4px 12px',
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 14 }}>⚔️</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#67e8f9', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            On-Da-Stack
          </span>
        </div>

        <h2 style={{ margin: '0 0 12px', fontSize: 22, fontWeight: 800, color: '#f1f5f9', lineHeight: 1.2 }}>
          {card.title}
        </h2>

        <p style={{ margin: '0 0 16px', fontSize: 14, color: '#94a3b8', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
          {card.body}
        </p>

        {/* 3 key features */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {[
            { icon: '🎯', text: 'Natural language commands — type anything in plain English' },
            { icon: '⚖️', text: 'Built-in judge assistant flags rules issues, never blocks you' },
            { icon: '🃏', text: 'Right-click any card for smart action shortcuts' },
          ].map(({ icon, text }) => (
            <div key={text} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '8px 12px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 8,
            }}>
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{icon}</span>
              <span style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.4 }}>{text}</span>
            </div>
          ))}
        </div>

        {card.tip && (
          <p style={{
            margin: '0 0 24px',
            fontSize: 12,
            color: '#64748b',
            fontStyle: 'italic',
          }}>
            💡 {card.tip}
          </p>
        )}

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => {
              tutorial.dismissStep('welcome');
              tutorial.startWalkthrough();
            }}
            style={{
              flex: 1,
              padding: '11px 0',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, #0e7490, #f59e0b)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '0.9'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '1'; }}
          >
            Start Tour ›
          </button>
          <button
            onClick={() => {
              tutorial.dismissStep('welcome');
            }}
            style={{
              padding: '11px 20px',
              borderRadius: 10,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#64748b',
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              (e.target as HTMLElement).style.color = '#94a3b8';
              (e.target as HTMLElement).style.borderColor = '#475569';
            }}
            onMouseLeave={e => {
              (e.target as HTMLElement).style.color = '#64748b';
              (e.target as HTMLElement).style.borderColor = '#334155';
            }}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Coach Mark ───────────────────────────────────────────────────────────────
// Shown during the guided walkthrough. A non-blocking card that points to the
// relevant UI area without dimming the screen.

export function CoachMark() {
  const tutorial = useTutorial();

  if (!tutorial.walkthroughActive || !tutorial.currentStep) return null;
  if (tutorial.currentStep === 'welcome') return null; // welcome uses WelcomeModal

  const step = tutorial.currentStep;
  const card = STEP_CARDS[step];
  if (!card) return null;

  const currentIdx = tutorial.stepOrder.indexOf(step);
  const total = tutorial.stepOrder.filter(s => STEP_CARDS[s] && s !== 'welcome' && s !== 'done').length;
  const progress = tutorial.stepOrder.filter(s => tutorial.hasSeenStep(s) && s !== 'welcome').length;

  // Position the coach mark based on card.position
  const positionStyle: React.CSSProperties = (() => {
    switch (card.position) {
      case 'top':    return { top: 80, left: '50%', transform: 'translateX(-50%)' };
      case 'bottom': return { bottom: 110, left: '50%', transform: 'translateX(-50%)' };
      case 'left':   return { top: '40%', left: 200, transform: 'translateY(-50%)' };
      case 'right':  return { top: '40%', right: 280, transform: 'translateY(-50%)' };
      default:       return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
  })();

  return (
    <div style={{
      position: 'fixed',
      zIndex: 99998,
      ...positionStyle,
      width: 320,
      background: 'linear-gradient(145deg, #10161a 0%, #0b0f12 100%)',
      border: '1px solid #22d3ee',
      borderRadius: 12,
      boxShadow: '0 16px 48px rgba(0,0,0,0.75), 0 0 0 1px rgba(34,211,238,0.22)',
      padding: '16px 18px',
      animation: 'tooltipFadeIn 0.2s ease',
    }}>
      {/* Progress bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <span style={{ fontSize: 10, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
          Step {progress + 1} of {total}
        </span>
        <div style={{ display: 'flex', gap: 3 }}>
          {tutorial.stepOrder.filter(s => STEP_CARDS[s] && s !== 'welcome' && s !== 'done').map((s, i) => (
            <div key={s} style={{
              width: 20,
              height: 3,
              borderRadius: 2,
              background: tutorial.hasSeenStep(s) ? '#0e7490' : s === step ? '#67e8f9' : '#1e293b',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>
      </div>

      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>📖</span>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
          {card.title}
        </h3>
      </div>

      {/* Body */}
      <p style={{
        margin: '0 0 10px',
        fontSize: 12.5,
        color: '#94a3b8',
        lineHeight: 1.55,
        whiteSpace: 'pre-line',
      }}>
        {card.body}
      </p>

      {/* Example */}
      {card.example && (
        <div style={{
          margin: '0 0 10px',
          padding: '5px 9px',
          background: 'rgba(34,211,238,0.1)',
          borderLeft: '2px solid #22d3ee',
          borderRadius: '0 5px 5px 0',
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: 10.5,
          color: '#67e8f9',
          lineHeight: 1.5,
        }}>
          {card.example}
        </div>
      )}

      {/* Tip */}
      {card.tip && (
        <p style={{
          margin: '0 0 12px',
          fontSize: 11,
          color: '#475569',
          fontStyle: 'italic',
          lineHeight: 1.4,
        }}>
          💡 {card.tip}
        </p>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {step === 'done' ? (
          <button
            onClick={() => {
              tutorial.dismissStep('done');
              tutorial.stopWalkthrough();
            }}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 8,
              border: 'none',
              background: 'linear-gradient(135deg, #0e7490, #f59e0b)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Finish Tour ✓
          </button>
        ) : (
          <button
            onClick={() => tutorial.dismissStep(step)}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 8,
              border: 'none',
              background: 'linear-gradient(135deg, #0e7490, #f59e0b)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '0.88'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '1'; }}
          >
            Next ›
          </button>
        )}
        <button
          onClick={() => tutorial.stopWalkthrough()}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #1e293b',
            background: 'transparent',
            color: '#475569',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
          title="Exit tour (tooltips stay active)"
        >
          Exit
        </button>
      </div>
    </div>
  );
}

// ─── Pulse Beacon ─────────────────────────────────────────────────────────────
// A small animated ring that appears on the active walkthrough element.
// Use via data-tutorial-step attribute on any DOM element.

export function PulseBeacon({ step, style }: { step: TutorialStep; style?: React.CSSProperties }) {
  const tutorial = useTutorial();
  if (!tutorial.walkthroughActive || tutorial.currentStep !== step) return null;

  return (
    <span style={{
      display: 'inline-block',
      position: 'relative',
      width: 10,
      height: 10,
      ...style,
    }}>
      <span style={{
        position: 'absolute',
        inset: 0,
        borderRadius: '50%',
        background: '#0e7490',
        animation: 'beaconPulse 1.4s ease-out infinite',
      }} />
      <span style={{
        position: 'absolute',
        inset: 2,
        borderRadius: '50%',
        background: '#67e8f9',
      }} />
    </span>
  );
}
