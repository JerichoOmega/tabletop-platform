---
name: Viewport architecture phase progress
description: Tracks which Phase 3 viewport/world-scale phases are complete and what comes next
---

## Phase completion status

| Phase | Description | Status |
|---|---|---|
| A | Logical world-coordinate abstraction (`wx/wy`, `TileQueryFn`, `tileQuery` in `GameState`) | ✅ COMPLETE |
| B | ViewportState model, `getVisibleTiles()`, coordinate transforms | ✅ COMPLETE |
| C | Renderer switches to virtualized tile grid (only visible tiles rendered) | ✅ COMPLETE |
| D | Viewport follow/recenter: dead-zone logic, `shouldRecenter()`, `computeNewOrigin()` | ✅ COMPLETE |
| E | Large-area support: 40×40 `grandHall`, dead zone active, all mechanics valid at scale | ✅ COMPLETE — commit `73e7f3d`, 217 unit tests, 154 E2E tests |
| F-foundation | Chunk/Region Streaming foundation: `ChunkStore`, coordinate math, `ResidentGeometrySnapshot`, `snapshotToTileQuery()` | ✅ COMPLETE — 131 chunk tests |
| F-async | Async streaming: `ensureResident()`, `ensureResidentAndPin()`, deduplication, pin/unpin lifecycle | ✅ COMPLETE — 33 async tests |
| F-world | WorldState & WorldEntityRegistry: entity persistence, beginEncounter/endEncounter, buildEncounterFromEntities | ✅ COMPLETE — 92 world tests |
| F-viewport | Viewport streaming integration: replace MapDef-backed renderer with ChunkStore-backed queries | NEXT — not yet started |
| G | Persistent WorldState, entity survival across chunk eviction | PLANNED |
| H | Exploration → encounter transition | PLANNED |

## Phase F locked decisions (see §26 Decisions 21–28 in WORLD_SCALE_VIEWPORT.md)

1. `CHUNK_W = CHUNK_H = 16` (square, power of 2)
2. Floor division only — never `%` for chunk/local coordinate math
3. `ResidentGeometrySnapshot`: immutable barrier between async ChunkStore and sync rules engine
4. `PINNED` residency state: encounter-required chunks cannot be evicted during encounter
5. Entity ownership: WorldState/WorldEntityRegistry owns worldId/wx/wy; chunks own geometry only
6. Missing-snapshot tile → deterministic `"void"`; participant-tile miss → invariant violation
7. ChunkStore owned exclusively by WorldState; GameState never receives live store reference
8. Generation RNG isolated from combat/initiative RNG: seeded from `(worldSeed, cx, cy, generationVersion)`

## Key constants (implemented)

- `VIEWPORT_TILE_W = 12`, `VIEWPORT_TILE_H = 10` — in `IntelligentTabletop.tsx`
- `DEAD_ZONE_MARGIN = 3` — in `viewport.ts`
- `CHUNK_W = CHUNK_H = 16` — IMPLEMENTED in `src/engine/chunk.ts`

## Known latent issue (must fix before Phase F/H LLM integration)

`buildIntentContext()` in `src/intent/parser.ts` reads `state.map.pillars` directly — currently voided/unused but must be replaced with `state.tileQuery` queries before live use. Do not ship with the direct `map.pillars` access.

**Why:** After Phase F, encounters may use chunk-backed geometry where `map.pillars` is empty/absent. The tileQuery is the only valid geometry source.
