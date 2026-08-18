---
name: Platform experience philosophy
description: Locked product direction — Intelligent Tabletop is a multi-game platform; RPG is one Experience
---

# Platform experience philosophy (locked design, NOT implemented)

Authoritative doc: `artifacts/tabletop/docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md`.

- Intelligent Tabletop is a multi-game tabletop PLATFORM; the RPG is ONE "Experience". Never architect platform surfaces (menu, discovery, profile, titles) around RPG concepts (dungeon/character/campaign/miniature).
- Nav intent: PLAY / BROWSE / LIBRARY / CREATE(future) / PROFILE; Settings separate from Profile. Discover-style curated home, "Experience Card" universal content model, taxonomy by GAME TYPE.
- Persistent player profile above any game; Destiny-style earned-title framework (platform provides framework, Experience defines requirements; scopes: platform/game-type/game-specific/event).
- Current state: App.tsx mounts IntelligentTabletop directly — no shell/router/persistence/profile/titles. Future seam: src/platform shell renders Experiences via generic registry; shell must not import RPG content (ENCOUNTER_DEFS) directly; engine untouched.
- Do NOT build fake multiplayer/progression/title data/placeholder catalogs ahead of real milestones.

**Why:** product identity is "the table"; games are what's placed on it; player identity persists across games.
**How to apply:** any menu/navigation/profile/progression work must follow the doc; keep platform-level vs Experience-level data separate.
