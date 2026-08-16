# World Scale & Fixed Tabletop Viewport System
## Technical Specification — Phase 3

**Status:** SPECIFICATION ONLY — no implementation has occurred.
**Phase 2 baseline:** commit `7f35369` (93 unit tests, 148 E2E tests, TypeScript clean)
**Canonical principle:** _"The Table Is Fixed. The World Is Not."_

---

## Table of Contents

1. [Purpose and Core Principle](#1-purpose-and-core-principle)
2. [Current System Summary](#2-current-system-summary-implemented-today)
3. [Coordinate Systems](#3-coordinate-systems)
4. [Authoritative State vs Presentation State](#4-authoritative-state-vs-presentation-state)
5. [Grid and World Coordinates](#5-grid-and-world-coordinates)
6. [Viewport Model](#6-viewport-model)
7. [Viewport Movement and Follow Model](#7-viewport-movement-and-follow-model)
8. [Small Areas](#8-small-areas)
9. [Large Areas](#9-large-areas)
10. [Long Corridors and Continuous Environments](#10-long-corridors-and-continuous-environments)
11. [World Regions and Chunks](#11-world-regions-and-chunks)
12. [Entity Persistence](#12-entity-persistence)
13. [Exploration Mode vs Tactical Mode](#13-exploration-mode-vs-tactical-mode)
14. [Encounter Transition](#14-encounter-transition)
15. [Combat in Large Environments](#15-combat-in-large-environments)
16. [World Edges](#16-world-edges)
17. [Performance](#17-performance)
18. [Rendering Architecture](#18-rendering-architecture)
19. [Input and Interaction](#19-input-and-interaction)
20. [Responsive Tabletop](#20-responsive-tabletop)
21. [Asset System](#21-asset-system)
22. [AI DM Future Integration](#22-ai-dm-future-integration)
23. [Failure and Edge Cases](#23-failure-and-edge-cases)
24. [Test Strategy](#24-test-strategy)
25. [Implementation Phases](#25-implementation-phases)
26. [Architectural Decisions](#26-architectural-decisions)

---

## 1. Purpose and Core Principle

### The Intended Experience

The tabletop is a **fixed physical surface** — like a real game table. It has a finite, stable size. It does not grow, shrink, or scroll as a unit. When a player sits down at a table, the table does not move.

The **world** represented on that table is under no such constraint. A dungeon corridor can be 300 tiles long. A battlefield can span 200×150 tiles. A cathedral nave can dwarf any map the current renderer could show at once.

The player perception goal is:

> **"The world comes to the table."**

Not: "the camera scrolls across the world." The world region relevant to the current moment is _presented_ on the table. As the party advances, new world becomes visible. Previously seen terrain may leave the visible surface. But it continues to exist in authoritative world coordinates. Nothing about the table changed — a different portion of the world is now on it.

### What This Is Not

This is **not** merely a CSS scroll or viewport pan trick. It is a **world-representation architecture**:

- The world has a persistent coordinate system independent of the table.
- Entities in the world have stable identities independent of whether they are currently visible.
- The rules engine always operates on authoritative world coordinates.
- Rendering is a read-only projection of a portion of the world onto the fixed table surface.

---

## 2. Current System Summary (IMPLEMENTED TODAY)

This section describes what currently exists. Everything else in this document is planned/specification only.

### Current Data Model

```typescript
// src/engine/content.ts — CURRENT (implemented)

interface MapDef {
  width:   number;           // tile count, x-axis
  height:  number;           // tile count, y-axis
  walls:   [number, number][];
  pillars?: [number, number][];
}

interface Combatant {
  id:            string;     // stable instance ID ("orc1", "fighter")
  x:             number;     // tile x — 0-based, integer
  y:             number;     // tile y — 0-based, integer
  hp:            number;
  maxHp:         number;
  alive:         boolean;
  moveRemaining: number;
  actionUsed:    boolean;
  // ...weapon, abilities, type, cls, icon, defId, etc.
}

interface GameState {
  seed:          number;
  encounterId:   string;
  encounterName: string;
  map:           MapDef;
  round:         number;
  turnOrder:     string[];
  turnIndex:     number;
  combatants:    Record<string, Combatant>;
  log:           string[];
}
```

### Current Coordinate System

Today's coordinate system is **local map coordinates**:

- Origin at `(0, 0)` — top-left tile of the map.
- `x` increases rightward, `y` increases downward.
- Tile identity: `key(x, y) → "${x},${y}"` (integer string).
- All maps fit entirely on the visible tabletop surface — no scrolling exists.
- `MapDef.width` × `MapDef.height` is the complete world extent. Current maps: 8×8 (Training Yard), 10×8 (Ruined Crypt).

### Current Rules Engine Functions

```typescript
// src/engine/rules.ts — CURRENT (implemented)

chebyshev(a, b)                     // max(|dx|, |dy|) — Chebyshev distance
reachableTiles(map, start, move, occ) // BFS over MapDef bounds
lineOfSight(map, from, to)           // Bresenham ray, walls block
isWall(map, x, y)                    // looks up MapDef.walls
isPillar(map, x, y)                  // looks up MapDef.pillars
executeMove(state, actorId, dest)    // validates + applies move
validateAttack(state, actorId, targetId)
executeAttack(state, actorId, targetId, rng)
validateAbility(state, actorId, abilityId, targetId)
executeAbility(state, actorId, abilityId, targetId, rng)
```

All rules functions receive `GameState` or its `map: MapDef` subfield. They have no knowledge of viewport position, CSS cell size, or screen coordinates.

### Current Limitations

| Limitation | Impact |
|---|---|
| Maps are bounded by `MapDef.width × height` | No corridor can be longer than the map |
| All tiles are pre-defined in the map definition | No streaming or generation |
| The entire map is always rendered | No culling; will not scale to large maps |
| `Combatant.x/y` are local to the current encounter map | No persistent world coordinates |
| No exploration mode — only tactical encounters | No between-combat traversal |

---

## 3. Coordinate Systems

Three coordinate spaces are defined. Only **World Space** is authoritative.

### 3.1 World Space (Authoritative)

```
WorldCoord = { wx: number, wy: number }
```

- Integer tile coordinates, unbounded in any direction.
- Negative coordinates are valid: `(-20, -5)` is a tile northwest of origin.
- `(0, 0)` is a chosen world origin — typically the start of the dungeon level, a town square, or any other fixed anchor.
- An entity at `(142, 37)` remains at `(142, 37)` **regardless of viewport position, zoom level, or screen size**.
- World coordinates are the **only** coordinates that the rules engine ever reads or writes.
- World coordinates are persistent — they survive round trips through save/load, chunk unloading, and entity state changes.

### 3.2 Chunk Space (Derived, PLANNED)

```
ChunkCoord = { cx: number, cy: number }

CHUNK_SIZE = 16  // tiles per chunk edge; TBD, see §11

toChunkCoord(wx, wy) = { cx: Math.floor(wx / CHUNK_SIZE),
                         cy: Math.floor(wy / CHUNK_SIZE) }
```

- Chunking is a **loading and caching** abstraction, not an authoritative coordinate system.
- An entity's world coordinate does not change when chunk boundaries are crossed.
- Chunk coordinates are derived from world coordinates; they are never stored on entities.

### 3.3 Viewport Space (Presentation Only, PLANNED)

```
ViewportState = {
  originWx: number,   // world x of the top-left visible tile
  originWy: number,   // world y of the top-left visible tile
  tileW:    number,   // how many tiles are visible horizontally
  tileH:    number,   // how many tiles are visible vertically
}
```

- Viewport state is **transient presentation state** — not in `GameState`.
- Changing the viewport never changes any world coordinate or rules-engine state.
- The rules engine is never passed viewport state; it only receives world coordinates.

### 3.4 Coordinate Transform Chain (PLANNED)

```
World Space
    │
    │  viewport transform: subtract (originWx, originWy)
    ▼
Viewport-relative logical tiles
    │  (vx = wx - originWx, vy = wy - originWy)
    │
    │  pixel transform: multiply by cellPx
    ▼
Screen pixels
    │
    │  (input: divide screen coords by cellPx, add viewport origin)
    ▼
World Space                         (for click/tap → world tile mapping)
```

`cellPx` is **always** a rendering concern owned by the React layer. It never enters world or viewport logic.

### 3.5 Invariant Table

| Invariant | Requirement |
|---|---|
| Entity world position | Unchanged by viewport movement |
| Tile identity | `(wx, wy)` uniquely identifies a world tile forever |
| Rules engine input | Always world coordinates, never screen/viewport coords |
| Viewport origin | Presentation state; not serialized in GameState |
| Chunk coord of entity | Derived from `(wx, wy)`, never stored |

---

## 4. Authoritative State vs Presentation State

### 4.1 Decision Table

| State | Belongs In | Rationale |
|---|---|---|
| Entity world position `(wx, wy)` | `GameState` / authoritative | Rules engine writes it; determines legality |
| Entity HP, alive, actionUsed, etc. | `GameState` / authoritative | Rules engine reads/writes |
| Active actor (`turnIndex`) | `GameState` / authoritative | Rules engine advances turns |
| Combat state (round, log) | `GameState` / authoritative | Persistent across renders |
| Encounter identity (encounterId) | `GameState` / authoritative | Used to restore encounter |
| World seed | `GameState` / authoritative | Deterministic generation |
| **Viewport origin** `(originWx, originWy)` | **Presentation state** | Never affects legality |
| **Visible tile bounds** | **Presentation state** | Derived from viewport origin |
| **Loaded chunk set** | **Presentation state / cache** | Evictable without state loss |
| **Exploration path history** | **Persistent world state** (separate from `GameState`) | Needed for fog-of-war |
| **Open/closed doors** | **Persistent world state** | World mutation, not encounter-scoped |
| **Looted containers** | **Persistent world state** | World mutation |
| **Chunk terrain data** | **World model** (generated/loaded) | Not in encounter GameState |

### 4.2 The Architectural Rule

```
GameState
    ↓  (read by)
Rules engine            ← determines legality, executes moves, resolves combat
    ↓  (produces)
New GameState           ← immutable update; rules engine is the only writer
    ↓  (read by)
Viewport logic          ← decides what to display; read-only view of GameState
    ↓  (feeds)
Renderer                ← converts world tiles to screen pixels
```

The viewport **cannot** gate or modify rules-engine execution. Moving the viewport does not advance the game. Failing to render a tile does not remove it from the world.

### 4.3 Persistent World State (Future, PLANNED)

Beyond encounter-scoped `GameState`, a future `WorldState` layer is needed:

```typescript
// PLANNED — does not exist yet
interface WorldState {
  worldId:     string;
  seed:        number;
  exploredTiles: Set<string>;      // "wx,wy" keys
  entityState:   Record<string, PersistentEntityRecord>;
  mutatedTiles:  Record<string, TileMutation>;  // doors, traps, etc.
  activeEncounterId: string | null;
  activeEncounterState: GameState | null;
}
```

`WorldState` is separate from `GameState`. A tactical encounter runs inside `WorldState`; when it ends, the results are applied back to `WorldState` (dead entities removed, looted containers marked, etc.).

---

## 5. Grid and World Coordinates

### 5.1 Coordinate Properties

- **Integer only.** No sub-tile positions. An entity always occupies exactly one tile.
- **Unbounded.** Any integer pair `(wx, wy)` is a valid world coordinate.
- **Chebyshev metric.** Distance between tiles remains `max(|Δwx|, |Δwy|)` in world coordinates. This is unchanged from the current `chebyshev()` function — it simply receives world coords instead of local coords.
- **Adjacency.** The 8 neighboring tiles of `(wx, wy)` are `(wx±1, wy)`, `(wx, wy±1)`, and the four diagonals. This is unchanged.

### 5.2 Negative Coordinates

Negative coordinates are valid world tiles. A dungeon may have rooms west of the origin (`wx < 0`) or above it (`wy < 0`). The key function must handle negatives:

```typescript
// PLANNED — replacement for key()
function worldKey(wx: number, wy: number): string {
  return `${wx},${wy}`;  // negative numbers serialize correctly: "-3,5"
}
```

The existing `key(x, y)` already does this — negative numbers produce distinct strings. No change to the function is needed, only to what coordinate system feeds it.

### 5.3 Large Coordinates

Coordinates like `(142, 37)` or `(−8800, 3200)` are valid. JavaScript integers are safe up to `2^53 − 1`. No overflow risk for any reasonable world size. Coordinates do not need to be clamped or range-checked by the rules engine.

### 5.4 Impact on Existing Rules Engine Functions

| Function | Change Required | Notes |
|---|---|---|
| `chebyshev(a, b)` | **None** — already math-only | Works at any scale |
| `lineOfSight(map, from, to)` | **Signature change** — map becomes a region/tile lookup | Must query a world tile provider instead of a fixed `MapDef` |
| `reachableTiles(map, start, move, occ)` | **Signature change** — same reason | BFS still valid; tile lookup becomes world-aware |
| `isWall(map, x, y)` | **Signature change** — becomes `isWall(world, wx, wy)` | World tile provider returns tile type |
| `isPillar(map, x, y)` | **Signature change** | Same |
| `executeMove` | **Minimal** — must pass world coords | Rules unchanged |
| `validateAttack` | **None** — already coordinate-agnostic | Uses `chebyshev` + `lineOfSight` |
| `validateAbility` | **None** | Same |

The critical insight: **validation logic does not change**. Only the tile-lookup mechanism changes — from `MapDef.walls[…]` to a world-aware tile query. The rules engine should be given a tile-query interface, not a full `WorldState`:

```typescript
// PLANNED — interface the rules engine receives
interface TileQueryFn {
  (wx: number, wy: number): TileInfo;
}

interface TileInfo {
  passable:   boolean;
  blocksLOS:  boolean;
  type:       "floor" | "wall" | "pillar" | "void" | "door_open" | "door_closed";
}
```

### 5.5 Movement at World Scale

`reachableTiles` performs BFS. At world scale, it must query world tiles. BFS is bounded by `moveRemaining` (currently 3–5 tiles), so it never explores more than ~25 tiles regardless of world size. Performance remains O(moveRemaining²) — no concern.

Range calculations (`validateAttack`, `validateAbility`) use `chebyshev` — O(1), unchanged.

Line-of-sight uses Bresenham's algorithm — O(max range) ≈ O(8) for current weapons. Unchanged.

### 5.6 Map Boundaries

Current maps have hard boundaries (`x < 0 || x >= width || y < 0 || y >= height → wall`). At world scale:

- Tiles beyond a region boundary may be:
  - **Unloaded** (chunk not resident): treated as impassable for movement, blocked LOS (conservative fallback).
  - **Void** (genuine world edge): impassable, visually distinct.
  - **Loaded** in an adjacent chunk: seamlessly passable.

The rules engine must not crash or produce incorrect results when querying an unloaded tile. The tile query function should return a safe default (`{ passable: false, blocksLOS: true, type: "void" }`) for unloaded coordinates.

---

## 6. Viewport Model

### 6.1 Viewport State (PLANNED)

```typescript
// PLANNED — transient presentation state, never in GameState
interface ViewportState {
  originWx: number;    // world x of top-left visible tile
  originWy: number;    // world y of top-left visible tile
  tileW:    number;    // visible tile columns (depends on screen width / cellPx)
  tileH:    number;    // visible tile rows    (depends on screen height / cellPx)
}
```

The viewport is **always** derived from two things: the world origin `(originWx, originWy)` and the screen/cell size. `tileW` and `tileH` are computed, never stored independently:

```typescript
// PLANNED — derived at render time
const tileW = Math.floor(boardPixelWidth  / cellPx);
const tileH = Math.floor(boardPixelHeight / cellPx);
```

### 6.2 Visible World Bounds

Given `ViewportState`:

```
visibleMinWx = originWx
visibleMaxWx = originWx + tileW - 1
visibleMinWy = originWy
visibleMaxWy = originWy + tileH - 1
```

A world tile `(wx, wy)` is **visible** iff:
```
originWx ≤ wx ≤ originWx + tileW - 1
originWy ≤ wy ≤ originWy + tileH - 1
```

A world entity at `(wx, wy)` maps to viewport-relative tile `(wx - originWx, wy - originWy)`.

### 6.3 World-to-Pixel Transform

```typescript
// PLANNED — rendering transform
function worldToPixel(wx: number, wy: number, vp: ViewportState, cellPx: number) {
  return {
    px: (wx - vp.originWx) * cellPx,
    py: (wy - vp.originWy) * cellPx,
  };
}
```

`cellPx` is owned by the React render layer. It is never stored in `ViewportState`.

### 6.4 Logical Viewport Size

The tabletop's **logical size in tiles** should have a defined target range:

| Context | Target tile columns | Target tile rows |
|---|---|---|
| Desktop (≥1100px) | 12–16 | 10–14 |
| Tablet landscape (768–1099px) | 10–12 | 8–10 |
| Tablet portrait (<768px) | 8–10 | 8–12 |

These targets guide `boardPixelWidth` and `boardPixelHeight` budgets — they are **not** hardcoded. Actual values depend on `cellPx`, which already varies by breakpoint.

### 6.5 Margins and Dead Zones

The viewport defines an inner **follow zone** — the region within which the active actor can move without the viewport recentering:

```
Dead zone: inner rect, edges set N tiles from viewport border

Recommended initial values:
  dead_zone_margin = 3   (tiles from each edge)

deadZoneMinWx = originWx + dead_zone_margin
deadZoneMaxWx = originWx + tileW - dead_zone_margin - 1
deadZoneMinWy = originWy + dead_zone_margin
deadZoneMaxWy = originWy + tileH - dead_zone_margin - 1
```

While the active actor's world position is inside the dead zone, the viewport does not move. When the actor crosses the dead-zone boundary, a viewport recenter is triggered.

### 6.6 Recentering Behavior

When recenter is triggered:

1. Compute the desired center: the active actor's world position, or the party centroid (see §7).
2. Compute the target `(originWx, originWy)` so that position is centered in the viewport.
3. Snap immediately (no animation) in tactical mode; optionally animate in exploration mode.
4. Clamp to world bounds if a finite boundary is known (see §16).

Recentering must not happen mid-animation or mid-combat resolution — it is triggered only at stable state (after `setGameState` resolves).

---

## 7. Viewport Movement and Follow Model

### 7.1 Exploration Mode Follow

In exploration mode, the viewport follows the **party centroid** — the average world position of all living PCs:

```typescript
function partyCentroid(combatants: Combatant[]): WorldCoord {
  const pcs = combatants.filter(c => c.type === "pc" && c.alive);
  const wx = Math.round(pcs.reduce((s, c) => s + c.wx, 0) / pcs.length);
  const wy = Math.round(pcs.reduce((s, c) => s + c.wy, 0) / pcs.length);
  return { wx, wy };
}
```

The viewport recenters on the centroid when any PC moves outside the dead zone.

### 7.2 Tactical Mode Follow

During tactical combat, the viewport follows the **active actor** exclusively (not the centroid):

- The viewport does not drift while the player is targeting or choosing actions.
- If the active actor's move would carry them outside the dead zone, the viewport recenters after the move resolves (not during animation).
- If an enemy moves outside the visible viewport, the viewport follows the enemy's action result — the player must be able to see what the enemy did.

### 7.3 Cases

| Situation | Viewport Behavior |
|---|---|
| Actor inside dead zone | No movement |
| Actor crosses dead-zone edge | Recenter on actor |
| Actor moves backward | Recenter if they cross dead zone again |
| Actor moves diagonally | Recenter triggered by chebyshev crossing of dead zone boundary |
| Actor moves continuously in one direction | Recenter triggers once per move if each move crosses dead zone |
| Multiple PCs, exploration | Follow party centroid |
| Multiple PCs, tactical | Follow active actor |
| Active actor far from party | Tactical: follow actor; party panels remain visible on left/right |
| Enemy action in exploration | No viewport shift (enemies don't act in exploration) |
| Enemy action in tactical | Viewport follows enemy to show their action |
| Party splits | Exploration: follow centroid; may leave some PCs off-screen (future FOW) |

### 7.4 Anti-Jitter Rules

- **Minimum move distance:** A recenter must move the viewport by at least `dead_zone_margin` tiles. Tiny moves that barely cross the dead zone must not cause a 1-tile viewport shift.
- **No snap on direction change:** Changing direction within the dead zone does not trigger a recenter.
- **Debounce in rapid movement:** If multiple moves occur in quick succession (e.g., enemy AI resolving several moves), batch the viewport update to the final position only.
- **Tactical lock priority:** Once tactical mode is established, the viewport does not move unless an entity actually moves (not just because the turn order changes).

---

## 8. Small Areas

**Definition:** An environment where the entire map fits within the visible viewport (`mapWidth ≤ tileW AND mapHeight ≤ tileH`).

**Behavior:**

- The viewport origin is fixed at `(0, 0)` (or the map's world origin, adjusted to center the map on the tabletop).
- No scrolling occurs.
- The tabletop behaves exactly as it does today — a traditional tactical board with the whole map visible.
- The dead-zone mechanism is still present but never triggers.
- Current encounters (Training Yard 8×8, Ruined Crypt 10×8) are small-area encounters.

**Centering small maps:**

```typescript
// PLANNED — center a small map within the visible viewport
function centerSmallMap(mapW: number, mapH: number, tileW: number, tileH: number): ViewportState {
  return {
    originWx: Math.floor((mapW - tileW) / 2),  // negative if mapW < tileW → map is left of center
    originWy: Math.floor((mapH - tileH) / 2),
    tileW,
    tileH,
  };
}
```

**Invariant:** In small-area mode, all existing E2E tests must continue to pass without modification.

---

## 9. Large Areas

**Definition:** An environment where `mapWidth > tileW OR mapHeight > tileH`. The entire environment cannot fit on the tabletop at once.

**Examples:**
- Large chamber: 30×25 tiles
- Cathedral nave: 20×60 tiles
- Courtyard: 40×40 tiles

**Behavior:**

- Viewport is initialized centered on the party's starting position.
- Viewport follows the party/actor per the dead-zone model (§7).
- Terrain outside the visible viewport is not rendered (culled).
- The world outside the viewport still exists — entities, doors, and terrain are persistent.
- The player may not freely reposition the viewport independently of the party (Phase A–D implementation). Free camera pan is a future option (Phase E+).

**At finite world edges (large but bounded):**
- The viewport is clamped so it cannot show tiles beyond `(0, 0)` to `(worldW−1, worldH−1)`.
- If the world is smaller than the viewport in one dimension, that dimension behaves like a small-area (centered, no scroll).

---

## 10. Long Corridors and Continuous Environments

This is the primary motivating use case for Phase 3.

### 10.1 Example Scenario

```
World: a dungeon corridor from (0, 5) to (120, 5), width 3 tiles (y: 4–6).
Party: starts at (0, 5).
Tabletop: displays 12 × 10 tiles.

Initial viewport: originWx=0, originWy=0, tileW=12, tileH=10.

After party moves to (14, 5):
  Dead zone crossed → viewport recenters.
  New origin: (8, 0) [actor at column 6 of 12].

After party moves to (100, 5):
  Viewport origin: (94, 0).
  Tiles (0–93, 4–6) are no longer in the viewport.
  They still exist in world state.
  If the party reverses to (5, 5), they reappear exactly as before.
```

### 10.2 Continuous Perception

The player must perceive a **single continuous corridor**, not a series of screens. This requires:

1. **No artificial boundaries** — the corridor does not end at `mapWidth`. It ends where the world ends.
2. **Seamless chunk transitions** — as the viewport crosses a chunk boundary, the new chunk's tiles are already loaded (prefetched) and appear without any visual gap or loading indicator.
3. **Persistent terrain** — a torch sconce at `(30, 5)` that the player saw earlier is still there if they return. It was not procedurally regenerated.
4. **Persistent environmental state** — a door at `(45, 5)` that was opened stays open when the party returns.

### 10.3 Streaming Model

DOM elements do **not** move indefinitely. The renderer always renders a fixed grid of `tileW × tileH` DOM elements. The **content** of each DOM element changes as the viewport origin changes:

```
Viewport shows tiles (8–19, 0–9):
  DOM[0][0] renders world tile (8, 0)
  DOM[1][0] renders world tile (9, 0)
  ...

Viewport shifts to (10–21, 0–9):
  DOM[0][0] now renders world tile (10, 0)
  DOM[2][0] now renders world tile (12, 0)
  ...
```

Only `tileW × tileH` tile DOM nodes ever exist. The world coordinates they display change. This is equivalent to a "virtualized list" but for a 2D grid.

### 10.4 Entity and State Persistence Across Scrolling

| Object | Leaves Viewport | Returns | State |
|---|---|---|---|
| Corridor floor tiles | Not rendered | Re-rendered from world data | Unchanged |
| Opened door at (45,5) | Not rendered | Re-rendered | Still open |
| Dead goblin at (30,5) | Not rendered | Re-rendered | Still dead |
| Looted chest at (60,5) | Not rendered | Re-rendered | Still looted |
| Alive but off-screen goblin at (80,5) | Not rendered | Re-rendered | HP/state preserved |

---

## 11. World Regions and Chunks

### 11.1 Purpose

Chunks are a **loading and caching abstraction** for large worlds. They are NOT authoritative data structures. Tile and entity world coordinates do not change when chunk boundaries are crossed.

### 11.2 Chunk Dimensions (PLANNED)

```
CHUNK_SIZE_TILES = 16    // 16×16 tile chunks — TBD, subject to profiling

ChunkCoord = { cx: Math.floor(wx / CHUNK_SIZE_TILES),
               cy: Math.floor(wy / CHUNK_SIZE_TILES) }
```

Rationale for 16×16:
- Small enough that chunk loading is granular.
- Large enough that the viewport (12×10 tiles) typically spans only 1–4 chunks.
- Power of 2 simplifies alignment math.

### 11.3 Chunk Lifecycle

```
State machine per chunk:

UNLOADED ──generate/load──→ LOADING ──→ RESIDENT ──evict──→ UNLOADED
                                           │
                                           └──dirty──→ DIRTY (needs persistence)
```

- **UNLOADED:** No data in memory. World coordinates in this chunk return safe defaults (impassable, void).
- **LOADING:** Async generation or fetch in progress. Treat as UNLOADED for rules.
- **RESIDENT:** Tile and entity data available. Renders normally.
- **DIRTY:** World mutations (opened doors, killed entities) not yet persisted. Must not be evicted without saving.

### 11.4 Chunk Set Management

```
Loaded chunk strategy:

  VISIBLE region:     chunks overlapping current viewport (always RESIDENT)
  PREFETCH ring:      chunks adjacent to visible set (LOADING → RESIDENT)
  CACHE ring:         chunks one step beyond prefetch (may stay RESIDENT)
  EVICT threshold:    chunks beyond cache ring (RESIDENT → UNLOADED)

Typical set sizes (with 12×10 tile viewport, 16×16 chunks):
  Visible chunks: ~2×2 = 4
  Prefetch ring:  ~4×4 = 16 (minus visible = 12)
  Cache ring:     ~6×6 = 36 (minus prefetch = 20)
  Total resident: ≤36 chunks = ≤9216 tiles
```

### 11.5 Chunk Identity and Determinism

Each chunk has a **deterministic identity** based on:

```
ChunkId = hash(worldId, cx, cy, worldSeed)
```

Given the same inputs, a chunk always generates the same terrain. This means:
- Chunks can be re-generated on demand rather than stored.
- Only **mutations** (opened doors, dead entities, etc.) need persistent storage.
- Save files are small: `(worldSeed, ChunkMutationLog[])` rather than full terrain.

### 11.6 Chunk Boundary Behavior

When the viewport crosses a chunk boundary:
1. The new chunk's prefetch starts immediately (one move ahead of the boundary).
2. The new chunk's tiles become available before the viewport reaches them.
3. No visual gap or loading screen appears.
4. Entities in the incoming chunk are present from the moment the chunk is RESIDENT.

### 11.7 What Chunks Are NOT

- Chunks are **not** separate game states or encounter instances.
- Chunks do **not** own entity identity — entities are world-level objects that happen to occupy a chunk.
- Chunks are **not** rendered DOM elements — the renderer maps viewport-relative tile positions to chunk data, but chunks have no 1:1 DOM correspondence.

---

## 12. Entity Persistence

This section defines how entities maintain identity outside the visible viewport.

### 12.1 Entity Identity

Every entity has a **stable world ID** assigned at world creation or encounter generation. This ID is:

```typescript
// PLANNED
interface WorldEntity {
  worldId:    string;       // e.g. "goblin_corridor_12" — never changes
  wx:         number;       // world coordinate x — authoritative
  wy:         number;       // world coordinate y — authoritative
  defId:      string;       // references CombatantDef template
  hp:         number;
  maxHp:      number;
  alive:      boolean;
  state:      Record<string, unknown>;   // door open, chest looted, etc.
  // ...
}
```

The entity's `worldId` never changes. It is not reassigned when a chunk is evicted and reloaded.

### 12.2 Scenario: Entity Leaves and Returns to Viewport

```
Goblin A: worldId="goblin_crypt_3", wx=142, wy=37, hp=8, alive=true

Step 1: Party moves away. Goblin A leaves viewport.
Step 2: Goblin A's chunk is evicted (data written to WorldState).
Step 3: Party returns.
Step 4: Goblin A's chunk is reloaded.
Step 5: Goblin A reappears at (142, 37) with hp=8, alive=true.
        worldId is still "goblin_crypt_3".
        This is NOT a new entity.
```

### 12.3 Persistence Rules by Entity Type

| Entity / Object | When Off-Screen | On Return |
|---|---|---|
| Alive enemy | Preserved in WorldState | Restored with current HP |
| Dead enemy | Preserved as dead | Rendered as corpse or omitted |
| Opened door | Mutation record in WorldState | Rendered open |
| Looted chest | Mutation record | Rendered looted |
| Moved PC | PC positions always in GameState | Always known |
| Trap (triggered) | Mutation record | Rendered triggered |
| Changed terrain | Mutation record | Rendered changed |

### 12.4 Combat and Off-Screen Entities

During tactical combat, the rules engine may reference entities that are off-screen (e.g., a rogue who moved into a corridor that left the tactical viewport). Invariant:

> **An entity's world position is always accessible regardless of viewport.**

The rules engine queries the `WorldState` entity store by `worldId`, not by viewport visibility. Off-screen entities fully participate in combat if the encounter definition includes them.

### 12.5 Save/Load in a Streamed Region

When saving:
1. All DIRTY chunks write their mutation logs.
2. Active encounter's `GameState` is serialized.
3. `ViewportState` is **not** saved — it is reconstructed on load from party position.

When loading:
1. Load `WorldState` (seed + mutation logs).
2. Load active `GameState` (encounter state).
3. Reconstruct `ViewportState` centered on the active actor.
4. Begin loading chunks for the visible region.

---

## 13. Exploration Mode vs Tactical Mode

### 13.1 Definitions

**Exploration Mode** — the party moves through the world between encounters:

- Viewport can move freely (follows party).
- No initiative order, no action economy.
- Large environments can stream continuously.
- New world space is discoverable.
- No combat legality checks.

**Tactical Mode** — a combat encounter is active:

- Viewport is stabilized (see §15 for edge cases).
- Initiative order is active; `GameState.turnOrder` governs action.
- Movement and attack validation are in effect.
- Viewport does not drift unexpectedly.
- Tactical decisions must not be interrupted by involuntary viewport movement.

### 13.2 Mode State

```typescript
// PLANNED
type WorldMode = "exploration" | "tactical";
```

`WorldMode` is **not** part of `GameState`. It is part of the broader application state (alongside `ViewportState`). The rules engine always operates in "tactical" semantics (validation, turn order) — the mode distinction affects only the UI and viewport behavior.

### 13.3 Mode Transition Triggers

| Trigger | Transition |
|---|---|
| Party enters an encounter zone | Exploration → Tactical |
| All enemies defeated (encounter victory) | Tactical → Exploration |
| Party retreats (encounter abandoned) | Tactical → Exploration |
| Party enters a new level/area | Exploration continues |

### 13.4 Mode Invariant

> In tactical mode, the rules engine's authority over movement and targeting is **never relaxed** regardless of viewport state. An entity off-screen can still be attacked if within weapon range and line of sight (from world coordinates).

---

## 14. Encounter Transition

### 14.1 Full Transition Flow

```
EXPLORATION
    │
    │  Party enters encounter trigger zone at world position (wx_e, wy_e)
    ▼
ENCOUNTER DETECTED
    │  System determines relevant tactical area:
    │    - all enemy positions (world coords)
    │    - party positions (world coords)
    │    - bounding box of encounter + margin
    ▼
TACTICAL AREA ESTABLISHED
    │  ViewportState updated to show encounter area:
    │    - viewport centers on encounter centroid
    │    - dead zone set to "tactical" (tighter margins)
    │    - no further viewport drift during setup
    ▼
VIEWPORT STABILIZED
    │  Encounter GameState created:
    │    - combatants initialized with world positions
    │    - initiative rolled
    │    - WorldMode = "tactical"
    ▼
COMBAT BEGINS
    │  Turn loop runs; all rules engine logic operates on world coords
    │  Viewport follows active actor per §7.2 tactical rules
    ▼
COMBAT RESOLVES (victory or defeat)
    │  Results applied to WorldState:
    │    - dead enemies removed from WorldState.entities
    │    - mutations recorded (looted, opened, etc.)
    │    - GameState cleared
    │    - WorldMode = "exploration"
    ▼
EXPLORATION RESUMES
    │  Viewport returns to party-centroid follow mode
    ▼
(continue)
```

### 14.2 Encounter Near Viewport Edge

If an encounter trigger fires when the party is near the tabletop edge:

1. The viewport recenters on the encounter bounding box centroid — this takes priority over party position.
2. If the encounter bounding box is larger than the viewport, the viewport is positioned to show as many combatants as possible (maximize visible combatants, prefer PC side).
3. Terrain between the PCs and the nearest enemy must always be visible at encounter start.

### 14.3 Surrounding Terrain Inclusion

The tactical area includes:

```
Encounter bounding box = MinRect(all entity world positions)
Tactical viewport padding = max(6, weapon.range + 2) tiles on each side

Tactical viewport origin centers on bounding box with padding included.
```

If the padded area exceeds the viewport, center on the PCs (they have agency; enemies are secondary).

### 14.4 Post-Combat Viewport

After combat resolves, the viewport transitions back to exploration follow mode. No jump or snap — the viewport is already correctly positioned from combat (which followed the active actor). It simply resumes following the party centroid.

---

## 15. Combat in Large Environments

### 15.1 The Problem

A giant battlefield (200×150 tiles) cannot fit on the tabletop. The encounter contains 20+ enemies scattered across the map. The player must be able to fight while:

- Seeing their active PC and nearby enemies.
- Not seeing terrain irrelevant to their immediate decision.
- Understanding what enemies outside the viewport are doing when they act.

### 15.2 Tactical Viewport Strategy

```
Viewport focus during tactical combat:

  PC's turn: viewport centers on active PC (dead zone applies)
  Enemy's turn: viewport shifts to show the enemy's action result
               (where the enemy moved to, what they attacked)
```

### 15.3 Combatants at Viewport Edge

If a combatant moves toward the viewport edge:

1. If the move crosses the dead zone boundary, viewport recenters after the move.
2. The viewport never recenters during a move — only after the authoritative state change.

### 15.4 Out-of-Viewport Enemy Targeting

If an enemy outside the current viewport targets a PC:

1. Viewport temporarily shifts to show the enemy's position and the target.
2. After the action resolves, viewport returns to the active actor (if it's a PC's next turn).

This ensures players are never surprised by damage from an invisible source.

### 15.5 Invariant

> **The viewport never determines combat legality.** If a PC can attack an off-screen enemy (within weapon range and LOS by world coordinates), that attack is valid regardless of whether the target is currently visible. The viewport may shift after the action to show the result.

---

## 16. World Edges

### 16.1 Types of Boundaries

| Boundary Type | Description | Viewport Behavior |
|---|---|---|
| **Finite world boundary** | Known hard edge (e.g., island perimeter) | Viewport clamps; player cannot see beyond |
| **Generated boundary** | Procedurally generated terrain ends here; more exists | Prefetch triggers generation of next chunk |
| **Unexplored boundary** | Terrain exists but has not been generated for this world | Rendered as fog/void; triggers generation on approach |
| **True void** | No world exists here (outside the defined world) | Rendered as void tiles; impassable |

### 16.2 Distinguishing Void from Unloaded

The system must distinguish:

- **"There is no world here"** — true void. Tile query returns `{ type: "void", passable: false, blocksLOS: true }`. Rendered as darkness/abyss.
- **"The world exists but is not loaded"** — unloaded chunk. Tile query returns the same safe default during loading, but the chunk is being fetched/generated. Once RESIDENT, the tile query returns real data.

An entity must never be able to move into a void tile. An entity can move into an unloaded tile's position only after the chunk becomes RESIDENT (movement validation treats unloaded as impassable).

### 16.3 Viewport at a Finite Boundary

```typescript
// PLANNED — viewport origin clamping
function clampViewportOrigin(
  origin: WorldCoord,
  tileW: number,
  tileH: number,
  worldBounds: { minWx, maxWx, minWy, maxWy } | null
): WorldCoord {
  if (!worldBounds) return origin;  // infinite world — no clamping
  return {
    wx: Math.max(worldBounds.minWx, Math.min(worldBounds.maxWx - tileW + 1, origin.wx)),
    wy: Math.max(worldBounds.minWy, Math.min(worldBounds.maxWy - tileH + 1, origin.wy)),
  };
}
```

---

## 17. Performance

### 17.1 Visible Region

| Quantity | Budget |
|---|---|
| Max visible tiles (desktop) | 16 × 14 = 224 |
| Max visible tiles (tablet landscape) | 12 × 10 = 120 |
| Max DOM tile elements | Same as visible tiles (virtualized) |
| Max rendered entity tokens | ≤ all combatants in the visible viewport |

The renderer must only create DOM elements for visible tiles. There is no case where the full world map is rendered at once.

### 17.2 Loaded Region

```
RESIDENT chunks ≤ 36 chunks = 9,216 tiles (see §11.4)
```

Tile data for resident chunks is held in a flat `Map<string, TileInfo>` keyed by world coordinate string (`"wx,wy"`). Entity data is in a `Map<string, WorldEntity>` keyed by `worldId`.

### 17.3 Prefetch Region

Prefetch begins when the viewport origin is within `CHUNK_SIZE_TILES / 2` tiles of a chunk boundary. This gives the generator one move's lead time.

### 17.4 Eviction Distance

Chunks beyond the cache ring (more than 3 chunks from the visible edge in any direction) are candidates for eviction. DIRTY chunks are written before eviction.

### 17.5 Entity Lookup

Entities are looked up by world position during rendering (finding which token occupies a tile):

```typescript
// PLANNED — O(1) per tile lookup
const entityByPosition = new Map<string, WorldEntity>();  // keyed by worldKey(wx, wy)
```

Rebuilding this index after each state change: O(entity count) ≤ O(100) for any reasonable encounter.

### 17.6 React Re-Render Avoidance

- `ViewportState` changes (origin shifts) must be batched — a single move produces exactly one `setViewportState` call after the authoritative state update.
- Tiles outside the viewport are not in the React tree — no re-render cost for them.
- Chunk loading is async; the React component is notified only when a chunk becomes RESIDENT and its tiles are now in the viewport.
- Use `useMemo` for: visible tile array, entity-by-position index, viewport bounds. Invalidate only when `viewportState` or `gameState` changes.

### 17.7 Deterministic Generation

Chunk generation is **synchronous and deterministic** given `(worldSeed, cx, cy)`. This means:

- No async delays for terrain that was previously generated (it can be regenerated in-frame).
- Mutations (doors, dead entities) are applied on top of the generated base.
- Generation cost: O(CHUNK_SIZE²) = O(256) operations per chunk — negligible.

---

## 18. Rendering Architecture

### 18.1 Layer Responsibilities

```
┌──────────────────────────────────────────────────────────┐
│  WORLD MODEL (PLANNED)                                    │
│  - WorldState: entities, mutations, seed                 │
│  - Chunk store: terrain data                             │
│  - WorldEntity records                                   │
│  Responsibility: world truth. Does not know about pixels. │
└──────────────────────┬───────────────────────────────────┘
                       │  read-only
┌──────────────────────▼───────────────────────────────────┐
│  VIEWPORT LOGIC (PLANNED)                                 │
│  - ViewportState: origin, tileW, tileH                   │
│  - Follow/recenter logic                                  │
│  - Visible tile query: visibleTiles(vp, world)           │
│  Responsibility: what is visible. Does not know cellPx.  │
└──────────────────────┬───────────────────────────────────┘
                       │  visible tile array + entity list
┌──────────────────────▼───────────────────────────────────┐
│  RENDERER (EXISTS TODAY — will be extended)               │
│  - React component: IntelligentTabletop.tsx              │
│  - cellPx: responsive pixel size                         │
│  - CSS grid: tileW × tileH DOM elements                  │
│  - Resolves assets via registry                          │
│  Responsibility: pixels, DOM, CSS. Does not own world.   │
└──────────────────────────────────────────────────────────┘
```

### 18.2 Visible Tile Query (PLANNED)

```typescript
// PLANNED — pure function, no side effects
function getVisibleTiles(
  vp: ViewportState,
  tileQuery: TileQueryFn,
  entityIndex: Map<string, WorldEntity>
): VisibleTile[][] {
  // Returns a tileH × tileW array of VisibleTile objects
  // Each VisibleTile: { wx, wy, tileInfo, entity: WorldEntity | null }
}
```

The renderer receives this array and maps it to DOM. It does not call `tileQuery` directly — it only receives pre-computed `VisibleTile` objects.

### 18.3 Rules Engine Integration (PLANNED)

The rules engine receives a `TileQueryFn` instead of a `MapDef`. This is the only change to its interface:

```typescript
// TODAY (CURRENT)
function reachableTiles(map: MapDef, start: Coord, move: number, occ: Set<string>): Coord[]

// PLANNED
function reachableTiles(tileAt: TileQueryFn, start: WorldCoord, move: number, occ: Set<string>): WorldCoord[]
```

The BFS algorithm inside `reachableTiles` is unchanged. Only the tile-passability check changes from `isWall(map, x, y)` to `tileAt(wx, wy).passable`.

### 18.4 What the Renderer Does Not Own

| The renderer does NOT: |
|---|
| Store world coordinates of entities |
| Decide if an action is valid |
| Load or unload chunks |
| Know how large the world is |
| Know which chunks are loaded |
| Determine what entities exist off-screen |

---

## 19. Input and Interaction

### 19.1 Screen → World Coordinate Mapping (PLANNED)

```
User clicks/taps screen at pixel (px, py)
    │
    │  Divide by cellPx → viewport-relative tile
    ▼
Viewport-relative tile: (vx, vy) = (floor(px/cellPx), floor(py/cellPx))
    │
    │  Add viewport origin
    ▼
World coordinate: wx = vp.originWx + vx, wy = vp.originWy + vy
    │
    │  Rules engine receives (wx, wy) as target
    ▼
Validation and execution in world coordinates
```

### 19.2 Targeting at World Scale

No change to targeting semantics. `validateAttack(state, actorId, targetId)` uses `chebyshev` on world coordinates. The screen coordinate is only used to identify which world tile was clicked; the actual validation happens at world coordinates.

If a player clicks a tile outside the current encounter area (e.g., a floor tile, not an entity), the same `handleTileClick(wx, wy)` handler applies. The rules engine determines validity.

### 19.3 Hover Preview at World Scale

Target preview (introduced in commit `8e966cf`) continues to work. The `targetPreview` state stores `targetId` (entity ID), not a screen coordinate. Entity IDs are world-stable — no change needed.

---

## 20. Responsive Tabletop

### 20.1 Screen Independence

The world model and viewport logic operate in **logical tile units only**. They have no knowledge of:

- `cellPx` (pixel size per tile)
- CSS breakpoints
- Screen resolution
- Device pixel ratio

### 20.2 Tablet vs Desktop

On a tablet portrait view, the visible tile count may be 8×10. On a desktop, it may be 14×12. Both are valid `ViewportState` configurations for the same world:

```
Same world, two devices:

Desktop: ViewportState { originWx: 5, originWy: 3, tileW: 14, tileH: 12 }
Tablet:  ViewportState { originWx: 5, originWy: 3, tileW:  8, tileH: 10 }
```

The desktop sees more tiles, but both show the same `originWx/originWy`. The dead-zone margins (in tiles) may need to be smaller on tablet portrait.

### 20.3 Existing Responsive Behavior

The existing `cellPx` state in `IntelligentTabletop.tsx` already switches between 52px (desktop) and 46px (narrow). This mechanism remains unchanged — `tileW` and `tileH` are computed from `cellPx` at render time, feeding the viewport. No additional responsive logic is needed at the world level.

---

## 21. Asset System

The asset registry architecture (commit `1c825d3`) is preserved without modification.

### 21.1 Invariants

| Invariant |
|---|
| The world/rules engine does not import asset files |
| Terrain/entity rendering resolves assets via `resolveAsset()` |
| Asset keys remain content-addressed (`character.${defId}`, `tile.${tileType}`) |
| The world model uses `defId` strings; the renderer resolves them |

### 21.2 New Tile Asset Keys (PLANNED)

Future tile types will need asset keys:

```
tile.floor          → floor texture
tile.wall           → wall texture
tile.pillar         → pillar texture
tile.door_open      → open door texture
tile.door_closed    → closed door texture
tile.void           → void/unexplored texture
```

These follow the existing registry pattern. The world model does not know their resolution.

---

## 22. AI DM Future Integration

### 22.1 Architecture Position

```
AI DM (future)
    │
    │  Produces: EnvironmentDescription (narrative + structure)
    │  e.g. { type: "corridor", length: 80, width: 3,
    │          features: [{ at: 45, type: "door" }, { at: 60, type: "room_entrance" }] }
    ▼
World Generator / Environment Builder
    │  Converts EnvironmentDescription → ChunkGenerationRules
    │  These rules feed chunk generation: deterministic given seed + rules
    ▼
World Model (Persistent)
    │  Chunk data becomes available as chunks load
    ▼
Viewport
    ▼
Tabletop Renderer
```

### 22.2 What the AI DM Can Do

- Describe world structures ("a corridor continues 80 feet before opening into a cavern")
- Specify encounter types and triggers
- Place entities at world coordinates
- Set environmental properties (lighting, difficulty, lore)
- Generate region summaries for the session log

### 22.3 What the AI DM Cannot Do

- Directly manipulate DOM or CSS
- Bypass the rules engine (movement/attack validation)
- Read or write `ViewportState`
- Override entity world positions without going through the world model
- Decide what is visually displayed (that is the renderer's responsibility)

### 22.4 AI DM Interaction with Rules

The AI DM proposes world-level structures. When a player says "I explore the corridor to the north," the AI DM describes what exists there. The world model generates/loads the tiles. The rules engine validates movement. The AI DM does not participate in per-action validation.

---

## 23. Failure and Edge Cases

| Case | Correct Behavior |
|---|---|
| Player moves backward | Dead zone re-checked; viewport recenter only if they cross dead zone again |
| Player moves diagonally | Viewport recenter triggered if chebyshev of diagonal cross exceeds dead zone |
| Party members splitting | Exploration: centroid follow; may leave members off-screen (FOW future) |
| Active actor far from party | Tactical: viewport follows actor, not centroid |
| Enemy outside current viewport | Viewport shifts to show enemy action result, then returns |
| Combat begins at viewport edge | Viewport recenters on encounter bounding box centroid |
| Target outside visible region | Attack validation uses world coords; viewport shifts to show result |
| Returning to a previously visited region | Chunk reloads with mutations applied; state identical to when left |
| Destroyed objects (barrels, etc.) | Mutation record persists; rendered as destroyed on return |
| Dead entities | Alive=false in WorldState; rendered as corpse or omitted depending on design choice |
| Opened/closed doors | TileMutation record; tile type changes on chunk load |
| Viewport crossing chunk boundary | Next chunk prefetched; no visual gap if prefetch completes in time |
| Rapidly changing direction | Viewport batches recenter — only final position used per turn |
| Very large room (300×200) | Small dead zone; viewport follows actor; entire room never displayed at once |
| Very narrow corridor (1 tile wide) | Viewport centers on corridor; single-file movement works |
| World boundaries | Viewport clamped; impassable tiles beyond edge |
| Missing terrain (generation failed) | Fallback: void tiles. Log error. Do not crash. |
| Save/load in streamed region | ViewportState reconstructed from party position; chunks re-generated |
| Multiple PCs in separate rooms | Tactical: follow active actor; exploration: centroid — some PCs off-screen |
| Chunk eviction during combat | Never evict a chunk containing a combat participant |
| Off-screen enemy attacks | Rules engine uses world coords; viewport shifts to show result |

---

## 24. Test Strategy

### 24.1 Unit Tests (PLANNED)

| Test | What It Verifies |
|---|---|
| `worldKey(wx, wy)` | Negative coords produce distinct keys |
| `toChunkCoord(wx, wy)` | Boundary tiles (wx=0, wy=16 → cx=0,cy=1) |
| `worldToPixel(wx, wy, vp, cellPx)` | Correct pixel for any `(wx, wy, originWx, originWy)` |
| `pixelToWorld(px, py, vp, cellPx)` | Inverse of above |
| `getVisibleTiles(vp, ...)` | Returns exactly `tileW × tileH` tiles |
| Entity at (142,37) with vp.origin (140,35) | Maps to viewport position (2,2) |
| `chebyshev` with world coords | Unchanged from current unit tests |
| `reachableTiles` with tile query fn | Returns same results as current map-based version for equivalent terrain |
| Viewport recenter logic | Actor at dead-zone edge → recenter; actor inside → no move |
| Chunk coord at boundary | Tile (15,15) → chunk (0,0); tile (16,16) → chunk (1,1) |
| Deterministic generation | Same seed + chunk coord always produces same terrain |
| Entity persistence across eviction | Entity state after evict/reload equals state before evict |
| Viewport clamping | Cannot scroll past world boundary |

### 24.2 Integration Tests (PLANNED)

| Test | What It Verifies |
|---|---|
| Corridor traversal: 100-tile corridor, move from (0,5) to (80,5) | Viewport follows; world coords preserved; chunks load/unload |
| Chunk transition | Moving across chunk boundary at tile 16: no entity teleport |
| Encounter transition: exploration → tactical → exploration | Mode changes correctly; GameState created and destroyed |
| Entity off-screen survival | Entity state unchanged after leaving and returning to viewport |
| Mutation persistence | Opened door at (45,5) still open after viewport moves away and returns |

### 24.3 E2E Tests (PLANNED)

| Test | What It Verifies |
|---|---|
| Long corridor traversal | Visual: party moves through corridor; new terrain appears; old disappears |
| Large room exploration | Viewport follows party; room edges visible when near |
| Viewport following | Moving active actor triggers dead-zone recenter |
| Combat locking | Viewport does not drift during a player's targeting decision |
| Exploration resuming | After combat, viewport returns to exploration follow mode |
| Responsive viewport | Desktop and tablet show different tile counts; world position same |

### 24.4 Deterministic vs Visual

| Deterministic (unit/integration testable) | Visual only (snapshot/manual) |
|---|---|
| World coordinate transforms | Rendering quality of tile textures |
| Viewport bounds calculation | Animation smoothness |
| Chunk coord arithmetic | Token appearance |
| Entity position after eviction | CSS layout |
| Reachability from world coords | Viewport scroll visual smoothness |

---

## 25. Implementation Phases

All phases are PLANNED. None are implemented. Phases should be implemented in order — each builds on the previous.

### Phase A — Logical World-Coordinate Abstraction

- Rename `Combatant.x/y` to `Combatant.wx/wy` in `content.ts`.
- Update all rules engine references from `(x, y)` to `(wx, wy)`.
- Replace `MapDef`-based tile lookups with a `TileQueryFn` interface.
- Adapter: `mapDefToTileQuery(mapDef: MapDef): TileQueryFn` — preserves all existing behavior.
- **No user-visible change.** All 93 unit tests and 148 E2E tests must continue to pass.

### Phase B — Viewport Model and World-to-Visible-Tile Mapping

- Implement `ViewportState` interface and `getVisibleTiles()`.
- Implement `worldToPixel()` and `pixelToWorld()`.
- Implement `clampViewportOrigin()`.
- Renderer reads from `ViewportState` instead of directly using map dimensions.
- For current small encounters: `ViewportState` initialized so the entire map is visible (equivalent to today's behavior).
- **No user-visible change.** Dead-zone logic is present but inactive (encounters still smaller than viewport).

### Phase C — Render Only the Visible World Region

- Renderer switches from `Array.from({ length: map.height })` to `getVisibleTiles()` output.
- DOM tile count becomes `tileW × tileH` (virtualized grid).
- Tile DOM elements display world tile content based on `wx/wy - viewportOrigin`.
- **No user-visible change for small encounters.** Performance improvement for large maps.

### Phase D — Viewport Follow/Recenter Behavior

- Implement dead-zone logic.
- Implement `shouldRecenter()` and `computeNewOrigin()`.
- Connect to move execution: after `setGameState(newState)`, compute new `ViewportState`.
- **First user-visible Phase 3 change:** Moving a PC causes the viewport to follow when near edges.

### Phase E — Large-Area Support

- Introduce large test encounter: 40×40 map.
- Viewport starts centered on party.
- Dead zone active.
- All existing combat mechanics work at large scale.
- **Test:** move the party across the 40×40 map; viewport follows; all rules remain valid.

### Phase F — Chunk/Region Streaming

- Implement `ChunkStore`: load, unload, cache, generation.
- Implement chunk prefetch on approach.
- Replace bounded `MapDef` with `WorldModel` using `ChunkStore`.
- **First corridor test:** 100-tile corridor, fully traversable.

### Phase G — Persistent World/Entity State

- Implement `WorldState` with mutation logs.
- Entity identity persists across chunk eviction/reload.
- Opened doors, dead entities, looted containers persist.
- Save/load cycle implemented.

### Phase H — Exploration → Encounter Transition

- Implement encounter trigger zones in world space.
- Implement the exploration → tactical → exploration flow.
- Viewport stabilizes on encounter detection.
- Post-combat exploration resumes.

### Phase I — Tactical Viewport Locking

- Viewport does not drift during a player's action selection.
- Off-screen enemy actions shift viewport briefly, then return.
- Large-battlefield combat: tactical viewport stable during PC turns.

### Phase J — Large-Scale Environment Testing

- End-to-end tests for corridor traversal, large rooms, exploration/combat cycles.
- Performance profiling: chunk count, render time, React re-render frequency.
- Accessibility regression: all Phase 2 ARIA/keyboard tests still pass.

---

## 26. Architectural Decisions

The following decisions are **final** for Phase 3 design. They may not be overridden by a subsequent implementation without updating this document first.

| # | Decision |
|---|---|
| 1 | **The tabletop is fixed.** Its physical screen dimensions do not change as the world is explored. |
| 2 | **The world is not fixed to tabletop dimensions.** Environments may be arbitrarily large. |
| 3 | **World coordinates are authoritative.** `(wx, wy)` is the permanent address of any tile or entity. |
| 4 | **Viewport coordinates are presentation state.** `ViewportState` is never written to `GameState`. |
| 5 | **Moving the viewport never moves entities in world space.** Entities move only when the rules engine executes a move action. |
| 6 | **Rules validation operates against authoritative world coordinates.** The viewport cannot block or enable an action. |
| 7 | **Rendering does not own world state.** The renderer receives a visible-tile array and entity list. It does not query the world directly. |
| 8 | **Assets remain decoupled from the rules engine.** Asset keys are strings; resolution is the renderer's job. |
| 9 | **Tactical combat stabilizes the relevant viewport.** During a player's decision, the viewport does not move involuntarily. |
| 10 | **Exploration can move through environments larger than the tabletop.** This is the primary Phase 3 goal. |
| 11 | **Entity identity persists outside the currently visible region.** Evicted chunks do not destroy entity state. |
| 12 | **Future AI can describe/generate world content without owning rendering or rules.** The AI DM produces environment descriptions; the world model generates content; the rules engine remains authoritative. |
| 13 | **Chunk coordinates are derived, never stored on entities.** An entity's world position is its only address. |
| 14 | **All Phase 2 tests must pass through Phase A and Phase B with no modification.** These phases are transparent rewrites. |
| 15 | **`cellPx` and screen layout remain in the renderer.** The viewport model operates in logical tile units. Screen pixels are computed at the last possible moment. |

---

_End of specification._
_Status: SPECIFICATION ONLY — no implementation has occurred._
_Author: Phase 3 design task, commit to follow._
