# Phase 3 Architecture Preflight
## Specification Validation Against Actual Implementation

**Date:** 2026-08-16  
**Baseline commit:** `8d86434` (97 unit tests, 97 pass; TypeScript clean)  
**Instruction:** Do not implement. Validate and advise only.

---

## A. Specification Validation — What Is Architecturally Sound

1. **Three-space coordinate model (§3) is correctly designed.** World Space (authoritative), Chunk Space (derived/loading abstraction), Viewport Space (presentation only) are cleanly separated. The invariant table in §3.5 is precise and internally consistent. Chunk coordinates correctly derived from world coordinates rather than stored on entities.

2. **TileQueryFn decoupling (§5.4, §18.3) is the right boundary.** Replacing `MapDef`-based tile lookups with `TileQueryFn(wx, wy) → TileInfo` correctly insulates the rules engine from ChunkStore, WorldState, and React. The adapter pattern (`mapDefToTileQuery`) preserves backward compatibility.

3. **Rules engine isolation holds.** `chebyshev()` is already purely mathematical and coordinate-agnostic. `validateAttack()`, `validateAbility()`, `endTurn()`, `checkEncounterStatus()` are already entity-ID-based and require no structural changes. The spec correctly identifies that only tile-lookup call sites change, not validation logic.

4. **ViewportState correctly categorized as transient presentation state (§4.1, §6.1).** The decision table and the architectural flow diagram (§4.2) are sound. `ViewportState` must never be written to `GameState` — this is correctly stated as a hard invariant.

5. **Dead-zone anti-jitter rules (§7.4) are sufficiently concrete.** Minimum move distance, direction-change suppression, debounce for rapid movement, and tactical-lock priority are all actionable as-written. No ambiguity.

6. **Chunk lifecycle state machine (§11.3)** is correct. UNLOADED → LOADING → RESIDENT ↔ DIRTY → UNLOADED. The conservative fallback rule (unloaded tiles return `{ passable: false, blocksLOS: true, type: "void" }`) is the right default for rules-engine safety.

7. **Deterministic chunk generation with mutation-only persistence (§11.5, §17.7)** is sound. Save files are `(worldSeed, ChunkMutationLog[])` rather than full terrain — small, correct, and resumable.

8. **Rendering boundary (§18.1) is layered correctly.** World Model → Viewport Logic → Renderer. The renderer receives precomputed `VisibleTile[][]` and does not own world queries. This is exactly the right separation.

9. **Asset system (§21) requires no changes.** The existing registry and `resolveAsset()` pattern is preserved without modification. Correct.

10. **Phase ordering (A→J) is logically sequenced.** Each phase is a proper prerequisite for the next. Phase A's "no user-visible change" constraint is enforceably testable against the existing 97 unit + 133 E2E test baseline.

11. **AI DM position (§22) is architecturally correct.** AI produces `EnvironmentDescription`; world generator converts it to `ChunkGenerationRules`; deterministic engine produces tiles. AI never reads ViewportState or writes entity positions directly. This boundary is sound.

---

## B. Specification Contradictions

### B.1 — CRITICAL: `MapDef.walls` does not exist in the implementation

The spec's §2 "Current Data Model" shows:
```typescript
interface MapDef {
  width:   number;
  height:  number;
  walls:   [number, number][];
  pillars?: [number, number][];
}
```

The **actual** `MapDef` in `src/engine/content.ts` is:
```typescript
interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  entrance: { x: number; y: number };   // ← not in spec
  pillars: { x: number; y: number }[];  // non-optional; different shape
  visualAssets?: { floor?: string; wall?: string; pillar?: string };  // ← not in spec
}
```

There is **no `walls` array**. Walls are entirely implicit: `isWall()` returns `true` for any border tile (`x=0`, `x=width−1`, `y=0`, `y=height−1`) **except** the `entrance` coordinate. This is a fundamentally different wall model than the spec describes. The `mapDefToTileQuery()` adapter in Phase A must be written against the actual `isWall()`/`isPillar()` logic — not against a non-existent `walls` array.

**Additional discrepancies in §2:**
- Both maps are **8×6**, not "8×8 (Training Yard), 10×8 (Ruined Crypt)" as stated in §2.
- `GameState` in the actual code has `started: boolean`, `encounterName: string`, and `initiativeRolls: InitiativeEntry[]` — all absent from the spec's §2 model.

### B.2 — HIGH: `TileInfo.blocksLOS` loses the pillar/wall distinction

The spec's proposed `TileInfo` interface:
```typescript
interface TileInfo {
  passable:  boolean;
  blocksLOS: boolean;
  type:      "floor" | "wall" | "pillar" | "void" | "door_open" | "door_closed";
}
```

The current `lineOfSight()` in `rules.ts` makes a **precise distinction**:
- Walls → `blocked = true` (LOS fully blocked)
- Pillars → `cover = true` (LOS not blocked, but target has cover = +2 AC)

If Phase A rewrites `lineOfSight()` to use `tileAt(wx, wy).blocksLOS`, one of two incorrect outcomes results:
- If pillars have `blocksLOS: true` → LOS is blocked through pillar (cover mechanics disappear; attacks are invalid when they should only have cover)
- If pillars have `blocksLOS: false` → pillar provides no signal to `lineOfSight()` at all (cover mechanics disappear entirely)

Either way, the existing cover mechanic breaks silently on the first Phase A test run.

### B.3 — MEDIUM: `WorldState.activeEncounterState: GameState | null` creates a synchronization hazard

§4.3 defines:
```typescript
interface WorldState {
  ...
  activeEncounterState: GameState | null;
}
```

But §12.4 says the rules engine queries `WorldState` entity store by `worldId`, and §14.1 says results are "applied back to WorldState" after combat resolves. This implies two possible interpretations:

- **Interpretation A:** `GameState` lives *inside* `WorldState`. During combat, both `GameState.combatants[id].wx/wy` and `WorldState.entityState[worldId].wx/wy` are present. Every move must update both — or one is stale.
- **Interpretation B:** `GameState` lives *alongside* `WorldState`. During combat, `GameState.combatants` is the sole authority; `WorldState.entityState` is not updated until `endEncounter()` is called.

The spec's `WorldState` definition embeds `activeEncounterState: GameState | null` — implying Interpretation A. But the text of §14.1 describes a batch write at encounter end — implying Interpretation B. These are mutually contradictory.

### B.4 — MINOR: §7.3 tactical viewport table contains an unreachable row

The row "Enemy action in exploration: No viewport shift" implies enemies can act in exploration mode. But §13.1 explicitly states exploration has "No initiative order, no action economy." Enemies do not act in exploration. The row is vacuously true but confusing to an implementor.

---

## C. Missing Decisions

### C.1 — `worldId ↔ Combatant.id` mapping (blocks Phase G)

The spec introduces `WorldEntity.worldId` (e.g., `"goblin_crypt_3"`) and separately `Combatant.id` (currently `instanceId`, e.g., `"goblin1"`). The spec never defines how these relate during an active encounter:

- Does `Combatant.id` equal `WorldEntity.worldId`? Or is there a foreign-key field (`Combatant.worldId: string`)?
- When `buildEncounter()` constructs `GameState.combatants`, what is the key for each combatant?
- After combat ends, how does the result-write-back code locate the `WorldEntity` corresponding to each `Combatant`?

This decision affects initiative ordering, UI labeling, combat-log references, and the `endEncounter()` ceremony. It must be made before Phase G, and ideally declared in Phase A so downstream phases can rely on it.

**Recommended decision:** Add `Combatant.worldId?: string` in Phase A as an optional field (undefined for test fixtures and encounter-only combatants that have no WorldState counterpart). Set it at `buildEncounter()` time when creating combatants from `WorldEntity` records.

### C.2 — Which is authoritative during combat: `GameState.combatants` or `WorldState.entityState`?

When both `GameState` and `WorldState` hold entity data during an active encounter, there must be exactly one writer for any given field during the encounter duration. The spec does not state this explicitly.

**Recommended decision:** During an active encounter, `GameState.combatants` is the sole authority for all combat-participant state (position, HP, alive, actionUsed, etc.). `WorldState.entityState` is frozen for those entities until `endEncounter()` is called. `WorldState.entityState` remains authoritative for off-screen non-participant entities. `endEncounter()` performs a one-time batch write.

### C.3 — PC positions between encounters (blocks Phase G/H)

In the current system, PC positions only exist inside `GameState.combatants`, which only exists during a tactical encounter. Between encounters there is no `GameState`. The spec introduces exploration mode but never defines where PC world positions live between encounters.

**This must be decided before Phase H.** Options:
- `WorldState.entityState` holds PC `WorldEntity` records, updated at `endEncounter()` and mutated incrementally during exploration movement.
- A separate `PartyState { members: Record<string, { wx: number; wy: number }> }` alongside `WorldState`.

**Recommended decision:** PCs are full `WorldEntity` records in `WorldState.entityState`, always present (not just during combat). Exploration movement writes directly to `WorldState.entityState[pcWorldId].wx/wy`.

### C.4 — `WorldModel` TypeScript interface is not defined (blocks Phase F)

Phase F says "Replace bounded `MapDef` with `WorldModel` using `ChunkStore`" but never defines what `WorldModel` exposes. Key open questions:

- Is `TileQueryFn` constructed from `WorldModel` synchronously? It **must** be synchronous for the rules engine.
- How does `WorldModel` guarantee that all tiles within a combatant's move radius are in RESIDENT chunks before the rules engine is called?
- Is `ChunkStore.evict()` the authority for the "never evict a chunk containing a combat participant" invariant? If so, how does ChunkStore know which entities are combat participants?

Phase F **cannot begin** without this interface defined.

### C.5 — `GameState.map` fate in Phase F (blocks Phase F)

Today `GameState.map: MapDef` is embedded in game state and shared by reference in `cloneState()`. In Phase F, `MapDef` is replaced by a world-level tile source. Two options:

- **Option A:** Replace `GameState.map: MapDef` with `GameState.tileQuery: TileQueryFn`. `cloneState()` shares `tileQuery` by reference (same semantics as current `map` sharing). All rules-engine call sites receive `state.tileQuery` rather than constructing it externally.
- **Option B:** Remove `map` from `GameState` entirely. The caller provides `TileQueryFn` as an explicit parameter to rules functions alongside `GameState`.

Option A is strongly preferred — it keeps the rules-function signatures (`state: GameState`) stable and avoids threading `TileQueryFn` through every call site. Option B requires every caller to manage the tile source separately, which creates coupling.

### C.6 — Encounter population: which WorldEntities become combatants? (blocks Phase H)

Currently `ENCOUNTER_DEFS` explicitly enumerates all combatants. In the world-scale system, encounters trigger when the party enters a zone. Who decides which `WorldEntity` records become `GameState.combatants`?

- All living entities within the encounter bounding box?
- All entities belonging to a named encounter group?
- All entities within a defined trigger radius?

This decision determines how `buildEncounter()` is refactored in Phase H, and what data `WorldState.entityState` must store per entity to support this query.

### C.7 — React integration of `ViewportState`: `useState` vs `useRef`, `useEffect` timing (blocks Phase D)

§6.6 says viewport recenter is "triggered only at stable state (after `setGameState` resolves)." In React, "stable state" is not a synchronous event — concurrent mode may batch updates. The spec does not specify:

- Whether `viewportState` is `useState` (drives re-render) or `useRef` (no re-render).
- Whether viewport recenter runs in a `useEffect([gameState])` or in the same event handler that produces the new `GameState`.

`ViewportState` must be `useState` because it drives tile rendering (which tiles are displayed). The recenter computation must run in a `useEffect` that fires after `gameState` has settled — not inside the action handler that produced the new state. This avoids double-renders and ensures the viewport update sees the final committed combatant positions.

### C.8 — `cloneState()` and a mutable `TileQueryFn` (blocks Phase F)

Current `cloneState()` shares `state.map` by reference because `MapDef` is immutable. After Phase F, `state.tileQuery` is a closure over `ChunkStore` — which is mutable. If `cloneState()` shares `tileQuery` by reference, then two clones of the same `GameState` see different tile data after a chunk mutation between clone and use. This is subtle and hard to debug.

**Required invariant:** `TileQueryFn` must be a pure snapshot function: given the same `(wx, wy)`, it always returns the same `TileInfo` for the lifetime of the `GameState` it was created alongside. Chunk mutations must create a **new** `TileQueryFn` rather than mutating the data structure the existing function closes over. This implies ChunkStore must be treated as immutable from the rules engine's perspective (copy-on-write, or versioned snapshots).

---

## D. Recommended Architecture

### D.1 Coordinate rename (Phase A)

`Combatant.x/y` → `Combatant.wx/wy`. All rules-function internal variables follow. The `key()` function receives `wx/wy` after the rename — no change to the function body itself. `occupiedSet()` changes `key(c.x, c.y)` → `key(c.wx, c.wy)`.

```typescript
// After Phase A rename
interface Combatant {
  wx: number;          // world coordinate x — authoritative
  wy: number;          // world coordinate y — authoritative
  worldId?: string;    // foreign key into WorldState.entityState; undefined for test fixtures
  // all other fields unchanged
}
```

### D.2 Corrected `TileInfo` interface

Add `providesCover: boolean` to resolve the pillar/wall distinction (B.2):

```typescript
interface TileInfo {
  passable:      boolean;   // false = wall, pillar, void, unloaded
  blocksLOS:     boolean;   // true = wall; false = pillar, floor, door_open
  providesCover: boolean;   // true = pillar only; used by lineOfSight() cover calculation
  type: "floor" | "wall" | "pillar" | "void" | "door_open" | "door_closed";
}
```

`lineOfSight()` becomes:
```typescript
// inside lineOfSight() — replaces isWall/isPillar checks:
if (tileAt(t.wx, t.wy).blocksLOS)     blocked = true;
if (tileAt(t.wx, t.wy).providesCover) cover   = true;
```

### D.3 `mapDefToTileQuery` adapter — correct implementation

Must be written against the **actual** `isWall()`/`isPillar()` logic, not the spec's `walls[]` description:

```typescript
function mapDefToTileQuery(map: MapDef): TileQueryFn {
  return (wx: number, wy: number): TileInfo => {
    // Out of map bounds → void
    if (wx < 0 || wy < 0 || wx >= map.width || wy >= map.height)
      return { passable: false, blocksLOS: true, providesCover: false, type: "void" };

    // Border tiles are walls except the entrance
    const border = wx === 0 || wx === map.width - 1 || wy === 0 || wy === map.height - 1;
    if (border && !(wx === map.entrance.x && wy === map.entrance.y))
      return { passable: false, blocksLOS: true, providesCover: false, type: "wall" };

    // Pillars provide cover but don't block movement or LOS
    if (map.pillars.some(p => p.x === wx && p.y === wy))
      return { passable: false, blocksLOS: false, providesCover: true, type: "pillar" };

    return { passable: true, blocksLOS: false, providesCover: false, type: "floor" };
  };
}
```

Note: pillars are `passable: false` (cannot move through them) but `blocksLOS: false` and `providesCover: true`. This exactly matches the current behavior.

### D.4 `GameState` after Phase A

```typescript
interface GameState {
  started:         boolean;
  encounterId:     string;
  encounterName:   string;
  map:             MapDef;       // Phase A: kept; Phase F: replaced by tileQuery
  round:           number;
  turnOrder:       string[];
  initiativeRolls: InitiativeEntry[];
  turnIndex:       number;
  combatants:      Record<string, Combatant>;   // Combatant now has wx/wy
  log:             string[];
  seed:            number;
  // Phase F addition:
  // tileQuery:    TileQueryFn;  // replaces map when ChunkStore is introduced
}
```

### D.5 Authoritative-state boundary

```
┌─────────────────────────────────────────────────────┐
│  BETWEEN ENCOUNTERS (Exploration Mode)               │
│  WorldState.entityState is authoritative for all     │
│  entities including PCs.                             │
└──────────────────────────┬──────────────────────────┘
                           │  buildEncounter() — one-time read
┌──────────────────────────▼──────────────────────────┐
│  DURING ENCOUNTER (Tactical Mode)                    │
│  GameState.combatants is authoritative for all       │
│  combat participants (positions, HP, actionUsed,     │
│  alive). WorldState.entityState is frozen for        │
│  those entities. WorldState remains authoritative    │
│  for off-screen non-participants.                    │
└──────────────────────────┬──────────────────────────┘
                           │  endEncounter() — one-time batch write
┌──────────────────────────▼──────────────────────────┐
│  POST-ENCOUNTER                                      │
│  Dead entities removed from WorldState.entityState.  │
│  Surviving entities' wx/wy/hp written back.          │
│  GameState is discarded. WorldMode = "exploration".  │
└─────────────────────────────────────────────────────┘
```

`WorldState` does **not** embed `GameState`. They are parallel structures that communicate only at encounter begin and end.

### D.6 `ViewportState` React integration (Phase D)

```typescript
// ViewportState as React state — drives re-render
const [viewportState, setViewportState] = useState<ViewportState>(initialViewport);

// Viewport recenter runs AFTER game state settles
useEffect(() => {
  if (!gameState) return;
  const actor = gameState.combatants[gameState.turnOrder[gameState.turnIndex]];
  if (!actor) return;
  setViewportState(prev => maybeRecenter(prev, { wx: actor.wx, wy: actor.wy }, DEAD_ZONE_MARGIN));
}, [gameState]);

// tileW and tileH are derived, never stored in ViewportState
const tileW = useMemo(() => Math.floor(boardPixelWidth / cellPx),  [boardPixelWidth, cellPx]);
const tileH = useMemo(() => Math.floor(boardPixelHeight / cellPx), [boardPixelHeight, cellPx]);
```

---

## E. Phase A–J Changes

### Corrections to Phase A

1. **`mapDefToTileQuery()` must use actual border/entrance logic** — not `MapDef.walls[]` (see B.1, D.3). Update the spec's §2 to reflect the actual `MapDef` before anyone writes adapter code.

2. **`TileInfo` must include `providesCover`** before Phase A is implemented (see B.2, D.2). This is a prerequisite, not an add-on.

3. **`occupiedSet()` must use `c.wx`/`c.wy`** after the rename. The spec's §5.4 table does not call this out. Add it explicitly to Phase A's change list.

4. **`isWall()`, `isPillar()`, `isBlocked()` must remain exported** in Phase A. They are used by `contentValidation.ts` (`validateAllContent()`), which must not break. These functions stay as MapDef-specific helpers; rules functions switch to `TileQueryFn`.

5. **`lineTiles()` uses `{x, y}` parameters** — it's a pure geometry function. In Phase A it should either be renamed to use `{wx, wy}` (cleaner) or left as-is since it has no semantic attachment to either coordinate system. Explicit rename is preferred to prevent future confusion.

### Addition: Phase A.5 (between A and B)

- Document the `key()` → `worldKey()` transition. The function body is unchanged but rename it to signal that it now receives world coordinates. Update all call sites.
- Decision checkpoint: confirm `Combatant.worldId?: string` scope before Phase B proceeds.

### Addition: Phase F.0 (before F)

Define `WorldModel` TypeScript interface. Specifically:
- What `ChunkStore` exposes to construct a synchronous `TileQueryFn`.
- The invariant guarantee: all tiles within any combat participant's move radius are in RESIDENT chunks.
- How chunk mutations are versioned so that `cloneState()` shares a stable `tileQuery`.

Without this definition, Phase F cannot be implemented correctly.

### Corrections to Phase B

- Specify that `ViewportState` is `useState` in React, that `tileW`/`tileH` are `useMemo` derived values, and that `centerSmallMap()` may produce a negative `originWx`/`originWy` — which is valid for the viewport but must produce `"void"` tiles from `TileQueryFn` (not `"wall"` tiles from `isWall()`).

### Corrections to Phase D

- Specify that viewport recenter runs in `useEffect([gameState])`, **not** inside the event handler that produced the new `GameState`. This prevents mid-animation snaps and double-renders.

### Reorder: Phase G before Phase H

The spec orders G (Persistent World/Entity State) before H (Exploration → Encounter Transition). This is correct. Do not reverse. Phase H depends on the PC-position-in-WorldState mechanism established in Phase G.

---

## F. Implementation Risks

### Risk 1 — HIGH: MapDef.walls misconception produces a silently broken adapter

An implementor reading only the spec's §2 will write `mapDefToTileQuery()` that iterates over `map.walls[]`. This field does not exist. The adapter will compile (TypeScript will not error on accessing an undefined optional field — it will be `undefined`), produce no wall tiles, and the BFS will immediately escape map bounds.

**Consequence:** All movement validation breaks. The map becomes fully open terrain with no walls. This will not be caught until an E2E test runs — which passes through the adapter path.

**Mitigation:** Update spec §2 before Phase A starts. Require implementor to read the actual `isWall()` source before writing the adapter.

### Risk 2 — HIGH: Cover mechanics silently break in Phase A

If `TileInfo.providesCover` is not added, `lineOfSight()` has no way to identify pillars as cover. The test for cover in `validateAttack()` — `const v = validateAttack(state, actor, target); if (v.cover) effectiveAc += 2` — will always see `cover: false`. Every attack through a pillar tile will be at full AC rather than +2 AC.

**Consequence:** Existing unit tests `lineOfSight: "cover flag set when pillar is between attacker and target"` will fail in Phase A. But if that test is not specific about the cover value (only about validity), it might pass even though the cover bonus is lost at higher layers.

**Mitigation:** Add `providesCover: boolean` to `TileInfo` before Phase A implementation begins.

### Risk 3 — HIGH: Dual-write during combat (GameState + WorldState both store positions)

If the chosen design keeps entity positions in both `GameState.combatants[id].wx/wy` AND `WorldState.entityState[worldId].wx/wy` during combat (the spec's §4.3 structure implies this), every `executeMove()` must update both. `cloneState()` does not know about `WorldState`. Missing one update creates silent split-brain: the rules engine sees the right position while the world model sees the wrong one.

**Consequence:** Chunk eviction decisions (based on `WorldState.entityState[*].wx/wy`) would use stale positions. The "never evict a chunk containing a combat participant" invariant could fire incorrectly.

**Mitigation:** Adopt the architecture in §D.5: `WorldState` is frozen for combat participants during an encounter. GameState is the sole writer. No dual-write.

### Risk 4 — MEDIUM: `cloneState()` sharing a mutable `TileQueryFn`

After Phase F, if `ChunkStore` is mutated (new chunk loaded, mutation applied), any `TileQueryFn` that closes over it changes behavior retroactively. A `cloneState()` clone that holds a reference to the same `TileQueryFn` now sees different tile data than when it was created — breaking the determinism of speculative execution and proposal revalidation.

**Consequence:** `revalidateProposal()` and `executeProposalSteps()` may produce different results depending on which chunks happen to be loaded at call time. This is non-deterministic and untestable.

**Mitigation:** `TileQueryFn` must be a pure snapshot (copy-on-write ChunkStore, or a committed `Map<string, TileInfo>` snapshot passed to the rules engine at each turn boundary). Never let the rules engine see a live mutable store.

### Risk 5 — MEDIUM: Negative viewport origins require TileQueryFn to return `"void"`, not `"wall"`

`centerSmallMap(8, 6, 14, 12)` returns `originWx = -3`. The renderer will request tile data at `wx = -3, -2, -1`. The `mapDefToTileQuery()` adapter returns `{ type: "void" }` for out-of-bounds coordinates. But if any code path still calls `isWall(map, -3, y)` directly (rather than `tileAt(-3, y)`), it returns `true` (out-of-bounds = wall). The visual result is: the three leftmost viewport columns show wall tiles instead of void/empty.

**Consequence:** Small maps centered in a large viewport have wall-colored margins rather than void-colored margins. This is a visual bug that won't break rules-engine behavior, but it will be confusing.

**Mitigation:** After Phase A, all tile-type queries within rendering code must go through `TileQueryFn`. Grep for direct `isWall()`/`isPillar()` calls in rendering code as part of Phase A review.

### Risk 6 — MEDIUM: `runEnemyAI()` needs a `TileQueryFn` source in Phase F

`runEnemyAI()` calls `reachableTiles(state.map, ...)`. After Phase A rename, this becomes `reachableTiles(tileAt, ...)`. But where does `runEnemyAI()` get `tileAt`? Currently it receives only `(state, actorId, rng)`. After Phase F, it needs the world's tile query.

If `GameState.tileQuery` is adopted (Option A in §C.5), `runEnemyAI()` uses `state.tileQuery` naturally. If not, every caller of `runEnemyAI()` — including `resolveLeadingEnemyTurns()` — must also be updated to pass `tileAt`.

**Consequence:** If this is not resolved in Phase A's design, Phase F will require a second round of signature changes across all call sites.

**Mitigation:** Embed `TileQueryFn` in `GameState` (Phase F), and update `runEnemyAI()`, `executeMove()`, `reachableTiles()`, and `lineOfSight()` to read from `state.tileQuery`. This keeps all tile queries colocated with state.

### Risk 7 — LOW: `isWall`/`isPillar`/`isBlocked` deleted prematurely

Phase A may tempt an implementor to delete `isWall()`/`isPillar()`/`isBlocked()` since rules functions will no longer call them. But `contentValidation.ts` currently calls `isBlocked(map, x, y)` directly for spawn coordinate validation. Deleting these functions breaks the content validator.

**Consequence:** `validateAllContent()` throws at runtime; the unit test `"reports zero errors for all production content definitions"` fails.

**Mitigation:** Keep `isWall()`, `isPillar()`, `isBlocked()` exported from `rules.ts` in Phase A. Mark with a JSDoc comment: "MapDef-specific helper — used by contentValidation.ts. Rules engine now uses TileQueryFn instead." Delete only after Phase G introduces a WorldModel-aware content validation path.

---

## G. Go/No-Go

### Verdict: **GO WITH CHANGES**

Implementation can begin on Phase A after the following three decisions are resolved. These require 1–2 hours of documentation/design work, no code:

---

**Required before Phase A coding starts:**

**Decision 1 (D.2):** Add `providesCover: boolean` to `TileInfo`. Without this, `lineOfSight()` cannot distinguish pillar cover from wall blockage after the adapter is in place. Cover mechanics silently break.

**Decision 2 (B.1):** Update spec §2 to reflect the actual `MapDef` structure — `entrance: {x, y}`, no `walls[]`, both maps are 8×6. The `mapDefToTileQuery()` adapter must be written against the real `isWall()`/`isPillar()` logic. This is documentation-only but prevents the highest-risk implementation error.

**Decision 3 (C.1):** Declare whether `Combatant.worldId?: string` is added in Phase A or deferred to Phase G. Either answer is correct. An undeclared answer leads to Phase G redesigning types that Phase A–F code already deployed against.

---

**Required before Phase F coding starts (do not block Phase A–E):**

**Decision 4 (C.4):** Define `WorldModel` TypeScript interface: what it exposes, whether chunk generation is synchronous (required for rules engine), and how the "no eviction of combat-participant chunks" invariant is enforced.

**Decision 5 (C.5):** Choose Option A (embed `GameState.tileQuery: TileQueryFn`) or Option B (pass `TileQueryFn` as explicit parameter to each rules function). Document the decision. Option A is strongly preferred.

**Decision 6 (C.6):** Define how encounter population works — which `WorldEntity` records become `GameState.combatants` when an encounter triggers. This determines the `buildEncounter()` refactor scope for Phase H.

---

**Phases A through E are implementable without Phases F–J decisions.** The architecture is correctly layered so that each phase can be validated against the existing test suite before the next begins. The coordinate rename (Phase A) and viewport abstraction (Phases B–D) do not depend on `WorldModel`, `ChunkStore`, or `WorldState` existing.

The three blocking decisions above are small and well-scoped. None require new architectural invention — they require choices between options that are already outlined in this document.

---

_End of Phase 3 Architecture Preflight._  
_Status: ANALYSIS ONLY — no implementation changes made._
