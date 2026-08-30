// ---------------------------------------------------------------------------
// CONTENT — static data definitions, RNG utilities, and encounter factory.
//
// This is the "world data" layer. Nothing here is rules logic. Content
// designers edit this file; the engine and intent parser only ever READ it.
//
// Dependency: equipment.ts (canonical item registry and weapon projection).
// ---------------------------------------------------------------------------

import {
  createEquipmentLoadout,
  getEffectiveMoveMax,
  WEAPON_DEFS as CANONICAL_WEAPON_DEFS,
} from "./equipment";
import type { EquipmentLoadout, EquipmentLoadoutSeed } from "./equipment";

// ---------------------------------------------------------------------------
// SHARED TYPES — exported for use by rules.ts, intent/parser.ts, and the UI.
// ---------------------------------------------------------------------------

export interface Weapon {
  name: string;
  range: number;
  dmgDie: number;
  dmgMod: number;
}

export interface Combatant {
  // ── Three-layer identity (Phase A: worldId added as optional) ──────────
  id:       string;   // encounter-local key in GameState.combatants
  defId:    string;   // content/template identity — references COMBATANT_DEFS
  worldId?: string;   // persistent world identity — future foreign key into WorldState
                      //   Undefined for all Phase 2 encounters and test fixtures.
                      //   Populated in Phase G when WorldState is introduced.
  name: string;
  cls: string;
  type: "pc" | "enemy";
  icon: string;
  // ── World coordinates (renamed from x/y in Phase A) ─────────────────────
  wx: number;         // world tile x — 0-based, integer (was: x)
  wy: number;         // world tile y — 0-based, integer (was: y)
  hp: number;
  maxHp: number;
  ac: number;
  atkMod: number;
  dexMod: number;
  moveMax: number;
  moveRemaining: number;
  weapon: Weapon;
  abilities: string[];
  alive: boolean;
  actionUsed: boolean;
  /** RPG-owned equipment snapshot used by authoritative combat rules. */
  equipment: EquipmentLoadout;
}

export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  entrance: { x: number; y: number };
  pillars: { x: number; y: number }[];
  /**
   * Logical asset IDs for terrain tile types in this map.
   * All fields are optional — unregistered or absent IDs fall back to the
   * current CSS/inline-style rendering. The rules engine never reads this.
   */
  visualAssets?: {
    floor?:  string;  // e.g. "terrain.crypt.floor"
    wall?:   string;  // e.g. "terrain.crypt.wall"
    pillar?: string;  // e.g. "terrain.crypt.pillar"
  };
}

export interface InitiativeEntry {
  id: string;
  total: number;
}

// ---------------------------------------------------------------------------
// TILE QUERY TYPES — Phase A: TileInfo + TileQueryFn abstraction.
//
// The rules engine receives a TileQueryFn rather than a raw MapDef.
// This decouples the rules from any specific map storage format and is the
// foundation for Phase F (chunk streaming) and Phase G (persistent world).
//
// TileInfo field reference:
//   type          passable  blocksLOS  providesCover  notes
//   ─────────────────────────────────────────────────────────────────────
//   "floor"       true      false      false          normal traversable tile
//   "wall"        false     true       false          border/solid obstruction
//   "pillar"      false     false      true           blocks movement, cover only
//   "void"        false     true       false          unloaded chunk or world edge
//   "door_open"   true      false      false          passable, no cover
//   "door_closed" false     true       false          treated as wall until opened
//
// INVARIANT: A TileQueryFn must be a pure, stable snapshot for the lifetime
// of the GameState it was created alongside. It must NEVER close over a mutable
// live data structure. The rules engine depends on deterministic tile lookups
// regardless of viewport position, chunk cache state, or React render timing.
// ---------------------------------------------------------------------------

export interface TileInfo {
  passable:      boolean;
  blocksLOS:     boolean;
  providesCover: boolean;
  type: "floor" | "wall" | "pillar" | "void" | "door_open" | "door_closed";
}

/** Pure, stable snapshot function: given world tile coords, returns tile info. */
export type TileQueryFn = (wx: number, wy: number) => TileInfo;

/**
 * Adapts a MapDef to the TileQueryFn interface used by the rules engine.
 *
 * Wall rule: a tile is a wall if it is a border tile AND is not the entrance.
 * Pillar rule: tile appears in map.pillars[]. Passable=false, blocksLOS=false.
 * Out-of-bounds: returns "void" (safe impassable default).
 *
 * The returned function closes over the MapDef, which is a static value that
 * never mutates during a combat encounter — the determinism invariant is
 * automatically satisfied in Phase A.
 *
 * Pillar lookup uses a precomputed Set<string> (keyed by "x,y") for O(1)
 * lookup instead of the previous O(n) Array.some() scan. Behavior is
 * identical — this is a data-structure correction required by the Phase F
 * geometry architecture, not a gameplay change. See Phase F migration notes
 * in WORLD_SCALE_VIEWPORT.md §25.
 */
export function mapDefToTileQuery(map: MapDef): TileQueryFn {
  // Precompute pillar positions as a Set for O(1) lookup.
  // The key format "x,y" matches the existing rules.ts key() convention.
  const pillarSet = new Set<string>(map.pillars.map((p) => p.x + "," + p.y));

  return (wx: number, wy: number): TileInfo => {
    if (wx < 0 || wy < 0 || wx >= map.width || wy >= map.height) {
      return { passable: false, blocksLOS: true, providesCover: false, type: "void" };
    }
    const border = wx === 0 || wx === map.width - 1 || wy === 0 || wy === map.height - 1;
    if (border && !(wx === map.entrance.x && wy === map.entrance.y)) {
      return { passable: false, blocksLOS: true, providesCover: false, type: "wall" };
    }
    if (pillarSet.has(wx + "," + wy)) {
      return { passable: false, blocksLOS: false, providesCover: true, type: "pillar" };
    }
    return { passable: true, blocksLOS: false, providesCover: false, type: "floor" };
  };
}

export interface GameState {
  started: boolean;
  encounterId: string;
  encounterName: string;
  map: MapDef;
  /**
   * Stable geometry snapshot for this GameState. The rules engine uses this
   * exclusively for tile lookups — never MapDef.walls or isWall/isPillar directly.
   *
   * Shared by reference in cloneState() — safe because the function is immutable
   * for the lifetime of the state (closes over a static MapDef in Phase A).
   *
   * Phase F will replace or augment this with a chunk-backed query when world
   * streaming is introduced.
   */
  tileQuery: TileQueryFn;
  round: number;
  turnOrder: string[];
  initiativeRolls: InitiativeEntry[];
  turnIndex: number;
  combatants: Record<string, Combatant>;
  log: string[];
  seed: number;
}

// ---------------------------------------------------------------------------
// INTERNAL DEFINITION TYPES — not exported; only used within this file.
// ---------------------------------------------------------------------------

interface WeaponDef {
  id: string;
  name: string;
  range: number;
  dmgDie: number;
  dmgMod: number;
}

interface CombatantDef {
  id: string;
  name: string;
  cls: string;
  type: "pc" | "enemy";
  icon: string;
  maxHp: number;
  ac: number;
  atkMod: number;
  dexMod: number;
  moveMax: number;
  weaponId: string;
  equipment?: Omit<EquipmentLoadoutSeed, "weaponId">;
  abilities?: string[];
  /**
   * Stable logical ID into the asset registry (e.g. "character.fighter").
   * When a visual asset is registered under this ID, the UI renders it
   * instead of the icon placeholder. The rules engine never reads this field.
   */
  visualAssetId?: string;
}

export interface AbilityEffect {
  type: "heal" | "damage";
  die: number;
  mod: number;
}

export interface AbilityDef {
  id: string;
  name: string;
  range: number;
  targeting: "self" | "ally" | "enemy" | "any";
  effect: AbilityEffect;
  requiresLineOfSight?: boolean;
}

interface EncounterEntry {
  defId: string;
  instanceId: string;
  x: number;   // spawn world x (local map coord in Phase A)
  y: number;   // spawn world y (local map coord in Phase A)
}

export interface EncounterDef {
  id: string;
  name: string;
  mapId: string;
  testOnly?: boolean;
  players: EncounterEntry[];
  enemies: EncounterEntry[];
}

// ---------------------------------------------------------------------------
// EFFECT HANDLER TYPES
// ---------------------------------------------------------------------------

export interface HealResult {
  type: "heal";
  roll: number;
  amount: number;
  healed: number;
  targetName: string;
}

export interface DamageResult {
  type: "damage";
  roll: number;
  amount: number;
  targetName: string;
  targetHp: number;
  dead: boolean;
}

export type EffectResult = HealResult | DamageResult;

export interface HandlerReturn {
  log: string[];
  result: EffectResult;
}

export type EffectHandler = (
  casterName: string,
  abilityName: string,
  target: Combatant,
  effect: AbilityEffect,
  rng: () => number,
) => HandlerReturn;

// ---------------------------------------------------------------------------
// MAP DEFINITIONS — describe terrain. Engine (isWall/isPillar/reachable…)
// only ever reads a `map` object; adding a new map never touches the engine.
// ---------------------------------------------------------------------------
export const MAP_DEFS: Record<string, MapDef> = {
  crypt: {
    id: "crypt",
    name: "the ruined crypt",
    width: 8,
    height: 6,
    entrance: { x: 0, y: 3 },
    pillars: [
      { x: 3, y: 2 },
      { x: 5, y: 3 },
    ],
    // Visual asset IDs for this map's terrain tiles. No production art is
    // registered yet; the renderer falls back to CSS when these are absent.
    visualAssets: {
      floor:  "terrain.crypt.floor",
      wall:   "terrain.crypt.wall",
      pillar: "terrain.crypt.pillar",
    },
  },
  trainingYard: {
    id: "trainingYard",
    name: "the training yard",
    width: 8,
    height: 6,
    entrance: { x: 0, y: 3 },
    pillars: [], // open ground — proves cover is optional per-map, not hardcoded
    visualAssets: {
      floor: "terrain.trainingYard.floor",
      wall:  "terrain.trainingYard.wall",
    },
  },

  // Phase D large-area validation map.
  // 40×40 tiles — substantially larger than the fixed tabletop viewport (12×10).
  // Purpose: prove the viewport architecture works when world > viewport.
  //
  // Geometry:
  //   • All border tiles are walls except the entrance at (0, 20) (left-centre).
  //   • 16 pillars in a sparse 4×4 lattice at 8-tile intervals: (8k, 8j) for k,j ∈ {1,2,3,4}.
  //     They provide cover obstacles without blocking movement corridors.
  //   • All other interior tiles are passable floor.
  //
  // Rules-engine contract: mapDefToTileQuery() produces a TileQueryFn from this
  // definition using the exact same logic as every other map — no second geometry
  // system is introduced. The engine does NOT know the world is 40×40.
  grandHall: {
    id: "grandHall",
    name: "the grand hall",
    width: 40,
    height: 40,
    entrance: { x: 0, y: 20 },
    pillars: [
      { x:  8, y:  8 }, { x:  8, y: 16 }, { x:  8, y: 24 }, { x:  8, y: 32 },
      { x: 16, y:  8 }, { x: 16, y: 16 }, { x: 16, y: 24 }, { x: 16, y: 32 },
      { x: 24, y:  8 }, { x: 24, y: 16 }, { x: 24, y: 24 }, { x: 24, y: 32 },
      { x: 32, y:  8 }, { x: 32, y: 16 }, { x: 32, y: 24 }, { x: 32, y: 32 },
    ],
    // Reuses existing terrain assets where registered; CSS fallback otherwise.
    visualAssets: {
      floor:  "terrain.crypt.floor",
      wall:   "terrain.crypt.wall",
      pillar: "terrain.crypt.pillar",
    },
  },
};

// ---------------------------------------------------------------------------
// RNG — seeded, deterministic. mulberry32 returns a stateful Rng thunk so
// the caller advances the same sequence call by call across game events.
//
// Rng extends () => number, so it is compatible with every existing call site
// that typed the parameter as `() => number`.  The save/restore methods allow
// callers to snapshot the RNG position before speculative execution and roll
// it back if that execution is later rejected — preserving full simulation
// determinism even when partial side effects must be undone.
// ---------------------------------------------------------------------------

/** Callable RNG function that can additionally save and restore its state. */
export interface Rng {
  (): number;
  /** Returns the current internal state token. */
  save(): number;
  /** Restores the RNG to a previously saved state token. */
  restore(state: number): void;
}

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  const fn = function (): number {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(fn, {
    save:    ()            => s,
    restore: (state: number) => { s = state; },
  });
}

export function rollDie(sides: number, rng: () => number): number {
  return Math.floor(rng() * sides) + 1;
}

// ---------------------------------------------------------------------------
// WEAPON DEFINITIONS
// ---------------------------------------------------------------------------
export const WEAPON_DEFS: Record<string, WeaponDef> = CANONICAL_WEAPON_DEFS;

// ---------------------------------------------------------------------------
// COMBATANT DEFINITIONS — templates; never mutated. Runtime instances are
// produced by createCombatantInstance() below.
// ---------------------------------------------------------------------------
export const COMBATANT_DEFS: Record<string, CombatantDef> = {
  fighter: {
    id: "fighter", name: "Aldric", cls: "Fighter", type: "pc",
    icon: "sword", maxHp: 20, ac: 15, atkMod: 5, dexMod: 1, moveMax: 5,
    weaponId: "longbow",
    equipment: {
      armorId: "wardenMail",
      accessoryId: "watchfulCharm",
      consumables: { healingPotion: 2 },
    },
    // Logical asset ID — resolved by the registry at render time, never by the engine.
    visualAssetId: "character.fighter",
  },
  wizard: {
    id: "wizard", name: "Sable", cls: "Wizard", type: "pc",
    icon: "wand", maxHp: 14, ac: 12, atkMod: 4, dexMod: 2, moveMax: 4,
    weaponId: "forceBolt",
    equipment: {
      armorId: "trailLeathers",
      accessoryId: "watchfulCharm",
      consumables: { healingPotion: 1 },
    },
    abilities: ["healingTouch", "fireBolt"],
    visualAssetId: "character.wizard",
  },
  goblin: {
    id: "goblin", name: "Goblin", cls: "Goblin", type: "enemy",
    icon: "shield", maxHp: 7, ac: 13, atkMod: 3, dexMod: 2, moveMax: 5,
    weaponId: "rustyShiv",
    visualAssetId: "character.goblin",
  },
  orc: {
    id: "orc", name: "Orc", cls: "Orc", type: "enemy",
    icon: "shield", maxHp: 16, ac: 15, atkMod: 4, dexMod: 0, moveMax: 4,
    weaponId: "warAxe",
    visualAssetId: "character.orc",
  },
  // E2E test fixture — Wizard clone with very high dexMod so she always wins
  // initiative against any dexMod -10 enemy fixture. Identical stats to the
  // canonical wizard def except dexMod 15 (min roll 16 vs max dummy roll 10).
  // Hidden from the encounter picker; only appears when ?e2e is in the URL.
  testWizard: {
    id: "testWizard", name: "Sable", cls: "Wizard", type: "pc",
    icon: "wand", maxHp: 14, ac: 12, atkMod: 4, dexMod: 15, moveMax: 4,
    weaponId: "forceBolt",
    abilities: ["healingTouch", "fireBolt"],
    visualAssetId: "character.wizard",
  },
  // E2E test fixture — guaranteed one-hit kill (HP 1, AC 1, dexMod -10 so
  // it always loses initiative and never reaches the fighter before dying).
  // Only visible in-game when the ?e2e URL parameter is present.
  targetDummy: {
    id: "targetDummy", name: "Target Dummy", cls: "Dummy", type: "enemy",
    icon: "shield", maxHp: 1, ac: 1, atkMod: -10, dexMod: -10, moveMax: 0,
    weaponId: "rustyShiv",
  },
  // E2E test fixture — PC side of the "Quick Defeat" encounter.
  // HP 1, AC 1, dexMod -10 guarantees the enemy always wins initiative and
  // any attack (even a natural 1 + atkMod 20 = 21 vs AC 1) kills it.
  glassPC: {
    id: "glassPC", name: "Glass Squire", cls: "Squire", type: "pc",
    icon: "sword", maxHp: 1, ac: 1, atkMod: 0, dexMod: -10, moveMax: 3,
    weaponId: "rustyShiv",
  },
  // E2E test fixture — enemy side of the "Quick Defeat" encounter.
  // atkMod 20 guarantees a hit (minimum roll 21 vs AC 1), rustyShiv minimum
  // damage 2 > PC HP 1 → guaranteed one-hit kill. dexMod 10 always wins
  // initiative. Placed adjacent to the PC so it can attack immediately.
  doomEnemy: {
    id: "doomEnemy", name: "Doom Wraith", cls: "Wraith", type: "enemy",
    icon: "shield", maxHp: 50, ac: 20, atkMod: 20, dexMod: 10, moveMax: 0,
    weaponId: "rustyShiv",
  },
};

// ---------------------------------------------------------------------------
// ABILITY DEFINITIONS — each ability is entirely described by its data.
// executeAbility() dispatches on effect.type via EFFECT_HANDLERS; it has
// no knowledge of which specific ability it is executing.
// ---------------------------------------------------------------------------
export const ABILITY_DEFS: Record<string, AbilityDef> = {
  healingTouch: {
    id: "healingTouch",
    name: "Healing Touch",
    range: 1,           // adjacent or self (distance 0)
    targeting: "ally",  // same type as caster
    effect: { type: "heal", die: 6, mod: 2 },
  },
  fireBolt: {
    id: "fireBolt",
    name: "Fire Bolt",
    range: 4,
    targeting: "enemy",
    requiresLineOfSight: true,
    effect: { type: "damage", die: 8, mod: 1 },
  },
};

// ---------------------------------------------------------------------------
// EFFECT HANDLERS — pure functions dispatched by executeAbility().
// A new ability with a known effect type (heal/damage) needs zero new code
// here. A genuinely new effect shape adds ONE new entry.
// ---------------------------------------------------------------------------
export const EFFECT_HANDLERS: Record<string, EffectHandler> = {
  heal: (casterName, abilityName, target, effect, rng): HandlerReturn => {
    const roll = rollDie(effect.die, rng);
    const amount = roll + effect.mod;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const healed = target.hp - before;
    const log = [
      `${casterName} uses ${abilityName} on ${target.name}. Healing Roll: ${roll} + ${effect.mod} = ${amount}.`,
      `${target.name} HP: ${target.hp}/${target.maxHp}${healed < amount ? " (capped at max)" : ""}`,
    ];
    return { log, result: { type: "heal", roll, amount, healed, targetName: target.name } };
  },
  damage: (casterName, abilityName, target, effect, rng): HandlerReturn => {
    const roll = rollDie(effect.die, rng);
    const amount = roll + effect.mod;
    target.hp = Math.max(0, target.hp - amount);
    const log = [
      `${casterName} casts ${abilityName} at ${target.name}. Damage Roll: ${roll} + ${effect.mod} = ${amount}.`,
      `${target.name} takes ${amount} damage. ${target.name} HP: ${target.hp}/${target.maxHp}`,
    ];
    if (target.hp <= 0) {
      target.alive = false;
      log.push(`${target.name} has fallen.`);
    }
    return { log, result: { type: "damage", roll, amount, targetName: target.name, targetHp: target.hp, dead: !target.alive } };
  },
};

// ---------------------------------------------------------------------------
// ENCOUNTER DEFINITIONS — which map, which combatants, where they start.
// ---------------------------------------------------------------------------
export const ENCOUNTER_DEFS: Record<string, EncounterDef> = {
  crypt: {
    id: "crypt",
    name: "Ruined Crypt",
    mapId: "crypt",
    players: [
      { defId: "fighter", instanceId: "fighter", x: 1, y: 3 },
      { defId: "wizard",  instanceId: "wizard",  x: 1, y: 2 },
    ],
    enemies: [
      { defId: "goblin", instanceId: "goblin1", x: 6, y: 1 },
      { defId: "goblin", instanceId: "goblin2", x: 6, y: 3 },
      { defId: "goblin", instanceId: "goblin3", x: 4, y: 4 },
    ],
  },
  trainingYard: {
    id: "trainingYard",
    name: "Training Yard",
    mapId: "trainingYard",
    players: [{ defId: "fighter", instanceId: "fighter", x: 1, y: 3 }],
    enemies: [{ defId: "orc", instanceId: "orc1", x: 5, y: 2 }],
  },
  // E2E test encounter — deterministic one-round victory: the dummy has 1 HP,
  // AC 1, and always loses initiative, so the fighter's first attack always
  // kills it and triggers the Victory banner immediately.
  // Hidden from the normal encounter picker; only shown when ?e2e is in the URL.
  quickBattle: {
    id: "quickBattle",
    name: "Quick Battle",
    mapId: "trainingYard",
    testOnly: true,
    players: [{ defId: "fighter", instanceId: "fighter", x: 1, y: 3 }],
    enemies: [{ defId: "targetDummy", instanceId: "dummy1", x: 3, y: 3 }],
  },
  // E2E test encounter — ability targeting coverage.
  // testWizard (dexMod 15) always wins initiative vs targetDummy (dexMod -10):
  //   min wizard total 16 > max dummy total 10 → fully deterministic.
  // Layout: wizard at (1,3), dummy at (4,3).
  //   Fire Bolt range 4, chebyshev distance 3 → within range.
  //   trainingYard has no pillars → LOS always clear.
  //   Healing Touch range 1; wizard can target herself at distance 0 ≤ 1.
  // Hidden from the normal encounter picker; only shown when ?e2e is in the URL.
  quickAbility: {
    id: "quickAbility",
    name: "Ability Test",
    mapId: "trainingYard",
    testOnly: true,
    players: [{ defId: "testWizard", instanceId: "wizard", x: 1, y: 3 }],
    enemies: [{ defId: "targetDummy", instanceId: "dummy1", x: 4, y: 3 }],
  },
  // E2E test encounter — deterministic one-round defeat: the Doom Wraith wins
  // initiative (dexMod 10), attacks the adjacent Glass Squire (atkMod 20 vs
  // AC 1 — never misses), and kills it (min damage 2 > HP 1) before the player
  // ever gets a turn.  resolveLeadingEnemyTurns() runs the wraith's turn
  // automatically on load, so the Defeat banner is visible immediately.
  // Hidden from the normal encounter picker; only shown when ?e2e is in the URL.
  quickDefeat: {
    id: "quickDefeat",
    name: "Quick Defeat",
    mapId: "trainingYard",
    testOnly: true,
    players: [{ defId: "glassPC",   instanceId: "glassPC1",   x: 2, y: 3 }],
    enemies: [{ defId: "doomEnemy", instanceId: "doomEnemy1", x: 3, y: 3 }],
  },
  // Phase D large-area validation encounter.
  // Proves viewport architecture on a 40×40 world with a 12×10 viewport window.
  // Fighter starts near the entrance (6, 20); Target Dummy at (35, 20).
  //
  // With VIEWPORT_TILE_W=12, VIEWPORT_TILE_H=10 the initial viewport settles near
  // origin (0, 15) after dead-zone follow on the fighter. The dummy is far off-screen,
  // demonstrating that culling (not rendering all 40×40 tiles) is working.
  //
  // Neither pillar position conflicts with either combatant's starting location.
  // testOnly: the encounter does not appear in the production picker, only ?e2e.
  largeArena: {
    id: "largeArena",
    name: "Grand Hall",
    mapId: "grandHall",
    testOnly: true,
    players: [{ defId: "fighter",     instanceId: "fighter", x:  6, y: 20 }],
    enemies: [{ defId: "targetDummy", instanceId: "dummy1",  x: 35, y: 20 }],
  },

  // E2E test encounter — out-of-range coverage for hover preview.
  // Fighter (Aldric, longbow range 6) at (0,3); Target Dummy at (7,3).
  // Chebyshev distance = max(7,0) = 7 > range 6 → attack always OUT_OF_RANGE.
  // trainingYard map: no pillars → LOS is always clear (range, not LOS, is the limiter).
  quickOutOfRange: {
    id: "quickOutOfRange",
    name: "Range Test",
    mapId: "trainingYard",
    testOnly: true,
    players: [{ defId: "fighter", instanceId: "fighter", x: 0, y: 3 }],
    enemies: [{ defId: "targetDummy", instanceId: "dummy1", x: 7, y: 3 }],
  },
};

/**
 * Returns only encounters intended for production play (no `testOnly: true`).
 * UI encounter pickers should call this instead of reading ENCOUNTER_DEFS
 * directly, so test fixtures never appear to players.
 */
export function getProductionEncounters(): Record<string, EncounterDef> {
  return Object.fromEntries(
    Object.entries(ENCOUNTER_DEFS).filter(([, enc]) => !enc.testOnly)
  );
}

// ---------------------------------------------------------------------------
// DEFINITION → RUNTIME INSTANCE
// A CombatantDefinition is a template. A runtime instance is one mutable
// occurrence of that template in a specific game state. Multiple instances
// of the same definition mutate completely independently.
// ---------------------------------------------------------------------------
export function createCombatantInstance(
  defId: string,
  instanceId: string,
  wx: number,
  wy: number,
  displayName?: string,
): Combatant {
  const def = COMBATANT_DEFS[defId];
  if (!def) throw new Error(`Unknown combatant definition: "${defId}"`);
  const equipment = createEquipmentLoadout({
    weaponId: def.weaponId,
    ...def.equipment,
  });
  const weaponDef = WEAPON_DEFS[equipment.weaponId];
  if (!weaponDef) throw new Error(`Unknown weapon "${def.weaponId}" referenced by "${defId}"`);
  for (const abilityId of def.abilities ?? []) {
    if (!ABILITY_DEFS[abilityId]) {
      throw new Error(`Unknown ability "${abilityId}" on combatant definition "${defId}"`);
    }
  }
  return {
    id: instanceId,
    defId,
    name: displayName ?? def.name,
    cls: def.cls,
    type: def.type,
    icon: def.icon,
    wx,
    wy,
    hp: def.maxHp,
    maxHp: def.maxHp,
    ac: def.ac,
    atkMod: def.atkMod,
    dexMod: def.dexMod,
    moveMax: def.moveMax,
    moveRemaining: getEffectiveMoveMax(def.moveMax, equipment),
    weapon: { name: weaponDef.name, range: weaponDef.range, dmgDie: weaponDef.dmgDie, dmgMod: weaponDef.dmgMod },
    abilities: def.abilities ?? [],
    alive: true,
    actionUsed: false,
    equipment,
  };
}

export function rollInitiative(combatants: Record<string, Combatant>, rng: () => number): InitiativeEntry[] {
  const rolled: InitiativeEntry[] = Object.values(combatants).map((c) => ({
    id: c.id,
    total: rollDie(20, rng) + c.dexMod,
  }));
  rolled.sort((a, b) => b.total - a.total);
  return rolled;
}

// The only place content definitions and runtime state meet. Everything
// downstream (validation, execution, turn cycling, intent parser, UI) only
// ever deals with runtime instances.
export function buildEncounter(encounterId: string, seed: number): GameState {
  const encounterDef = ENCOUNTER_DEFS[encounterId];
  if (!encounterDef) throw new Error(`Unknown encounter: "${encounterId}"`);
  const map = MAP_DEFS[encounterDef.mapId];
  if (!map) throw new Error(`Unknown map: "${encounterDef.mapId}" (encounter "${encounterId}")`);

  // Build the stable tile-query snapshot for this encounter.
  // The rules engine uses this exclusively — never reads MapDef.pillars directly.
  const tileQuery = mapDefToTileQuery(map);

  const combatants: Record<string, Combatant> = {};
  // Number display names when multiple instances share a definition
  // (e.g. three Goblins → "Goblin 1", "Goblin 2", "Goblin 3").
  const countByDef: Record<string, number> = {};
  for (const entry of [...encounterDef.players, ...encounterDef.enemies]) {
    countByDef[entry.defId] = (countByDef[entry.defId] ?? 0) + 1;
  }
  const seenByDef: Record<string, number> = {};
  for (const entry of [...encounterDef.players, ...encounterDef.enemies]) {
    const def = COMBATANT_DEFS[entry.defId];
    let displayName = def.name;
    if (countByDef[entry.defId] > 1) {
      seenByDef[entry.defId] = (seenByDef[entry.defId] ?? 0) + 1;
      displayName = `${def.name} ${seenByDef[entry.defId]}`;
    }
    combatants[entry.instanceId] = createCombatantInstance(
      entry.defId, entry.instanceId, entry.x, entry.y, displayName
    );
  }

  const rng = mulberry32(seed);
  const initiative = rollInitiative(combatants, rng);
  return {
    started: true,
    encounterId,
    encounterName: encounterDef.name,
    map,
    tileQuery,
    round: 1,
    turnOrder: initiative.map((i) => i.id),
    initiativeRolls: initiative,
    turnIndex: 0,
    combatants,
    log: [
      `The party enters ${map.name}.`,
      "Initiative: " + initiative.map((i) => `${combatants[i.id].name} (${i.total})`).join(", "),
      `— Round 1 —`,
    ],
    seed,
  };
}
