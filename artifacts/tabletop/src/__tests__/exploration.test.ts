// ---------------------------------------------------------------------------
// EXPLORATION SESSION TESTS — Phase 3 Milestone M1.
//
// Covers the M1 required unit-test surface:
//   • Session initialization (party registered at spawn, world deterministic).
//   • Movement updates authoritative world position.
//   • Viewport follows the party per the existing dead-zone contract.
//   • World position ≠ viewport position (authority boundary).
//   • Visible-region correctness while chunks stream in.
//   • Entity identity stability across movement.
//   • Encounter-trigger contract (detection only — M5 starts combat).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  createExplorationSession, explorationTileInfo, movePartyStep,
  detectAdjacentHostiles, adjacentStepTargets, getParty, respawnPartyAtSpawn,
  EXPLORE_WORLD_W, EXPLORE_WORLD_H, EXPLORE_WORLD_SEED,
  EXPLORE_SPAWN, HOSTILE_SPAWN, PARTY_WORLD_ID, HOSTILE_WORLD_ID,
  type ExplorationSession,
} from "@/engine/exploration";
import { buildEncounterFromEntities } from "@/engine/world";
import { CHUNK_W, CHUNK_H } from "@/engine/chunk";
import { getVisibleTiles, initViewport, updateViewportForActor } from "@/engine/viewport";

/** Loads every chunk covering the M1 exploration region (4×4 chunks). */
async function loadAllChunks(session: ExplorationSession): Promise<void> {
  const loads: Promise<unknown>[] = [];
  for (let cy = 0; cy < EXPLORE_WORLD_H / CHUNK_H; cy++) {
    for (let cx = 0; cx < EXPLORE_WORLD_W / CHUNK_W; cx++) {
      loads.push(session.worldState.chunkStore.ensureResident(cx, cy, session.worldState.seed));
    }
  }
  await Promise.all(loads);
}

describe("exploration session — initialization", () => {
  it("registers the party at the spawn position with stable identity", () => {
    const session = createExplorationSession();
    const party = getParty(session);
    expect(party.worldId).toBe(PARTY_WORLD_ID);
    expect(party.wx).toBe(EXPLORE_SPAWN.wx);
    expect(party.wy).toBe(EXPLORE_SPAWN.wy);
    expect(party.alive).toBe(true);
  });

  it("registers the demo hostile for the M1 encounter-trigger contract", () => {
    const session = createExplorationSession();
    const hostile = session.worldState.entities.get(HOSTILE_WORLD_ID);
    expect(hostile).toBeDefined();
    expect(hostile!.wx).toBe(HOSTILE_SPAWN.wx);
    expect(hostile!.wy).toBe(HOSTILE_SPAWN.wy);
  });

  it("uses the fixed world seed — terrain is deterministic across sessions", async () => {
    const a = createExplorationSession();
    const b = createExplorationSession();
    expect(a.worldState.seed).toBe(EXPLORE_WORLD_SEED);
    await loadAllChunks(a);
    await loadAllChunks(b);
    for (let wy = 0; wy < 32; wy++) {
      for (let wx = 0; wx < 32; wx++) {
        expect(explorationTileInfo(a, wx, wy).type).toBe(explorationTileInfo(b, wx, wy).type);
      }
    }
  });

  it("spawn tile and the eastward walk path are floor (E2E precondition)", async () => {
    const session = createExplorationSession();
    await loadAllChunks(session);
    // The E2E suite walks east from (8,8) — these tiles must stay floor for
    // EXPLORE_WORLD_SEED. If this fails, the seed or generator changed.
    for (let wx = EXPLORE_SPAWN.wx; wx <= 13; wx++) {
      expect(explorationTileInfo(session, wx, EXPLORE_SPAWN.wy).type).toBe("floor");
    }
  });
});

describe("exploration session — tile resolution while streaming", () => {
  it("treats unloaded chunks as void (unmapped = impassable)", () => {
    const session = createExplorationSession();
    expect(explorationTileInfo(session, EXPLORE_SPAWN.wx, EXPLORE_SPAWN.wy).type).toBe("void");
  });

  it("resolves floor/pillar after the chunk becomes resident", async () => {
    const session = createExplorationSession();
    await session.worldState.chunkStore.ensureResident(0, 0, session.worldState.seed);
    const tile = explorationTileInfo(session, EXPLORE_SPAWN.wx, EXPLORE_SPAWN.wy);
    expect(tile.type).toBe("floor");
    expect(tile.passable).toBe(true);
  });

  it("treats tiles outside the M1 exploration region as void", async () => {
    const session = createExplorationSession();
    await loadAllChunks(session);
    expect(explorationTileInfo(session, -1, 5).type).toBe("void");
    expect(explorationTileInfo(session, 5, -1).type).toBe("void");
    expect(explorationTileInfo(session, EXPLORE_WORLD_W, 5).type).toBe("void");
    expect(explorationTileInfo(session, 5, EXPLORE_WORLD_H).type).toBe("void");
  });
});

describe("exploration session — movement", () => {
  let session: ExplorationSession;

  beforeEach(async () => {
    session = createExplorationSession();
    await loadAllChunks(session);
  });

  it("a valid adjacent step updates the authoritative world position", () => {
    const res = movePartyStep(session, EXPLORE_SPAWN.wx + 1, EXPLORE_SPAWN.wy);
    expect(res.ok).toBe(true);
    const party = getParty(session);
    expect(party.wx).toBe(EXPLORE_SPAWN.wx + 1);
    expect(party.wy).toBe(EXPLORE_SPAWN.wy);
  });

  it("entity identity is stable across many moves", () => {
    const before = getParty(session);
    // `before` is the live registry object — its wx mutates with each step.
    for (let i = 0; i < 5; i++) {
      expect(movePartyStep(session, before.wx + 1, EXPLORE_SPAWN.wy).ok).toBe(true);
    }
    const after = getParty(session);
    expect(after.worldId).toBe(PARTY_WORLD_ID);
    expect(after).toBe(before); // same registry object, mutated in place
    expect(after.wx).toBe(EXPLORE_SPAWN.wx + 5);
  });

  it("rejects a step of more than one tile", () => {
    const res = movePartyStep(session, EXPLORE_SPAWN.wx + 2, EXPLORE_SPAWN.wy);
    expect(res.ok).toBe(false);
    expect(getParty(session).wx).toBe(EXPLORE_SPAWN.wx);
  });

  it("rejects stepping onto the party's own tile", () => {
    expect(movePartyStep(session, EXPLORE_SPAWN.wx, EXPLORE_SPAWN.wy).ok).toBe(false);
  });

  it("rejects stepping into an unmapped (unloaded) chunk", () => {
    const fresh = createExplorationSession(); // no chunks resident
    const res = movePartyStep(fresh, EXPLORE_SPAWN.wx + 1, EXPLORE_SPAWN.wy);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/mapped/i);
  });

  it("rejects stepping onto a tile occupied by a living entity", () => {
    // Teleport the party next to the hostile via the registry (authoritative op).
    session.worldState.entities.move(PARTY_WORLD_ID, HOSTILE_SPAWN.wx - 1, HOSTILE_SPAWN.wy);
    const res = movePartyStep(session, HOSTILE_SPAWN.wx, HOSTILE_SPAWN.wy);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/standing/i);
  });

  it("rejects stepping outside the exploration region", () => {
    session.worldState.entities.move(PARTY_WORLD_ID, 0, 0);
    expect(movePartyStep(session, -1, 0).ok).toBe(false);
    expect(getParty(session).wx).toBe(0);
  });

  it("adjacentStepTargets returns only passable, unoccupied neighbors", () => {
    session.worldState.entities.move(PARTY_WORLD_ID, HOSTILE_SPAWN.wx - 1, HOSTILE_SPAWN.wy);
    const targets = adjacentStepTargets(session);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some(t => t.wx === HOSTILE_SPAWN.wx && t.wy === HOSTILE_SPAWN.wy)).toBe(false);
    for (const t of targets) {
      expect(explorationTileInfo(session, t.wx, t.wy).passable).toBe(true);
    }
  });
});

describe("exploration session — viewport follow (world ≠ viewport)", () => {
  it("viewport follows the party via the dead-zone contract; world position is unchanged by it", async () => {
    const session = createExplorationSession();
    await loadAllChunks(session);
    const party = getParty(session);
    let vp = initViewport(
      { width: EXPLORE_WORLD_W, height: EXPLORE_WORLD_H } as never,
      12, 10,
    );
    vp = updateViewportForActor(vp, party.wx, party.wy, EXPLORE_WORLD_W, EXPLORE_WORLD_H);
    // Party at (8,8): wy=8 exceeds the dead zone of a (0,0) 12×10 viewport →
    // the viewport recenters. World position is untouched.
    expect(vp.originWy).toBeGreaterThan(0);
    expect(party.wx).toBe(EXPLORE_SPAWN.wx);
    expect(party.wy).toBe(EXPLORE_SPAWN.wy);
    // Walk east until the viewport must shift horizontally.
    let originChanged = false;
    for (let step = 0; step < 10; step++) {
      const res = movePartyStep(session, party.wx + 1, party.wy);
      if (!res.ok) session.worldState.entities.move(PARTY_WORLD_ID, party.wx + 1, party.wy);
      const next = updateViewportForActor(vp, party.wx, party.wy, EXPLORE_WORLD_W, EXPLORE_WORLD_H);
      if (next.originWx !== vp.originWx) originChanged = true;
      vp = next;
      // Authority boundary: the viewport never writes back to the entity.
      expect(getParty(session).wx).toBe(party.wx);
    }
    expect(originChanged).toBe(true);
    // Viewport dimensions stay fixed regardless of movement.
    expect(vp.tileW).toBe(12);
    expect(vp.tileH).toBe(10);
  });

  it("visible region reports correct world coordinates for the live tile query", async () => {
    const session = createExplorationSession();
    await loadAllChunks(session);
    const vp = { originWx: 5, originWy: 7, tileW: 12, tileH: 10 };
    const tiles = getVisibleTiles(vp, (wx, wy) => explorationTileInfo(session, wx, wy));
    expect(tiles.length).toBe(10);
    expect(tiles[0].length).toBe(12);
    expect(tiles[0][0].wx).toBe(5);
    expect(tiles[0][0].wy).toBe(7);
    expect(tiles[9][11].wx).toBe(16);
    expect(tiles[9][11].wy).toBe(16);
    // Every visible tile matches a direct query at its world coordinate.
    for (const row of tiles) {
      for (const t of row) {
        expect(t.tileInfo.type).toBe(explorationTileInfo(session, t.wx, t.wy).type);
      }
    }
  });
});

describe("exploration session — encounter-trigger contract (M5 hook)", () => {
  it("detects no hostiles at spawn", () => {
    const session = createExplorationSession();
    expect(detectAdjacentHostiles(session)).toHaveLength(0);
  });

  it("detects the hostile when the party is adjacent", async () => {
    const session = createExplorationSession();
    await loadAllChunks(session);
    session.worldState.entities.move(PARTY_WORLD_ID, HOSTILE_SPAWN.wx - 1, HOSTILE_SPAWN.wy);
    const hostiles = detectAdjacentHostiles(session);
    expect(hostiles).toHaveLength(1);
    expect(hostiles[0].worldId).toBe(HOSTILE_WORLD_ID);
  });

  it("does not detect dead hostiles", async () => {
    const session = createExplorationSession();
    await loadAllChunks(session);
    session.worldState.entities.setAlive(HOSTILE_WORLD_ID, false);
    session.worldState.entities.move(PARTY_WORLD_ID, HOSTILE_SPAWN.wx - 1, HOSTILE_SPAWN.wy);
    expect(detectAdjacentHostiles(session)).toHaveLength(0);
  });
});

describe("exploration ↔ encounter loop (M5)", () => {
  it("explore → fight → endEncounter commits: dead hostile stays dead, survivor keeps position/HP", async () => {
    const session = createExplorationSession();
    session.worldState.entities.move(PARTY_WORLD_ID, HOSTILE_SPAWN.wx - 1, HOSTILE_SPAWN.wy);
    const party = getParty(session);
    const hostiles = detectAdjacentHostiles(session);
    expect(hostiles).toHaveLength(1);

    const prepared = await session.worldState.beginEncounter([party, ...hostiles]);
    const state = buildEncounterFromEntities(prepared, session.worldState.worldId, 42);

    // Simulate combat: the hostile dies; the party survives injured, one tile over.
    state.combatants[HOSTILE_WORLD_ID].alive = false;
    state.combatants[HOSTILE_WORLD_ID].hp = 0;
    state.combatants[PARTY_WORLD_ID].hp = 12;
    state.combatants[PARTY_WORLD_ID].wx = HOSTILE_SPAWN.wx - 2;

    session.worldState.endEncounter(state, prepared.pinnedChunks);

    const orc = session.worldState.entities.get(HOSTILE_WORLD_ID)!;
    expect(orc.alive).toBe(false);
    expect(orc.hp).toBe(0);
    const survivor = getParty(session);
    expect(survivor.alive).toBe(true);
    expect(survivor.hp).toBe(12);
    expect(survivor.wx).toBe(HOSTILE_SPAWN.wx - 2);
    expect(survivor.wy).toBe(HOSTILE_SPAWN.wy);
    // Dead hostile no longer triggers encounters.
    expect(detectAdjacentHostiles(session)).toHaveLength(0);
  });

  it("respawnPartyAtSpawn revives a defeated party at spawn with full HP, leaving the world untouched", async () => {
    const session = createExplorationSession();
    session.worldState.entities.move(PARTY_WORLD_ID, HOSTILE_SPAWN.wx - 1, HOSTILE_SPAWN.wy);
    const party = getParty(session);
    const prepared = await session.worldState.beginEncounter([party, ...detectAdjacentHostiles(session)]);
    const state = buildEncounterFromEntities(prepared, session.worldState.worldId, 42);

    // Simulate defeat: the party falls; the hostile survives injured.
    state.combatants[PARTY_WORLD_ID].alive = false;
    state.combatants[PARTY_WORLD_ID].hp = 0;
    state.combatants[HOSTILE_WORLD_ID].hp = 5;
    session.worldState.endEncounter(state, prepared.pinnedChunks);
    expect(getParty(session).alive).toBe(false);

    respawnPartyAtSpawn(session);
    const revived = getParty(session);
    expect(revived.alive).toBe(true);
    expect(revived.hp).toBe(revived.maxHp);
    expect(revived.wx).toBe(EXPLORE_SPAWN.wx);
    expect(revived.wy).toBe(EXPLORE_SPAWN.wy);
    // The world consequences of the lost battle persist.
    expect(session.worldState.entities.get(HOSTILE_WORLD_ID)!.hp).toBe(5);
    expect(session.worldState.entities.get(HOSTILE_WORLD_ID)!.alive).toBe(true);
  });
});
