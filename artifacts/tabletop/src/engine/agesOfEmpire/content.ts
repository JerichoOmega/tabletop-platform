// ---------------------------------------------------------------------------
// Ages of Empire — static content definitions.
//
// Everything here is data. Rules logic in rules.ts/combat.ts must read these
// tables rather than hard-coding units, territories, cards, or factions, so
// content can be rebalanced or extended without touching the engine.
// ---------------------------------------------------------------------------

import type {
  AoEAge,
  AoECardType,
  AoEFactionDef,
  AoEObjectiveDef,
  AoERegionDef,
  AoETerritoryDef,
  AoEUnitDef,
  AoEUnitTypeId,
} from "./types";
import { AOE_AGES, AOE_BALANCE } from "./types";

// --- units -------------------------------------------------------------------
// Numeric balance values (cost, movement) come from AOE_BALANCE.units so the
// balance config is the single tuning point; this table adds identity,
// age gating, and combat-behavior flags.

const UC = AOE_BALANCE.units.costs;
const UM = AOE_BALANCE.units.movement;

export const AOE_UNIT_DEFS: Record<AoEUnitTypeId, AoEUnitDef> = {
  infantry: { id: "infantry", name: "Infantry", age: "ancient", cost: UC.infantry, movement: UM.infantry },
  cavalry: {
    id: "cavalry", name: "Cavalry", age: "ancient", cost: UC.cavalry, movement: UM.cavalry,
    highestAttackBonus: true, mounted: true,
  },
  spearman: {
    id: "spearman", name: "Spearmen", age: "medieval", cost: UC.spearman, movement: UM.spearman,
    antiCavalryDefense: true,
  },
  knight: {
    id: "knight", name: "Knight", age: "medieval", cost: UC.knight, movement: UM.knight,
    highestAttackBonus: true, mounted: true,
  },
  rifleman: {
    id: "rifleman", name: "Rifleman", age: "industrial", cost: UC.rifleman, movement: UM.rifleman,
    reroll: true,
  },
  artillery: {
    id: "artillery", name: "Artillery", age: "industrial", cost: UC.artillery, movement: UM.artillery,
    fortBreaker: true,
  },
  tank: {
    id: "tank", name: "Tank", age: "industrial", cost: UC.tank, movement: UM.tank,
    highestAttackBonus: true,
  },
  mechInfantry: {
    id: "mechInfantry", name: "Mechanized Infantry", age: "modern", cost: UC.mechInfantry, movement: UM.mechInfantry,
    reroll: true,
  },
  modernArmor: {
    id: "modernArmor", name: "Modern Armor", age: "modern", cost: UC.modernArmor, movement: UM.modernArmor,
    highestAttackBonus: true, winsTies: true,
  },
};

/** Upgrade paths: old unit -> allowed new units. Data-driven; cost is
 *  (newCost - oldCost) reinforcements + the production surcharge. */
export const AOE_UPGRADE_PATHS: Partial<Record<AoEUnitTypeId, readonly AoEUnitTypeId[]>> = {
  infantry: ["spearman", "rifleman", "mechInfantry"],
  cavalry: ["knight", "tank", "modernArmor"],
  spearman: ["rifleman", "mechInfantry"],
  knight: ["tank", "modernArmor"],
  rifleman: ["mechInfantry"],
  artillery: [],
  tank: ["modernArmor"],
};

export function ageIndex(age: AoEAge): number {
  return AOE_AGES.indexOf(age);
}

export function unitAvailableInAge(unit: AoEUnitTypeId, age: AoEAge): boolean {
  // Older units remain usable after newer units unlock.
  return ageIndex(AOE_UNIT_DEFS[unit].age) <= ageIndex(age);
}

// --- age unlock table (informational + gating for builds) --------------------

export const AOE_AGE_TECHNOLOGY: Record<AoEAge, string> = {
  ancient: "Agriculture",
  medieval: "Engineering",
  industrial: "Industry",
  modern: "Mechanization",
};

/** Development kinds unlocked at (or before) each age. */
export const AOE_DEVELOPMENT_UNLOCK_AGE = {
  city: "medieval",
  fort: "medieval",
  road: "medieval",
  railway: "industrial",
  factory: "industrial",
} as const satisfies Record<string, AoEAge>;

// --- factions ----------------------------------------------------------------

const F = AOE_BALANCE.factions;
export const AOE_FACTION_DEFS: Record<string, AoEFactionDef> = {
  romans: { id: "romans", name: "Romans", passive: { kind: "fortDiscount", amount: F.fortDiscount } },
  mongols: { id: "mongols", name: "Mongols", passive: { kind: "mountedMovementBonus", amount: F.mountedMovementBonus } },
  british: { id: "british", name: "British", passive: { kind: "cityProductionBonus", amount: F.cityProductionBonus } },
  germans: { id: "germans", name: "Germans", passive: { kind: "factoryProductionBonus", amount: F.factoryProductionBonus } },
  americans: { id: "americans", name: "Americans", passive: { kind: "modernUnitDiscount", amount: F.modernUnitDiscount } },
};

// --- cards -------------------------------------------------------------------

export const AOE_CARD_TYPES: readonly AoECardType[] = [
  "reinforcement",
  "forcedMarch",
  "defensiveMobilization",
  "rapidDeployment",
  "artillerySupport",
  "emergencyDefense",
];

// --- objectives ---------------------------------------------------------------

export const AOE_OBJECTIVE_DEFS: readonly AoEObjectiveDef[] = [
  { id: "regions3", description: "Control 3 regions.", kind: "controlRegions", count: 3 },
  { id: "cities5", description: "Control 5 Cities.", kind: "controlCities", count: 5 },
  { id: "heartland", description: "Control the Heartland region.", kind: "controlSpecificRegion", regionId: "heartland" },
  { id: "holdCapital", description: "Hold your Capital until game end.", kind: "holdCapitalToEnd" },
  { id: "resources4", description: "Control 4 resource territories.", kind: "controlResourceTerritories", count: 4 },
  { id: "railNetwork4", description: "Build a connected Railway network of 4 territories.", kind: "railwayNetwork", size: 4 },
];

// --- world map ----------------------------------------------------------------
// 24 territories in 6 regions (2 small, 2 medium, 2 large). The physical
// tabletop board mirrors this graph; the digital layer only tracks the graph.

export const AOE_REGION_DEFS: readonly AoERegionDef[] = [
  { id: "northreach", name: "Northreach", size: "small", territories: ["nr1", "nr2", "nr3"] },
  { id: "isles", name: "The Isles", size: "small", territories: ["is1", "is2", "is3"] },
  { id: "heartland", name: "Heartland", size: "medium", territories: ["ht1", "ht2", "ht3", "ht4"] },
  { id: "sunlands", name: "Sunlands", size: "medium", territories: ["sl1", "sl2", "sl3", "sl4"] },
  { id: "west", name: "Western Expanse", size: "large", territories: ["we1", "we2", "we3", "we4", "we5"] },
  { id: "east", name: "Eastern Steppes", size: "large", territories: ["es1", "es2", "es3", "es4", "es5"] },
];

export const AOE_TERRITORY_DEFS: readonly AoETerritoryDef[] = [
  // Northreach (small)
  { id: "nr1", name: "Frosthold", region: "northreach", adjacent: ["nr2", "we1"], resource: "iron" },
  { id: "nr2", name: "Ravenpass", region: "northreach", adjacent: ["nr1", "nr3", "ht1"] },
  { id: "nr3", name: "Glacier Bay", region: "northreach", adjacent: ["nr2", "es1"], resource: "oil" },
  // The Isles (small)
  { id: "is1", name: "Stormwatch", region: "isles", adjacent: ["is2", "we4"] },
  { id: "is2", name: "Pearl Harbor", region: "isles", adjacent: ["is1", "is3"], resource: "gold" },
  { id: "is3", name: "Coral Cape", region: "isles", adjacent: ["is2", "sl1"] },
  // Heartland (medium)
  { id: "ht1", name: "Kingsfield", region: "heartland", adjacent: ["nr2", "ht2", "ht3", "we2"], resource: "food" },
  { id: "ht2", name: "Riverrun", region: "heartland", adjacent: ["ht1", "ht4", "es2"] },
  { id: "ht3", name: "Goldvale", region: "heartland", adjacent: ["ht1", "ht4", "we3"], resource: "gold" },
  { id: "ht4", name: "Crossroads", region: "heartland", adjacent: ["ht2", "ht3", "sl2", "es3"] },
  // Sunlands (medium)
  { id: "sl1", name: "Duneport", region: "sunlands", adjacent: ["is3", "sl2", "sl3"] },
  { id: "sl2", name: "Oasis", region: "sunlands", adjacent: ["ht4", "sl1", "sl4"], resource: "food" },
  { id: "sl3", name: "Mirage Flats", region: "sunlands", adjacent: ["sl1", "sl4", "we5"], resource: "oil" },
  { id: "sl4", name: "Sunspire", region: "sunlands", adjacent: ["sl2", "sl3", "es5"] },
  // Western Expanse (large)
  { id: "we1", name: "Timberline", region: "west", adjacent: ["nr1", "we2"], resource: "food" },
  { id: "we2", name: "Ironridge", region: "west", adjacent: ["we1", "we3", "ht1"], resource: "iron" },
  { id: "we3", name: "Highplain", region: "west", adjacent: ["we2", "we4", "ht3"] },
  { id: "we4", name: "Seacliff", region: "west", adjacent: ["we3", "we5", "is1"] },
  { id: "we5", name: "Saltmarsh", region: "west", adjacent: ["we4", "sl3"], resource: "gold" },
  // Eastern Steppes (large)
  { id: "es1", name: "Windgate", region: "east", adjacent: ["nr3", "es2"], resource: "food" },
  { id: "es2", name: "Khan's Rest", region: "east", adjacent: ["es1", "es3", "ht2"], resource: "iron" },
  { id: "es3", name: "Broadsteppe", region: "east", adjacent: ["es2", "es4", "ht4"] },
  { id: "es4", name: "Falconcrag", region: "east", adjacent: ["es3", "es5"], resource: "oil" },
  { id: "es5", name: "Amberfields", region: "east", adjacent: ["es4", "sl4"], resource: "food" },
];

export const AOE_TERRITORY_BY_ID: Record<string, AoETerritoryDef> = Object.fromEntries(
  AOE_TERRITORY_DEFS.map((t) => [t.id, t]),
);

export const AOE_REGION_BY_ID: Record<string, AoERegionDef> = Object.fromEntries(
  AOE_REGION_DEFS.map((r) => [r.id, r]),
);

/** Dev-time content validation: adjacency must be symmetric, regions must
 *  partition the territory set, referenced ids must exist. */
export function validateAoEContent(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const t of AOE_TERRITORY_DEFS) {
    if (seen.has(t.id)) errors.push(`duplicate territory id ${t.id}`);
    seen.add(t.id);
    if (!AOE_REGION_BY_ID[t.region]) errors.push(`${t.id}: unknown region ${t.region}`);
    for (const a of t.adjacent) {
      const other = AOE_TERRITORY_BY_ID[a];
      if (!other) errors.push(`${t.id}: unknown adjacent ${a}`);
      else if (!other.adjacent.includes(t.id)) errors.push(`asymmetric adjacency ${t.id} -> ${a}`);
    }
  }
  const inRegions = new Set<string>();
  for (const r of AOE_REGION_DEFS) {
    for (const tid of r.territories) {
      if (!AOE_TERRITORY_BY_ID[tid]) errors.push(`region ${r.id}: unknown territory ${tid}`);
      else if (AOE_TERRITORY_BY_ID[tid].region !== r.id)
        errors.push(`region ${r.id}: territory ${tid} claims region ${AOE_TERRITORY_BY_ID[tid].region}`);
      if (inRegions.has(tid)) errors.push(`territory ${tid} in multiple regions`);
      inRegions.add(tid);
    }
  }
  for (const t of AOE_TERRITORY_DEFS) {
    if (!inRegions.has(t.id)) errors.push(`territory ${t.id} not in any region`);
  }
  for (const [from, targets] of Object.entries(AOE_UPGRADE_PATHS)) {
    const fromDef = AOE_UNIT_DEFS[from as AoEUnitTypeId];
    for (const to of targets ?? []) {
      if (AOE_UNIT_DEFS[to].cost < fromDef.cost) errors.push(`upgrade ${from} -> ${to} is a downgrade`);
    }
  }
  return errors;
}
