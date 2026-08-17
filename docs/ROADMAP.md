# Intelligent Tabletop — Canonical Roadmap

**Canonical as of:** 2026-08-17  
**Repository:** `JerichoOmega/tabletop-platform` @ `main`

> This document is the authoritative roadmap for all future agents, coding agents,
> AI systems, and developers working on this project. Read it before proposing or
> implementing any major architecture changes.

---

## Product Vision

Intelligent Tabletop is a curated platform of original, tabletop-native digital games
designed to make it exceptionally easy for a group to find, learn, start, and finish a
great tabletop session together.

**Core product promise:**

> "The fastest way for a group to find, learn, and finish a great tabletop game
> together — without a host doing setup, rules administration, or scheduling
> archaeology."

The platform is **not** intended to become:

- a generic virtual tabletop
- a Tabletop Simulator-style physics sandbox
- a licensed board-game catalog
- a full traditional VTT
- an autonomous AI game world
- an open creator ecosystem at launch

The platform optimizes for:

- fast session startup
- clear rules enforcement
- consistent interaction patterns
- predictable session length
- multiplayer/social flow
- high-quality first-party games
- discovery based on player intent
- AI used to remove preparation, bookkeeping, and friction — not to replace
  authoritative rules

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
- Long environments (corridors, roads) may stream/recycle world geometry as the party
  progresses.

This is a **shared spatial presentation capability** — not a requirement that every
future game use a streamed world. Card games, abstract games, and territory games may
use specialized presentation models.

The intended player experience is:

> "The table stays the same size, but the world comes to the table."

---

## Product Strategy Guardrails

These rules are permanent and apply to all phases.

### 1. Platform before ecosystem, but product before platform

Build only enough shared infrastructure to support proven first-party games.
Generalize from repeated evidence, not speculation.

### 2. Fast sessions are a product contract

Every game eventually needs structured metadata for:

- supported player counts
- setup time
- median session duration
- high-percentile duration
- new-player duration
- fast/short variant duration
- save/checkpoint behavior
- DM requirement
- complexity
- cooperative/competitive structure

Never advertise session lengths that telemetry cannot support.

### 3. Board-game discipline

Intelligent Tabletop should prefer:

- small action vocabularies
- few conditions
- few resources
- deterministic interactions
- visible consequences
- short encounters
- objective-driven play
- high tactical density with low bookkeeping

Do not add traditional tabletop complexity simply because traditional RPGs have it.

### 4. Authority boundary

```
AI proposes.
Rules engine decides.
World state persists.
Viewport renders.
Tabletop displays.
```

AI must never be the authoritative source of mechanical truth. No AI model may
directly mutate authoritative game state.

### 5. Originality by design

Future games must use independently authored terminology, rules text, content,
visuals, settings, characters, and marketing. Avoid dependence on proprietary game
terminology or copied expression. Legal review remains appropriate before commercial
release.

### 6. No universal-engine trap

Shared platform infrastructure provides capabilities and contracts. Individual games
own their own rules, victory conditions, hidden information, content, AI policies, and
game-specific UI. Do not force radically different genres into one universal rules
grammar.

---

## Authoritative Runtime Model

### Player-facing action flow

```
PLAYER INPUT / AI PROPOSAL
         ↓
  STRUCTURED INTENT
         ↓
 GAME-SPECIFIC VALIDATION
         ↓
 AUTHORITATIVE RULES ENGINE
         ↓
 DETERMINISTIC RESOLUTION
         ↓
   EVENT LOG / STATE CHANGE
         ↓
    CLIENT RENDERING
```

### AI / DM proposal flow

```
    AI / HUMAN DM
         ↓
  STRUCTURED PROPOSAL
         ↓
 PERMISSION + SCHEMA VALIDATION
         ↓
    RULES ENGINE
         ↓
   COMMITTED EVENT
         ↓
  PERSISTENT STATE
         ↓
  NARRATION / UI
```

**No AI model may directly mutate authoritative game state.**

---

## Platform / Game Boundary

### Platform-owned capabilities

- identity
- friends
- parties
- invitations
- tables
- sessions
- lobbies
- reconnect/save foundations
- synchronization
- event/replay infrastructure
- shared tabletop presentation
- input/accessibility
- asset/content registry
- discovery metadata
- search/filtering
- telemetry
- AI orchestration gateway
- moderation foundations
- versioning/compatibility

### Game-owned capabilities

- rules
- phases
- legal actions
- victory conditions
- combat/strategy formulas
- units/cards/characters
- maps/boards/world logic
- game-specific UI
- progression
- economy
- scenario scripting
- AI behavior policy
- narrative
- game-specific content validation

---

## Cross-Platform Contracts

### Game Mode contract

Every game mode must declare:

- ID and version
- display metadata
- player count range
- session duration (median, high-percentile, new-player, fast-variant)
- complexity rating
- game type (cooperative / competitive / mixed)
- required platform capabilities
- rules and content package references
- AI capabilities and permission scope
- save/reconnect behavior
- accessibility conformance
- compatibility constraints

### Event contract

Every committed event must record:

- source (player, AI, DM, system)
- actor identity
- structured intent/action
- rules version at resolution
- random seed and result where applicable
- state changes
- sequence number and timestamp
- visibility scope (public, hidden-from-player, DM-only)

### Versioning contract

Rules, content, assets, and saves must be version-aware. A saved session must be
resolvable against the rules version at time of save.

### AI permission contract

AI permissions must be scoped by context and hidden-information boundaries. An AI
assistant must not receive information it is not authorized to hold.

### Accessibility contract

Accessibility is a platform requirement, not a per-game afterthought. Every game mode
must meet the platform's accessibility baseline before release.

---

## Roadmap Phases

### Phase 1 — Foundation ✅ Complete

| Milestone | Status |
|---|---|
| Core rules engine | ✅ Done |
| Content / data definitions | ✅ Done |
| Deterministic combat resolution | ✅ Done |
| Ability and targeting system | ✅ Done |
| Intent / proposal architecture | ✅ Done |
| Asset registry | ✅ Done |
| Gameplay regression coverage | ✅ Done |
| Type-safety hardening | ✅ Done |

---

### Phase 2 — Core Tabletop UX ✅ Complete

| Item | Status |
|---|---|
| Hover / Target Preview | ✅ Done |
| Targeting UX refinements | ✅ Done |
| Tablet-first responsive layout | ✅ Done |
| Keyboard navigation + ARIA roles | ✅ Done |
| WCAG 2.1 AA accessibility | ✅ Done |
| Animation / tactile feedback | ✅ Done |

See `artifacts/tabletop/docs/PROJECT_STATUS.md` for implementation detail.

---

### Phase 3 — World Representation 🔧 In Progress

This is the current implementation phase. The Fixed Tabletop / Large World principle
must be fully implemented before work depending on it begins.

Full technical specification: **`artifacts/tabletop/docs/WORLD_SCALE_VIEWPORT.md`**

| Item | Status |
|---|---|
| World-coordinate model (wx, wy; TileQueryFn) | ✅ Done — Phase A |
| Fixed tabletop viewport (ViewportState, getVisibleTiles) | ✅ Done — Phase B |
| Large-area viewport behavior (dead-zone follow, recenter) | ✅ Done — Phase C/D |
| Large-area validation (40×40 grandHall, full mechanics) | ✅ Done — Phase E |
| Chunk/region streaming (ChunkStore, ChunkGeneratorFn, snapshots) | ✅ Done — Phase F-foundation |
| Async streaming lifecycle (ensureResident, pin/unpin, deduplication) | ✅ Done — Phase F-async |
| WorldState & WorldEntityRegistry (entity persistence, encounter boundary) | ✅ Done — Phase F-world |
| Viewport streaming integration (prefetch, chunkVersion, loadingChunkSet) | ✅ Done — Phase F-viewport |
| Persistent WorldState (entity survival across chunk eviction) | ⬜ Phase G |
| Exploration → encounter → combat transitions | ⬜ Phase H |
| World-edge handling and coordinate bounds | ⬜ Phase I |
| Performance hardening and streaming tuning | ⬜ Phase J |

**Phase 3 completion gate:**

A deterministic test must be able to move the viewport through a larger world, return
to an earlier location, and demonstrate that entities retain identity and authoritative
state.

No future system may fake large-world behavior by coupling entity positions to
tabletop or UI coordinates.

---

### Phase 4 — Platform Runtime Foundation 📋 Planned

**Purpose:** Build the minimum shared platform layer needed for multiple first-party
game modes.

| Item | Scope |
|---|---|
| Game-mode manifest / schema | Versioned contract for every game mode |
| Game-mode registry / loading | Platform loads and isolates game packages |
| Session / table abstraction | Structured lifecycle: lobby → active → ended |
| Lobby / private-room foundation | Invite-only and open tables |
| Player / party / session identity | Persistent identity across sessions |
| Save / reconnect contract | Mid-session disconnect recovery |
| Versioned game package contract | Rules + content independently versioned |
| Shared event / replay contract | Deterministic replay across versions |
| Shared input / accessibility contract | Baseline every game must meet |
| Asset registry integration | Shared asset resolution |
| Discovery metadata contract | Structured metadata for filtering/search |
| Telemetry | Session duration, completion, abandonment, onboarding |
| Permissioned AI gateway | AI access scoped per game, per context |

**Explicitly deferred:**

- public creator marketplace
- arbitrary user scripting
- universal visual rules editor
- universal rules language
- open asset uploads
- autonomous AI DM
- large social network features

**Phase 4 gate:** A second substantially different internal game must be able to use
the platform contracts without leaking the first game's rules into platform
infrastructure.

---

### Phase 5A — Ages of Empire 📋 Planned

**Purpose:** Prove a completely different strategy ruleset can share the platform.

**Product target:**

> "A compact civilization-and-conquest tabletop strategy game where each Age changes
> the strategic priority and the game ends before cleanup becomes tedious."

| Constraint | Target |
|---|---|
| Players | 2–4 at launch |
| Session length | ~30–45 minutes |
| Player elimination | No elimination at launch |
| End condition | Finite Victory Point endgame |
| Ages | Four fixed Ages |
| Turn structure | Reinforce → Develop → Attack → Fortify |
| Combat variance | Bounded; clear odds/results previews |
| Development system | Small and learnable |
| Maps | Multiple templates |
| Scoring paths | Multiple paths to victory |
| AI opponents | Bounded and testable |

**Phase 5A gate:** Playtests must evaluate session length, downtime, snowballing,
elimination misery, late-game cleanup, and strategic meaningfulness. Simplify before
adding content if these criteria fail.

---

### Phase 5B — Streamlined Tactical RPG 📋 Planned

**Purpose:** Make the tactical RPG a first-class product and the foundation for human
DM play.

**Product target:**

> "Finish one meaningful fantasy tactical mission tonight."

This is a **board-game-scale tactical RPG**, not a compressed simulation of a full
traditional tabletop RPG.

**Core mechanics:**

- d20 resolution
- Attributes: Might / Agility / Mind / Spirit
- Defenses: Defense / Fortitude / Will
- Four classes: Vanguard, Ranger, Arcanist, Warden
- Turn structure: Stride + Action + limited Tactical option + Reaction
- Small condition vocabulary
- Small resource vocabulary
- Short objective-driven encounters
- Visible enemy intent
- Deterministic terrain interactions
- Persistent heroes and world without excessive bookkeeping

**Classes:**

| Class | Keywords |
|---|---|
| Vanguard | Guard / Claim |
| Ranger | Mark / Trail |
| Arcanist | Attunement / Field |
| Warden | Bond / Ward |

**Required tactical systems:**

- line of sight
- compact cover
- engagement
- forced movement
- limited elevation
- difficult/hazardous terrain
- small deterministic environmental reaction matrix
- objective clocks
- enemy intent
- morale/retreat
- downed/recovery
- bounded reactions

**Explicitly deferred:**

- universal flanking
- broad bonus-action economy
- ammunition tracking
- equipment durability
- large damage-type matrices
- condition stacking
- complex crafting
- full stealth simulation
- facing
- full elemental physics
- large spell lists
- arbitrary AI-created mechanics

**Phase 5B gate:** A new player must be able to complete a tactical encounter without
repeatedly consulting a rulebook.

---

### Phase 6 — Session Discovery / Game Browser 📋 Planned

**Purpose:** Make discovery a core platform feature, not cosmetic UI.

Discovery must support filtering by:

- player count
- time available
- complexity
- competitive/cooperative
- campaign/non-campaign
- DM required
- AI support
- accessibility
- new-player friendliness
- session intensity
- save/resume

Eventually support natural queries such as:

> "We have 3 players and 25 minutes."

The platform must return modes whose measured behavior actually fits — not what was
advertised.

**Phase 6 gate:** A group can go from "we want to play something" to a viable game
choice in seconds.

---

### Phase 7 — Human DM + AI Assistance 📋 Planned

**Purpose:** Introduce the 3v1 play mode where the human DM is director and AI is
assistant.

**Primary configuration:** 3 players + 1 human DM.

**The human DM controls:**

- pacing
- story beats
- NPC intent
- complications
- branching
- enemy behavior level
- reveal timing

**AI assists with:**

- encounter suggestions
- rules explanations
- NPC dialogue
- continuity tracking
- enemy behavior recommendations
- encounter scaling proposals
- validated clue/content suggestions
- recaps
- world-state summaries

**AI must not:**

- secretly alter difficulty
- invent illegal mechanics
- directly mutate state
- contradict committed world facts
- reward persuasive prompting over valid play
- reveal unauthorized hidden information

**Phase 7 gate:** The DM must feel like a director, not a bookkeeper.

---

### Phase 8 — Social Platform Layer 📋 Planned

| Feature | Scope |
|---|---|
| Persistent parties | Groups that persist across sessions |
| Friend presence | See who is available to play |
| Fast invites | Low-friction table invitations |
| Private tables | Invite-only rooms |
| Reconnect | Mid-session disconnect recovery |
| Spectating | Watch an active session |
| Rematch | Restart a session with the same group |
| Campaign groups | Persistent group identity across campaigns |
| Session history | Record of completed sessions |
| Recaps | AI-assisted session recaps |
| Moderation / reporting | Safety and community health |
| Voice / text | As justified by demonstrated need |

**Rule:** Every social feature must reduce friction around actually playing.

---

### Phase 9 — First-Party + Curated Content 📋 Planned

Content expansion priority:

1. first-party modes
2. first-party scenarios and campaigns
3. variants and expansions
4. carefully selected partners
5. broader publishing later

Every published mode must satisfy:

- platform contracts
- accessibility baseline
- session metadata
- validation gates
- quality standards

---

### Phase 10 — Controlled Creator Ecosystem 📋 Long-Term

Staged rollout — do not skip stages:

1. internal authoring
2. curated partners
3. template-based creator tools
4. sandboxed extensions
5. publishing review
6. marketplace
7. broader SDK only when justified

No stage may be skipped. Every stage must include:

- versioned packages
- permissioned scripting
- asset validation
- ratings
- IP reporting
- moderation
- private testing before public
- certification
- creator analytics
- transparent discovery ranking

**Do not build an open UGC platform until Intelligent Tabletop can govern it.**

---

## Strategic Destination

```
Phase 3 World Representation          ← current priority
       ↓
Platform Runtime (Phase 4)
       ↓
Ages of Empire (Phase 5A)
       ↓
Streamlined Tactical RPG (Phase 5B)
       ↓
Session Discovery (Phase 6)
       ↓
Human DM + AI Assistance (Phase 7)
       ↓
Social / Content Platform (Phase 8–9)
       ↓
Controlled Creator Ecosystem (Phase 10)
```

**Explicitly prohibited short-cuts:**

- Jumping directly to a creator marketplace
- Shipping an autonomous AI DM before the authority boundary is enforced
- Broad procedural generation without entity persistence
- Generalized speculative platform abstractions not driven by a proven game
- Open UGC before platform governance is in place

---

## Validation Gates

### Engineering gates (every major phase)

- typecheck (`tsc --noEmit`)
- unit tests
- E2E tests
- production build
- regression coverage (no previously-passing test may break)
- deterministic/replay tests where applicable
- accessibility regression coverage
- performance measurement
- reconnect/failure testing where applicable
- documentation sync

### Product gates (every major phase)

A phase is **not** complete merely because code exists. Every major phase must answer:

1. What player problem does this solve?
2. What shared contract does it establish?
3. What remains game-specific?
4. What complexity does it introduce?
5. What complexity does it remove?
6. How is it tested deterministically?
7. How is it measured in play?
8. What prevents dependency traps?
9. What happens when AI is unavailable?
10. How is it versioned/migrated?

### Playtesting gates (games)

- new-player onboarding time
- session duration vs advertised
- abandonment rate
- rules confusion points
- dominant strategies
- unnecessary bookkeeping
- fun without hypothetical future systems

---

## Anti-Scope-Creep Rules

Do **not** add a system merely because:

- another game has it
- traditional RPGs have it
- it makes the rules "more complete"
- AI can generate it
- it is technically interesting
- a hypothetical future creator ecosystem might need it

Add systems **only** when:

- a demonstrated player problem requires them
- they create meaningful decisions
- complexity cost is understood
- UI can represent them clearly
- the engine can validate them
- tests exist
- there is a removal/deprecation path

**Decision value gained / cognitive + implementation cost introduced.**

Prefer simple mechanics that generate multiple meaningful interactions over complex
mechanics that generate one.

---

## Documentation Governance

All agents working on this repository must follow these rules:

1. **Read `docs/ROADMAP.md` before proposing or implementing major architecture.**
2. **Preserve completed architectural decisions.** Do not re-litigate the engine
   authority boundary, the fixed-tabletop/large-world principle, or the platform/game
   boundary.
3. **Respect the platform/game boundary.** Platform infrastructure must not absorb
   game-specific rules. Game packages must not depend on another game's internals.
4. **Never implement future phases early.** Phase gates exist for a reason. Do not
   partially introduce a later phase's architecture during an earlier phase.
5. **Generalize only from repeated evidence.** Do not build shared abstractions for
   a need seen in only one game.
6. **Treat session length as a product requirement.** Never ship a game mode without
   structured session duration metadata backed by measured playtests.
7. **Maintain board-game discipline.** Prefer small vocabularies, deterministic
   interactions, and visible consequences.
8. **Keep AI subordinate to authoritative rules and state.** The rules engine decides.
   AI proposes.
9. **Keep game packages independently versionable.** A rules change in one game must
   never silently break another.
10. **Synchronize `artifacts/tabletop/docs/PROJECT_STATUS.md` when milestones change.**
11. **Require both engineering AND product validation before declaring a major phase
    complete.** Code passing tests is necessary but not sufficient.
12. **Stop and reassess when evidence contradicts the roadmap.** The roadmap is
    directional, not a work order. Presence in a future phase does not authorize
    automatic implementation.
