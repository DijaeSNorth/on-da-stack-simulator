# On-Da-Stack — MTG Commander Simulator

A browser-based Magic: The Gathering Commander simulator built for desktop browsers and iPad landscape. Designed to feel like a real Commander table with judge assistance, sandbox testing, and replay functionality.

**[▶ Play Live](https://dijaesnorth.github.io/on-da-stack-simulator/)**

---

## What This Is

A digital MTG tabletop — not a game in the Arena/Hearthstone sense. Players control everything freely. The assistant observes, flags issues, and explains interactions like an experienced judge at the table. Nothing is blocked. Everything is logged.

### Core Features

| Feature | Status |
|---|---|
| 2–6 player Commander table layout | ✅ |
| Full zone system (library, hand, battlefield, graveyard, exile, command, stack) | ✅ |
| Phase / turn cycle with priority passing | ✅ |
| Scryfall card art & oracle text (live API) | ✅ |
| Deck import — Moxfield, Archidekt, MTGO, CSV | ✅ |
| Judge assistant — Legal / Flagged / Needs Review | ✅ |
| Stack visualization | ✅ |
| Trigger queue | ✅ |
| Token clouds (grouped identical tokens) | ✅ |
| Combat system | ✅ |
| Graveyard / exile drawers (searchable) | ✅ |
| LocalStorage deck persistence | ✅ |
| Action log (source of truth for undo/replay) | ✅ |
| Drag-to-attack / drag-to-block | ✅ |
| Natural language commands | ✅ |
| Peer-to-peer multiplayer sync | ✅ |
| Replay system | ✅ |

---

## Rule Hierarchy

```
1. Match Custom Rules
2. Format Rules (Commander)
3. Official MTG Comprehensive Rules
4. Oracle Card Logic
5. Active Rule Modifiers
6. Player Custom Logic
7. Temporary Effects
```

Official rules are always the default. House rules layer on top without replacing them.

---

## Deck Import Formats

Paste any of these directly into the deck importer:

- **Moxfield / Archidekt public URLs**
- **Moxfield / Archidekt export** (standard `1x Card Name` format)
- **MTGGoldfish / TappedOut text exports**
- **MTGO deck export**
- **CSV** (`Name,Count` or `Count,Name`)
- **Section headers**: `Commander`, `Deck`, `Sideboard`, `Maybeboard`

Card data is fetched from the [Scryfall API](https://scryfall.com/docs/api) — no account required.

---

## Tech Stack

- **React + Vite** — frontend only (no backend required)
- **Zustand** — game state management
- **PeerJS / WebRTC** — room-code multiplayer, with direct browser-to-browser game state sync
- **Scryfall API** — card data, oracle text, rulings, legality
- **LocalStorage** — deck and settings persistence
- **GitHub Pages** — hosting

---

## Local Development

```bash
npm install
npm run dev
# → http://localhost:5000
```

### Build for GitHub Pages

```bash
npx vite build --config vite.ghpages.config.ts
# Output: dist-ghpages/
```

---

## Roadmap

### Next: Interactions
- [ ] Drag-to-attack / drag-to-block with arrow visualization
- [ ] Natural language command parser (`"Cast Counterspell targeting Lightning Bolt"`)
- [ ] Drag attachment (equip / enchant)

### Multiplayer
- [x] PeerJS room-code multiplayer
- [x] Lobby with shareable room codes
- [ ] Hidden information (hand visibility layers)

### Replay & Analysis
- [ ] Save / load full game replays from action log
- [ ] Step-forward / step-backward through game history
- [ ] Export replay as shareable JSON

### Advanced Rules
- [ ] Myriad — copied attackers, multi-lane combat, end-of-combat exile
- [ ] Split second, cascade, storm count
- [ ] Replacement effect chain visualization

---

## Contributing

Issues and PRs welcome. This is an open sandbox — if you find a rules interaction that's handled incorrectly, open an issue with the card names and scenario.

---

## Credits

Card data and imagery from [Scryfall](https://scryfall.com). This project is not affiliated with Wizards of the Coast.
