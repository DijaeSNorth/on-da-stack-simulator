# On-Da-Stack - MTG Commander Simulator

A browser-based Magic: The Gathering Commander simulator built for desktop browsers and iPad landscape. It is a player-controlled tabletop sandbox with judge assistance, multiplayer sync, replay tooling, Solo Deck Lab testing, and rules/mechanic helpers.

**[Play Live](https://dijaesnorth.github.io/on-da-stack-simulator/)**

---

## What This Is

On-Da-Stack is a digital MTG tabletop, not an Arena-style rules-enforced game. Players control the table directly. The app tracks zones, actions, combat, triggers, and reminders, while the assistant flags issues and explains interactions like a judge watching the game.

The simulator favors transparency and manual correction. Unsupported or ambiguous card logic should show hints, logs, prompts, or judge/manual tools instead of blocking the table.

---

## Current Architecture

- **React + Vite**: frontend-only app hosted on GitHub Pages.
- **Zustand**: local game, UI, replay, multiplayer, and solo-mode state.
- **PeerJS / WebRTC**: primary multiplayer transport for room-code play.
- **Firebase Anonymous Auth + Realtime Database**: secure recovery/control-plane fallback, not the primary transport.
- **Scryfall API**: card data, oracle text, imagery, rulings, and legality.
- **Local browser storage**: user-managed saved decks, settings, replay metadata, and solo report history.
- **Rules metadata layer**: set/mechanic metadata, safe Firebase metadata merge, UI hints, and code-owned engine handlers.
- **Replay engine**: action-log replay import/export, timeline, checkpoints, and optional replay-only animations.
- **Solo Deck Lab**: deck building, test hands, goldfish, sandbox, dummy opponents, reports, and export tools.

---

## Core Features

| Feature | Status |
|---|---|
| 2-6 player Commander table layout | Implemented |
| Full zone system: library, hand, battlefield, graveyard, exile, command, stack | Implemented |
| Phase / turn cycle with priority passing | Implemented |
| Scryfall card art and oracle text | Implemented |
| Deck import: Moxfield, Archidekt, MTGO, CSV, text sections | Implemented |
| Commander validation and Solo Deck Builder | Implemented |
| Judge assistant flags and manual correction tools | Implemented |
| Stack visualization and trigger queue | Implemented |
| Token clouds and large token stack attack assignment | Implemented |
| Combat model with player/planeswalker/battle targets | Implemented |
| Sneak, token stack attacks, and combat damage preview | Implemented |
| First strike, double strike, trample, and deathtouch damage preview | Implemented |
| Power/toughness overrides and counter helpers | Implemented |
| Natural language command helpers | Implemented |
| PeerJS multiplayer sync | Implemented |
| Firebase recovery fallback with scoped rules | Implemented |
| Replay import/export, timeline, checkpoints, and animations | Implemented |
| Solo Deck Lab, dummy practice, and performance reports | Implemented |

---

## User-Managed Data

Saved decks, local replay metadata, solo report history, imported/exported files, and browser-side settings are user-managed data.

Important guardrails:

- Local decks, replays, reports, and settings are stored in browser storage unless explicitly exported.
- Browser storage can be cleared by the browser, user, device cleanup tools, private browsing mode, or site-data resets.
- Users are responsible for exporting and backing up anything they want to keep.
- Do not treat localStorage, replay history, or solo report history as cloud backup, account sync, or permanent storage.
- Exported files are user-controlled; they should not include Firebase tokens, service credentials, multiplayer room control data, or private room snapshots unless the user intentionally exports a private replay.

---

## Solo Deck Lab

Solo Mode opens the Deck Lab instead of behaving like a multiplayer table. It is intended for deck building, testing, goldfishing, and manual practice.

Deck Lab tabs:

- **Builder**: edit Commander decklists, mark commanders, adjust quantities, search, group, validate, and track unsaved changes.
- **Test Hand**: shuffle, draw opening hands, London mulligan, bottom cards, keep hands, and start a test game from a kept hand.
- **Goldfish**: start a one-player test game, draw, advance phases/turns, reset quickly, and export replay data.
- **Stats**: view deck totals, card-type counts, mana curve, average mana value, color distribution, and placeholder strategic categories.
- **Sandbox**: solo-only manual tools for draw/search/reveal, tokens, counters, power/toughness overrides, life totals, zone moves, turn/phase control, notes, and triggers.
- **Dummy**: add scripted practice opponents for combat testing.
- **Reports**: save, filter, compare, export, import, and delete Solo Performance Reports.
- **Export**: export/copy decklists as text or JSON and manage saved local decks.

### Dummy Opponent Practice

Dummy opponents are deterministic solo practice opponents, not full AI. Supported profiles include Training, Blocker, Aggro, Value, and Combo Clock.

Dummy Deck Mode Lite can optionally give a dummy a generated simple deck. Generated dummy decks can draw, play a land, cast a simple creature or placeholder spell, attack with eligible creatures, and auto-block with simple logic. This stays solo-only and does not change multiplayer behavior.

### Solo Performance Reports

Solo Performance Reports summarize goldfish or dummy-practice sessions using the action log and current game state. Reports include rough metrics for:

- opening hand composition
- mana development and missed land drops
- first permanent/creature timing
- spells and tokens
- combat damage dealt/taken
- card flow
- dummy pressure
- rough suggestions and warnings

Report history is stored in this browser. Export anything you want to keep or back up.

---

## Replay Mode

Replay Mode uses the action log as the source for review and playback.

Current replay capabilities:

- Import replay JSON files.
- Export public or private replay files.
- Public exports redact private zones such as hands and libraries while preserving counts.
- Private exports can include private zones for user-controlled backup/review.
- Timeline scrubbing by action log entry.
- Replay checkpoints for faster jumps in long games.
- Replay timeline markers for turns, combat, damage, checkpoints, and warnings.
- Optional replay-only animations for draw, cast, zone movement, token attacks, and mechanic events.
- Replay mode disables normal gameplay mutation while reviewing a replay.

Do not assume exported public replays are full game-state backups. Use private exports only when you intentionally want private-zone data included.

---

## Multiplayer and Firebase Recovery

PeerJS/WebRTC is the primary multiplayer transport. Firebase is a secure recovery/control-plane fallback for cases where a room needs recovery, resync, presence/control metadata, or a fallback path around direct peer issues.

Firebase is not intended to be the main game engine, account storage, permanent deck storage, or cloud replay backup.

### Firebase Data Model Guardrails

- `/rooms/{roomCode}/game` must remain public/sanitized game state only.
- Private card data must not be written to public room game state.
- Private data belongs under private snapshots or owner-scoped paths protected by rules.
- Public/private recovery snapshots are split so public recovery can resume table state without exposing hidden zones.
- Anonymous Auth is required so owner-scoped recovery paths can be protected.
- Do not deploy broad public read/write database rules.
- Do not put service account keys, database secrets, private auth tokens, or admin credentials in frontend code or `VITE_*` variables.

### Required Firebase Environment Variables

Set these values for builds that enable Firebase recovery:

```bash
VITE_ENABLE_FIREBASE_FALLBACK=true
VITE_FIREBASE_API_KEY=your-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=your-firebase-web-app-id
```

`VITE_FIREBASE_RTDB_URL` is also supported as an alternate database URL key, but `VITE_FIREBASE_DATABASE_URL` is the preferred Firebase web config name.

### Firebase Setup and Deployment

1. Create or select a Firebase project.
2. Add a web app and copy the public web config values into the `VITE_FIREBASE_*` environment variables.
3. Enable **Anonymous** provider in Firebase Authentication.
4. Create a Realtime Database instance.
5. Deploy the scoped Realtime Database rules from `database.rules.json`.
6. Set the same `VITE_FIREBASE_*` variables in GitHub Actions or the GitHub Pages build environment.
7. Build and deploy the frontend.

Typical rules deployment:

```bash
firebase deploy --only database
```

GitHub Actions must have the public Firebase web config values available at build time. Do not add service account JSON, admin SDK credentials, database secrets, or privileged tokens to frontend environment variables.

---

## Rules Metadata and Mechanic Automation

The app has a rules-extension layer for mechanic metadata, UI hints, and safe engine handler lookup.

Current supported or semi-automated areas include:

- Clue activation
- Exhaust tracking
- Firebending combat mana tracking
- Airbend and Warp exile-cast permissions
- Waterbend cost helper
- Earthbend land animation
- Sneak combat action support
- Station and Spacecraft support
- Class level tracking
- Vivid, Blight, counter cleanup, Changeling, Kindred, and robust type queries
- Power/toughness overrides
- Damage preview for common combat keywords

Firebase may store rules metadata, UI hints, handler IDs, set codes, and automation levels. Firebase must not store executable JavaScript. App code owns actual engine handlers, and unknown handler IDs must not execute.

---

## Deck Import Formats

Paste any of these directly into the deck importer:

- Moxfield / Archidekt public URLs
- Moxfield / Archidekt export using standard `1x Card Name` format
- MTGGoldfish / TappedOut text exports
- MTGO deck export
- CSV using `Name,Count` or `Count,Name`
- Section headers: `Commander`, `Deck`, `Sideboard`, `Maybeboard`

Card data is fetched from the [Scryfall API](https://scryfall.com/docs/api). No Scryfall account is required.

---

## Local Development

```bash
npm install
npm run dev
# http://localhost:5000
```

### Type Check

```bash
npm run check
```

### Build for GitHub Pages

```bash
npx vite build --config vite.ghpages.config.ts
# Output: dist-ghpages/
```

---

## Contributing

Issues and PRs are welcome. This is an open sandbox. If you find a rules interaction that is handled incorrectly, open an issue with the card names, board state, and expected behavior.

---

## Credits

Card data and imagery from [Scryfall](https://scryfall.com). This project is not affiliated with Wizards of the Coast.
