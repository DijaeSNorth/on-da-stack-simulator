# Multiplayer Firebase Upgrade Notes (2026-06-13)

- Added Firebase relay hardening in `client/src/engine/multiplayerSync.ts`:
  - Request timeout (`FIREBASE_FETCH_TIMEOUT_MS`) and retry with exponential backoff in `firebaseRequest`.
  - Poll loop switched from fixed interval to adaptive polling in `startFirebasePolling`/`pollFirebaseRoom`.
  - Added internal relay health tracking (`_firebaseErrorStreak`, `_firebaseLastPollError`, `_firebaseLastPollAt`, `_firebaseLastSnapshotAt`).
  - Exported `getTransportMode()` and `getFirebaseRelayHealth()` for UI diagnostics.
- Added relay diagnostics in `client/src/components/multiplayer/MultiplayerPanel.tsx` room header so users can see transport mode and relay health.
- Expanded optional Firebase guidance in `README.md` to reflect retry/backoff and health-aware behavior.
- Added `.env.example` with Firebase fallback flags.

## Operational reminders
- Keep Firebase room access restricted by rules (or protected by Auth/App Check in production).
- Use long codes (`F...`) for relay rooms and avoid exposing secrets in `VITE_*` variables.
- If relay starts showing repeated poll errors, verify:
  - `VITE_ENABLE_FIREBASE_FALLBACK=true`
  - Firebase Realtime Database URL is reachable and CORS/hosting allows browser access.
  - Realtime Database security rules do not block `/onDaStackRooms/*` writes/reads.