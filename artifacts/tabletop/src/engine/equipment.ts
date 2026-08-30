// ---------------------------------------------------------------------------
// RPG EQUIPMENT — the deliberately small item/equipment rules foundation.
//
// Equipment is authored data plus pure transitions. It is not a backpack,
// crafting system, loot generator, or second player-state architecture.
// Combat rules consume these definitions; the UI only presents them.
// ---------------------------------------------------------------------------

export type EquipmentCategory = "weapon" | "armor" | "accessory" | "consumable" | "mission";
export type EquipmentSlot = "weapon" | "armor" | "accessory";

export type AcquisitionSource =
  | "exploration"
  | "chest"
  | "friendly_npc"
  | "shop"
  | "mission_reward"
  | "enemy"
  | "special_location";

export interface WeaponStats {
  readonly name: string;
  readonly range: number;
  readonly dmgDie: number;
  readonly dmgMod: number;
}

interface BaseEquipmentDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly acquisition: readonly AcquisitionSource[];
}

export interface WeaponDefinition extends BaseEquipmentDefinition {
  readonly category: "weapon";
  readonly slot: "weapon";
  readonly effect: {
    readonly kind: "weapon";
    readonly stats: WeaponStats;
  };
}

export interface ArmorDefinition extends BaseEquipmentDefinition {
  readonly category: "armor";
  readonly slot: "armor";
  readonly effect: {
    readonly kind: "armor";
    /** A single readable defensive identity; not a stat-stacking system. */
    readonly acBonus: number;
    /** Heavy protection can trade one movement tile for defense. */
    readonly movePenalty: number;
  };
}

export interface AccessoryDefinition extends BaseEquipmentDefinition {
  readonly category: "accessory";
  readonly slot: "accessory";
  readonly effect: {
    readonly kind: "accessory";
    /**
     * The first accessory is intentionally a single conditional passive. More
     * passive shapes can be added here only when gameplay needs them.
     */
    readonly passive: "desperate-guard";
    readonly acBonusWhenBelowHalf: number;
  };
}

export interface ConsumableDefinition extends BaseEquipmentDefinition {
  readonly category: "consumable";
  readonly effect: {
    readonly kind: "consumable";
    readonly effect: "heal";
    readonly amount: number;
  };
  readonly maxQuantity: number;
}

export interface MissionItemDefinition extends BaseEquipmentDefinition {
  readonly category: "mission";
  readonly effect: {
    readonly kind: "mission";
    readonly interaction: string;
  };
}

export type EquipmentDefinition =
  | WeaponDefinition
  | ArmorDefinition
  | AccessoryDefinition
  | ConsumableDefinition
  | MissionItemDefinition;

/**
 * The only canonical item registry. Weapon stats below are projected into
 * WEAPON_DEFS for compatibility with the existing combat/content layer.
 */
export const EQUIPMENT_DEFS: Record<string, EquipmentDefinition> = {
  longbow: {
    id: "longbow",
    name: "Longbow",
    category: "weapon",
    slot: "weapon",
    description: "A reliable ranged weapon for controlling the battlefield.",
    effect: { kind: "weapon", stats: { name: "Longbow", range: 6, dmgDie: 8, dmgMod: 2 } },
    acquisition: ["mission_reward", "chest"],
  },
  forceBolt: {
    id: "forceBolt",
    name: "Force Bolt",
    category: "weapon",
    slot: "weapon",
    description: "A focused arcane weapon that keeps the caster out of danger.",
    effect: { kind: "weapon", stats: { name: "Force Bolt", range: 6, dmgDie: 6, dmgMod: 3 } },
    acquisition: ["mission_reward", "special_location"],
  },
  rustyShiv: {
    id: "rustyShiv",
    name: "Rusty Shiv",
    category: "weapon",
    slot: "weapon",
    description: "A close-range improvised blade.",
    effect: { kind: "weapon", stats: { name: "Rusty Shiv", range: 1, dmgDie: 6, dmgMod: 1 } },
    acquisition: ["enemy", "exploration"],
  },
  warAxe: {
    id: "warAxe",
    name: "War Axe",
    category: "weapon",
    slot: "weapon",
    description: "A heavy axe that rewards closing the distance.",
    effect: { kind: "weapon", stats: { name: "War Axe", range: 1, dmgDie: 10, dmgMod: 3 } },
    acquisition: ["enemy", "mission_reward"],
  },
  wardenMail: {
    id: "wardenMail",
    name: "Warden Mail",
    category: "armor",
    slot: "armor",
    description: "Sturdy protection that grants +2 AC without adding a stack of minor modifiers.",
    effect: { kind: "armor", acBonus: 2, movePenalty: 0 },
    acquisition: ["mission_reward", "chest", "friendly_npc"],
  },
  trailLeathers: {
    id: "trailLeathers",
    name: "Trail Leathers",
    category: "armor",
    slot: "armor",
    description: "Light armor with no movement tradeoff.",
    effect: { kind: "armor", acBonus: 1, movePenalty: 0 },
    acquisition: ["exploration", "friendly_npc", "shop"],
  },
  watchfulCharm: {
    id: "watchfulCharm",
    name: "Watchful Charm",
    category: "accessory",
    slot: "accessory",
    description: "When below half HP, grants +2 AC while you hold your ground.",
    effect: { kind: "accessory", passive: "desperate-guard", acBonusWhenBelowHalf: 2 },
    acquisition: ["mission_reward", "special_location"],
  },
  healingPotion: {
    id: "healingPotion",
    name: "Healing Potion",
    category: "consumable",
    description: "Use as an action to restore 6 HP, never above maximum.",
    effect: { kind: "consumable", effect: "heal", amount: 6 },
    maxQuantity: 3,
    acquisition: ["exploration", "chest", "friendly_npc", "shop", "mission_reward", "enemy"],
  },
  signalBeacon: {
    id: "signalBeacon",
    name: "Signal Beacon",
    category: "mission",
    description: "A recovered watchtower beacon used by the mission resolution.",
    effect: { kind: "mission", interaction: "restore-watchtower-signal" },
    acquisition: ["mission_reward", "special_location"],
  },
};

/** Compatibility projection consumed by the existing combat content layer. */
export const WEAPON_DEFS: Record<string, WeaponStats & { readonly id: string }> = {};
for (const item of Object.values(EQUIPMENT_DEFS)) {
  if (item.category === "weapon") WEAPON_DEFS[item.id] = { id: item.id, ...item.effect.stats };
}
Object.freeze(WEAPON_DEFS);

export interface EquipmentLoadoutSeed {
  readonly weaponId: string;
  readonly armorId?: string | null;
  readonly accessoryId?: string | null;
  readonly consumables?: Readonly<Record<string, number>>;
  readonly missionItemIds?: readonly string[];
  readonly spentAccessoryIds?: readonly string[];
}

export interface EquipmentLoadout {
  readonly weaponId: string;
  readonly armorId: string | null;
  readonly accessoryId: string | null;
  readonly consumables: Readonly<Record<string, number>>;
  readonly missionItemIds: readonly string[];
  readonly spentAccessoryIds: readonly string[];
}

export type EquipmentTransitionCode =
  | "OK"
  | "ITEM_UNKNOWN"
  | "INVALID_SLOT"
  | "ITEM_NOT_EQUIPPABLE"
  | "ITEM_NOT_CONSUMABLE"
  | "ITEM_NOT_OWNED"
  | "CONSUMABLE_LIMIT"
  | "ITEM_NOT_ACQUIRED_FROM_SOURCE"
  | "MISSION_ITEM_ALREADY_OWNED";

export interface EquipmentTransition {
  readonly ok: boolean;
  readonly loadout: EquipmentLoadout;
  readonly code: EquipmentTransitionCode;
  readonly reason?: string;
}

export function getEquipmentDefinition(itemId: string): EquipmentDefinition | undefined {
  return EQUIPMENT_DEFS[itemId];
}

function emptyLoadout(seed: EquipmentLoadoutSeed): EquipmentLoadout {
  return {
    weaponId: seed.weaponId,
    armorId: seed.armorId ?? null,
    accessoryId: seed.accessoryId ?? null,
    consumables: { ...(seed.consumables ?? {}) },
    missionItemIds: [...(seed.missionItemIds ?? [])],
    spentAccessoryIds: [...(seed.spentAccessoryIds ?? [])],
  };
}

export function validateEquipmentLoadout(loadout: EquipmentLoadout): string[] {
  const errors: string[] = [];
  const weapon = getEquipmentDefinition(loadout.weaponId);
  if (!weapon || weapon.category !== "weapon" || weapon.slot !== "weapon") {
    errors.push(`weaponId "${loadout.weaponId}" is not a weapon`);
  }
  if (loadout.armorId !== null) {
    const armor = getEquipmentDefinition(loadout.armorId);
    if (!armor || armor.category !== "armor" || armor.slot !== "armor") {
      errors.push(`armorId "${loadout.armorId}" is not armor`);
    }
  }
  if (loadout.accessoryId !== null) {
    const accessory = getEquipmentDefinition(loadout.accessoryId);
    if (!accessory || accessory.category !== "accessory" || accessory.slot !== "accessory") {
      errors.push(`accessoryId "${loadout.accessoryId}" is not an accessory`);
    }
  }
  for (const [itemId, quantity] of Object.entries(loadout.consumables)) {
    const item = getEquipmentDefinition(itemId);
    if (!item || item.category !== "consumable") errors.push(`"${itemId}" is not a consumable`);
    else if (!Number.isInteger(quantity) || quantity < 0 || quantity > item.maxQuantity) {
      errors.push(`"${itemId}" quantity must be an integer from 0 to ${item.maxQuantity}`);
    }
  }
  const missionItems = new Set<string>();
  for (const itemId of loadout.missionItemIds) {
    const item = getEquipmentDefinition(itemId);
    if (!item || item.category !== "mission") errors.push(`"${itemId}" is not a mission item`);
    if (missionItems.has(itemId)) errors.push(`duplicate mission item "${itemId}"`);
    missionItems.add(itemId);
  }
  if (loadout.accessoryId !== null && loadout.spentAccessoryIds.includes(loadout.accessoryId)) {
    // A spent accessory is valid state; it is simply no longer ready.
  }
  return errors;
}

export function createEquipmentLoadout(seed: EquipmentLoadoutSeed): EquipmentLoadout {
  const loadout = emptyLoadout(seed);
  const errors = validateEquipmentLoadout(loadout);
  if (errors.length > 0) throw new Error(`Invalid equipment loadout: ${errors.join("; ")}`);
  return loadout;
}

function unchanged(loadout: EquipmentLoadout, code: EquipmentTransitionCode, reason: string): EquipmentTransition {
  return { ok: false, loadout, code, reason };
}

export function equipItem(loadout: EquipmentLoadout, itemId: string): EquipmentTransition {
  const item = getEquipmentDefinition(itemId);
  if (!item) return unchanged(loadout, "ITEM_UNKNOWN", `Unknown item "${itemId}".`);
  if (item.category === "consumable" || item.category === "mission") {
    return unchanged(loadout, "ITEM_NOT_EQUIPPABLE", `${item.name} is not equipment.`);
  }
  const next = item.slot === "weapon"
    ? { ...loadout, weaponId: item.id }
    : item.slot === "armor"
      ? { ...loadout, armorId: item.id }
      : { ...loadout, accessoryId: item.id };
  return { ok: true, loadout: next, code: "OK" };
}

export function consumeItem(loadout: EquipmentLoadout, itemId: string): EquipmentTransition {
  const item = getEquipmentDefinition(itemId);
  if (!item) return unchanged(loadout, "ITEM_UNKNOWN", `Unknown item "${itemId}".`);
  if (item.category !== "consumable") {
    return unchanged(loadout, "ITEM_NOT_CONSUMABLE", `${item.name} cannot be consumed.`);
  }
  const quantity = loadout.consumables[itemId] ?? 0;
  if (quantity <= 0) return unchanged(loadout, "ITEM_NOT_OWNED", `No ${item.name} remains.`);
  return {
    ok: true,
    code: "OK",
    loadout: {
      ...loadout,
      consumables: { ...loadout.consumables, [itemId]: quantity - 1 },
    },
  };
}

/**
 * Acquisition is the shared entry point for exploration, rewards, vendors, and
 * authored enemy drops. Equipables are immediately equipped because there is
 * intentionally no unequipped equipment backpack in this foundation.
 */
export function acquireItem(
  loadout: EquipmentLoadout,
  itemId: string,
  source: AcquisitionSource,
): EquipmentTransition {
  const item = getEquipmentDefinition(itemId);
  if (!item) return unchanged(loadout, "ITEM_UNKNOWN", `Unknown item "${itemId}".`);
  if (!item.acquisition.includes(source)) {
    return unchanged(loadout, "ITEM_NOT_ACQUIRED_FROM_SOURCE", `${item.name} cannot be acquired from ${source}.`);
  }
  if (item.category === "weapon" || item.category === "armor" || item.category === "accessory") {
    return equipItem(loadout, itemId);
  }
  if (item.category === "mission") {
    if (loadout.missionItemIds.includes(itemId)) {
      return unchanged(loadout, "MISSION_ITEM_ALREADY_OWNED", `${item.name} is already held.`);
    }
    return {
      ok: true,
      code: "OK",
      loadout: { ...loadout, missionItemIds: [...loadout.missionItemIds, itemId] },
    };
  }
  const quantity = loadout.consumables[itemId] ?? 0;
  if (quantity >= item.maxQuantity) {
    return unchanged(loadout, "CONSUMABLE_LIMIT", `${item.name} carry limit reached (${item.maxQuantity}).`);
  }
  return {
    ok: true,
    code: "OK",
    loadout: { ...loadout, consumables: { ...loadout.consumables, [itemId]: quantity + 1 } },
  };
}

export function getWeaponStats(loadout: EquipmentLoadout): WeaponStats {
  const item = getEquipmentDefinition(loadout.weaponId);
  if (!item || item.category !== "weapon") {
    throw new Error(`Equipment loadout references invalid weapon "${loadout.weaponId}".`);
  }
  return item.effect.stats;
}

export function getEffectiveArmorClass(
  baseAc: number,
  loadout: EquipmentLoadout,
  currentHp?: number,
  maxHp?: number,
): number {
  let ac = baseAc;
  if (loadout.armorId) {
    const armor = getEquipmentDefinition(loadout.armorId);
    if (armor?.category === "armor") ac += armor.effect.acBonus;
  }
  if (
    loadout.accessoryId &&
    isAccessoryReady(loadout) &&
    currentHp !== undefined &&
    maxHp !== undefined &&
    currentHp * 2 < maxHp
  ) {
    const accessory = getEquipmentDefinition(loadout.accessoryId);
    if (accessory?.category === "accessory" && accessory.effect.passive === "desperate-guard") {
      ac += accessory.effect.acBonusWhenBelowHalf;
    }
  }
  return ac;
}

export function getEffectiveMoveMax(baseMoveMax: number, loadout: EquipmentLoadout): number {
  const armor = loadout.armorId ? getEquipmentDefinition(loadout.armorId) : undefined;
  const penalty = armor?.category === "armor" ? armor.effect.movePenalty : 0;
  return Math.max(0, baseMoveMax - penalty);
}

export function isAccessoryReady(loadout: EquipmentLoadout): boolean {
  return Boolean(loadout.accessoryId) && !loadout.spentAccessoryIds.includes(loadout.accessoryId!);
}