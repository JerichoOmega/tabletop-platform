# Intelligent Tabletop — Canonical Visual Asset Library

**Status:** Canonical approved visual source of truth
**Checkpoint:** August 16, 2026
**Current production state:** Paused after Lantern V1
**Next proposed asset:** Notice Board / Quest Board V1

> Locked assets are canonical. Do not redesign, regenerate, replace, or reinterpret a locked asset unless an explicit revision is requested.

---

# 1. Established Visual Language

The Intelligent Tabletop environment uses a **stylized 3D fantasy tabletop miniature aesthetic**, not photorealism.

All approved assets share:

- Stylized, hand-painted 3D appearance
- Strong, readable silhouettes
- Slightly exaggerated proportions
- Chunky, tactile geometry
- Premium fantasy tabletop miniature presentation
- Bluish-gray stone
- Dark/weathered wood
- Restrained brass/bronze hardware
- Moss, grass, dirt, and subtle environmental wear
- Consistent miniature scale and base treatment
- Dramatic but controlled studio lighting

**Do not make future assets hyper-realistic.** The stylized miniature appearance is intentional and approved.

---

# 2. Critical Wall-Family Rule

**Full Wall V1 is the visual master reference for the entire wall family.**

The following must look like they were literally constructed from the same wall system:

- Full Wall V1
- Broken Wall V1
- Wall Corner V1
- Doorway V1
- Wall End Cap V1
- Pillar V1
- Archway V1
- Gate / Portcullis V1
- Related future wall-system extensions

They must share:

- Same chunky masonry
- Same bluish-gray stone
- Same capstones
- Same wood reinforcement
- Same brass/metal bands and hardware
- Same proportions
- Same moss/ground treatment
- Same tabletop scale

**Do not redesign the wall when creating a modular extension.** Treat the existing wall as the established construction system and transform it into the required modular piece.

---

# 3. Locked Miniatures

These are generic tabletop pieces, **not named characters**.

Character names will eventually come from player ID or a player-selected character name.

| # | Asset | Canonical ID | Source File | Runtime IDs (live app) | Status |
|---|---|---|---|---|---|
| 1 | Human Fighter | `character.human-fighter` | `miniatures/fantasy-miniature-showcase.png` | `character.fighter` | Locked / Canonical |
| 2 | Human Spellcaster | `character.human-spellcaster` | `miniatures/fantasy-miniature-showcase.png` | `character.wizard` | Locked / Canonical |
| 3 | Goblin Warrior | `character.goblin-warrior` | `miniatures/fantasy-miniature-showcase.png` | `character.goblin` | Locked / Canonical |
| 4 | Orc Warrior | `character.orc-warrior` | `miniatures/fantasy-miniature-showcase.png` | `character.orc` | Locked / Canonical |

**Miniature count: 4**

**Source note:** All four miniatures are represented by a single composite showcase sheet (`Fantasy Miniature Showcase Sheet.png`). Each character ID resolves to the full sheet — it has not been cropped. This is intentional: the showcase is the canonical production artwork. When per-character cutouts are needed for UI tokens, they must be produced from the source sheet without altering it.

---

# 4. Locked Floor Family

Each floor variant is its own independent production asset.

| # | Asset | Canonical ID | Source File | Status |
|---|---|---|---|---|
| 5 | Cobblestone Classic V1 | `floor.cobblestone-classic-v1` | `floors/cobblestone-floor-variant-showcase.png` | Locked / Canonical |
| 6 | Cobblestone Cleaner V1 | `floor.cobblestone-cleaner-v1` | `floors/cobblestone-floor-variant-showcase.png` | Locked / Canonical |
| 7 | Cobblestone Overgrown V1 | `floor.cobblestone-overgrown-v1` | `floors/cobblestone-floor-variant-showcase.png` | Locked / Canonical |
| 8 | Cobblestone Ruined V1 | `floor.cobblestone-ruined-v1` | `floors/cobblestone-floor-variant-showcase.png` | Locked / Canonical |
| 9 | Dungeon Stone V1 | `floor.dungeon-stone-v1` | `floors/cobblestone-floor-variant-showcase.png` | Locked / Canonical |
| 10 | Large Floor / Room Tile V1 | `floor.large-room-tile-v1` | `floors/large-floor-room-tile-v1.png` | Locked / Canonical |

**Floor asset count: 6**

**Source note:** Cobblestone Classic, Cleaner, Overgrown, Ruined, and Dungeon Stone are represented by a single variant showcase sheet. Large Floor / Room Tile V1 has its own individual file.

---

# 5. Locked Terrain / Architecture

## 5.1 Wall Family (master reference: Full Wall V1)

| # | Asset | Canonical ID | Source File | Status |
|---|---|---|---|---|
| 11 | Full Wall V1 | `terrain.full-wall-v1` | `terrain/walls/full-wall-v1.png` | Locked / Canonical — **Master Wall Reference** |
| 12 | Broken Wall V1 | `terrain.broken-wall-v1` | `terrain/walls/broken-wall-v1.png` | Locked / Canonical (recovered source) |
| 13 | Wall Corner V1 | `terrain.wall-corner-v1` | `terrain/walls/wall-corner-v1.png` | Locked / Canonical |
| 14 | Doorway V1 | `terrain.doorway-v1` | `terrain/walls/doorway-v1.png` | Locked / Canonical |
| 15 | Wall End Cap V1 | `terrain.wall-end-cap-v1` | `terrain/walls/wall-end-cap-v1.png` | Locked / Canonical |
| 16 | Pillar V1 | `terrain.pillar-v1` | `terrain/walls/pillar-v1.png` | Locked / Canonical |
| 19 | Archway V1 | `terrain.archway-v1` | `terrain/walls/archway-v1.png` | Locked / Canonical |
| 23 | Gate / Portcullis V1 | `terrain.gate-portcullis-v1` | `terrain/walls/gate-portcullis-v1.png` | Locked / Canonical |

## 5.2 Elevation / Traversal

| # | Asset | Canonical ID | Source File | Status |
|---|---|---|---|---|
| 17 | Staircase V1 | `terrain.staircase-v1` | `terrain/elevation/staircase-v1.png` | Locked / Canonical |
| 18 | Raised Platform V1 | `terrain.raised-platform-v1` | `terrain/elevation/raised-platform-v1.png` | Locked / Canonical |
| 20 | Stone Bridge V1 | `terrain.stone-bridge-v1` | `terrain/elevation/stone-bridge-v1.png` | Locked / Canonical |
| 21 | Chasm / Pit V1 | `terrain.chasm-pit-v1` | `terrain/elevation/chasm-pit-v1.png` | Locked / Canonical |
| 22 | Cliff Edge V1 | `terrain.cliff-edge-v1` | `terrain/elevation/cliff-edge-v1.png` | Locked / Canonical |

**Terrain / architecture count: 13**

---

# 6. Locked Props / Environment Objects

## 6.1 Storage / Furniture

| # | Asset | Canonical ID | Source File | Notes | Status |
|---|---|---|---|---|---|
| 24 | Barrel V1 | `prop.barrel-v1` | `props/storage-furniture/barrel-v1.png` | | Locked / Canonical |
| 25 | Crate V1 | `prop.crate-v1` | `props/storage-furniture/crate-v1.png` | | Locked / Canonical |
| 26 | Chest V1 | `prop.chest-v1` | `props/storage-furniture/chest-v1.png` | | Locked / Canonical |
| 27 | Chest V2 | `prop.chest-v2` | `props/storage-furniture/chest-v2.png` | Reinforced domed treasure chest | Locked / Canonical |
| 31 | Bookshelf V1 | `prop.bookshelf-v1` | `props/storage-furniture/bookshelf-v1.png` | | Locked / Canonical |
| 32 | Bookshelf V2 | `prop.bookshelf-v2` | `props/storage-furniture/bookshelf-v2.png` | Scholarly/study arrangement | Locked / Canonical |
| 33 | Table & Bench V1 | `prop.table-bench-v1` | `props/storage-furniture/table-bench-v1.png` | | Locked / Canonical |
| 34 | Table & Bench V2 | `prop.table-bench-v2` | `props/storage-furniture/table-bench-v2.png` | Lived-in with food, maps, clutter | Locked / Canonical |
| 35 | Weapon Rack V1 | `prop.weapon-rack-v1` | `props/storage-furniture/weapon-rack-v1.png` | | Locked / Canonical |
| 42 | Crates & Supplies V1 | `prop.crates-supplies-v1` | `props/storage-furniture/crates-supplies-v1.png` | **More stylized revision** — do not revert to earlier realistic version | Locked / Canonical |

## 6.2 Interaction / Crafting

| # | Asset | Canonical ID | Source File | Notes | Status |
|---|---|---|---|---|---|
| 36 | Altar V1 | `prop.altar-v1` | `props/interaction-crafting/altar-v1.png` | | Locked / Canonical |
| 37 | Lever / Wall Switch V1 | `prop.lever-wall-switch-v1` | `props/interaction-crafting/lever-wall-switch-v1.png` | **Smaller revision** — do not revert to earlier oversized version | Locked / Canonical |
| 38 | Trapdoor / Floor Hatch V1 | `prop.trapdoor-floor-hatch-v1` | `props/interaction-crafting/trapdoor-floor-hatch-v1.png` | | Locked / Canonical |
| 40 | Workbench / Crafting Table V1 | `prop.workbench-crafting-table-v1` | `props/interaction-crafting/workbench-crafting-table-v1.png` | | Locked / Canonical |
| 41 | Anvil V1 | `prop.anvil-v1` | `props/interaction-crafting/anvil-v1.png` | **Smaller revision** — do not revert to earlier oversized version | Locked / Canonical |

## 6.3 Lighting / Decor

| # | Asset | Canonical ID | Source File | Status |
|---|---|---|---|---|
| 28 | Torch V1 | `prop.torch-v1` | `props/lighting-decor/torch-v1.png` | Locked / Canonical |
| 30 | Brazier / Fire Pit V1 | `prop.brazier-fire-pit-v1` | `props/lighting-decor/brazier-fire-pit-v1.png` | Locked / Canonical |
| 29 | Rocks & Debris V1 | `prop.rocks-debris-v1` | `props/lighting-decor/rocks-debris-v1.png` | Locked / Canonical |
| 39 | Banner / Wall Hanging V1 | `prop.banner-wall-hanging-v1` | `props/lighting-decor/banner-wall-hanging-v1.png` | Locked / Canonical |
| 43 | Wall Sconce V1 | `prop.wall-sconce-v1` | `props/lighting-decor/wall-sconce-v1.png` | Locked / Canonical |
| 44 | Lantern V1 | `prop.lantern-v1` | `props/lighting-decor/lantern-v1.png` | Locked / Canonical |

**Props / environment object count: 21**

---

# 7. Approved Variation Families

These are approved variations of established asset families. They preserve the same base construction language.

## 7.1 Bookshelf Family

Both use the same physical bookshelf construction.

| Variant | ID | Description |
|---|---|---|
| Bookshelf V1 | `prop.bookshelf-v1` | Original approved arrangement |
| Bookshelf V2 | `prop.bookshelf-v2` | Denser scholarly/study dressing |

---

## 7.2 Table & Bench Family

Both use the same physical furniture construction.

| Variant | ID | Description |
|---|---|---|
| Table & Bench V1 | `prop.table-bench-v1` | Clean/general-purpose arrangement |
| Table & Bench V2 | `prop.table-bench-v2` | Lived-in with food, drink, maps, documents, candles |

---

## 7.3 Chest Family

| Variant | ID | Description |
|---|---|---|
| Chest V1 | `prop.chest-v1` | Original approved chest |
| Chest V2 | `prop.chest-v2` | Reinforced domed treasure chest with heavier iron banding |

---

## 7.4 Banner / Wall Hanging Family

**`prop.banner-wall-hanging-v1`** is the standardized physical mounting system.

The following visual variations are approved and should be preserved:

| Variation | Description |
|---|---|
| Red / Sun | Warm red banner with sun/sunburst identity |
| Blue / Lion | Blue banner with lion identity |
| Green / Stag | Green banner with stag identity |
| Black / Skull | Black banner with skull identity |
| White / Temple | White banner with temple/religious identity |
| Purple / Arcane | Purple banner with arcane/magical identity |
| Tattered / Worn | Damaged, weathered banner treatment |
| Bloodstained | Combat-damaged/bloodstained banner treatment |

**Note:** All eight variations share the same source file (`props/lighting-decor/banner-wall-hanging-v1.png`). The current `AssetDefinition` interface does not support sub-variants. All eight are documented here as approved visual variants of `prop.banner-wall-hanging-v1`. Producing distinct runtime assets for each variation requires separate cutout artwork from the source.

---

# 8. Current Library Count

| Category | Locked Assets |
|---|---:|
| Miniatures | 4 |
| Floor family | 6 |
| Terrain / architecture | 13 |
| Props / environment objects | 21 |
| **Total canonical production assets** | **44** |

Approved visual variations are documented separately as members of their respective asset families and are not counted as additional physical base assets.

---

# 9. What the Library Can Now Build

The current asset set supports:

- Dungeon rooms
- Corridors
- Open passages
- Enclosed rooms
- Broken/ruined structures
- Elevated rooms
- Stairs
- Platforms
- Cliff edges
- Chasms/pits
- Bridges
- Gates and barriers
- Storage areas
- Taverns/camps
- Libraries/studies
- Armories
- Workshops/blacksmith areas
- Ritual spaces
- Environmental lighting
- Faction/environmental identity
- Basic interactive mechanisms
- Loot/storage locations
- Environmental storytelling

The project has moved from individual terrain pieces to establishing a **modular tabletop environment system**.

---

# 10. Runtime Asset Registry Boundary

The visual asset library and the runtime asset registry are related but separate concerns.

## Registration state

All 44 canonical assets are **registered** in the runtime registry as of the current integration.

Registration is performed in `src/assets/visualAssets.ts`, called once at application startup from `src/main.tsx`.

## ID mapping

The live application currently references character assets via shorter IDs:

| Content engine ID | Canonical library ID | Asset |
|---|---|---|
| `character.fighter` | `character.human-fighter` | Human Fighter |
| `character.wizard` | `character.human-spellcaster` | Human Spellcaster |
| `character.goblin` | `character.goblin-warrior` | Goblin Warrior |
| `character.orc` | `character.orc-warrior` | Orc Warrior |

Both ID sets are registered and resolve to the same source file. The content-engine IDs (`character.fighter` etc.) are the live runtime IDs and must not be removed.

Terrain encounter IDs (`terrain.crypt.floor`, `terrain.crypt.wall`, `terrain.crypt.pillar`, `terrain.trainingYard.floor`, `terrain.trainingYard.wall`) are also registered and wired to the closest canonical assets.

## Architecture

The rules engine remains visual-asset agnostic. `engine/content.ts` references asset IDs as opaque strings only. `src/assets/visualAssets.ts` is UI-layer bootstrap — it never imports from the rules engine.

---

# 11. Canonical Approval Workflow

### "Show me"
Generate the next proposed asset for visual review.

### "Lock it in"
The exact approved version becomes canonical.

### Explicit revision request
Only an explicit revision request permits redesign/regeneration of a locked asset.

### Locked asset rule
Never casually regenerate or reinterpret an already locked asset.

---

# 12. Current Pause Point

The visual production pass is intentionally paused after:

**Lantern V1 — Locked**

The next proposed asset is:

**Notice Board / Quest Board V1**

No additional asset should be generated until the project resumes the asset-production workflow.

---

# 13. Important Style Corrections Already Established

The following lessons are now canonical:

- Avoid photorealistic/PBR-heavy presentation when it conflicts with the stylized miniature aesthetic.
- Prefer chunky, readable, slightly exaggerated forms.
- Keep assets visually compatible with the approved collection rather than independently designing each object.
- When an asset is a variation, preserve the underlying physical construction and change only the intended dressing/configuration.
- Small interactive props such as Lever / Wall Switch V1 and Anvil V1 should remain appropriately scaled for tabletop use. **Use the smaller approved revisions.**
- Crates & Supplies V1 specifically uses the **more stylized approved revision**.
- Wall-family extensions must derive visually from Full Wall V1 rather than inventing new masonry systems.

---

# 14. Repository Context

**Repository:** `JerichoOmega/tabletop-platform`

The application is a React + Vite + TypeScript tabletop platform with the architectural separation:

**Content → Rules Engine → Intent → UI**

The repository also uses Vitest and Playwright.

## File locations

```
public/assets/visual/
  miniatures/
    fantasy-miniature-showcase.png          ← all 4 miniature pieces
  floors/
    cobblestone-floor-variant-showcase.png  ← cobblestone classic/cleaner/overgrown/ruined + dungeon stone
    large-floor-room-tile-v1.png
  terrain/
    walls/
      full-wall-v1.png                      ← WALL FAMILY MASTER REFERENCE
      broken-wall-v1.png                    ← recovered canonical source
      wall-corner-v1.png
      doorway-v1.png
      wall-end-cap-v1.png
      pillar-v1.png
      archway-v1.png
      gate-portcullis-v1.png
    elevation/
      staircase-v1.png
      raised-platform-v1.png
      stone-bridge-v1.png
      chasm-pit-v1.png
      cliff-edge-v1.png
  props/
    storage-furniture/
      barrel-v1.png
      crate-v1.png
      chest-v1.png
      chest-v2.png
      bookshelf-v1.png
      bookshelf-v2.png
      table-bench-v1.png
      table-bench-v2.png
      weapon-rack-v1.png
      crates-supplies-v1.png               ← more stylized canonical revision
    interaction-crafting/
      altar-v1.png
      lever-wall-switch-v1.png             ← smaller canonical revision
      trapdoor-floor-hatch-v1.png
      workbench-crafting-table-v1.png
      anvil-v1.png                         ← smaller canonical revision
    lighting-decor/
      torch-v1.png
      brazier-fire-pit-v1.png
      wall-sconce-v1.png
      lantern-v1.png
      banner-wall-hanging-v1.png
      rocks-debris-v1.png
  references/                              ← NOT registered, for revision comparison only
    ref-lever-wall-switch-alternate.png
    ref-raised-platform-alternate.png
    ref-broken-wall-recovered-source.png
    ref-weapon-rack-alternate.png
    ref-crates-supplies-alternate.png
    ref-anvil-alternate.png
```

## Code locations

```
src/assets/types.ts          ← AssetDefinition, AssetKind types
src/assets/registry.ts       ← registerAsset(), resolveAsset(), hasAsset(), listAssets()
src/assets/visualAssets.ts   ← canonical asset registration bootstrap (44 assets)
src/main.tsx                 ← calls registerCanonicalAssets() at startup
```
