# Phase 3 — World Representation: Implementation Plan

**Produced:** 2026-08-17 · **Status:** PLANNING DOCUMENT — no implementation in this task
**Repository state inspected at:** `main` @ `8922ec9`

> ⚠️ **Critical correction to the task premise.** The planning request assumed
> "Phase 3: specification complete / implementation not started." The repository is
> authoritative, and it says otherwise: **Phase 3 implementation is well underway.**
> Sub-phases A through F-viewport of the WORLD_SCALE_VIEWPORT.md staged plan are
> implemented, tested (493 unit / 167 E2E), and committed. This plan therefore covers
> the *remaining* Phase 3 work, not a from-scratch build. Re-planning already-shipped
> systems would violate the roadmap's own governance rule 2 (preserve completed
> architectural decisions).

---

## 1. Current Architecture Findings

### What exists and is verified in code

| System | Location | Status |
|---|---|---|
| World coordinates (`wx`/`wy`) on combatants | `src/engine/content.ts` (Combatant, 21–46) | ✅ Implemented |
| `TileQueryFn` geometry abstraction | `src/engine/content.ts` (`mapDefToTileQuery`, 122–140) | ✅ Implemented — rules engine pathfinding/LOS/attacks consume `state.tileQuery` only |
| `ViewportState` (originWx/originWy/tileW/tileH) | `src/engine/viewport.ts` | ✅ Implemented — presentation-only, **not** in GameState |
| Dead-zone follow + recenter + clamping | `src/engine/viewport.ts` (`DEAD_ZONE_MARGIN = 3`) | ✅ Implemented |
| 40×40 large-map validation (`grandHall`) | `src/engine/content.ts` (316–334) | ✅ Implemented, E2E-covered |
| Chunk system (`CHUNK_W = CHUNK_H = 16`) | `src/engine/chunk.ts` | ✅ Implemented — residency states UNLOADED/LOADING/RESIDENT/PINNED, `ensureResident`, `ensureResidentAndPin`, `pin`/`unpin`, manual `evict`, immutable `ResidentGeometrySnapshot`, `snapshotToTileQuery` |
| World entities + registry | `src/engine/world.ts` — `WorldEntity` (immutable `worldId`), `WorldEntityRegistry`, `computePinSet`, `buildEncounterFromEntities`, `WorldState.beginEncounter`/`endEncounter` | ✅ Implemented **as engine API** (fully unit-tested) |
| Viewport streaming | `src/engine/viewportStreaming.ts` — `getChunksForViewport`, `prefetchViewportChunks`, `PREFETCH_MARGIN = 1` | ✅ Implemented, wired into the component (dormant for MapDef encounters) |
| Component streaming infrastructure | `src/IntelligentTabletop.tsx` — `worldStateRef`, `chunkVersion`, `loadingChunkSet`, prefetch `useEffect` | ✅ Implemented (dead path until world-backed encounters exist) |

### Answers to the required determinations (§3 A–P)

- **A/B. Board & tile:** `MapDef` (id, name, width/height, entrance, `pillars[]`, `visualAssets`) in `content.ts`; a "tile" is virtual — produced on demand by `TileQueryFn(wx, wy) → TileInfo`. There is no tile array.
- **C. Coordinates:** integer world coordinates `wx`/`wy` everywhere in the engine. Viewport-local coordinates are derived (`wx − originWx`) only at render/input boundaries.
- **D. Purely UI coordinates:** viewport-local vx/vy and pixel positions inside `IntelligentTabletop.tsx`. Never stored.
- **E. Already persistent:** combatant `wx`/`wy` ARE world coordinates. No migration needed — that was Phase A.
- **F/G. Entity identity:** `Combatant.id` (encounter-local) with optional `worldId`. World-backed conversion sets `id = worldId` (documented implementation convenience, Decision VP-5). Tokens map by `Combatant.id`.
- **H/I. GameState:** in `content.ts` (142–165). Must remain unchanged: `combatants`, `turnOrder`, `round`, `tileQuery`, `seed`, `log` — the entire authoritative core. Viewport/streaming must never enter it.
- **J/K. Viewport state:** React state in `IntelligentTabletop.tsx` (`VIEWPORT_TILE_W = 12`, `VIEWPORT_TILE_H = 10`); camera/dead-zone behavior exists and is E2E-tested.
- **L. Rendered cells:** `getVisibleTiles(viewport, tileQuery)` — only the 12×10 visible window is ever rendered (virtualized since Phase C).
- **M. Assets:** logical-ID registry (`src/assets/registry.ts`, `resolveAsset` with icon/CSS fallback). Fully independent of world representation. No changes needed.
- **N. Finite-board assumptions (remaining):** viewport clamping in the component uses `map.width/height`; `mapDefToTileQuery` treats out-of-bounds as void. Chunk-backed worlds have no explicit boundary model yet (Phase I).
- **O. Dimension-encoding tests:** `engine.test.ts` (8×6 and 40×40 assertions), `e2e/viewport-streaming.spec.ts` (40×40, 12×10 hardcoded), `chunk.test.ts` (16). These are *correct* regression anchors, not debt.
- **P. Affected by remaining work:** `IntelligentTabletop.tsx` (encounter transitions, world-backed picker), `src/intent/parser.ts` (still reads `state.map.pillars` directly at ~130/511 — a known latent issue), `world.ts` (eviction survival), `chunk.ts` (eviction policy).

---

## 2. Existing Systems to Reuse (do not duplicate)

Everything in §1's table. In particular: **do not** invent a new chunk model, coordinate utility, viewport model, or entity registry. The specification's Phase A–F contracts are locked (Decisions 21–28, VP-1–VP-5 in WORLD_SCALE_VIEWPORT.md §26).

## 3. Systems That Must Change (the actual remaining gap)

1. **Live gameplay is still 100% MapDef-backed.** `WorldState`/`beginEncounter`/`endEncounter` exist as tested engine APIs but are never constructed by the UI. `worldStateRef` is permanently null.
2. **No exploration mode.** The game boots directly into combat; there is no free-traversal state between encounters.
3. **No automatic eviction.** `ChunkStore.evict` is manual; nothing evicts RESIDENT chunks as the viewport moves away, and entity survival across eviction (the Phase 3 completion gate) is untested end-to-end.
4. **No world-edge model** for chunk-backed worlds (absent chunk → `"void"` is the only boundary).
5. **`src/intent/parser.ts` reads `state.map.pillars` directly** — breaks on chunk-backed geometry where `pillars` is empty. Must migrate to `state.tileQuery` before world-backed play.
6. **Viewport clamping assumes `map.width/height`** — needs a world-bounds source that works for both MapDef and chunk-backed worlds.

## 4. Proposed Phase 3 Architecture (remaining layers)

The required boundary already holds and is preserved unchanged:

```
GAME STATE (authoritative; content.ts/rules.ts — frozen contract)
    ↓ built from
WORLD STATE (world.ts — owns ChunkStore + WorldEntityRegistry)
    ↓ presents through
VIEWPORT STATE (viewport.ts + component React state)
    ↓ selects
VISIBLE WORLD REGION (getVisibleTiles + loadingChunkSet)
    ↓ renders on
TABLETOP (IntelligentTabletop.tsx)
```

New in the remaining work: a thin **session mode state machine** in the component —
`exploration ⇄ encounter` — that decides *which* of the two existing pipelines
(free traversal over WorldState vs. locked tactical GameState) is active. This is a
small explicit abstraction, not a framework: it is required by spec §13–14, is needed
only by `IntelligentTabletop.tsx`, cannot be an extension of GameState (viewport/mode
are presentational + world-level, not combat-authoritative), and deliberately does
NOT attempt to solve multiplayer, AI DM, or multi-game sessions.

## 5. Authoritative vs Presentational (unchanged, restated)

| Authoritative | Presentational |
|---|---|
| `GameState` (combatants, hp, turn order, seed, tileQuery snapshot) | `ViewportState`, `chunkVersion`, `loadingChunkSet` |
| `WorldState` (entity registry, committed hp/position/alive, chunk geometry) | Which chunks happen to be RESIDENT (cache state) |
| Encounter boundary commits (`endEncounter`) | Camera position, dead zone, animations |

Rule (already enforced by tests): viewport movement and chunk residency changes can never mutate GameState or WorldEntityRegistry.

## 6. World Coordinate Model — **decided, keep as-is**

Integer `wx`/`wy`; origin (0,0); +x right, +y down; negative coordinates fully supported (floor-division chunk math, unit-tested); tile identity = coordinate + generating chunk's deterministic output; MapDef worlds bounded by width/height, chunk worlds unbounded until Phase I adds explicit `WorldBounds`. No changes proposed.

## 7. Viewport Model — **decided, keep as-is**

12×10 tiles, dead-zone follow (margin 3), clamped to world bounds. Only remaining change: clamping must consult a `WorldBounds` source instead of `map.width/height` directly (Milestone 4).

## 8. Streaming / Chunking Recommendation

Keep the existing 16×16 `ChunkStore`. Add only:

- **Eviction policy (Milestone 2):** distance-based — evict RESIDENT (never PINNED/LOADING) chunks whose Chebyshev chunk-distance from the viewport exceeds `PREFETCH_MARGIN + 1`. Triggered after prefetch settles, not on a timer. Entity data is untouched by design (entities live in `WorldEntityRegistry`, not chunks) — eviction only discards geometry, which regenerates deterministically from `(worldSeed, cx, cy, generationVersion)`.
- No procedural content generation, no open world, no terrain variety work. Out of scope per the task and roadmap.

## 9. Migration Strategy

Continue the strategy already in force since Phase A: **adapter, not rewrite.**

- All existing MapDef encounters keep working through `mapDefToTileQuery` — untouched.
- World-backed play arrives as an *additional* path: a new world-backed encounter option constructs `WorldState`, seeds entities into the registry, and produces GameState via the existing `buildEncounterFromEntities`. The two paths share the entire rules engine unchanged.
- No compatibility adapters beyond the two `TileQueryFn` producers that already exist.

## 10. Test Strategy

Already covered (do not rewrite): coordinate creation/equality/translation, negative coordinates, viewport boundaries, world↔viewport conversion, chunk calculation, prefetch, encounter pin isolation, RNG isolation — 493 unit tests.

**New unit tests required:**
- Eviction policy: correct victim selection; PINNED/LOADING immunity; re-residency after return produces identical geometry (determinism across eviction).
- Entity survival: entity in evicted chunk retains registry state; `beginEncounter` in a previously-evicted region reproduces identical combatant state.
- Session mode machine: exploration→encounter locks viewport per `computePinSet`; encounter→exploration commits via `endEncounter` exactly once.
- WorldBounds: clamping parity between MapDef and chunk-backed worlds; edge rendering.
- Parser: `buildIntentContext` obstacle queries via tileQuery match previous pillar-based results on all existing encounters (regression parity).

**New E2E tests required:**
- Long-corridor traversal: walk a world-backed corridor > 3 chunks; tiles enter/leave; tabletop stays 12×10.
- Leave-and-return (the **Phase 3 completion gate**): traverse away far enough to force eviction, return, assert entity identity + hp + position are bit-identical.
- Exploration→encounter→combat→exploration full loop; combat regression mid-loop (attack/ability/end-turn all function).
- Viewport movement changes no gameplay state (extend existing isolation specs to the world-backed path).

**Regression anchors that must remain unchanged:** all 167 existing E2E tests and 493 unit tests, including the dimension-encoding assertions in `engine.test.ts`, `viewport-streaming.spec.ts`, `chunk.test.ts`.

## 11. Performance Strategy

Render boundary is already correct: 120 visible tiles + 1-chunk prefetch ring; rendering is virtualized; streaming is decoupled from GameState (VP-1/VP-2). Measurable criteria for remaining work:

- Resident chunk count bounded: ≤ (viewport chunks + margin ring) + pinned set, verified by a unit test after eviction runs.
- No React re-render on chunk load except the `chunkVersion` bump (existing pattern; extend test coverage to eviction).
- Exploration movement at 60fps target on tablet-class hardware — measured, not pre-optimized.

## 12. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Breaking working combat | World-backed path is additive; rules engine untouched; full existing suite is the regression gate |
| Stale geometry references after eviction | `ResidentGeometrySnapshot` is immutable and already documented to outlive eviction; encounters hold snapshots, never live store refs (Decision 27) |
| Entity loss during eviction | Entities never live in chunks (Decision 25); add explicit survival tests anyway |
| Parser breaks on chunk worlds | Milestone 3 migrates parser to tileQuery *before* world-backed play ships |
| Viewport state leaking into GameState | Locked decisions VP-1..VP-4 + existing isolation tests |
| Off-by-one at chunk/world edges | Property-style boundary tests exist for chunk math; extend to WorldBounds |
| Eviction thrash (load/evict oscillation at boundaries) | Hysteresis: evict at margin+1, prefetch at margin — one-chunk buffer |
| Future multiplayer/AI compatibility | Event-worthy mutations already flow through `WorldEntityRegistry` methods and `endEncounter` commits — a future event log wraps these seams; nothing built now |

## 13. Implementation Milestones (remaining Phase 3 work)

**M1 — Exploration mode + world-backed session (Phase G core).** ✅ **COMPLETE (2026-08-17)**
Objective: a playable world-backed session — construct `WorldState`, seed entities, free-traverse, viewport follows. Delivered: new `src/engine/exploration.ts` (session, live tile resolution, step movement, adjacent-hostile detection contract for M5) + component `sessionMode` ("encounter"/"exploration") with an "Explore World" toggle; the previously dormant `worldStateRef` prefetch/loading path is now live. M1 uses a fixed 64×64 exploration region and fixed world seed (generic WorldBounds remains M4). Tests: 20 unit (513 total) + 9 E2E (176 total), all pre-existing tests unmodified. Not included (unchanged scope): eviction (M2), encounters in world mode (M5).

**M2 — Eviction policy + entity survival (Phase G completion).**
Objective: distance-based eviction; leave-and-return determinism. Files: `chunk.ts` or small `evictionPolicy.ts`, `viewportStreaming.ts` hook-in. Tests: eviction unit suite + the completion-gate E2E. Not included: persistence to disk.

**M3 — Parser tileQuery migration.**
Objective: remove `state.map.pillars` reads from `src/intent/parser.ts`; parity-test against all existing encounters. (Independent; can run any time before M5.)

**M4 — WorldBounds + world edges (Phase I).**
Objective: explicit bounds model consumed by viewport clamping and tile rendering for both world types. Files: `viewport.ts`, `world.ts`, component clamping. Not included: soft edges, fog.

**M5 — Exploration → encounter → combat transitions (Phase H).**
Objective: proximity/trigger-based encounter detection in world mode; `beginEncounter` pins + locks viewport; combat runs on snapshot; `endEncounter` commits and resumes exploration. Files: component, `world.ts` trigger helper. Tests: full-loop E2E, commit-exactly-once unit tests. Not included: AI DM, narrative triggers.

**M6 — Performance validation + regression sweep (Phase J).**
Objective: measure criteria from §11, fix only what measurement demands; full suite + docs sync (`PROJECT_STATUS.md`, `ROADMAP.md` Phase 3 rows).

Dependency order: M1 → M2 → M5 → M6; M3 and M4 are parallel-safe after M1.

## 14. Acceptance Criteria (Phase 3 complete)

1. The completion-gate E2E passes: traverse out, force eviction, return, entities retain identity and authoritative state.
2. Full exploration→encounter→combat→exploration loop works in a world-backed session.
3. All pre-existing tests pass unmodified.
4. Parser has zero direct MapDef geometry reads.
5. No entity position is ever derived from tabletop/UI coordinates (already enforced; re-verified).

## 15. Files Expected to Change

`src/IntelligentTabletop.tsx`, `src/engine/world.ts`, `src/engine/chunk.ts` (or new `evictionPolicy.ts`), `src/engine/viewportStreaming.ts`, `src/engine/viewport.ts`, `src/intent/parser.ts`, `src/engine/content.ts` (world scenario), new test files, docs.

## 16. What Must NOT Change

`src/engine/rules.ts` (combat authority), the `GameState` shape, `TileQueryFn` contract, chunk coordinate math, `ResidentGeometrySnapshot` semantics, locked Decisions 21–28 / VP-1–VP-5, the asset registry, and all existing passing tests.

## 17. Recommended First Implementation Task

**Milestone 1** — exploration mode + world-backed session. It is the smallest change that makes `WorldState` live, unblocks every other milestone, and immediately exercises the already-built (currently dormant) streaming path in the component.
