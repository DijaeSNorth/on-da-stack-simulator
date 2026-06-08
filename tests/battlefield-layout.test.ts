/**
 * Battlefield seating layout regression checks.
 *
 * Run with: npx tsx tests/battlefield-layout.test.ts
 */

import { getPlayerLayout } from '../client/src/components/battlefield/CommanderTable';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function same(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

const twoPlayer = getPlayerLayout(2);
assert(same(twoPlayer.top, [1]), 'expected two-player opponent across the table');
assert(same(twoPlayer.bottom, [0]), 'expected local player on the bottom for two-player games');
assert(!twoPlayer.left && !twoPlayer.right, 'expected no side mats for two-player games');

const threePlayer = getPlayerLayout(3);
assert(same(threePlayer.top, [1, 2]), 'expected three-player game to form a triangle with two top mats');
assert(same(threePlayer.bottom, [0]), 'expected local player to be the bottom point of the triangle');
assert(!threePlayer.left && !threePlayer.right, 'expected no side mats for three-player triangle layout');

const fourPlayer = getPlayerLayout(4);
assert(same(fourPlayer.top, [2, 3]), 'expected four-player table to use two top mats');
assert(same(fourPlayer.bottom, [0, 1]), 'expected four-player table to use two bottom mats');
assert(!fourPlayer.left && !fourPlayer.right, 'expected four-player table to render as a rectangle, not side lanes');

console.log('PASS battlefield seating layouts match 2/3/4-player table shapes');
