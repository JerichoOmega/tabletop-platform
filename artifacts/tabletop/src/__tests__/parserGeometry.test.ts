// ---------------------------------------------------------------------------
// Phase 3 Milestone M3 — Parser migration off `map.pillars`.
//
// The parser's pillar/cover reasoning must consume the authoritative geometry
// (state.tileQuery) rather than the legacy MapDef.pillars array. Proves:
//   • MapDef encounters: identical semantics to the legacy array scan
//     (same nearest pillar, same no-pillar error).
//   • World-backed encounters: the pillar path now works at all (the
//     synthetic MapDef has pillars: [] — pre-M3 this branch was dead).
//   • Determinism, chunk-boundary correctness, negative coordinates.
//   • Static guard: no runtime `state.map.pillars` reference remains in the
//     parser source.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildEncounter, MAP_DEFS } from "../engine/content";
import { parseIntent } from "../intent/parser";
import { chebyshev } from "../engine/rules";
import { WorldState, buildEncounterFromEntities } from "../engine/world";
import type { WorldEntity } from "../engine/world";
import { localKey, CHUNK_W, CHUNK_H, type ChunkGeneratorFn, type ChunkGeometryData } from "../engine/chunk";
import type { TileInfo } from "../engine/content";

const PILLAR: Readonly<TileInfo> = Object.freeze({
  passable: false, blocksLOS: false, providesCover: true, type: "pillar" as const,
});

/** Generator producing empty (all-floor) chunks except explicit pillar world coords. */
function pillarGenerator(pillarsAtWorld: [number, number][]): ChunkGeneratorFn {
  return (cx, cy): ChunkGeometryData => {
    const tiles = new Map<string, Readonly<TileInfo>>();
    for (const [wx, wy] of pillarsAtWorld) {
      const pcx = Math.floor(wx / CHUNK_W);
      const pcy = Math.floor(wy / CHUNK_H);
      if (pcx === cx && pcy === cy) {
        tiles.set(localKey(wx - pcx * CHUNK_W, wy - pcy * CHUNK_H), PILLAR);
      }
    }
    return { cx, cy, tiles };
  };
}

function makeEntity(worldId: string, defId: string, wx: number, wy: number): WorldEntity {
  return { worldId, defId, wx, wy, hp: 10, maxHp: 10, alive: true, state: {} };
}

async function worldBackedState(pillars: [number, number][], entities: WorldEntity[]) {
  const ws = new WorldState("m3-world", 999, pillarGenerator(pillars));
  for (const e of entities) ws.entities.register(e);
  const prepared = await ws.beginEncounter(entities);
  return buildEncounterFromEntities(prepared, ws.worldId, 42);
}

function currentPc(state: ReturnType<typeof buildEncounter>) {
  // Tests drive the parser as whichever PC we choose; parseIntent takes actorId.
  return Object.values(state.combatants).find((c) => c.type === "pc")!;
}

describe("M3 — MapDef encounters keep legacy semantics via tileQuery", () => {
  it('"move through the pillar" proposes the nearest pillar (crypt)', () => {
    const state = buildEncounter("crypt", 1);
    const pc = currentPc(state);
    const res = parseIntent("move through the pillar", state, pc.id);
    expect(res.type).toBe("proposal");
    if (res.type !== "proposal") return;
    const move = res.steps.find((s) => s.kind === "move")!;
    expect(move.kind).toBe("move");
    const dest = (move as { dest: { wx: number; wy: number } }).dest;
    // Equivalence with the legacy array scan: dest is a pillar tile, and no
    // pillar in the MapDef is strictly closer to the actor.
    expect(MAP_DEFS.crypt.pillars.some((p) => p.x === dest.wx && p.y === dest.wy)).toBe(true);
    const destDist = chebyshev({ wx: dest.wx, wy: dest.wy }, pc);
    for (const p of MAP_DEFS.crypt.pillars) {
      expect(chebyshev({ wx: p.x, wy: p.y }, pc)).toBeGreaterThanOrEqual(destDist);
    }
    // And the authoritative geometry agrees it is a pillar.
    expect(state.tileQuery(dest.wx, dest.wy).providesCover).toBe(true);
  });

  it("no-pillar map produces the same error message as before", () => {
    const state = buildEncounter("trainingYard", 1);
    const pc = currentPc(state);
    const res = parseIntent("move through the pillar", state, pc.id);
    expect(res).toEqual({
      type: "error",
      message: "There is no pillar on the training yard.",
    });
  });

  it("equidistant pillars: documented tie-break is lowest wy, then lowest wx (adversarial ordering)", async () => {
    // Two pillars at identical Chebyshev distance 3 from the actor at (8,8):
    // (11,11) and (5,5). Listed in the generator in the OPPOSITE order of the
    // tie-break rule to prove selection does not depend on authoring order
    // (the legacy array-order accident). Contract: lowest wy wins → (5,5).
    const state = await worldBackedState(
      [[11, 11], [5, 5]],
      [makeEntity("hero_1", "fighter", 8, 8), makeEntity("orc_x", "orc", 9, 8)],
    );
    const res = parseIntent("move through the pillar", state, "hero_1");
    expect(res.type).toBe("proposal");
    if (res.type !== "proposal") return;
    const move = res.steps.find((s) => s.kind === "move")!;
    expect((move as { dest: { wx: number; wy: number } }).dest).toEqual({ wx: 5, wy: 5 });
  });

  it("equidistant pillars in the same ring row: lowest wx wins", async () => {
    // Both at distance 2, same wy row relative order: (6,6) vs (10,6).
    const state = await worldBackedState(
      [[10, 6], [6, 6]],
      [makeEntity("hero_1", "fighter", 8, 8), makeEntity("orc_x", "orc", 9, 8)],
    );
    const res = parseIntent("move through the pillar", state, "hero_1");
    expect(res.type).toBe("proposal");
    if (res.type !== "proposal") return;
    const move = res.steps.find((s) => s.kind === "move")!;
    expect((move as { dest: { wx: number; wy: number } }).dest).toEqual({ wx: 6, wy: 6 });
  });

  it("nearest-pillar selection is deterministic", () => {
    const state = buildEncounter("largeArena", 7); // grandHall: 16 pillars, ties exist
    const pc = currentPc(state);
    const a = parseIntent("move through the pillar", state, pc.id);
    const b = parseIntent("move through the pillar", state, pc.id);
    expect(a).toEqual(b);
  });
});

describe("M3 — world-backed encounters use snapshot geometry", () => {
  it("finds a pillar from chunk geometry (synthetic MapDef.pillars is empty — dead branch pre-M3)", async () => {
    const state = await worldBackedState(
      [[10, 10]],
      [makeEntity("hero_1", "fighter", 5, 5), makeEntity("orc_x", "orc", 6, 5)],
    );
    expect(state.map.pillars).toEqual([]); // the legacy array genuinely has nothing
    const res = parseIntent("move through the pillar", state, "hero_1");
    expect(res.type).toBe("proposal");
    if (res.type !== "proposal") return;
    const move = res.steps.find((s) => s.kind === "move")!;
    expect((move as { dest: { wx: number; wy: number } }).dest).toEqual({ wx: 10, wy: 10 });
  });

  it("nearest pillar across a chunk boundary", async () => {
    // Actor in chunk (0,0) at (14,8); only pillar lives in chunk (1,0) at (17,8).
    const state = await worldBackedState(
      [[17, 8]],
      [makeEntity("hero_1", "fighter", 14, 8), makeEntity("orc_x", "orc", 13, 8)],
    );
    const res = parseIntent("move through the pillar", state, "hero_1");
    expect(res.type).toBe("proposal");
    if (res.type !== "proposal") return;
    const move = res.steps.find((s) => s.kind === "move")!;
    expect((move as { dest: { wx: number; wy: number } }).dest).toEqual({ wx: 17, wy: 8 });
  });

  it("negative world coordinates are handled correctly", async () => {
    // Actor at (-5,-5) in chunk (-1,-1); pillar at (-3,-4) in the same chunk.
    const state = await worldBackedState(
      [[-3, -4]],
      [makeEntity("hero_1", "fighter", -5, -5), makeEntity("orc_x", "orc", -6, -5)],
    );
    const res = parseIntent("move through the pillar", state, "hero_1");
    expect(res.type).toBe("proposal");
    if (res.type !== "proposal") return;
    const move = res.steps.find((s) => s.kind === "move")!;
    expect((move as { dest: { wx: number; wy: number } }).dest).toEqual({ wx: -3, wy: -4 });
  });

  it("world-backed encounter with no cover in the snapshot yields the no-pillar error", async () => {
    const state = await worldBackedState(
      [],
      [makeEntity("hero_1", "fighter", 5, 5), makeEntity("orc_x", "orc", 6, 5)],
    );
    const res = parseIntent("move through the pillar", state, "hero_1");
    expect(res.type).toBe("error");
  });
});

describe("M3 — no runtime map.pillars references remain in the parser", () => {
  it("parser source contains no state.map.pillars access", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../intent/parser.ts"), "utf8");
    // Strip comments, then assert no .pillars property access survives.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.pillars\b/);
    expect(code).not.toMatch(/map\.pillars/);
  });
});
