---
name: Viewport architecture
description: Phase 3 World-Scale / Viewport design decisions and invariants. ViewportState is presentation-only; VisibleTile carries authoritative world coords.
---

## Phase B — complete (commit 0eac85d)

### Core rule
`ViewportState` is **never** placed in `GameState`. It lives as React state (`useState`) in the UI layer only. The rules engine, parser, and content module have zero knowledge of it.

**Why:** Rules correctness must be independent of what portion of the world is visible. Mixing viewport into GameState would corrupt RNG snapshots, cloneState, and replay.

### Coordinate chain
```
World Space (wx, wy) — authoritative, rules engine only
  ↓ viewportToWorld / worldToViewport
Viewport-relative logical tiles (vx, vy)
  ↓ multiply by cellPx (renderer only)
Screen pixels
```

### VisibleTile invariant
Every `VisibleTile` always carries `wx`/`wy` (world coord) alongside `vx`/`vy` (display position). The renderer **must** use `tile.wx, tile.wy` for:
- token lookup (`tokensByTile[key(tile.wx, tile.wy)]`)
- reachability set (`reachSet.has(key(tile.wx, tile.wy))`)
- move destination passed to rules engine

Never substitute `vx/vy` for a world coordinate in any rules call.

### findCoverTile (parser.ts)
Uses `tileQuery(wx, wy).providesCover` with 8-neighbor (Chebyshev-1) scan. Does NOT read `MapDef.pillars` directly — Phase F chunk data automatically provides cover without changing this function.

### Phase B invariants
- `originWx = 0, originWy = 0` for all current 8×6 encounters
- `tileW = map.width, tileH = map.height` — whole map always visible
- `newEncounter()` resets viewport via `setViewport(initViewport(next.map))`

### Files
- `src/engine/viewport.ts` — pure functions: `ViewportState`, `VisibleTile`, `worldToViewport`, `viewportToWorld`, `getVisibleTiles`, `initViewport`, `clampViewportOrigin`
- `src/IntelligentTabletop.tsx` — `viewport` state, `visibleTiles` memo, board renderer loop
- `src/intent/parser.ts` — `findCoverTile` via tileQuery

### Next phases
- **Phase C**: viewport following — camera tracks party leader toward map edges (non-zero origin)
- **Phase F**: chunk-backed geometry — `tileQuery` wraps chunk data; viewport/rules code unchanged

### Build notes
Production build (`pnpm build`) requires `PORT` and `BASE_PATH` env vars:
```sh
PORT=5173 BASE_PATH=/tabletop pnpm build
```
