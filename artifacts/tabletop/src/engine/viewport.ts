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
// Phase B invariants (still apply):
//   • tileW = map.width, tileH = map.height — the entire 8×6 map is visible.
//   • getVisibleTiles() + VisibleTile carry authoritative wx/wy for the renderer.
//
// Phase C additions (this file):
//   • DEAD_ZONE_MARGIN — inner follow-zone margin in tiles.
//   • updateViewportForActor() — pure dead-zone + recenter policy.
//     For current 8×6 small maps, clamping ensures the origin always stays at
//     (0, 0) so no user-visible change occurs yet (spec §8 invariant).
//     Phase E+ will exercise this with larger maps.
//
// Phase F will introduce chunk-backed TileQueryFn.
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
 * Phase D: maxTileW / maxTileH cap the viewport to a fixed presentation
 * surface smaller than the world. Both parameters default to the map's
 * full dimensions so all existing callers without arguments are unchanged.
 * `Math.min` ensures the viewport never exceeds the world in either axis.
 *
 * Example — 40×40 world with 12×10 cap:
 *   tileW = min(12, 40) = 12,  tileH = min(10, 40) = 10  →  world > viewport ✓
 * Example — 8×6 world with 12×10 cap:
 *   tileW = min(12,  8) =  8,  tileH = min(10,  6) =  6  →  unchanged ✓
 */
export function initViewport(
  map:       { width: number; height: number },
  maxTileW = map.width,
  maxTileH = map.height,
): ViewportState {
  return {
    originWx: 0,
    originWy: 0,
    tileW:    Math.min(maxTileW, map.width),
    tileH:    Math.min(maxTileH, map.height),
  };
}

// ---------------------------------------------------------------------------
// VIEWPORT FOLLOW POLICY — pure dead-zone + recenter logic (Phase C).
// ---------------------------------------------------------------------------

/**
 * The number of tiles from each viewport edge that form the dead zone.
 *
 * Recommended initial value from spec §6.5. The active actor can move
 * within the inner rectangle without the viewport recentering.
 *
 * For current 8×6 encounters the Y dead zone is degenerate (tileH=6,
 * 2×margin=6 → no interior space). updateViewportForActor handles this
 * correctly: the recenter is computed, but clamping forces the origin back
 * to (0, 0) — so no user-visible change occurs for small maps (spec §8).
 */
export const DEAD_ZONE_MARGIN = 3;

/**
 * Computes the viewport state that should follow the given actor.
 *
 * Dead-zone policy (spec §6.5, §7.2):
 *
 *   If the actor is inside the inner dead zone, the viewport is unchanged.
 *   If the actor is outside the dead zone, the viewport recenters on the
 *   actor (snap — no animation; tactical mode per spec §6.6).
 *   The resulting origin is clamped to the finite world bounds.
 *
 * When the dead zone is degenerate in a dimension (tileW or tileH ≤
 * 2 × deadZoneMargin), the actor is always considered outside that
 * dimension's boundary and a recenter is computed — but clamping
 * prevents actual origin movement on small finite maps, so no re-render
 * is triggered (the function returns the same reference).
 *
 * Return value:
 *   • Same ViewportState reference if origin is unchanged (React skips
 *     re-render via Object.is bail-out on state updates).
 *   • New ViewportState object if the origin changed.
 *
 * Caller contract:
 *   • Must NEVER mutate GameState or combatant positions.
 *   • Must NEVER call React state setters or access the DOM.
 *   • Must be called with authoritative (wx, wy) from GameState.
 *   • worldW / worldH are the finite map extent for clamping.
 */
export function updateViewportForActor(
  viewport:        ViewportState,
  actorWx:         number,
  actorWy:         number,
  worldW:          number,
  worldH:          number,
  deadZoneMargin = DEAD_ZONE_MARGIN,
): ViewportState {
  // ── Dead-zone bounds (world coordinates) ─────────────────────────────────
  const dzMinWx = viewport.originWx + deadZoneMargin;
  const dzMaxWx = viewport.originWx + viewport.tileW - deadZoneMargin - 1;
  const dzMinWy = viewport.originWy + deadZoneMargin;
  const dzMaxWy = viewport.originWy + viewport.tileH - deadZoneMargin - 1;

  // ── Dead-zone test ────────────────────────────────────────────────────────
  // Both dimensions must form a valid (non-empty) range AND the actor must
  // be inside the full 2-D rectangle. If either dimension is degenerate
  // (dzMin > dzMax), the actor is always outside and a recenter is computed.
  const insideDeadZone =
    dzMinWx <= dzMaxWx &&
    dzMinWy <= dzMaxWy &&
    actorWx >= dzMinWx && actorWx <= dzMaxWx &&
    actorWy >= dzMinWy && actorWy <= dzMaxWy;

  if (insideDeadZone) return viewport; // same reference → no React re-render

  // ── Recenter: place actor at logical center of viewport ───────────────────
  const targetOriginWx = actorWx - Math.floor(viewport.tileW / 2);
  const targetOriginWy = actorWy - Math.floor(viewport.tileH / 2);

  const { originWx, originWy } = clampViewportOrigin(
    targetOriginWx, targetOriginWy,
    viewport.tileW, viewport.tileH,
    worldW, worldH,
  );

  // If clamping produces the same origin (typical for small maps where
  // clamping forces 0,0 regardless of the desired center), return the same
  // reference so React does not schedule an unnecessary re-render.
  if (originWx === viewport.originWx && originWy === viewport.originWy) return viewport;

  return { ...viewport, originWx, originWy };
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
