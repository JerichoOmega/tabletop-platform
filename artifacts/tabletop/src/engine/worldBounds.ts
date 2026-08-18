// ---------------------------------------------------------------------------
// WORLD BOUNDS — Phase 3 Milestone M4.
//
// The single authoritative definition of the playable world's finite
// rectangle, in world/tile coordinates (the same coordinate system used by
// WorldEntity.wx/wy, TileQueryFn, and chunk decomposition — no second
// coordinate system is introduced).
//
// CONTRACT:
//   • Bounds are an INCLUSIVE rectangle: a point (wx, wy) is inside iff
//       minWx <= wx <= maxWx  AND  minWy <= wy <= maxWy.
//   • Negative coordinates are fully supported (chunk math already uses
//     floor division; see chunk.ts Decision 22).
//   • Bounds constrain WHAT EXISTS (playable terrain, entity positions,
//     chunk streaming) — they do NOT change the entity/chunk authority
//     model (M2) or the parser/tileQuery contract (M3).
//
// WHO CONSUMES THIS:
//   • WorldState carries the bounds (authoritative world/query layer — M5
//     encounter transitions read it from there, not from the renderer).
//   • WorldEntityRegistry rejects register/move outside bounds (invariant
//     guard — movement layers must reject earlier with a friendly reason).
//   • exploration.ts explorationTileInfo → VOID outside bounds.
//   • snapshotToTileQuery → VOID outside bounds (encounter geometry).
//   • viewportStreaming/computePinSet filter chunks that do not intersect
//     the bounds — chunks entirely outside the world are never generated.
//
// All functions here are pure and allocation-light.
// ---------------------------------------------------------------------------

import { CHUNK_W, CHUNK_H } from "./chunk";

/**
 * The playable world rectangle in world/tile coordinates. All four limits
 * are INCLUSIVE. Immutable — construct via createWorldBounds().
 */
export interface WorldBounds {
  readonly minWx: number;
  readonly maxWx: number;
  readonly minWy: number;
  readonly maxWy: number;
}

/**
 * Constructs a validated, frozen WorldBounds.
 *
 * @throws If any limit is non-integer, or min > max on either axis.
 */
export function createWorldBounds(
  minWx: number,
  minWy: number,
  maxWx: number,
  maxWy: number,
): WorldBounds {
  for (const [name, v] of [["minWx", minWx], ["minWy", minWy], ["maxWx", maxWx], ["maxWy", maxWy]] as const) {
    if (!Number.isInteger(v)) {
      throw new Error(`createWorldBounds: ${name} must be an integer (got ${v}).`);
    }
  }
  if (minWx > maxWx || minWy > maxWy) {
    throw new Error(
      `createWorldBounds: empty rectangle (minWx=${minWx}, maxWx=${maxWx}, minWy=${minWy}, maxWy=${maxWy}).`,
    );
  }
  return Object.freeze({ minWx, maxWx, minWy, maxWy });
}

/** True iff the world tile (wx, wy) lies inside the inclusive bounds. */
export function isInBounds(bounds: WorldBounds, wx: number, wy: number): boolean {
  return wx >= bounds.minWx && wx <= bounds.maxWx && wy >= bounds.minWy && wy <= bounds.maxWy;
}

/** Width of the playable rectangle in tiles (inclusive limits → +1). */
export function boundsWidth(bounds: WorldBounds): number {
  return bounds.maxWx - bounds.minWx + 1;
}

/** Height of the playable rectangle in tiles (inclusive limits → +1). */
export function boundsHeight(bounds: WorldBounds): number {
  return bounds.maxWy - bounds.minWy + 1;
}

/**
 * True iff chunk (cx, cy) contains AT LEAST ONE tile inside the bounds.
 *
 * A chunk covers world tiles [cx*CHUNK_W .. cx*CHUNK_W + CHUNK_W - 1] ×
 * [cy*CHUNK_H .. cy*CHUNK_H + CHUNK_H - 1]. Standard inclusive-rectangle
 * intersection; correct for negative chunk coordinates (multiplication,
 * not division — no floor pitfalls).
 *
 * Chunks that intersect the boundary partially ARE included — their
 * out-of-bounds tiles read as VOID at the tile-query layer instead.
 */
export function chunkIntersectsBounds(bounds: WorldBounds, cx: number, cy: number): boolean {
  const chunkMinWx = cx * CHUNK_W;
  const chunkMinWy = cy * CHUNK_H;
  return (
    chunkMinWx <= bounds.maxWx &&
    chunkMinWx + CHUNK_W - 1 >= bounds.minWx &&
    chunkMinWy <= bounds.maxWy &&
    chunkMinWy + CHUNK_H - 1 >= bounds.minWy
  );
}

/**
 * Removes chunk coordinates that lie entirely outside the bounds.
 * With `bounds` undefined (unbounded world), returns the input unchanged.
 * Used by viewport streaming and encounter pin-set computation so chunks
 * wholly outside the playable world are never generated or retained.
 */
export function filterChunksToBounds(
  chunks: { cx: number; cy: number }[],
  bounds: WorldBounds | undefined,
): { cx: number; cy: number }[] {
  if (!bounds) return chunks;
  return chunks.filter(({ cx, cy }) => chunkIntersectsBounds(bounds, cx, cy));
}
