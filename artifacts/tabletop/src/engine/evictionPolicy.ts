// ---------------------------------------------------------------------------
// CHUNK EVICTION POLICY — Phase 3 Milestone M2.
//
// Distance-based eviction of RESIDENT chunks that have fallen far enough
// behind the moving viewport. Completes the chunk lifecycle:
//
//   UNLOADED → LOADING → RESIDENT → (viewport moves away) → UNLOADED
//
// POLICY (PHASE3_IMPLEMENTATION_PLAN.md §8, canonical):
//   • Prefetch loads chunks within PREFETCH_MARGIN of the visible chunk rect.
//   • Eviction removes RESIDENT chunks whose Chebyshev chunk-distance from
//     the visible chunk rect EXCEEDS PREFETCH_MARGIN + 1.
//   • The one-chunk gap between the prefetch ring (distance ≤ 1) and the
//     eviction threshold (distance > 2) is deliberate hysteresis: a chunk
//     that just left the prefetch ring is NOT immediately evicted, so a
//     viewport oscillating across a chunk boundary never load/evict-thrashes.
//
// IMMUNITY (hard rules, spec §11.3 / Decision 24):
//   • PINNED chunks are never evicted — they belong to an active encounter.
//   • LOADING chunks are never evicted — ChunkStore.evict() refuses them;
//     they are also never enumerated as candidates (no geometry yet).
//   • Already-UNLOADED chunks are not candidates (nothing to evict).
//
// WHAT EVICTION REMOVES — GEOMETRY ONLY:
//   Entities live in WorldEntityRegistry (Decision 25), never in chunks.
//   Evicting a chunk discards only cached deterministic geometry, which
//   regenerates bit-identically from (worldSeed, cx, cy, generationVersion)
//   when the player returns. Eviction never touches WorldEntityRegistry.
//
// TRIGGERING:
//   Not timer-based. The caller (the component's viewport prefetch effect)
//   runs evictDistantChunks() after the prefetch work for a viewport change
//   settles. Pure selection is separated from execution for testability.
//
// Dependency: viewport.ts, chunk.ts, viewportStreaming.ts — no React,
// no GameState, no rules engine, no WorldEntityRegistry.
// ---------------------------------------------------------------------------

import type { ViewportState } from "./viewport";
import type { ChunkStore } from "./chunk";
import { wxToChunk, wyToChunk } from "./chunk";
import { PREFETCH_MARGIN } from "./viewportStreaming";

/**
 * Chebyshev chunk-distance beyond which a RESIDENT chunk is evicted.
 * Canonical hysteresis: prefetch at PREFETCH_MARGIN, evict past
 * PREFETCH_MARGIN + 1 (PHASE3_IMPLEMENTATION_PLAN.md §8, §12 "Eviction thrash").
 */
export const EVICTION_THRESHOLD_CHUNKS = PREFETCH_MARGIN + 1;

/** Inclusive chunk-coordinate rectangle covering the visible viewport area. */
export interface ChunkRect {
  minCx: number;
  maxCx: number;
  minCy: number;
  maxCy: number;
}

/**
 * The chunk rectangle covering exactly the VISIBLE tile area of the viewport
 * (no prefetch margin). Distances for eviction are measured from this rect.
 *
 * Uses wxToChunk/wyToChunk (floor division) — correct for negative
 * coordinates (Decision 22).
 */
export function getVisibleChunkRect(viewport: ViewportState): ChunkRect {
  const { originWx, originWy, tileW, tileH } = viewport;
  return {
    minCx: wxToChunk(originWx).cx,
    maxCx: wxToChunk(originWx + tileW - 1).cx,
    minCy: wyToChunk(originWy).cy,
    maxCy: wyToChunk(originWy + tileH - 1).cy,
  };
}

/**
 * Chebyshev distance (in whole chunks) from chunk (cx, cy) to the nearest
 * chunk of the rectangle. 0 when the chunk is inside the rectangle.
 */
export function chunkDistanceToRect(cx: number, cy: number, rect: ChunkRect): number {
  const dx = cx < rect.minCx ? rect.minCx - cx : cx > rect.maxCx ? cx - rect.maxCx : 0;
  const dy = cy < rect.minCy ? rect.minCy - cy : cy > rect.maxCy ? cy - rect.maxCy : 0;
  return Math.max(dx, dy);
}

/**
 * PURE eviction selection.
 *
 * Given the chunks currently held in memory (from ChunkStore.listChunks())
 * and the current viewport, returns the chunks that should be evicted:
 * RESIDENT chunks whose Chebyshev distance from the visible chunk rect
 * exceeds the threshold. PINNED chunks are never selected. LOADING /
 * UNLOADED chunks are not in the input by construction.
 *
 * Deterministic: output preserves the input order (ChunkStore insertion
 * order), and selection depends only on the arguments.
 */
export function selectChunksToEvict(
  heldChunks: readonly { cx: number; cy: number; residency: "RESIDENT" | "PINNED" }[],
  viewport: ViewportState,
  thresholdChunks: number = EVICTION_THRESHOLD_CHUNKS,
): { cx: number; cy: number }[] {
  const rect = getVisibleChunkRect(viewport);
  const out: { cx: number; cy: number }[] = [];
  for (const { cx, cy, residency } of heldChunks) {
    if (residency !== "RESIDENT") continue; // PINNED — immune
    if (chunkDistanceToRect(cx, cy, rect) > thresholdChunks) out.push({ cx, cy });
  }
  return out;
}

/**
 * Executes the eviction policy against a live ChunkStore.
 *
 * Call AFTER prefetch for the current viewport has settled (the component's
 * streaming effect awaits its prefetch promises first). Not timer-driven.
 *
 * Safety is double-layered: selection already skips PINNED chunks, and
 * ChunkStore.evict() itself refuses PINNED and LOADING chunks — so even a
 * racing pin between selection and execution cannot evict an encounter chunk.
 *
 * Touches ONLY the ChunkStore. Never reads or writes WorldEntityRegistry,
 * GameState, or any authoritative state.
 *
 * @returns The chunks actually evicted (for logging/diagnostics/tests).
 */
export function evictDistantChunks(
  store: ChunkStore,
  viewport: ViewportState,
  thresholdChunks: number = EVICTION_THRESHOLD_CHUNKS,
): { cx: number; cy: number }[] {
  const victims = selectChunksToEvict(store.listChunks(), viewport, thresholdChunks);
  const evicted: { cx: number; cy: number }[] = [];
  for (const { cx, cy } of victims) {
    if (store.evict(cx, cy)) evicted.push({ cx, cy });
  }
  return evicted;
}
