---
name: Exploration mode (Phase 3 M1)
description: Design decisions for the exploration session layer and its boundaries with combat/GameState.
---

## Decisions (M1, complete)
- **Exploration has no GameState.** `src/engine/exploration.ts` reads the LIVE ChunkStore for rendering and movement validation. This is allowed only because exploration is presentation + exploration-specific authority (WorldEntityRegistry). Never feed a live-chunk query into GameState.tileQuery.
  **Why:** the TileQueryFn snapshot invariant protects combat determinism; exploration has no combat rules running.
  **How to apply:** M5 encounter transitions must go through WorldState.beginEncounter → snapshot, not the live query.
- **Fixed exploration world seed (`EXPLORE_WORLD_SEED`) and fixed 64×64 region.** Encounter seeds increment per newEncounter; the exploration world must not vary with them. Unit test asserts the eastward walk path (8..13, 8) is floor — E2E depends on it. Generic WorldBounds is M4.
- **Movement = single Chebyshev step, unmapped chunk = impassable.** Deliberately NOT rules.ts movement (no action economy in exploration). Not a parallel combat system.
- **Re-render pattern:** registry mutations bump `exploreVersion` state; chunk loads bump `chunkVersion` — mirror this for future mutable-class-in-ref state.
- **Gotcha:** the turnKey auto-select effect does not refire when returning from exploration (seed+actor unchanged) — exitExploration must restore selectedId manually or the action bar stays hidden.
- **Gotcha (E2E):** `getByText("INITIATIVE")` collides with the session-log "Initiative: ..." line — use role=heading with exact match. Inline style substring checks like `inset 0 0 0 2px` fail (browser reorders box-shadow); use `cursor: pointer` instead.
- Baseline after M1: 513 unit / 176 E2E, commit pushed to github main.

## Eviction (M2, complete)
- **Eviction is distance-based with hysteresis, never timer-based.** `engine/evictionPolicy.ts` evicts RESIDENT chunks at Chebyshev distance > PREFETCH_MARGIN+1 from the VISIBLE chunk rect, run in the component prefetch effect only after `Promise.allSettled` and only if the effect wasn't cancelled.
  **Why:** the 1-chunk gap between prefetch ring (≤1) and eviction (>2) prevents load/evict thrash at chunk boundaries; the cancelled-flag check prevents evicting against a stale viewport.
  **How to apply:** any future streaming trigger must keep pure selection (`selectChunksToEvict`) separate from execution, and rely on the double immunity layer (selection skips PINNED; `ChunkStore.evict()` refuses PINNED/LOADING).
- **Eviction touches geometry only.** WorldEntityRegistry is never read or written by the eviction path — entity survival is by construction, and tests assert registry object identity across evict/reload.
- **E2E world inspection:** read-only `window.__worldDebug(cx,cy)` hook exists behind the existing `?e2e` gate (residency, geometry hash, held chunks, entity snapshots). The eviction E2E walks a hardcoded BFS-verified path to (58,58); a unit test anchors that path's passability so terrain drift fails fast instead of timing out the E2E.
- Baseline after M2: 622 unit / 177 E2E.

## Encounter loop (M5, complete)
- **Explore → fight → commit loop:** adjacent hostiles trigger `WorldState.beginEncounter([party, ...hostiles])` → `buildEncounterFromEntities` → combat; results always commit via `endEncounter` (a component effect fires on terminal status, guarded by a preparedRef cleared exactly once — safe under strict-mode double invoke).
- **World-backed encounters keep the exploration session alive behind them.** The exploration/encounter switchers must be hidden mid-battle so the only exit is the banner (commit path). Synthetic MapDef is 0×0 — viewport clamping must use the exploration world extent, never `map.width/height`, during a world encounter.
- **Defeat recovery:** `respawnPartyAtSpawn` (exploration.ts) revives the party at spawn AFTER the defeat is committed; world consequences persist. Not a combat write path — no authority violation.
- **Gotcha (E2E):** the step that triggers battle unmounts the exploration-location readout — poll for the "Wilderness Battle" heading instead of the location text. Row 8 is floor from wx=8..21 for the fixed seed.
- **Gotcha:** the terminal-turn guard unmounts the action bar on victory — E2E expectations like "button disabled after use" become "button gone + Victory banner" when the ability kills the last enemy.

## WorldBounds (M4)
- One authoritative bounds contract: `engine/worldBounds.ts` inclusive rectangle; lives on WorldState (never renderer-only). Exploration extent defined ONLY by EXPLORE_WORLD_BOUNDS (W/H derived).
- Layered enforcement: movement rejects edge crossings first (friendly reason), registry + endEncounter throw as invariant guards (atomic, no partial commits); snapshot tileQuery VOIDs out-of-world tiles; streaming/pin-set filter chunks entirely outside.
- Known limitation (deliberately deferred): clampViewportOrigin assumes 0-based worlds — must be extended before rendering a negative-origin world. Do NOT change it until such a world exists.
