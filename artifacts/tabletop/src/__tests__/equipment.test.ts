import { describe, expect, it } from "vitest";

import {
  EQUIPMENT_DEFS,
  WEAPON_DEFS,
  acquireItem,
  consumeItem,
  createEquipmentLoadout,
  equipItem,
  getEffectiveArmorClass,
  getEffectiveMoveMax,
  getEquipmentDefinition,
  validateEquipmentLoadout,
} from "@/engine/equipment";
import { buildEncounter } from "@/engine/content";
import {
  cloneState,
  executeConsumable,
  validateConsumable,
} from "@/engine/rules";

function loadout() {
  return createEquipmentLoadout({
    weaponId: "longbow",
    armorId: "trailLeathers",
    accessoryId: null,
    consumables: { healingPotion: 2 },
  });
}

function fighterTurn() {
  const state = cloneState(buildEncounter("crypt", 42));
  state.turnIndex = state.turnOrder.indexOf("fighter");
  state.combatants.fighter.hp = 10;
  state.combatants.fighter.actionUsed = false;
  return state;
}

describe("canonical equipment definitions", () => {
  it("contains the five supported categories", () => {
    expect(new Set(Object.values(EQUIPMENT_DEFS).map((item) => item.category))).toEqual(
      new Set(["weapon", "armor", "accessory", "consumable", "mission"]),
    );
  });

  it("uses only the initial weapon, armor, accessory, and consumable slots", () => {
    expect(Object.values(EQUIPMENT_DEFS).filter((item) => "slot" in item).map((item) => item.slot)).toEqual(
      expect.arrayContaining(["weapon", "armor", "accessory"]),
    );
    expect(Object.values(EQUIPMENT_DEFS).some((item) => "slot" in item && !["weapon", "armor", "accessory"].includes(item.slot))).toBe(false);
  });

  it("projects weapon definitions from the canonical item registry", () => {
    expect(WEAPON_DEFS.longbow).toMatchObject({ id: "longbow", range: 6, dmgDie: 8, dmgMod: 2 });
    expect(getEquipmentDefinition("longbow")?.name).toBe("Longbow");
  });

  it("does not contain duplicate canonical item ids", () => {
    const ids = Object.values(EQUIPMENT_DEFS).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(EQUIPMENT_DEFS)).toEqual(expect.arrayContaining(ids));
  });
});

describe("loadout rules", () => {
  it("equips a valid item and replaces the item in that slot", () => {
    const first = equipItem(loadout(), "warAxe");
    expect(first.ok).toBe(true);
    expect(first.loadout.weaponId).toBe("warAxe");

    const second = equipItem(first.loadout, "wardenMail");
    expect(second.ok).toBe(true);
    expect(second.loadout.armorId).toBe("wardenMail");
  });

  it("rejects invalid slot combinations and non-equippable items", () => {
    expect(validateEquipmentLoadout({ ...loadout(), armorId: "healingPotion" })).toContain(
      'armorId "healingPotion" is not armor',
    );
    expect(equipItem(loadout(), "healingPotion")).toMatchObject({
      ok: false,
      code: "ITEM_NOT_EQUIPPABLE",
    });
  });

  it("has one accessory slot, so equipping a second accessory replaces the first", () => {
    const current = createEquipmentLoadout({ ...loadout(), accessoryId: "watchfulCharm" });
    const next = equipItem(current, "watchfulCharm");
    expect(next.ok).toBe(true);
    expect(next.loadout.accessoryId).toBe("watchfulCharm");
  });

  it("applies readable armor and conditional accessory effects", () => {
    const equipped = createEquipmentLoadout({ ...loadout(), armorId: "wardenMail", accessoryId: "watchfulCharm" });
    expect(getEffectiveArmorClass(15, equipped, 10, 20)).toBe(17);
    expect(getEffectiveArmorClass(15, equipped, 9, 20)).toBe(19);
    expect(getEffectiveMoveMax(5, equipped)).toBe(5);
    const spent = createEquipmentLoadout({
      ...equipped,
      spentAccessoryIds: ["watchfulCharm"],
    });
    expect(getEffectiveArmorClass(15, spent, 9, 20)).toBe(17);
  });
});

describe("consumable rules", () => {
  it("enforces the maximum quantity and uses the same canonical item for acquisition", () => {
    let current = createEquipmentLoadout({ ...loadout(), consumables: {} });
    const first = acquireItem(current, "healingPotion", "chest");
    const second = acquireItem(first.loadout, "healingPotion", "mission_reward");
    const third = acquireItem(second.loadout, "healingPotion", "enemy");
    const fourth = acquireItem(third.loadout, "healingPotion", "shop");
    expect(first.ok && second.ok && third.ok).toBe(true);
    expect(third.loadout.consumables.healingPotion).toBe(3);
    expect(fourth).toMatchObject({ ok: false, code: "CONSUMABLE_LIMIT" });
    expect(getEquipmentDefinition("healingPotion")).toBe(EQUIPMENT_DEFS.healingPotion);
  });

  it("consumes one item and prevents consuming at zero", () => {
    const used = consumeItem(loadout(), "healingPotion");
    expect(used).toMatchObject({ ok: true, loadout: { consumables: { healingPotion: 1 } } });
    const empty = consumeItem(createEquipmentLoadout({ ...loadout(), consumables: { healingPotion: 0 } }), "healingPotion");
    expect(empty).toMatchObject({ ok: false, code: "ITEM_NOT_OWNED" });
  });

  it("resolves healing through the rules engine, consumes an action, and caps at max HP", () => {
    const state = fighterTurn();
    const result = executeConsumable(state, "fighter", "healingPotion");
    expect(result.ok).toBe(true);
    expect(result.state.combatants.fighter.hp).toBe(16);
    expect(result.state.combatants.fighter.equipment.consumables.healingPotion).toBe(1);
    expect(result.state.combatants.fighter.actionUsed).toBe(true);
    expect(state.combatants.fighter.hp).toBe(10);

    const capped = fighterTurn();
    capped.combatants.fighter.hp = 19;
    const cappedResult = executeConsumable(capped, "fighter", "healingPotion");
    expect((cappedResult.result as { healed: number }).healed).toBe(1);
    expect(cappedResult.state.combatants.fighter.hp).toBe(20);
  });

  it("rejects unknown, non-consumable, and unavailable items through stable validation codes", () => {
    const state = fighterTurn();
    expect(validateConsumable(state, "fighter", "missing")).toMatchObject({ valid: false, code: "ITEM_UNKNOWN" });
    expect(validateConsumable(state, "fighter", "longbow")).toMatchObject({ valid: false, code: "ITEM_NOT_CONSUMABLE" });
    state.combatants.fighter.equipment = createEquipmentLoadout({ ...loadout(), consumables: { healingPotion: 0 } });
    expect(validateConsumable(state, "fighter", "healingPotion")).toMatchObject({ valid: false, code: "ITEM_NOT_OWNED" });
  });
});

describe("equipment state boundaries", () => {
  it("deep-clones loadouts across combat transitions", () => {
    const state = fighterTurn();
    const next = cloneState(state);
    next.combatants.fighter.equipment = createEquipmentLoadout({
      ...next.combatants.fighter.equipment,
      consumables: { healingPotion: 0 },
    });
    expect(state.combatants.fighter.equipment.consumables.healingPotion).toBe(2);
  });

  it("creates independent default loadouts for unrelated sessions", () => {
    const first = fighterTurn();
    const used = executeConsumable(first, "fighter", "healingPotion");
    const second = buildEncounter("crypt", 43);
    expect(used.state.combatants.fighter.equipment.consumables.healingPotion).toBe(1);
    expect(second.combatants.fighter.equipment.consumables.healingPotion).toBe(2);
  });
});