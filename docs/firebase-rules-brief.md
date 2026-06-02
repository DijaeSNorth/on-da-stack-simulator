# Firebase Realtime Database — Security Rules Brief

**File:** `database.rules.json`  
**Project:** `on-da-stack-simulator`  
**Replaces:** open test-mode rules (`".read": true, ".write": true` at root)

---

## Why these rules exist

Open test-mode rules allow any anonymous user on the internet to read and
write any data in the database. The production rules narrow each permission
to the exact operation the legitimate caller needs — and nothing more.

All write rules require `auth != null`, which means Firebase Authentication
must have issued a valid session token before any write can succeed. See the
**Integration Note** at the bottom for how to wire in `signInAnonymously()`.

---

## Rule blocks

### Block 1 — Room-level read

```json
"$roomCode": { ".read": true }
```

Anyone who knows the 6-character room code can read that room's full snapshot
(game state, peer presence, metadata). Room codes act as shared secrets, so
this is intentional. Scoped to a single room path — no cross-room reads are
possible.

**Who this covers:** host, seated players, spectators.

---

### Block 2 — Room creation (authenticated host only)

```json
".write": "auth != null && !data.exists() && newData.child('hostId').val() === auth.uid"
```

Three conditions must all be true simultaneously:

| Condition | Purpose |
|---|---|
| `auth != null` | Caller must be authenticated |
| `!data.exists()` | Room must not already exist — prevents overwrite |
| `newData.child('hostId').val() === auth.uid` | Written `hostId` must equal caller's UID |

This means only the person creating the room can be its host, and a room
cannot be silently overwritten once created.

---

### Block 3 — Game state broadcast (host only)

```json
"game": {
  ".write": "auth != null && root.child('rooms/' + $roomCode + '/hostId').val() === auth.uid"
}
```

Only the room host may call `broadcastState()`. The rule cross-references the
stored `hostId` at the room root against the caller's UID. Without this, a
rogue joiner could overwrite the authoritative game state for everyone at
the table.

---

### Block 4 — Peer presence read

```json
"players/$peerId": { ".read": true }
```

Inherited from Block 1, but stated explicitly at the peer level so individual
nodes can be overridden later (e.g. hiding spectator identities from seated
players in a future update).

---

### Block 5 — Own presence write

```json
"players/$peerId": {
  ".write": "auth != null && auth.uid === $peerId"
}
```

The `$peerId` path wildcard must exactly match the caller's Firebase Auth UID.
Each player (or spectator) can update only their own presence record — name,
color, seatIndex, isSpectator, online flag. Nobody can write to another
player's record.

---

### Block 6 — Online flag protection

```json
"players/$peerId/online": {
  ".write": "auth != null && auth.uid === $peerId"
}
```

Reinforces that not even the host can flip another player's connection status.
Firebase `onDisconnect()` handlers run in the disconnecting client's own auth
context, so graceful disconnect (setting `online` to `false`) still works
without any special host permissions.

---

### Block 7 — hostId is immutable

```json
"hostId": {
  ".write": "auth != null && !data.exists() && newData.val() === auth.uid"
}
```

`hostId` can only be written once — during room creation — and only to the
creator's own UID. After that, `data.exists()` is `true` and no write can
ever succeed on this node. This closes the host-takeover attack surface: even
an authenticated bad actor who knows the room code cannot promote themselves
to host.

---

### Block 8 — createdAt is write-once

```json
"createdAt": { ".write": "!data.exists()" }
```

The creation timestamp is set once on room creation and cannot be changed
afterward. No explicit auth check is needed here because Block 2's room-level
write already validates auth before any child node is first written.

---

## Spectator access model

Spectators get **read access** via Block 1 and **own-presence write** via
Block 5. They cannot write to `game` (Block 3), cannot touch other players'
presence (Block 5), and cannot modify room metadata (Blocks 7–8). This
mirrors the client-side enforcement: spectators have no `localPlayerId`, the
command bar is hidden, and the hand viewer is read-only.

---

## Integration Note — Firebase Anonymous Auth

These rules require `auth != null` on all writes. The current
`multiplayerSync.ts` does not yet call `signInAnonymously()`. Before
activating these rules, add the following to `multiplayerSync.ts`:

```ts
import { getAuth, signInAnonymously } from 'firebase/auth';

async function ensureAuth(): Promise<void> {
  const auth = getAuth(_app!);
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
}
```

Call `await ensureAuth()` at the top of both `createRoom()` and `joinRoom()`
before any database writes. The anonymous UID persists across page reloads via
localStorage, so players keep the same identity for the duration of their
session.

**Until `signInAnonymously()` is wired in, keep the database in test mode.**
Switching to these rules before auth is integrated will silently block all
room creation and presence writes.

---

## How to deploy these rules

**Firebase Console:**
1. Go to **Build → Realtime Database → Rules**
2. Replace the existing JSON with the contents of `database.rules.json`
3. Click **Publish**

**Firebase CLI:**
```bash
npm install -g firebase-tools
firebase login
firebase use on-da-stack-simulator
firebase deploy --only database
```
