import { useEffect, useMemo, useRef, useState } from 'react';

type PixelPalette = {
  skin: string;
  core: string;
  detail: string;
  accent: string;
};

type Creature = {
  dex: number;
  name: string;
  speciesHint: string;
  flavor: string;
  isExotic: boolean;
  power: number;
  sprite: string[];
  palette: PixelPalette;
};

type Buddy = {
  id: string;
  nickname: string;
  creature: Creature;
  level: number;
  hp: number;
  maxHp: number;
  xp: number;
};

type GymArea = {
  id: string;
  name: string;
  machines: GymMachine[];
  type: 'home' | 'starter' | 'higher';
  levelMin: number;
  levelMax: number;
  blurb: string;
};

type Encounter = {
  creature: Creature;
  level: number;
  zoneId: string;
  catchChance: number;
  isBoss: boolean;
  bossName?: string;
  bossPowerBonus?: number;
};

type Move = {
  id: 'burst' | 'grind' | 'snap';
  title: string;
  tactic: string;
  power: number;
  control: number;
};

type Match = {
  encounter: Encounter;
  status: 'idle' | 'playing' | 'won' | 'escape' | 'failed' | 'full';
  round: number;
  maxRounds: number;
  meter: number;
  lines: string[];
};

type GymMachine = {
  id: string;
  name: string;
  detail: string;
  focus: string;
  xpMin: number;
  xpMax: number;
  xpMultiplier: number;
  steroidChance: number;
  hpRestore: number;
  fatigueCost: number;
};

type BossSchedule = {
  nextBossAt: number;
  defeated?: number;
};

type GymBoss = {
  id: string;
  name: string;
  creature: Creature;
  levelShift: number;
  catchMultiplier: number;
  powerBoost: number;
};

type SaveData = {
  version: string;
  trainer: TrainerProfile;
  steroids: number;
  activeIndex: number;
  activeZoneId: string;
  team: Buddy[];
  seenDex: number[];
  caughtDex: number[];
  selectedMachineByZone: Record<string, string>;
  bossSchedules: Record<string, BossSchedule>;
  tutorialStep: number;
  audio: SaveAudioSettings;
};

type TrainerProfile = {
  name: string;
  skin: string;
  hair: string;
  top: string;
  shoes: string;
  glove: string;
  muscles: {
    shoulders: number;
    chest: number;
    arms: number;
    triceps: number;
    core: number;
    quads: number;
    calves: number;
    back: number;
  };
};

type ZoneTransit = {
  from: string;
  to: string;
  icon: string;
};

type TrainerEmote = 'neutral' | 'grind' | 'focus' | 'level' | 'victory' | 'drained' | 'ready' | 'pump';

type FocusMuscleBoost = {
  muscle: keyof TrainerProfile['muscles'];
  weight: number;
};

type SaveAudioSettings = {
  enabled: boolean;
  musicVolume: number;
  sfxVolume: number;
};

type MusicZoneState = 'home' | 'ambient' | 'fight' | 'boss';
type MusicIntensity = 'home' | 'starter' | 'higher';

type AudioEngine = {
  context: AudioContext;
  masterGain: GainNode;
  musicGain: GainNode;
  sfxGain: GainNode;
  musicTicker: ReturnType<typeof setInterval> | null;
  enabled: boolean;
  zone: MusicZoneState;
  intensity: MusicIntensity;
  step: number;
  stepNotes: number[];
  setEnabled: (value: boolean) => void;
  setVolumes: (music: number, sfx: number) => void;
  startMusic: (zone: MusicZoneState, intensity: MusicIntensity) => void;
  stopMusic: () => void;
  pulseTone: (frequency: number, duration: number, gain: number, wave?: OscillatorType) => void;
  emitSfx: (event: string, intensity?: number) => void;
  dispose: () => void;
};

type TrainingPhase = 'running' | 'spot' | 'resolved';

type WorkoutSession = {
  id: number;
  phase: TrainingPhase;
  zoneType: 'home' | 'starter' | 'higher';
  buddyId: string;
  machineId: string;
  willFail: boolean;
  startedAt: number;
  durationMs: number;
  failCheckAt: number;
  spotWindowMs: number;
  spotWindowStart: number;
  spotWindowEnd: number;
  failChance: number;
  buddyLevelBefore: number;
  hpLossOnFail: number;
  staminaChange: number;
  xpGain: number;
  steroidsAwarded: boolean;
  resolved: boolean;
  spotChanceBase: number;
};

const MAX_MUSCLE_LEVEL = 14;
const WORKOUT_DURATION_MS = 2800;
const WORKOUT_SPOT_WINDOW_MS = 1600;
const WORKOUT_AUTO_FAILURE_MS = 1250;
const BASE_TRAIN_FAIL_CHANCE = 0.5;
const BASE_SPOT_SUCCESS_CHANCE = 0.5;

function machineDifficultyMultiplier(type: 'home' | 'starter' | 'higher') {
  if (type === 'higher') return 1.2;
  if (type === 'starter') return 1.08;
  return 0.95;
}

function spotCurveMultiplier(type: 'home' | 'starter' | 'higher') {
  if (type === 'higher') return 0.36;
  if (type === 'starter') return 0.42;
  return 0.48;
}

function trainerWorkoutAdvantage(machine: GymMachine, trainer: TrainerProfile, type: 'home' | 'starter' | 'higher') {
  const focusBoosts = FOCUSED_MUSCLES[machine.focus.toLowerCase()] ?? [];
  const focusScore = focusBoosts.length
    ? focusBoosts.reduce((sum, focus) => {
        const value = trainer.muscles[focus.muscle] / MAX_MUSCLE_LEVEL;
        return sum + value * focus.weight;
      }, 0) / focusBoosts.reduce((sum, focus) => sum + focus.weight, 0)
    : 0;

  const overallBody = Object.values(trainer.muscles).reduce((total, value) => total + value / MAX_MUSCLE_LEVEL, 0) / 8;
  const tierScale = type === 'higher' ? 1.22 : type === 'starter' ? 1.05 : 0.95;

  const failReduction = clamp(focusScore * 0.2 + overallBody * 0.12, 0, 0.3) * tierScale;
  const spotBonus = clamp((focusScore * 0.22 + overallBody * 0.12), 0.02, 0.3) * (type === 'home' ? 0.9 : 1);

  return {
    failReduction: clamp(failReduction * 0.9, 0, 0.35),
    spotBaseBonus: clamp(spotBonus * tierScale, 0, 0.35),
  };
}

const FOCUSED_MUSCLES: Record<string, FocusMuscleBoost[]> = {
  recovery: [{ muscle: 'core', weight: 1 }],
  stability: [{ muscle: 'shoulders', weight: 1 }, { muscle: 'core', weight: 1 }],
  control: [{ muscle: 'arms', weight: 1 }, { muscle: 'triceps', weight: 1 }],
  endurance: [{ muscle: 'quads', weight: 1 }, { muscle: 'calves', weight: 1 }],
  power: [{ muscle: 'chest', weight: 2 }, { muscle: 'arms', weight: 2 }, { muscle: 'shoulders', weight: 1 }, { muscle: 'triceps', weight: 1 }],
  grip: [{ muscle: 'arms', weight: 3 }],
  lockout: [{ muscle: 'chest', weight: 1 }, { muscle: 'triceps', weight: 2 }, { muscle: 'core', weight: 1 }],
  'pull power': [{ muscle: 'back', weight: 3 }, { muscle: 'arms', weight: 1 }],
  'base drive': [{ muscle: 'quads', weight: 2 }, { muscle: 'core', weight: 2 }],
  tempo: [{ muscle: 'core', weight: 1 }, { muscle: 'quads', weight: 1 }],
  timing: [{ muscle: 'core', weight: 1 }, { muscle: 'shoulders', weight: 1 }, { muscle: 'back', weight: 1 }],
  strength: [{ muscle: 'chest', weight: 2 }, { muscle: 'back', weight: 1 }, { muscle: 'arms', weight: 2 }],
  durability: [{ muscle: 'quads', weight: 1 }, { muscle: 'calves', weight: 1 }, { muscle: 'core', weight: 1 }],
  precision: [{ muscle: 'triceps', weight: 1 }, { muscle: 'shoulders', weight: 1 }, { muscle: 'core', weight: 1 }],
  rhythm: [{ muscle: 'core', weight: 1 }, { muscle: 'calves', weight: 1 }],
  leverage: [{ muscle: 'back', weight: 2 }, { muscle: 'chest', weight: 1 }, { muscle: 'core', weight: 1 }],
  'back pressure': [{ muscle: 'back', weight: 3 }, { muscle: 'core', weight: 1 }],
  'raw strength': [{ muscle: 'chest', weight: 2 }, { muscle: 'arms', weight: 2 }],
  posture: [{ muscle: 'shoulders', weight: 1 }, { muscle: 'core', weight: 2 }],
  'core transfer': [{ muscle: 'core', weight: 2 }, { muscle: 'quads', weight: 1 }],
  'ground break': [{ muscle: 'quads', weight: 2 }, { muscle: 'calves', weight: 2 }, { muscle: 'core', weight: 1 }],
};

const TRAINER_MUSCLES: Array<{ key: keyof TrainerProfile['muscles']; label: string; detail: string }> = [
  { key: 'shoulders', label: 'Shoulders', detail: 'Capsule and deltoid depth' },
  { key: 'chest', label: 'Chest', detail: 'Upper chest and pec sweep' },
  { key: 'arms', label: 'Biceps/Forearm', detail: 'Forearm + curl width' },
  { key: 'triceps', label: 'Triceps', detail: 'Posterior elbow mass' },
  { key: 'back', label: 'Back', detail: 'Lats and upper torso width' },
  { key: 'core', label: 'Core', detail: 'Ab and oblique block' },
  { key: 'quads', label: 'Quads', detail: 'Upper leg drive mass' },
  { key: 'calves', label: 'Calves', detail: 'Lower-leg density' },
];

const SAVE_KEY = 'gymbuddies-save-v7';
const TEAM_SIZE = 6;
const BOSS_MIN_MS = 5 * 60 * 1000;
const BOSS_MAX_MS = 10 * 60 * 1000;

const HOME_MACHINES: GymMachine[] = [
  {
    id: 'home_recovery',
    name: 'Recovery Rack',
    detail: 'Low-load activation, shoulder re-training, and mobility flow.',
    focus: 'Recovery',
    xpMin: 1,
    xpMax: 3,
    xpMultiplier: 1.0,
    steroidChance: 0.26,
    hpRestore: 5,
    fatigueCost: 0,
  },
  {
    id: 'home_dumbbells',
    name: 'Mobility Dumbbells',
    detail: 'Slow, controlled presses to tighten lock angles and control.',
    focus: 'Stability',
    xpMin: 1,
    xpMax: 4,
    xpMultiplier: 1.06,
    steroidChance: 0.22,
    hpRestore: 3,
    fatigueCost: 1,
  },
  {
    id: 'home_plate',
    name: 'Technique Plate Stack',
    detail: 'Mini-overload sets for clean elbow path and wrist lock.',
    focus: 'Control',
    xpMin: 1,
    xpMax: 5,
    xpMultiplier: 1.12,
    steroidChance: 0.18,
    hpRestore: 2,
    fatigueCost: 1,
  },
  {
    id: 'home_bike',
    name: 'Foam Roller Bike',
    detail: 'Light cardio + bloodflow recovery for training volume.',
    focus: 'Endurance',
    xpMin: 1,
    xpMax: 4,
    xpMultiplier: 1.05,
    steroidChance: 0.2,
    hpRestore: 4,
    fatigueCost: 1,
  },
];

const STARTER_A_MACHINES: GymMachine[] = [
  {
    id: 'starter_a_bench',
    name: 'Flat Bench Press Rack',
    detail: 'Heavy pressing intervals for shoulder-endurance.',
    focus: 'Power',
    xpMin: 2,
    xpMax: 5,
    xpMultiplier: 1.18,
    steroidChance: 0.2,
    hpRestore: 2,
    fatigueCost: 2,
  },
  {
    id: 'starter_a_ropes',
    name: 'Rope Pulley Station',
    detail: 'Cable arcs teach wrist alignment and short reset speed.',
    focus: 'Grip',
    xpMin: 1,
    xpMax: 5,
    xpMultiplier: 1.15,
    steroidChance: 0.24,
    hpRestore: 2,
    fatigueCost: 2,
  },
  {
    id: 'starter_a_machine',
    name: 'Iso-Lock Cables',
    detail: 'Isometric holds for control under compression pressure.',
    focus: 'Lockout',
    xpMin: 2,
    xpMax: 6,
    xpMultiplier: 1.2,
    steroidChance: 0.18,
    hpRestore: 1,
    fatigueCost: 2,
  },
  {
    id: 'starter_a_rows',
    name: 'Hammer Strength Row',
    detail: 'Back and elbow path work for high-pressure grapples.',
    focus: 'Pull Power',
    xpMin: 2,
    xpMax: 6,
    xpMultiplier: 1.22,
    steroidChance: 0.2,
    hpRestore: 1,
    fatigueCost: 3,
  },
];

const STARTER_B_MACHINES: GymMachine[] = [
  {
    id: 'starter_b_leg',
    name: 'Hack Squat Machine',
    detail: 'Lower-body chains for stable stance and power transfer.',
    focus: 'Base Drive',
    xpMin: 3,
    xpMax: 6,
    xpMultiplier: 1.23,
    steroidChance: 0.2,
    hpRestore: 1,
    fatigueCost: 3,
  },
  {
    id: 'starter_b_cable',
    name: 'Selectorized Pulley',
    detail: 'Continuous arcs for controlled acceleration work.',
    focus: 'Tempo',
    xpMin: 2,
    xpMax: 6,
    xpMultiplier: 1.16,
    steroidChance: 0.18,
    hpRestore: 2,
    fatigueCost: 2,
  },
  {
    id: 'starter_b_pulley',
    name: 'Pulley Wall Rig',
    detail: 'High-tension pulling with precision lockout timing.',
    focus: 'Timing',
    xpMin: 3,
    xpMax: 5,
    xpMultiplier: 1.21,
    steroidChance: 0.22,
    hpRestore: 2,
    fatigueCost: 2,
  },
  {
    id: 'starter_b_leg_pulse',
    name: 'Leg Press Power Stack',
    detail: 'Pump and recover in short rounds to raise fight-stamina.',
    focus: 'Endurance',
    xpMin: 3,
    xpMax: 7,
    xpMultiplier: 1.25,
    steroidChance: 0.18,
    hpRestore: 1,
    fatigueCost: 4,
  },
];

const IRON_MACHINES: GymMachine[] = [
  {
    id: 'iron_armor',
    name: 'Smith Cage Press',
    detail: 'Guided barbell overload for dense, repeatable max-reps.',
    focus: 'Strength',
    xpMin: 3,
    xpMax: 8,
    xpMultiplier: 1.28,
    steroidChance: 0.2,
    hpRestore: 1,
    fatigueCost: 3,
  },
  {
    id: 'iron_row',
    name: 'Hammer Row Dynamo',
    detail: 'Engine-like back cycles for long fight rounds.',
    focus: 'Durability',
    xpMin: 4,
    xpMax: 7,
    xpMultiplier: 1.14,
    steroidChance: 0.22,
    hpRestore: 2,
    fatigueCost: 3,
  },
  {
    id: 'iron_chain',
    name: 'Chain Cable Stack',
    detail: 'Variable resistance for explosive lockout simulation.',
    focus: 'Lockout',
    xpMin: 4,
    xpMax: 8,
    xpMultiplier: 1.22,
    steroidChance: 0.17,
    hpRestore: 1,
    fatigueCost: 3,
  },
  {
    id: 'iron_grip',
    name: 'Fat Gripper Tower',
    detail: 'Thick handles and squeeze holds for late-round control.',
    focus: 'Grip',
    xpMin: 4,
    xpMax: 8,
    xpMultiplier: 1.24,
    steroidChance: 0.19,
    hpRestore: 1,
    fatigueCost: 4,
  },
];

const APEX_MACHINES: GymMachine[] = [
  {
    id: 'apex_platform',
    name: 'Plate-Loaded Squeeze Press',
    detail: 'Near-perfect tension under fatigue, controlled plate microloads.',
    focus: 'Precision',
    xpMin: 4,
    xpMax: 9,
    xpMultiplier: 1.31,
    steroidChance: 0.2,
    hpRestore: 1,
    fatigueCost: 4,
  },
  {
    id: 'apex_blink',
    name: 'Functional Row Matrix',
    detail: 'Short cycles with explosive resets and reset speed.',
    focus: 'Rhythm',
    xpMin: 3,
    xpMax: 9,
    xpMultiplier: 1.23,
    steroidChance: 0.24,
    hpRestore: 2,
    fatigueCost: 3,
  },
  {
    id: 'apex_harness',
    name: 'Weighted Harness',
    detail: 'Belt-loaded leverage control for long-match carry-over.',
    focus: 'Leverage',
    xpMin: 5,
    xpMax: 10,
    xpMultiplier: 1.35,
    steroidChance: 0.18,
    hpRestore: 1,
    fatigueCost: 4,
  },
  {
    id: 'apex_lat',
    name: 'Cable Lat Press',
    detail: 'Overhead and mid-back control for high-compression resistance.',
    focus: 'Back Pressure',
    xpMin: 5,
    xpMax: 10,
    xpMultiplier: 1.34,
    steroidChance: 0.2,
    hpRestore: 2,
    fatigueCost: 5,
  },
];

const GLORY_MACHINES: GymMachine[] = [
  {
    id: 'glory_crusher',
    name: 'Atlas Crusher',
    detail: 'Maximum overload cycles meant for late-game gym leaders.',
    focus: 'Raw Strength',
    xpMin: 6,
    xpMax: 10,
    xpMultiplier: 1.4,
    steroidChance: 0.24,
    hpRestore: 2,
    fatigueCost: 5,
  },
  {
    id: 'glory_mill',
    name: 'Spine Mill',
    detail: 'Precision endurance work to stay composed under pain.',
    focus: 'Posture',
    xpMin: 5,
    xpMax: 11,
    xpMultiplier: 1.28,
    steroidChance: 0.2,
    hpRestore: 2,
    fatigueCost: 4,
  },
  {
    id: 'glory_torso',
    name: 'Torso Matrix',
    detail: 'Machine-driven carryover for repeated clutch bursts.',
    focus: 'Core Transfer',
    xpMin: 6,
    xpMax: 12,
    xpMultiplier: 1.33,
    steroidChance: 0.23,
    hpRestore: 2,
    fatigueCost: 5,
  },
  {
    id: 'glory_deadlift',
    name: 'Monorail Deadlift Stack',
    detail: 'Boss-grade deadlift paths that punish weak stance.',
    focus: 'Ground Break',
    xpMin: 7,
    xpMax: 12,
    xpMultiplier: 1.38,
    steroidChance: 0.22,
    hpRestore: 1,
    fatigueCost: 6,
  },
];

const AREAS: GymArea[] = [
  {
    id: 'home',
    name: 'Home Gym',
    machines: HOME_MACHINES,
    type: 'home',
    levelMin: 1,
    levelMax: 1,
    blurb: 'Train and heal your team before entering encounters.',
  },
  {
    id: 'starter-a',
    name: 'Starter Gym A',
    machines: STARTER_A_MACHINES,
    type: 'starter',
    levelMin: 1,
    levelMax: 15,
    blurb: 'Low-risk captures and friendly arena pressure.',
  },
  {
    id: 'starter-b',
    name: 'Starter Gym B',
    machines: STARTER_B_MACHINES,
    type: 'starter',
    levelMin: 16,
    levelMax: 25,
    blurb: 'Mid-game catches. Your control matters more here.',
  },
  {
    id: 'higher-1',
    name: 'Iron Gym',
    machines: IRON_MACHINES,
    type: 'higher',
    levelMin: 26,
    levelMax: 35,
    blurb: 'Higher pressure and stronger opponents.',
  },
  {
    id: 'higher-2',
    name: 'Apex Gym',
    machines: APEX_MACHINES,
    type: 'higher',
    levelMin: 36,
    levelMax: 45,
    blurb: 'Late-band creatures, better prediction beats brute force.',
  },
  {
    id: 'higher-3',
    name: 'Glory Gym',
    machines: GLORY_MACHINES,
    type: 'higher',
    levelMin: 36,
    levelMax: 55,
    blurb: 'Rare encounters and mythological pressure matches.',
  },
];
const ALL_GYM_MACHINES = AREAS.flatMap((area) => area.machines);

const GYM_BOSSES: Record<string, GymBoss[]> = {};

const MOVES: Move[] = [
  { id: 'burst', title: 'Shoulder Burst', tactic: 'fast elbow drive', power: 16, control: -4 },
  { id: 'grind', title: 'Iron Grind', tactic: 'constant center-line pressure', power: 10, control: 10 },
  { id: 'snap', title: 'Snapping Hook', tactic: 'quick short push', power: 13, control: -1 },
];

const CREATURES: Creature[] = [
  {
    dex: 1,
    name: 'Brawny Bear',
    speciesHint: 'Bear',
    flavor: 'A real bear turned into a grappler with a loud chest slam.',
    isExotic: false,
    power: 26,
    sprite: ['..SSSS..', '.SSMMSS.', 'SSMMMMSS', 'SMMDDMMS', 'SMMMMMMS', 'SMMMMMMS', 'SMMSMMSM', '..SSSS..'],
    palette: { skin: '#f2c48c', core: '#5f3a26', detail: '#f7e0a8', accent: '#7b4e24' },
  },
  {
    dex: 2,
    name: 'Titan Tortoise',
    speciesHint: 'Tortoise',
    flavor: 'Shell first, then a heavy shoulder lock with little mercy.',
    isExotic: false,
    power: 22,
    sprite: ['..GGGG..', '.GGMMGG.', 'GGHHHHGG', 'GWWHHWWG', 'GWWHHWWG', 'GGHHHHGG', '.GGGGGG.', '..GGGG..'],
    palette: { skin: '#dbc39e', core: '#4f7345', detail: '#f5dd8f', accent: '#8d5f2d' },
  },
  {
    dex: 3,
    name: 'Iron Wolf',
    speciesHint: 'Wolf',
    flavor: 'It waits until your hands tremble, then hits the center line.',
    isExotic: false,
    power: 24,
    sprite: ['..EEE...', '..EHHH..', '.EHHHHH.', 'EMMHHHHE', 'EMMHHMHE', 'EEMMHHHE', '.EEMMHE.', '..EE....'],
    palette: { skin: '#d6c8a0', core: '#4d4f58', detail: '#2f2e6b', accent: '#f1c45f' },
  },
  {
    dex: 4,
    name: 'Muscled Boar',
    speciesHint: 'Boar',
    flavor: 'Short range, high pressure, no room for sloppy grips.',
    isExotic: false,
    power: 23,
    sprite: ['.RRRRRR.', 'RRRRRRRR', 'RRMMMMRR', 'RMMMMMMR', 'RMMMDDRR', 'RRMDDMRR', '.RRRMMR.', '..RRRR..'],
    palette: { skin: '#f2b074', core: '#7b2d1f', detail: '#7a4f2b', accent: '#6c8b45' },
  },
  {
    dex: 5,
    name: 'Ripped Rhino',
    speciesHint: 'Rhino',
    flavor: 'One horn-like push can decide the entire encounter.',
    isExotic: false,
    power: 29,
    sprite: ['..HHHH..', '.HHHHHH.', 'HHHHHHHH', 'HHMMMMHH', 'HHMMMMHH', 'HMMMMMMH', '.HHHHHH.', '..HHHH..'],
    palette: { skin: '#eadbc0', core: '#7a7d84', detail: '#8e4e38', accent: '#c58a56' },
  },
  {
    dex: 6,
    name: 'Boulder Bison',
    speciesHint: 'Bison',
    flavor: 'Burst first, squeeze until your wrists burn, then keep it tight.',
    isExotic: false,
    power: 27,
    sprite: ['..PPPP..', '.PPPPPP.', 'PPWWWWPP', 'PWWMMWWP', 'PWWMMWWP', 'PWWWWWWP', '.PWWWWP.', '..PPPP..'],
    palette: { skin: '#efe3bc', core: '#7f5a38', detail: '#6c4d2e', accent: '#c7a84e' },
  },
  {
    dex: 7,
    name: 'Buff Otter',
    speciesHint: 'Otter',
    flavor: 'Looks easygoing, but its core locks are deceptive.',
    isExotic: false,
    power: 21,
    sprite: ['..GGGG..', '.GGMMGG.', 'GGMWWMGG', 'GMWWWWMG', 'GMGGGGMG', 'GMGMMGMG', 'GGMMMMGG', '..GGGG..'],
    palette: { skin: '#d3aa86', core: '#53709b', detail: '#925c37', accent: '#f6dfa1' },
  },
  {
    dex: 50,
    name: 'Slycera Griffin',
    speciesHint: 'Griffin',
    flavor: 'A mythic winged body that refuses cheap captures.',
    isExotic: true,
    power: 34,
    sprite: ['..AAAA..', '.AAMMEE.', 'AAMMWWAA', 'AAWWWWAA', 'AAMWWWAA', 'AAWWWWAA', '.AAMWAA.', '..AAAA..'],
    palette: { skin: '#f7d28f', core: '#c23b50', detail: '#ffefba', accent: '#5a4ed6' },
  },
  {
    dex: 51,
    name: 'Cinder Manticore',
    speciesHint: 'Manticore',
    flavor: 'Mythic cat-body reflexes with heavy core resistance.',
    isExotic: true,
    power: 38,
    sprite: ['..FFFF..', 'FFFFFFFF', 'FFMMMMFF', 'FMMWWWFF', 'FMMWWWFF', 'FMWWWWMF', 'F.MWWWF.', '..FFFF..'],
    palette: { skin: '#f4c67a', core: '#4c4cd9', detail: '#f8f1bf', accent: '#ad3f6c' },
  },
  {
    dex: 52,
    name: 'Hydra Lurcher',
    speciesHint: 'Hydra',
    flavor: 'Mythic stamina and repeated counters in the final rounds.',
    isExotic: true,
    power: 40,
    sprite: ['..BBBB..', '.BBBBBB.', 'BBBBBBBB', 'BBMBBMBB', 'BBMMMMBB', 'BMMMBBMB', '.BBBBBB.', '..BBBB..'],
    palette: { skin: '#f6ab63', core: '#302f64', detail: '#b84848', accent: '#a25f34' },
  },
  {
    dex: 53,
    name: 'Pygmy Sable Pegasus',
    speciesHint: 'Pegasus',
    flavor: 'It uses elegant footwork to escape until you find a seam.',
    isExotic: true,
    power: 36,
    sprite: ['..CCCC..', '.CCMMCC.', 'CCMMMMCC', 'CMWWWWMC', 'CMWMMWMC', 'CMWMMWMC', '.CMWWMC.', '..CCCC..'],
    palette: { skin: '#f3cc97', core: '#385db3', detail: '#fbe5b0', accent: '#8d71eb' },
  },
  {
    dex: 54,
    name: 'Titan Gorilla',
    speciesHint: 'Gorilla',
    flavor: 'Quiet, low-gear pressure. Then a brutal last pull.',
    isExotic: false,
    power: 30,
    sprite: ['..BBBB..', '.BBBBBB.', 'BBMMMMBB', 'BBMDDMBB', 'BBMMMMBB', 'BBMMMMBB', '.BBBBBB.', '..BBBB..'],
    palette: { skin: '#d6ad7b', core: '#5f4d33', detail: '#b67a46', accent: '#8b4f2e' },
  },
];

Object.assign(GYM_BOSSES, {
  home: [
    { id: 'home-watchman', name: 'Mat Watchman', creature: CREATURES[0], levelShift: 4, catchMultiplier: 0.7, powerBoost: 9 },
    { id: 'home-librarian', name: 'Steel Desk Warden', creature: CREATURES[6], levelShift: 3, catchMultiplier: 0.7, powerBoost: 7 },
  ],
  'starter-a': [
    { id: 'a-rhino', name: 'Bench Rhino', creature: CREATURES[4], levelShift: 7, catchMultiplier: 0.62, powerBoost: 14 },
    { id: 'a-bison', name: 'Redline Bison', creature: CREATURES[5], levelShift: 8, catchMultiplier: 0.58, powerBoost: 16 },
  ],
  'starter-b': [
    { id: 'b-wolf', name: 'Iron Wolf Brute', creature: CREATURES[2], levelShift: 9, catchMultiplier: 0.55, powerBoost: 18 },
    { id: 'b-boar', name: 'Bull Boar Prime', creature: CREATURES[3], levelShift: 8, catchMultiplier: 0.56, powerBoost: 17 },
  ],
  'higher-1': [
    { id: 'h1-gryphon', name: 'Iron Griffon', creature: CREATURES[7], levelShift: 12, catchMultiplier: 0.52, powerBoost: 22 },
    { id: 'h1-gorilla', name: 'Glory Gorilla Mk.I', creature: CREATURES[10], levelShift: 11, catchMultiplier: 0.5, powerBoost: 24 },
  ],
  'higher-2': [
    { id: 'h2-hydra', name: 'Apex Hydra', creature: CREATURES[8], levelShift: 13, catchMultiplier: 0.5, powerBoost: 25 },
    { id: 'h2-manticore', name: 'Apex Manticore', creature: CREATURES[9], levelShift: 12, catchMultiplier: 0.48, powerBoost: 27 },
  ],
  'higher-3': [
    { id: 'h3-pegasus', name: 'Glory Pegasus', creature: CREATURES[10], levelShift: 14, catchMultiplier: 0.48, powerBoost: 28 },
    { id: 'h3-pegas', name: 'Glory Twin Pegasus', creature: CREATURES[7], levelShift: 15, catchMultiplier: 0.45, powerBoost: 30 },
  ],
});

const FANCY_NAMES = [
  'Muscle Mommy',
  'Bench Bro',
  'Squat Siren',
  'Curl Captain',
  'Plate Whisperer',
  'Wrist-Railer',
  'Grip Guru',
  'Dumbbell Diva',
  'Snatch Ninja',
  'Rope Rebel',
  'Tough Toad',
  'Pectoral Pete',
  'Iron Mama',
];

const TRAINER_PRESETS: TrainerProfile[] = [
  {
    name: 'Rogue Rex',
    skin: '#f2c48c',
    hair: '#4f3a20',
    top: '#2e66af',
    shoes: '#252525',
    glove: '#f3c56b',
    muscles: { shoulders: 4, chest: 3, arms: 3, triceps: 2, back: 2, core: 2, quads: 1, calves: 1 },
  },
  {
    name: 'Neon Nova',
    skin: '#d9b88f',
    hair: '#262626',
    top: '#6c2f8f',
    shoes: '#0f1020',
    glove: '#ffd166',
    muscles: { shoulders: 3, chest: 2, arms: 4, triceps: 3, back: 2, core: 3, quads: 1, calves: 2 },
  },
  {
    name: 'Copper Coil',
    skin: '#d6ad7b',
    hair: '#5a3520',
    top: '#b84f39',
    shoes: '#26262a',
    glove: '#ff7f50',
    muscles: { shoulders: 2, chest: 5, arms: 2, triceps: 2, back: 3, core: 2, quads: 2, calves: 1 },
  },
  {
    name: 'Iron Jade',
    skin: '#f0d0a3',
    hair: '#1f1f17',
    top: '#2f8f75',
    shoes: '#2f2f38',
    glove: '#97d700',
    muscles: { shoulders: 5, chest: 4, arms: 3, triceps: 3, back: 4, core: 4, quads: 3, calves: 2 },
  },
];

const TUTORIAL_STEPS = [
  'Move to Home Gym, pick a trainer name, and select your gear colors.',
  'Train your active Buddy on Home Gym machines to earn XP and Steroids.',
  'Scout a wild Buddy in Starter Gym A/B, then start a match.',
  'Press moves until the meter hits your side and lock in a catch.',
  'Watch for boss encounters in any gym every 5 to 10 minutes and beat them for progress.',
];

const zoneNames = Object.fromEntries(AREAS.map((a) => [a.id, a.name])) as Record<string, string>;
const ZONE_VIBES: Record<
  string,
  { icon: string; mood: string; theme: string; accent: string }
> = {
  home: { icon: '🏠', mood: 'Home warm-up hall', theme: 'calm baseline', accent: 'Recovery' },
  'starter-a': { icon: '🏋', mood: 'Starter pressure room', theme: 'steady overload', accent: 'Momentum' },
  'starter-b': { icon: '🛡', mood: 'Starter control pit', theme: 'grip discipline', accent: 'Tension' },
  'higher-1': { icon: '⚔', mood: 'Higher gate', theme: 'first gauntlet', accent: 'Grip war' },
  'higher-2': { icon: '🔥', mood: 'Higher forge', theme: 'mythic trials', accent: 'Resolve' },
  'higher-3': { icon: '🏆', mood: 'Final deck', theme: 'late-game pressure', accent: 'Dominance' },
};

function formatRemainingTime(ms: number) {
  const left = Math.max(0, Math.ceil(ms / 1000));
  if (left <= 0) return 'ready';
  const minutes = Math.floor(left / 60);
  const seconds = left % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(items: T[]) {
  return items[randInt(0, items.length - 1)];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function workoutFailureChance(
  machine: GymMachine,
  buddy: Buddy,
  zoneType: 'home' | 'starter' | 'higher',
  trainerBonus: number,
) {
  const stress = clamp((machine.fatigueCost - machine.hpRestore + 1) / 8, 0, 0.25);
  const wear = buddy.hp <= 0 ? 0.25 : clamp((buddy.maxHp - buddy.hp) / buddy.maxHp, 0, 0.28);
  const base = (BASE_TRAIN_FAIL_CHANCE + stress + wear) * machineDifficultyMultiplier(zoneType) - trainerBonus;
  return clamp(base, 0.15, 0.85);
}

function workoutSpotSuccessChance(
  windowMsRemaining: number,
  base = BASE_SPOT_SUCCESS_CHANCE,
  zoneType: 'home' | 'starter' | 'higher' = 'starter',
) {
  const ratio = clamp01(windowMsRemaining / WORKOUT_SPOT_WINDOW_MS);
  const multiplier = spotCurveMultiplier(zoneType);
  return clamp(base + ratio * multiplier, zoneType === 'higher' ? 0.35 : 0.4, 0.95);
}

function roundForDisplay(value: number) {
  return `${Math.max(0, value)}`;
}

const BGM_NOTES: Record<
  MusicIntensity,
  {
    ambient: number[];
    scout: number[];
    boss: number[];
    interval: number;
  }
> = {
  home: {
    ambient: [110, 131, 146, 164],
    scout: [123, 146, 164, 146],
    boss: [88, 110, 123, 131],
    interval: 470,
  },
  starter: {
    ambient: [147, 165, 196, 175],
    scout: [165, 196, 220, 247, 220],
    boss: [220, 247, 262, 294, 247],
    interval: 360,
  },
  higher: {
    ambient: [196, 220, 247, 294],
    scout: [220, 247, 262, 294, 262],
    boss: [294, 330, 349, 392, 330],
    interval: 255,
  },
};

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function createTone() {
  const audioCtx = window.AudioContext || (window as any).webkitAudioContext;
  return new audioCtx();
}

function scheduleTone(context: AudioContext, destination: GainNode, frequency: number, duration: number, intensity: number, wave: OscillatorType = 'triangle') {
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const amp = clamp01(intensity);
  oscillator.type = wave;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(amp * 0.26, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.05);
}

function createAudioEngine(): AudioEngine {
  const context = createTone() as AudioContext;
  const masterGain = context.createGain();
  const musicGain = context.createGain();
  const sfxGain = context.createGain();
  masterGain.connect(context.destination);
  musicGain.connect(masterGain);
  sfxGain.connect(masterGain);
  masterGain.gain.value = 1;
  musicGain.gain.value = 0.48;
  sfxGain.gain.value = 0.82;

  const engine: AudioEngine = {
    context,
    masterGain,
    musicGain,
    sfxGain,
    musicTicker: null,
    enabled: true,
    zone: 'ambient',
    intensity: 'starter',
    step: 0,
    stepNotes: BGM_NOTES.starter.ambient,
    setEnabled(value) {
      this.enabled = value;
      this.masterGain.gain.value = value ? 1 : 0;
      if (!value) {
        this.stopMusic();
      }
    },
    setVolumes(music, sfx) {
      this.musicGain.gain.value = clamp01(music);
      this.sfxGain.gain.value = clamp01(sfx);
    },
    stopMusic() {
      if (this.musicTicker) {
        clearInterval(this.musicTicker);
      }
      this.musicTicker = null;
      this.step = 0;
    },
    startMusic(zone, intensity) {
      this.stopMusic();
      if (!this.enabled) return;
      this.zone = zone;
      this.intensity = intensity;
      const profile = BGM_NOTES[intensity];
      const base = zone === 'home' ? profile.ambient : zone === 'boss' ? profile.boss : profile.scout;
      this.stepNotes = zone === 'fight' ? profile.scout : base;
      this.context.resume();
      if (this.context.state !== 'running') {
        return;
      }
      this.musicTicker = setInterval(() => {
        if (this.context.state !== 'running' || !this.enabled) {
          return;
        }
        const current = this.stepNotes[this.step % this.stepNotes.length];
        scheduleTone(this.context, this.musicGain, current * (zone === 'boss' ? 1.12 : 1), 0.15, 0.4, this.intensity === 'home' ? 'sine' : 'triangle');
        scheduleTone(this.context, this.musicGain, current * 1.9, 0.09, 0.22, 'sawtooth');
        if (this.intensity === 'higher' || zone === 'boss') {
          scheduleTone(this.context, this.musicGain, current * 1.18, 0.065, 0.16, 'triangle');
        }
        this.step += 1;
      }, this.intensity === 'higher' ? 230 : profile.interval);
    },
    pulseTone(frequency, duration, gainValue, wave = 'triangle') {
      if (!this.enabled || this.context.state !== 'running') return;
      scheduleTone(this.context, this.sfxGain, frequency, duration, gainValue, wave);
    },
    emitSfx(event, intensity = 1) {
      if (!this.enabled || this.context.state !== 'running') return;
      const baseGain = 0.2 + Math.min(intensity, 1.4);
      if (event === 'train') {
        this.pulseTone(220, 0.06, baseGain * 0.6, 'triangle');
        this.pulseTone(275, 0.08, baseGain * 0.4, 'triangle');
      } else if (event === 'steroid') {
        this.pulseTone(330, 0.14, baseGain * 0.55, 'sawtooth');
        this.pulseTone(440, 0.09, baseGain * 0.4, 'triangle');
      } else if (event === 'matchStart') {
        this.pulseTone(164, 0.12, baseGain * 0.52, 'sine');
        this.pulseTone(220, 0.12, baseGain * 0.55, 'sine');
        this.pulseTone(294, 0.09, baseGain * 0.44, 'triangle');
      } else if (event === 'moveGood') {
        this.pulseTone(349, 0.05, baseGain * 0.45, 'triangle');
      } else if (event === 'moveBad') {
        this.pulseTone(196, 0.07, baseGain * 0.38, 'triangle');
      } else if (event === 'catchAlmost') {
        this.pulseTone(262, 0.12, baseGain * 0.5, 'triangle');
      } else if (event === 'catchWin') {
        scheduleTone(this.context, this.sfxGain, 330, 0.1, baseGain * 0.5, 'triangle');
        scheduleTone(this.context, this.sfxGain, 392, 0.1, baseGain * 0.55, 'triangle');
        scheduleTone(this.context, this.sfxGain, 523, 0.17, baseGain * 0.35, 'sine');
      } else if (event === 'bossAlert') {
        this.pulseTone(523, 0.16, baseGain * 0.35, 'square');
        this.pulseTone(466, 0.11, baseGain * 0.32, 'square');
      } else if (event === 'teamFull') {
        this.pulseTone(147, 0.11, baseGain * 0.36, 'triangle');
      } else if (event === 'escape') {
        this.pulseTone(164, 0.09, baseGain * 0.4, 'sine');
      } else if (event === 'zoneShift') {
        this.pulseTone(246, 0.09, baseGain * 0.3, 'sine');
        this.pulseTone(185, 0.07, baseGain * 0.33, 'triangle');
      }
    },
    dispose() {
      this.stopMusic();
      this.context.close();
    },
  };

  return engine;
}

function getCatchChance(level: number, isExotic: boolean) {
  if (isExotic) return 0.4;
  if (level <= 15) return 0.9;
  if (level <= 25) return 0.85;
  if (level <= 35) return 0.8;
  return 0.7;
}

function nowMs() {
  return Date.now();
}

function bossInterval() {
  return randInt(Math.floor(BOSS_MIN_MS / 60000), Math.floor(BOSS_MAX_MS / 60000)) * 60 * 1000;
}

function bossForZone(zoneId: string): GymBoss[] {
  return GYM_BOSSES[zoneId] ?? GYM_BOSSES[AREAS[1].id];
}

function xpNeeded(level: number) {
  return Math.max(8, level * 5);
}

function seedBuddy(seed: number, creature: Creature, level = 4): Buddy {
  const maxHp = 34 + level * 4;
  return {
    id: `seed-${seed}`,
    nickname: `${randomChoice(FANCY_NAMES)} #${seed}`,
    creature,
    level,
    hp: maxHp,
    maxHp,
    xp: 0,
  };
}

function classForPixel(cell: string) {
  switch (cell) {
    case 'M':
    case 'S':
      return 'pixel-main';
    case 'D':
      return 'pixel-core';
    case 'E':
      return 'pixel-detail';
    case 'W':
      return 'pixel-core';
    case 'H':
    case 'P':
      return 'pixel-accent';
    case 'R':
      return 'pixel-detail';
    default:
      return 'pixel-empty';
  }
}

function trainerTemplate() {
  return [
    '.HHH.....',
    'HHSHH....',
    '.SSCCSS..',
    'SSSTTCC.',
    '.UUBBB..',
    '.UGGGA..',
    '.PAA....',
    '.P..AA..',
  ];
}

function hexToRgb(hex: string) {
  const sanitized = hex.replace('#', '');
  const value = parseInt(sanitized.length === 3 ? sanitized.split('').map((c) => c + c).join('') : sanitized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex(value: number) {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function blendHex(base: string, blend: string, ratio: number) {
  const source = hexToRgb(base);
  const target = hexToRgb(blend);
  const mixed = {
    r: Math.round(source.r + (target.r - source.r) * ratio),
    g: Math.round(source.g + (target.g - source.g) * ratio),
    b: Math.round(source.b + (target.b - source.b) * ratio),
  };
  return rgbToHex(((mixed.r << 16) | (mixed.g << 8) | mixed.b) >>> 0);
}

function clampMuscles(muscles: TrainerProfile['muscles']) {
  const next = { ...muscles } as TrainerProfile['muscles'];
  (Object.keys(next) as Array<keyof TrainerProfile['muscles']>).forEach((key) => {
    next[key] = clamp(next[key], 0, MAX_MUSCLE_LEVEL);
  });
  return next;
}

function trainerFromFocus(focus: string) {
  const key = focus.toLowerCase();
  return FOCUSED_MUSCLES[key] ?? FOCUSED_MUSCLES[Object.keys(FOCUSED_MUSCLES).find((k) => key.includes(k)) ?? 'control'];
}

function applyTrainerGrowth(trainer: TrainerProfile, focus: string, intensity: number, bonus: number) {
  const gains = trainerFromFocus(focus);
  const gainTotal = Math.max(1, intensity + bonus);
  const totalWeight = gains.reduce((acc, item) => acc + item.weight, 0);
  const profile = { ...trainer.muscles };
  let distributed = 0;

  gains.forEach((entry) => {
    const raw = Math.floor((gainTotal * entry.weight) / totalWeight);
    const amount = Math.max(0, Math.min(3, raw));
    profile[entry.muscle] += amount;
    distributed += amount;
  });

  const remainder = gainTotal - distributed;
  if (remainder > 0) {
    const leader = gains[0];
    if (leader) {
      profile[leader.muscle] += Math.max(1, remainder);
    }
  }

  return {
    ...trainer,
    muscles: clampMuscles(profile),
  };
}

function trainerPhysiqueLevel(muscles: TrainerProfile['muscles']) {
  const total = Object.values(muscles).reduce((sum, value) => sum + value, 0);
  const max = Object.keys(muscles).length * MAX_MUSCLE_LEVEL;
  return clamp(Math.floor((total / max) * 40), 1, 40);
}


function PixelCreature({ creature }: { creature: Creature }) {
  return (
    <div
      className="pixel-sprite"
      style={{
        '--skin': creature.palette.skin,
        '--core': creature.palette.core,
        '--detail': creature.palette.detail,
        '--accent': creature.palette.accent,
      } as Record<string, string>}
    >
      {creature.sprite.map((row, r) => (
        <div className="pixel-row" key={`r-${r}`}>
          {[...row].map((cell, c) => (
            <span key={`${r}-${c}`} className={`pixel ${classForPixel(cell)}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function TrainerSprite({ trainer, emote = 'neutral' }: { trainer: TrainerProfile; emote?: TrainerEmote }) {
  const sprite = trainerTemplate();
  const emotePalette: Record<TrainerEmote, string> = {
    neutral: '😐',
    focus: '👀',
    grind: '😤',
    pump: '🔥',
    level: '✨',
    victory: '🏆',
    drained: '😵',
    ready: '⚡',
  };
  const physique = trainerPhysiqueLevel(trainer.muscles);

  function muscleTone(group: keyof TrainerProfile['muscles']) {
    const base = trainer.muscles[group];
    const intensity = clamp(base / MAX_MUSCLE_LEVEL, 0, 1);
    const colorBias =
      group === 'shoulders' || group === 'chest' || group === 'triceps'
        ? trainer.top
        : group === 'arms'
          ? trainer.glove
          : group === 'core' || group === 'back'
            ? trainer.skin
            : trainer.shoes;
    const accent = blendHex(trainer.skin, colorBias, intensity * 0.55);
    return base > 0 ? accent : trainer.skin;
  }

  function pixelFor(cell: string) {
    switch (cell) {
      case 'H':
        return trainer.hair;
      case 'S':
        return trainer.skin;
      case 'T':
        return trainer.top;
      case 'G':
        return trainer.glove;
      case 'P':
        return trainer.shoes;
      case 'A':
        return muscleTone('arms');
      case 'C':
        return muscleTone('chest');
      case 'B':
        return muscleTone('shoulders');
      case 'Q':
        return muscleTone('quads');
      case 'U':
        return muscleTone('core');
      default:
        return 'transparent';
    }
  }

  return (
    <div className="trainer-sprite-wrap">
      <div className="trainer-emote" title={`Physique: ${physique}`}>
        {emotePalette[emote]}
      </div>
      <div className="trainer-sprite" style={{ '--trainer-name': trainer.name } as Record<string, string>}>
        {sprite.map((row, r) => (
          <div className="pixel-row" key={`trainer-row-${r}`}>
            {[...row].map((cell, c) => (
              <span
                key={`${r}-${c}`}
                className="pixel"
                style={{ backgroundColor: pixelFor(cell) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="trainer-muscle-summary">
        Physique Lvl {String(physique).padStart(2, '0')}
      </div>
    </div>
  );
}

function createOpponent(zone: GymArea): Encounter {
  const mythicChance = zone.type === 'higher' ? 0.22 : zone.type === 'starter' ? 0.1 : 0;
  const pool = CREATURES.filter((c) => c.isExotic === (Math.random() < mythicChance));
  const source = pool.length > 0 ? pool : CREATURES.filter((c) => !c.isExotic);
  const creature = randomChoice(source);
  const level = randInt(zone.levelMin, zone.levelMax);
  return { creature, level, zoneId: zone.id, catchChance: getCatchChance(level, creature.isExotic), isBoss: false };
}

function createBoss(zone: GymArea): Encounter {
  const pool = bossForZone(zone.id);
  const boss = randomChoice(pool);
  const creature = boss.creature;
  const level = randInt(zone.levelMin + boss.levelShift, zone.levelMax + boss.levelShift);
  const baseChance = getCatchChance(level, creature.isExotic);
  return {
    creature,
    level,
    zoneId: zone.id,
    catchChance: clamp(baseChance * boss.catchMultiplier, 0.05, 0.6),
    isBoss: true,
    bossName: `${boss.name} — ${creature.name}`,
    bossPowerBonus: boss.powerBoost,
  };
}

function applyXpGain(buddy: Buddy, bonus: number) {
  let xp = buddy.xp + bonus;
  let level = buddy.level;
  let maxHp = buddy.maxHp;
  let leveled = false;

  while (xp >= xpNeeded(level)) {
    xp -= xpNeeded(level);
    level += 1;
    maxHp += 3;
    leveled = true;
  }

  return {
    leveled,
    buddy: {
      ...buddy,
      xp,
      level,
      maxHp,
      hp: clamp(buddy.hp + (leveled ? 12 : 5), 1, maxHp),
    },
  };
}

function initialSaveData(): SaveData {
  const preset = { ...TRAINER_PRESETS[0], name: 'Trainer' };
  const fallback: SaveData = {
    version: 'v7',
    trainer: {
      ...preset,
    },
    steroids: 3,
    activeIndex: 0,
    activeZoneId: 'home',
    team: [seedBuddy(1, CREATURES[0], 5), seedBuddy(2, CREATURES[1], 4)],
    seenDex: [1, 2],
    caughtDex: [1, 2],
    selectedMachineByZone: Object.fromEntries(AREAS.map((zone) => [zone.id, zone.machines[0]?.id ?? ''])),
    bossSchedules: Object.fromEntries(
      AREAS.map((zone) => [zone.id, { nextBossAt: nowMs() + bossInterval(), defeated: 0 }]),
    ) as Record<string, BossSchedule>,
    audio: {
      enabled: true,
      musicVolume: 0.5,
      sfxVolume: 0.82,
    },
    tutorialStep: 0,
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<SaveData>;
    if (
      !parsed ||
      (parsed.version !== 'v3' &&
        parsed.version !== 'v4' &&
        parsed.version !== 'v5' &&
        parsed.version !== 'v6' &&
        parsed.version !== 'v7')
    ) {
      return fallback;
    }

    const team = (parsed.team ?? fallback.team).slice(0, TEAM_SIZE).map((buddy) => ({
      ...buddy,
      level: Math.max(1, buddy.level),
      hp: Math.max(1, Math.min(buddy.maxHp, buddy.hp)),
      maxHp: Math.max(18, buddy.maxHp),
      xp: Math.max(0, buddy.xp),
    }));

    return {
      ...fallback,
      ...parsed,
      trainer: {
        ...fallback.trainer,
        ...parsed.trainer,
        name: parsed.trainer?.name?.trim() ? parsed.trainer.name : fallback.trainer.name,
        muscles: clampMuscles({
          ...fallback.trainer.muscles,
          ...parsed.trainer?.muscles,
        } as TrainerProfile['muscles']),
      },
      team,
      selectedMachineByZone: {
        ...fallback.selectedMachineByZone,
        ...(parsed.selectedMachineByZone ?? {}),
      },
      bossSchedules: {
        ...fallback.bossSchedules,
        ...(parsed.bossSchedules ?? {}),
      },
      activeIndex: clamp(parsed.activeIndex ?? 0, 0, Math.max(0, team.length - 1)),
      steroids: Math.max(0, parsed.steroids ?? 3),
      seenDex: parsed.seenDex ?? fallback.seenDex,
      caughtDex: parsed.caughtDex ?? fallback.caughtDex,
      activeZoneId: parsed.activeZoneId ?? 'home',
      audio: {
        ...fallback.audio,
        ...parsed.audio,
        musicVolume: clamp01(parsed.audio?.musicVolume ?? fallback.audio.musicVolume),
        sfxVolume: clamp01(parsed.audio?.sfxVolume ?? fallback.audio.sfxVolume),
      },
      tutorialStep: parsed.tutorialStep ?? 0,
    };
  } catch {
    return fallback;
  }
}

export default function App() {
  const [save, setSave] = useState<SaveData>(initialSaveData);
  const [encounter, setEncounter] = useState<Encounter | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [workoutSession, setWorkoutSession] = useState<WorkoutSession | null>(null);
  const [workoutFrame, setWorkoutFrame] = useState(nowMs);
  const [message, setMessage] = useState('Welcome to Gym Buddies. Start from Home Gym and build your team.');
  const [tick, setTick] = useState(nowMs);
  const [log, setLog] = useState<string[]>([
    'Home Gym open. Team and capture loop ready.',
    '6 Gym world loaded. Steroids work like level-up candies.',
  ]);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [zoneTransit, setZoneTransit] = useState<ZoneTransit | null>(null);
  const [showTrainerPanel, setShowTrainerPanel] = useState(false);
  const [trainerEmote, setTrainerEmote] = useState<TrainerEmote>('neutral');
  const [trainerEmoteUntil, setTrainerEmoteUntil] = useState(0);
  const audioRef = useRef<AudioEngine | null>(null);

  const activeZone = useMemo(
    () => AREAS.find((area) => area.id === save.activeZoneId) ?? AREAS[0],
    [save.activeZoneId],
  );

  const activeBuddy = save.team[save.activeIndex] ?? null;
  const seenDex = useMemo(() => [...save.seenDex].sort((a, b) => a - b), [save.seenDex]);
  const caughtDex = useMemo(() => [...save.caughtDex].sort((a, b) => a - b), [save.caughtDex]);
  const activeMachine = useMemo(() => {
    const id = save.selectedMachineByZone[activeZone.id];
    return activeZone.machines.find((machine) => machine.id === id) ?? activeZone.machines[0] ?? null;
  }, [activeZone, save.selectedMachineByZone]);
  const bossSchedule = save.bossSchedules[activeZone.id];
  const bossTicker = formatRemainingTime((bossSchedule?.nextBossAt ?? tick) - tick);
  const trainer = save.trainer;
  const tutorialActive = save.tutorialStep < TUTORIAL_STEPS.length;
  const currentTutorialText = TUTORIAL_STEPS[Math.min(save.tutorialStep, TUTORIAL_STEPS.length - 1)] ?? '';
  const zoneVibe = ZONE_VIBES[activeZone.id] ?? { icon: '🗺', mood: 'Unknown', theme: 'open gym', accent: 'Unknown' };
  const activeEmote: TrainerEmote = trainerEmoteUntil > tick ? trainerEmote : 'neutral';
  const trainerPhysique = trainerPhysiqueLevel(trainer.muscles);
  const workoutProgress =
    !workoutSession || workoutSession.phase === 'resolved'
      ? 0
      : workoutSession.phase === 'running'
        ? clamp(
            Math.round(((workoutFrame - workoutSession.startedAt) / (workoutSession.durationMs || 1)) * 100),
            0,
            100,
          )
        : clamp(Math.round(((workoutSession.spotWindowEnd - workoutFrame) / (workoutSession.spotWindowMs || 1)) * 100), 0, 100);
  const workoutSpotRemainingMs = workoutSession?.phase === 'spot' ? Math.max(0, workoutSession.spotWindowEnd - workoutFrame) : 0;
  const canSpot = workoutSession?.phase === 'spot' && !workoutSession.resolved && workoutSession.buddyId === activeBuddy?.id;

  function getAudioEngine() {
    if (audioRef.current) {
      return audioRef.current;
    }
    const engine = createAudioEngine();
    audioRef.current = engine;
    return engine;
  }

  function activateAudioEngine() {
    const engine = getAudioEngine();
    engine.setEnabled(save.audio.enabled);
    engine.setVolumes(save.audio.musicVolume, save.audio.sfxVolume);
    void engine.context.resume();
    return engine;
  }

  function updateMusic() {
    const engine = activateAudioEngine();
    const zone: MusicZoneState =
      activeZone.type === 'home' ? 'home' : encounter?.isBoss ? 'boss' : match?.status === 'playing' ? 'fight' : 'ambient';
    const intensity = activeZone.type === 'home' ? 'home' : activeZone.type === 'starter' ? 'starter' : 'higher';
    engine.startMusic(zone, intensity);
  }

  function setAudioEnabled(enabled: boolean) {
    setSave((state) => ({
      ...state,
      audio: {
        ...state.audio,
        enabled,
      },
    }));
    const engine = getAudioEngine();
    engine.setEnabled(enabled);
    if (enabled) {
      updateMusic();
    }
  }

  function setMusicVolume(value: number) {
    const volume = clamp01(value);
    setSave((state) => ({
      ...state,
      audio: {
        ...state.audio,
        musicVolume: volume,
      },
    }));
    if (!audioRef.current) return;
    audioRef.current.musicGain.gain.value = volume;
  }

  function setSfxVolume(value: number) {
    const volume = clamp01(value);
    setSave((state) => ({
      ...state,
      audio: {
        ...state.audio,
        sfxVolume: volume,
      },
    }));
    if (!audioRef.current) return;
    audioRef.current.sfxGain.gain.value = volume;
  }

  function getGymBossTicker(zone: GymArea) {
    const nextAt = save.bossSchedules[zone.id]?.nextBossAt ?? tick;
    const remaining = nextAt - tick;
    return remaining <= 0 ? 'READY' : formatRemainingTime(remaining);
  }

  function triggerBossSpawn(gym: GymArea) {
    if (!encounter && !match) {
      const now = nowMs();
      const schedule = save.bossSchedules[gym.id];
      if (schedule && now >= schedule.nextBossAt) {
        const boss = createBoss(gym);
        setEncounter(boss);
        setMatch(null);
        activateAudioEngine().emitSfx('bossAlert', 1.2);
        setSave((state) => ({
          ...state,
          bossSchedules: {
            ...state.bossSchedules,
            [gym.id]: {
              nextBossAt: now + bossInterval(),
              defeated: (state.bossSchedules[gym.id]?.defeated ?? 0) + 1,
            },
          },
        }));
        setMessage(`A gym boss appeared at ${gym.name}: ${boss.bossName}!`);
        pushLog(`Boss spawn in ${gym.name}: ${boss.bossName} Lv.${boss.level}.`);
      }
    }
  }

  useEffect(() => {
    if (!zoneTransit) return;
    const id = window.setTimeout(() => setZoneTransit(null), 1200);
    return () => clearTimeout(id);
  }, [zoneTransit]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setWorkoutFrame(nowMs());
    }, 90);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!workoutSession || workoutSession.resolved) return;
    const timer = window.setInterval(() => {
      setWorkoutSession((current) => {
        if (!current || current.resolved) return current;
        const now = nowMs();

        if (current.phase === 'running') {
          if (current.willFail && now >= current.failCheckAt) {
            return {
              ...current,
              phase: 'spot',
              spotWindowStart: now,
              spotWindowEnd: now + current.spotWindowMs,
            };
          }
          if (now >= current.startedAt + current.durationMs) {
            const complete: WorkoutSession = {
              ...current,
              phase: 'resolved',
              resolved: true,
            };
            queueMicrotask(() => resolveWorkoutSession(complete, true));
            return complete;
          }
          return current;
        }

        if (current.phase === 'spot' && now > current.spotWindowEnd) {
          const failed: WorkoutSession = {
            ...current,
            phase: 'resolved',
            resolved: true,
          };
          queueMicrotask(() => resolveWorkoutSession(failed, false));
          return failed;
        }
        return current;
      });
    }, 90);
    return () => clearInterval(timer);
  }, [workoutSession]);

  useEffect(() => {
    if (!workoutSession || !workoutSession.resolved) return;
    const timeout = window.setTimeout(() => setWorkoutSession((current) => (current?.resolved ? null : current)), 1000);
    return () => clearTimeout(timeout);
  }, [workoutSession]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTick(nowMs());
      triggerBossSpawn(activeZone);
    }, 1000);
    return () => clearInterval(timer);
  }, [save.activeZoneId, save.bossSchedules, encounter, match]);

  useEffect(() => {
    if (!save.audio.enabled) {
      const engine = getAudioEngine();
      engine.setEnabled(false);
      return;
    }

    const engine = activateAudioEngine();
    engine.setVolumes(save.audio.musicVolume, save.audio.sfxVolume);
    updateMusic();
    return () => {};
  }, [
    activeZone.id,
    activeZone.type,
    save.audio.enabled,
    save.audio.musicVolume,
    save.audio.sfxVolume,
    encounter?.isBoss,
    match?.status,
  ]);

  useEffect(() => {
    return () => {
      if (!audioRef.current) return;
      audioRef.current.dispose();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }, [save]);

  function resetTutorial() {
    setSave((state) => ({ ...state, tutorialStep: 0 }));
  }

  function nextTutorialStep() {
    setSave((state) => {
      const next = Math.min(state.tutorialStep + 1, TUTORIAL_STEPS.length);
      if (next >= TUTORIAL_STEPS.length) {
        setMessage('Tutorial complete. Start training and scouting for buddies.');
      }
      return {
        ...state,
        tutorialStep: next,
      };
    });
  }

  function finishTutorialNow() {
    setSave((state) => ({ ...state, tutorialStep: TUTORIAL_STEPS.length }));
    setMessage('Tutorial skipped. Good luck, trainer.');
  }

  function setTrainerName(event: { target: { value: string } }) {
    setSave((state) => ({
      ...state,
      trainer: {
        ...state.trainer,
        name: event.target.value.slice(0, 14) || 'Trainer',
      },
    }));
  }

  function setTrainerPreset(profile: TrainerProfile) {
    setSave((state) => ({ ...state, trainer: { ...profile } }));
  }

  function setTrainerColor(part: keyof Omit<TrainerProfile, 'name' | 'muscles'>, value: string) {
    setSave((state) => ({
      ...state,
      trainer: {
        ...state.trainer,
        [part]: value,
      },
    }));
  }

  function setTrainerMuscle(group: keyof TrainerProfile['muscles'], value: number) {
    setSave((state) => ({
      ...state,
      trainer: {
        ...state.trainer,
        muscles: {
          ...state.trainer.muscles,
          [group]: clamp(Number.isFinite(value) ? value : 0, 0, MAX_MUSCLE_LEVEL),
        },
      },
    }));
    setTrainerEmote('pump');
    setTrainerEmoteUntil(nowMs() + 900);
  }

  function pulseTrainerEmote(state: TrainerEmote, ttl = 1800) {
    setTrainerEmote(state);
    setTrainerEmoteUntil(nowMs() + ttl);
  }

  function pushLog(entry: string) {
    setLog((prev) => [entry, ...prev].slice(0, 12));
  }

  function switchArea(id: string) {
    if (id === save.activeZoneId) return;
    const zone = AREAS.find((area) => area.id === id);
    if (!zone) return;
    if (workoutSession && !workoutSession.resolved) {
      setWorkoutSession(null);
      setMessage('You left while your Buddy was in training. The set ends.');
    }
    setSave((state) => ({ ...state, activeZoneId: id }));
    setZoneTransit({
      from: activeZone.name,
      to: zone.name,
      icon: ZONE_VIBES[id]?.icon ?? '🗺',
    });
    setEncounter(null);
    setMatch(null);
    activateAudioEngine().emitSfx('zoneShift', 0.6);
    const machineName = zone.machines[0]?.name ?? 'no machine';
    setMessage(`Moved to ${zone.name}. Current machine: ${machineName}.`);
    pulseTrainerEmote('focus', 1600);
    triggerBossSpawn(zone);
  }

  function selectBuddy(index: number) {
    if (!save.team[index]) return;
    if (workoutSession && !workoutSession.resolved) {
      setMessage('Finish the active training set before swapping Buddy slots.');
      return;
    }
    setSave((state) => ({ ...state, activeIndex: index }));
    setMessage(`Selected ${save.team[index].nickname}.`);
  }
  function selectMachine(id: string) {
    setSave((state) => ({
      ...state,
      selectedMachineByZone: {
        ...state.selectedMachineByZone,
        [activeZone.id]: id,
      },
    }));
    const machine = activeZone.machines.find((entry) => entry.id === id);
    if (machine) {
      setMessage(`Selected ${machine.name} in ${activeZone.name}.`);
    }
  }
  function resolveWorkoutSession(session: WorkoutSession, succeeded: boolean) {
    const machine = ALL_GYM_MACHINES.find((entry) => entry.id === session.machineId);
    if (!machine) {
      setWorkoutSession(null);
      return;
    }

    if (!session.resolved) return;

    if (succeeded) {
      let resultBuddy: Buddy | null = null;
      let leveled = false;
      setSave((state) => ({
        ...state,
        trainer: (() => {
          const idx = state.team.findIndex((buddy) => buddy.id === session.buddyId);
          if (idx < 0) return state.trainer;
          const sourceBuddy = state.team[idx];
          const result = applyXpGain(sourceBuddy, session.xpGain);
          leveled = result.leveled;
          resultBuddy = {
            ...result.buddy,
            hp: clamp(result.buddy.hp + session.staminaChange, 0, result.buddy.maxHp),
          };
          return applyTrainerGrowth(
            state.trainer,
            machine.focus,
            Math.max(1, Math.floor(session.xpGain / 3)),
            result.leveled ? 1 : 0,
          );
        })(),
        steroids: state.steroids + (session.steroidsAwarded ? 1 : 0),
        team: state.team.map((buddy) =>
          buddy.id === session.buddyId
            ? {
                ...buddy,
                ...resultBuddy,
                hp: clamp((resultBuddy?.hp ?? buddy.hp), 0, buddy.maxHp),
              }
            : buddy,
        ),
      }));
      const completedBuddy = resultBuddy as Buddy | null;
      if (completedBuddy) {
        setMessage(
          `${completedBuddy.nickname} finished training on ${machine.name}: +${session.xpGain}XP${
            leveled ? ' and leveled up.' : ''
          } · ${machine.focus} · Stamina ${session.staminaChange >= 0 ? '+' : ''}${session.staminaChange}${
            session.steroidsAwarded ? ' · Found one Steroid.' : ''
          }`,
        );
        pushLog(`${completedBuddy.nickname} completed training on ${machine.name} at ${activeZone.name}.`);
      }
      activateAudioEngine().emitSfx('train', Math.min(1.6, session.xpGain / machine.xpMax));
      pulseTrainerEmote('level', leveled ? 1200 : 900);
      return;
    }

    const target = save.team.find((entry) => entry.id === session.buddyId);
    setSave((state) => ({
      ...state,
      team: state.team.map((buddy) =>
        buddy.id === session.buddyId
          ? {
              ...buddy,
              hp: clamp(buddy.hp - session.hpLossOnFail, 0, buddy.maxHp),
            }
          : buddy,
      ),
    }));
    setMessage(`${target?.nickname ?? 'Buddy'} failed ${machine.name} and was spot-needed.`);
    pushLog(`${target?.nickname ?? 'Buddy'} failed training on ${machine.name} at ${activeZone.name}.`);
    pulseTrainerEmote('drained', 900);
    activateAudioEngine().emitSfx('moveBad', 1);
    setTrainerEmote('drained');
    setTrainerEmoteUntil(nowMs() + 900);
  }

  function sendToWorkout() {
    if (workoutSession && !workoutSession.resolved) {
      setMessage('A training set is already running.');
      return;
    }
    if (!activeBuddy) return;
    if (!activeMachine) {
      setMessage('No machine selected in this gym.');
      return;
    }
    if (activeBuddy.hp <= activeMachine.fatigueCost) {
      setMessage(
        `${activeBuddy.nickname} is too worn down to push ${activeMachine.name} right now. Rest or pick a low-fatigue machine.`,
      );
      return;
    }
    if (encounter) {
      setMessage('Finish the active encounter before training.');
      return;
    }

    const gain = randInt(activeMachine.xpMin, activeMachine.xpMax);
    const adjusted = Math.max(1, Math.ceil(gain * activeMachine.xpMultiplier));
    const staminaChange = activeMachine.hpRestore - activeMachine.fatigueCost;
    const trainerAdvantage = trainerWorkoutAdvantage(activeMachine, trainer, activeZone.type);
    const failChance = workoutFailureChance(activeMachine, activeBuddy, activeZone.type, trainerAdvantage.failReduction);
    const spotBase = clamp(
      BASE_SPOT_SUCCESS_CHANCE + trainerAdvantage.spotBaseBonus + (activeZone.type === 'higher' ? -0.05 : 0),
      0.5,
      0.9,
    );
    const willFail = Math.random() < failChance;
    const now = nowMs();

    setWorkoutSession({
      id: now,
      phase: 'running',
      zoneType: activeZone.type,
      buddyId: activeBuddy.id,
      machineId: activeMachine.id,
      willFail,
      startedAt: now,
      durationMs: WORKOUT_DURATION_MS,
      failCheckAt: now + WORKOUT_AUTO_FAILURE_MS,
      spotWindowMs: WORKOUT_SPOT_WINDOW_MS,
      spotWindowStart: 0,
      spotWindowEnd: 0,
      failChance,
      buddyLevelBefore: activeBuddy.level,
      hpLossOnFail: clamp(Math.ceil(activeMachine.fatigueCost * 1.3), 1, activeBuddy.maxHp),
      xpGain: adjusted,
      spotChanceBase: spotBase,
      steroidsAwarded: Math.random() < activeMachine.steroidChance,
      staminaChange,
      resolved: false,
    });

    setMessage(`${activeBuddy.nickname} starts a full-set on ${activeMachine.name}. Spot if rep form breaks!`);
    pulseTrainerEmote('focus', 900);
    activateAudioEngine().emitSfx('train', 0.6);
    pushLog(`${activeBuddy.nickname} began training on ${activeMachine.name} with ${percent(failChance)} fail chance.`);
  }

  function spotWorkout() {
    if (!canSpot || !workoutSession || !workoutSession.willFail) return;
    const successChance = workoutSpotSuccessChance(
      workoutSpotRemainingMs,
      workoutSession.spotChanceBase,
      workoutSession.zoneType,
    );
    const success = Math.random() < successChance;
    setWorkoutSession((current) =>
      current && current.id === workoutSession.id && !current.resolved
        ? {
            ...current,
            phase: 'resolved',
            resolved: true,
          }
        : current,
    );
    resolveWorkoutSession({ ...workoutSession, phase: 'resolved', resolved: true }, success);
    setMessage(
      success ? `You rushed in and held the set (${percent(successChance)}).` : 'You were a beat too late for the spot.',
    );
    activateAudioEngine().emitSfx(success ? 'train' : 'moveBad', 1);
  }

  function useSteroid() {
    if (!activeBuddy) return;
    if (save.steroids <= 0) {
      setMessage('No Steroids left. Train more to earn one.');
      return;
    }

    const result = applyXpGain(activeBuddy, 4);
    setSave((state) => ({
      ...state,
      trainer: applyTrainerGrowth(state.trainer, 'Power', 2, result.leveled ? 1 : 0),
      steroids: Math.max(0, state.steroids - 1),
      team: state.team.map((buddy, index) =>
        index === state.activeIndex
          ? {
              ...result.buddy,
            }
          : buddy,
      ),
    }));

    setMessage(
      `${activeBuddy.nickname} used 1 Steroid.${result.leveled ? ' Leveled up to Lv ' + result.buddy.level + '.' : ''}`,
    );
    pulseTrainerEmote('ready', 1400);
    activateAudioEngine().emitSfx('steroid', 1);
    pushLog(`Used Steroid on ${activeBuddy.nickname}.`);
  }

  function beginEncounter() {
    if (activeZone.type === 'home') {
      setMessage('Leave Home Gym to scout a wild buddy.');
      return;
    }
    if (workoutSession && !workoutSession.resolved) {
      setMessage('Finish the current training set before scouting.');
      return;
    }
    if (encounter || match) {
      setMessage('Finish the active battle before scouting again.');
      return;
    }
    if (!activeBuddy) {
      setMessage('Pick an active buddy before scouting.');
      return;
    }
    const next = createOpponent(activeZone);
    setEncounter(next);
    setMatch(null);
    activateAudioEngine().emitSfx('catchAlmost', 0.7);
    setSave((state) => ({
      ...state,
      seenDex: state.seenDex.includes(next.creature.dex)
        ? state.seenDex
        : [...state.seenDex, next.creature.dex],
    }));
    setMessage(`${zoneNames[next.zoneId]}: wild ${next.creature.name} Lv.${next.level} appeared.`);
    pushLog(`Spawned ${next.creature.name} Lv.${next.level} (${zoneNames[next.zoneId]}).`);
    pulseTrainerEmote('neutral', 300);
  }

  function startMatch() {
    if (!encounter || !activeBuddy) return;
    if (match) return;

    setMatch({
      encounter,
      status: 'playing',
      round: 1,
      maxRounds: 4,
      meter: 50,
      lines: [
        'You and the wild buddy hit the mat, shoulders tight, and go flat on your stomachs.',
        'The hold starts at a neutral meter. Push to your side to pin.',
      ],
    });
    pulseTrainerEmote('focus', 1200);
    setMessage('Arm-wrestle match started.');
    activateAudioEngine().emitSfx('matchStart', 1);
    updateMusic();
  }

  function resolveMatch(meter: number, playerWonLine: string[]) {
    if (!match) return;

    const base = match.encounter.catchChance;
    const bonus = clamp((meter - 50) / 150, -0.25, 0.22);
    const finalChance = clamp(base + bonus, 0.08, 0.97);
    const passHold = meter >= 72;

    const lines = [...playerWonLine];

    if (!passHold) {
      const escape = meter <= 24;
      setMatch((current) =>
        current
          ? {
              ...current,
              status: escape ? 'escape' : 'failed',
              lines: [...lines, escape ? 'It slips out at the end.' : 'You are close, but not enough.'],
              meter,
            }
          : current,
      );
      setMessage(escape ? 'The wild buddy breaks loose.' : 'You missed the pin.');
      activateAudioEngine().emitSfx(escape ? 'escape' : 'moveBad', escape ? 1 : 0.9);
      pulseTrainerEmote(escape ? 'drained' : 'grind', escape ? 1300 : 1100);
      setEncounter(escape ? null : encounter);
      return;
    }

    const roll = Math.random();
    if (roll > finalChance) {
      setMatch((current) =>
        current
          ? {
              ...current,
              status: 'failed',
              meter,
              lines: [...lines, 'You almost had it, but its final twitch breaks the pin.'],
            }
          : current,
      );
      setMessage('The hold was almost won, but catch failed.');
      activateAudioEngine().emitSfx('catchAlmost', 1);
      pulseTrainerEmote('drained', 1200);
      return;
    }

    const newBuddy: Buddy = {
      id: `${encounter!.creature.dex}-${Date.now()}`,
      nickname: `${randomChoice(FANCY_NAMES)} #${encounter!.creature.dex}`,
      creature: encounter!.creature,
      level: encounter!.level,
      hp: 32 + encounter!.level * 2,
      maxHp: 42 + encounter!.level * 2,
      xp: 0,
    };

    if (save.team.length >= TEAM_SIZE) {
      setMatch((current) =>
        current
          ? {
              ...current,
              status: 'full',
              meter,
              lines: [...lines, 'You win the pin, but your team is already full.'],
            }
          : current,
      );
      setMessage('Captured, but team is full.');
      activateAudioEngine().emitSfx('teamFull', 0.9);
      return;
    }

    setSave((state) => ({
      ...state,
      team: [...state.team, newBuddy],
      caughtDex: state.caughtDex.includes(encounter!.creature.dex)
        ? state.caughtDex
        : [...state.caughtDex, encounter!.creature.dex],
      activeIndex: state.activeIndex >= state.team.length ? state.team.length - 1 : state.activeIndex,
    }));

    setMatch((current) =>
      current
        ? {
            ...current,
            status: 'won',
            meter,
            lines: [
              ...lines,
              'You flatten your bodies, elbows locked, and drag the pressure down.',
              `YOU WIN THE ARMWRESTLE. ${encounter!.creature.name} cries like a baby and joins your squad.`,
            ],
          }
        : current,
    );
    setEncounter(null);
    activateAudioEngine().emitSfx('catchWin', 1.1);
    pulseTrainerEmote('victory', 1600);
    setMessage(`Captured ${encounter!.creature.name} as ${newBuddy.nickname}.`);
    pushLog(`Captured ${encounter!.creature.name} Lv.${encounter!.level}.`);
  }

  function performMove(move: Move) {
    if (!match || !match.encounter || match.status !== 'playing' || !activeBuddy) {
      return;
    }

    const playerBase = activeBuddy.level * 2 + move.power + move.control + randInt(-5, 9);
    const bossBonus = match.encounter.bossPowerBonus ?? 0;
    const wildBase = match.encounter.level * 2 + match.encounter.creature.power + bossBonus + randInt(-4, 12);
    const delta = playerBase - wildBase;
    const nextMeter = clamp(match.meter + Math.floor(delta / 2), 20, 92);
    const round = match.round + 1;

    const line =
      delta >= 8
        ? `${move.title}: you crush the first edge and pull control.`
        : delta >= 0
          ? `${move.title}: pressure stays balanced; keep it up.`
          : `${move.title}: wild buddy resisted and pushed back.`;

    const nextLines = [...match.lines, `${line} (${move.tactic}).`, `Round ${match.round}: meter ${nextMeter}%.`];
    if (nextMeter >= 84) {
      nextLines.push('It is almost yours. One clean burst and the pin lands.');
    }
    if (nextMeter <= 28) {
      nextLines.push('Danger: hold is fading. Keep it moving.');
    }
    activateAudioEngine().emitSfx(delta >= 0 ? 'moveGood' : 'moveBad', 0.5 + (Math.abs(delta) / 20));

    if (nextMeter >= 76) {
      pulseTrainerEmote('level', 900);
    } else if (nextMeter <= 34) {
      pulseTrainerEmote('focus', 800);
    } else {
      pulseTrainerEmote('grind', 700);
    }

    if (match.round >= match.maxRounds || nextMeter >= 92 || nextMeter <= 20) {
      resolveMatch(nextMeter, nextLines);
      return;
    }

    setMatch((current) =>
      current
        ? {
            ...current,
            round,
            meter: nextMeter,
            lines: nextLines,
          }
        : current,
    );
    setMessage('Round complete. Push once more.');
  }

  function hpPercent(value: number, max: number) {
    return Math.round((value / max) * 100);
  }

  return (
    <div className="app-shell">
      {zoneTransit && (
        <div className="zone-transition">
          <div className="zone-transition-card">
            <div className="zone-transition-row">
              <span>{zoneTransit.icon}</span>
              <span>{zoneTransit.from}</span>
              <span>→</span>
              <span>{zoneTransit.to}</span>
            </div>
            <p className="small-note">Fresh gym air, new layout, and a different pressure profile load in.</p>
          </div>
        </div>
      )}
      {tutorialActive && (
        <div className="tutorial-overlay">
          <div className="tutorial-card">
            <div className="panel-head-row">
              <h2>Tutorial</h2>
              <button className="secondary-btn" onClick={() => setShowRoadmap((open) => !open)}>
                {showRoadmap ? 'Hide plan' : 'Roadmap'}
              </button>
            </div>
            <p className="small-note">Step {Math.min(save.tutorialStep + 1, TUTORIAL_STEPS.length)} of {TUTORIAL_STEPS.length}</p>
            <p>{currentTutorialText}</p>
            <p className="small-note">You can still play, but finishing tutorial gives full control tips.</p>
            <div className="action-row">
              <button className="primary-btn" onClick={nextTutorialStep}>
                {save.tutorialStep >= TUTORIAL_STEPS.length - 1 ? 'Finish Tutorial' : 'Next'}
              </button>
              <button className="secondary-btn" onClick={finishTutorialNow}>
                Skip
              </button>
            </div>
            {showRoadmap && (
              <div className="roadmap">
                <h3>Feature cadence plan</h3>
                <small>Phase 1 (now): Controls, machine depth, beginner combat.</small>
                <small>Phase 2 (+2h): Boss prep items, gym challenges, rewards.</small>
                <small>Phase 3 (+4h): Late-game forms, rare trainer events.</small>
                <small>Phase 4 (+6h): Full gym-boss meta and balancing pass.</small>
              </div>
            )}
          </div>
        </div>
      )}
      <header className="top-banner">
        <h1>GYM BUDDIES</h1>
        <p>Pixel RPG clone with 6 gyms, creature captures, and gym-themed progression.</p>
        <div className="panel-head-row">
          <span className="chip">Trainer: {trainer.name}</span>
          <button className="secondary-btn" onClick={resetTutorial}>
            Restart Tutorial
          </button>
        </div>
        <div className="audio-controls">
          <button
            className="secondary-btn micro-btn"
            onClick={() => setAudioEnabled(!save.audio.enabled)}
            aria-pressed={save.audio.enabled}
          >
            {save.audio.enabled ? '🎧 Music: On' : '🎧 Music: Off'}
          </button>
          <label className="audio-control">
            <span>Music {Math.round(save.audio.musicVolume * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={save.audio.musicVolume}
              onChange={(event) => setMusicVolume(Number(event.target.value))}
            />
          </label>
          <label className="audio-control">
            <span>SFX {Math.round(save.audio.sfxVolume * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={save.audio.sfxVolume}
              onChange={(event) => setSfxVolume(Number(event.target.value))}
            />
          </label>
        </div>
      </header>

      <main className="game-grid">
        <section className="panel">
          <div className="panel-head-row">
            <h2>Gym Map</h2>
            <span className="chip">Party {save.team.length}/{TEAM_SIZE}</span>
          </div>
          <div className="zone-hero">
            <div>
              <div className="zone-hero-title">
                {zoneVibe.icon} {activeZone.name}
              </div>
              <p className="small-note">
                {zoneVibe.mood} · {zoneVibe.theme}
              </p>
            </div>
            <span className="chip">Zone Accent: {zoneVibe.accent}</span>
          </div>
          <p className="small-note">Current: {activeZone.name}</p>
          <p className="small-note">Boss in this gym: {bossTicker} until spawn · active interval 5-10 min</p>
          <div className="gym-grid">
            {AREAS.map((area) => (
              <button
                key={area.id}
                className={`gym-btn ${area.type} ${save.activeZoneId === area.id ? 'active' : ''}`}
                onClick={() => switchArea(area.id)}
              >
                <strong>{area.name}</strong>
                <span>{area.type.toUpperCase()} · {ZONE_VIBES[area.id]?.accent ?? area.type}</span>
                <small>Boss timer: {getGymBossTicker(area)}</small>
              </button>
            ))}
          </div>

          <div className="panel-head-row">
            <h3>Trainer Customization</h3>
            <button
              className="secondary-btn micro-btn"
              onClick={() => setShowTrainerPanel((open) => !open)}
            >
              {showTrainerPanel ? 'Hide' : 'Open'}
            </button>
          </div>
          <p className="small-note">Name: {trainer.name} · click Open for color edits.</p>

          {showTrainerPanel && (
            <div className="trainer-panel">
              <div className="trainer-panel-left">
                <TrainerSprite trainer={trainer} emote={activeEmote} />
                <div className="trainer-fields">
                  <label>
                    Name:
                    <input value={trainer.name} onChange={setTrainerName} maxLength={14} />
                  </label>
                  <div className="trainer-muscle-summary">
                    Physique Lvl {String(trainerPhysique).padStart(2, '0')}
                  </div>
                </div>
              </div>
              <div className="trainer-presets">
                {TRAINER_PRESETS.map((profile) => (
                  <button
                    key={profile.name}
                    className={`trainer-preset ${trainer.name === profile.name ? 'active' : ''}`}
                    onClick={() => setTrainerPreset(profile)}
                  >
                    {profile.name}
                  </button>
                ))}
              </div>
              <div className="trainer-sliders">
                <div className="muscle-sliders">
                  {TRAINER_MUSCLES.map((entry) => (
                    <label className="muscle-slider" key={entry.key}>
                      <span>{entry.label}</span>
                      <div className="muscle-slider-row">
                        <input
                          type="range"
                          min="0"
                          max={MAX_MUSCLE_LEVEL}
                          value={trainer.muscles[entry.key]}
                          onChange={(event) => setTrainerMuscle(entry.key, Number(event.target.value))}
                        />
                        <span>{trainer.muscles[entry.key]}</span>
                      </div>
                      <small>{entry.detail}</small>
                    </label>
                  ))}
                </div>
                <div className="trainer-row">
                  <span>Hair</span>
                  <input
                    type="color"
                    value={trainer.hair}
                    onChange={(event) => setTrainerColor('hair', event.target.value)}
                  />
                  <span>Skin</span>
                  <input
                    type="color"
                    value={trainer.skin}
                    onChange={(event) => setTrainerColor('skin', event.target.value)}
                  />
                </div>
                <div className="trainer-row">
                  <span>Top</span>
                  <input
                    type="color"
                    value={trainer.top}
                    onChange={(event) => setTrainerColor('top', event.target.value)}
                  />
                  <span>Gloves</span>
                  <input
                    type="color"
                    value={trainer.glove}
                    onChange={(event) => setTrainerColor('glove', event.target.value)}
                  />
                </div>
                <div className="trainer-row">
                  <span>Shoes</span>
                  <input
                    type="color"
                    value={trainer.shoes}
                    onChange={(event) => setTrainerColor('shoes', event.target.value)}
                  />
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          )}

          <h3>Machines</h3>
          <p className="small-note">Selected machine boosts efficiency and fatigue tradeoff.</p>
          <div className="machine-grid">
            {activeZone.machines.map((machine) => (
              <button
                key={machine.id}
                className={`machine-btn ${activeMachine?.id === machine.id ? 'active' : ''}`}
                onClick={() => selectMachine(machine.id)}
              >
                <strong>{machine.name}</strong>
                <small>{machine.detail}</small>
                <small>
                  XP {machine.xpMin}-{machine.xpMax} | x{machine.xpMultiplier.toFixed(2)} · Steroid +
                  {Math.round(machine.steroidChance * 100)}%
                  {' | '}
                  Focus: {machine.focus} · Stamina {machine.fatigueCost > 0 ? `-${machine.fatigueCost}` : '+0'}
                  {machine.hpRestore ? ` · Recovery +${machine.hpRestore}` : ''}
                </small>
              </button>
            ))}
          </div>

          <div className="team-area">
            <h3>Team Slots (up to 6)</h3>
            <div className="team-slots">
              {Array.from({ length: TEAM_SIZE }).map((_, i) => {
                const buddy = save.team[i];
                const active = save.activeIndex === i;
                return (
                  <button
                    key={`slot-${i}`}
                    className={`team-slot ${active ? 'active' : ''}`}
                    disabled={!buddy}
                    onClick={() => selectBuddy(i)}
                  >
                    <strong>{`#${String(i + 1).padStart(2, '0')}`}</strong>
                    {buddy ? (
                      <>
                        <span>{buddy.nickname}</span>
                        <small>{buddy.creature.name}</small>
                        <em>
                          Lv {buddy.level} | HP {buddy.hp}/{buddy.maxHp} ({hpPercent(buddy.hp, buddy.maxHp)}%)
                        </em>
                      </>
                    ) : (
                      <span className="empty">EMPTY</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {activeBuddy ? (
            <>
              <h3>Active Buddy</h3>
              <div className="active-card">
                <div
                  className={
                    `workout-rig ${
                      workoutSession?.phase === 'running'
                        ? 'workout-rig-running'
                        : workoutSession?.phase === 'spot'
                          ? 'workout-rig-spot'
                          : workoutSession?.phase === 'resolved'
                            ? 'workout-rig-resolved'
                            : ''
                    }`
                  }
                >
                  <PixelCreature creature={activeBuddy.creature} />
                </div>
                <div className="active-copy">
                  <strong>{activeBuddy.nickname}</strong>
                  <p>{activeBuddy.creature.flavor}</p>
                  <div>Lv {activeBuddy.level}</div>
                  <div>
                    HP {activeBuddy.hp}/{activeBuddy.maxHp}
                  </div>
                  <div>XP {activeBuddy.xp}/{xpNeeded(activeBuddy.level)}</div>
                </div>
              </div>
              {workoutSession && (
                <div className="workout-console">
                  <div className="workout-progress-row">
                    <span className="small-note">
                      {workoutSession.phase === 'running'
                        ? 'Training rep in progress'
                        : workoutSession.phase === 'spot'
                          ? 'Rep slip detected: Spot the set'
                          : workoutSession.willFail
                            ? 'Spot attempt resolved'
                            : workoutSession.phase === 'resolved'
                              ? (activeBuddy
                                ? `${activeBuddy.nickname} stabilized`
                                : 'Set stabilized')
                              : 'Set complete'}
                    </span>
                    <span className="small-note">
                      Fail {percent(workoutSession.failChance)} · Spot bonus {percent(workoutSession.spotChanceBase)}
                    </span>
                  </div>

                  <div className="workout-meter">
                    <div
                      className={`workout-meter-fill ${workoutSession.phase === 'spot' ? 'workout-meter-fill-danger' : ''}`}
                      style={{ width: `${workoutProgress}%` }}
                    />
                    <div className="workout-meter-cursor" />
                  </div>

                  {workoutSession.phase === 'running' && (
                    <>
                      <small className="small-note">
                        Hold steady: {Math.max(0, Math.ceil((workoutSession.startedAt + WORKOUT_DURATION_MS - workoutFrame) / 1000))}s
                      </small>
                      {workoutSession.willFail && (
                        <small className="small-note warning">Risk window opens soon — form is weakening.</small>
                      )}
                    </>
                  )}

                  {workoutSession.phase === 'spot' && (
                    <div className="workout-spot-wrap">
                      <div className="workout-spot-meter">
                        <div
                          className="workout-spot-meter-window"
                          style={{
                            left: `${Math.max(0, Math.min(100, (workoutSpotRemainingMs / workoutSession.spotWindowMs) * 100))}%`,
                          }}
                        />
                        <div
                          className="workout-spot-meter-pin"
                          style={{ left: `${Math.max(0, Math.min(100, ((workoutSession.spotWindowMs - workoutSpotRemainingMs) / workoutSession.spotWindowMs) * 100))}%` }}
                        />
                      </div>
                      <div className="workout-spot-action">
                        <button
                          className="secondary-btn trainer-spot-btn"
                          onClick={spotWorkout}
                          disabled={!canSpot}
                        >
                          {canSpot ? 'Rush + Spot Now' : 'Too Late'}
                        </button>
                          <small className="small-note">
                          Window left: {Math.max(0, Math.ceil(workoutSpotRemainingMs / 100) / 10)}s — Spot success {percent(
                            workoutSpotSuccessChance(workoutSpotRemainingMs, workoutSession.spotChanceBase, workoutSession.zoneType),
                          )}
                        </small>
                        <small className="small-note warning">
                          Need to click while phase is active. Miss window → +fatigue + HP drop.
                        </small>
                      </div>
                      <div className="trainer-spot-callout">
                        <div className="trainer-spot-sprite" aria-hidden="true">
                          <span>🏋️</span>
                        </div>
                        <p>Trainer is sprinting to spot.</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="action-row">
                <button
                  className="primary-btn"
                  onClick={sendToWorkout}
                  disabled={
                    !activeBuddy ||
                    !!encounter ||
                    !!match ||
                    !!workoutSession ||
                    !activeMachine
                  }
                >
                  Train (+XP)
                </button>
                <button
                  className="primary-btn"
                  onClick={useSteroid}
                  disabled={!activeBuddy || save.steroids <= 0}
                >
                  Use Steroid (x{save.steroids})
                </button>
              </div>
            </>
          ) : (
            <p className="small-note">No active buddy selected.</p>
          )}

          <div className="xp-track">
            <div className="xp-fill" style={{ width: `${(save.team.length / TEAM_SIZE) * 100}%` }} />
          </div>

          <button className="primary-btn" onClick={beginEncounter} disabled={activeZone.type === 'home'}>
            Scout Wild Buddy
          </button>
        </section>

        <section className="panel">
          <h2>Capture Arena</h2>
          {!encounter ? (
            <p className="small-note">No encounter active. Move to a gym and press Scout or wait for a boss timer.</p>
          ) : (
            <>
              <div className="combat-stage">
                <div className="combat-row">
                  <div className="combat-figure">
                    {activeBuddy ? <PixelCreature creature={activeBuddy.creature} /> : <span>None</span>}
                    <span>You</span>
                  </div>
                  <div className="combat-vs">VS</div>
                  <div className="combat-figure">
                    <PixelCreature creature={encounter.creature} />
                    <span>{encounter.creature.name}</span>
                  </div>
                </div>

                <div className="encounter-data">
                  <div>Location: {zoneNames[encounter.zoneId]}</div>
                  <div>
                    Lv {encounter.level} · {encounter.isBoss ? 'Boss' : 'Wild'}{' '}
                    {encounter.bossName ? `(${encounter.bossName})` : ''} · Catch Chance {percent(encounter.catchChance)}
                    {encounter.creature.isExotic ? ' (Exotic)' : ''}
                  </div>
                </div>
              </div>

              {!match ? (
                <button className="primary-btn" onClick={startMatch}>
                  Go flat and arm wrestle
                </button>
              ) : (
                <>
                  <div className="meter-track">
                    <div className="meter-fill" style={{ width: `${match.meter}%` }} />
                    <div className="meter-center" />
                    <div className="meter-pin" />
                  </div>
                  <div className="small-note">Round {match.round}/{match.maxRounds}</div>

                  {match.status === 'playing' && (
                    <div className="action-grid">
                      {MOVES.map((move) => (
                        <button key={move.id} className="primary-btn" onClick={() => performMove(move)}>
                          <span>{move.title}</span>
                          <small>{move.tactic}</small>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="narration">
                    {match.lines.map((line, index) => (
                      <p key={`${match.round}-${index}`}>{line}</p>
                    ))}
                  </div>

                  {match.status !== 'playing' && (
                    <div className="result-block">
                      {match.status === 'won' && <p className="crying">Creature is crying like a baby.</p>}
                      <p>
                        {match.status === 'won'
                          ? 'Capture complete.'
                          : match.status === 'full'
                            ? 'Team full.'
                            : match.status === 'escape'
                              ? 'Escaped.'
                              : 'Not caught.'}
                      </p>
                      <button
                        className="secondary-btn"
                        onClick={() => {
                          setMatch(null);
                          setEncounter(null);
                          setMessage('Arena reset. Scout again when ready.');
                        }}
                      >
                        Continue
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>

        <section className="panel">
          <h2>Gym Buddy Index</h2>
          <div className="dex-list">
            {CREATURES.map((creature) => {
              const seen = seenDex.includes(creature.dex);
              const caught = caughtDex.includes(creature.dex);
              return (
                <div key={creature.dex} className={`dex-item ${seen ? 'seen' : ''}`}>
                  <span className="dex-num">#{String(creature.dex).padStart(3, '0')}</span>
                  <div>
                    {seen ? creature.name : 'Unknown'}
                    <small>{caught ? 'Caught' : seen ? 'Seen' : 'Hidden'}</small>
                    <small>{creature.isExotic ? ' / Exotic' : ''}</small>
                  </div>
                </div>
              );
            })}
          </div>

          <h3>Log</h3>
          <ul className="log-list">
            {log.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="status-bar">
        <strong>Broadcast:</strong> {message}
      </footer>
    </div>
  );
}

