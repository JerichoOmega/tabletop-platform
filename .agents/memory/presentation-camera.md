---
name: Presentation & camera direction
description: Locked visual/architecture direction for Intelligent Tabletop's future camera/presentation layer
---

# Presentation & camera direction (locked)

Authoritative doc: `artifacts/tabletop/docs/PRESENTATION_CAMERA_DIRECTION.md`.

Rules every future feature must respect:
- Grand Gaming Table (`tabletop.grand-gaming-table-v1`, Locked/Canonical) is the physical foundation; dungeon exists ON the tabletop; one physical environment, never two disconnected scenes.
- Zoom (table → tabletop → tactical) is a continuous presentation transition, NOT separate game modes; never build a disconnected "battle scene".
- Camera is a shared group tabletop perspective — never first/third-person or bound to a character entity. `updateViewportForActor` is a recentering convenience only.
- Miniatures are static tabletop objects on circular bases (current phase); base = gameplay anchor; animation is a future rendering-layer concern the rules engine must never know about.
- Hierarchy: physical table → play surface → modular dungeon → miniatures → gameplay state; renderer presents state, never the reverse. Don't hard-code gameplay to a full-screen flat map.

**Why:** product identity is "sitting around a magical fantasy tabletop", not "tactical RPG with miniature graphics".
**How to apply:** check any camera/rendering/animation/scene work against the doc before implementing; keep rendering out of engine/rules.
