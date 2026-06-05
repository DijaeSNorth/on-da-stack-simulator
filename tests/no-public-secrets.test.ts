/**
 * Public secret regression check.
 *
 * Run with: npx tsx tests/no-public-secrets.test.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['client', 'server', 'shared', 'script', 'tests', 'dist-ghpages'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vite']);
const GOOGLE_API_KEY_PATTERN = /AIza[0-9A-Za-z_-]{35}/g;

const findings: string[] = [];

function scanFile(path: string): void {
  const rel = relative(ROOT, path).replace(/\\/g, '/');
  const text = readFileSync(path, 'utf8');
  const matches = text.match(GOOGLE_API_KEY_PATTERN) ?? [];
  if (matches.length > 0) findings.push(`${rel}: ${matches.length} Google API key-shaped string(s)`);
}

function scanDir(path: string): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
      continue;
    }

    if (!entry.isFile()) continue;
    if (statSync(fullPath).size > 2_000_000) continue;
    scanFile(fullPath);
  }
}

for (const dir of SCAN_DIRS) {
  const fullPath = join(ROOT, dir);
  try {
    if (statSync(fullPath).isDirectory()) scanDir(fullPath);
  } catch {
    // Optional generated folders may not exist before a build.
  }
}

if (findings.length > 0) {
  console.error('FAIL public secret scan found committed/built key patterns:');
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log('PASS public secret scan found no Google API key-shaped strings');
