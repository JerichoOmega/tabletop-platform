# Intelligent Tabletop — Canonical Roadmap

**Canonical as of:** 2026-08-16  
**Repository:** `JerichoOmega/tabletop-platform` @ `main`

> This document is the authoritative roadmap for all future agents, coding agents,
> AI systems, and developers working on this project. Read it before proposing or
> implementing major architecture changes.

---

## Core Design Principle

### "The Table Is Fixed. The World Is Not."

The visible tabletop has a fixed presentation size. The world it represents may be
arbitrarily larger.

The tabletop is a **fixed-size viewport** into a potentially much larger persistent
world. A dungeon, corridor, battlefield, city, cavern, forest, or other environment
may be substantially larger than the visible tabletop. The system represents only the
relevant portion of that world on the tabletop and moves the viewport through the
larger world as the player explores.

Key principles:

- The visible tabletop has a fixed presentation size.
- The represented world may be arbitrarily larger.
- The tabletop acts as a viewport into world space.
- Characters and world objects retain **persistent world coordinates** regardless of
  viewport position.
- Moving the viewport must not change an object's actual world position.
- Large environments must not be artificially compressed merely to fit the tabletop.
- Small environments may fit entirely within the tabletop.
- Large environments may require viewport movement.
- Long environments (corridors, roads) may stream/recycle world geometry as the party
  progresses.

The intended player experience is:

> "The table stays the same size, but the world comes to the table."

This is not merely "camera scrolling." The tabletop should feel like a fixed physical
game surface capable of representing a much larger world — one that the player
explores, not one that is resized to fit.

---

## World Representation Model

*(Planned architecture — not yet implemented.)*

```
WORLD
  ↓
WORLD REGION
  ↓
WORLD COORDINATES
  ↓
VIEWPORT
  ↓
VISIBLE WORLD SECTION
  ↓
TABLETOP RENDERER
```

### Environment examples

| Environment | Viewport behavior |
|---|---|
| **Small room** | The entire room fits on the tabletop. No viewport movement needed. |
| **Large room** | The room exceeds tabletop dimensions; the viewport moves as the party explores. |
| **Long corridor** | The corridor may be far longer than the tabletop. Previously viewed sections leave the viewport; new sections appear ahead. |
| **Massive battlefield** | Extends far beyond the visible tabletop while all entities retain persistent world coordinates. |
| **Open world** | The tabletop represents the portion of the environment currently relevant to the party. |

---

## Exploration vs. Tactical Combat

### Exploration Mode

- The viewport may move through the world.
- Large environments continuously reveal new areas.
- Long corridors and roads extend beyond the visible tabletop.
- The world may stream/recycle presentation geometry.
- The party can travel through spaces larger than the tabletop.

### Tactical Mode

- The relevant tactical area becomes stable.
- The tabletop behaves like a traditional tactical board.
- Movement, targeting, attacks, and abilities operate against a stable spatial
  presentation.
- The viewport must not unexpectedly drift while the player makes tactical decisions.

### Encounter Transition Flow *(planned)*

```
Exploration
  ↓
Encounter detected
  ↓
Relevant tactical area established
  ↓
Viewport stabilizes
  ↓
Combat
  ↓
Combat ends
  ↓
Exploration resumes
```

---

## Persistence Requirement

Future implementation must preserve **world identity**.

If an entity exists at world coordinate `(142, 37)`, changing the viewport must not
cause that entity to become a different entity or regenerate into an inconsistent
state. Returning to a previously explored location should represent the same world
state unless game systems have intentionally changed it.

---

## Architectural Boundaries

The World Scale / Viewport system must **not** replace the authoritative rules engine.
The conceptual separation:

| Layer | Responsibility |
|---|---|
| **Rules Engine** (`rules.ts`) | Authoritative game state, movement legality, combat legality, entity state, authoritative coordinates |
| **World Representation** *(planned)* | World regions, viewport position, visible world section, streaming/chunk presentation |
| **Tabletop UI** | Renders the currently visible world section, presents interaction state, collects player input |
| **Asset System** | Provides visual representations; remains independent from gameplay legality |
| **AI / Intent System** | Reasons about and proposes actions; must operate through authoritative validation; should eventually reason about world context without owning world state |

The viewport determines **what portion of the world is presented**, not a redefinition
of the world itself.

---

## Future AI Integration

This architecture is intentionally established before expanding LLM-driven world
generation or natural-language gameplay.

Eventually an AI Dungeon Master may describe or generate environments much larger than
the tabletop:

> "The corridor continues another hundred feet before opening into a massive
> underground chamber."

The AI should describe the world conceptually. The world representation system
determines how that environment is represented through world coordinates,
regions/chunks, viewport state, and tabletop rendering. **The AI must not directly
manipulate the tabletop rendering layer.**

---

## Roadmap Phases

### Phase 1 — Foundation ✅ Complete

| Milestone | Commit |
|---|---|
| Core rules engine | — |
| Content / data definitions | — |
| Deterministic combat resolution | — |
| Ability and targeting system | — |
| Intent / proposal architecture | — |
| Asset registry | `1c825d3` |
| Gameplay regression coverage | `9e489d5` |
| Type-safety hardening | `5508399` |

---

### Phase 2 — Core Tabletop UX 🔄 Current

Work in this phase focuses on interactive quality and player-facing polish before
major architectural expansion.

1. Hover / Target Preview
2. Targeting UX refinements
3. Tablet-oriented tabletop layout
4. Accessibility
5. Animation and interaction polish

Items in this phase are not all complete. See `docs/PROJECT_STATUS.md` for current
implementation state.

---

### Phase 3 — World Representation 📋 Planned

This is the next major architectural phase. The Fixed Tabletop / Large World principle
(above) must be fully implemented before Phase 4 or Phase 5 work that depends on it.

1. **World Scale & Tabletop Viewport Specification** — formal spec document
2. **World-coordinate model** — coordinate system independent of viewport
3. **Fixed tabletop viewport** — renders a bounded window into world space
4. **Large-area viewport behavior** — rules for when/how the viewport moves
5. **Continuous / streaming environments** — corridor and open-world geometry streaming
6. **World-coordinate preservation** — entities keep identity across viewport changes
7. **Encounter boundaries** — define the tactical area within a world region
8. **Tactical-area locking** — viewport stabilization during combat
9. **Seamless exploration → encounter → combat transitions**

---

### Phase 4 — Visual World 📋 Planned

*Depends on Phase 3 world representation model.*

- Production character assets
- Terrain / prop asset integration
- Environment chunks
- Environmental transitions
- Combat / environment visual effects

---

### Phase 5 — Intelligent Interaction 📋 Planned

- LLM-powered natural-language actions
- Intent interpretation
- Proposal generation
- Engine revalidation
- AI DM contextual narration
- Dynamic exploration / world generation

---

### Phase 6 — Deeper Tabletop Systems 📋 Planned

- Fog of war
- Status effects
- Reactions / opportunity attacks
- Cover / elevation
- Environmental interactions
- Destructible / interactable terrain
- More complex encounters
- Persistence / campaign state

---

## Documentation Governance

This roadmap is canonical guidance for all future agents. Agents working on this
repository must follow these rules:

1. **Read this document before proposing major architecture.**
2. **Preserve completed architectural decisions.** Do not re-litigate the five-layer
   engine/content/intent/assets/ui split, the fixed-tabletop/large-world principle, or
   the rules-engine authority boundary.
3. **Do not implement deferred systems prematurely.** Phase 3 world representation
   must not be partially introduced during Phase 2 polish work.
4. **Avoid architecture that conflicts with the fixed-table/large-world principle.**
   Do not tie entity positions to tabletop pixel coordinates or UI dimensions.
5. **Treat this roadmap as directional, not a work order.** Presence in a future phase
   does not authorize automatic implementation.
6. **Update project documentation when roadmap milestones are completed.** Mark
   completed items in this file and update `docs/PROJECT_STATUS.md`.
7. **Keep `docs/PROJECT_STATUS.md` synchronized with actual repository state.**
   Stale status claims mislead future agents.
