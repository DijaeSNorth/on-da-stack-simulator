# Report System Context

Last captured: 2026-06-16 (America/New_York)

## Git Snapshot

- Repository: `https://github.com/DijaeSNorth/on-da-stack-simulator.git`
- Active branch: `codex/report-system-updates`
- Base branch pulled before branch creation: `main`
- HEAD commit: `ddc49e9` (`Update README architecture docs`)
- Working tree at capture time: clean before this context note

## Runtime And Commands

- Node: `v24.16.0`
- npm: `11.13.0`
- Use `npm.cmd` / `npx.cmd` in PowerShell.
- `package.json` has no `test` script.
- Baseline TypeScript check: `npm.cmd run check`
- Individual tests run directly with `npx.cmd tsx tests/<file>.test.ts`
- `tsconfig.json` excludes `**/*.test.ts`, so test files are not covered by `npm.cmd run check`.

## Report-System Surfaces

Primary Solo report files:

- `client/src/engine/soloPerformanceEngine.ts`
- `client/src/engine/soloReportStorage.ts`
- `client/src/components/solo/SoloPerformancePanel.tsx`
- `client/src/components/solo/SoloReportHistoryPanel.tsx`
- `client/src/components/solo/SoloDeckLab.tsx`
- `client/src/components/solo/soloUiModel.ts`
- `client/src/types/game.ts`

Related report/export surfaces:

- `client/src/engine/replayFileUtils.ts`
- `client/src/components/replay/ReplayExportModal.tsx`
- `client/src/components/replay/ReplayImportDropzone.tsx`
- `client/src/engine/issueReport.ts`
- `client/src/components/panels/RightPanel.tsx`

Focused report tests:

- `npx.cmd tsx tests/solo-performance.test.ts`
- `npx.cmd tsx tests/solo-report-history.test.ts`
- `npx.cmd tsx tests/solo-mode.test.ts`
- `npx.cmd tsx tests/goldfish-flow.test.ts`
- `npx.cmd tsx tests/dummy-opponent.test.ts`
- `npx.cmd tsx tests/dummy-deck-mode.test.ts`
- `npx.cmd tsx tests/replay-import-export.test.ts`
- `npx.cmd tsx tests/issue-report.test.ts`
- `npx.cmd tsx tests/no-public-secrets.test.ts`

Broader safety checks to run when report changes touch shared game state, replay exports, privacy, or multiplayer-adjacent data:

- `npx.cmd tsx tests/store-flow.test.ts`
- `npx.cmd tsx tests/multiplayer-sync.test.ts`
- `npx.cmd tsx tests/firebase-recovery.test.ts`
- `npx.cmd tsx tests/action-log-ui.test.ts`
- `npx.cmd tsx tests/replay-mode.test.ts`
- `npx.cmd tsx tests/replay-engine.test.ts`

## Existing Report Behavior

- Solo Performance Reports summarize goldfish or dummy-practice sessions from the action log and game state.
- Saved report history is local browser storage, capped, importable/exportable, filterable, comparable, and user-managed.
- Saved report history should store report summaries and metadata only. Do not serialize room metadata, Firebase data, card zones, full game state, or replay payloads into report history.
- Report UI must keep the user-managed data warning visible: local decks, replays, reports, and settings are not cloud backup or account sync.
- Public replay exports must redact private zones and hidden card names from public labels where possible.
- Issue reporting is separate from Solo Performance Reports and builds a GitHub issue URL from sanitized game/judge context.

## Guardrails Pulled From Other Threads

- Do not change multiplayer start delivery unless the active task explicitly requires it.
- Do not change Firebase recovery, RTDB rules, private snapshot ownership, or `/rooms/{roomCode}/game` privacy guardrails unless the active task explicitly requires it.
- Do not expose private hand/library/deck data through public exports, report history, logs, or issue reports.
- Do not overpromise persistence. Browser storage can be cleared by the user/browser.
- Keep report changes isolated from live game behavior where possible.
- If report changes depend on replay/action-log data, preserve original action indices and privacy/redaction behavior.
- Keep tool output bounded; avoid full state dumps, generated output folders, huge logs, screenshots, videos, traces, and large lockfile reads unless required.
