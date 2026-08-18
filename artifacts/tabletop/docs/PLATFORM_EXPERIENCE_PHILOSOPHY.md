# Intelligent Tabletop — Platform Experience Philosophy

_Status: **LOCKED DESIGN DIRECTION.** Nothing in this document is implemented
unless explicitly marked so. It defines the product-level architecture the
platform must grow toward, and the boundaries current work must not violate._

Cross-references:
- `docs/PRESENTATION_CAMERA_DIRECTION.md` — locked tabletop/camera presentation direction
- `docs/VISUAL_ASSET_LIBRARY.md` — canonical visual assets incl. Grand Gaming Table V1
- `docs/PROJECT_STATUS.md` — implementation status (what actually exists)

---

## 1. The core principle

**INTELLIGENT TABLETOP IS THE TABLE.**

- The individual games are what we put on it.
- The player is the persistent identity moving between those experiences.
- The Discover system helps the player decide what to put on the table.
- The Profile remembers who they are.
- The Title system records what they have accomplished.
- The Grand Gaming Table provides the physical metaphor.
- The individual Experience provides the rules and visual world.

Intelligent Tabletop is **NOT an AI D&D game**. It is a platform for many
tabletop experience types: RPGs, tactical RPGs, card games, board games,
strategy/grand-strategy, war games, economic games, party games, cooperative,
competitive, puzzle, and types not yet defined. The RPG/dungeon experience
currently in development is ONE Experience within the platform — never the
definition of the platform.

## 2. Platform metaphor

The Grand Gaming Table V1 (`tabletop.grand-gaming-table-v1`) is the physical
representation of the platform. The table stays visually consistent; **what is
placed on it changes per game**: dungeon + miniatures (RPG), world map +
armies (strategy), cards + decks + hands (card game), board + pieces (board
game), properties + money (economic game). The foundational layer must be
game-agnostic.

## 3. Discover-style main menu

The main menu is NOT a "New Game / Load Game / Settings" launcher. It is a
content discovery experience (information architecture inspired by the
Discover philosophy — not Fortnite's branding, visuals, or density):

> "Choosing what to play should feel like discovering an experience, not
> navigating a settings menu."

Discovery should feel **curated and premium**: strong featured content,
personalized recommendations, useful horizontal rows, clear categories,
concise metadata, visual browsing, easy continuation — not an overwhelming
wall of content.

## 4. Primary navigation (locked intent)

```
PLAY   BROWSE   LIBRARY   CREATE   PROFILE
```

- Settings is separate (via Profile or a dedicated control), never merged
  into Profile.
- CREATE is a navigation/design intent; it is **future functionality** until
  the platform supports game creation.

| Surface | Meaning |
|---|---|
| **PLAY** | Personalized home/discovery: Continue Playing, Recommended, Featured, New & Notable, Popular, Recently Played, Great With Friends, Game Types, curated collections. Never RPG-specific — Continue Playing may hold an RPG campaign, a strategy match, and a card game simultaneously. |
| **BROWSE** | Full catalog: search, categories, filters, sorting, recommendations. Primary taxonomy is **GAME TYPE** (RPG, Strategy, Card, Board, Tactical, Party, War, Economic, Coop, Competitive, Puzzle, Social) with game-specific genres beneath (RPG → Fantasy/Sci-Fi/Horror/Mystery, etc.). Taxonomy must support expansion — not hard-coded as final. |
| **LIBRARY** | The player's personal collection: favorites, saved, recently played, active games, completed, created experiences. Discover = "What could I play?" Library = "What do I already have?" |
| **CREATE** | Future: player-created experiences. |
| **PROFILE** | Persistent platform identity (below). |

## 5. Experience Cards

The universal content model is the **EXPERIENCE CARD** — never "Adventure
Card". An Experience is a playable tabletop game or mode of any type. One
platform component must be able to represent an RPG campaign, a strategy
match, a card game, a grand-strategy war game, and an economic board game
alike. Card fields (as applicable): title, artwork, game type, player count,
session length, genre, tags, difficulty, multiplayer info, status, progress,
creator, rating.

Selecting an Experience leads to a **detail page** (artwork, description,
metadata, Play/Continue, Add to Library, Favorite, Related) that stays generic
across all game types.

## 6. Persistent player profile

The PLAYER PROFILE is the player's identity across the entire platform. It is
**not a character sheet** and not tied to any game. Eventual contents: display
name, avatar, platform progression, games played, tables hosted, friends,
groups, favorites, created experiences, statistics, preferred game types,
achievements, earned titles, equipped title.

**THE PLAYER EXISTS ABOVE ANY INDIVIDUAL GAME.** All game types contribute to
the persistent identity.

Profile vs Settings (keep separate):
- PROFILE: "Who am I on Intelligent Tabletop?"
- SETTINGS: "How does Intelligent Tabletop work for me?" (account,
  appearance, audio, accessibility, notifications, controls, gameplay
  preferences, privacy, multiplayer, data/storage)

## 7. Earned Title system (Destiny-style)

Not collectible badges, not plain XP. The model:

```
GAME/ACTIVITY → OBJECTIVE SET → COMPLETE REQUIRED OBJECTIVES
             → EARN TITLE → EQUIP TITLE → DISPLAY ON PROFILE
```

Example: complete the card-game mastery objective set → `TITLE UNLOCKED:
CARDMASTER` → equip → identity shows as "Josh — Cardmaster".

- The **platform** provides the generic framework: title definition,
  objective definition, progress tracking, completion, unlocking, equipping,
  displaying.
- The **Experience** defines the game-specific requirements. Example
  objectives are illustrations, never permanent rules.
- Title scopes: PLATFORM titles, GAME-TYPE titles (Cardmaster, Grand
  Strategist, Dungeon Delver, Board Veteran), GAME-SPECIFIC titles,
  EVENT/SEASONAL titles (future). Never assume all titles belong to one game.
- Titles represent **accomplishment** — earned, not primarily purchasable.
  Players can view earned/locked titles, requirements, progress, and equip one
  as their current identity.

## 8. Tabletop presentation (already locked)

The presentation direction in `PRESENTATION_CAMERA_DIRECTION.md` remains
LOCKED. The intended flow:

```
DISCOVER → SELECT EXPERIENCE → LOBBY/TABLE → GRAND GAMING TABLE
        → ZOOM INTO TABLETOP → GAMEPLAY
```

The tabletop contents change per Experience — do not assume the RPG dungeon
presentation. The RPG camera model (shared group tactical perspective, never
character-centric) and static-miniature model (base = gameplay anchor,
animation belongs to rendering) remain intact as documented.

## 9. Game-agnostic architecture

Platform-level concepts: **Experience, Game Type, Session, Player, Table,
Board/Play Surface, Piece, Card, Objective, Achievement, Title.**

RPG-specific concepts (fine inside the RPG Experience, never at platform
level): Dungeon, Character, Campaign, Miniature, Spell, Encounter.

### Platform-level vs Experience-level data

| Platform-level | Experience-level |
|---|---|
| player, profile, title, library, favorites, experience metadata, friends, groups | RPG character, campaign, spell, dungeon, army, territory, card deck, property, board piece |

Do not force every game into the RPG data model.

## 10. Visual language

Platform UI identity: dark oak, parchment, aged gold/brass, warm lighting,
elegant typography, premium fantasy/tabletop craftsmanship. Individual
Experiences may have entirely different visual identities (sci-fi, colorful,
modern); Experience artwork belongs to the Experience. The platform UI is the
common identity. The approved main-menu reference is the multi-game discovery
dashboard mockup, not the earlier RPG-heavy mockup.

## 11. Implemented platform shell (M5)

The minimal game-agnostic platform shell IS IMPLEMENTED (milestone M5):

```
App.tsx → PlatformShell → platform destination → Experience (via registry)
```

- `src/platform/experiences/types.ts` — generic `ExperienceDefinition`
  (id, title, gameType, description, optional artwork, `Component` entry
  point). No RPG concepts in the abstraction.
- `src/platform/experiences/registry.ts` — generic register/get/has/list
  mechanism; the shell discovers Experiences ONLY through it (no game
  branching). Duplicate/invalid registrations throw.
- `src/platform/experiences/registerBuiltIn.ts` — the only file that knows
  which Experiences ship; registers the RPG (`id: "rpg"`, mounts the existing
  `IntelligentTabletop` unchanged).
- `src/platform/shellState.ts` — pure shell state: platform destination
  (play/browse/library/create/profile/settings) and active Experience are
  SEPARATE concepts; URL codec (`?dest=…`, `?experience=…`) preserves
  unrelated params; unknown Experience IDs degrade safely to Play.
- `src/platform/PlatformShell.tsx` — navigation + Play surface listing
  registered Experiences; all other destinations are explicit
  future-functionality placeholders (no fake content); restrained dark-oak/
  parchment/gold visual language; inside an Experience, a thin exit bar
  returns to the platform.

Still design-only (NOT implemented): Discover/Browse system, Library,
Create, Profile, persistence, titles, multiplayer, additional game types.

Constraints going forward:

- New platform surfaces must be built game-agnostically per this document;
  the shell must never import RPG content (e.g. `ENCOUNTER_DEFS`) directly.
- The engine layer stays untouched by platform work.
- Do not build fake multiplayer, fake progression, fake title data, or
  placeholder catalogs ahead of real implementation milestones.
