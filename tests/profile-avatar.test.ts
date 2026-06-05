/**
 * Profile avatar regression checks.
 *
 * Run with: npx tsx tests/profile-avatar.test.ts
 */

import {
  ACHIEVEMENT_OPTIONS,
  PROFILE_LIMITS,
  createProfile,
  loadProfiles,
  saveProfile,
} from '../client/src/engine/profileStorage';
import { createDefaultGameConfig, createPlayer } from '../client/src/engine/gameEngine';

const storage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

test('profile stores compressed upload avatar metadata', () => {
  storage.clear();
  const profile = createProfile({
    displayName: 'Avatar Tester',
    avatarImage: {
      source: 'upload',
      url: 'data:image/webp;base64,abcd',
      byteSize: 4,
      label: 'Uploaded image (1 KB)',
    },
  });

  saveProfile(profile);
  const loaded = loadProfiles()[0];

  assert(loaded.avatarImage?.source === 'upload', 'expected uploaded avatar source');
  assert(loaded.avatarImage?.byteSize === 4, 'expected uploaded avatar byte size to survive storage');
});

test('profile stores card art avatar by URL only', () => {
  storage.clear();
  const profile = createProfile({
    displayName: 'Card Art Fan',
    avatarImage: {
      source: 'card',
      url: 'https://cards.scryfall.io/art_crop/front/test.jpg',
      label: 'Sol Ring - Commander Masters',
    },
  });

  saveProfile(profile);
  const loaded = loadProfiles()[0];

  assert(loaded.avatarImage?.source === 'card', 'expected card art avatar source');
  assert(loaded.avatarImage?.url.includes('scryfall.io'), 'expected card art URL to survive storage');
  assert(loaded.avatarImage?.byteSize === undefined, 'card art avatars should not store image bytes');
});

test('profile card fields are normalized for clean Commander card display', () => {
  storage.clear();
  const profile = createProfile({
    displayName: 'A very long player display name that should be trimmed',
    title: 'A very long player title that should be clipped for the layout',
    card: {
      name: 'A very long commander profile card name',
      manaCost: '{W}{U}{B}{R}{G}{10}{X}',
      typeLine: 'Legendary Player - Very Wordy Deck Architect',
      colors: ['W', 'U', 'B', 'R', 'G'],
      artUrl: 'https://cards.scryfall.io/art_crop/front/test.jpg',
      artSource: 'scryfall',
      scryfallName: 'Sol Ring',
      bio: 'x'.repeat(200),
      triggers: ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100), 'd'.repeat(100)],
      flavorText: 'f'.repeat(120),
      stats: '10/10!',
    },
    featuredDecks: [
      { deckId: 'one' },
      { deckId: 'two' },
      { deckId: 'three' },
      { deckId: 'four' },
    ],
    achievements: [...ACHIEVEMENT_OPTIONS, 'Extra Badge'],
  });

  saveProfile(profile);
  const loaded = loadProfiles()[0];

  assert(loaded.displayName.length === PROFILE_LIMITS.displayName, 'expected display name limit');
  assert(loaded.title.length === PROFILE_LIMITS.title, 'expected title limit');
  assert(loaded.card.name.length === PROFILE_LIMITS.cardName, 'expected card name limit');
  assert(loaded.card.triggers.length === PROFILE_LIMITS.maxTriggers, 'expected trigger count cap');
  assert(loaded.card.triggers.every(trigger => trigger.length === PROFILE_LIMITS.trigger), 'expected trigger text limit');
  assert(loaded.featuredDecks.length === PROFILE_LIMITS.featuredDecks, 'expected featured deck cap');
  assert(loaded.achievements.length === ACHIEVEMENT_OPTIONS.length, 'expected achievement list cap');
  assert(loaded.card.artSource === 'scryfall', 'expected Scryfall card art metadata to survive');
});

test('legacy profiles migrate into the lightweight Commander profile shape', () => {
  storage.clear();
  storage.set('mtg-profiles-v1', JSON.stringify([{
    id: 'legacy-profile',
    displayName: 'Legacy Player',
    color: '#3b82f6',
    avatarInitial: 'LP',
    avatarStyle: 'solid',
    artOverrides: {},
    assistantMode: 'ON',
    assistantVerbosity: 'normal',
    showTriggerReminders: true,
    createdAt: 1,
    updatedAt: 1,
  }]));

  const loaded = loadProfiles()[0];
  assert(loaded.title === 'Legendary Player', 'expected default title on legacy profile');
  assert(loaded.card.name === 'Legacy Player', 'expected card name to derive from legacy display name');
  assert(loaded.card.typeLine === 'Legendary Player', 'expected default card type line');
  assert(loaded.stats.gamesPlayed === 0, 'expected default quick stats');
});

test('createPlayer accepts optional avatar identity', () => {
  const config = createDefaultGameConfig(2);
  const player = createPlayer('p1', 'Picture Player', 0, '#22d3ee', config, {
    initial: 'PP',
    style: 'gradient',
    image: {
      source: 'card',
      url: 'https://cards.scryfall.io/art_crop/front/test.jpg',
      label: 'Test Card',
    },
  });

  assert(player.avatarInitial === 'PP', 'expected avatar initial on player');
  assert(player.avatarStyle === 'gradient', 'expected avatar style on player');
  assert(player.avatarImage?.source === 'card', 'expected avatar image on player');
});
