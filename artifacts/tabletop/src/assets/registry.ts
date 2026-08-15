// ---------------------------------------------------------------------------
// ASSET REGISTRY — resolves logical asset IDs to asset definitions.
//
// Architecture
// ────────────
//   Game Content Definition
//         ↓  (optional visualAssetId string)
//   Asset Registry          ← this module
//         ↓  resolveAsset()
//   Renderer / UI
//
// Content definitions (engine/content.ts) reference visual assets through
// stable logical IDs such as "character.fighter" or "terrain.crypt.floor".
// Those IDs are strings only — the rules engine never resolves them. The
// registry maps IDs to AssetDefinitions (src, kind, alt). The UI calls
// resolveAsset() and falls back to the existing placeholder rendering when
// an asset is not yet registered.
//
// To add production art, call registerAsset() here or in a
// platform-specific bootstrap file. Nothing else in the codebase changes.
//
// Usage — UI layer
// ─────────────────
//   const asset = resolveAsset("character.fighter");
//   if (asset) {
//     return <img src={asset.src} alt={asset.alt} />;
//   }
//   return <ClassIcon icon={c.icon} />;   // placeholder fallback
//
// Usage — content definition
// ───────────────────────────
//   fighter: { …, visualAssetId: "character.fighter" }
// ---------------------------------------------------------------------------

import type { AssetDefinition, AssetKind } from "./types";

export type { AssetDefinition, AssetKind };

const _registry = new Map<string, AssetDefinition>();

/** Register (or overwrite) an asset definition under its logical ID. */
export function registerAsset(asset: AssetDefinition): void {
  _registry.set(asset.id, asset);
}

/**
 * Resolve a logical asset ID to its definition.
 *
 * Returns `undefined` when the asset has not been registered yet.
 * **Always** handle the `undefined` case — production art may not exist for
 * every ID, and callers must fall back to placeholder rendering gracefully.
 */
export function resolveAsset(id: string): AssetDefinition | undefined {
  return _registry.get(id);
}

/** Returns `true` when an asset is registered under the given ID. */
export function hasAsset(id: string): boolean {
  return _registry.has(id);
}

/**
 * Returns all currently registered assets, optionally filtered by kind.
 * Useful for debugging and documentation tooling.
 */
export function listAssets(kind?: AssetKind): AssetDefinition[] {
  const all = Array.from(_registry.values());
  return kind ? all.filter((a) => a.kind === kind) : all;
}

/**
 * Remove all registered assets.
 *
 * Intended for use in tests that need a clean registry state.
 * Not for use in application code.
 */
export function clearRegistry(): void {
  _registry.clear();
}

// ---------------------------------------------------------------------------
// RESERVED LOGICAL IDs — canonical IDs for this project's content.
//
// No assets are registered here yet; production art arrives separately.
// The IDs are documented so asset suppliers know exactly what to target.
//
// Character tokens / portraits
//   "character.fighter"            Aldric (Fighter PC)
//   "character.wizard"             Sable (Wizard PC)
//   "character.goblin"             Goblin (enemy)
//   "character.orc"                Orc (enemy)
//
// Terrain — Ruined Crypt
//   "terrain.crypt.floor"          Floor tile (checkerboard pair)
//   "terrain.crypt.wall"           Wall / impassable tile
//   "terrain.crypt.pillar"         Pillar / cover object
//
// Terrain — Training Yard
//   "terrain.trainingYard.floor"   Floor tile
//   "terrain.trainingYard.wall"    Wall tile
//
// Props (future)
//   "prop.crypt.altar"             Decorative altar in the crypt
//   "prop.trainingYard.post"       Training post in the yard
//
// Effects (future)
//   "effect.fireBolt"              Fire Bolt projectile / impact
//   "effect.healingTouch"          Healing Touch restorative sparkle
// ---------------------------------------------------------------------------
