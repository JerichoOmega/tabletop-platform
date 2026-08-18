# Intelligent Tabletop — Experience Contract (M6)

_Status: IMPLEMENTED contract + LOCKED boundary documentation. This is the
authoritative definition of the platform/Experience boundary. The next
milestone (RPG vertical slice) builds on top of it._

Cross-references:
- `docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md` — product philosophy (platform, Discover, profile, titles)
- `docs/PRESENTATION_CAMERA_DIRECTION.md` — locked tabletop/camera presentation direction
- `docs/VISUAL_ASSET_LIBRARY.md` — canonical asset infrastructure
- `docs/PROJECT_STATUS.md` — implementation status

---

## 1. What is an Experience?

A playable tabletop game or mode of ANY type, registered with the platform
through `src/platform/experiences/registry.ts`. The platform knows *"here is
an Experience"*; it never knows *"here is an RPG"*. The platform's verbs are
SELECT, LAUNCH, HOST, EXIT, RETURN, IDENTIFY. The Experience's verb is PLAY.

## 2. Experience definition (implemented)

`src/platform/experiences/types.ts` — `ExperienceDefinition`:

| Field | Purpose |
|---|---|
| `id` | Unique URL-safe identity (`[a-z0-9-]`) |
| `title` | Platform display title |
| `gameType` | Broad taxonomy (rpg, card, board, strategy, …) — expandable |
| `version` | `"major.minor.patch"` contract version (see §8) |
| `capabilities` | Generic hosting capabilities (see §3) — validated |
| `players` | Inclusive supported player range — validated |
| `description`, `artworkAssetId` | Optional presentation metadata |
| `Component` | Entry point the shell mounts; owns everything inside |

Registration validates all fields and throws on invalid definitions or
duplicate IDs. Nothing in the definition may reference game concepts
(campaign, dungeon, character, card, territory…).

## 3. Capability model (implemented)

Capabilities describe **how an Experience is hosted, never what it
contains**: `local`, `online`, `synchronous`, `asynchronous`,
`persistent-session`, `shared-board`, `hidden-information`,
`host-authoritative`. Unknown or duplicate capabilities are rejected at
registration. The set only grows when the PLATFORM itself needs to understand
a new hosting property — never for game concepts (`supportsDungeons` is
forbidden by design).

## 4. Lifecycle (ownership implemented; persistence future)

```
DISCOVER/SELECT → LAUNCH → ACTIVE → SUSPEND/EXIT → RETURN
```

Platform owns: selecting (Play surface / `?experience=` deep link), launching
(mounting `Component` inside the shell frame), providing platform context,
handling exit/return (exit bar, `requestExit`, URL restore), and handling
unknown/invalid/failed Experiences. Exiting unmounts the Experience; session
persistence across exit is a FUTURE platform service, deliberately not built.

Experience owns: initializing its own game state on mount, rendering its own
game, running its own rules, determining its own gameplay outcome, cleaning up
its own state on unmount.

## 5. Platform context (implemented)

`src/platform/experiences/platformContext.tsx` — the shell provides a minimal
`ExperiencePlatformContext` to the mounted Experience: `experienceId`,
`experienceVersion`, `requestExit()`. Consuming it is OPTIONAL — the current
RPG never reads it and is fully conformant. Future platform services (player
identity, persistence, presence…) will be added as real fields when their
milestones arrive; speculative placeholders and `any` grab-bags are forbidden.

## 6. State, rendering, asset & persistence ownership

- **State**: game-specific state (world state, characters, encounters —
  or decks, hands — or territories, armies) belongs entirely to the
  Experience. The platform never unifies these into a generic game state
  model, and never interprets Experience internals.
- **Rendering**: platform owns shell, navigation, platform surfaces, and
  transitions into/out of Experiences. The Experience owns its game UI,
  camera, rendering, and interaction. The RPG renderer/engine stays inside
  the RPG.
- **Assets**: the existing visual asset registry (`src/assets/`) remains the
  single canonical asset infrastructure — no second asset system. No
  Experience-ownership concept is currently needed (the registry is a flat
  namespace with ID conventions like `tabletop.*`); revisit only when a
  second Experience actually ships assets. The Grand Gaming Table remains a
  foundational environment asset.
- **Persistence (future)**: platform will own player identity, library,
  platform preferences/progression, titles. Experience will own game saves,
  campaign/match state, game-specific progression. The platform may later
  provide storage infrastructure but never interprets the internal structure
  of an Experience save.

## 7. Error / failure boundary (implemented)

- Unknown Experience ID (URL or action): safely degrades to the Play surface
  — the shell can never mount nothing.
- Invalid definition: registration throws at startup (fail fast, fail loud).
- Launch/runtime failure: the mounted Experience is wrapped in an error
  boundary INSIDE the shell frame; a crash shows a contained failure surface
  with a "Return to platform" action and never takes down the shell.
  (E2E-verified via an `?e2e`-only broken fixture Experience.)

## 8. Versioning

Each Experience declares `version: "major.minor.patch"` (format-validated).
This is **identifying metadata only** — the platform stores and surfaces it
(platform context) but performs no compatibility enforcement, negotiation, or
migration; those do not exist until a real need arrives. Policy for future
breaking changes:

- Breaking change to an Experience's externally visible contract surface
  (its definition metadata or its use of platform context) → bump **major**.
- The platform contract itself evolves through these docs + types; if a
  platform change would break registered Experiences, it must be introduced
  additively (optional fields) or coordinated with a major bump of affected
  Experiences. No migration framework exists or is planned until real need.

## 9. RPG conformance (implemented)

The RPG conforms through registration alone — `registerBuiltIn.ts` registers
`id: "rpg", version: "1.0.0", capabilities: ["local","synchronous","shared-board"],
players: {min:1,max:1}` with the existing `IntelligentTabletop` component
unchanged. No wrapper/adapter layer was added because none is needed; combat,
WorldBounds, exploration, terrain, encounters, renderer, and RPG UI are all
untouched.

## 10. Second-Experience thought experiments

**Experience #2 — turn-based territory-control strategy (2–4 players,
shared board):** registrable today as
`{ id, title, gameType: "strategy", version, capabilities: ["local","synchronous","shared-board","host-authoritative"], players: {min:2,max:4}, Component }`.
No PlatformShell change, no RPG/strategy conditionals anywhere, no registry
change, no platform-level territory/army concepts — those live inside its
Component like the RPG's dungeons do. **Passes.**

**Experience #3 — card game with hidden hands:** registrable with
`capabilities: [...,"hidden-information"]`. The platform learns only the
generic hosting property "this game has hidden information", never what a
card or hand is. **Passes.**

Both experiments are enforced in unit tests (registry accepts exactly these
shapes through the generic mechanism).
