// ─── Tutorial Store ───────────────────────────────────────────────────────────
// Lightweight localStorage-persisted tutorial state.
// Tracks which steps the player has seen, whether tooltips are on,
// and the current spotlight step for the guided walkthrough.
//
// No Zustand dependency — plain module + React hook so it stays
// completely separate from game state.

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'ods_tutorial_v1';

export type TutorialStep =
  | 'welcome'          // first-launch overlay
  | 'phase_bar'        // phase guide bar
  | 'hand'             // player hand + hovering cards
  | 'command_bar'      // NLP command input
  | 'zones'            // graveyard/exile/library badges
  | 'right_panel'      // assistant / action log / stack
  | 'left_panel'       // life totals, deck info
  | 'context_menu'     // right-click on cards
  | 'token_shortcuts'  // create token buttons
  | 'judge_mode'       // assistant judge toggle
  | 'done';            // all steps completed

export interface TutorialState {
  enabled: boolean;            // tooltips globally on/off
  seenSteps: TutorialStep[];   // which steps have been dismissed
  currentStep: TutorialStep | null;  // active spotlight step (null = no walkthrough active)
  walkthroughActive: boolean;  // is the guided walkthrough running?
}

const STEP_ORDER: TutorialStep[] = [
  'welcome',
  'phase_bar',
  'hand',
  'command_bar',
  'zones',
  'right_panel',
  'left_panel',
  'context_menu',
  'token_shortcuts',
  'judge_mode',
  'done',
];

const DEFAULT: TutorialState = {
  enabled: true,
  seenSteps: [],
  currentStep: null,
  walkthroughActive: false,
};

function load(): TutorialState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT };
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT };
  }
}

function save(state: TutorialState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTutorial() {
  const [state, setState] = useState<TutorialState>(load);

  // Persist on every change
  useEffect(() => { save(state); }, [state]);

  const update = useCallback((patch: Partial<TutorialState>) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  // Mark a step as seen (dismisses its spotlight if active)
  const dismissStep = useCallback((step: TutorialStep) => {
    setState(prev => {
      const seenSteps = prev.seenSteps.includes(step)
        ? prev.seenSteps
        : [...prev.seenSteps, step];

      // Advance walkthrough to next unseen step
      let currentStep = prev.currentStep;
      let walkthroughActive = prev.walkthroughActive;
      if (prev.walkthroughActive && prev.currentStep === step) {
        const idx = STEP_ORDER.indexOf(step);
        const next = STEP_ORDER.slice(idx + 1).find(s => !seenSteps.includes(s));
        currentStep = next ?? 'done';
        if (currentStep === 'done') walkthroughActive = false;
      }
      return { ...prev, seenSteps, currentStep, walkthroughActive };
    });
  }, []);

  // Start the guided walkthrough from the beginning (or next unseen step)
  const startWalkthrough = useCallback(() => {
    setState(prev => {
      const next = STEP_ORDER.find(s => !prev.seenSteps.includes(s) && s !== 'done');
      return { ...prev, walkthroughActive: true, currentStep: next ?? 'done' };
    });
  }, []);

  // Stop walkthrough without marking anything
  const stopWalkthrough = useCallback(() => {
    setState(prev => ({ ...prev, walkthroughActive: false, currentStep: null }));
  }, []);

  // Toggle tooltips globally
  const toggleTooltips = useCallback(() => {
    setState(prev => ({ ...prev, enabled: !prev.enabled }));
  }, []);

  // Reset everything (for testing / "restart tutorial")
  const resetTutorial = useCallback(() => {
    const fresh: TutorialState = { ...DEFAULT };
    setState(fresh);
    save(fresh);
  }, []);

  const hasSeenStep = useCallback((step: TutorialStep) =>
    state.seenSteps.includes(step), [state.seenSteps]);

  const isFirstLaunch = !state.seenSteps.includes('welcome');

  return {
    ...state,
    update,
    dismissStep,
    startWalkthrough,
    stopWalkthrough,
    toggleTooltips,
    resetTutorial,
    hasSeenStep,
    isFirstLaunch,
    stepOrder: STEP_ORDER,
  };
}

// ─── Static tooltip content ───────────────────────────────────────────────────
// All tutorial copy lives here so it's easy to update.

export interface TooltipContent {
  title: string;
  body: string;
  example?: string;  // command or interaction example shown in monospace
  step?: TutorialStep;
}

export const TOOLTIPS: Record<string, TooltipContent> = {

  // ── Phase bar ──────────────────────────────────────────────────────────────
  phase_untap: {
    title: 'Untap Step',
    body: 'All your tapped permanents untap. No player receives priority here — it happens automatically.',
    step: 'phase_bar',
  },
  phase_upkeep: {
    title: 'Upkeep Step',
    body: 'Upkeep triggers go on the stack. Pay costs like Cumulative Upkeep or Rhystic Study taxes here.',
    example: '"upkeep trigger from Rhystic Study"',
    step: 'phase_bar',
  },
  phase_draw: {
    title: 'Draw Step',
    body: 'Draw your card for the turn. Opponents can respond with instants before you proceed.',
    example: '"draw" or "draw 1"',
    step: 'phase_bar',
  },
  phase_main1: {
    title: 'Main Phase 1',
    body: 'Cast sorceries, creatures, artifacts, and enchantments. Play your land for the turn. The stack is usually empty so you have priority.',
    example: '"cast Sol Ring" · "play Island"',
    step: 'phase_bar',
  },
  phase_combat: {
    title: 'Beginning of Combat',
    body: 'Declare your intention to attack. Abilities that trigger "at the beginning of combat" resolve here.',
    example: '"attack with Goblin Guide, Mayhem Devil"',
    step: 'phase_bar',
  },
  phase_attackers: {
    title: 'Declare Attackers',
    body: 'Choose which creatures attack, and which player or planeswalker they attack. Tapping to attack does NOT trigger summoning sickness restrictions.',
    step: 'phase_bar',
  },
  phase_blockers: {
    title: 'Declare Blockers',
    body: 'The defending player declares blockers. Multiple creatures can block a single attacker (trample deals excess damage through).',
    step: 'phase_bar',
  },
  phase_damage: {
    title: 'Combat Damage',
    body: 'Creatures deal damage simultaneously. Assign damage in order for each blocked attacker. First strike resolves before regular combat damage.',
    step: 'phase_bar',
  },
  phase_main2: {
    title: 'Main Phase 2',
    body: 'Second chance to cast spells before ending your turn. Especially useful for Sorceries after combat.',
    example: '"cast Wrath of God" · "play swamp"',
    step: 'phase_bar',
  },
  phase_end: {
    title: 'End Step',
    body: '"At the beginning of the end step" triggers go here. Opponents can cast instants in response.',
    example: '"end step" triggers from Smothering Tithe, etc.',
    step: 'phase_bar',
  },
  phase_cleanup: {
    title: 'Cleanup',
    body: 'Discard to hand size (7 by default), remove damage from creatures, and end "until end of turn" effects. Usually no priority.',
    step: 'phase_bar',
  },
  pass_priority: {
    title: 'Pass Priority',
    body: 'When all players pass priority in succession, the top spell or ability on the stack resolves. Or the current phase/step ends.',
    example: '"pass" or click Pass Priority button',
    step: 'phase_bar',
  },

  // ── Command bar ────────────────────────────────────────────────────────────
  command_bar: {
    title: 'Command Bar',
    body: 'Type natural language commands. The judge assistant understands plain English — you never have to memorize syntax.',
    example: '"attack with Krenko" · "scry 2" · "draw 3" · "gain 5 life"',
    step: 'command_bar',
  },
  command_attack: {
    title: 'Attack Command',
    body: 'Declare attackers in plain English. Comma-separate multiple attackers. Optionally specify targets.',
    example: '"attack with Goblin Guide, Mayhem Devil, Korvold"',
    step: 'command_bar',
  },
  command_cast: {
    title: 'Cast Command',
    body: 'Cast any card in your hand by name. Fuzzy matching handles typos and partial names.',
    example: '"cast sol ring" · "cast black lotus" · "play swamp"',
    step: 'command_bar',
  },
  command_tokens: {
    title: 'Create Tokens',
    body: 'Create tokens by description or by activating a card ability. Count, color, type — all natural language.',
    example: '"create 3 goblin tokens" · "activate krenko" · "make treasure token"',
    step: 'token_shortcuts',
  },
  command_zones: {
    title: 'Zone Commands',
    body: 'Move cards between zones, search libraries, look at hands. The judge logs all actions.',
    example: '"scry 3" · "surveil 2" · "flashback Lightning Bolt" · "reanimate Griselbrand"',
    step: 'zones',
  },
  command_counters: {
    title: 'Counters Command',
    body: 'Add or remove counters on any permanent. Works with +1/+1, -1/-1, loyalty, energy, and custom counters.',
    example: '"+1/+1 counter on Ghave" · "remove -1/-1 from Mikaeus"',
    step: 'command_bar',
  },
  command_life: {
    title: 'Life Total Commands',
    body: 'Track life totals naturally. The judge logs all changes.',
    example: '"gain 5 life" · "player 2 takes 13" · "lose 3 life"',
    step: 'command_bar',
  },
  chips_hint: {
    title: 'Quick Suggestion Chips',
    body: 'When the command bar is empty, chips appear showing contextual commands based on the current phase and your board state.',
    step: 'command_bar',
  },

  // ── Hand ──────────────────────────────────────────────────────────────────
  hand_card: {
    title: 'Cards in Hand',
    body: 'Hover to preview. Click to focus. Right-click for a full action menu — cast, cycle, discard, move to any zone.',
    step: 'hand',
  },
  hand_drag: {
    title: 'Drag to Play',
    body: 'Drag a card from your hand onto the battlefield to cast or play it. Creatures land tapped if summoning-sick.',
    step: 'hand',
  },

  // ── Zones ─────────────────────────────────────────────────────────────────
  zone_graveyard: {
    title: 'Graveyard',
    body: 'Click to open the graveyard. Right-click any card inside to flashback, reanimate, or move it.',
    step: 'zones',
  },
  zone_exile: {
    title: 'Exile Zone',
    body: 'Exiled cards. Right-click to cast from exile (foretell, adventure, suspend) or move back to another zone.',
    step: 'zones',
  },
  zone_library: {
    title: 'Library',
    body: 'Deck size shown as a badge. Click to open for scry, tutor, or searching. Always shuffle after searching.',
    step: 'zones',
  },

  // ── Panels ────────────────────────────────────────────────────────────────
  right_panel_assistant: {
    title: 'Judge Assistant',
    body: 'The assistant watches every action and flags potential rules issues — like casting instants at wrong times, using tapped lands, or invalid attacks. It never blocks your actions.',
    step: 'right_panel',
  },
  right_panel_log: {
    title: 'Action Log',
    body: 'Every game action is recorded here in order. Use it to replay decisions, settle disputes, or review triggers.',
    step: 'right_panel',
  },
  right_panel_stack: {
    title: 'The Stack',
    body: 'Spells and abilities go here when cast/activated. They resolve last-in, first-out. Use "resolve" to resolve the top item.',
    example: '"resolve" · "counter Lightning Bolt"',
    step: 'right_panel',
  },

  // ── Context menu ──────────────────────────────────────────────────────────
  context_menu: {
    title: 'Right-Click Menu',
    body: 'Right-click any card for a full action menu. Actions are filtered by the card\'s zone and keywords — only valid options appear.',
    step: 'context_menu',
  },
  context_menu_tier: {
    title: 'Mechanic Tier Badges',
    body: 'T1 (green) = popular evergreen mechanic. T2 (blue) = keyword from Scryfall. T3 (amber) = rare oracle-text effect — logged as a judge note.',
    step: 'context_menu',
  },

  // ── Judge mode ────────────────────────────────────────────────────────────
  judge_mode: {
    title: 'Judge Mode',
    body: 'Toggle the assistant\'s verbosity. "Limited" only flags serious issues. "Full" reports all rules interactions. The judge never blocks your actions.',
    step: 'judge_mode',
  },

  // ── Token shortcuts ───────────────────────────────────────────────────────
  token_shortcut: {
    title: 'Token Shortcuts',
    body: 'Cards that create tokens show shortcut buttons in the right-click menu. Click once to create the token on the battlefield.',
    example: 'Right-click Krenko → ✨ X× 👺 Goblin',
    step: 'token_shortcuts',
  },
};
