// ---------------------------------------------------------------------------
// VISUAL ASSETS BOOTSTRAP
//
// Registers all 44 canonical production assets from the Intelligent Tabletop
// Visual Asset Library into the asset registry.
//
// Import this module once at application startup (main.tsx) — BEFORE React
// renders. Registration is additive; the rules engine is never imported here.
//
// LOCKED ASSETS — Do not regenerate, redesign, rename, or reinterpret any
// registered asset. Only an explicit revision request may change a locked
// canonical asset. See docs/VISUAL_ASSET_LIBRARY.md for the full approval
// record and variant relationships.
//
// Architecture
// ─────────────
//   This module → registerAsset() → registry._registry Map
//                                         ↓
//                                   resolveAsset() in UI layer
//
// Asset directory (Vite public/)
// ───────────────────────────────
//   public/assets/visual/
//     miniatures/                   ← showcase sheet (all 4 miniatures)
//     floors/                       ← individual floor tiles + cobblestone showcase
//     terrain/walls/                ← wall family (Full Wall V1 is master ref)
//     terrain/elevation/            ← stairs, platforms, bridges, chasms
//     props/storage-furniture/      ← barrels, crates, chests, shelves, tables
//     props/interaction-crafting/   ← altar, lever, trapdoor, workbench, anvil
//     props/lighting-decor/         ← torches, brazier, sconce, lantern, banner, rocks
//     references/                   ← non-canonical reference alternates (NOT registered)
//
// Showcase-sheet note
// ────────────────────
// The four miniature assets (character.*) and the five cobblestone floor assets
// (floor.cobblestone-*) are represented by composite showcase sheets rather
// than individually cropped cutouts. Each logical ID points to the full sheet.
// The renderer falls back to placeholder rendering when the full sheet is not
// suitable for a specific display context. Source sheets must not be cropped
// or modified — they are canonical production art.
// ---------------------------------------------------------------------------

import { registerAsset } from "./registry";

/** Constructs an absolute public path from a relative visual-asset path. */
const v = (rel: string): string =>
  `${import.meta.env.BASE_URL}assets/visual/${rel}`;

export function registerCanonicalAssets(): void {
  // ─────────────────────────────────────────────────────────────────────────
  // MINIATURES — 4 assets
  //
  // Canonical source:  miniatures/fantasy-miniature-showcase.png
  // Derived runtime:   miniatures/{human-fighter,human-spellcaster,goblin-warrior,orc-warrior}.png
  //
  // Derived files are deterministic crops of the top half (front views) of
  // the showcase sheet (384×512 per character, equal 4-column split).
  // The source showcase is NOT modified and remains registered as a reference.
  //
  // Existing content-engine IDs (character.fighter etc.) are migrated to the
  // appropriate derived individual files. Behaviour in the live app is unchanged.
  // ─────────────────────────────────────────────────────────────────────────

  // Existing IDs — referenced by COMBATANT_DEFS in engine/content.ts → derived files
  registerAsset({ id: "character.fighter", kind: "character", src: v("miniatures/human-fighter.png"),      alt: "Human Fighter" });
  registerAsset({ id: "character.wizard",  kind: "character", src: v("miniatures/human-spellcaster.png"),  alt: "Human Spellcaster" });
  registerAsset({ id: "character.goblin",  kind: "character", src: v("miniatures/goblin-warrior.png"),     alt: "Goblin Warrior" });
  registerAsset({ id: "character.orc",     kind: "character", src: v("miniatures/orc-warrior.png"),        alt: "Orc Warrior" });

  // Canonical library IDs → derived files
  registerAsset({ id: "character.human-fighter",     kind: "character", src: v("miniatures/human-fighter.png"),     alt: "Human Fighter" });
  registerAsset({ id: "character.human-spellcaster", kind: "character", src: v("miniatures/human-spellcaster.png"), alt: "Human Spellcaster" });
  registerAsset({ id: "character.goblin-warrior",    kind: "character", src: v("miniatures/goblin-warrior.png"),    alt: "Goblin Warrior" });
  registerAsset({ id: "character.orc-warrior",       kind: "character", src: v("miniatures/orc-warrior.png"),       alt: "Orc Warrior" });

  // Source showcase — retained as reference (resolves to full composite sheet)
  registerAsset({ id: "character.showcase-sheet", kind: "character", src: v("miniatures/fantasy-miniature-showcase.png"), alt: "Miniature showcase sheet (canonical source)" });

  // ─────────────────────────────────────────────────────────────────────────
  // FLOOR FAMILY — 6 assets
  //
  // Canonical source:  floors/cobblestone-floor-variant-showcase.png
  // Derived runtime:   floors/{cobblestone-classic,cleaner,overgrown,ruined,dungeon-stone}-v1.png
  //
  // Derived files are deterministic crops of the showcase sheet:
  //   Top row (3 tiles): 512×530 crops at x=0, x=512, x=1024 from y=0
  //   Bottom row (2 tiles): 768×494 crops at x=0, x=768 from y=530
  // The source showcase is NOT modified and remains registered as a reference.
  //
  // Large Floor / Room Tile V1 already has its own individual source file —
  // no derivation needed.
  // ─────────────────────────────────────────────────────────────────────────

  registerAsset({ id: "floor.cobblestone-classic-v1",   kind: "terrain", src: v("floors/cobblestone-classic-v1.png"),   alt: "Cobblestone Classic V1" });
  registerAsset({ id: "floor.cobblestone-cleaner-v1",   kind: "terrain", src: v("floors/cobblestone-cleaner-v1.png"),   alt: "Cobblestone Cleaner V1" });
  registerAsset({ id: "floor.cobblestone-overgrown-v1", kind: "terrain", src: v("floors/cobblestone-overgrown-v1.png"), alt: "Cobblestone Overgrown V1" });
  registerAsset({ id: "floor.cobblestone-ruined-v1",    kind: "terrain", src: v("floors/cobblestone-ruined-v1.png"),    alt: "Cobblestone Ruined V1" });
  registerAsset({ id: "floor.dungeon-stone-v1",         kind: "terrain", src: v("floors/dungeon-stone-v1.png"),         alt: "Dungeon Stone V1" });
  registerAsset({ id: "floor.large-room-tile-v1",       kind: "terrain", src: v("floors/large-floor-room-tile-v1.png"), alt: "Large Floor / Room Tile V1" });

  // Source showcase — retained as reference
  registerAsset({ id: "floor.cobblestone-showcase", kind: "terrain", src: v("floors/cobblestone-floor-variant-showcase.png"), alt: "Cobblestone floor variant showcase (canonical source)" });

  // Existing content-engine terrain IDs — wired to closest canonical derived assets
  registerAsset({ id: "terrain.crypt.floor",        kind: "terrain", src: v("floors/cobblestone-classic-v1.png"),     alt: "Cobblestone floor (crypt)" });
  registerAsset({ id: "terrain.crypt.wall",         kind: "terrain", src: v("terrain/walls/full-wall-v1.png"),        alt: "Full Wall V1 (crypt)" });
  registerAsset({ id: "terrain.crypt.pillar",       kind: "terrain", src: v("terrain/walls/pillar-v1.png"),           alt: "Pillar V1 (crypt)" });
  registerAsset({ id: "terrain.trainingYard.floor", kind: "terrain", src: v("floors/cobblestone-classic-v1.png"),     alt: "Cobblestone floor (training yard)" });
  registerAsset({ id: "terrain.trainingYard.wall",  kind: "terrain", src: v("terrain/walls/full-wall-v1.png"),        alt: "Full Wall V1 (training yard)" });

  // ─────────────────────────────────────────────────────────────────────────
  // TERRAIN / ARCHITECTURE — 13 assets
  //
  // WALL FAMILY — Full Wall V1 is the master reference. All members share
  // the same chunky masonry, bluish-gray stone, capstones, wood/brass
  // hardware, moss treatment, and tabletop scale.
  //
  // Full Wall V1 source: terrain/walls/full-wall-v1.png
  // Broken Wall V1 note: recovered canonical source ("- recovered.png").
  // ─────────────────────────────────────────────────────────────────────────

  registerAsset({ id: "terrain.full-wall-v1",     kind: "terrain", src: v("terrain/walls/full-wall-v1.png"),       alt: "Full Wall V1 — wall family master reference" });
  registerAsset({ id: "terrain.broken-wall-v1",   kind: "terrain", src: v("terrain/walls/broken-wall-v1.png"),     alt: "Broken Wall V1 (recovered canonical source)" });
  registerAsset({ id: "terrain.wall-corner-v1",   kind: "terrain", src: v("terrain/walls/wall-corner-v1.png"),     alt: "Wall Corner V1" });
  registerAsset({ id: "terrain.doorway-v1",        kind: "terrain", src: v("terrain/walls/doorway-v1.png"),         alt: "Doorway V1" });
  registerAsset({ id: "terrain.wall-end-cap-v1",  kind: "terrain", src: v("terrain/walls/wall-end-cap-v1.png"),    alt: "Wall End Cap V1" });
  registerAsset({ id: "terrain.pillar-v1",         kind: "terrain", src: v("terrain/walls/pillar-v1.png"),          alt: "Pillar V1" });
  registerAsset({ id: "terrain.staircase-v1",      kind: "terrain", src: v("terrain/elevation/staircase-v1.png"),   alt: "Staircase V1" });
  registerAsset({ id: "terrain.raised-platform-v1",kind: "terrain", src: v("terrain/elevation/raised-platform-v1.png"), alt: "Raised Platform V1" });
  registerAsset({ id: "terrain.archway-v1",        kind: "terrain", src: v("terrain/walls/archway-v1.png"),         alt: "Archway V1" });
  registerAsset({ id: "terrain.stone-bridge-v1",   kind: "terrain", src: v("terrain/elevation/stone-bridge-v1.png"),alt: "Stone Bridge V1" });
  registerAsset({ id: "terrain.chasm-pit-v1",      kind: "terrain", src: v("terrain/elevation/chasm-pit-v1.png"),   alt: "Chasm / Pit V1" });
  registerAsset({ id: "terrain.cliff-edge-v1",     kind: "terrain", src: v("terrain/elevation/cliff-edge-v1.png"),  alt: "Cliff Edge V1" });
  registerAsset({ id: "terrain.gate-portcullis-v1",kind: "terrain", src: v("terrain/walls/gate-portcullis-v1.png"), alt: "Gate / Portcullis V1" });

  // ─────────────────────────────────────────────────────────────────────────
  // PROPS / ENVIRONMENT OBJECTS — 21 assets
  //
  // Canonical revision notes:
  //   prop.lever-wall-switch-v1  — SMALLER approved version (from 04B package)
  //   prop.anvil-v1              — SMALLER approved version (from 04B package)
  //   prop.crates-supplies-v1   — MORE STYLIZED approved version (from 04A package)
  //
  // Alternate/reference sheets for these three are in references/ and are
  // NOT registered.
  //
  // Banner / Wall Hanging variants (Red/Sun, Blue/Lion, Green/Stag, Black/Skull,
  // White/Temple, Purple/Arcane, Tattered/Worn, Bloodstained) share the same
  // physical source file. The current AssetDefinition interface does not support
  // sub-variants; all eight variations are documented in VISUAL_ASSET_LIBRARY.md
  // as variants of prop.banner-wall-hanging-v1.
  // ─────────────────────────────────────────────────────────────────────────

  registerAsset({ id: "prop.barrel-v1",               kind: "prop", src: v("props/storage-furniture/barrel-v1.png"),              alt: "Barrel V1" });
  registerAsset({ id: "prop.crate-v1",                kind: "prop", src: v("props/storage-furniture/crate-v1.png"),               alt: "Crate V1" });
  registerAsset({ id: "prop.chest-v1",                kind: "prop", src: v("props/storage-furniture/chest-v1.png"),               alt: "Chest V1" });
  registerAsset({ id: "prop.chest-v2",                kind: "prop", src: v("props/storage-furniture/chest-v2.png"),               alt: "Chest V2 — reinforced domed treasure chest" });
  registerAsset({ id: "prop.torch-v1",                kind: "prop", src: v("props/lighting-decor/torch-v1.png"),                  alt: "Torch V1" });
  registerAsset({ id: "prop.rocks-debris-v1",         kind: "prop", src: v("props/lighting-decor/rocks-debris-v1.png"),           alt: "Rocks & Debris V1" });
  registerAsset({ id: "prop.brazier-fire-pit-v1",     kind: "prop", src: v("props/lighting-decor/brazier-fire-pit-v1.png"),       alt: "Brazier / Fire Pit V1" });
  registerAsset({ id: "prop.bookshelf-v1",            kind: "prop", src: v("props/storage-furniture/bookshelf-v1.png"),           alt: "Bookshelf V1" });
  registerAsset({ id: "prop.bookshelf-v2",            kind: "prop", src: v("props/storage-furniture/bookshelf-v2.png"),           alt: "Bookshelf V2 — scholarly/study arrangement" });
  registerAsset({ id: "prop.table-bench-v1",          kind: "prop", src: v("props/storage-furniture/table-bench-v1.png"),         alt: "Table & Bench V1" });
  registerAsset({ id: "prop.table-bench-v2",          kind: "prop", src: v("props/storage-furniture/table-bench-v2.png"),         alt: "Table & Bench V2 — lived-in arrangement with clutter" });
  registerAsset({ id: "prop.weapon-rack-v1",          kind: "prop", src: v("props/storage-furniture/weapon-rack-v1.png"),         alt: "Weapon Rack V1" });
  registerAsset({ id: "prop.altar-v1",                kind: "prop", src: v("props/interaction-crafting/altar-v1.png"),            alt: "Altar V1" });
  registerAsset({ id: "prop.lever-wall-switch-v1",    kind: "prop", src: v("props/interaction-crafting/lever-wall-switch-v1.png"),alt: "Lever / Wall Switch V1 — smaller canonical revision" });
  registerAsset({ id: "prop.trapdoor-floor-hatch-v1", kind: "prop", src: v("props/interaction-crafting/trapdoor-floor-hatch-v1.png"), alt: "Trapdoor / Floor Hatch V1" });
  registerAsset({ id: "prop.banner-wall-hanging-v1",  kind: "prop", src: v("props/lighting-decor/banner-wall-hanging-v1.png"),    alt: "Banner / Wall Hanging V1" });
  registerAsset({ id: "prop.workbench-crafting-table-v1", kind: "prop", src: v("props/interaction-crafting/workbench-crafting-table-v1.png"), alt: "Workbench / Crafting Table V1" });
  registerAsset({ id: "prop.anvil-v1",                kind: "prop", src: v("props/interaction-crafting/anvil-v1.png"),            alt: "Anvil V1 — smaller canonical revision" });
  registerAsset({ id: "prop.crates-supplies-v1",      kind: "prop", src: v("props/storage-furniture/crates-supplies-v1.png"),     alt: "Crates & Supplies V1 — more stylized canonical revision" });
  registerAsset({ id: "prop.wall-sconce-v1",          kind: "prop", src: v("props/lighting-decor/wall-sconce-v1.png"),            alt: "Wall Sconce V1" });
  registerAsset({ id: "prop.lantern-v1",              kind: "prop", src: v("props/lighting-decor/lantern-v1.png"),                alt: "Lantern V1" });
}
