// ─────────────────────────────────────────────────────────────────────────
// Combat lifecycle termination — regression tests
//
// Bug: after the final hostile died, victory was detected (derived status /
// banner) but nothing made the terminal state authoritative — endTurn had no
// outcome guard, so any caller could keep generating turns indefinitely.
//
// Fix under test: endTurn (and the UI path above it) refuses to advance once
// checkEncounterStatus(state) !== "ongoing", returning the state unchanged.
// Because the terminal status is a pure derivation of combatant state and the
// guard is a no-op, victory/defeat handling is idempotent by construction:
// repeated observation cannot complete an encounter twice or duplicate logs.
// ─────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import { buildEncounter } from "@/engine/content";
import {
  checkEncounterStatus,
  endTurn,
  executeAttack,
  resolveLeadingEnemyTurns,
  runEnemyAI,
} from "@/engine/rules";
import type { GameState } from "@/engine/content";

/** Deterministic RNG: always max roll — every attack hits and kills fast. */
const maxRng = () => 0.999999;

function freshQuickBattle(): GameState {
  return buildEncounter("quickBattle", 42);
}

/** Kill every combatant of a type in-place on a cloned state. */
function withAllDead(state: GameState, type: "pc" | "enemy"): GameState {
  const next: GameState = JSON.parse(JSON.stringify(state));
  for (const c of Object.values(next.combatants)) {
    if (c.type === type) {
      c.hp = 0;
      c.alive = false;
    }
  }
  return next;
}

describe("combat termination on victory (regression)", () => {
  it("defeating the final enemy through a real attack reaches victory", () => {
    let state = freshQuickBattle();
    // Ensure it is the fighter's turn (quickBattle guarantees PC-first).
    const actorId = state.turnOrder[state.turnIndex];
    expect(state.combatants[actorId].type).toBe("pc");
    const enemy = Object.values(state.combatants).find((c) => c.type === "enemy")!;
    const res = executeAttack(state, actorId, enemy.id, maxRng);
    expect(res.ok).toBe(true);
    state = res.state;
    expect(checkEncounterStatus(state)).toBe("victory");
  });

  it("endTurn after victory generates no further turn — state is returned unchanged", () => {
    const victory = withAllDead(freshQuickBattle(), "enemy");
    const after = endTurn(victory);
    expect(after).toBe(victory); // same reference: exact no-op
    expect(after.turnIndex).toBe(victory.turnIndex);
    expect(after.round).toBe(victory.round);
    expect(after.log).toEqual(victory.log);
  });

  it("repeated end-turn attempts after victory are idempotent (no duplicate completion)", () => {
    const victory = withAllDead(freshQuickBattle(), "enemy");
    let state = victory;
    for (let i = 0; i < 5; i++) state = endTurn(state);
    expect(state).toBe(victory);
    expect(state.log).toEqual(victory.log); // no duplicated logs/results
    expect(checkEncounterStatus(state)).toBe("victory");
  });

  it("resolveLeadingEnemyTurns after victory does nothing", () => {
    const victory = withAllDead(freshQuickBattle(), "enemy");
    const after = resolveLeadingEnemyTurns(victory, maxRng);
    expect(after).toBe(victory);
  });

  it("defeated enemies are not active combatants: a dead actor never receives a turn", () => {
    // Multi-combatant encounter (crypt: several PCs and enemies): kill ONE
    // enemy so the fight stays ongoing, then cycle two full rounds and assert
    // the dead combatant is never selected as the active actor.
    const state = buildEncounter("crypt", 42);
    const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy");
    expect(enemies.length).toBeGreaterThan(1);
    const wounded: GameState = JSON.parse(JSON.stringify(state));
    const dead = enemies[0];
    wounded.combatants[dead.id].alive = false;
    wounded.combatants[dead.id].hp = 0;
    expect(checkEncounterStatus(wounded)).toBe("ongoing");

    let cur: GameState = wounded;
    for (let i = 0; i < wounded.turnOrder.length * 2; i++) {
      cur = endTurn(cur);
      const activeId = cur.turnOrder[cur.turnIndex];
      expect(activeId).not.toBe(dead.id);
      expect(cur.combatants[activeId].alive).toBe(true);
    }
  });

  it("runEnemyAI is a no-op for a dead actor or when no living PCs remain", () => {
    const state = freshQuickBattle();
    const enemy = Object.values(state.combatants).find((c) => c.type === "enemy")!;
    const deadEnemyState = withAllDead(state, "enemy");
    const r1 = runEnemyAI(deadEnemyState, enemy.id, maxRng);
    expect(r1.state).toBe(deadEnemyState);
    expect(r1.events).toEqual([]);

    const partyDown = withAllDead(state, "pc");
    const r2 = runEnemyAI(partyDown, enemy.id, maxRng);
    expect(r2.state).toBe(partyDown);
  });
});

describe("combat termination on party defeat (analogous condition)", () => {
  it("party defeat terminates the turn cycle exactly like victory", () => {
    const defeat = withAllDead(freshQuickBattle(), "pc");
    expect(checkEncounterStatus(defeat)).toBe("defeat");
    const after = endTurn(defeat);
    expect(after).toBe(defeat);
    expect(resolveLeadingEnemyTurns(defeat, maxRng)).toBe(defeat);
  });
});
