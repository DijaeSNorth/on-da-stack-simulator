import type { Phase } from '../types/game';

export interface PhaseMeta {
  label: string;
  short: string;
  hint: string;
  reminder?: string;
  group: 'beginning' | 'precombat' | 'combat' | 'postcombat' | 'ending';
}

export const PHASE_ORDER: Phase[] = [
  'untap', 'upkeep', 'draw', 'main1',
  'beginningOfCombat', 'declareAttackers', 'declareBlockers',
  'combatDamage', 'endOfCombat',
  'main2', 'endStep', 'cleanup',
];

export const PHASE_META: Record<Phase, PhaseMeta> = {
  untap: {
    label: 'Untap',
    short: 'UN',
    hint: 'Untap all your permanents. No player receives priority here.',
    reminder: 'Phasing, Day/Night, and "at the beginning of untap" effects apply here.',
    group: 'beginning',
  },
  upkeep: {
    label: 'Upkeep',
    short: 'UP',
    hint: 'Upkeep triggers go on the stack. Handle any upkeep costs.',
    reminder: 'Check for cumulative upkeep, Sagas, Rhystic Study, etc.',
    group: 'beginning',
  },
  draw: {
    label: 'Draw',
    short: 'DR',
    hint: 'Draw your card for the turn. Opponents can respond.',
    reminder: 'Howling Mine, Consecrated Sphinx, and other draw-replacement effects apply here.',
    group: 'beginning',
  },
  main1: {
    label: 'Main 1',
    short: 'M1',
    hint: 'Cast spells, activate abilities, and play your land. No timing restrictions while the stack is empty.',
    reminder: 'You may play one land this turn if you haven\'t already.',
    group: 'precombat',
  },
  beginningOfCombat: {
    label: 'Begin Combat',
    short: 'BC',
    hint: 'Combat begins. Last chance to cast instants before attackers are declared.',
    reminder: 'Declare attackers in the next step. Tap creatures with summoning sickness now.',
    group: 'combat',
  },
  declareAttackers: {
    label: 'Attackers',
    short: 'ATK',
    hint: 'Declare your attacking creatures. Drag them to an opponent\'s zone, or use the Combat Panel.',
    reminder: 'Tapped creatures and those with summoning sickness can\'t attack. Vigilance creatures don\'t tap.',
    group: 'combat',
  },
  declareBlockers: {
    label: 'Blockers',
    short: 'BLK',
    hint: 'Defending players declare blockers. Drag creatures onto attackers.',
    reminder: 'Flying can only be blocked by flying or reach. Multiple blockers allowed per attacker.',
    group: 'combat',
  },
  combatDamage: {
    label: 'Damage',
    short: 'DMG',
    hint: 'Combat damage is dealt. First strike / double strike apply.',
    reminder: 'Assign damage to multiple blockers in order. Trample damage hits the player after blockers are lethal.',
    group: 'combat',
  },
  endOfCombat: {
    label: 'End Combat',
    short: 'EC',
    hint: '"At end of combat" triggers go on the stack. Myriad tokens are exiled.',
    reminder: 'Last chance to respond before leaving combat. Combat damage stays marked.',
    group: 'combat',
  },
  main2: {
    label: 'Main 2',
    short: 'M2',
    hint: 'Second main phase. Cast sorceries, creatures, and other permanents.',
    reminder: 'You may still play a land if you haven\'t this turn.',
    group: 'postcombat',
  },
  endStep: {
    label: 'End Step',
    short: 'END',
    hint: '"At the beginning of the end step" triggers fire. Hand size checked during cleanup.',
    reminder: 'Opponents can cast instants here. Teferi triggers apply.',
    group: 'ending',
  },
  cleanup: {
    label: 'Cleanup',
    short: 'CLN',
    hint: 'Discard to hand size (7 by default). Damage is removed from creatures. "Until end of turn" effects end.',
    reminder: 'No priority is received unless a trigger fires or an effect requires it.',
    group: 'ending',
  },
};

export const GROUP_COLORS: Record<PhaseMeta['group'], string> = {
  beginning: '#1e3a5f',
  precombat: '#064e3b',
  combat: '#7f1d1d',
  postcombat: '#064e3b',
  ending: '#312e81',
};

export const GROUP_ACCENT: Record<PhaseMeta['group'], string> = {
  beginning: '#60a5fa',
  precombat: '#34d399',
  combat: '#f87171',
  postcombat: '#34d399',
  ending: '#a78bfa',
};

export function getPhaseLabel(phase: Phase | string): string {
  return PHASE_META[phase as Phase]?.label ?? phase;
}
