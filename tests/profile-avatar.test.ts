/**
 * Profile avatar regression checks.
 *
 * Run with: npx tsx tests/profile-avatar.test.ts
 */

import { createProfile, loadProfiles, saveProfile } from '../client/src/engine/profileStorage';
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
