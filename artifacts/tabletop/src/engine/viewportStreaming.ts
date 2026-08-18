// ---------------------------------------------------------------------------
// VIEWPORT STREAMING — Phase F integration between ViewportState and ChunkStore.
//
// This module is the ONLY place that connects viewport presentation to
// chunk residency. It deliberately never touches GameState or the rules engine.
//
// TWO GEOMETRY CONCERNS — never conflate them (spec §§4, 5, 27):
//
//   SIMULATION (authoritative):
//     GameState.tileQuery → ResidentGeometrySnapshot → frozen at encounter start.
//     Rules engine reads ONLY this. Immutable for the lifetime of a GameState.
//
//   PRESENTATION (transient):
//     WorldState.ChunkStore → async residency → viewport-visible terrain.
//     Renderer reads this for display. Never becomes gameplay state.
//     A tile being LOADING here does NOT affect rules-engine passability.
//
// INVARIANT: viewport chunk loads must NEVER replace GameState.tileQuery.
//   A chunk loading because the camera moved must not change the geometry
//   seen by the active rules engine. (spec §4, Task Instruction §4)
//
// PINNING CONTRACT (Decision 24, Task Instruction §10):
//   PINNED   = encounter-required (set by WorldState.beginEncounter).
//   RESIDENT = loaded but evictable (set by prefetchViewportChunks here).
//   Viewport prefetch uses ensureResident() — NOT ensureResidentAndPin().
//   This preserves the invariant that only encounter chunks are PINNED.
//
// CONCURRENCY MODEL (Task Instruction §9):
//   ChunkStore.ensureResident() deduplicates concurrent loads.
//   Multiple viewport updates requesting the same chunk share one Promise.
//   This module does NOT build a second in-flight cache.
//
// STALE-COMPLETION SAFETY (Task Instruction §13, §14):
//   prefetchViewportChunks() is fire-and-forget (returns void).
//   No load completion callback writes viewport state.
//   If A→B→C viewport changes occur, each triggers independent prefetch.
//   Any load completing "late" adds a RESIDENT chunk — harmless.
//   The viewport is owned by React state, never by chunk completion.
//
// RNG ISOLATION (Task Instruction §17):
//   prefetchViewportChunks() consumes zero gameplay RNG.
//   generateChunk() uses an isolated per-chunk RNG (Decision 28).
//
// Dependency: viewport.ts, chunk.ts — no React, no GameState, no rules engine.
// ---------------------------------------------------------------------------

import type { ViewportState } from "./viewport";
import type { ChunkStore } from "./chunk";
import { wxToChunk, wyToChunk } from "./chunk";
import { filterChunksToBounds, type WorldBounds } from "./worldBounds";

// ---------------------------------------------------------------------------
// PREFETCH POLICY CONSTANT
// ---------------------------------------------------------------------------

/**
 * Default number of extra chunks to prefetch beyond the visible region, in each
 * direction. 1 means: for every chunk in the viewport boundary, also request
 * the adjacent chunk in that direction.
 *
 * This prevents a visible seam when the viewport scrolls by one chunk:
 * the adjacent chunk is already RESIDENT before it enters the visible area.
 *
 * Spec §11.7 calls for at least a 1-chunk lookahead on the leading edge.
 * We apply it uniformly (all four sides) for simplicity — the extra loads
 * are cheap and ChunkStore deduplication prevents redundant work.
 */
export const PREFETCH_MARGIN = 1;

// ---------------------------------------------------------------------------
// PURE CHUNK ENUMERATION
// ---------------------------------------------------------------------------

/**
 * Returns all chunk coordinates needed to cover the given viewport, plus an
 * optional prefetch margin (additional chunks in each direction).
 *
 * This is a pure function — no side effects, no state, no async.
 * The output is the union of:
 *   1. All chunks intersecting the visible tile rectangle.
 *   2. All chunks within `prefetchMarginChunks` extra chunks in each direction.
 *
 * FLOOR DIVISION INVARIANT (Decision 22):
 *   Chunk coordinates are derived via `wxToChunk` / `wyToChunk`, which always
 *   use `Math.floor`. Never use `%` for chunk math — it fails for negative wx.
 *
 * Examples (CHUNK_W = CHUNK_H = 16):
 *
 *   Viewport { originWx:0, originWy:0, tileW:12, tileH:10 }, margin=0:
 *     Visible: wx=[0..11], wy=[0..9] → chunks cx=0,cy=0 → 1 chunk.
 *
 *   Same viewport, margin=1:
 *     Expand by 1 chunk in each dir: cx=[-1..1], cy=[-1..1] → 9 chunks.
 *
 *   Viewport { originWx:5, originWy:15, tileW:12, tileH:10 }, margin=0:
 *     Visible: wx=[5..16], wy=[15..24].
 *     cx: floor(5/16)=0 to floor(16/16)=1 → cx∈{0,1}
 *     cy: floor(15/16)=0 to floor(24/16)=1 → cy∈{0,1} → 4 chunks.
 *
 *   Viewport at negative origin { originWx:-5, originWy:-5, tileW:4, tileH:4 }, margin=0:
 *     wx=[-5..-2], wy=[-5..-2] → cx=floor(-5/16)=-1, cy=-1 → 1 chunk.
 *
 * WORLD BOUNDS (M4):
 *   When `bounds` is provided, chunks that lie ENTIRELY outside the playable
 *   world are excluded — the prefetch margin near a world edge must not
 *   generate or retain chunks that contain no playable terrain. Chunks that
 *   partially intersect the boundary are kept (their out-of-world tiles read
 *   VOID at the tile-query layer).
 *
 * @param viewport             The current viewport state.
 * @param prefetchMarginChunks Extra chunks to include beyond visible bounds.
 * @param bounds               Optional playable-world bounds (M4 filter).
 * @returns Array of distinct chunk coordinates covering the region.
 */
export function getChunksForViewport(
  viewport: ViewportState,
  prefetchMarginChunks = 0,
  bounds?: WorldBounds,
): { cx: number; cy: number }[] {
  const { originWx, originWy, tileW, tileH } = viewport;

  // Inclusive world-tile range of the visible area.
  const maxVisWx = originWx + tileW - 1;
  const maxVisWy = originWy + tileH - 1;

  // Chunk coordinate range for the visible area.
  const visMinCx = wxToChunk(originWx).cx;
  const visMaxCx = wxToChunk(maxVisWx).cx;
  const visMinCy = wyToChunk(originWy).cy;
  const visMaxCy = wyToChunk(maxVisWy).cy;

  // Expand by the prefetch margin (in whole chunks).
  const minCx = visMinCx - prefetchMarginChunks;
  const maxCx = visMaxCx + prefetchMarginChunks;
  const minCy = visMinCy - prefetchMarginChunks;
  const maxCy = visMaxCy + prefetchMarginChunks;

  const result: { cx: number; cy: number }[] = [];
  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cy = minCy; cy <= maxCy; cy++) {
      result.push({ cx, cy });
    }
  }
  return filterChunksToBounds(result, bounds);
}

// ---------------------------------------------------------------------------
// NON-BLOCKING VIEWPORT PREFETCH
// ---------------------------------------------------------------------------

/**
 * Initiates non-blocking chunk loads for all chunks in the viewport region,
 * including a prefetch margin of adjacent chunks.
 *
 * FIRE AND FORGET:
 *   This function returns void immediately. Chunk loads proceed in the
 *   background. The caller continues without waiting for any chunk to load.
 *
 *   React component usage pattern:
 *     useEffect(() => {
 *       prefetchViewportChunks(worldState.chunkStore, viewport, worldState.seed);
 *     }, [viewport]);
 *
 *   The viewport does NOT block on this. User input is never delayed.
 *
 * DEDUPLICATION:
 *   ChunkStore.ensureResident() is the authority for deduplication.
 *   If a chunk is already RESIDENT, PINNED, or LOADING, no duplicate work is done.
 *   Multiple rapid viewport changes requesting the same chunk produce one load.
 *
 * NO PINNING:
 *   Only ensureResident() is used — NOT ensureResidentAndPin().
 *   Prefetched chunks stay RESIDENT (evictable) until the cache policy
 *   evicts them. They are NOT promoted to PINNED.
 *   PINNED is reserved for encounter-required chunks (Decision 24).
 *
 * FAILURE HANDLING:
 *   Load failures are presentation-only. A failed chunk stays UNLOADED.
 *   The rules engine uses the snapshot — presentation failure never
 *   affects simulation geometry.
 *
 * RNG ISOLATION:
 *   generateChunk() (called inside ensureResident) uses an isolated RNG
 *   stream seeded per-chunk (Decision 28). Calling this function does not
 *   consume any external RNG stream.
 *
 * @param store                The ChunkStore to load into.
 * @param viewport             Viewport state describing the visible region.
 * @param worldSeed            World seed forwarded to generateChunk().
 * @param prefetchMarginChunks Extra chunks to prefetch beyond the visible area.
 * @param generationVersion    Chunk generation version (default 0).
 * @param bounds               Optional playable-world bounds (M4): chunks
 *                             entirely outside them are never requested.
 */
export function prefetchViewportChunks(
  store: ChunkStore,
  viewport: ViewportState,
  worldSeed: number,
  prefetchMarginChunks = PREFETCH_MARGIN,
  generationVersion = 0,
  bounds?: WorldBounds,
): void {
  const chunks = getChunksForViewport(viewport, prefetchMarginChunks, bounds);
  for (const { cx, cy } of chunks) {
    // Intentionally not awaited — fire and forget.
    // Catch to prevent unhandled-rejection warnings; failure is benign.
    void store.ensureResident(cx, cy, worldSeed, generationVersion).catch(() => {
      // Presentation load failure: chunk stays UNLOADED / returns void.
      // Rules engine is unaffected (it uses the immutable snapshot).
    });
  }
}
