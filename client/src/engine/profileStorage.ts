/**
 * profileStorage.ts
 *
 * Persistent player profiles — stored in localStorage.
 * Each profile holds display settings (name, color, avatar) and
 * per-card art overrides (card name → chosen Scryfall print URL).
 *
 * Extension points:
 *   - FUTURE: sync profiles to an account-backed cloud store for cross-device
 *   - FUTURE: import/export profile JSON
 */

import type { ManaColor, PlayerAvatarImage } from '../types/game';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArtOverride {
  /** Canonical card name (oracle name) */
  cardName: string;
  /** Scryfall print image URL (normal size) */
  imageUrl: string;
  /** Human label for the print, e.g. "Strixhaven Mystical Archive" */
  printLabel: string;
  /** Scryfall set code, e.g. "sta" */
  setCode: string;
  /** Collector number, e.g. "1" */
  collectorNumber: string;
}

export interface PlayerProfileCard {
  name: string;
  manaCost: string;
  typeLine: string;
  colors: ManaColor[];
  artUrl: string;
  artSource: 'custom' | 'scryfall';
  scryfallName: string;
  bio: string;
  triggers: string[];
  flavorText: string;
  stats: string;
}

export interface PlayerProfileStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  currentStreak: number;
}

export interface FeaturedDeckProfile {
  deckId: string;
  powerLevel?: string;
  wins?: number;
  losses?: number;
}

export interface RecentMatchProfile {
  id: string;
  commanderUsed: string;
  placement: string;
  date: string;
  result: string;
}

export interface PlayerProfile {
  id: string;
  /** Display name shown in lobbies and the battlefield */
  displayName: string;
  title: string;
  bannerUrl: string;
  /** Seat/zone border color — hex string */
  color: string;
  /** Single character or emoji shown as avatar */
  avatarInitial: string;
  /** Background style for avatar bubble */
  avatarStyle: 'solid' | 'gradient' | 'outline';
  /** Optional small profile image, either compressed upload data or Scryfall art crop URL */
  avatarImage?: PlayerAvatarImage;
  card: PlayerProfileCard;
  stats: PlayerProfileStats;
  featuredDecks: FeaturedDeckProfile[];
  achievements: string[];
  recentMatches: RecentMatchProfile[];
  /** Per-card art preferences — keyed by oracle card name */
  artOverrides: Record<string, ArtOverride>;
  /** Judge/assistant preferences */
  assistantMode: 'ON' | 'LIMITED' | 'OFF';
  assistantVerbosity: 'minimal' | 'normal' | 'verbose';
  showTriggerReminders: boolean;
  /** ISO timestamp */
  createdAt: number;
  updatedAt: number;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────

const PROFILES_KEY = 'mtg-profiles-v1';
const ACTIVE_PROFILE_KEY = 'mtg-active-profile-v1';

export const PROFILE_LIMITS = {
  displayName: 32,
  title: 40,
  cardName: 32,
  manaCost: 20,
  typeLine: 36,
  bio: 120,
  trigger: 90,
  maxTriggers: 3,
  flavorText: 100,
  stats: 5,
  featuredDecks: 3,
  recentMatches: 5,
};

export const ACHIEVEMENT_OPTIONS = [
  'First Victory',
  'Commander Slayer',
  'Token Master',
  'Spell Slinger',
  'Five Color Veteran',
  'Deck Builder',
  'Comeback Win',
];

function limit(value: unknown, max: number): string {
  return String(value ?? '').slice(0, max);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeStats(stats: Partial<PlayerProfileStats> | undefined): PlayerProfileStats {
  return {
    gamesPlayed: numberValue(stats?.gamesPlayed),
    wins: numberValue(stats?.wins),
    losses: numberValue(stats?.losses),
    currentStreak: numberValue(stats?.currentStreak),
  };
}

function normalizeCard(profile: Partial<PlayerProfile>): PlayerProfileCard {
  const card = (profile.card ?? {}) as Partial<PlayerProfileCard>;
  return {
    name: limit(card.name || profile.displayName || 'Player', PROFILE_LIMITS.cardName),
    manaCost: limit(card.manaCost || '{2}{U}', PROFILE_LIMITS.manaCost),
    typeLine: limit(card.typeLine || 'Legendary Player', PROFILE_LIMITS.typeLine),
    colors: Array.isArray(card.colors) ? card.colors.slice(0, 5) : [],
    artUrl: limit(card.artUrl || profile.avatarImage?.url || '', 2048),
    artSource: card.artSource === 'scryfall' ? 'scryfall' : 'custom',
    scryfallName: limit(card.scryfallName || '', 120),
    bio: limit(card.bio || 'Known for creative deckbuilding and unconventional strategies.', PROFILE_LIMITS.bio),
    triggers: (Array.isArray(card.triggers) ? card.triggers : [])
      .map(trigger => limit(trigger, PROFILE_LIMITS.trigger))
      .filter(Boolean)
      .slice(0, PROFILE_LIMITS.maxTriggers),
    flavorText: limit(card.flavorText || 'The deck is never finished.', PROFILE_LIMITS.flavorText),
    stats: limit(card.stats || '3/3', PROFILE_LIMITS.stats),
  };
}

export function normalizeProfile(profile: Partial<PlayerProfile>): PlayerProfile {
  const now = Date.now();
  const card = normalizeCard(profile);
  return {
    id: profile.id || crypto.randomUUID(),
    displayName: limit(profile.displayName || 'Player', PROFILE_LIMITS.displayName),
    title: limit(profile.title || 'Legendary Player', PROFILE_LIMITS.title),
    bannerUrl: limit(profile.bannerUrl || '', 2048),
    color: profile.color || '#3b82f6',
    avatarInitial: limit(profile.avatarInitial || '?', 4) || '?',
    avatarStyle: profile.avatarStyle ?? 'solid',
    avatarImage: profile.avatarImage,
    card,
    stats: normalizeStats(profile.stats),
    featuredDecks: (Array.isArray(profile.featuredDecks) ? profile.featuredDecks : [])
      .filter(item => item?.deckId)
      .slice(0, PROFILE_LIMITS.featuredDecks)
      .map(item => ({
        deckId: String(item.deckId),
        powerLevel: item.powerLevel ? limit(item.powerLevel, 8) : undefined,
        wins: item.wins === undefined ? undefined : numberValue(item.wins),
        losses: item.losses === undefined ? undefined : numberValue(item.losses),
      })),
    achievements: (Array.isArray(profile.achievements) ? profile.achievements : [])
      .map(item => limit(item, 40))
      .filter(Boolean)
      .slice(0, ACHIEVEMENT_OPTIONS.length),
    recentMatches: (Array.isArray(profile.recentMatches) ? profile.recentMatches : [])
      .slice(0, PROFILE_LIMITS.recentMatches)
      .map(match => ({
        id: match.id || crypto.randomUUID(),
        commanderUsed: limit(match.commanderUsed, 48),
        placement: limit(match.placement, 16),
        date: limit(match.date, 24),
        result: limit(match.result, 24),
      })),
    artOverrides: profile.artOverrides ?? {},
    assistantMode: profile.assistantMode ?? 'ON',
    assistantVerbosity: profile.assistantVerbosity ?? 'normal',
    showTriggerReminders: profile.showTriggerReminders ?? true,
    createdAt: profile.createdAt ?? now,
    updatedAt: profile.updatedAt ?? now,
  };
}

export function loadProfiles(): PlayerProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlayerProfile[];
    return parsed.map(profile => normalizeProfile(profile));
  } catch {
    return [];
  }
}

export function saveProfile(profile: PlayerProfile): void {
  try {
    const all = loadProfiles();
    const idx = all.findIndex(p => p.id === profile.id);
    const updated: PlayerProfile = normalizeProfile({ ...profile, updatedAt: Date.now() });
    if (idx >= 0) {
      all[idx] = updated;
    } else {
      all.unshift(updated);
    }
    localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
  } catch {
    // localStorage full — silently skip
  }
}

export function deleteProfile(id: string): void {
  const all = loadProfiles().filter(p => p.id !== id);
  localStorage.setItem(PROFILES_KEY, JSON.stringify(all));
  if (getActiveProfileId() === id) clearActiveProfile();
}

export function getActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_KEY);
}

export function setActiveProfileId(id: string): void {
  localStorage.setItem(ACTIVE_PROFILE_KEY, id);
}

export function clearActiveProfile(): void {
  localStorage.removeItem(ACTIVE_PROFILE_KEY);
}

export function getActiveProfile(): PlayerProfile | null {
  const id = getActiveProfileId();
  if (!id) return null;
  return loadProfiles().find(p => p.id === id) ?? null;
}

// ─── Art override helpers ─────────────────────────────────────────────────────

/** Get the art override URL for a card name, or null if none set */
export function getArtOverride(profile: PlayerProfile | null, cardName: string): ArtOverride | null {
  if (!profile) return null;
  return profile.artOverrides[cardName] ?? null;
}

export function setArtOverride(profile: PlayerProfile, override: ArtOverride): PlayerProfile {
  return {
    ...profile,
    artOverrides: { ...profile.artOverrides, [override.cardName]: override },
    updatedAt: Date.now(),
  };
}

export function removeArtOverride(profile: PlayerProfile, cardName: string): PlayerProfile {
  const { [cardName]: _removed, ...rest } = profile.artOverrides;
  return { ...profile, artOverrides: rest, updatedAt: Date.now() };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createProfile(partial?: Partial<PlayerProfile>): PlayerProfile {
  const now = Date.now();
  return normalizeProfile({
    id: crypto.randomUUID(),
    displayName: 'Player',
    title: 'Legendary Player',
    bannerUrl: '',
    color: '#3b82f6',
    avatarInitial: '?',
    avatarStyle: 'solid',
    avatarImage: undefined,
    artOverrides: {},
    assistantMode: 'ON',
    assistantVerbosity: 'normal',
    showTriggerReminders: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  });
}

// ─── Scryfall print fetcher ───────────────────────────────────────────────────
// Returns all available prints for a card name — used by ArtPickerPanel.

export interface ScryfallPrint {
  id: string;
  name: string;
  set: string;
  setName: string;
  collectorNumber: string;
  imageUrl: string;
  artCropUrl: string;
  releaseDate: string;
  finishes: string[];  // 'nonfoil' | 'foil' | 'etched'
  frameEffects?: string[];
  borderColor: string;
  isPromo: boolean;
  isDigital: boolean;
}

const SCRYFALL_BASE = 'https://api.scryfall.com';

/** Fetch all prints of a card by oracle name, sorted by release date desc */
export async function fetchCardPrints(cardName: string): Promise<ScryfallPrint[]> {
  try {
    const url = `${SCRYFALL_BASE}/cards/search?q=!"${encodeURIComponent(cardName)}"&unique=prints&order=released&dir=desc`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.data) return [];

    return (data.data as any[])
      .filter(c => !c.digital || c.set === 'mb1') // skip most digital-only
      .map(c => ({
        id: c.id,
        name: c.name,
        set: c.set,
        setName: c.set_name,
        collectorNumber: c.collector_number,
        imageUrl: c.image_uris?.normal ?? c.card_faces?.[0]?.image_uris?.normal ?? '',
        artCropUrl: c.image_uris?.art_crop ?? c.card_faces?.[0]?.image_uris?.art_crop ?? '',
        releaseDate: c.released_at,
        finishes: c.finishes ?? ['nonfoil'],
        frameEffects: c.frame_effects ?? [],
        borderColor: c.border_color ?? 'black',
        isPromo: c.promo ?? false,
        isDigital: c.digital ?? false,
      }))
      .filter(c => c.imageUrl); // must have an image
  } catch {
    return [];
  }
}
