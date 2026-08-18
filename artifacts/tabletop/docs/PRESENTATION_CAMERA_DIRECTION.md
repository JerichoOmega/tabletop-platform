# Intelligent Tabletop — Core Presentation & Camera Direction

_Status: **Design direction locked.** Presentation/camera implementation is a
dedicated FUTURE feature — nothing in this document is a request to build it
now. Its purpose is to keep the architecture compatible so future work does
not accidentally turn Intelligent Tabletop into a conventional
character-centric tactical RPG._

---

## 1. The visual goal

The final experience should feel like:

> "We are sitting around a magical / highly sophisticated fantasy tabletop
> playing a real tabletop RPG."

It should NOT feel like:

> "We are playing a conventional tactical RPG that happens to use miniature
> graphics."

The tabletop itself is part of the identity of the product.

## 2. The Grand Gaming Table is the physical foundation

The canonical asset **`tabletop.grand-gaming-table-v1`**
(`public/assets/visual/tabletop/grand-gaming-table-v1.png`, registered in
`src/assets/visualAssets.ts`, catalogued in `docs/VISUAL_ASSET_LIBRARY.md`
§E1, Locked/Canonical) represents the physical gaming table around which the
players conceptually sit. It is not decorative scenery — it establishes the
physical context of the game.

The intended presentation has two major camera states **within the SAME
physical environment** (never two disconnected scenes):

| State | Framing |
|---|---|
| **Zoomed out — Table View** | The Grand Gaming Table is visible; the surrounding room can be visible; players around the table can eventually be represented; the dungeon exists ON the tabletop. |
| **Zoomed in — Tactical View** | The physical table largely leaves the framing; the camera focuses on the tabletop battlefield: dungeon/map and miniatures. |

## 3. Zoom is a presentation transition, not a mode

Zooming should eventually move continuously between:

```
TABLE VIEW  →  TABLETOP VIEW  →  TACTICAL ENCOUNTER VIEW
```

These are different camera distances, **not separate game modes**. Never
implement a separate "battle scene" that disconnects the dungeon from the
Grand Gaming Table.

(Note: the existing `sessionMode` encounter/exploration distinction is a
GAMEPLAY-state distinction — which rules apply — not a camera/scene
distinction. Both render on the same board surface, which is the correct
shape for this direction.)

## 4. Shared group tactical perspective

The gameplay camera is a **shared tabletop perspective** — the entire group
looking down at the same battlefield (walls, floors, terrain, props,
miniatures, enemies, objectives, tactical positions).

It is NOT a first-person, third-person, character-follow, or any
individual-character camera. The tactical camera must remain **independent of
individual character entities**.

Current-architecture note: `ViewportState` (`src/engine/viewport.ts`) is a
free-standing window over world coordinates, owned by presentation state —
not attached to any entity. `updateViewportForActor()` is a *recentering
convenience* (dead-zone follow of whatever position the caller passes); it
does not bind the camera to a character and must stay that way. Future camera
work extends the viewport/zoom layer; it must never re-anchor the camera to a
character entity.

## 5. Miniatures are tabletop objects

Current phase: miniatures are **STATIC tabletop objects**. They:

- remain on their circular bases,
- have a defined facing/orientation,
- occupy a gameplay position/tile,
- move as complete miniature pieces (base + miniature move together),
- do NOT currently need walking / attack / idle animations.

Conceptual object chain (current phase):

```
Character Entity → Position / Tile → Miniature Representation → Circular Base
```

## 6. Future animation model (do not implement yet)

Eventually:

```
Character Entity → Gameplay State → Miniature Anchor/Base → Animated Visual Representation
```

- The **base remains the gameplay anchor**; animation is layered on top.
- The rules engine must NOT know about walking, attack, idle, death, or spell
  animations. Those belong exclusively to the rendering/animation layer.

Current-architecture note: this separation already holds — the rules engine
(`src/engine/rules.ts`) is pure state + events; the existing `it-anim-*`
effects in `IntelligentTabletop.tsx` are presentation-only CSS classes
triggered from events, never read by gameplay logic. Preserve this boundary.

## 7. Architectural principle (do not reverse)

```
Physical Gaming Table
        ↓
Tabletop Play Surface
        ↓
Modular Dungeon / Battlefield
        ↓
Miniatures + Props + Terrain
        ↓
Gameplay State
```

The rules engine operates on the gameplay state. The renderer presents that
state as a physical tabletop. **Never reverse this relationship** — rendering
concerns must never leak into the rules engine, and gameplay must never be
hard-coded to a full-screen flat map (the board surface must remain embeddable
on the tabletop stage when the camera layer arrives).

## 8. Standing constraints for current development

- Preserve the existing gameplay architecture; do not stop gameplay work to
  build the presentation system.
- Keep `tabletop.grand-gaming-table-v1` registered (asset-registry seam is the
  future camera integration point).
- Keep terrain modular (chunk/tile geometry — never a baked full-map image).
- Keep miniatures represented as static tabletop objects.
- Camera/rendering architecture must not assume an individual-character
  perspective.
- Keep rendering concerns separate from the rules engine.
