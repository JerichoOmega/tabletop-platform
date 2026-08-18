// ---------------------------------------------------------------------------
// Ages of Empire — engine test suite.
//
// Tests focus on state transitions through the public rules API. Where a
// scenario needs a specific board position, the (plain-data) state is set up
// directly and the transition under test is exercised through the API.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  AOE_OBJECTIVE_DEFS,
  AOE_REGION_BY_ID,
  AOE_TERRITORY_BY_ID,
  AOE_TERRITORY_DEFS,
  AOE_UNIT_DEFS,
  unitAvailableInAge,
  validateAoEContent,
} from "../engine/agesOfEmpire/content";
import {
  declareAttack,
  effectiveMovement,
  fortifyMove,
  listValidAttacks,
  listValidMoves,
  resolveCombatRound,
  withdraw,
} from "../engine/agesOfEmpire/combat";
import {
  advancePhase,
  build,
  cloneState,
  computeProductionIncome,
  computeReinforcements,
  computeScore,
  currentPlayerId,
  drawCard,
  establishNewCapital,
  finalizeGame,
  formTreaty,
  getGameView,
  getPlayer,
  handleCapture,
  initiativeOrder,
  largestRailwayNetwork,
  markAgeTimerExpired,
  playCard,
  recruitUnit,
  regionsOwnedBy,
  setupGame,
  territoriesOwnedBy,
  tradeCardSet,
  unitCount,
  upgradeUnits,
  useAirSupport,
} from "../engine/agesOfEmpire/rules";
import type {
  AoEGameState,
  AoEUnitTypeId,
} from "../engine/agesOfEmpire/types";
import { AOE_BALANCE } from "../engine/agesOfEmpire/types";

const B = AOE_BALANCE;

function mk(n: number, seed = 42): AoEGameState {
  const colors = ["blue", "red", "green", "yellow", "purple", "orange"];
  return setupGame(
    Array.from({ length: n }, (_, i) => ({ name: `Player ${i + 1}`, color: colors[i] })),
    seed,
  );
}

function expectOk<T>(outcome: import("../engine/agesOfEmpire/types").AoEOutcome<T>): asserts outcome is { ok: true; state: AoEGameState; result: T } {
  if (!outcome.ok) throw new Error(`expected ok, got ${JSON.stringify(outcome)}`);
}

/** Advance the current player's turn to the given phase. */
function toPhase(s: AoEGameState, phase: "develop" | "attack" | "fortify"): AoEGameState {
  let cur = s;
  while (cur.phase !== phase) {
    const r = advancePhase(cur, currentPlayerId(cur));
    expectOk(r);
    cur = r.state;
  }
  return cur;
}

/** End the current player's turn from any phase. */
function endTurnOf(s: AoEGameState): AoEGameState {
  let cur = s;
  const player = currentPlayerId(cur);
  while (!cur.gameOver && currentPlayerId(cur) === player) {
    const r = advancePhase(cur, player);
    expectOk(r);
    cur = r.state;
  }
  return cur;
}

/** Give a territory to a player with the given units (test board editing). */
function give(s: AoEGameState, tid: string, owner: string | null, units: Partial<Record<AoEUnitTypeId, number>>): void {
  s.territories[tid].owner = owner;
  s.territories[tid].units = { ...units };
}

// === content sanity ==========================================================

describe("AoE content", () => {
  it("map content validates (symmetric adjacency, region partition)", () => {
    expect(validateAoEContent()).toEqual([]);
  });

  it("has 24 territories in 6 regions", () => {
    expect(AOE_TERRITORY_DEFS.length).toBe(24);
    expect(Object.keys(AOE_REGION_BY_ID).length).toBe(6);
  });
});

// === setup ====================================================================

describe("AoE setup", () => {
  it.each([2, 4, 6])("%i-player setup deals floor-share territories and leaves the rest neutral", (n) => {
    const s = mk(n);
    const perPlayer = Math.floor(24 / n);
    for (const p of s.players) {
      expect(territoriesOwnedBy(s, p.id).length).toBe(perPlayer);
    }
    const neutral = Object.values(s.territories).filter((t) => t.owner === null);
    expect(neutral.length).toBe(24 - perPlayer * n);
  });

  it("gives each player 15 infantry, 2 cavalry, a capital and 5 starting production (+first-turn income for p1)", () => {
    const s = mk(4, 7);
    for (const p of s.players) {
      const owned = territoriesOwnedBy(s, p.id);
      const infantry = owned.reduce((sum, tid) => sum + (s.territories[tid].units.infantry ?? 0), 0);
      const cavalry = owned.reduce((sum, tid) => sum + (s.territories[tid].units.cavalry ?? 0), 0);
      expect(infantry).toBe(B.setup.startingInfantry);
      expect(cavalry).toBe(B.setup.startingCavalry);
      expect(p.capitalTerritoryId).not.toBeNull();
      expect(s.territories[p.capitalTerritoryId!].owner).toBe(p.id);
      expect(s.territories[p.capitalTerritoryId!].isCapital).toBe(true);
      if (p.id === currentPlayerId(s)) {
        // First player has already received turn-start production income (capped).
        expect(p.production).toBe(Math.min(B.production.cap, B.setup.startingProduction + computeProductionIncome(s, p.id)));
      } else {
        expect(p.production).toBe(B.setup.startingProduction);
      }
    }
  });

  it("gives every player 3 distinct objectives", () => {
    const s = mk(4);
    for (const p of s.players) {
      expect(p.objectiveIds.length).toBe(B.objectives.perPlayer);
      expect(new Set(p.objectiveIds).size).toBe(B.objectives.perPlayer);
      for (const oid of p.objectiveIds) {
        expect(AOE_OBJECTIVE_DEFS.some((o) => o.id === oid)).toBe(true);
      }
    }
  });

  it("garrisons neutral territories with 2-4 infantry", () => {
    const s = mk(5); // 24/5 => 4 neutral
    const neutral = Object.values(s.territories).filter((t) => t.owner === null);
    expect(neutral.length).toBe(4);
    for (const t of neutral) {
      const count = t.units.infantry ?? 0;
      expect(count).toBeGreaterThanOrEqual(B.setup.neutralInfantryMin);
      expect(count).toBeLessThanOrEqual(B.setup.neutralInfantryMax);
    }
  });

  it("is deterministic for the same seed and differs across seeds", () => {
    const a = mk(4, 99);
    const b = mk(4, 99);
    const c = mk(4, 100);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("rejects player counts outside 2-6", () => {
    expect(() => mk(1)).toThrow();
    expect(() => mk(7)).toThrow();
  });

  it("starts in round 1, ancient age, reinforce phase, with p1 to act", () => {
    const s = mk(4);
    expect(s.round).toBe(1);
    expect(s.age).toBe("ancient");
    expect(s.phase).toBe("reinforce");
    expect(currentPlayerId(s)).toBe("p1");
  });
});

// === turn system ===============================================================

describe("AoE turn system", () => {
  it("progresses reinforce -> develop -> attack -> fortify -> next player", () => {
    let s = mk(3);
    expect(s.phase).toBe("reinforce");
    for (const phase of ["develop", "attack", "fortify"] as const) {
      const r = advancePhase(s, "p1");
      expectOk(r);
      s = r.state;
      expect(s.phase).toBe(phase);
    }
    const r = advancePhase(s, "p1");
    expectOk(r);
    s = r.state;
    expect(currentPlayerId(s)).toBe("p2");
    expect(s.phase).toBe("reinforce");
  });

  it("rejects out-of-turn actions", () => {
    const s = mk(3);
    expect(advancePhase(s, "p2")).toMatchObject({ ok: false, code: "WRONG_PLAYER" });
  });

  it("rotates initiative every round", () => {
    let s = mk(3);
    expect(initiativeOrder(s, 1)).toEqual(["p1", "p2", "p3"]);
    expect(initiativeOrder(s, 2)).toEqual(["p2", "p3", "p1"]);
    expect(initiativeOrder(s, 3)).toEqual(["p3", "p1", "p2"]);
    expect(initiativeOrder(s, 4)).toEqual(["p1", "p2", "p3"]);
    // Play a full round; round 2 starts with p2.
    for (let i = 0; i < 3; i++) s = endTurnOf(s);
    expect(s.round).toBe(2);
    expect(currentPlayerId(s)).toBe("p2");
  });

  it("completes the round before advancing the age when the timer expires", () => {
    let s = mk(2);
    s = endTurnOf(s); // p2's turn, round 1
    s = markAgeTimerExpired(s);
    expect(s.age).toBe("ancient"); // no mid-round switch
    s = endTurnOf(s); // round completes
    expect(s.age).toBe("medieval");
    expect(s.round).toBe(2);
    expect(s.ageTimerExpired).toBe(false);
  });

  it("markAgeTimerExpired is idempotent", () => {
    let s = mk(2);
    s = markAgeTimerExpired(s);
    expect(markAgeTimerExpired(s)).toBe(s);
  });

  it("advances through all four ages and ends the game after modern", () => {
    let s = mk(2);
    const ages: string[] = [];
    for (let i = 0; i < 4 && !s.gameOver; i++) {
      ages.push(s.age);
      s = markAgeTimerExpired(s);
      while (!s.gameOver && s.ageTimerExpired) s = endTurnOf(s);
    }
    expect(ages).toEqual(["ancient", "medieval", "industrial", "modern"]);
    expect(s.gameOver).toBe(true);
    expect(s.winnerIds).not.toBeNull();
  });

  it("grants air support charges when the modern age begins", () => {
    let s = mk(2);
    for (const target of ["medieval", "industrial", "modern"]) {
      s = markAgeTimerExpired(s);
      while (!s.gameOver && s.age !== target) s = endTurnOf(s);
    }
    expect(s.age).toBe("modern");
    for (const p of s.players) expect(p.airSupportCharges).toBe(B.airSupport.chargesOnModernAge);
  });
});

// === reinforcements =============================================================

describe("AoE reinforcements", () => {
  it("uses floor(territories/3) with a minimum of 3", () => {
    const s = mk(4, 5);
    // Strip p1 to exactly 2 territories, no regions, no food, no capital.
    for (const tid of territoriesOwnedBy(s, "p1")) s.territories[tid].owner = null;
    give(s, "ht2", "p1", { infantry: 1 });
    give(s, "es3", "p1", { infantry: 1 });
    getPlayer(s, "p1").capitalTerritoryId = null;
    expect(computeReinforcements(s, "p1")).toBe(B.reinforcements.minimum);
    // 12 territories => floor(12/3) = 4 (choose region-incomplete spread).
  });

  it("adds region bonuses by region size", () => {
    const s = mk(2, 5);
    for (const t of Object.values(s.territories)) t.owner = "p2";
    getPlayer(s, "p1").capitalTerritoryId = null;
    getPlayer(s, "p2").capitalTerritoryId = null;
    // p1 owns exactly the small region northreach (3 territories, has food? nr1 iron, nr3 oil - no food).
    for (const tid of AOE_REGION_BY_ID.northreach.territories) give(s, tid, "p1", { infantry: 1 });
    expect(computeReinforcements(s, "p1")).toBe(B.reinforcements.minimum + B.reinforcements.regionBonus.small);
    // Now the large west region too (we1 food!).
    for (const tid of AOE_REGION_BY_ID.west.territories) give(s, tid, "p1", { infantry: 1 });
    expect(computeReinforcements(s, "p1")).toBe(
      B.reinforcements.minimum // 8 territories => floor(8/3)=2 -> min 3
        + B.reinforcements.regionBonus.small
        + B.reinforcements.regionBonus.large
        + B.reinforcements.foodBonus, // we1
    );
  });

  it("adds capital and food bonuses", () => {
    const s = mk(2, 5);
    for (const t of Object.values(s.territories)) t.owner = "p2";
    give(s, "ht1", "p1", { infantry: 1 }); // food resource
    give(s, "ht2", "p1", { infantry: 1 });
    getPlayer(s, "p1").capitalTerritoryId = "ht2";
    getPlayer(s, "p2").capitalTerritoryId = null;
    expect(computeReinforcements(s, "p1")).toBe(
      B.reinforcements.minimum + B.reinforcements.capitalBonus + B.reinforcements.foodBonus,
    );
  });
});

// === production ==================================================================

describe("AoE production", () => {
  function economyState(): AoEGameState {
    const s = mk(2, 5);
    for (const t of Object.values(s.territories)) {
      t.owner = "p2";
      t.development = { city: false, fort: false, road: false, railway: false, factory: false };
    }
    return s;
  }

  it("computes territory income tiers (normal/developed/city) plus factory and gold", () => {
    const s = economyState();
    give(s, "ht2", "p1", { infantry: 1 }); // normal, no resource
    expect(computeProductionIncome(s, "p1")).toBe(B.production.normalTerritory);
    s.territories.ht2.development.road = true; // developed
    expect(computeProductionIncome(s, "p1")).toBe(B.production.developedTerritory);
    s.territories.ht2.development.city = true; // city outranks developed
    expect(computeProductionIncome(s, "p1")).toBe(B.production.cityTerritory);
    s.territories.ht2.development.factory = true;
    expect(computeProductionIncome(s, "p1")).toBe(B.production.cityTerritory + B.production.factoryBonus);
    give(s, "ht3", "p1", { infantry: 1 }); // gold resource, normal
    expect(computeProductionIncome(s, "p1")).toBe(
      B.production.cityTerritory + B.production.factoryBonus + B.production.normalTerritory + B.production.goldBonus,
    );
  });

  it("caps stored production at 10", () => {
    let s = mk(2, 5);
    getPlayer(s, "p1").production = 9;
    s = endTurnOf(s); // p2's turn
    s = endTurnOf(s); // back to p1: income applied
    expect(getPlayer(s, "p1").production).toBe(B.production.cap);
  });
});

// === units: recruitment, availability, upgrades ==================================

describe("AoE units", () => {
  it("recruits units for reinforcements in an owned territory", () => {
    const s = mk(2, 5);
    const pid = currentPlayerId(s);
    const tid = territoriesOwnedBy(s, pid)[0];
    const before = getPlayer(s, pid).reinforcements;
    const r = recruitUnit(s, pid, tid, "infantry", 3);
    expectOk(r);
    expect(getPlayer(r.state, pid).reinforcements).toBe(before - 3 * AOE_UNIT_DEFS.infantry.cost);
    expect((r.state.territories[tid].units.infantry ?? 0)).toBe((s.territories[tid].units.infantry ?? 0) + 3);
  });

  it("rejects recruiting units from a later age", () => {
    const s = mk(2, 5);
    const pid = currentPlayerId(s);
    const tid = territoriesOwnedBy(s, pid)[0];
    expect(recruitUnit(s, pid, tid, "knight", 1)).toMatchObject({ ok: false, code: "UNIT_NOT_AVAILABLE" });
    expect(recruitUnit(s, pid, tid, "tank", 1)).toMatchObject({ ok: false, code: "UNIT_NOT_AVAILABLE" });
  });

  it("age availability table: older units stay available", () => {
    expect(unitAvailableInAge("infantry", "modern")).toBe(true);
    expect(unitAvailableInAge("cavalry", "ancient")).toBe(true);
    expect(unitAvailableInAge("spearman", "ancient")).toBe(false);
    expect(unitAvailableInAge("rifleman", "medieval")).toBe(false);
    expect(unitAvailableInAge("modernArmor", "industrial")).toBe(false);
    expect(unitAvailableInAge("modernArmor", "modern")).toBe(true);
  });

  it("rejects recruiting beyond available reinforcements and in foreign territory", () => {
    const s = mk(2, 5);
    const pid = currentPlayerId(s);
    const tid = territoriesOwnedBy(s, pid)[0];
    const other = territoriesOwnedBy(s, pid === "p1" ? "p2" : "p1")[0];
    expect(recruitUnit(s, pid, tid, "infantry", 999)).toMatchObject({ ok: false, code: "INSUFFICIENT_REINFORCEMENTS" });
    expect(recruitUnit(s, pid, other, "infantry", 1)).toMatchObject({ ok: false, code: "NOT_OWNER" });
  });

  it("iron discount: first recruit each turn costs 1 less", () => {
    const s = mk(2, 5);
    const pid = currentPlayerId(s);
    // Give the player an iron territory.
    give(s, "nr1", pid, { infantry: 1 });
    const before = getPlayer(s, pid).reinforcements;
    const r = recruitUnit(s, pid, "nr1", "cavalry", 2);
    expectOk(r);
    // First cavalry costs 1 (2-1), second costs 2.
    expect(getPlayer(r.state, pid).reinforcements).toBe(before - 3);
    expect(getPlayer(r.state, pid).ironDiscountUsedThisTurn).toBe(true);
  });

  it("upgrades units along data-driven paths for cost difference + 1 production", () => {
    let s = mk(2, 5);
    s.age = "industrial";
    const pid = currentPlayerId(s);
    const tid = territoriesOwnedBy(s, pid)[0];
    give(s, tid, pid, { cavalry: 2 });
    const p = getPlayer(s, pid);
    p.reinforcements = 10;
    p.production = 10;
    const r = upgradeUnits(s, pid, tid, "cavalry", "tank", 2);
    expectOk(r);
    s = r.state;
    // tank(4) - cavalry(2) = 2 reinforcements each, + 1 production each.
    expect(getPlayer(s, pid).reinforcements).toBe(10 - 4);
    expect(getPlayer(s, pid).production).toBe(10 - 2);
    expect(s.territories[tid].units).toEqual({ tank: 2 });
  });

  it("rejects invalid upgrade paths and future-age targets", () => {
    const s = mk(2, 5);
    const pid = currentPlayerId(s);
    const tid = territoriesOwnedBy(s, pid)[0];
    give(s, tid, pid, { infantry: 2, cavalry: 1 });
    getPlayer(s, pid).reinforcements = 10;
    getPlayer(s, pid).production = 10;
    expect(upgradeUnits(s, pid, tid, "infantry", "knight", 1)).toMatchObject({ ok: false, code: "INVALID_UPGRADE" });
    expect(upgradeUnits(s, pid, tid, "cavalry", "tank", 1)).toMatchObject({ ok: false, code: "UNIT_NOT_AVAILABLE" });
  });

  it("unit movement values match the spec", () => {
    expect(AOE_UNIT_DEFS.infantry.movement).toBe(1);
    expect(AOE_UNIT_DEFS.cavalry.movement).toBe(2);
    expect(AOE_UNIT_DEFS.mechInfantry.movement).toBe(3);
    expect(AOE_UNIT_DEFS.modernArmor.movement).toBe(4);
  });

  it("oil grants +1 movement to tanks and modern armor only", () => {
    const s = mk(2, 5);
    const pid = "p1";
    for (const tid of territoriesOwnedBy(s, pid)) s.territories[tid].owner = "p2";
    give(s, "nr3", pid, { infantry: 1 }); // oil
    expect(effectiveMovement(s, pid, "tank")).toBe(AOE_UNIT_DEFS.tank.movement + 1);
    expect(effectiveMovement(s, pid, "modernArmor")).toBe(AOE_UNIT_DEFS.modernArmor.movement + 1);
    expect(effectiveMovement(s, pid, "infantry")).toBe(AOE_UNIT_DEFS.infantry.movement);
  });
});

// === development ====================================================================

describe("AoE development", () => {
  function devState(age: AoEGameState["age"] = "medieval"): { s: AoEGameState; pid: string; tid: string } {
    let s = mk(2, 5);
    s.age = age;
    const pid = currentPlayerId(s);
    s = toPhase(s, "develop");
    const tid = territoriesOwnedBy(s, pid)[0];
    getPlayer(s, pid).production = 10;
    return { s, pid, tid };
  }

  it("builds a city for 6 production, one per territory", () => {
    const { s, pid, tid } = devState();
    const r = build(s, pid, tid, "city");
    expectOk(r);
    expect(getPlayer(r.state, pid).production).toBe(10 - B.development.cityCost);
    expect(r.state.territories[tid].development.city).toBe(true);
    expect(build(r.state, pid, tid, "city")).toMatchObject({ ok: false, code: "ALREADY_BUILT" });
  });

  it("builds fort/road and upgrades road to railway in industrial age", () => {
    const { s, pid, tid } = devState("industrial");
    let cur = s;
    for (const kind of ["fort", "road"] as const) {
      const r = build(cur, pid, tid, kind);
      expectOk(r);
      cur = r.state;
    }
    expect(cur.territories[tid].development.fort).toBe(true);
    expect(cur.territories[tid].development.road).toBe(true);
    getPlayer(cur, pid).production = 5;
    const r = build(cur, pid, tid, "railway");
    expectOk(r);
    expect(r.state.territories[tid].development.railway).toBe(true);
    expect(getPlayer(r.state, pid).production).toBe(5 - B.development.railwayUpgradeCost);
  });

  it("railway requires an existing road; buildings gate on age", () => {
    const { s, pid, tid } = devState("industrial");
    expect(build(s, pid, tid, "railway")).toMatchObject({ ok: false, code: "BUILD_NOT_AVAILABLE" });
    const ancient = devState("ancient" as never);
    expect(build(ancient.s, ancient.pid, ancient.tid, "city")).toMatchObject({ ok: false, code: "BUILD_NOT_AVAILABLE" });
    const medieval = devState();
    expect(build(medieval.s, medieval.pid, medieval.tid, "factory")).toMatchObject({ ok: false, code: "BUILD_NOT_AVAILABLE" });
  });

  it("enforces the 3-factory-per-player limit", () => {
    const { s, pid } = devState("industrial");
    let cur = s;
    const owned = territoriesOwnedBy(cur, pid);
    for (let i = 0; i < 3; i++) {
      getPlayer(cur, pid).production = 10;
      const r = build(cur, pid, owned[i], "factory");
      expectOk(r);
      cur = r.state;
    }
    getPlayer(cur, pid).production = 10;
    expect(build(cur, pid, owned[3], "factory")).toMatchObject({ ok: false, code: "FACTORY_LIMIT" });
  });

  it("rejects building without enough production", () => {
    const { s, pid, tid } = devState();
    getPlayer(s, pid).production = 1;
    expect(build(s, pid, tid, "city")).toMatchObject({ ok: false, code: "INSUFFICIENT_PRODUCTION" });
  });

  it("roman faction passive discounts forts", () => {
    let s = setupGame(
      [
        { name: "A", color: "red", faction: "romans" },
        { name: "B", color: "blue" },
      ],
      5,
    );
    s.age = "medieval";
    s = toPhase(s, "develop");
    const pid = currentPlayerId(s);
    const tid = territoriesOwnedBy(s, pid)[0];
    getPlayer(s, pid).production = 10;
    const r = build(s, pid, tid, "fort");
    expectOk(r);
    const expectedCost = pid === "p1" ? B.development.fortCost - 1 : B.development.fortCost;
    expect(getPlayer(r.state, pid).production).toBe(10 - expectedCost);
  });
});

// === movement =======================================================================

describe("AoE movement", () => {
  /** p1 owns a west-side corridor: nr1 - we1 - we2 - we3. */
  function corridor(age: AoEGameState["age"]): AoEGameState {
    const s = mk(2, 5);
    s.age = age;
    for (const t of Object.values(s.territories)) t.owner = "p2";
    give(s, "nr1", "p1", { infantry: 5 });
    give(s, "we1", "p1", { infantry: 1 });
    give(s, "we2", "p1", { infantry: 1 });
    give(s, "we3", "p1", { infantry: 1 });
    return toPhase(s, "fortify");
  }

  it("ancient: one adjacent hop through friendly territory only", () => {
    const s = corridor("ancient");
    const ok = fortifyMove(s, "p1", "nr1", "we1", { infantry: 2 });
    expectOk(ok);
    expect(ok.state.territories.we1.units.infantry).toBe(3);
    expect(fortifyMove(s, "p1", "nr1", "we2", { infantry: 2 })).toMatchObject({ ok: false, code: "INVALID_PATH" });
  });

  it("only one fortify action per turn", () => {
    const s = corridor("ancient");
    const first = fortifyMove(s, "p1", "nr1", "we1", { infantry: 1 });
    expectOk(first);
    expect(fortifyMove(first.state, "p1", "we1", "nr1", { infantry: 1 })).toMatchObject({
      ok: false,
      code: "NO_MOVES_REMAINING",
    });
  });

  it("must leave at least one unit behind and own both endpoints", () => {
    const s = corridor("ancient");
    expect(fortifyMove(s, "p1", "nr1", "we1", { infantry: 5 })).toMatchObject({ ok: false, code: "INSUFFICIENT_UNITS" });
    expect(fortifyMove(s, "p1", "nr1", "nr2", { infantry: 1 })).toMatchObject({ ok: false, code: "NOT_OWNER" });
  });

  it("medieval roads permit 2 hops along road territories", () => {
    const s = corridor("medieval");
    // Without roads: 2 hops fails.
    expect(fortifyMove(s, "p1", "nr1", "we2", { infantry: 2 })).toMatchObject({ ok: false, code: "INVALID_PATH" });
    for (const tid of ["nr1", "we1", "we2"]) s.territories[tid].development.road = true;
    const ok = fortifyMove(s, "p1", "nr1", "we2", { infantry: 2 });
    expectOk(ok);
    // 3 hops still fails even with roads everywhere.
    s.territories.we3.development.road = true;
    expect(fortifyMove(s, "p1", "nr1", "we3", { infantry: 2 })).toMatchObject({ ok: false, code: "INVALID_PATH" });
  });

  it("industrial railways move armies across the connected network", () => {
    const s = corridor("industrial");
    for (const tid of ["nr1", "we1", "we2", "we3"]) {
      s.territories[tid].development.road = true;
      s.territories[tid].development.railway = true;
    }
    const ok = fortifyMove(s, "p1", "nr1", "we3", { infantry: 3 });
    expectOk(ok);
    expect(ok.state.territories.we3.units.infantry).toBe(4);
    // Disconnected railway (gap at we2) does not connect.
    const s2 = corridor("industrial");
    for (const tid of ["nr1", "we3"]) s2.territories[tid].development.railway = true;
    expect(fortifyMove(s2, "p1", "nr1", "we3", { infantry: 2 })).toMatchObject({ ok: false, code: "INVALID_PATH" });
  });

  it("modern: unit movement values apply (group limited by slowest unit)", () => {
    const s = corridor("modern");
    give(s, "nr1", "p1", { mechInfantry: 2, infantry: 2 });
    // Mech infantry alone: 3 hops OK.
    const ok = fortifyMove(s, "p1", "nr1", "we3", { mechInfantry: 1 });
    expectOk(ok);
    // Mixed group is limited by infantry (movement 1).
    expect(fortifyMove(s, "p1", "nr1", "we3", { mechInfantry: 1, infantry: 1 })).toMatchObject({
      ok: false,
      code: "INVALID_PATH",
    });
  });

  it("movement cannot cross non-friendly territory", () => {
    const s = corridor("modern");
    give(s, "we2", "p2", { infantry: 1 }); // break the corridor
    give(s, "nr1", "p1", { mechInfantry: 2 });
    expect(fortifyMove(s, "p1", "nr1", "we3", { mechInfantry: 1 })).toMatchObject({ ok: false, code: "INVALID_PATH" });
  });

  it("listValidMoves reflects the same rules", () => {
    const s = corridor("ancient");
    const moves = listValidMoves(s);
    expect(moves).toContainEqual({ from: "nr1", to: "we1" });
    expect(moves.every((m) => m.from !== "nr1" || m.to !== "we2")).toBe(true);
  });
});

// === combat ==========================================================================

describe("AoE combat", () => {
  /** p1 at ht1 (attacker) vs p2 at ht2 (defender), attack phase. */
  function battlefield(
    attackers: Partial<Record<AoEUnitTypeId, number>>,
    defenders: Partial<Record<AoEUnitTypeId, number>>,
    opts: { seed?: number; age?: AoEGameState["age"] } = {},
  ): AoEGameState {
    const s = mk(2, opts.seed ?? 5);
    s.age = opts.age ?? "modern"; // all unit types usable unless overridden
    // Round stays 1 (keeps p1 as current player); capital protection is
    // irrelevant because all capital flags are cleared.
    for (const t of Object.values(s.territories)) {
      t.isCapital = false;
    }
    give(s, "ht1", "p1", attackers);
    give(s, "ht2", "p2", defenders);
    return toPhase(toPhase(s, "develop"), "attack");
  }

  it("dice counts: min(3, committed) attack dice and min(2, defenders) defense dice", () => {
    for (const [committed, defenders, expA, expD] of [
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [5, 3, 3, 2],
    ] as const) {
      const s = battlefield({ infantry: committed + 1 }, { infantry: defenders });
      const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: committed });
      expectOk(d);
      const r = resolveCombatRound(d.state, "p1");
      expectOk(r);
      const round = (r as { result: { attackerDice: number[]; defenderDice: number[] } }).result;
      expect(round.attackerDice.length).toBe(expA);
      expect(round.defenderDice.length).toBe(expD);
    }
  });

  it("sorts dice descending and caps casualties at 2 per round", () => {
    const s = battlefield({ infantry: 6 }, { infantry: 6 });
    const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: 5 });
    expectOk(d);
    const r = resolveCombatRound(d.state, "p1");
    expectOk(r);
    const round = r.result as unknown as { attackerDice: number[]; attackerLosses: number; defenderLosses: number };
    const sorted = [...round.attackerDice].sort((a, b) => b - a);
    expect(round.attackerDice).toEqual(sorted);
    expect(round.attackerLosses + round.defenderLosses).toBe(B.combat.maxCasualtiesPerRound);
  });

  it("defender wins ties (verified against raw dice)", () => {
    // Sweep seeds until a natural tie occurs on the top comparison with no modifiers.
    let found = false;
    for (let seed = 1; seed < 300 && !found; seed++) {
      const s = battlefield({ infantry: 4 }, { infantry: 5 }, { seed });
      const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: 3 });
      expectOk(d);
      const r = resolveCombatRound(d.state, "p1");
      expectOk(r);
      const round = r.result as unknown as {
        modifiedAttackerDice: number[];
        modifiedDefenderDice: number[];
        attackerLosses: number;
        rerolled: boolean;
      };
      if (round.modifiedAttackerDice[0] === round.modifiedDefenderDice[0] && !round.rerolled) {
        expect(round.attackerLosses).toBeGreaterThanOrEqual(1);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("is deterministic: same state resolves identically", () => {
    const s = battlefield({ infantry: 6 }, { infantry: 4 });
    const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: 4 });
    expectOk(d);
    const a = resolveCombatRound(d.state, "p1");
    const b = resolveCombatRound(d.state, "p1");
    expectOk(a);
    expectOk(b);
    expect(JSON.stringify(a.result)).toBe(JSON.stringify(b.result));
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it("must attack an adjacent, non-own territory with a spare garrison", () => {
    const s = battlefield({ infantry: 1 }, { infantry: 1 });
    expect(declareAttack(s, "p1", "ht1", "ht2", { infantry: 1 })).toMatchObject({ ok: false, code: "INSUFFICIENT_UNITS" });
    give(s, "ht1", "p1", { infantry: 5 });
    give(s, "es4", "p2", { infantry: 1 }); // distant enemy territory
    expect(declareAttack(s, "p1", "ht1", "es4", { infantry: 2 })).toMatchObject({ ok: false, code: "NOT_ADJACENT" });
    give(s, "ht2", "p1", { infantry: 1 });
    expect(declareAttack(s, "p1", "ht1", "ht2", { infantry: 2 })).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });

  it("cavalry adds +1 to the highest attack die (capped at 6)", () => {
    const s = battlefield({ cavalry: 3, infantry: 1 }, { infantry: 2 });
    const d = declareAttack(s, "p1", "ht1", "ht2", { cavalry: 3 });
    expectOk(d);
    const r = resolveCombatRound(d.state, "p1");
    expectOk(r);
    const round = r.result as unknown as { attackerDice: number[]; modifiedAttackerDice: number[]; rerolled: boolean };
    expect(round.modifiedAttackerDice[0]).toBe(Math.min(6, round.attackerDice[0] + 1));
  });

  it("fort and city each add +1 to the highest defender die", () => {
    const s = battlefield({ infantry: 4 }, { infantry: 2 });
    s.territories.ht2.development.fort = true;
    s.territories.ht2.development.city = true;
    const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: 3 });
    expectOk(d);
    const r = resolveCombatRound(d.state, "p1");
    expectOk(r);
    const round = r.result as unknown as { defenderDice: number[]; modifiedDefenderDice: number[] };
    expect(round.modifiedDefenderDice[0]).toBe(Math.min(6, round.defenderDice[0] + 2));
  });

  it("artillery negates forts: +1 highest attack die when attacking a fort", () => {
    const s = battlefield({ artillery: 3, infantry: 1 }, { infantry: 2 });
    s.territories.ht2.development.fort = true;
    const d = declareAttack(s, "p1", "ht1", "ht2", { artillery: 3 });
    expectOk(d);
    const r = resolveCombatRound(d.state, "p1");
    expectOk(r);
    const round = r.result as unknown as { attackerDice: number[]; modifiedAttackerDice: number[] };
    expect(round.modifiedAttackerDice[0]).toBe(Math.min(6, round.attackerDice[0] + 1));
  });

  it("spearmen gain +1 defense against mounted attackers only", () => {
    const mounted = battlefield({ knight: 3, infantry: 1 }, { spearman: 2 });
    const d1 = declareAttack(mounted, "p1", "ht1", "ht2", { knight: 3 });
    expectOk(d1);
    const r1 = resolveCombatRound(d1.state, "p1");
    expectOk(r1);
    const round1 = r1.result as unknown as { defenderDice: number[]; modifiedDefenderDice: number[] };
    expect(round1.modifiedDefenderDice[0]).toBe(Math.min(6, round1.defenderDice[0] + 1));

    const unmounted = battlefield({ rifleman: 3, infantry: 1 }, { spearman: 2 });
    const d2 = declareAttack(unmounted, "p1", "ht1", "ht2", { rifleman: 3 });
    expectOk(d2);
    const r2 = resolveCombatRound(d2.state, "p1");
    expectOk(r2);
    const round2 = r2.result as unknown as { defenderDice: number[]; modifiedDefenderDice: number[] };
    expect(round2.modifiedDefenderDice[0]).toBe(round2.defenderDice[0]);
  });

  it("combined arms: 3+ unit types add +1 (non-stacking with itself)", () => {
    const s = battlefield({ infantry: 2, artillery: 1, rifleman: 1 }, { infantry: 2 });
    const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: 1, artillery: 1, rifleman: 1 });
    expectOk(d);
    const r = resolveCombatRound(d.state, "p1");
    expectOk(r);
    const round = r.result as unknown as { attackerDice: number[]; modifiedAttackerDice: number[]; rerolled: boolean };
    if (!round.rerolled) {
      expect(round.modifiedAttackerDice[0]).toBe(Math.min(6, round.attackerDice[0] + 1));
    }
  });

  it("modern armor's modified die wins ties", () => {
    let observedTieWin = false;
    for (let seed = 1; seed < 400 && !observedTieWin; seed++) {
      const s = battlefield({ modernArmor: 3, infantry: 1 }, { infantry: 5 }, { seed });
      const d = declareAttack(s, "p1", "ht1", "ht2", { modernArmor: 3 });
      expectOk(d);
      const r = resolveCombatRound(d.state, "p1");
      expectOk(r);
      const round = r.result as unknown as {
        modifiedAttackerDice: number[];
        modifiedDefenderDice: number[];
        defenderLosses: number;
      };
      if (round.modifiedAttackerDice[0] === round.modifiedDefenderDice[0]) {
        expect(round.defenderLosses).toBeGreaterThanOrEqual(1);
        observedTieWin = true;
      }
    }
    expect(observedTieWin).toBe(true);
  });

  it("rifleman reroll fires at most once per battle", () => {
    const s = battlefield({ rifleman: 3, infantry: 1 }, { infantry: 8 });
    const d = declareAttack(s, "p1", "ht1", "ht2", { rifleman: 3 });
    expectOk(d);
    let cur = d.state;
    let rerolls = 0;
    for (let i = 0; i < 20 && cur.battle; i++) {
      const r = resolveCombatRound(cur, "p1");
      expectOk(r);
      if ((r.result as unknown as { rerolled: boolean }).rerolled) rerolls++;
      cur = r.state;
    }
    expect(rerolls).toBeLessThanOrEqual(1);
  });

  it("withdraw ends the battle and bars that territory from attacking again this phase", () => {
    const s = battlefield({ infantry: 6 }, { infantry: 6 });
    const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: 4 });
    expectOk(d);
    const w = withdraw(d.state, "p1");
    expectOk(w);
    expect(w.state.battle).toBeNull();
    expect(w.state.withdrawnTerritories).toContain("ht1");
    expect(declareAttack(w.state, "p1", "ht1", "ht2", { infantry: 2 })).toMatchObject({
      ok: false,
      code: "TERRITORY_WITHDRAWN",
    });
  });

  it("capture: attackers advance, ownership flips, benefits transfer, source keeps garrison", () => {
    const s = battlefield({ tank: 6, infantry: 1 }, { infantry: 1 });
    s.territories.ht2.development.city = true;
    const d = declareAttack(s, "p1", "ht1", "ht2", { tank: 5 });
    expectOk(d);
    let cur = d.state;
    for (let i = 0; i < 20 && cur.battle; i++) {
      const r = resolveCombatRound(cur, "p1");
      expectOk(r);
      cur = r.state;
    }
    expect(cur.territories.ht2.owner).toBe("p1");
    expect(cur.territories.ht2.development.city).toBe(true); // city stays for new owner
    expect(unitCount(cur.territories.ht1.units)).toBeGreaterThanOrEqual(1);
    expect(unitCount(cur.territories.ht2.units)).toBeGreaterThanOrEqual(1);
    expect(cur.capturedPlayerTerritoryThisTurn).toBe(true);
  });

  it("casualties never touch the stay-behind garrison", () => {
    const s = battlefield({ infantry: 1, tank: 2 }, { infantry: 8 });
    const d = declareAttack(s, "p1", "ht1", "ht2", { tank: 2 });
    expectOk(d);
    let cur = d.state;
    for (let i = 0; i < 30 && cur.battle; i++) {
      const r = resolveCombatRound(cur, "p1");
      expectOk(r);
      cur = r.state;
      // The garrison infantry must survive every round.
      expect(cur.territories.ht1.units.infantry).toBe(1);
    }
  });

  it("first-round capital protection blocks capital attacks", () => {
    const s = mk(2, 5);
    const p2capital = getPlayer(s, "p2").capitalTerritoryId!;
    const adjacent = AOE_TERRITORY_BY_ID[p2capital].adjacent[0];
    give(s, adjacent, "p1", { infantry: 5 });
    const atk = toPhase(toPhase(s, "develop"), "attack");
    expect(declareAttack(atk, "p1", adjacent, p2capital, { infantry: 3 })).toMatchObject({
      ok: false,
      code: "CAPITAL_PROTECTED",
    });
    expect(listValidAttacks(atk).every((a) => a.to !== p2capital)).toBe(true);
  });

  it("treaties block attacks between the parties for the round", () => {
    const s = battlefield({ infantry: 5 }, { infantry: 2 });
    const t = formTreaty(s, "p1", "p2");
    expectOk(t);
    expect(declareAttack(t.state, "p1", "ht1", "ht2", { infantry: 3 })).toMatchObject({
      ok: false,
      code: "TREATY_ACTIVE",
    });
    // Treaty expires after the round (skip 2 rounds so p1 is current again).
    const later = cloneState(t.state);
    later.round += 2;
    expect(declareAttack(later, "p1", "ht1", "ht2", { infantry: 3 }).ok).toBe(true);
  });

  it("listValidAttacks lists only legal adjacent enemy targets from 2+-unit territories", () => {
    const s = battlefield({ infantry: 5 }, { infantry: 2 });
    const attacks = listValidAttacks(s);
    expect(attacks).toContainEqual({ from: "ht1", to: "ht2" });
    for (const a of attacks) {
      expect(s.territories[a.from].owner).toBe("p1");
      expect(s.territories[a.to].owner).not.toBe("p1");
      expect(unitCount(s.territories[a.from].units)).toBeGreaterThanOrEqual(2);
      expect(AOE_TERRITORY_BY_ID[a.from].adjacent).toContain(a.to);
    }
  });
});

// === cards ============================================================================

describe("AoE cards", () => {
  it("capturing a player territory draws exactly one card at end of turn", () => {
    const s = mk(2, 5);
    s.capturedPlayerTerritoryThisTurn = true;
    const before = getPlayer(s, currentPlayerId(s)).cards.length;
    const pid = currentPlayerId(s);
    const after = endTurnOf(s);
    expect(getPlayer(after, pid).cards.length).toBe(before + 1);
  });

  it("no card without a player-territory capture (neutral-only conquest)", () => {
    const s = mk(2, 5);
    s.capturedAnyTerritoryThisTurn = true; // neutral capture only
    const pid = currentPlayerId(s);
    const after = endTurnOf(s);
    expect(getPlayer(after, pid).cards.length).toBe(0);
  });

  it("respects the hand limit of 5", () => {
    const s = mk(2, 5);
    const pid = currentPlayerId(s);
    for (let i = 0; i < 8; i++) drawCard(s, pid);
    expect(getPlayer(s, pid).cards.length).toBe(B.cards.handLimit);
  });

  it("matching set gives +4, mixed set +6, invalid 2-type set rejected", () => {
    const s = mk(2, 5);
    const pid = currentPlayerId(s);
    const p = getPlayer(s, pid);
    p.cards = [
      { id: "a", type: "reinforcement" },
      { id: "b", type: "reinforcement" },
      { id: "c", type: "reinforcement" },
      { id: "d", type: "forcedMarch" },
      { id: "e", type: "rapidDeployment" },
    ];
    const before = p.reinforcements;
    const matching = tradeCardSet(s, pid, ["a", "b", "c"]);
    expectOk(matching);
    expect(getPlayer(matching.state, pid).reinforcements).toBe(before + B.cards.matchingSetReinforcements);
    expect(getPlayer(matching.state, pid).cards.length).toBe(2);

    const mixed = tradeCardSet(s, pid, ["a", "d", "e"]);
    expectOk(mixed);
    expect(getPlayer(mixed.state, pid).reinforcements).toBe(before + B.cards.mixedSetReinforcements);

    expect(tradeCardSet(s, pid, ["a", "b", "d"])).toMatchObject({ ok: false, code: "INVALID_CARD_SET" });
  });

  it("reinforcement card adds +3 during reinforce", () => {
    const s = mk(2, 5);
    const pid = currentPlayerId(s);
    getPlayer(s, pid).cards = [{ id: "x", type: "reinforcement" }];
    const before = getPlayer(s, pid).reinforcements;
    const r = playCard(s, pid, "x");
    expectOk(r);
    expect(getPlayer(r.state, pid).reinforcements).toBe(before + B.cards.reinforcementCardValue);
    expect(getPlayer(r.state, pid).cards.length).toBe(0);
  });

  it("rapid deployment grants an extra fortify move", () => {
    let s = mk(2, 5);
    for (const t of Object.values(s.territories)) t.owner = "p2";
    give(s, "nr1", "p1", { infantry: 5 });
    give(s, "we1", "p1", { infantry: 1 });
    give(s, "we2", "p1", { infantry: 1 });
    s = toPhase(s, "fortify");
    getPlayer(s, "p1").cards = [{ id: "x", type: "rapidDeployment" }];
    const c = playCard(s, "p1", "x");
    expectOk(c);
    const m1 = fortifyMove(c.state, "p1", "nr1", "we1", { infantry: 1 });
    expectOk(m1);
    const m2 = fortifyMove(m1.state, "p1", "we1", "we2", { infantry: 1 });
    expectOk(m2);
    expect(fortifyMove(m2.state, "p1", "we1", "nr1", { infantry: 1 })).toMatchObject({
      ok: false,
      code: "NO_MOVES_REMAINING",
    });
  });

  it("forced march extends the next move's range", () => {
    let s = mk(2, 5);
    s.age = "ancient";
    for (const t of Object.values(s.territories)) t.owner = "p2";
    give(s, "nr1", "p1", { infantry: 5 });
    give(s, "we1", "p1", { infantry: 1 });
    give(s, "we2", "p1", { infantry: 1 });
    s = toPhase(s, "fortify");
    getPlayer(s, "p1").cards = [{ id: "x", type: "forcedMarch" }];
    expect(fortifyMove(s, "p1", "nr1", "we2", { infantry: 1 })).toMatchObject({ ok: false, code: "INVALID_PATH" });
    const c = playCard(s, "p1", "x");
    expectOk(c);
    const m = fortifyMove(c.state, "p1", "nr1", "we2", { infantry: 1 });
    expectOk(m);
  });

  it("emergency defense moves up to 3 armies into a threatened territory", () => {
    const s = mk(2, 5);
    for (const t of Object.values(s.territories)) t.owner = "p2";
    give(s, "ht1", "p1", { infantry: 5 });
    give(s, "ht2", "p1", { infantry: 1 }); // adjacent to es2 (p2) => threatened
    getPlayer(s, "p1").cards = [{ id: "x", type: "emergencyDefense" }];
    const r = playCard(s, "p1", "x", { fromTerritoryId: "ht1", territoryId: "ht2", units: { infantry: 3 } });
    expectOk(r);
    expect(r.state.territories.ht2.units.infantry).toBe(4);
    // Over the limit fails.
    getPlayer(s, "p1").cards = [{ id: "y", type: "emergencyDefense" }];
    expect(playCard(s, "p1", "y", { fromTerritoryId: "ht1", territoryId: "ht2", units: { infantry: 4 } })).toMatchObject({
      ok: false,
      code: "INVALID_ARGUMENT",
    });
  });

  it("artillery support adds a one-battle attack bonus", () => {
    let s = mk(2, 5);
    for (const t of Object.values(s.territories)) t.isCapital = false;
    give(s, "ht1", "p1", { infantry: 5 });
    give(s, "ht2", "p2", { infantry: 3 });
    s = toPhase(toPhase(s, "develop"), "attack");
    getPlayer(s, "p1").cards = [{ id: "x", type: "artillerySupport" }];
    expect(playCard(s, "p1", "x")).toMatchObject({ ok: false, code: "NO_BATTLE" });
    const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: 3 });
    expectOk(d);
    const c = playCard(d.state, "p1", "x");
    expectOk(c);
    expect(c.state.battle!.attackDieBonus).toBe(1);
    const r = resolveCombatRound(c.state, "p1");
    expectOk(r);
    const round = r.result as unknown as { attackerDice: number[]; modifiedAttackerDice: number[]; rerolled: boolean };
    if (!round.rerolled) {
      expect(round.modifiedAttackerDice[0]).toBe(Math.min(6, round.attackerDice[0] + 1));
    }
  });
});

// === capitals =========================================================================

describe("AoE capitals", () => {
  function capitalCaptureState(): { s: AoEGameState; capital: string } {
    const s = mk(2, 5);
    s.age = "modern";
    s.round = 3; // 2 players: odd rounds keep p1 first
    const capital = getPlayer(s, "p2").capitalTerritoryId!;
    give(s, capital, "p2", { infantry: 1 });
    s.territories[capital].isCapital = true;
    const from = AOE_TERRITORY_BY_ID[capital].adjacent[0];
    give(s, from, "p1", { tank: 8, infantry: 1 });
    return { s: toPhase(toPhase(s, "develop"), "attack"), capital };
  }

  it("capital capture: +2 VP to capturer, owner loses bonus but is not eliminated", () => {
    const { s, capital } = capitalCaptureState();
    const from = AOE_TERRITORY_BY_ID[capital].adjacent[0];
    const d = declareAttack(s, "p1", from, capital, { tank: 6 });
    expectOk(d);
    let cur = d.state;
    for (let i = 0; i < 30 && cur.battle; i++) {
      const r = resolveCombatRound(cur, "p1");
      expectOk(r);
      cur = r.state;
    }
    expect(cur.territories[capital].owner).toBe("p1");
    expect(getPlayer(cur, "p1").bonusVp).toBe(B.vp.capitalCapture);
    const loser = getPlayer(cur, "p2");
    expect(loser.capitalTerritoryId).toBeNull();
    expect(loser.eliminated).toBe(false);
    expect(loser.capitalRebuildAvailableAfterRound).toBe(cur.round);
    expect(computeScore(cur, "p2").capital).toBe(0);
  });

  it("a new capital can be established after the next turn for 4 production", () => {
    const s = mk(2, 5);
    const p = getPlayer(s, "p2");
    const capital = p.capitalTerritoryId!;
    s.territories[capital].isCapital = false;
    s.territories[capital].owner = "p1";
    p.capitalTerritoryId = null;
    p.capitalRebuildAvailableAfterRound = s.round; // lost this round
    p.production = 10;
    const target = territoriesOwnedBy(s, "p2")[0];

    // Same round: rejected.
    let cur = endTurnOf(s); // now p2's turn, still same round
    expect(currentPlayerId(cur)).toBe("p2");
    cur = toPhase(cur, "develop");
    expect(establishNewCapital(cur, "p2", target)).toMatchObject({ ok: false, code: "CAPITAL_REBUILD_NOT_READY" });

    // Next round: allowed.
    cur = endTurnOf(cur); // round 2, p2 first
    expect(cur.round).toBe(2);
    cur = toPhase(cur, "develop");
    const active = currentPlayerId(cur);
    if (active !== "p2") {
      cur = toPhase(endTurnOf(cur), "develop");
    }
    const before = getPlayer(cur, "p2").production;
    const r = establishNewCapital(cur, "p2", target);
    expectOk(r);
    expect(getPlayer(r.state, "p2").capitalTerritoryId).toBe(target);
    expect(getPlayer(r.state, "p2").production).toBe(before - B.development.newCapitalCost);
    expect(r.state.territories[target].isCapital).toBe(true);
  });
});

// === elimination =======================================================================

describe("AoE elimination", () => {
  it("a player with zero territories is eliminated and leaves initiative", () => {
    const s = mk(3, 5);
    s.age = "modern";
    for (const t of Object.values(s.territories)) t.isCapital = false;
    // p3 owns exactly one weak territory next to a strong p1 stack.
    for (const tid of territoriesOwnedBy(s, "p3")) s.territories[tid].owner = "p1";
    give(s, "ht2", "p3", { infantry: 1 });
    getPlayer(s, "p3").capitalTerritoryId = null;
    give(s, "ht1", "p1", { tank: 8, infantry: 1 });
    let cur = toPhase(toPhase(s, "develop"), "attack");
    const d = declareAttack(cur, "p1", "ht1", "ht2", { tank: 6 });
    expectOk(d);
    cur = d.state;
    for (let i = 0; i < 30 && cur.battle; i++) {
      const r = resolveCombatRound(cur, "p1");
      expectOk(r);
      cur = r.state;
    }
    expect(getPlayer(cur, "p3").eliminated).toBe(true);
    expect(initiativeOrder(cur)).not.toContain("p3");
    expect(currentPlayerId(cur)).toBe("p1"); // turn pointer stays on the attacker
  });
});

// === objectives ==========================================================================

describe("AoE objectives", () => {
  it("tracks and permanently completes control objectives at end of turn", () => {
    const s = mk(2, 5);
    const pid = currentPlayerId(s);
    const p = getPlayer(s, pid);
    p.objectiveIds = ["heartland"];
    p.completedObjectiveIds = [];
    for (const tid of AOE_REGION_BY_ID.heartland.territories) give(s, tid, pid, { infantry: 1 });
    const after = endTurnOf(s);
    expect(getPlayer(after, pid).completedObjectiveIds).toContain("heartland");
    // Losing the region later does not un-complete it.
    const lost = cloneState(after);
    for (const tid of AOE_REGION_BY_ID.heartland.territories) lost.territories[tid].owner = null;
    expect(getPlayer(lost, pid).completedObjectiveIds).toContain("heartland");
  });

  it("railway network objective uses connected components", () => {
    const s = mk(2, 5);
    for (const tid of ["ht1", "ht2", "ht4"]) {
      s.territories[tid].owner = "p1";
      s.territories[tid].development.railway = true;
    }
    // ht1-ht2 adjacency + ht2-ht4 => component of 3.
    expect(largestRailwayNetwork(s, "p1")).toBe(3);
    s.territories.ht3.owner = "p1";
    s.territories.ht3.development.railway = true;
    expect(largestRailwayNetwork(s, "p1")).toBe(4);
  });

  it("hold-capital objective completes only at game end while the original capital is held", () => {
    const s = mk(2, 5);
    const p1 = getPlayer(s, "p1");
    p1.objectiveIds = ["holdCapital"];
    p1.completedObjectiveIds = [];
    const mid = endTurnOf(s);
    expect(getPlayer(mid, "p1").completedObjectiveIds).toEqual([]);
    const final = cloneState(mid);
    finalizeGame(final);
    expect(getPlayer(final, "p1").completedObjectiveIds).toContain("holdCapital");
  });

  it("objective VP contributes +4 each", () => {
    const s = mk(2, 5);
    const p = getPlayer(s, "p1");
    p.completedObjectiveIds = ["regions3", "cities5"];
    expect(computeScore(s, "p1").objectives).toBe(2 * B.vp.objective);
  });
});

// === victory =============================================================================

describe("AoE victory & scoring", () => {
  it("computes baseline VP per component", () => {
    const s = mk(2, 5);
    for (const t of Object.values(s.territories)) {
      t.owner = "p2";
      t.isCapital = false;
      t.development = { city: false, fort: false, road: false, railway: false, factory: false };
    }
    const p1 = getPlayer(s, "p1");
    // p1: the full small region northreach (nr1 iron, nr3 oil), a city, a capital.
    for (const tid of AOE_REGION_BY_ID.northreach.territories) give(s, tid, "p1", { infantry: 1 });
    s.territories.nr2.development.city = true;
    s.territories.nr2.isCapital = true;
    p1.capitalTerritoryId = "nr2";
    p1.bonusVp = 2;
    const score = computeScore(s, "p1");
    expect(score.territories).toBe(3 * B.vp.territory);
    expect(score.regions).toBe(B.vp.region);
    expect(score.cities).toBe(B.vp.city);
    expect(score.capital).toBe(B.vp.capital);
    expect(score.resources).toBe(2 * B.vp.resourceTerritory);
    expect(score.bonus).toBe(2);
    expect(score.total).toBe(3 + 5 + 2 + 3 + 2 + 2);
  });

  it("winner is the highest VP; territory tiebreaker applies", () => {
    const s = mk(2, 5);
    for (const t of Object.values(s.territories)) {
      t.owner = null;
      t.isCapital = false;
      t.development = { city: false, fort: false, road: false, railway: false, factory: false };
    }
    getPlayer(s, "p1").capitalTerritoryId = null;
    getPlayer(s, "p2").capitalTerritoryId = null;
    give(s, "ht1", "p1", { infantry: 1 });
    give(s, "ht2", "p1", { infantry: 1 });
    give(s, "ht3", "p2", { infantry: 1 });
    finalizeGame(s);
    expect(s.winnerIds).toEqual(["p1"]);
  });

  it("full tie yields shared victory", () => {
    const s = mk(2, 5);
    for (const t of Object.values(s.territories)) {
      t.owner = null;
      t.isCapital = false;
      t.development = { city: false, fort: false, road: false, railway: false, factory: false };
    }
    getPlayer(s, "p1").capitalTerritoryId = null;
    getPlayer(s, "p2").capitalTerritoryId = null;
    getPlayer(s, "p1").objectiveIds = [];
    getPlayer(s, "p2").objectiveIds = [];
    // ht2 and ht4 carry no resources, so the position is fully symmetric.
    give(s, "ht2", "p1", { infantry: 2 });
    give(s, "ht4", "p2", { infantry: 2 });
    finalizeGame(s);
    expect(s.winnerIds!.sort()).toEqual(["p1", "p2"]);
  });

  it("unit-count tiebreaker breaks equal territory/city ties", () => {
    const s = mk(2, 5);
    for (const t of Object.values(s.territories)) {
      t.owner = null;
      t.isCapital = false;
      t.development = { city: false, fort: false, road: false, railway: false, factory: false };
    }
    getPlayer(s, "p1").capitalTerritoryId = null;
    getPlayer(s, "p2").capitalTerritoryId = null;
    getPlayer(s, "p1").objectiveIds = [];
    getPlayer(s, "p2").objectiveIds = [];
    give(s, "ht1", "p1", { infantry: 5 });
    give(s, "ht2", "p2", { infantry: 2 });
    finalizeGame(s);
    expect(s.winnerIds).toEqual(["p1"]);
  });

  it("age transition bonus goes to the sole leader only", () => {
    let s = mk(2, 5);
    // Make p1 clearly ahead in territories before the age flips.
    for (const t of Object.values(s.territories)) t.owner = "p1";
    give(s, "ht2", "p2", { infantry: 1 });
    s = markAgeTimerExpired(s);
    while (s.ageTimerExpired && !s.gameOver) s = endTurnOf(s);
    expect(s.age).toBe("medieval");
    expect(getPlayer(s, "p1").bonusVp).toBe(B.vp.ageTransitionBonus);
    expect(getPlayer(s, "p2").bonusVp).toBe(0);
  });
});

// === air support ===========================================================================

describe("AoE air support", () => {
  function modernState(): AoEGameState {
    const s = mk(2, 5);
    s.age = "modern";
    s.round = 3;
    for (const p of s.players) p.airSupportCharges = 2;
    for (const t of Object.values(s.territories)) t.isCapital = false;
    return s;
  }

  it("requires modern age and remaining charges", () => {
    const s = mk(2, 5);
    expect(useAirSupport(s, "p1", "redeploy")).toMatchObject({ ok: false, code: "NO_AIR_SUPPORT" });
    const m = modernState();
    getPlayer(m, "p1").airSupportCharges = 0;
    expect(useAirSupport(m, "p1", "redeploy")).toMatchObject({ ok: false, code: "NO_AIR_SUPPORT" });
  });

  it("strike removes one cheapest unit within 2 territories of the player's borders", () => {
    const s = modernState();
    for (const t of Object.values(s.territories)) t.owner = "p2";
    give(s, "ht1", "p1", { infantry: 3 });
    give(s, "ht2", "p2", { infantry: 2, tank: 1 });
    const r = useAirSupport(s, "p1", "strike", { territoryId: "ht2" });
    expectOk(r);
    expect(r.state.territories.ht2.units).toEqual({ infantry: 1, tank: 1 });
    expect(getPlayer(r.state, "p1").airSupportCharges).toBe(1);
    // Cannot strike a defenseless (1-unit) territory or distant target.
    give(s, "ht2", "p2", { infantry: 1 });
    expect(useAirSupport(s, "p1", "strike", { territoryId: "ht2" })).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(useAirSupport(s, "p1", "strike", { territoryId: "is2" })).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });

  it("redeploy moves up to 3 units between owned territories anywhere", () => {
    const s = modernState();
    for (const t of Object.values(s.territories)) t.owner = "p2";
    give(s, "nr1", "p1", { infantry: 5 });
    give(s, "sl4", "p1", { infantry: 1 }); // far away
    const r = useAirSupport(s, "p1", "redeploy", { fromTerritoryId: "nr1", territoryId: "sl4", units: { infantry: 3 } });
    expectOk(r);
    expect(r.state.territories.sl4.units.infantry).toBe(4);
    expect(useAirSupport(s, "p1", "redeploy", { fromTerritoryId: "nr1", territoryId: "sl4", units: { infantry: 4 } })).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });

  it("strike and redeploy are barred off-turn and while a battle is in progress", () => {
    let s = modernState();
    give(s, "ht1", "p1", { infantry: 6 });
    give(s, "ht2", "p2", { infantry: 3 });
    give(s, "ht3", "p1", { infantry: 2 });
    // Off-turn: p2 is not the current player.
    expect(useAirSupport(s, "p2", "strike", { territoryId: "ht1" })).toMatchObject({ ok: false, code: "WRONG_PLAYER" });
    s = toPhase(toPhase(s, "develop"), "attack");
    const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: 4 });
    expectOk(d);
    // Mid-battle: attacker cannot redeploy committed units away.
    expect(
      useAirSupport(d.state, "p1", "redeploy", { fromTerritoryId: "ht1", territoryId: "ht3", units: { infantry: 2 } }),
    ).toMatchObject({ ok: false, code: "BATTLE_IN_PROGRESS" });
    expect(useAirSupport(d.state, "p1", "strike", { territoryId: "ht4" })).toMatchObject({ ok: false, code: "BATTLE_IN_PROGRESS" });
  });

  it("rejects NaN, fractional, and unknown-unit stacks", () => {
    const s = modernState();
    give(s, "nr1", "p1", { infantry: 5 });
    give(s, "nr2", "p1", { infantry: 1 });
    for (const bad of [{ infantry: Number.NaN }, { infantry: 1.5 }, { dragon: 1 } as never]) {
      expect(
        useAirSupport(s, "p1", "redeploy", { fromTerritoryId: "nr1", territoryId: "nr2", units: bad }),
      ).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    }
    const atk = toPhase(toPhase(s, "develop"), "attack");
    give(atk, "ht2", "p2", { infantry: 2 });
    give(atk, "ht1", "p1", { infantry: 5 });
    expect(declareAttack(atk, "p1", "ht1", "ht2", { infantry: Number.NaN })).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    expect(recruitUnit(mk(2, 5), "p1", "nr1", "infantry", Number.NaN)).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
  });

  it("attack bonus applies to the active battle", () => {
    let s = modernState();
    give(s, "ht1", "p1", { infantry: 5 });
    give(s, "ht2", "p2", { infantry: 3 });
    s = toPhase(toPhase(s, "develop"), "attack");
    const d = declareAttack(s, "p1", "ht1", "ht2", { infantry: 3 });
    expectOk(d);
    const r = useAirSupport(d.state, "p1", "attackBonus");
    expectOk(r);
    expect(r.state.battle!.attackDieBonus).toBe(1);
    expect(getPlayer(r.state, "p1").airSupportCharges).toBe(1);
  });
});

// === view model =============================================================================

describe("AoE view model", () => {
  it("exposes the fields the tabletop UI needs", () => {
    const s = mk(3, 5);
    const view = getGameView(s, listValidAttacks(s), listValidMoves(s));
    expect(view.currentPlayerId).toBe("p1");
    expect(view.age).toBe("ancient");
    expect(view.round).toBe(1);
    expect(view.phase).toBe("reinforce");
    expect(view.ageDurationMs).toBe(B.ageDurationMs);
    expect(view.players.length).toBe(3);
    expect(view.players[0].objectives.length).toBe(3);
    expect(view.territories.length).toBe(24);
    expect(view.territories[0]).toHaveProperty("units");
    expect(view.territories[0]).toHaveProperty("development");
    expect(Array.isArray(view.validAttacks)).toBe(true);
    expect(Array.isArray(view.validMoves)).toBe(true);
    expect(Array.isArray(view.log)).toBe(true);
    expect(view.log.length).toBeGreaterThan(0);
  });

  it("reports player VP live", () => {
    const s = mk(2, 5);
    const view = getGameView(s, [], []);
    const p1 = view.players.find((p) => p.id === "p1")!;
    expect(p1.vp).toBe(computeScore(s, "p1").total);
    expect(p1.vp).toBeGreaterThan(0);
  });
});

// === full-game smoke test =====================================================================

describe("AoE full-game determinism", () => {
  it("a scripted 4-player game runs to completion identically twice", () => {
    const play = (): AoEGameState => {
      let s = mk(4, 1234);
      let guard = 0;
      while (!s.gameOver && guard++ < 500) {
        const pid = currentPlayerId(s);
        // Recruit everything as infantry on the first owned territory.
        const owned = territoriesOwnedBy(s, pid);
        if (owned.length > 0 && getPlayer(s, pid).reinforcements > 0) {
          const r = recruitUnit(s, pid, owned[0], "infantry", getPlayer(s, pid).reinforcements);
          if (r.ok) s = r.state;
        }
        s = toPhase(s, "attack");
        // One attack per turn if possible; fight to the end.
        const attacks = listValidAttacks(s);
        if (attacks.length > 0) {
          const a = attacks[0];
          const from = s.territories[a.from].units;
          const commit = Math.min(3, unitCount(from) - 1);
          const d = declareAttack(s, pid, a.from, a.to, { infantry: Math.min(commit, from.infantry ?? 0) || 0, cavalry: 0 });
          if (d.ok) {
            s = d.state;
            let rounds = 0;
            while (s.battle && rounds++ < 10) {
              const r = resolveCombatRound(s, pid);
              if (!r.ok) break;
              s = r.state;
            }
            if (s.battle) {
              const w = withdraw(s, pid);
              if (w.ok) s = w.state;
            }
          }
        }
        s = endTurnOf(s);
        // Fast-forward ages so the game terminates.
        if (s.round === 4 || s.round === 7 || s.round === 10 || s.round === 13) {
          if (!s.ageTimerExpired) s = markAgeTimerExpired(s);
        }
      }
      return s;
    };
    const a = play();
    const b = play();
    expect(a.gameOver).toBe(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.winnerIds).not.toBeNull();
  });
});
