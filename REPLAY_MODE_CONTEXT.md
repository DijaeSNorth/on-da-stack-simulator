# Replay Mode Context (On Da Stack Simulator)

Last captured: 2026-06-13T00:00:00-04:00 (America/New_York)

## Git snapshot
- Repository: `https://github.com/DijaeSNorth/on-da-stack-simulator.git`
- Branch: `replay-mode` (checked out)
- Remote: `origin`
- Commit: `cc5a29e`
- Branch lineage (latest local commits):
  - `cc5a29e` (HEAD -> replay-mode, origin/main, origin/HEAD, main) Merge UI guardrail updates
  - `fb2f827` Add scalable UI controls and guardrails
  - `d68fc72` fix: scope firebase room reads
  - `7ea8cf1` feat: secure firebase recovery access
  - `c3faedc` Harden game logic mechanics and type queries
- Working tree: only untracked `REPLAY_MODE_CONTEXT.md`, no staged changes

## Workspace / platform details
- CWD: `C:\Users\jaysl\Documents\Codex\On Da Stack`
- Writable root: `C:\Users\jaysl\Documents\Codex\On Da Stack`
- Node runtime: `v24.16.0`
- npm runtime: `11.13.0` (use `npm.cmd` on this machine because `npm.ps1` is blocked by execution policy)
- Repository shape: single package at repo root; no nested `client/package.json`

## Package scripts (root `package.json`)
- `npm run dev` → `NODE_ENV=development tsx server/index.ts`
- `npm run build` → `tsx script/build.ts`
- `npm start` → `NODE_ENV=production node dist/index.cjs`
- `npm run check` → `tsc`

## Test environment
- No `test` script in `package.json`.
- `tests/**/*.test.ts` files exist but are excluded from `tsc` via tsconfig.
- `tsconfig.json` `exclude`: `**/*.test.ts` (so `npm run check` does not type-check tests)
- Tests are executed ad hoc through `tsx` against files, e.g.:
  - `npx tsx tests/store-flow.test.ts`
  - `npx tsx tests/action-log-ui.test.ts`
  - `npx tsx tests/replay-engine.test.ts`
- There is no detected Jest/Vitest/Cypress/Playwright config in root scan.
- `npm run check` is the main compile gate; if full test coverage is needed we currently rely on direct `npx tsx` per test file.

## Replay Mode spec to keep in-scope
- New architecture target:
  - `ReplayFile` + `ReplaySession`
  - `ReplayPlayerSummary`
  - timeline markers and action-log timeline scrubbing
- Add new file: `client/src/types/replay.ts`
- Engine (`client/src/engine/replayEngine.ts`) requirements:
  - `validateReplayFile`
  - `createReplaySession`
  - `applyReplayToIndex`
  - `stepReplayForward`
  - `stepReplayBackward`
  - `jumpReplayToAction`
  - `jumpReplayToTurn`
  - `getReplayTimelineMarkers`
- Store (`client/src/store/gameStore.ts`) requirements:
  - `ui.screen` must include replay
  - `replay?: ReplaySession`
  - Replay controls for load/start/exit/play/pause/step/jump/speed
- Behavioral constraints:
  - Replay mode is read-only (no game actions)
  - No multiplayer/Firebase writes in replay mode
  - Export/privacy flow with redaction:
    - `includePrivateZones`
    - `includeFinalSnapshot`
    - `redacted` (default behavior for public share)
    - redact hands/libraries/sideboards/maybeboard/private choice data for public exports
- UI tasks:
  - lobby mode option for Replay
  - replay loader + controls + timeline + info panel
  - scrubber and marker rendering from action log
- Files already reviewed for this area:
  - `client/src/types/game.ts`
  - `client/src/store/gameStore.ts`
  - `client/src/engine/gameEngine.ts`
  - `client/src/engine/replayEngine.ts`
  - `client/src/components/lobby/LobbyScreen.tsx`
  - `client/src/components/battlefield/CommanderTable.tsx`
  - `client/src/components/replay/ReplayPanel.tsx`
  - `client/src/components/TopBar.tsx`
  - `client/src/components/command/CommandInput.tsx`
  - `client/src/components/panels/actionLogUiModel.ts`
  - `tests/store-flow.test.ts`
  - `tests/action-log-ui.test.ts`
  - `tests/replay-engine.test.ts`

## quick recovery commands
- `git status --short --branch`
- `git rev-parse --abbrev-ref HEAD`
- `git rev-parse --short HEAD`
- `git log --oneline -n 8 --decorate`
- `git remote -v`
- `npm run check`
- `npx tsx tests/store-flow.test.ts`
- `npx tsx tests/action-log-ui.test.ts`
- `npx tsx tests/replay-engine.test.ts`
