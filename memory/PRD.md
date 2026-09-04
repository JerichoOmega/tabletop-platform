# Tabletop Lounge — PRD

## Original problem statement
Build a multi-game digital **tabletop platform foundation** (not a single game).
Milestone 1 = platform architecture + shell only. Treat the supplied
`lexicon-hall.html` as a **read-only reference** (rules frozen). Do NOT implement
Lexicon Hall gameplay yet. Platform core must be game-agnostic; games register
into the platform. Deliver an architecture report at the end.

## User choices (2026-06)
- Scope: **Foundation + working "Coming Soon" placeholder** for Lexicon Hall.
- Persistence: **Hybrid** (FastAPI + MongoDB backend, with localStorage mirror/fallback).
- Players: **Local profiles only** (no login/auth).
- Plugin contract: **Full contract defined**, both games registered as stubs.
- Design: platform decides — premium warm "game-lounge" aesthetic; games keep own identity;
  reusable across many future games; **not** a Lexicon-Hall-only platform (Valora = Game #1,
  Lexicon Hall = Game #2).

## Architecture (game-agnostic core)
- Frontend: React 18 + CRACO + Tailwind v3, react-router v6, Context state, custom UI kit,
  lucide-react, sonner, framer-motion.
- Backend: FastAPI + MongoDB. Routes `/api/{players,sessions,settings}`. Sessions store an
  **opaque game-state blob** owned by each game module (no game logic in core).
- Plugin system: `platform/contract.js` (contract + `validateGameModule` + `defineGame`) and
  `platform/registry.js`. Games registered in `games/index.js`.
- Full report: `/app/ARCHITECTURE.md`.

## Implemented (2026-06 — Milestone 1)
- Platform shell: Nav, Lounge landing, Game Library (filters + live search), Game Detail,
  Players (local CRUD + seating), Sessions (create/resume/delete/copy-id), Settings
  (theme/audio/motion/accessibility, persisted).
- Game Host Frame (fullscreen) hosting a game's Surface/Placeholder with platform chrome.
- Games registered as stubs: **Valora** (Available, stub tactical-grid Surface, `engine:null`)
  and **Lexicon Hall** (Coming Soon, ComingSoon placeholder, `engine:null`).
- Hybrid persistence (backend-first + localStorage fallback).
- Verified: 100% backend + frontend (test_reports/iteration_1.json).

## Backlog
- **P1** Port Lexicon Hall engine/AI/Surface from frozen `lexicon-hall.html` behind the contract; flip status to available.
- **P1** Implement Valora engine (grid, turns, AI) behind the contract.
- **P2** Wire session lifecycle to launching a game (auto create/resume, persist state per turn).
- **P2** Player statistics aggregation on profiles.
- **P3** Per-game engine unit tests (scoring/validation).

## Notes
- No auth, no external integrations, no mocks.
- Tailwind wired via CRACO `loaderOptions` (CRA5 sets postcss `config:false`).
