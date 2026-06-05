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
 *   - FUTURE: profile picture upload (base64 DataURL)
 */

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

export interface PlayerProfile {
  id: string;
  /** Display name shown in lobbies and the battlefield */
  displayName: string;
  /** Seat/zone border color — hex string */
  color: string;
  /** Single character or emoji shown as avatar */
  avatarInitial: string;
  /** Background style for avatar bubble */
  avatarStyle: 'solid' | 'gradient' | 'outline';
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

export function loadProfiles(): PlayerProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PlayerProfile[];
  } catch {
    return [];
  }
}

export function saveProfile(profile: PlayerProfile): void {
  try {
    const all = loadProfiles();
    const idx = all.findIndex(p => p.id === profile.id);
    const updated: PlayerProfile = { ...profile, updatedAt: Date.now() };
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
  return {
    id: crypto.randomUUID(),
    displayName: 'Player',
    color: '#3b82f6',
    avatarInitial: '?',
    avatarStyle: 'solid',
    artOverrides: {},
    assistantMode: 'ON',
    assistantVerbosity: 'normal',
    showTriggerReminders: true,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
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
