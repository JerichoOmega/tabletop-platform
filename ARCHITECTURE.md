# Tabletop Lounge — Platform Architecture Report

**Milestone:** Platform Foundation (architecture + shell only)
**Status:** ✅ Complete — verified 100% backend + frontend (see `/app/test_reports/iteration_1.json`)
**Reference artifact:** `lexicon-hall.html` (rules frozen, treated as read-only)

---

## 1. What this milestone delivered

A **game-agnostic** multi-game tabletop platform. The platform core knows nothing
about any specific game — games register themselves through a plugin contract.
Two games are registered as stubs:

| Game | Role | Status | Engine |
|------|------|--------|--------|
| **Valora: Tactical Front** | Game #1 (3D tactical RPG) | `available` | stub Surface, `engine: null` |
| **Lexicon Hall** | Game #2 (word/tile) | `coming_soon` | `engine: null` + ComingSoon placeholder |

> No game rules exist yet. This is intentional and correct for this milestone.

---

## 2. Architecture

```
TABLETOP PLATFORM
│
├── Platform Core            (game-agnostic — never imports a specific game)
│   ├── Navigation           frontend/src/shell/NavBar.js, AppShell.js
│   ├── Game Host Frame      frontend/src/shell/GameHostFrame.js  ← games mount here
│   ├── Game Library         frontend/src/views/GameLibrary.js + GameDetail.js
│   ├── Players (local)      frontend/src/views/PlayersView.js
│   ├── Sessions             frontend/src/views/SessionsView.js
│   ├── Settings             frontend/src/views/SettingsView.js
│   ├── Shared UI            frontend/src/ui/kit.js, Modal.js
│   ├── State                frontend/src/platform/PlatformProvider.js
│   ├── Persistence (hybrid) frontend/src/platform/storage.js  +  backend/server.py
│   ├── Plugin Contract      frontend/src/platform/contract.js
│   └── Game Registry        frontend/src/platform/registry.js
│
└── Games                    (independent modules, own everything)
    ├── Valora               frontend/src/games/valora/
    └── Lexicon Hall         frontend/src/games/lexicon-hall/   ← plugs in here later
```

### Frontend
- **Framework / build:** React 18 + react-scripts 5 via **CRACO** (for Tailwind PostCSS). Tailwind v3.
- **Routing:** `react-router-dom` v6. Platform views live under the `AppShell` layout; the fullscreen game host is a sibling route `/play/:gameId` (so games render outside platform chrome).
- **State:** React Context (`PlatformProvider`) — players, sessions, settings, active seats.
- **UI system:** custom kit (`Button`, `Card`, `Badge`, `StatusPill`, `Avatar`, `EmptyState`, `Modal`), lucide-react icons, sonner toasts, framer-motion.
- **Design:** "Luxury Warm Lounge" — mahogany/espresso base, antique-gold/amber accent, Cinzel display + DM Sans body + JetBrains Mono stats. Three swappable themes (mahogany / emerald / onyx) + reduced-motion + high-contrast.

### Backend (`/app/backend/server.py`)
Game-agnostic FastAPI + MongoDB. All routes prefixed `/api`:
- `GET /api/` health
- `/api/players` CRUD (local profiles: name, avatar preset, color, stats)
- `/api/sessions` CRUD — a session carries an **opaque `state` JSON blob** owned by the game module. Core never parses it.
- `/api/settings` singleton platform preferences.

### Persistence — HYBRID
`storage.js` writes to the backend first and **mirrors to `localStorage`**; if the backend is unreachable it falls back to the local mirror. The interface is identical either way ("local now, backend-ready").

---

## 3. The Game Plugin Contract (`platform/contract.js`)

Every game is a plain object validated by `validateGameModule()` and registered via `registry.register()`:

```
{
  id, name, version, status,           // status: available | beta | coming_soon
  meta: { tagline, description, tags, players:{min,max},
          playtime, complexity, accentColor, glow, cover, hero, howToPlay[] },
  capabilities: { singlePlayer, localMultiplayer, ai, save, stats },

  engine: null | {                     // pure, framework-agnostic rules engine
    createInitialState(config), applyAction(state, action),
    isGameOver(state), getWinner(state),
    serialize(state), deserialize(json), getStats(state),
  },
  ai: null | ((difficulty) => ({ chooseAction(state) })),

  Surface,      // React component: the interactive game table (mounted in GameHostFrame)
  Placeholder,  // React component: coming-soon / unavailable view
}
```

Games own their rules engine, state, board, tiles, dictionary, scoring, turns, AI,
UI, save/load and statistics. The platform core interacts **only** through this shape.

---

## 4. Exactly where Lexicon Hall plugs in later

`frontend/src/games/lexicon-hall/index.js` is the single integration point. To port
Lexicon Hall from the frozen `lexicon-hall.html`:

1. **Engine** → fill `engine` with pure functions ported from the HTML's
   `TileManager`, `WordValidator`, `Scoring`, `BoardManager`, `TurnManager`
   (config: `LETTER_VALUES`, `TILE_DISTRIBUTION`, `BOARD_LAYOUT`, `DICTIONARY`).
   Reproduce rules/scoring/tile distribution/dictionary **exactly**.
2. **AI** → fill `ai` from the HTML's `AIPlayer` (`generateCandidates`, `evaluateMove`, `chooseMove`).
3. **Surface** → a React `Surface` component rendering the 15×15 board + rack, replacing the DOM `render*` functions.
4. **Save/stats** → `serialize`/`deserialize` map to the session `state` blob already persisted by the core; `getStats` feeds player stats.
5. Flip `status` from `coming_soon` → `available`.

**No changes to the platform core are required** at any step — the registry, host frame, sessions, players and settings already accept it.

---

## 5. What still needs to be created (future milestones)

- **P1 — Lexicon Hall engine port** (from frozen HTML) behind the contract above.
- **P1 — Valora engine** (tactical grid, turn system, AI) behind the same contract.
- **P2 — Session ↔ game wiring**: auto-create/resume a session when launching a game, persist `state` each turn (host frame currently hosts the surface with a null session).
- **P2 — Per-player statistics** aggregation surfaced on profiles.
- **P3 — Automated tests** per game engine (unit tests for scoring/validation).
