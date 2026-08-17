// ---------------------------------------------------------------------------
// VIEWPORT — presentation-state model for the Phase 3 World-Scale system.
//
// ViewportState describes which portion of the authoritative world is
// currently visible on the fixed tabletop surface. It is NEVER stored
// inside GameState — it is transient presentation state owned by the
// React layer.
//
// Architectural chain (spec §3.4):
//   World Space (authoritative, wx/wy)
//     ↓  viewportToWorld / worldToViewport
//   Viewport-relative logical tiles (vx, vy)
//     ↓  multiply by cellPx  (rendering layer only, not in this module)
//   Screen pixels
//
// Pixel coordinates NEVER enter the rules engine or this module.
// This module operates exclusively in integer logical tile coordinates.
//
// Phase B invariants:
//   • originWx = 0, originWy = 0 for all current encounters.
//   • tileW = map.width, tileH = map.height — the entire 8×6 map is visible.
//   • No scrolling, dead zones, or camera movement is implemented yet.
//
// Phase C will introduce viewport following; Phase F will introduce chunks.
//
// Dependency: content.ts (TileQueryFn, TileInfo).
// ---------------------------------------------------------------------------

import type { TileQueryFn, TileInfo } from "./content";

// ---------------------------------------------------------------------------
// VIEWPORT STATE — presentation only, NEVER placed in GameState.
// ---------------------------------------------------------------------------

/**
 * Describes which portion of the world is currently presented on the table.
 *
 *   originWx / originWy — world coordinate of the top-left visible tile.
 *   tileW / tileH       — how many tiles are visible horizontally / vertically.
 *
 * Viewport state is transient — it never affects GameState, combatant
 * positions, movement legality, or any rules-engine outcome. Changing the
 * viewport origin moves the window onto the world; it does not move the world.
 */
export interface ViewportState {
  /** World x of the top-left visible tile. */
  originWx: number;
  /** World y of the top-left visible tile. */
  originWy: number;
  /** Number of tiles visible horizontally. */
  tileW: number;
  /** Number of tiles visible vertically. */
  tileH: number;
}

// ---------------------------------------------------------------------------
// VISIBLE TILE — one cell on the rendered tabletop.
// ---------------------------------------------------------------------------

/**
 * A single visible tile with its authoritative world coordinate preserved.
 *
 * INVARIANT: (wx, wy) is the authoritative world coordinate of this tile.
 * (vx, vy) is the viewport-relative position (0-based; top-left = 0, 0).
 *
 * The renderer MUST use (wx, wy) for:
 *   • token lookup (tokensByTile[key(tile.wx, tile.wy)])
 *   • reachability set lookup (reachSet.has(key(tile.wx, tile.wy)))
 *   • passing move destinations to the rules engine
 *
 * The renderer uses (vx, vy) ONLY to position the cell in the CSS grid.
 * It must never substitute (vx, vy) for a world coordinate.
 */
export interface VisibleTile {
  /** Authoritative world x — the coordinate the rules engine operates on. */
  wx: number;
  /** Authoritative world y — the coordinate the rules engine operates on. */
  wy: number;
  /** Viewport-relative x (0 = leftmost visible column). */
  vx: number;
  /** Viewport-relative y (0 = topmost visible row). */
  vy: number;
  /** Tile geometry snapshot from the rules engine's tileQuery. */
  tileInfo: TileInfo;
}

// ---------------------------------------------------------------------------
// COORDINATE TRANSFORMS — pure functions, no side effects.
//
// These operate on logical tile coordinates ONLY.
// They have no knowledge of CSS, pixels, cellPx, React, DOM, or device resolution.
// ---------------------------------------------------------------------------

/**
 * Converts a world coordinate to a viewport-relative tile position.
 *
 *   vx = wx − originWx
 *   vy = wy − originWy
 *
 * A tile outside the visible area produces vx/vy that are out of range
 * (< 0 or ≥ tileW/tileH). For the full in-bounds set, use getVisibleTiles().
 */
export function worldToViewport(
  vp: ViewportState,
  wx: number,
  wy: number,
): { vx: number; vy: number } {
  return { vx: wx - vp.originWx, vy: wy - vp.originWy };
}

/**
 * Converts a viewport-relative tile position to an authoritative world coordinate.
 *
 *   wx = vx + originWx
 *   wy = vy + originWy
 *
 * This is the inverse of worldToViewport. Use this to resolve a clicked
 * or tapped grid cell to a world coordinate before passing it to the
 * rules engine. The rules engine must ONLY ever receive world coordinates.
 */
export function viewportToWorld(
  vp: ViewportState,
  vx: number,
  vy: number,
): { wx: number; wy: number } {
  return { wx: vx + vp.originWx, wy: vy + vp.originWy };
}

// ---------------------------------------------------------------------------
// VISIBLE TILE ENUMERATION
// ---------------------------------------------------------------------------

/**
 * Produces a 2-D array of all tiles currently visible through the viewport.
 *
 *   result[vy][vx] is the VisibleTile at viewport-relative position (vx, vy),
 *   carrying its authoritative world coordinate (wx, wy).
 *
 * Phase B: the viewport covers the entire 8×6 map (origin 0, 0), so every
 * map tile appears exactly once.
 *
 * The tileQuery parameter is the same pure snapshot stored on GameState.
 * It is passed here (rather than reading GameState directly) so this module
 * remains decoupled from React state and the specific shape of GameState.
 */
export function getVisibleTiles(
  viewport: ViewportState,
  tileQuery: TileQueryFn,
): VisibleTile[][] {
  const rows: VisibleTile[][] = [];
  for (let vy = 0; vy < viewport.tileH; vy++) {
    const row: VisibleTile[] = [];
    for (let vx = 0; vx < viewport.tileW; vx++) {
      const { wx, wy } = viewportToWorld(viewport, vx, vy);
      row.push({ wx, wy, vx, vy, tileInfo: tileQuery(wx, wy) });
    }
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// VIEWPORT INITIALIZATION
// ---------------------------------------------------------------------------

/**
 * Initializes a ViewportState that shows the entire finite map.
 *
 * For Phase B encounters (8×6), the viewport origin is (0, 0) and
 * tileW / tileH equal map.width / map.height — the whole map is visible,
 * and no scrolling occurs. This preserves the existing user experience
 * exactly while establishing the viewport abstraction.
 *
 * Phase C will call setViewport with a different origin when the party
 * moves toward the edge of a larger map.
 */
export function initViewport(map: { width: number; height: number }): ViewportState {
  return {
    originWx: 0,
    originWy: 0,
    tileW:    map.width,
    tileH:    map.height,
  };
}

// ---------------------------------------------------------------------------
// VIEWPORT CLAMPING
// ---------------------------------------------------------------------------

/**
 * Clamps a proposed viewport origin so the visible window stays within the
 * finite world extent.
 *
 * For Phase B (viewport == map size), the clamped origin is always (0, 0).
 * For future phases where the viewport is smaller than the world, clamping
 * prevents the player from scrolling past the world edge.
 *
 * Parameters:
 *   originWx / originWy — proposed new origin (may be out of bounds)
 *   tileW / tileH       — viewport size (tiles)
 *   worldW / worldH     — total world extent in tiles
 *
 * Returns the clamped origin. Never modifies the ViewportState in place —
 * callers construct a new ViewportState from the returned values.
 */
export function clampViewportOrigin(
  originWx: number,
  originWy: number,
  tileW:    number,
  tileH:    number,
  worldW:   number,
  worldH:   number,
): { originWx: number; originWy: number } {
  const maxOriginWx = Math.max(0, worldW - tileW);
  const maxOriginWy = Math.max(0, worldH - tileH);
  return {
    originWx: Math.max(0, Math.min(originWx, maxOriginWx)),
    originWy: Math.max(0, Math.min(originWy, maxOriginWy)),
  };
}
