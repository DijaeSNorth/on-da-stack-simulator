# Multiplayer Upgrade Dumps

Use this file as a compact handoff ledger so we can continue multiplayer debugging without depending on chat history.

## 2026-06-13 -- Multiplayer branch start-vote visibility pass

- Branch workflow established:
  - Created and pushed `multiplayer` from the verified multiplayer head.
  - Future multiplayer commits should land on `multiplayer`, then merge to `main` after tests pass.
- UI improvement:
  - `client/src/components/multiplayer/MultiplayerPanel.tsx` now shows a visible start-vote status block during the host/joiner start handshake.
  - The block shows received votes, missing player names, and fallback countdown so the table can see who still needs to vote before auto-start fallback.
- Verification before merge:
  - Run targeted multiplayer/store/command tests before committing this pass.

## 2026-06-12 -- Multiplayer context checkpoint

- Added: Deck health visibility into lobby deck import flow.
  - File: `client/src/components/lobby/DeckHealthPanel.tsx` (new)
  - File: `client/src/components/lobby/LobbyScreen.tsx` (updated)  
    - Renders `DeckHealthPanel` when import results are visible.
- Noted active in-progress UI upgrades already present in workspace:
  - `client/src/components/battlefield/CommanderTable.tsx` (updated)
  - `client/src/components/battlefield/TableStatusDock.tsx` (new)
- Rationale:
  - Improve multiplayer onboarding quality checks before start.
  - Keep lobby flow clear about deck validity signals before start gating.

### Open items for next pass

- Verify multiplayer-specific debug surface in lobby/game matches expectation after deck health integration.
- Decide if deck health checks should influence any additional lobby/start heuristics or telemetry.
- Run targeted multiplayer tests as requested in next action.
- Record test results and failures in this same section before coding further.

### Context maintenance rule (recommended)

- Add one dated entry at the start of each multiplayer debug pass.
- Keep each entry to 5-10 bullets max to avoid noise.
- Only include user-impacting / protocol-impacting changes in this file.

## 2026-06-12 -- Verification + push run

- Ran targeted regression pass before pushing:
  - `npx tsx tests/multiplayer-protocol.test.ts`
  - `npx tsx tests/multiplayer-sync.test.ts`
  - `npx tsx tests/store-flow.test.ts`
- Results:
  - multiplayer-protocol: pass
  - multiplayer-sync: pass
  - store-flow: pass (32 passed, 0 failed)
- Environment note:
  - Installed deps with `npm install --cache .\tmp-npm-cache` due local PowerShell `ExecutionPolicy` blocking `npx/npm` and cache cleanup permission issues.
  - Current session status:
  - Multiplayer handoff logging and deck-health UI changes are now documented and ready to hand off after push.

## 2026-06-12 -- Explicit joiner start-vote workflow

- Added a staged start flow so the host still triggers game initialization, but each non-host player must explicitly vote to start during the `START_GAME_PREPARE` window.
  - File: `client/src/store/gameStore.ts`
    - `handleMultiplayerStartPrepare` now sets joiners to a pre-start prepare state without auto-acking.
    - New action `voteToStartMultiplayerGame` sends `START_GAME_ACK` when a joiner clicks vote.
  - File: `client/src/components/multiplayer/MultiplayerPanel.tsx`
    - Added a joiner-only "Vote to Start" control and vote progress status.
- Existing ready checks remain in place (`load/validate deck`, `local ready`, host readiness gates), so start requires both deck readiness and explicit vote.
- Added a regression test for manual start-vote requirement.
  - File: `tests/store-flow.test.ts` (replaced auto-ack start prepare expectation with vote flow)
- Planned follow-up:
  - Add a small timeout/alert UI cue if no player votes before host fallback commit triggers.

## 2026-06-12 (verification #2)
- Re-ran tests: multiplayer-protocol, multiplayer-sync, store-flow all passed.
- Commit/push blocked in this workspace: .git/index.lock permission denied and Git push cannot obtain credentials (SEC_E_NO_CREDENTIALS).
- Files in scope: LobbyScreen.tsx, DeckHealthPanel.tsx, CommanderTable.tsx, TableStatusDock.tsx, MULTIPLAYER_UPGRADE_DUMPS.md.


## 2026-06-12 (verification #3 / finalization pass)
- Re-ran multiplayer tests after latest push: all 3 suites passed (multiplayer-protocol, multiplayer-sync, store-flow).
- Finalized remote URL normalization to: https://github.com/DijaeSNorth/on-da-stack-simulator.git.
- GitHub Pages workflow is present and deploys on main push (.github/workflows/deploy.yml).

## 2026-06-12 -- Joiner identity collision hardening
- Fix applied in `upsertPresenceFromPeer`: duplicate presence replacement now uses both `playerId` and `sessionId`, and it no longer replaces host presence from a different session.
- Why: prevents the non-host joiner from being treated as host or replacing host presence in same-browser/same-profile workflows.
- Additional follow-up: add a regression for same-session identity collision in multiplayer tests after this pass.


## 2026-06-13 -- Non-host lobby join + vote-to-start pass (finalized)
- Switched host start readiness from hard player-ready blocking to a staged start handshake:
  - client/src/engine/multiplayerProtocol.ts (canHostStartFromLobby) now accepts equirePlayerReady and defaults true.
  - client/src/engine/lobbyReadiness.ts (canStartCommanderTable) now accepts equirePlayerReadiness and can bypass playerReady checks when needed.
- Applied to the flow that is now used for room start:
  - client/src/components/lobby/LobbyScreen.tsx calls start-readiness with equirePlayerReadiness: false.
  - client/src/store/gameStore.ts uses the same relaxed host start eligibility and adds oteToStartMultiplayerGame.
  - Non-hosts are moved to explicit vote behavior during START_GAME_PREPARE instead of auto-acking as ready.
- Updated joiner UI:
  - client/src/components/multiplayer/MultiplayerPanel.tsx now reserves ready controls for host and exposes joiner-side Vote to Start with remaining-vote status, so non-hosts load deck/identity first and then vote.
- Verification before push:
  - cmd /c npx tsx tests/multiplayer-protocol.test.ts`r
  - cmd /c npx tsx tests/multiplayer-sync.test.ts`r
  - cmd /c npx tsx tests/store-flow.test.ts`r
  - cmd /c npx tsx tests/command-rules.test.ts`r
  - Result: all passing (store-flow 32 passed).
