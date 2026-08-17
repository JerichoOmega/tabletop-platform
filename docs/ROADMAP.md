# Intelligent Tabletop — Canonical Roadmap

**Canonical as of:** 2026-08-17 (revised to incorporate external product/architecture analysis)
**Repository:** `JerichoOmega/tabletop-platform` @ `main`

> This document is the authoritative roadmap for all future agents, coding agents,
> AI systems, and developers working on this project. Read it before proposing or
> implementing any major architecture changes.
>
> Status vocabulary used throughout: **COMPLETED** · **CURRENT** · **NEXT** ·
> **LATER** · **DEFERRED**. Nothing marked NEXT/LATER is implemented; the repository
> is the source of truth for implementation status.

---

## Platform Thesis

> "Intelligent Tabletop is a curated online tabletop platform for friends who want to
> start quickly, play with confidence, and finish a great game on time."

Intelligent Tabletop is **not** a general-purpose VTT, a Tabletop Simulator clone, or
an open creator platform at launch. It is a curated set of original, tabletop-native
digital games sharing platform infrastructure.

The platform provides:

- fast session discovery
- party/lobby flow
- clear game expectations
- deterministic rules
- guided onboarding
- automated bookkeeping
- persistent session/campaign state where appropriate
- AI assistance where it adds value
- reliable session closure
- multiple distinct tabletop games sharing platform infrastructure

The platform does **not** impose one universal session length. Every game has a
**game-specific Session Contract** (below).

> **"Finishable does not mean short."**

---

## Session Contract System (platform-level concept)

Every game declares a first-class **Session Contract** defining, at minimum:

- target duration
- expected duration range
- player count and ideal player count
- setup/onboarding time
- expected downtime profile
- core gameplay loop
- closure condition
- pause/resume behavior
- reconnect behavior
- campaign/standalone status
- AI role
- complexity/learning profile
- accessibility expectations
- elimination policy where applicable

**Duration must eventually be telemetry-backed**, not merely declared by content
authors. Track: party-ready → results-screen duration, active play duration,
setup/onboarding duration, waiting/downtime per player, player-count-specific
duration, new-player vs experienced-group duration, abandon rate, completion rate,
rematch rate, and reconnect/pause behavior. Trustworthy session duration is a
platform-level quality metric.

### Canonical initial duration targets

| Game | Target | Notes |
|---|---|---|
| RPG tabletop mode | ~60 min | ~50–70 min in practice |
| 3v1 Human DM | ~60–90 min | later mode |
| Ages of Empire | ~120 min | ~100–135 min validated range — not an artificially exact two-hour promise |
| Quick games | ~15–30 min | future category |
| Future games | game-specific | determined by their core loop |

---

## Core Design Principle

### "The Table Is Fixed. The World Is Not."

The visible tabletop has a fixed presentation size. The world it represents may be
arbitrarily larger. The tabletop is a **fixed-size viewport** into a potentially much
larger persistent world.

Key principles:

- The visible tabletop has a fixed presentation size.
- The represented world may be arbitrarily larger.
- The tabletop acts as a viewport into world space.
- Characters and world objects retain **persistent world coordinates** regardless of
  viewport position.
- Moving the viewport must not change an object's actual world position.
- Large environments must not be artificially compressed merely to fit the tabletop.
- Small environments may fit entirely within the tabletop.
- Long environments may stream/recycle world geometry as the party progresses.

**New architectural requirement (canonical):** world representation must support
*bounded* exploration and *structured environmental affordances* without becoming an
unrestricted simulation. Exploration is expressive but bounded — locations contain a
limited number of salient opportunities, described with structured world tags (e.g.
fragile, flammable, unstable, concealed, locked, guarded, holy, flooded, mechanical,
social), not an infinite room simulator and not merely a menu.

This is a **shared spatial presentation capability** — not a requirement that every
future game use a streamed world. Card games, abstract games, and territory games may
use specialized presentation models.

---

## Authoritative Runtime Model (canonical — must not regress)

The architecture already proven in the RPG prototype remains canonical:

```
PLAYER INTENT
     ↓
INTENT INTERPRETER
     ↓
PROPOSED ACTION
     ↓
RULES VALIDATION
     ↓
GAME STATE MUTATION
     ↓
RESOLUTION
     ↓
UI UPDATE
     ↓
SESSION LOG
```

> **"AI proposes. The rules engine decides. The world state persists. The table
> renders the result."**

- The AI/natural-language layer must **never** directly mutate authoritative game
  state.
- Traditional direct controls and AI-assisted/adventure controls must ultimately use
  the **same** underlying rules and execution functions. The system already
  demonstrates this separation and must not regress it.
- The AI must **never** invent a mechanical capability simply because the player's
  wording sounds plausible. AI interprets intent; rules/content systems determine
  whether the action is supported; the rules engine validates legality; game state
  executes the result; AI narrates the validated result. Unsupported actions receive
  constructive alternatives based on actual game state.

Future AI architecture must formalize: proposal schemas, validation, stale-state
revalidation, structured tool calls, permissions, audit logging, prompt/version
tracking, AI cost controls, failure handling, and deterministic fallback behavior.

**AI should be:** intent parser, narrator, rules explainer, continuity assistant,
recap generator, encounter/complication recommender, campaign chronicle assistant,
and — later — DM copilot.

**AI should NOT be:** authoritative rules engine, hidden state mutator, unrestricted
game master, balance authority, or source of mechanical truth.

### AI product positioning

"AI-powered" is **not** the primary consumer-facing identity. The product is marketed
primarily as a great tabletop game/platform with intelligent assistance — adaptive,
intelligent, responsive, coherent, rules-aware — not "the AI makes anything
possible." Because AI gameplay risks include inconsistency, hallucination, latency,
privacy, state/memory failures, and player distrust, the roadmap prioritizes
**reliability and state coherence over generative novelty**. Core games must remain
playable without depending on generative AI availability.

---

## Platform Architecture: Shared Primitives + Game-Specific Rules

Do **not** create one giant universal game/rules engine. The structure is:

**SHARED PLATFORM PRIMITIVES + GAME-SPECIFIC RULES/CONTENT**

### Platform-owned (shared)

- identity
- party/lobby
- session lifecycle
- session contracts
- reconnect
- save/resume
- event logs
- replay
- discovery metadata
- accessibility
- moderation
- AI orchestration
- telemetry
- content validation
- later: commerce/creator systems

### Game-owned (specific)

- rules
- legal actions
- victory/loss conditions
- combat
- diplomacy
- board topology
- progression
- AI behavior
- campaign semantics
- content

The common engine exposes reusable deterministic primitives without forcing every
game into the same mechanical model.

### Event log / deterministic state (foundational — do not postpone)

The authoritative event log is a foundational platform capability, not multiplayer
polish. It should eventually support: replay, reconnect, debugging, auditing,
campaign history, AI context, moderation, analytics, and "what changed because of our
decision?" recaps. The current deterministic foundation and existing validation
architecture remain intact.

Every committed event must record: source (player, AI, DM, system), actor identity,
structured intent/action, rules version at resolution, random seed and result where
applicable, state changes, sequence number and timestamp, and visibility scope.

---

## Game Product Directions

### RPG: streamlined tabletop adventure (~60 minutes per mission)

The RPG is a **streamlined tabletop adventure, not a compressed D&D campaign.**

Each mission supports: briefing, quick loadout, meaningful exploration, social
interaction, environmental interaction, natural-language player intent, one
meaningful approach decision, one major optional objective or a small number of
discoveries, one micro-encounter OR one major tactical encounter (occasionally a
micro-encounter plus a major encounter), meaningful consequences, campaign
persistence, automated resolution/bookkeeping, and a clear ending.

The extra hour must **not** become: open-ended roleplay, extensive inventory
management, crafting/vendor loops, huge spell lists, dense character sheets, long
equipment optimization, unlimited side quests, arbitrary world expansion, or a
traditional 2–4 hour D&D session.

> **"Players can change what happens, but cannot endlessly expand what the game is."**

#### Mission architecture: MISSION CONTRACT + ESCALATION GRAPH

Rigid scene counts are **not** the primary pacing mechanism. Instead:

- **Mission Contract:** primary objective, stakes, target duration, known
  success/failure/retreat outcomes, optional objective(s), closure conditions.
- **Escalation Graph:** finite authored state graph, multiple approaches, meaningful
  state transitions, escalation → commitment → climax → aftermath, controlled
  convergence.

Use **braided branching**, not exponential branching. Player choices alter routes,
encounter composition, available allies, resources, information, faction
relationships, threat state, tactical conditions, and ending configuration — but
branches eventually reconnect to controlled campaign anchors.

Every mission has a closure state: **success, success at cost, partial success,
failure, retreat.** Failure is a valid campaign outcome, not a request to replay the
same mission.

#### Combat pacing (the most likely pacing bottleneck)

- ~3-player tactical parties
- ~3–5 rounds for a major encounter
- ~15–20 minutes for the main climax
- limited action vocabulary: movement + major action + constrained reaction
- few but distinctive enemies, with clear enemy intent
- objective-based encounters: rescue, escape, defend, capture, disrupt, survive,
  retrieve, hold, destroy — "kill every enemy" is **not** the default objective
- automated math/status tracking, fast resolution, minimal downtime
- one major encounter OR one short micro-encounter plus one major encounter — never
  two long conventional combats per mission

#### Character progression (intentionally light)

Prefer: ~six major progression milestones, lightweight talent choices, limited
equipment slots, mission-relevant loadouts, a small number of relics/special tools,
faction/campaign rewards, rapid post-mission upgrades. Avoid: giant skill trees, huge
spell lists, inventory spreadsheets, deep crafting economies, lengthy vendor phases,
optimization-heavy builds. Returning players prepare a character quickly.

#### Campaign design

Campaigns are collections of **finishable missions**: ~4–5 missions for the first
vertical slice, ~6–8 for a compact full campaign, ~8–10 for a larger flagship
campaign. Persistent state uses a constrained vocabulary: faction standing, regional
threat, resources, allies/assets, scars/losses, story keys, route availability,
information discovered. **Consequences must be visible when they matter** — no
invisible backend bookkeeping. Campaigns are braided, not infinitely branching.

### Ages of Empire (~120 minutes; NOT subject to the RPG's 60-minute limit)

A Risk-inspired territory strategy game with Civilization-style development
influences: four historical Ages, finite rounds, VP victory, **no player
elimination**, compact map, fast turns, limited development, meaningful diplomacy,
deterministic final round, strong anti-cleanup mechanics.

- **Players:** 2–4 at launch; balance primarily for 3–4. Do **not** prioritize 5–6
  players until telemetry proves the core game can support it.
- **Structure:** ~8 total rounds — ~2 Ancient, ~2 Medieval, ~2 Industrial, ~2 Modern.
  Each Age changes the strategic question and value of the board rather than adding
  an entirely new subsystem: Ancient = geographic/economic position; Medieval =
  borders, alliances, routes, regional power; Industrial = infrastructure,
  development, mobility, leverage; Modern = convert power into VP, endgame
  objectives, destabilization/endgame pressure.
- **Development:** compact tableau, ~6–10 meaningful development choices per player
  per game. Avoid long prerequisite chains, tiny percentage bonuses, separate
  economic simulations, and multi-round research queues.
- **Anti-downtime system (explicit requirement):** investigate/implement simultaneous
  planning, limited strategic orders, reveal/resolution phases, concise conflict
  windows, limited reaction windows, automated scoring, automated
  upkeep/reinforcement, deterministic or low-variance combat, strong board
  readability, final-round trigger, fixed round cap. A 120-minute game must not
  become a four-hour game.
- **Victory:** VP-based; the game must NOT rely on elimination to end. Scoring
  includes more than raw territory: objectives, infrastructure, regional control,
  age achievements, strategic milestones. Prevent runaway leaders and cleanup without
  arbitrary rubber-banding.
- **Diplomacy:** socially expressive but mechanically bounded. Free negotiation;
  optionally structured actions (temporary truce, trade pact, non-aggression,
  shared objective, conditional support, limited alliance) with explicit duration and
  consequences. Not a contract-management subsystem.

### 3v1 Human DM mode (later; ~60–90 minutes)

Not "unrestricted D&D mode." The human DM is a **DIRECTOR operating within the
game's contract**, added only after the standard RPG mission architecture is proven.

The DM may: choose prepared scene packages, alter revelation order, roleplay NPCs,
select validated complications, alter enemy tactics within rules, select bounded
objectives, spend a finite director budget, add a short optional scene, and ask AI
for dialogue/continuity/pacing assistance.

The DM may NOT: bypass the rules engine, invent unsupported mechanics, create
multi-session subplots during a mission, infinitely expand the map, add unlimited
encounters, silently retcon state, or ignore closure conditions.

**Director Budget:** bounded quantities of major complications, minor complications,
optional scenes/micro-encounters, threat adjustments, terrain twists.

**DM dashboard:** mission state, objectives, active clocks, director budget,
encounter budget, player state, pacing forecast, unresolved mandatory beats, AI
pacing recommendations.

### Quick games (future category; ~15–30 minutes)

Serve onboarding, casual groups, rematches, discovery, "one more game", and
low-commitment social play. Same platform Session Contract system. No game is forced
into RPG or Ages of Empire durations.

---

## Roadmap Phases

Dependency chain: Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8 →
Phase 9/10 → Phase 11 → open ecosystem (later). Completed phases are preserved
exactly; nothing below re-plans shipped work.

### Phase 1 — Foundation ✅ COMPLETED

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

### Phase 2 — Core Tabletop UX ✅ COMPLETED

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

### Phase 3 — World Representation / Exploration Foundation 🔧 CURRENT

**Objective:** complete the Fixed Tabletop / Large World foundation — a playable,
deterministic, world-backed session model with streaming, entity persistence, bounded
exploration, and exploration → encounter → combat transitions.

**Why it exists:** every future game mode and the RPG mission system depend on a
proven world/session substrate; the deterministic completion gate protects entity
identity across streaming.

**Dependencies:** Phases 1–2 (complete).

Full technical specification: `artifacts/tabletop/docs/WORLD_SCALE_VIEWPORT.md`.
Remaining-work plan: `docs/PHASE3_IMPLEMENTATION_PLAN.md` (milestones M1–M6).

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
| Exploration mode + world-backed session | ✅ Done — M1 (2026-08-17) |
| Chunk eviction policy + entity survival | ⬜ M2 |
| Parser migration away from `map.pillars` | ⬜ M3 |
| World bounds / edge handling | ⬜ M4 |
| Exploration → encounter → combat transitions | ⬜ M5 |
| Performance validation + regression sweep | ⬜ M6 |

**Major deliverables (remaining):** M2–M6 above, per `PHASE3_IMPLEMENTATION_PLAN.md`.

**Acceptance criteria:** the deterministic completion-gate E2E passes (traverse out,
force eviction, return; entities retain identity and authoritative state); the full
exploration → encounter → combat → exploration loop works; all pre-existing tests
pass unmodified; parser has zero direct MapDef geometry reads; no entity position is
ever derived from tabletop/UI coordinates.

**Non-goals:** session contracts, lobby/multiplayer, mission framework, unrestricted
world simulation. World representation must support bounded exploration and
structured environmental affordances **without becoming an unrestricted simulation**.

---

### Phase 4 — Platform Runtime / Session Contract Foundation 📋 NEXT

**Objective:** build the minimum shared platform layer for multiple first-party game
modes, with Session Contracts as a first-class schema.

**Why it exists:** the RPG mission system and Ages of Empire both need session
lifecycle, closure states, event logs, and telemetry; building them per-game would
create the universal-engine trap in reverse.

**Dependencies:** Phase 3 complete.

**Major deliverables:**

- session lifecycle (lobby → active → ended)
- Session Contract schema (see Session Contract System above)
- game metadata schema (discovery-ready)
- deterministic session state
- event log / replay foundations (event contract above)
- save/resume
- reconnect architecture
- player/group/session abstractions
- telemetry hooks (duration, completion, abandonment, downtime)
- closure-state framework (success / success at cost / partial / failure / retreat)

**Acceptance criteria:** a second, substantially different internal game can use the
platform contracts without leaking the first game's rules into platform
infrastructure; a session can be saved, resumed, and replayed deterministically.

**Non-goals:** full social marketplace, public creator tools, universal rules
language, open asset uploads, autonomous AI DM, large social features.

---

### Phase 5 — RPG Mission System 📋 NEXT (after Phase 4)

**Objective:** build the streamlined ~60-minute RPG mission framework.

**Why it exists:** the mission framework is the RPG's product core and the substrate
the vertical slice, campaigns, and (much later) the 3v1 DM mode all build on.

**Dependencies:** Phase 3 (world/exploration), Phase 4 (session contracts, closure
states, telemetry).

**Major deliverables:**

- Mission Contract (objective, stakes, target duration, outcomes, optional
  objectives, closure conditions)
- Escalation Graph (finite authored state graph, braided branching, controlled
  convergence)
- bounded exploration (salient opportunities + structured environmental tags)
- action grammar (natural-language intent over supported capabilities only)
- structured environmental tags (fragile, flammable, unstable, concealed, locked,
  guarded, holy, flooded, mechanical, social, …)
- encounter packages (objective-based: rescue, escape, defend, capture, disrupt,
  survive, retrieve, hold, destroy)
- closure states wired to the Phase 4 framework
- campaign state (constrained vocabulary; visible consequences)
- consequence system
- lightweight progression (~6 milestones, light talents, limited slots)
- pacing telemetry

**Acceptance criteria:** a mission runs briefing → exploration → approach decision →
encounter(s) → closure within the ~50–70 minute envelope in playtests; every mission
reaches one of the five closure states; the AI authority model holds (no AI-invented
mechanics); combat climax resolves in ~3–5 rounds / ~15–20 minutes.

**Non-goals:** open-ended roleplay, inventory/crafting/vendor systems, huge spell
lists, exponential branching, human DM tooling, 2–4 hour session design.

---

### Phase 6 — RPG Vertical Slice 📋 NEXT (after Phase 5)

**Objective:** a very small, complete, playable RPG proving the ~60-minute session
contract.

**Why it exists:** the session contract is a product promise; only a finished slice
with telemetry can validate it.

**Dependencies:** Phase 5.

**Major deliverables:**

- 4–5 mission mini-campaign
- 3 player classes
- 2 core enemy families
- one region
- one major encounter pattern + one micro-encounter pattern
- AI-assisted intent/narration
- complete mission closure
- campaign persistence

**Acceptance criteria:** playtest telemetry validates the ~50–70 minute envelope;
completion/abandon/rematch rates measured; a new player finishes a mission without
repeatedly consulting a rulebook.

**Non-goals:** human DM, open UGC, additional regions/classes beyond the slice.

---

### Phase 7 — Ages of Empire 📋 LATER

**Objective:** build the ~120-minute strategy game, proving the platform supports a
fundamentally different Session Contract.

**Why it exists:** validates the shared-primitives / game-specific-rules split with a
second genre; establishes that session length is game-specific.

**Dependencies:** Phase 4 (platform runtime); benefits from Phase 6 telemetry
learnings.

**Major deliverables:**

- four Ages, ~eight rounds (see Ages of Empire product direction above)
- 2–4 players (balanced for 3–4)
- VP victory, no elimination
- compact map, development tableau (~6–10 meaningful choices/player/game)
- bounded diplomacy
- simultaneous planning where appropriate + the full anti-downtime system
- automated resolution, scoring, upkeep
- final-round closure (deterministic final round, fixed round cap)
- telemetry validating the ~100–135 minute range

**Acceptance criteria:** playtests confirm session length, downtime, snowballing,
elimination misery (none), late-game cleanup, and strategic meaningfulness; a
completed game ends by VP/round-cap without relying on elimination.

**Non-goals:** 5–6 players at launch, Civilization-scale tech tree, separate economic
simulation, contract-management diplomacy, player elimination.

---

### Phase 8 — Platform Discovery / Social Layer 📋 LATER

**Objective:** make discovery a first-class platform system —
> "Find the right game for this group right now."

**Why it exists:** the platform promise is fast, confident session starts; discovery
converts metadata + telemetry into a fit decision (e.g. "4 players · 55–70 min ·
medium strategy · competitive · low rules overhead").

**Dependencies:** Phase 4 metadata/telemetry; at least two shipped games (Phases 6–7).

**Major deliverables:**

- game catalog, search, filters: player count, ideal player count, duration,
  complexity, mood, competitive/cooperative/team, learning burden, downtime,
  randomness, elimination policy, communication requirements, campaign commitment,
  accessibility, AI role, replayability, content/tone
- group-fit and party-aware recommendations
- telemetry-backed duration discovery
- session history, rematch flow
- basic social/lobby improvements

**Acceptance criteria:** a group goes from "we want to play something" to a viable,
telemetry-honest game choice in seconds; advertised durations match measured ones.

**Non-goals:** infinite-content platform (Fortnite-style discovery is inspiration,
not a content strategy), large social network features, spectating/voice unless
justified by demonstrated need.

---

### Phase 9 — 3v1 Human DM 📋 LATER

**Objective:** the director-model human DM mode (~60–90 minutes), only after RPG
foundations are stable.

**Why it exists:** human-directed play is a differentiator, but only within the
contract system — otherwise it regresses into unbounded D&D sessions.

**Dependencies:** Phases 5–6 proven (mission architecture + slice telemetry).

**Major deliverables:**

- Director Dashboard (see 3v1 product direction above)
- Director Budget (bounded complications, scenes, threat adjustments, terrain twists)
- DM-specific Session Contract
- AI DM copilot (dialogue/continuity/pacing assistance)
- bounded complications + validated improvisation (all DM actions flow through rules
  validation)
- pacing controls + hard closure safeguards

**Acceptance criteria:** the DM feels like a director, not a bookkeeper; sessions
close within the 60–90 minute contract; no path exists for the DM or AI to bypass the
rules engine or silently retcon state.

**Non-goals:** unrestricted D&D mode, multi-session subplots inside a mission,
unlimited encounters/map expansion, autonomous AI DM.

---

### Phase 10 — Quick Games 📋 LATER

**Objective:** introduce ~15–30 minute games on the same platform infrastructure and
Session Contract model.

**Why it exists:** onboarding, casual groups, rematches, discovery, "one more game."

**Dependencies:** Phase 4; Phase 8 improves their discoverability.

**Acceptance criteria:** at least one quick game ships with a telemetry-validated
15–30 minute contract, using only shared platform primitives plus its own rules.

**Non-goals:** forcing quick-game patterns onto the RPG or Ages of Empire.

---

### Phase 11 — Curated Creator Program 📋 LATER

**Objective:** curated external partners with constrained tooling — Stage 2–3 of the
creator ecosystem.

**Dependencies:** multiple shipped first-party games, validation and moderation
foundations.

**Major deliverables:** partner tooling, content schemas, validation, pacing tests,
private playtesting, certification, moderation, controlled publishing. Creator tools
are constrained to approved objectives, actions, components, session contracts,
duration limits, and content schemas.

**Non-goals / explicitly rejected at this stage:** unrestricted scripting, arbitrary
asset uploads, open UGC, AI-generated mechanics without validation.

---

### Open Creator Ecosystem ⏸ DEFERRED (Stages 4–5)

Marketplace/revenue sharing (Stage 4) and advanced creator scripting (Stage 5) only
after platform demand and governance are proven — deterministic multiplayer,
moderation, security, performance, IP, and discovery systems must all support it
first. Staging: **Stage 1** first-party games only → **Stage 2** curated external
partners → **Stage 3** constrained creator tools → **Stage 4** marketplace →
**Stage 5** advanced scripting. No stage may be skipped.

---

## Strategic Destination

```
Phase 3  World Representation / Exploration Foundation   ← CURRENT (M1 done; M2–M6 remain)
        ↓
Phase 4  Platform Runtime / Session Contract Foundation
        ↓
Phase 5  RPG Mission System
        ↓
Phase 6  RPG Vertical Slice (~60-minute contract proven)
        ↓
Phase 7  Ages of Empire (~120-minute contract proven)
        ↓
Phase 8  Platform Discovery / Social Layer
        ↓
Phase 9  3v1 Human DM        Phase 10  Quick Games
        ↓
Phase 11 Curated Creator Program
        ↓
Later    Open Creator Ecosystem (governance-gated)
```

---

## Do Not Compromise (architectural/product constraints)

1. AI never becomes authoritative game-state mutation.
2. Game-specific rules remain game-specific.
3. Session length is game-specific.
4. Every game has a defined closure contract.
5. Failure is a valid game outcome.
6. Campaigns use bounded braided branching, not exponential branching.
7. Exploration is expressive but bounded.
8. Creator systems remain constrained until governance exists.
9. Multiplayer/platform infrastructure must not compromise deterministic game logic.
10. Telemetry must validate duration claims.
11. Replay/event history should remain possible because of authoritative state
    transitions.
12. Core games must remain playable without depending on generative AI availability.
13. No feature should be added solely because AI makes it technically possible.
14. The platform should optimize for satisfying completed sessions, not artificially
    maximizing session length.
15. Additional session time should buy more meaningful decisions, not more
    bookkeeping.

---

## What Not to Build (deferred / out of scope)

- general-purpose VTT
- Tabletop Simulator clone
- open UGC at launch
- universal visual rules editor
- unrestricted scripting
- autonomous unrestricted AI DM
- infinite procedural campaigns
- huge RPG rulebooks
- Civilization-scale tech tree
- player elimination in Ages of Empire
- giant inventories/crafting systems
- long vendor phases
- 5–6 player Ages of Empire at launch
- standard RPG sessions designed to become 2–4 hour D&D sessions
- AI-generated mechanics without deterministic validation
- full marketplace before creator governance
- feature creep that makes every game use the same duration

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
- session duration vs advertised (telemetry-backed)
- abandonment / completion / rematch rates
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
   authority boundary, the fixed-tabletop/large-world principle, the platform/game
   boundary, or the Session Contract system.
3. **Respect the platform/game boundary.** Platform infrastructure must not absorb
   game-specific rules. Game packages must not depend on another game's internals.
4. **Never implement future phases early.** Phase gates exist for a reason. Do not
   partially introduce a later phase's architecture during an earlier phase.
5. **Generalize only from repeated evidence.** Do not build shared abstractions for
   a need seen in only one game.
6. **Treat the Session Contract as a product requirement.** Never ship a game mode
   without structured session duration metadata, eventually backed by telemetry.
7. **Maintain board-game discipline.** Prefer small vocabularies, deterministic
   interactions, and visible consequences.
8. **Keep AI subordinate to authoritative rules and state.** AI proposes. The rules
   engine decides. The world state persists. The table renders the result.
9. **Keep game packages independently versionable.** A rules change in one game must
   never silently break another.
10. **Synchronize `artifacts/tabletop/docs/PROJECT_STATUS.md` when milestones change.**
11. **Require both engineering AND product validation before declaring a major phase
    complete.** Code passing tests is necessary but not sufficient.
12. **Stop and reassess when evidence contradicts the roadmap.** The roadmap is
    directional, not a work order. Presence in a future phase does not authorize
    automatic implementation.

---

## Reconciliation Notes (this revision)

- Completed work (Phases 1, 2, and Phase 3 sub-phases A–F-viewport plus milestone M1)
  is preserved exactly as implemented and tested; nothing was re-planned.
- `docs/PHASE3_IMPLEMENTATION_PLAN.md` remains the authoritative remaining-work plan
  for Phase 3; its M1–M6 milestones map directly onto this roadmap's Phase 3 items.
- **Ordering change:** the previous roadmap sequenced Ages of Empire (old Phase 5A)
  before the RPG (old Phase 5B). The canonical order is now RPG Mission System →
  RPG Vertical Slice → Ages of Empire.
- **Duration change:** Ages of Empire's earlier ~30–45 minute target is superseded by
  the canonical ~120 minutes (~100–135 validated). Session length is game-specific.
- The RPG mechanical direction previously sketched (d20 resolution, four attributes,
  class keywords, tactical systems list) is design input for Phase 5, subordinate to
  the Mission Contract + Escalation Graph architecture and the ~60-minute contract;
  its "explicitly deferred" mechanics list remains in force via What Not to Build and
  the progression constraints above.
