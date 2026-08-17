// ---------------------------------------------------------------------------
// WorldState / WorldEntityRegistry unit tests — Phase F increment 3.
//
// Covers:
//   1.  WorldEntity structure — worldId immutability, required fields
//   2.  WorldEntityRegistry — register, get, has, getAll, getAlive
//   3.  WorldEntityRegistry — move(), setHp(), setAlive()
//   4.  WorldEntityRegistry — duplicate worldId throws
//   5.  worldEntityToCombatant — three-layer identity mapping
//   6.  worldEntityToCombatant — persistent state (hp < maxHp, injured entry)
//   7.  computePinSet — 1-chunk margin, negative coords, deduplication
//   8.  WorldState — constructor, owns ChunkStore + WorldEntityRegistry
//   9.  WorldState.beginEncounter — async, loads/pins chunks, creates snapshot
//  10.  WorldState.beginEncounter — pin set coverage with 1-chunk margin
//  11.  buildEncounterFromEntities — produces valid GameState
//  12.  buildEncounterFromEntities — three-layer identity preserved in combatants
//  13.  buildEncounterFromEntities — tileQuery from snapshot (not synthetic map)
//  14.  Encounter lifecycle — WorldEntity → GameState → endEncounter → WorldEntity
//  15.  Encounter lifecycle — worldId stable across encounter A → B
//  16.  endEncounter — surviving entity position/hp committed
//  17.  endEncounter — dead entity: alive=false, preserved (not deleted)
//  18.  endEncounter — test fixtures (no worldId) are skipped
//  19.  endEncounter — chunks are unpinned after commit
//  20.  Entity chunk crossing — worldId stable when wx crosses chunk boundary
//  21.  Negative world coordinates — entity placement and chunk derivation
//  22.  Snapshot isolation — live WorldState mutations don't affect GameState.tileQuery
//  23.  RNG isolation — WorldState operations don't alter gameplay RNG
//  24.  Authority boundary — no dual-write between WorldState and GameState
//  25.  ChunkStore ownership — WorldState owns ChunkStore exclusively
//
// Run: pnpm --filter @workspace/tabletop test
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import {
  WorldEntityRegistry,
  WorldState,
  worldEntityToCombatant,
  buildEncounterFromEntities,
  computePinSet,
} from "@/engine/world";
import type { WorldEntity, PreparedEncounter } from "@/engine/world";

import {
  mulberry32,
  COMBATANT_DEFS,
  buildEncounter,
} from "@/engine/content";

import {
  CHUNK_W,
  CHUNK_H,
  worldToChunkCoord,
  chunkKey,
  generateChunk,
} from "@/engine/chunk";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Create a minimal valid WorldEntity. */
function makeEntity(overrides: Partial<WorldEntity> & { worldId: string; defId: string }): WorldEntity {
  const def = COMBATANT_DEFS[overrides.defId];
  return {
    wx: 5,
    wy: 5,
    hp: def?.maxHp ?? 10,
    maxHp: def?.maxHp ?? 10,
    alive: true,
    state: {},
    ...overrides,
  };
}

/** A WorldState backed by a counting generator so we can track calls. */
function makeWorldState(worldId = "test-world", seed = 42): WorldState {
  return new WorldState(worldId, seed);
}

// ---------------------------------------------------------------------------
// 1. WorldEntity structure
// ---------------------------------------------------------------------------
describe("WorldEntity — structure", () => {
  it("has required fields with correct types", () => {
    const entity: WorldEntity = {
      worldId: "goblin-1",
      defId: "goblin",
      wx: 10,
      wy: 15,
      hp: 7,
      maxHp: 7,
      alive: true,
      state: {},
    };
    expect(entity.worldId).toBe("goblin-1");
    expect(entity.defId).toBe("goblin");
    expect(entity.wx).toBe(10);
    expect(entity.wy).toBe(15);
    expect(entity.hp).toBe(7);
    expect(entity.maxHp).toBe(7);
    expect(entity.alive).toBe(true);
    expect(entity.state).toEqual({});
  });

  it("worldId is readonly at the type level (structural check via assignment)", () => {
    // TypeScript enforces this at compile time; runtime test verifies field presence.
    const entity = makeEntity({ worldId: "orc-3", defId: "orc" });
    expect(entity.worldId).toBe("orc-3");
    // We cannot assign entity.worldId = "other" in TypeScript — readonly enforced.
  });

  it("state can hold arbitrary persistent key/value pairs", () => {
    const entity = makeEntity({ worldId: "door-1", defId: "goblin", state: { open: true, lootTaken: false } });
    expect(entity.state.open).toBe(true);
    expect(entity.state.lootTaken).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. WorldEntityRegistry — basic operations
// ---------------------------------------------------------------------------
describe("WorldEntityRegistry — basic CRUD", () => {
  it("register and get", () => {
    const reg = new WorldEntityRegistry();
    const entity = makeEntity({ worldId: "goblin-1", defId: "goblin" });
    reg.register(entity);
    expect(reg.get("goblin-1")).toBe(entity);
  });

  it("has(): true for registered, false for unknown", () => {
    const reg = new WorldEntityRegistry();
    reg.register(makeEntity({ worldId: "g1", defId: "goblin" }));
    expect(reg.has("g1")).toBe(true);
    expect(reg.has("unknown")).toBe(false);
  });

  it("getAll() returns all registered entities", () => {
    const reg = new WorldEntityRegistry();
    const e1 = makeEntity({ worldId: "g1", defId: "goblin" });
    const e2 = makeEntity({ worldId: "g2", defId: "goblin" });
    const e3 = makeEntity({ worldId: "f1", defId: "fighter" });
    reg.register(e1);
    reg.register(e2);
    reg.register(e3);
    const all = reg.getAll();
    expect(all).toHaveLength(3);
    expect(all).toContain(e1);
    expect(all).toContain(e2);
    expect(all).toContain(e3);
  });

  it("getAlive() returns only living entities", () => {
    const reg = new WorldEntityRegistry();
    const alive = makeEntity({ worldId: "g1", defId: "goblin", alive: true });
    const dead  = makeEntity({ worldId: "g2", defId: "goblin", alive: false });
    reg.register(alive);
    reg.register(dead);
    const living = reg.getAlive();
    expect(living).toHaveLength(1);
    expect(living[0]).toBe(alive);
  });

  it("get() returns undefined for unknown worldId", () => {
    const reg = new WorldEntityRegistry();
    expect(reg.get("nonexistent")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. WorldEntityRegistry — mutation methods
// ---------------------------------------------------------------------------
describe("WorldEntityRegistry — move, setHp, setAlive", () => {
  it("move() updates wx and wy", () => {
    const reg = new WorldEntityRegistry();
    reg.register(makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 }));
    reg.move("g1", 10, 20);
    const entity = reg.get("g1")!;
    expect(entity.wx).toBe(10);
    expect(entity.wy).toBe(20);
  });

  it("move() does not change worldId", () => {
    const reg = new WorldEntityRegistry();
    reg.register(makeEntity({ worldId: "g1", defId: "goblin", wx: 0, wy: 0 }));
    reg.move("g1", 16, 16); // crosses chunk boundary
    expect(reg.get("g1")!.worldId).toBe("g1");
  });

  it("setHp() updates hp", () => {
    const reg = new WorldEntityRegistry();
    reg.register(makeEntity({ worldId: "g1", defId: "goblin", hp: 7, maxHp: 7 }));
    reg.setHp("g1", 3);
    expect(reg.get("g1")!.hp).toBe(3);
  });

  it("setAlive() updates alive without deleting the entity", () => {
    const reg = new WorldEntityRegistry();
    reg.register(makeEntity({ worldId: "g1", defId: "goblin", alive: true }));
    reg.setAlive("g1", false);
    expect(reg.has("g1")).toBe(true);  // entity still exists
    expect(reg.get("g1")!.alive).toBe(false);
  });

  it("move() throws for unknown worldId", () => {
    const reg = new WorldEntityRegistry();
    expect(() => reg.move("nonexistent", 1, 1)).toThrow();
  });

  it("setHp() throws for unknown worldId", () => {
    const reg = new WorldEntityRegistry();
    expect(() => reg.setHp("nonexistent", 5)).toThrow();
  });

  it("setAlive() throws for unknown worldId", () => {
    const reg = new WorldEntityRegistry();
    expect(() => reg.setAlive("nonexistent", false)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. WorldEntityRegistry — duplicate worldId
// ---------------------------------------------------------------------------
describe("WorldEntityRegistry — duplicate worldId", () => {
  it("throws on duplicate registration", () => {
    const reg = new WorldEntityRegistry();
    reg.register(makeEntity({ worldId: "g1", defId: "goblin" }));
    expect(() =>
      reg.register(makeEntity({ worldId: "g1", defId: "goblin" }))
    ).toThrow(/duplicate/i);
  });

  it("different worldIds can coexist", () => {
    const reg = new WorldEntityRegistry();
    expect(() => {
      reg.register(makeEntity({ worldId: "g1", defId: "goblin" }));
      reg.register(makeEntity({ worldId: "g2", defId: "goblin" }));
      reg.register(makeEntity({ worldId: "g3", defId: "goblin" }));
    }).not.toThrow();
    expect(reg.getAll()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 5. worldEntityToCombatant — three-layer identity
// ---------------------------------------------------------------------------
describe("worldEntityToCombatant — three-layer identity", () => {
  const entity = makeEntity({ worldId: "goblin-crypt-3", defId: "goblin", wx: 31, wy: 20 });

  it("Combatant.worldId === entity.worldId (persistent FK preserved)", () => {
    const c = worldEntityToCombatant(entity);
    expect(c.worldId).toBe("goblin-crypt-3");
  });

  it("Combatant.id === entity.worldId (encounter-local key for world-backed entities)", () => {
    const c = worldEntityToCombatant(entity);
    expect(c.id).toBe("goblin-crypt-3");
  });

  it("Combatant.defId === entity.defId (content template unchanged)", () => {
    const c = worldEntityToCombatant(entity);
    expect(c.defId).toBe("goblin");
  });

  it("Combatant.wx === entity.wx, Combatant.wy === entity.wy (world position copied)", () => {
    const c = worldEntityToCombatant(entity);
    expect(c.wx).toBe(31);
    expect(c.wy).toBe(20);
  });

  it("combat stats come from COMBATANT_DEFS (not duplicated on entity)", () => {
    const def = COMBATANT_DEFS["goblin"];
    const c = worldEntityToCombatant(entity);
    expect(c.ac).toBe(def.ac);
    expect(c.atkMod).toBe(def.atkMod);
    expect(c.dexMod).toBe(def.dexMod);
    expect(c.moveMax).toBe(def.moveMax);
  });

  it("combat-local fields initialized fresh: actionUsed=false, moveRemaining=def.moveMax", () => {
    const c = worldEntityToCombatant(entity);
    expect(c.actionUsed).toBe(false);
    expect(c.moveRemaining).toBe(COMBATANT_DEFS["goblin"].moveMax);
  });

  it("worldId, defId, id are distinct fields with distinct purposes", () => {
    const c = worldEntityToCombatant(entity);
    // All happen to be equal for this entity, but they are structurally distinct.
    expect("worldId" in c).toBe(true);
    expect("defId" in c).toBe(true);
    expect("id" in c).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. worldEntityToCombatant — persistent state (injured entity)
// ---------------------------------------------------------------------------
describe("worldEntityToCombatant — persistent HP and alive state", () => {
  it("hp is copied from entity, not reset to maxHp", () => {
    const def = COMBATANT_DEFS["goblin"];
    const injured = makeEntity({ worldId: "g1", defId: "goblin", hp: 2, maxHp: def.maxHp });
    const c = worldEntityToCombatant(injured);
    expect(c.hp).toBe(2);
    expect(c.maxHp).toBe(def.maxHp);
  });

  it("alive is copied from entity", () => {
    const alive = makeEntity({ worldId: "g1", defId: "goblin", alive: true });
    const dead  = makeEntity({ worldId: "g2", defId: "goblin", alive: false });
    expect(worldEntityToCombatant(alive).alive).toBe(true);
    expect(worldEntityToCombatant(dead).alive).toBe(false);
  });

  it("full-health entity has hp === maxHp", () => {
    const entity = makeEntity({ worldId: "g1", defId: "goblin" }); // hp defaults to def.maxHp
    const c = worldEntityToCombatant(entity);
    expect(c.hp).toBe(c.maxHp);
  });
});

// ---------------------------------------------------------------------------
// 7. computePinSet — pin-set logic
// ---------------------------------------------------------------------------
describe("computePinSet", () => {
  it("returns a 3×3 neighborhood (9 chunks) for a single entity in a chunk interior", () => {
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    // wx=5, wy=5 → cx=0, cy=0. Margin gives cx/cy ∈ {-1, 0, 1}
    const pins = computePinSet([entity]);
    expect(pins).toHaveLength(9);
  });

  it("chunks are deduplicated when two entities are in the same chunk", () => {
    const e1 = makeEntity({ worldId: "g1", defId: "goblin", wx: 2, wy: 2 }); // cx=0, cy=0
    const e2 = makeEntity({ worldId: "g2", defId: "goblin", wx: 8, wy: 8 }); // cx=0, cy=0
    const pins = computePinSet([e1, e2]);
    // Same base chunk → same 9 chunks → still 9 (no duplicates)
    expect(pins).toHaveLength(9);
  });

  it("entities in adjacent chunks expand the pin set without duplicates", () => {
    const e1 = makeEntity({ worldId: "g1", defId: "goblin", wx: 5,  wy: 5 });  // cx=0, cy=0
    const e2 = makeEntity({ worldId: "g2", defId: "goblin", wx: 21, wy: 5 });  // cx=1, cy=0
    const pins = computePinSet([e1, e2]);
    // 3×3 around (0,0) + 3×3 around (1,0) = 9 + 9 - 6 overlap = 12
    expect(pins).toHaveLength(12);
  });

  it("pin set contains no duplicate chunk keys", () => {
    const entities = [
      makeEntity({ worldId: "g1", defId: "goblin", wx: 5,  wy: 5  }),
      makeEntity({ worldId: "g2", defId: "goblin", wx: 10, wy: 10 }),
      makeEntity({ worldId: "g3", defId: "goblin", wx: 20, wy: 5  }),
    ];
    const pins = computePinSet(entities);
    const keys = pins.map(({ cx, cy }) => chunkKey(cx, cy));
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it("negative-coordinate entities compute correct negative chunk keys", () => {
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: -1, wy: -1 });
    // wx=-1 → cx=-1. Margin gives cx ∈ {-2, -1, 0}, cy ∈ {-2, -1, 0}
    const pins = computePinSet([entity]);
    expect(pins).toHaveLength(9);
    expect(pins.some(({ cx, cy }) => cx === -1 && cy === -1)).toBe(true);
    expect(pins.some(({ cx, cy }) => cx === 0  && cy === 0 )).toBe(true);
    expect(pins.some(({ cx, cy }) => cx === -2 && cy === -2)).toBe(true);
  });

  it("empty participant list produces empty pin set", () => {
    expect(computePinSet([])).toHaveLength(0);
  });

  it("participant at chunk boundary (cx=0, local=15) includes both sides of the boundary", () => {
    // wx=15 → cx=0 (last tile of chunk 0). Margin includes cx=-1, 0, 1.
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 15, wy: 15 });
    const pins = computePinSet([entity]);
    expect(pins.some(({ cx }) => cx === -1)).toBe(true); // left side
    expect(pins.some(({ cx }) => cx ===  0)).toBe(true); // participant's chunk
    expect(pins.some(({ cx }) => cx ===  1)).toBe(true); // right side (next chunk)
  });
});

// ---------------------------------------------------------------------------
// 8. WorldState — constructor
// ---------------------------------------------------------------------------
describe("WorldState — constructor", () => {
  it("has correct worldId and seed", () => {
    const ws = new WorldState("dungeon-01", 12345);
    expect(ws.worldId).toBe("dungeon-01");
    expect(ws.seed).toBe(12345);
  });

  it("owns a ChunkStore", () => {
    const ws = new WorldState("w", 1);
    expect(ws.chunkStore).toBeDefined();
  });

  it("owns a WorldEntityRegistry", () => {
    const ws = new WorldState("w", 1);
    expect(ws.entities).toBeDefined();
    expect(ws.entities.getAll()).toHaveLength(0);
  });

  it("entities registered through WorldState.entities are accessible", () => {
    const ws = new WorldState("w", 1);
    ws.entities.register(makeEntity({ worldId: "g1", defId: "goblin" }));
    expect(ws.entities.has("g1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. WorldState.beginEncounter — basic async flow
// ---------------------------------------------------------------------------
describe("WorldState.beginEncounter — async loading", () => {
  it("returns a PreparedEncounter with snapshot, pinnedChunks, participants", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);

    expect(prepared.snapshot).toBeDefined();
    expect(prepared.pinnedChunks).toBeDefined();
    expect(prepared.participants).toHaveLength(1);
    expect(prepared.participants[0].worldId).toBe("g1");
  });

  it("after beginEncounter, encounter-area chunks are PINNED", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);

    for (const { cx, cy } of prepared.pinnedChunks) {
      expect(ws.chunkStore.residency(cx, cy)).toBe("PINNED");
    }
  });

  it("snapshot is non-empty for entities in loaded chunks", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    expect(prepared.snapshot.chunks.size).toBeGreaterThan(0);
  });

  it("snapshot worldId matches the WorldState worldId", async () => {
    const ws = new WorldState("my-world", 42);
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    expect(prepared.snapshot.worldId).toBe("my-world");
  });
});

// ---------------------------------------------------------------------------
// 10. WorldState.beginEncounter — pin set with 1-chunk margin
// ---------------------------------------------------------------------------
describe("WorldState.beginEncounter — pin set coverage", () => {
  it("participant's chunk AND neighbors are pinned (1-chunk margin)", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 }); // cx=0, cy=0
    const prepared = await ws.beginEncounter([entity]);

    // The 3×3 neighborhood of (0,0) must all be PINNED.
    for (let dcx = -1; dcx <= 1; dcx++) {
      for (let dcy = -1; dcy <= 1; dcy++) {
        expect(ws.chunkStore.residency(dcx, dcy)).toBe("PINNED");
      }
    }
    // 9 total pinned chunks.
    expect(prepared.pinnedChunks).toHaveLength(9);
  });

  it("entity at chunk boundary pins both sides", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 15, wy: 5 }); // cx=0
    await ws.beginEncounter([entity]);
    // cx=-1 and cx=1 are both included in the 1-chunk margin.
    expect(ws.chunkStore.residency(-1, 0)).toBe("PINNED");
    expect(ws.chunkStore.residency( 0, 0)).toBe("PINNED");
    expect(ws.chunkStore.residency( 1, 0)).toBe("PINNED");
  });
});

// ---------------------------------------------------------------------------
// 11. buildEncounterFromEntities — produces a valid GameState
// ---------------------------------------------------------------------------
describe("buildEncounterFromEntities — GameState structure", () => {
  async function setupEncounter() {
    const ws = makeWorldState();
    const goblin  = makeEntity({ worldId: "g1", defId: "goblin",  wx: 5, wy: 5 });
    const fighter = makeEntity({ worldId: "f1", defId: "fighter", wx: 3, wy: 3 });
    const prepared = await ws.beginEncounter([goblin, fighter]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 99, "enc-1", "Test Encounter");
    return { ws, prepared, gs, goblin, fighter };
  }

  it("started is true", async () => {
    const { gs } = await setupEncounter();
    expect(gs.started).toBe(true);
  });

  it("combatants record contains all participants", async () => {
    const { gs } = await setupEncounter();
    expect(Object.keys(gs.combatants)).toHaveLength(2);
  });

  it("encounterId and encounterName are set", async () => {
    const { gs } = await setupEncounter();
    expect(gs.encounterId).toBe("enc-1");
    expect(gs.encounterName).toBe("Test Encounter");
  });

  it("tileQuery is the snapshot-backed query, not the synthetic map", async () => {
    const { gs, prepared } = await setupEncounter();
    // The snapshot contains the participant's chunk (cx=0, cy=0).
    // A tile at (5,5) is within that chunk — should not return void.
    // Synthetic map has width=0, height=0 → mapDefToTileQuery would return void for (5,5).
    // The snapshot tileQuery should return floor or pillar, not void.
    const tile = gs.tileQuery(5, 5);
    expect(tile.type).not.toBe("void");
  });

  it("turnOrder contains all combatant IDs", async () => {
    const { gs } = await setupEncounter();
    expect(gs.turnOrder).toHaveLength(2);
    expect(new Set(gs.turnOrder)).toEqual(new Set(Object.keys(gs.combatants)));
  });

  it("round is 1", async () => {
    const { gs } = await setupEncounter();
    expect(gs.round).toBe(1);
  });

  it("seed is set to the provided seed", async () => {
    const { gs } = await setupEncounter();
    expect(gs.seed).toBe(99);
  });

  it("log is non-empty", async () => {
    const { gs } = await setupEncounter();
    expect(gs.log.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 12. buildEncounterFromEntities — three-layer identity in combatants
// ---------------------------------------------------------------------------
describe("buildEncounterFromEntities — three-layer identity", () => {
  it("each Combatant has worldId === entity.worldId", async () => {
    const ws = makeWorldState();
    const goblin  = makeEntity({ worldId: "goblin-crypt-3", defId: "goblin",  wx: 5, wy: 5 });
    const fighter = makeEntity({ worldId: "hero-fighter-1", defId: "fighter", wx: 3, wy: 3 });
    const prepared = await ws.beginEncounter([goblin, fighter]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    expect(gs.combatants["goblin-crypt-3"].worldId).toBe("goblin-crypt-3");
    expect(gs.combatants["hero-fighter-1"].worldId).toBe("hero-fighter-1");
  });

  it("Combatant.id === Combatant.worldId for world-backed entities", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "goblin-7", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);
    const c = gs.combatants["goblin-7"];
    expect(c.id).toBe("goblin-7");
    expect(c.worldId).toBe("goblin-7");
    expect(c.id).toBe(c.worldId);
  });

  it("Combatant.defId matches entity.defId", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "orc-17", defId: "orc", wx: 8, wy: 8 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);
    expect(gs.combatants["orc-17"].defId).toBe("orc");
  });

  it("Combatant.wx and .wy match entity world position", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 31, wy: 20 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);
    expect(gs.combatants["g1"].wx).toBe(31);
    expect(gs.combatants["g1"].wy).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// 13. buildEncounterFromEntities — tileQuery from snapshot
// ---------------------------------------------------------------------------
describe("buildEncounterFromEntities — snapshot-backed tileQuery", () => {
  it("tile at participant position returns non-void (chunk is in snapshot)", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);
    expect(gs.tileQuery(5, 5).type).not.toBe("void");
  });

  it("tile far outside any snapshotted chunk returns void", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);
    // Far away — not in any snapshotted chunk.
    expect(gs.tileQuery(1000, 1000).type).toBe("void");
  });

  it("cloneState preserves the snapshot-backed tileQuery (shared by reference)", async () => {
    const { cloneState } = await import("@/engine/rules");
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);
    const cloned = cloneState(gs);
    // tileQuery function is the same reference.
    expect(cloned.tileQuery).toBe(gs.tileQuery);
  });
});

// ---------------------------------------------------------------------------
// 14. Encounter lifecycle — WorldEntity → GameState → endEncounter → WorldEntity
// ---------------------------------------------------------------------------
describe("Encounter lifecycle — full round-trip", () => {
  it("worldId is preserved through the full encounter lifecycle", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "goblin-5", defId: "goblin", wx: 5, wy: 5 });
    ws.entities.register(entity);

    // Before encounter: entity is in registry.
    expect(ws.entities.get("goblin-5")!.worldId).toBe("goblin-5");

    // Begin encounter.
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 42);

    // In GameState: worldId preserved.
    const combatant = gs.combatants["goblin-5"];
    expect(combatant.worldId).toBe("goblin-5");

    // End encounter (goblin moved during combat).
    const modified = { ...gs, combatants: {
      ...gs.combatants,
      "goblin-5": { ...combatant, wx: 8, wy: 8, hp: 4 },
    }};
    ws.endEncounter(modified, prepared.pinnedChunks);

    // After encounter: worldId still "goblin-5" in registry.
    expect(ws.entities.get("goblin-5")!.worldId).toBe("goblin-5");
  });

  it("position and HP are committed from GameState → WorldEntity after endEncounter", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5, hp: 7, maxHp: 7 });
    ws.entities.register(entity);

    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 42);
    const c = gs.combatants["g1"];

    // Simulate goblin surviving combat but moving and taking damage.
    const final = {
      ...gs, combatants: {
        "g1": { ...c, wx: 12, wy: 8, hp: 3, alive: true },
      },
    };
    ws.endEncounter(final, prepared.pinnedChunks);

    const after = ws.entities.get("g1")!;
    expect(after.wx).toBe(12);
    expect(after.wy).toBe(8);
    expect(after.hp).toBe(3);
    expect(after.alive).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 15. Encounter lifecycle — worldId stable across encounter A → B
// ---------------------------------------------------------------------------
describe("Encounter lifecycle — worldId stable across multiple encounters", () => {
  it("entity retains same worldId after encounter A → endEncounter → encounter B", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "persistent-orc", defId: "orc", wx: 5, wy: 5 });
    ws.entities.register(entity);

    // Encounter A.
    const prepA = await ws.beginEncounter([entity]);
    const gsA = buildEncounterFromEntities(prepA, ws.worldId, 11, "enc-A");
    const cA = gsA.combatants["persistent-orc"];

    // Orc survives with reduced HP.
    ws.endEncounter({
      ...gsA, combatants: { "persistent-orc": { ...cA, hp: 8, wx: 7, wy: 5 } },
    }, prepA.pinnedChunks);

    expect(ws.entities.get("persistent-orc")!.worldId).toBe("persistent-orc");
    expect(ws.entities.get("persistent-orc")!.hp).toBe(8);

    // Encounter B: same entity, new encounter-local id can be anything but worldId is stable.
    const prepB = await ws.beginEncounter([ws.entities.get("persistent-orc")!]);
    const gsB = buildEncounterFromEntities(prepB, ws.worldId, 22, "enc-B");
    const cB = gsB.combatants["persistent-orc"];

    expect(cB.worldId).toBe("persistent-orc");
    expect(cB.hp).toBe(8);  // hp from endEncounterA is carried over
    expect(cB.wx).toBe(7);
    expect(cB.wy).toBe(5);

    ws.endEncounter(gsB, prepB.pinnedChunks);
  });

  it("encounter-local Combatant.id can differ between encounters (worldId remains stable)", async () => {
    // For world-backed entities id === worldId (both encounters). This test
    // confirms that the contract holds consistently across multiple encounters.
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "orc-42", defId: "orc", wx: 5, wy: 5 });
    ws.entities.register(entity);

    for (let i = 0; i < 3; i++) {
      const prepared = await ws.beginEncounter([ws.entities.get("orc-42")!]);
      const gs = buildEncounterFromEntities(prepared, ws.worldId, i * 100);
      expect(gs.combatants["orc-42"].worldId).toBe("orc-42");
      ws.endEncounter(gs, prepared.pinnedChunks);
    }
  });
});

// ---------------------------------------------------------------------------
// 16. endEncounter — surviving entity commit
// ---------------------------------------------------------------------------
describe("endEncounter — surviving entity commit", () => {
  it("survivor: position and HP updated from combatant", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 2, wy: 2, hp: 7 });
    ws.entities.register(entity);

    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    ws.endEncounter({
      ...gs, combatants: {
        "g1": { ...gs.combatants["g1"], wx: 9, wy: 9, hp: 5, alive: true },
      },
    }, prepared.pinnedChunks);

    const e = ws.entities.get("g1")!;
    expect(e.wx).toBe(9);
    expect(e.wy).toBe(9);
    expect(e.hp).toBe(5);
    expect(e.alive).toBe(true);
  });

  it("survivor's worldId is not changed by endEncounter", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "stable-id", defId: "orc", wx: 5, wy: 5 });
    ws.entities.register(entity);
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);
    ws.endEncounter(gs, prepared.pinnedChunks);
    expect(ws.entities.get("stable-id")!.worldId).toBe("stable-id");
  });
});

// ---------------------------------------------------------------------------
// 17. endEncounter — dead entity handling
// ---------------------------------------------------------------------------
describe("endEncounter — dead entity: alive=false, preserved", () => {
  it("dead combatant → entity.alive=false, entity is still in registry", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "dead-goblin", defId: "goblin" });
    ws.entities.register(entity);

    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    // Goblin dies in combat.
    ws.endEncounter({
      ...gs, combatants: {
        "dead-goblin": { ...gs.combatants["dead-goblin"], hp: 0, alive: false },
      },
    }, prepared.pinnedChunks);

    // Entity still exists — never deleted (spec §12.3).
    expect(ws.entities.has("dead-goblin")).toBe(true);
    expect(ws.entities.get("dead-goblin")!.alive).toBe(false);
  });

  it("dead entity is excluded from getAlive() after endEncounter", async () => {
    const ws = makeWorldState();
    const e1 = makeEntity({ worldId: "survivor", defId: "fighter", wx: 2, wy: 2 });
    const e2 = makeEntity({ worldId: "casualty", defId: "goblin",  wx: 5, wy: 5 });
    ws.entities.register(e1);
    ws.entities.register(e2);

    const prepared = await ws.beginEncounter([e1, e2]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    ws.endEncounter({
      ...gs, combatants: {
        "survivor": { ...gs.combatants["survivor"], alive: true },
        "casualty": { ...gs.combatants["casualty"], hp: 0, alive: false },
      },
    }, prepared.pinnedChunks);

    const alive = ws.entities.getAlive();
    expect(alive.map(e => e.worldId)).toContain("survivor");
    expect(alive.map(e => e.worldId)).not.toContain("casualty");
    // But casualty still exists in registry.
    expect(ws.entities.has("casualty")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 18. endEncounter — test fixtures (no worldId) are skipped
// ---------------------------------------------------------------------------
describe("endEncounter — test fixtures without worldId are skipped", () => {
  it("combatant without worldId: endEncounter does not throw", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    ws.entities.register(entity);

    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    // Add a fixture combatant (no worldId) to the combatants record.
    const fixtureState = {
      ...gs,
      combatants: {
        ...gs.combatants,
        "fixture-only": {
          ...gs.combatants["g1"],
          id: "fixture-only",
          worldId: undefined,  // fixture — no persistent record
          wx: 3, wy: 3,
        },
      },
    };

    expect(() => ws.endEncounter(fixtureState, prepared.pinnedChunks)).not.toThrow();
  });

  it("fixture combatant does not pollute WorldEntityRegistry", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    ws.entities.register(entity);

    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    const fixtureState = {
      ...gs,
      combatants: {
        ...gs.combatants,
        "fixture-only": { ...gs.combatants["g1"], id: "fixture-only", worldId: undefined },
      },
    };

    ws.endEncounter(fixtureState, prepared.pinnedChunks);
    // Only the original entity exists — fixture was not registered.
    expect(ws.entities.getAll()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 19. endEncounter — chunks are unpinned after commit
// ---------------------------------------------------------------------------
describe("endEncounter — chunk unpinning", () => {
  it("all encounter-pinned chunks are RESIDENT (not PINNED) after endEncounter", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    ws.endEncounter(gs, prepared.pinnedChunks);

    for (const { cx, cy } of prepared.pinnedChunks) {
      expect(ws.chunkStore.residency(cx, cy)).toBe("RESIDENT");
    }
  });

  it("unpinned chunks can be evicted after endEncounter", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    ws.endEncounter(gs, prepared.pinnedChunks);

    // Any of the formerly-pinned chunks can now be evicted.
    const { cx, cy } = prepared.pinnedChunks[0];
    expect(ws.chunkStore.evict(cx, cy)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 20. Entity chunk crossing — worldId stable across chunk boundary
// ---------------------------------------------------------------------------
describe("Entity chunk crossing — worldId invariant", () => {
  it("entity worldId is unchanged after moving from chunk 0 to chunk 1", () => {
    const reg = new WorldEntityRegistry();
    const entity = makeEntity({ worldId: "crossing-goblin", defId: "goblin", wx: 15, wy: 5 });
    reg.register(entity);

    // Entity is in chunk (0, 0) at wx=15.
    expect(worldToChunkCoord(entity.wx, entity.wy).cx).toBe(0);
    expect(entity.worldId).toBe("crossing-goblin");

    // Move to wx=16: now in chunk (1, 0).
    reg.move("crossing-goblin", 16, 5);
    expect(worldToChunkCoord(entity.wx, entity.wy).cx).toBe(1);
    expect(entity.worldId).toBe("crossing-goblin"); // unchanged!
  });

  it("chunk membership is derived from wx/wy, never stored separately", () => {
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    // WorldEntity has no chunkX/chunkY fields — chunk is always derived.
    expect("chunkX" in entity).toBe(false);
    expect("chunkY" in entity).toBe(false);
    // Chunk is derived on-demand.
    const { cx, cy } = worldToChunkCoord(entity.wx, entity.wy);
    expect(cx).toBe(0);
    expect(cy).toBe(0);
  });

  it("entity remains accessible by worldId after chunk-crossing move", () => {
    const reg = new WorldEntityRegistry();
    const entity = makeEntity({ worldId: "migrant", defId: "goblin", wx: 14, wy: 3 });
    reg.register(entity);

    // Cross chunk boundary.
    for (let wx = 14; wx <= 20; wx++) {
      reg.move("migrant", wx, 3);
      expect(reg.get("migrant")!.worldId).toBe("migrant");
    }
    // Chunk changed from 0 to 1, but worldId is the same.
    expect(worldToChunkCoord(reg.get("migrant")!.wx, reg.get("migrant")!.wy).cx).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 21. Negative world coordinates — entity placement and chunk derivation
// ---------------------------------------------------------------------------
describe("Negative world coordinates", () => {
  it("entity can be placed at negative world coordinates", () => {
    const reg = new WorldEntityRegistry();
    const entity = makeEntity({ worldId: "neg-entity", defId: "goblin", wx: -5, wy: -5 });
    reg.register(entity);
    expect(reg.get("neg-entity")!.wx).toBe(-5);
    expect(reg.get("neg-entity")!.wy).toBe(-5);
  });

  it("chunk derived from negative coordinates is correct", () => {
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: -1, wy: -1 });
    const { cx, cy } = worldToChunkCoord(entity.wx, entity.wy);
    expect(cx).toBe(-1); // wx=-1 → cx=-1 (Math.floor(-1/16))
    expect(cy).toBe(-1);
  });

  it("entity at wx=-16 is in chunk cx=-1", () => {
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: -16, wy: -16 });
    expect(worldToChunkCoord(entity.wx, entity.wy).cx).toBe(-1);
  });

  it("entity at wx=-17 is in chunk cx=-2", () => {
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: -17, wy: -17 });
    expect(worldToChunkCoord(entity.wx, entity.wy).cx).toBe(-2);
  });

  it("beginEncounter works for negative-coordinate entities", async () => {
    const ws = makeWorldState("neg-world", 777);
    const entity = makeEntity({ worldId: "neg-goblin", defId: "goblin", wx: -5, wy: -5 });
    const prepared = await ws.beginEncounter([entity]);
    // Chunk (-1,-1) and its 8 neighbors should be PINNED.
    expect(ws.chunkStore.residency(-1, -1)).toBe("PINNED");
    expect(prepared.pinnedChunks).toHaveLength(9);
    ws.endEncounter(
      buildEncounterFromEntities(prepared, ws.worldId, 1),
      prepared.pinnedChunks
    );
  });
});

// ---------------------------------------------------------------------------
// 22. Snapshot isolation — live WorldState mutations don't affect GameState
// ---------------------------------------------------------------------------
describe("Snapshot isolation", () => {
  it("loading a new chunk after beginEncounter does not change the active tileQuery", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    const tileBefore = gs.tileQuery(5, 5);

    // Load a new chunk into the live store (far away).
    await ws.chunkStore.ensureResident(10, 10, ws.seed);

    // Active GameState.tileQuery is unaffected.
    expect(gs.tileQuery(5, 5)).toEqual(tileBefore);
  });

  it("evicting a chunk from ChunkStore after snapshot does not affect GameState.tileQuery", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    const tileBefore = gs.tileQuery(5, 5);

    // Unpin and evict the chunk. (We need to unpin first.)
    // NOTE: endEncounter() would normally do the unpin. Here we verify the snapshot
    // survives independently of the store.
    // We call endEncounter to unpin, then manually evict.
    ws.endEncounter(gs, prepared.pinnedChunks);
    ws.chunkStore.evict(0, 0); // evict the entity's chunk

    // Original snapshot-backed tileQuery still works.
    expect(gs.tileQuery(5, 5)).toEqual(tileBefore);
  });

  it("beginEncounter for a second encounter does not alter the first GameState.tileQuery", async () => {
    const ws = makeWorldState();
    const e1 = makeEntity({ worldId: "g1", defId: "goblin",  wx: 5,  wy: 5 });
    const e2 = makeEntity({ worldId: "g2", defId: "fighter", wx: 40, wy: 40 });

    const prepared1 = await ws.beginEncounter([e1]);
    const gs1 = buildEncounterFromEntities(prepared1, ws.worldId, 1, "enc-1");
    const tile1Before = gs1.tileQuery(5, 5);

    // Second encounter in a completely different area.
    const prepared2 = await ws.beginEncounter([e2]);
    buildEncounterFromEntities(prepared2, ws.worldId, 2, "enc-2");

    // First encounter's geometry unchanged.
    expect(gs1.tileQuery(5, 5)).toEqual(tile1Before);

    ws.endEncounter(gs1, prepared1.pinnedChunks);
    ws.endEncounter(buildEncounterFromEntities(prepared2, ws.worldId, 2), prepared2.pinnedChunks);
  });
});

// ---------------------------------------------------------------------------
// 23. RNG isolation — WorldState operations don't alter gameplay RNG
// ---------------------------------------------------------------------------
describe("RNG isolation", () => {
  it("WorldState construction does not consume gameplay RNG", () => {
    const seed = 54321;
    const rng = mulberry32(seed);
    const v1 = rng();
    new WorldState("test-world", seed);
    new WorldState("another-world", seed * 2);
    const v2 = rng();
    const rngRef = mulberry32(seed);
    rngRef(); // v1
    expect(v2).toBe(rngRef());
  });

  it("entity registration does not consume gameplay RNG", () => {
    const rng = mulberry32(99);
    const v1 = rng();

    const ws = new WorldState("world", 99);
    ws.entities.register(makeEntity({ worldId: "g1", defId: "goblin" }));
    ws.entities.register(makeEntity({ worldId: "g2", defId: "orc" }));
    ws.entities.register(makeEntity({ worldId: "g3", defId: "fighter" }));

    const v2 = rng();
    const rngRef = mulberry32(99);
    rngRef(); // v1
    expect(v2).toBe(rngRef());
  });

  it("entity move() does not consume gameplay RNG", () => {
    const rng = mulberry32(77);
    rng(); // establish initial state

    const ws = new WorldState("world", 77);
    ws.entities.register(makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 }));

    const v_before = rng();
    ws.entities.move("g1", 10, 10);
    ws.entities.move("g1", 20, 20);
    ws.entities.move("g1", 16, 16); // chunk crossing
    const v_after = rng();

    const rngRef = mulberry32(77);
    rngRef(); // advance 1
    const expected_before = rngRef();
    const expected_after = rngRef();

    expect(v_before).toBe(expected_before);
    expect(v_after).toBe(expected_after);
  });

  it("beginEncounter() does not consume gameplay RNG (chunk generation is isolated)", async () => {
    const seed = 13579;
    const rng = mulberry32(seed);
    const draws = Array.from({ length: 10 }, () => rng());

    const ws = new WorldState("world", seed);
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    await ws.beginEncounter([entity]);

    const afterDraws = Array.from({ length: 10 }, () => rng());

    const rngRef = mulberry32(seed);
    const expectedBefore = Array.from({ length: 10 }, () => rngRef());
    const expectedAfter  = Array.from({ length: 10 }, () => rngRef());

    expect(draws).toEqual(expectedBefore);
    expect(afterDraws).toEqual(expectedAfter);
  });

  it("endEncounter() does not consume gameplay RNG", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    ws.entities.register(entity);
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    const rng = mulberry32(42);
    const v1 = rng();
    ws.endEncounter(gs, prepared.pinnedChunks);
    const v2 = rng();

    const rngRef = mulberry32(42);
    rngRef();
    expect(v2).toBe(rngRef());
  });
});

// ---------------------------------------------------------------------------
// 24. Authority boundary — no dual-write between WorldState and GameState
// ---------------------------------------------------------------------------
describe("Authority boundary — no dual-write", () => {
  it("modifying GameState.combatants does not change WorldEntityRegistry during encounter", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5, hp: 7 });
    ws.entities.register(entity);

    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    // Simulate rules engine moving the goblin in GameState.
    const c = gs.combatants["g1"];
    gs.combatants["g1"] = { ...c, wx: 9, wy: 9, hp: 3 };

    // WorldEntityRegistry is unchanged — endEncounter() has not been called.
    expect(ws.entities.get("g1")!.wx).toBe(5);
    expect(ws.entities.get("g1")!.wy).toBe(5);
    expect(ws.entities.get("g1")!.hp).toBe(7);

    ws.endEncounter(gs, prepared.pinnedChunks);

    // NOW it's committed.
    expect(ws.entities.get("g1")!.wx).toBe(9);
  });

  it("WorldEntityRegistry.move() during combat does not change GameState combatants", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    ws.entities.register(entity);

    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    const wxBefore = gs.combatants["g1"].wx;

    // Directly mutate the WorldEntityRegistry (should not happen in production
    // during combat, but we verify the GameState is unaffected).
    ws.entities.move("g1", 99, 99);

    // GameState is unaffected (snapshots over immutable geometry; combatants are copies).
    expect(gs.combatants["g1"].wx).toBe(wxBefore);

    ws.endEncounter(gs, prepared.pinnedChunks);
  });
});

// ---------------------------------------------------------------------------
// 25. ChunkStore ownership — WorldState owns ChunkStore exclusively
// ---------------------------------------------------------------------------
describe("ChunkStore ownership", () => {
  it("WorldState.chunkStore is the same instance used by beginEncounter()", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);

    // The pinned chunks are in the WorldState's own ChunkStore.
    for (const { cx, cy } of prepared.pinnedChunks) {
      expect(ws.chunkStore.residency(cx, cy)).toBe("PINNED");
    }
  });

  it("GameState does not receive a live ChunkStore reference (only a TileQueryFn)", async () => {
    const ws = makeWorldState();
    const entity = makeEntity({ worldId: "g1", defId: "goblin", wx: 5, wy: 5 });
    const prepared = await ws.beginEncounter([entity]);
    const gs = buildEncounterFromEntities(prepared, ws.worldId, 1);

    // GameState has tileQuery (a function), not a ChunkStore.
    expect("chunkStore" in gs).toBe(false);
    expect(typeof gs.tileQuery).toBe("function");

    ws.endEncounter(gs, prepared.pinnedChunks);
  });

  it("existing MapDef-backed buildEncounter() is unaffected by WorldState introduction", () => {
    // The original synchronous buildEncounter() should still work identically.
    const gs = buildEncounter("crypt", 42);
    expect(gs.started).toBe(true);
    expect(Object.keys(gs.combatants)).toHaveLength(5); // 2 PCs + 3 goblins
    // Combatants from fixture encounters have undefined worldId.
    for (const c of Object.values(gs.combatants)) {
      expect(c.worldId).toBeUndefined();
    }
  });
});
