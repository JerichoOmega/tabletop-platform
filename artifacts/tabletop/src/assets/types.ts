// ---------------------------------------------------------------------------
// ASSET TYPES — shared types for the visual asset layer.
//
// The rules engine never imports from this module. These types exist only
// in the content definition layer (optional `visualAssetId` references) and
// the UI layer (where `resolveAsset` turns IDs into renderable definitions).
// ---------------------------------------------------------------------------

/**
 * Broad category of a visual asset. Used by renderers to pick the right
 * component and by tooling to filter the registry.
 */
export type AssetKind =
  | "character"   // combatant token / portrait
  | "terrain"     // floor / wall / ceiling tile
  | "map"         // full-map backdrop image
  | "prop"        // in-world object (chest, altar, barrel…)
  | "effect"      // transient visual (spell flash, healing sparkle…)
  | "icon";       // UI icon that is not a class-icon placeholder

/**
 * A registered visual asset.
 *
 * `src` is whatever URL or path the renderer should load — a relative public
 * path, a data-URL, or a CDN URL. The registry never fetches or validates it;
 * the renderer handles loading errors and falling back gracefully.
 */
export interface AssetDefinition {
  id:    string;
  kind:  AssetKind;
  src:   string;
  alt?:  string;
}
