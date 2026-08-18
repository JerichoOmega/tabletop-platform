// ---------------------------------------------------------------------------
// Phase 3 Milestone M4 — WorldBounds unit tests.
//
// Covers the authoritative bounds contract: point membership (inside, on each
// boundary, outside each boundary, negative coordinates), chunk intersection,
// streaming/pin-set filtering, movement rejection at each world edge,
// registry invariant guards, snapshot tile-query VOID outside bounds, and
// determinism at the boundary. M2 eviction and M3 parser behavior are covered
// by their own suites; the E2E walk-path anchor here guards the M4 E2E
// against deterministic-generation drift (same pattern as evictionPolicy).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  createWorldBounds, isInBounds, boundsWidth, boundsHeight,
  chunkIntersectsBounds, filterChunksToBounds,
} from "@/engine/worldBounds";
import {
  CHUNK_W, CHUNK_H, generateChunk, localKey, snapshotToTileQuery,
} from "@/engine/chunk";
import { WorldState, WorldEntityRegistry, computePinSet, type WorldEntity } from "@/engine/world";
import type { ChunkGeneratorFn } from "@/engine/chunk";
import {
  createExplorationSession, explorationTileInfo, movePartyStep, getParty,
  adjacentStepTargets, EXPLORE_WORLD_BOUNDS, EXPLORE_WORLD_W, EXPLORE_WORLD_H,
  EXPLORE_WORLD_SEED,
} from "@/engine/exploration";
import { getChunksForViewport } from "@/engine/viewportStreaming";
import type { ViewportState } from "@/engine/viewport";

const B = createWorldBounds(0, 0, 63, 63);
const NEG = createWorldBounds(-32, -16, 31, 15);

function vp(originWx: number, originWy: number, tileW = 12, tileH = 10): ViewportState {
  return { originWx, originWy, tileW, tileH };
}

function entity(worldId: string, wx: number, wy: number): WorldEntity {
  return { worldId, defId: "orc", wx, wy, hp: 10, maxHp: 10, alive: true, state: {} };
}

/** All-floor generator: makes movement paths fully predictable. */
const allFloorGenerator: ChunkGeneratorFn = (cx, cy) => ({
  cx, cy, tiles: new Map(), generationVersion: 0,
});

describe("createWorldBounds validation", () => {
  it("rejects non-integer limits", () => {
    expect(() => createWorldBounds(0.5, 0, 10, 10)).toThrow(/integer/);
    expect(() => createWorldBounds(0, 0, 10, 9.99)).toThrow(/integer/);
  });
  it("rejects empty rectangles (min > max)", () => {
    expect(() => createWorldBounds(5, 0, 4, 10)).toThrow(/empty/);
    expect(() => createWorldBounds(0, 11, 10, 10)).toThrow(/empty/);
  });
  it("accepts a single-tile world and freezes the result", () => {
    const b = createWorldBounds(3, 3, 3, 3);
    expect(isInBounds(b, 3, 3)).toBe(true);
    expect(boundsWidth(b)).toBe(1);
    expect(boundsHeight(b)).toBe(1);
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe("isInBounds point membership", () => {
  it("accepts interior points", () => {
    expect(isInBounds(B, 30, 30)).toBe(true);
  });
  it("accepts points exactly on each boundary (inclusive limits)", () => {
    expect(isInBounds(B, 0, 30)).toBe(true);   // west edge
    expect(isInBounds(B, 63, 30)).toBe(true);  // east edge
    expect(isInBounds(B, 30, 0)).toBe(true);   // north edge
    expect(isInBounds(B, 30, 63)).toBe(true);  // south edge
    expect(isInBounds(B, 0, 0)).toBe(true);    // corner
    expect(isInBounds(B, 63, 63)).toBe(true);  // corner
  });
  it("rejects points one tile outside each boundary", () => {
    expect(isInBounds(B, -1, 30)).toBe(false);
    expect(isInBounds(B, 64, 30)).toBe(false);
    expect(isInBounds(B, 30, -1)).toBe(false);
    expect(isInBounds(B, 30, 64)).toBe(false);
    expect(isInBounds(B, -1, -1)).toBe(false);
    expect(isInBounds(B, 64, 64)).toBe(false);
  });
  it("supports negative-coordinate bounds", () => {
    expect(isInBounds(NEG, -32, -16)).toBe(true);
    expect(isInBounds(NEG, 31, 15)).toBe(true);
    expect(isInBounds(NEG, -33, 0)).toBe(false);
    expect(isInBounds(NEG, 0, 16)).toBe(false);
    expect(boundsWidth(NEG)).toBe(64);
    expect(boundsHeight(NEG)).toBe(32);
  });
});

describe("chunkIntersectsBounds", () => {
  it("includes chunks fully inside", () => {
    expect(chunkIntersectsBounds(B, 0, 0)).toBe(true);
    expect(chunkIntersectsBounds(B, 3, 3)).toBe(true);
  });
  it("excludes chunks entirely outside on each side", () => {
    expect(chunkIntersectsBounds(B, -1, 0)).toBe(false);
    expect(chunkIntersectsBounds(B, 4, 0)).toBe(false);
    expect(chunkIntersectsBounds(B, 0, -1)).toBe(false);
    expect(chunkIntersectsBounds(B, 0, 4)).toBe(false);
  });
  it("includes chunks partially intersecting a non-chunk-aligned boundary", () => {
    const b = createWorldBounds(0, 0, 20, 20); // ends mid-chunk (1,1)
    expect(chunkIntersectsBounds(b, 1, 1)).toBe(true);   // tiles 16..20 in bounds
    expect(chunkIntersectsBounds(b, 2, 1)).toBe(false);  // starts at wx=32 > 20
  });
  it("handles negative chunk coordinates against negative bounds", () => {
    expect(chunkIntersectsBounds(NEG, -2, -1)).toBe(true);  // wx -32..-17, wy -16..-1
    expect(chunkIntersectsBounds(NEG, -3, 0)).toBe(false);  // wx -48..-33 < -32
    expect(chunkIntersectsBounds(NEG, 1, 0)).toBe(true);    // wx 16..31
    expect(chunkIntersectsBounds(NEG, 2, 0)).toBe(false);   // wx 32..47 > 31
  });
});

describe("filterChunksToBounds", () => {
  const chunks = [
    { cx: -1, cy: 0 }, { cx: 0, cy: 0 }, { cx: 3, cy: 3 }, { cx: 4, cy: 3 },
  ];
  it("removes only chunks entirely outside", () => {
    expect(filterChunksToBounds(chunks, B)).toEqual([{ cx: 0, cy: 0 }, { cx: 3, cy: 3 }]);
  });
  it("returns input unchanged for an unbounded world", () => {
    expect(filterChunksToBounds(chunks, undefined)).toBe(chunks);
  });
});

describe("getChunksForViewport with bounds (viewport crossing world edges)", () => {
  it("filters the prefetch ring at the origin corner", () => {
    // Pre-M4 this returned 9 chunks including cx/cy = -1.
    const result = getChunksForViewport(vp(0, 0), 1, B);
    expect(result).toHaveLength(4);
    expect(result.every(({ cx, cy }) => cx >= 0 && cy >= 0)).toBe(true);
  });
  it("filters the prefetch ring at the far corner", () => {
    const result = getChunksForViewport(vp(52, 54), 1, B); // visible up to (63,63)
    expect(result.every(({ cx, cy }) => cx <= 3 && cy <= 3)).toBe(true);
    expect(result.some(({ cx, cy }) => cx === 3 && cy === 3)).toBe(true);
  });
  it("filters each single edge independently", () => {
    const west = getChunksForViewport(vp(0, 20), 1, B);
    expect(west.every(({ cx }) => cx >= 0)).toBe(true);
    expect(west.some(({ cy }) => cy === 0)).toBe(true);
    const south = getChunksForViewport(vp(20, 54), 1, B);
    expect(south.every(({ cy }) => cy <= 3)).toBe(true);
  });
  it("without bounds keeps pre-M4 behavior (unbounded prefetch)", () => {
    expect(getChunksForViewport(vp(0, 0), 1)).toHaveLength(9);
  });
});

describe("computePinSet with bounds", () => {
  it("drops margin chunks outside the world for an edge participant", () => {
    const pins = computePinSet([entity("e1", 0, 0)], B);
    expect(pins).toEqual(
      expect.arrayContaining([
        { cx: 0, cy: 0 }, { cx: 1, cy: 0 }, { cx: 0, cy: 1 }, { cx: 1, cy: 1 },
      ]),
    );
    expect(pins).toHaveLength(4);
    expect(pins.every(({ cx, cy }) => cx >= 0 && cy >= 0)).toBe(true);
  });
  it("without bounds keeps the full 3×3 neighborhood", () => {
    expect(computePinSet([entity("e1", 0, 0)])).toHaveLength(9);
  });
});

describe("WorldEntityRegistry bounds invariant guard", () => {
  it("rejects register() outside bounds", () => {
    const reg = new WorldEntityRegistry(B);
    expect(() => reg.register(entity("out", -1, 5))).toThrow(/outside WorldBounds/);
    expect(reg.has("out")).toBe(false);
  });
  it("rejects move() outside bounds and preserves the entity's position", () => {
    const reg = new WorldEntityRegistry(B);
    reg.register(entity("edge", 0, 5));
    expect(() => reg.move("edge", -1, 5)).toThrow(/outside WorldBounds/);
    const e = reg.get("edge")!;
    expect([e.wx, e.wy]).toEqual([0, 5]);
  });
  it("permits boundary positions and unbounded registries", () => {
    const reg = new WorldEntityRegistry(B);
    reg.register(entity("corner", 63, 63));
    reg.move("corner", 63, 62);
    const unbounded = new WorldEntityRegistry();
    unbounded.register(entity("far", -1000, 1000)); // no bounds → allowed
  });
});

describe("exploration movement at world edges", () => {
  /** Session on a bounded all-floor world so only bounds can reject movement. */
  function floorSession() {
    const ws = new WorldState("test-world", 1, allFloorGenerator, EXPLORE_WORLD_BOUNDS);
    ws.entities.register(entity("party_avatar_t", 0, 1));
    return { worldState: ws, partyWorldId: "party_avatar_t" };
  }

  async function residentSession() {
    const s = floorSession();
    // Make all chunks around the party resident so tiles are mapped floor.
    for (let cx = 0; cx <= 1; cx++) for (let cy = 0; cy <= 1; cy++) {
      await s.worldState.chunkStore.ensureResident(cx, cy, 1, 0);
    }
    return s;
  }

  it("rejects each cross-edge step with the edge reason, deterministically", async () => {
    const s = await residentSession();
    // Party at (0,1) — west edge. Attempt to cross west, and the NW/SW diagonals.
    for (const [wx, wy] of [[-1, 1], [-1, 0], [-1, 2]] as const) {
      for (let rep = 0; rep < 2; rep++) { // repeat: deterministic resolution
        const res = movePartyStep(s, wx, wy);
        expect(res.ok).toBe(false);
        expect(res.reason).toBe("You have reached the edge of the world.");
      }
    }
    const party = getParty(s);
    expect([party.wx, party.wy]).toEqual([0, 1]); // never moved, never teleported
    expect(s.worldState.entities.getAll()).toHaveLength(1); // never duplicated/deleted
  });

  it("allows movement along the edge and back inward", async () => {
    const s = await residentSession();
    expect(movePartyStep(s, 0, 0).ok).toBe(true);   // along edge to corner
    expect(movePartyStep(s, -1, -1).ok).toBe(false); // corner: both axes out
    expect(movePartyStep(s, 0, -1).ok).toBe(false);
    expect(movePartyStep(s, 1, 1).ok).toBe(true);   // back inward
    const party = getParty(s);
    expect([party.wx, party.wy]).toEqual([1, 1]);
  });

  it("adjacentStepTargets never includes out-of-bounds tiles at a corner", async () => {
    const s = await residentSession();
    expect(movePartyStep(s, 0, 0).ok).toBe(true);
    const targets = adjacentStepTargets(s);
    expect(targets).toHaveLength(3); // (1,0), (0,1), (1,1) only
    expect(targets.every(({ wx, wy }) => wx >= 0 && wy >= 0)).toBe(true);
  });

  it("explorationTileInfo returns void outside bounds even for resident chunks", async () => {
    const s = await residentSession();
    expect(explorationTileInfo(s, -1, 0).type).toBe("void");
    expect(explorationTileInfo(s, 0, -1).type).toBe("void");
    expect(explorationTileInfo(s, 0, 0).type).toBe("floor");
  });
});

describe("exploration session wiring", () => {
  it("carries EXPLORE_WORLD_BOUNDS on WorldState (authoritative layer)", () => {
    const session = createExplorationSession();
    expect(session.worldState.bounds).toBe(EXPLORE_WORLD_BOUNDS);
    expect(EXPLORE_WORLD_W).toBe(64);
    expect(EXPLORE_WORLD_H).toBe(64);
  });
});

describe("encounter snapshot respects bounds", () => {
  it("beginEncounter never pins out-of-world chunks and tileQuery voids beyond the edge", async () => {
    const ws = new WorldState("bounded", 7, allFloorGenerator, B);
    ws.entities.register(entity("edge_fighter", 1, 1)); // chunk (0,0), margin would reach (-1,-1)
    const prepared = await ws.beginEncounter([ws.entities.get("edge_fighter")!]);
    expect(prepared.pinnedChunks.every(({ cx, cy }) => cx >= 0 && cy >= 0)).toBe(true);
    const tileQuery = snapshotToTileQuery(prepared.snapshot);
    expect(tileQuery(0, 0).type).toBe("floor");
    expect(tileQuery(-1, 0).type).toBe("void");  // outside world
    expect(tileQuery(0, -1).type).toBe("void");
  });

  it("endEncounter rejects an out-of-bounds surviving combatant atomically", async () => {
    const ws = new WorldState("bounded", 7, allFloorGenerator, B);
    ws.entities.register(entity("fighter_a", 5, 5));
    ws.entities.register(entity("fighter_b", 6, 5));
    const prepared = await ws.beginEncounter([
      ws.entities.get("fighter_a")!, ws.entities.get("fighter_b")!,
    ]);
    // Malformed combat result: fighter_b survives at an impossible position.
    const gameState = {
      combatants: {
        fighter_a: { worldId: "fighter_a", wx: 7, wy: 7, hp: 8, alive: true },
        fighter_b: { worldId: "fighter_b", wx: -5, wy: 5, hp: 9, alive: true },
      },
    } as unknown as Parameters<WorldState["endEncounter"]>[0];

    expect(() => ws.endEncounter(gameState, prepared.pinnedChunks)).toThrow(/outside WorldBounds/);

    // Atomic rejection: NOTHING was committed — including the valid fighter_a
    // update that was iterated first — and pins were not released.
    const a = ws.entities.get("fighter_a")!;
    expect([a.wx, a.wy, a.hp]).toEqual([5, 5, 10]);
    const b = ws.entities.get("fighter_b")!;
    expect([b.wx, b.wy, b.hp]).toEqual([6, 5, 10]);
    for (const { cx, cy } of prepared.pinnedChunks) {
      expect(ws.chunkStore.residency(cx, cy)).toBe("PINNED");
    }
  });

  it("voids out-of-bounds tiles inside a partially-in-world pinned chunk", async () => {
    const small = createWorldBounds(0, 0, 20, 20); // boundary mid-chunk (1,1)
    const ws = new WorldState("small", 7, allFloorGenerator, small);
    ws.entities.register(entity("e", 20, 20));
    const prepared = await ws.beginEncounter([ws.entities.get("e")!]);
    const tileQuery = snapshotToTileQuery(prepared.snapshot);
    expect(tileQuery(20, 20).type).toBe("floor"); // last in-bounds tile
    expect(tileQuery(21, 20).type).toBe("void");  // same chunk, outside world
    expect(tileQuery(20, 21).type).toBe("void");
  });
});

// ---------------------------------------------------------------------------
// E2E WALK-PATH ANCHOR — mirrors EDGE_WALK_PATH in e2e/worldBounds.spec.ts.
// If deterministic generation ever changes, this fails BEFORE the E2E does.
// ---------------------------------------------------------------------------
describe("world-edge walk path anchor (E2E fixture)", () => {
  const EDGE_WALK_PATH: [number, number][] = [
    [7, 8], [6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1],
  ];

  it("is Chebyshev-contiguous from spawn and every tile is passable floor", () => {
    let [px, py] = [8, 8];
    for (const [wx, wy] of EDGE_WALK_PATH) {
      expect(Math.max(Math.abs(wx - px), Math.abs(wy - py))).toBe(1);
      expect(isInBounds(EXPLORE_WORLD_BOUNDS, wx, wy)).toBe(true);
      const cx = Math.floor(wx / CHUNK_W);
      const cy = Math.floor(wy / CHUNK_H);
      const g = generateChunk(cx, cy, EXPLORE_WORLD_SEED, 0);
      const tile = g.tiles.get(localKey(wx - cx * CHUNK_W, wy - cy * CHUNK_H));
      expect(tile?.passable ?? true).toBe(true);
      [px, py] = [wx, wy];
    }
    expect([px, py]).toEqual([0, 1]); // ends on the west edge
  });
});
