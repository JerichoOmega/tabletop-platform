// ---------------------------------------------------------------------------
// Chunk system unit tests — Phase F foundation + async streaming.
//
// Covers:
//   1.  Chunk dimension constants
//   2.  wxToChunk / chunkToWx  — coordinate math with positive, zero,
//       boundary, and negative world coordinates; round trips
//   3.  wyToChunk / chunkToWy  — same for y-axis
//   4.  worldToChunkCoord      — combined decomposition
//   5.  chunkKey               — uniqueness and negative-coord correctness
//   6.  localKey               — format and uniqueness
//   7.  generateChunk          — determinism, order independence,
//       coordinate isolation, version isolation
//   8.  generateChunk RNG isolation — chunk generation does not alter
//       any external gameplay RNG stream
//   9.  ChunkGeometryData      — tile lookup (floor default, pillar, absent chunk)
//  10.  snapshotToTileQuery    — floor, pillar, void (absent chunk),
//       immutability under live-store mutations
//  11.  ChunkStore residency lifecycle — UNLOADED → RESIDENT → PINNED;
//       evict prevents pinned eviction; unpin restores evictability
//  12.  ChunkStore.createSnapshot — content, error on unloaded chunk
//  13.  mapDefToTileQuery Set optimization regression — floor, wall, pillar,
//       entrance, void match the expected TileInfo contract exactly
//  14.  ChunkStore — async streaming (Phase F increment 2)
//       LOADING state, deduplication, failure, retry, pin/load atomicity,
//       eviction safety, snapshot stability, RNG isolation, determinism
//
// Run: pnpm --filter @workspace/tabletop test
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import {
  CHUNK_W,
  CHUNK_H,
  wxToChunk,
  chunkToWx,
  wyToChunk,
  chunkToWy,
  worldToChunkCoord,
  chunkKey,
  localKey,
  generateChunk,
  snapshotToTileQuery,
  ChunkStore,
} from "@/engine/chunk";
import type { ChunkGeometryData, ResidentGeometrySnapshot, ChunkGeneratorFn } from "@/engine/chunk";

import { mulberry32, mapDefToTileQuery, MAP_DEFS } from "@/engine/content";

// ---------------------------------------------------------------------------
// 1. CHUNK DIMENSION CONSTANTS
// ---------------------------------------------------------------------------
describe("CHUNK_W / CHUNK_H", () => {
  it("are both 16 (Decision 21)", () => {
    expect(CHUNK_W).toBe(16);
    expect(CHUNK_H).toBe(16);
  });

  it("are equal (square chunks)", () => {
    expect(CHUNK_W).toBe(CHUNK_H);
  });
});

// ---------------------------------------------------------------------------
// 2. wxToChunk / chunkToWx
// ---------------------------------------------------------------------------
describe("wxToChunk", () => {
  // Reference table (spec §11.2):
  const cases: Array<{ wx: number; cx: number; lx: number }> = [
    { wx:   0, cx:  0, lx:  0 },
    { wx:   1, cx:  0, lx:  1 },
    { wx:  15, cx:  0, lx: 15 },
    { wx:  16, cx:  1, lx:  0 },
    { wx:  17, cx:  1, lx:  1 },
    { wx:  31, cx:  1, lx: 15 },
    { wx:  32, cx:  2, lx:  0 },
    { wx:  33, cx:  2, lx:  1 },
    { wx:  -1, cx: -1, lx: 15 },  // critical: % would give -1 (wrong)
    { wx: -15, cx: -1, lx:  1 },
    { wx: -16, cx: -1, lx:  0 },
    { wx: -17, cx: -2, lx: 15 },
    { wx: -32, cx: -2, lx:  0 },
    { wx: -33, cx: -3, lx: 15 },
  ];

  for (const { wx, cx, lx } of cases) {
    it(`wx=${wx} → cx=${cx}, lx=${lx}`, () => {
      const result = wxToChunk(wx);
      expect(result.cx).toBe(cx);
      expect(result.lx).toBe(lx);
    });
  }

  it("local coordinate is always in [0, CHUNK_W)", () => {
    const testValues = [0, 1, 15, 16, 17, 31, 32, -1, -15, -16, -17, -32, 100, -100, 999, -999];
    for (const wx of testValues) {
      const { lx } = wxToChunk(wx);
      expect(lx).toBeGreaterThanOrEqual(0);
      expect(lx).toBeLessThan(CHUNK_W);
    }
  });
});

describe("chunkToWx (inverse of wxToChunk)", () => {
  it("round trips correctly for positive wx", () => {
    const values = [0, 1, 15, 16, 17, 31, 32, 100, 255, 1000];
    for (const wx of values) {
      const { cx, lx } = wxToChunk(wx);
      expect(chunkToWx(cx, lx)).toBe(wx);
    }
  });

  it("round trips correctly for negative wx", () => {
    const values = [-1, -15, -16, -17, -32, -33, -100, -255];
    for (const wx of values) {
      const { cx, lx } = wxToChunk(wx);
      expect(chunkToWx(cx, lx)).toBe(wx);
    }
  });

  it("chunkToWx(0, 0) === 0", () => {
    expect(chunkToWx(0, 0)).toBe(0);
  });

  it("chunkToWx(1, 0) === 16", () => {
    expect(chunkToWx(1, 0)).toBe(16);
  });

  it("chunkToWx(-1, 15) === -1", () => {
    expect(chunkToWx(-1, 15)).toBe(-1);
  });

  it("chunkToWx(-1, 0) === -16", () => {
    expect(chunkToWx(-1, 0)).toBe(-16);
  });
});

// ---------------------------------------------------------------------------
// 3. wyToChunk / chunkToWy
// ---------------------------------------------------------------------------
describe("wyToChunk", () => {
  const cases: Array<{ wy: number; cy: number; ly: number }> = [
    { wy:   0, cy:  0, ly:  0 },
    { wy:  15, cy:  0, ly: 15 },
    { wy:  16, cy:  1, ly:  0 },
    { wy:  17, cy:  1, ly:  1 },
    { wy:  -1, cy: -1, ly: 15 },
    { wy: -16, cy: -1, ly:  0 },
    { wy: -17, cy: -2, ly: 15 },
  ];

  for (const { wy, cy, ly } of cases) {
    it(`wy=${wy} → cy=${cy}, ly=${ly}`, () => {
      const result = wyToChunk(wy);
      expect(result.cy).toBe(cy);
      expect(result.ly).toBe(ly);
    });
  }

  it("local coordinate is always in [0, CHUNK_H)", () => {
    const testValues = [0, 1, 15, 16, 17, -1, -16, -17, 100, -100];
    for (const wy of testValues) {
      const { ly } = wyToChunk(wy);
      expect(ly).toBeGreaterThanOrEqual(0);
      expect(ly).toBeLessThan(CHUNK_H);
    }
  });
});

describe("chunkToWy (inverse of wyToChunk)", () => {
  it("round trips correctly for positive and negative wy", () => {
    const values = [0, 1, 15, 16, 17, -1, -16, -17, -100, 100];
    for (const wy of values) {
      const { cy, ly } = wyToChunk(wy);
      expect(chunkToWy(cy, ly)).toBe(wy);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. worldToChunkCoord
// ---------------------------------------------------------------------------
describe("worldToChunkCoord", () => {
  it("combines wxToChunk and wyToChunk correctly", () => {
    const cases: Array<{ wx: number; wy: number; cx: number; cy: number; lx: number; ly: number }> = [
      { wx:  0, wy:  0, cx: 0,  cy: 0,  lx: 0,  ly: 0  },
      { wx: 17, wy: -1, cx: 1,  cy: -1, lx: 1,  ly: 15 },
      { wx: -1, wy: 16, cx: -1, cy: 1,  lx: 15, ly: 0  },
      { wx: -17,wy: -17,cx: -2, cy: -2, lx: 15, ly: 15 },
    ];
    for (const { wx, wy, cx, cy, lx, ly } of cases) {
      const result = worldToChunkCoord(wx, wy);
      expect(result.cx).toBe(cx);
      expect(result.cy).toBe(cy);
      expect(result.lx).toBe(lx);
      expect(result.ly).toBe(ly);
    }
  });

  it("round trip: world → chunk/local → world", () => {
    const coords = [
      [0, 0], [15, 15], [16, 16], [17, 17],
      [-1, -1], [-16, -16], [-17, -17],
      [100, -50], [-33, 200],
    ];
    for (const [wx, wy] of coords) {
      const { cx, cy, lx, ly } = worldToChunkCoord(wx, wy);
      expect(chunkToWx(cx, lx)).toBe(wx);
      expect(chunkToWy(cy, ly)).toBe(wy);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. chunkKey — uniqueness
// ---------------------------------------------------------------------------
describe("chunkKey", () => {
  it("produces distinct keys for distinct (cx, cy) pairs", () => {
    const pairs: Array<[number, number]> = [
      [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [-1, -1], [1, 1], [-1, 1], [1, -1],
      [10, 20], [-10, 20], [10, -20], [-10, -20],
    ];
    const keys = pairs.map(([cx, cy]) => chunkKey(cx, cy));
    const unique = new Set(keys);
    expect(unique.size).toBe(pairs.length);
  });

  it("includes negative coordinates correctly", () => {
    // These must not produce the same string
    expect(chunkKey(0, 0)).not.toBe(chunkKey(1, 0));
    expect(chunkKey(0, 0)).not.toBe(chunkKey(0, 1));
    expect(chunkKey(-1, 0)).not.toBe(chunkKey(0, -1));
    expect(chunkKey(-1, -1)).not.toBe(chunkKey(1, 1));
  });

  it("format includes comma separator preventing ambiguity", () => {
    // Without a separator "12" + "3" = "123" collides with "1" + "23".
    // The comma prevents this: "12,3" !== "1,23".
    expect(chunkKey(12, 3)).not.toBe(chunkKey(1, 23));
    expect(chunkKey(1, 2)).not.toBe(chunkKey(12, 0));
  });
});

// ---------------------------------------------------------------------------
// 6. localKey
// ---------------------------------------------------------------------------
describe("localKey", () => {
  it("produces distinct keys for distinct (lx, ly) pairs within [0, CHUNK_W)", () => {
    const keys = new Set<string>();
    for (let lx = 0; lx < CHUNK_W; lx++) {
      for (let ly = 0; ly < CHUNK_H; ly++) {
        keys.add(localKey(lx, ly));
      }
    }
    expect(keys.size).toBe(CHUNK_W * CHUNK_H);
  });
});

// ---------------------------------------------------------------------------
// 7. generateChunk — determinism
// ---------------------------------------------------------------------------
describe("generateChunk — determinism", () => {
  it("same inputs produce identical tile maps", () => {
    const a = generateChunk(0, 0, 12345, 0);
    const b = generateChunk(0, 0, 12345, 0);
    expect(a.tiles.size).toBe(b.tiles.size);
    for (const [k, v] of a.tiles) {
      expect(b.tiles.get(k)).toEqual(v);
    }
  });

  it("different worldSeed produces different geometry", () => {
    const a = generateChunk(0, 0, 100, 0);
    const b = generateChunk(0, 0, 200, 0);
    // Tile maps should differ (different seeds → different pillar positions)
    // There is a tiny probability of collision, but with 256 tiles and ~5%
    // pillar rate it is astronomically unlikely.
    expect(a.tiles.size !== b.tiles.size || [...a.tiles.keys()].some(k => !b.tiles.has(k))).toBe(true);
  });

  it("different cx produces different geometry", () => {
    const a = generateChunk(0,  0, 42, 0);
    const b = generateChunk(1,  0, 42, 0);
    const c = generateChunk(-1, 0, 42, 0);
    const keysA = new Set([...a.tiles.keys()]);
    const keysB = new Set([...b.tiles.keys()]);
    const keysC = new Set([...c.tiles.keys()]);
    // At least one pair must differ
    const allSame = [...keysA].every(k => keysB.has(k)) && keysA.size === keysB.size
                 && [...keysA].every(k => keysC.has(k)) && keysA.size === keysC.size;
    expect(allSame).toBe(false);
  });

  it("different cy produces different geometry", () => {
    const a = generateChunk(0, 0,  42, 0);
    const b = generateChunk(0, 1,  42, 0);
    const c = generateChunk(0, -1, 42, 0);
    const keysA = new Set([...a.tiles.keys()]);
    const keysB = new Set([...b.tiles.keys()]);
    const keysC = new Set([...c.tiles.keys()]);
    const allSame = [...keysA].every(k => keysB.has(k)) && keysA.size === keysB.size
                 && [...keysA].every(k => keysC.has(k)) && keysA.size === keysC.size;
    expect(allSame).toBe(false);
  });

  it("different generationVersion produces different geometry", () => {
    const v0 = generateChunk(3, 7, 42, 0);
    const v1 = generateChunk(3, 7, 42, 1);
    const keysV0 = new Set([...v0.tiles.keys()]);
    const keysV1 = new Set([...v1.tiles.keys()]);
    const same = [...keysV0].every(k => keysV1.has(k)) && keysV0.size === keysV1.size;
    expect(same).toBe(false);
  });

  it("order independence: generate A→B→A equals generate A alone", () => {
    const aAlone = generateChunk(5, 3, 77, 0);

    // Generate A, then B, then A again — A's result must be identical.
    generateChunk(5, 3, 77, 0);  // first A
    generateChunk(9, 9, 77, 0);  // B — different chunk
    const aAfterB = generateChunk(5, 3, 77, 0);  // A again

    expect(aAfterB.cx).toBe(aAlone.cx);
    expect(aAfterB.cy).toBe(aAlone.cy);
    expect(aAfterB.tiles.size).toBe(aAlone.tiles.size);
    for (const [k, v] of aAlone.tiles) {
      expect(aAfterB.tiles.get(k)).toEqual(v);
    }
  });

  it("negative chunk coordinates are handled correctly", () => {
    const negNeg = generateChunk(-1, -1, 42, 0);
    const posPos = generateChunk( 1,  1, 42, 0);
    expect(negNeg.cx).toBe(-1);
    expect(negNeg.cy).toBe(-1);
    // Independently deterministic
    const negNeg2 = generateChunk(-1, -1, 42, 0);
    expect(negNeg.tiles.size).toBe(negNeg2.tiles.size);
    for (const [k, v] of negNeg.tiles) {
      expect(negNeg2.tiles.get(k)).toEqual(v);
    }
    // Different from posPos
    const keysN = new Set([...negNeg.tiles.keys()]);
    const keysP = new Set([...posPos.tiles.keys()]);
    const same = [...keysN].every(k => keysP.has(k)) && keysN.size === keysP.size;
    expect(same).toBe(false);
  });

  it("stores the correct cx/cy on the returned object", () => {
    const chunk = generateChunk(7, -3, 999, 2);
    expect(chunk.cx).toBe(7);
    expect(chunk.cy).toBe(-3);
  });

  it("generated chunk tiles are within valid local coordinate range", () => {
    const chunk = generateChunk(0, 0, 12345, 0);
    for (const key of chunk.tiles.keys()) {
      const [lxStr, lyStr] = key.split(",");
      const lx = parseInt(lxStr, 10);
      const ly = parseInt(lyStr, 10);
      expect(lx).toBeGreaterThanOrEqual(0);
      expect(lx).toBeLessThan(CHUNK_W);
      expect(ly).toBeGreaterThanOrEqual(0);
      expect(ly).toBeLessThan(CHUNK_H);
    }
  });

  it("generated pillar tiles have the correct TileInfo shape", () => {
    // Find a chunk that has at least one pillar and verify the shape.
    // We try multiple seeds to reliably find one.
    let found = false;
    for (let seed = 0; seed < 20 && !found; seed++) {
      const chunk = generateChunk(0, 0, seed * 1000, 0);
      for (const tile of chunk.tiles.values()) {
        expect(tile.type).toBe("pillar");
        expect(tile.passable).toBe(false);
        expect(tile.blocksLOS).toBe(false);
        expect(tile.providesCover).toBe(true);
        found = true;
        break;
      }
    }
    // With ~5% pillar rate and 256 tiles, the probability of 20 chunks all
    // having zero pillars is (0.95^256)^20 ≈ 0 — this assertion won't flake.
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. generateChunk — RNG isolation
// ---------------------------------------------------------------------------
describe("generateChunk — RNG isolation", () => {
  it("chunk generation does not alter an external gameplay RNG sequence", () => {
    const seed = 12345;

    // Gameplay RNG A: draw 20 values, then generate 3 chunks, then draw 10 more.
    const rngA = mulberry32(seed);
    const beforeA = Array.from({ length: 20 }, () => rngA());
    generateChunk(0,   0,  seed, 0);
    generateChunk(-1,  5,  seed, 0);
    generateChunk(100, 200, seed, 0);
    const afterA = Array.from({ length: 10 }, () => rngA());

    // Gameplay RNG B: same seed, draw 20 + 10 values without any chunk generation.
    const rngB = mulberry32(seed);
    const beforeB = Array.from({ length: 20 }, () => rngB());
    const afterB  = Array.from({ length: 10 }, () => rngB());

    // The sequences must be identical — chunk generation touched no external state.
    expect(beforeA).toEqual(beforeB);
    expect(afterA).toEqual(afterB);
  });

  it("multiple concurrent chunk generations are all independent", () => {
    const rng = mulberry32(99);
    const v1 = rng();

    generateChunk( 0,  0, 1, 0);
    generateChunk( 1,  0, 1, 0);
    generateChunk(-1,  1, 2, 0);
    generateChunk(10, 10, 3, 1);

    const v2 = rng();

    // v2 must be the next value in the sequence after v1 — chunk generation
    // did not consume any of the external rng's values.
    const rngRef = mulberry32(99);
    rngRef(); // v1
    const expectedV2 = rngRef();

    expect(v2).toBe(expectedV2);
  });

  it("generation version changes do not affect external RNG isolation", () => {
    const rng = mulberry32(42);
    const draws = Array.from({ length: 5 }, () => rng());

    generateChunk(0, 0, 42, 0);
    generateChunk(0, 0, 42, 1);
    generateChunk(0, 0, 42, 2);

    const drawsAfter = Array.from({ length: 5 }, () => rng());

    const rngRef = mulberry32(42);
    Array.from({ length: 5 }, () => rngRef()); // consume the first 5
    const expectedAfter = Array.from({ length: 5 }, () => rngRef());

    expect(draws).toEqual(Array.from({ length: 5 }, (_, i) => {
      const r = mulberry32(42);
      for (let j = 0; j < i; j++) r();
      return r();
    }));
    expect(drawsAfter).toEqual(expectedAfter);
  });
});

// ---------------------------------------------------------------------------
// 9. ChunkGeometryData — tile lookup
// ---------------------------------------------------------------------------
describe("ChunkGeometryData tile types", () => {
  it("absent local keys are implicitly floor", () => {
    // A chunk that generates zero pillars at any of these positions would still
    // satisfy this: absent = floor. We just need a chunk with a known absent key.
    const chunk = generateChunk(0, 0, 12345, 0);
    // Find a key NOT in the sparse map and verify the spec: absent = floor.
    let absentKey: string | null = null;
    for (let ly = 0; ly < CHUNK_H && !absentKey; ly++) {
      for (let lx = 0; lx < CHUNK_W && !absentKey; lx++) {
        const k = lx + "," + ly;
        if (!chunk.tiles.has(k)) absentKey = k;
      }
    }
    // An entirely pillar-covered chunk is essentially impossible at 5% rate.
    expect(absentKey).not.toBeNull();
    // The snapshot query returns floor for absent local keys (tested below).
  });

  it("stored tiles are non-floor (pillars)", () => {
    // All stored tiles in the foundation generation are pillars.
    const chunk = generateChunk(0, 0, 0, 0);
    for (const tile of chunk.tiles.values()) {
      expect(tile.type).toBe("pillar");
    }
  });
});

// ---------------------------------------------------------------------------
// 10. snapshotToTileQuery
// ---------------------------------------------------------------------------
describe("snapshotToTileQuery", () => {
  // Build a deterministic chunk with known tile content.
  const worldSeed = 42;
  const chunk00 = generateChunk(0, 0, worldSeed, 0);

  function makeSnapshot(...chunks: ChunkGeometryData[]): ResidentGeometrySnapshot {
    const map = new Map<string, ChunkGeometryData>();
    for (const c of chunks) map.set(c.cx + "," + c.cy, c);
    return { chunks: map as ReadonlyMap<string, ChunkGeometryData>, worldId: "test", seed: worldSeed };
  }

  it("returns VOID for a tile in an absent chunk", () => {
    // snapshot only contains chunk (0,0) — querying chunk (1,0) → void
    const snap = makeSnapshot(chunk00);
    const tileQuery = snapshotToTileQuery(snap);
    const tile = tileQuery(16, 0);  // cx=1, cy=0 — not in snapshot
    expect(tile.type).toBe("void");
    expect(tile.passable).toBe(false);
    expect(tile.blocksLOS).toBe(true);
    expect(tile.providesCover).toBe(false);
  });

  it("returns VOID for any world coordinate outside all snapshotted chunks", () => {
    const snap = makeSnapshot(chunk00);
    const tileQuery = snapshotToTileQuery(snap);
    // Negative chunk
    expect(tileQuery(-1, 0).type).toBe("void");
    expect(tileQuery(0, -1).type).toBe("void");
    expect(tileQuery(-16, -16).type).toBe("void");
    // Far positive chunk
    expect(tileQuery(32, 0).type).toBe("void");
  });

  it("returns FLOOR for a tile present in the snapshot but not in the sparse map", () => {
    // Find a local coordinate within chunk (0,0) that has no pillar.
    let floorWx: number | null = null;
    let floorWy: number | null = null;
    for (let ly = 0; ly < CHUNK_H && floorWx === null; ly++) {
      for (let lx = 0; lx < CHUNK_W && floorWx === null; lx++) {
        if (!chunk00.tiles.has(lx + "," + ly)) {
          floorWx = lx;
          floorWy = ly;
        }
      }
    }
    expect(floorWx).not.toBeNull();
    const snap = makeSnapshot(chunk00);
    const tileQuery = snapshotToTileQuery(snap);
    const tile = tileQuery(floorWx!, floorWy!);
    expect(tile.type).toBe("floor");
    expect(tile.passable).toBe(true);
    expect(tile.blocksLOS).toBe(false);
    expect(tile.providesCover).toBe(false);
  });

  it("returns PILLAR for a tile that is a pillar in the chunk", () => {
    // Find a chunk with at least one pillar.
    let pillarChunk: ChunkGeometryData | null = null;
    let pillarLx = 0, pillarLy = 0;
    for (let seed = 0; seed < 50 && !pillarChunk; seed++) {
      const c = generateChunk(0, 0, seed * 137, 0);
      for (const key of c.tiles.keys()) {
        const [lxStr, lyStr] = key.split(",");
        pillarLx = parseInt(lxStr, 10);
        pillarLy = parseInt(lyStr, 10);
        pillarChunk = c;
        break;
      }
    }
    expect(pillarChunk).not.toBeNull();
    const snap = makeSnapshot(pillarChunk!);
    const tileQuery = snapshotToTileQuery(snap);
    const tile = tileQuery(pillarLx, pillarLy);
    expect(tile.type).toBe("pillar");
    expect(tile.passable).toBe(false);
    expect(tile.blocksLOS).toBe(false);
    expect(tile.providesCover).toBe(true);
  });

  it("negative world coordinates in a snapshotted negative chunk return correct tiles", () => {
    const chunkNeg = generateChunk(-1, -1, worldSeed, 0);
    const snap = makeSnapshot(chunkNeg);
    const tileQuery = snapshotToTileQuery(snap);
    // wx = -1 → cx=-1, lx=15 ; wy = -1 → cy=-1, ly=15
    const tile = tileQuery(-1, -1);
    const expectedKey = "15,15";
    const expectedType = chunkNeg.tiles.has(expectedKey) ? "pillar" : "floor";
    expect(tile.type).toBe(expectedType);
    // wx = -16 → cx=-1, lx=0 ; wy = -16 → cy=-1, ly=0
    const tileOrigin = tileQuery(-16, -16);
    const expectedKeyOrigin = "0,0";
    const expectedTypeOrigin = chunkNeg.tiles.has(expectedKeyOrigin) ? "pillar" : "floor";
    expect(tileOrigin.type).toBe(expectedTypeOrigin);
  });

  it("snapshot is immutable: loading a new chunk does not change existing query results", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    const snap = store.createSnapshot("world", worldSeed, [{ cx: 0, cy: 0 }]);
    const tileQuery = snapshotToTileQuery(snap);

    // Sample a tile from the snapshot before mutation.
    const tileBefore = tileQuery(0, 0);

    // Load another chunk (mutates the store).
    store.load(1, 0, worldSeed);
    store.load(0, 1, worldSeed);

    // The snapshot-backed query must return the same result.
    const tileAfter = tileQuery(0, 0);
    expect(tileAfter).toEqual(tileBefore);
  });

  it("snapshot is stable after store eviction of a snapshotted chunk", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    const snap = store.createSnapshot("world", worldSeed, [{ cx: 0, cy: 0 }]);
    const tileQuery = snapshotToTileQuery(snap);

    // Sample the tile before eviction.
    const tileBefore = tileQuery(5, 5);

    // Evict the chunk from the live store (moves it to UNLOADED).
    const evicted = store.evict(0, 0);
    expect(evicted).toBe(true);

    // The snapshot still holds the geometry — query result is unchanged.
    const tileAfter = tileQuery(5, 5);
    expect(tileAfter).toEqual(tileBefore);
  });

  it("snapshot query for a different world coordinate returns void (chunk not in snapshot)", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    // Only snapshot chunk (0,0)
    const snap = store.createSnapshot("world", worldSeed, [{ cx: 0, cy: 0 }]);
    const tileQuery = snapshotToTileQuery(snap);

    // Chunk (1, 0) is not in the snapshot — returns void.
    expect(tileQuery(16, 0).type).toBe("void");
  });
});

// ---------------------------------------------------------------------------
// 11. ChunkStore — residency lifecycle
// ---------------------------------------------------------------------------
describe("ChunkStore residency lifecycle", () => {
  const worldSeed = 9999;

  it("fresh store: all chunks are UNLOADED", () => {
    const store = new ChunkStore();
    expect(store.residency(0, 0)).toBe("UNLOADED");
    expect(store.residency(-1, 5)).toBe("UNLOADED");
    expect(store.residency(100, 200)).toBe("UNLOADED");
  });

  it("after load(): chunk is RESIDENT", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("RESIDENT");
  });

  it("load() is idempotent: loading an already-RESIDENT chunk does not change it", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed, 0);
    const geo1 = store.getGeometry(0, 0);
    store.load(0, 0, worldSeed, 0); // second call — should be a no-op
    const geo2 = store.getGeometry(0, 0);
    expect(store.residency(0, 0)).toBe("RESIDENT");
    // Same geometry object reference (no re-generation).
    expect(geo2).toBe(geo1);
  });

  it("after pin(): chunk is PINNED", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    store.pin(0, 0);
    expect(store.residency(0, 0)).toBe("PINNED");
  });

  it("after unpin(): PINNED chunk returns to RESIDENT", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    store.pin(0, 0);
    expect(store.residency(0, 0)).toBe("PINNED");
    store.unpin(0, 0);
    expect(store.residency(0, 0)).toBe("RESIDENT");
  });

  it("unpin() is a no-op for a RESIDENT or UNLOADED chunk", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    // RESIDENT — unpin has no effect
    store.unpin(0, 0);
    expect(store.residency(0, 0)).toBe("RESIDENT");
    // UNLOADED — unpin has no effect
    store.unpin(5, 5);
    expect(store.residency(5, 5)).toBe("UNLOADED");
  });

  it("evict() removes a RESIDENT chunk → UNLOADED, returns true", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    expect(store.evict(0, 0)).toBe(true);
    expect(store.residency(0, 0)).toBe("UNLOADED");
  });

  it("evict() on UNLOADED chunk returns true (idempotent)", () => {
    const store = new ChunkStore();
    expect(store.evict(99, 99)).toBe(true);
  });

  it("evict() on a PINNED chunk returns false (protected — Decision 24)", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    store.pin(0, 0);
    const result = store.evict(0, 0);
    expect(result).toBe(false);
    expect(store.residency(0, 0)).toBe("PINNED");  // still PINNED
  });

  it("evict() on a PINNED chunk leaves geometry intact", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    store.pin(0, 0);
    const geoBefore = store.getGeometry(0, 0);
    store.evict(0, 0); // fails silently
    const geoAfter = store.getGeometry(0, 0);
    expect(geoAfter).toBe(geoBefore);
  });

  it("after unpin() + evict(), chunk transitions to UNLOADED", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    store.pin(0, 0);
    store.unpin(0, 0);
    expect(store.evict(0, 0)).toBe(true);
    expect(store.residency(0, 0)).toBe("UNLOADED");
  });

  it("chunk can be loaded again after eviction", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    store.evict(0, 0);
    expect(store.residency(0, 0)).toBe("UNLOADED");
    store.load(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("RESIDENT");
  });

  it("getGeometry() returns undefined for UNLOADED chunks", () => {
    const store = new ChunkStore();
    expect(store.getGeometry(0, 0)).toBeUndefined();
    store.load(0, 0, worldSeed);
    store.evict(0, 0);
    expect(store.getGeometry(0, 0)).toBeUndefined();
  });

  it("getGeometry() returns ChunkGeometryData for RESIDENT and PINNED chunks", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    expect(store.getGeometry(0, 0)).toBeDefined();
    store.pin(0, 0);
    expect(store.getGeometry(0, 0)).toBeDefined();
  });

  it("pin() throws if chunk is not loaded", () => {
    const store = new ChunkStore();
    expect(() => store.pin(0, 0)).toThrow();
  });

  it("multiple chunks are tracked independently", () => {
    const store = new ChunkStore();
    store.load( 0,  0, worldSeed);
    store.load( 1,  0, worldSeed);
    store.load(-1,  0, worldSeed);
    store.pin(0, 0);
    expect(store.residency( 0, 0)).toBe("PINNED");
    expect(store.residency( 1, 0)).toBe("RESIDENT");
    expect(store.residency(-1, 0)).toBe("RESIDENT");
    // Evict one; others unaffected
    store.evict(1, 0);
    expect(store.residency( 0, 0)).toBe("PINNED");
    expect(store.residency( 1, 0)).toBe("UNLOADED");
    expect(store.residency(-1, 0)).toBe("RESIDENT");
  });
});

// ---------------------------------------------------------------------------
// 12. ChunkStore.createSnapshot
// ---------------------------------------------------------------------------
describe("ChunkStore.createSnapshot", () => {
  const worldSeed = 77;

  it("snapshot contains geometry for all requested chunks", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    store.load(1, 0, worldSeed);
    const snap = store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }]);
    expect(snap.chunks.size).toBe(2);
    expect(snap.chunks.has("0,0")).toBe(true);
    expect(snap.chunks.has("1,0")).toBe(true);
    expect(snap.worldId).toBe("w1");
    expect(snap.seed).toBe(worldSeed);
  });

  it("throws if any requested chunk is not loaded", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    expect(() =>
      store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }, { cx: 99, cy: 99 }])
    ).toThrow();
  });

  it("snapshot remains valid after the store evicts one of its chunks", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    const snap = store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }]);
    store.evict(0, 0);
    // Snapshot is unaffected — geometry is referenced directly.
    expect(snap.chunks.has("0,0")).toBe(true);
    const tileQuery = snapshotToTileQuery(snap);
    // A tile in chunk (0,0) should still return a non-void result.
    expect(tileQuery(0, 0).type).not.toBe("void");
  });

  it("empty coord list produces an empty snapshot", () => {
    const store = new ChunkStore();
    const snap = store.createSnapshot("w1", worldSeed, []);
    expect(snap.chunks.size).toBe(0);
    // All queries return void — no chunks in snapshot.
    const tileQuery = snapshotToTileQuery(snap);
    expect(tileQuery(0, 0).type).toBe("void");
  });

  it("snapshot geometry matches live store geometry at creation time", () => {
    const store = new ChunkStore();
    store.load(0, 0, worldSeed);
    const liveGeo = store.getGeometry(0, 0)!;
    const snap = store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }]);
    const snapGeo = snap.chunks.get("0,0");
    // Same reference (snapshot holds the geometry object, not a deep copy).
    expect(snapGeo).toBe(liveGeo);
  });
});

// ---------------------------------------------------------------------------
// 13. mapDefToTileQuery Set optimization — regression
// ---------------------------------------------------------------------------
describe("mapDefToTileQuery (Set optimization regression)", () => {
  // These tests prove that the Set-based pillar lookup produces IDENTICAL
  // results to the specified behavior for all tile types.

  const cryptMap = MAP_DEFS.crypt;  // width=8, height=6, entrance=(0,3), pillars at (3,2) and (5,3)
  const yardMap  = MAP_DEFS.trainingYard;  // width=8, height=6, entrance=(0,3), no pillars

  describe("crypt map", () => {
    const tileQuery = mapDefToTileQuery(cryptMap);

    it("entrance tile is passable floor (not wall)", () => {
      const t = tileQuery(0, 3);
      expect(t.passable).toBe(true);
      expect(t.blocksLOS).toBe(false);
      expect(t.providesCover).toBe(false);
      expect(t.type).toBe("floor");
    });

    it("border tiles (non-entrance) are walls", () => {
      expect(tileQuery(0, 0).type).toBe("wall");  // corner
      expect(tileQuery(7, 3).type).toBe("wall");  // right border
      expect(tileQuery(0, 1).type).toBe("wall");  // left border (not entrance)
      expect(tileQuery(4, 0).type).toBe("wall");  // top border
      expect(tileQuery(4, 5).type).toBe("wall");  // bottom border
    });

    it("wall tiles have correct TileInfo (passable=false, blocksLOS=true, providesCover=false)", () => {
      const t = tileQuery(0, 0);
      expect(t.passable).toBe(false);
      expect(t.blocksLOS).toBe(true);
      expect(t.providesCover).toBe(false);
    });

    it("pillar at (3,2): passable=false, blocksLOS=false, providesCover=true", () => {
      const t = tileQuery(3, 2);
      expect(t.type).toBe("pillar");
      expect(t.passable).toBe(false);
      expect(t.blocksLOS).toBe(false);
      expect(t.providesCover).toBe(true);
    });

    it("pillar at (5,3): same pillar contract", () => {
      const t = tileQuery(5, 3);
      expect(t.type).toBe("pillar");
      expect(t.passable).toBe(false);
      expect(t.blocksLOS).toBe(false);
      expect(t.providesCover).toBe(true);
    });

    it("interior non-pillar tile is floor", () => {
      const t = tileQuery(2, 2);
      expect(t.type).toBe("floor");
      expect(t.passable).toBe(true);
    });

    it("out-of-bounds tiles return void", () => {
      expect(tileQuery(-1,  0).type).toBe("void");
      expect(tileQuery( 0, -1).type).toBe("void");
      expect(tileQuery( 8,  3).type).toBe("void");
      expect(tileQuery( 3,  6).type).toBe("void");
    });

    it("void tiles have correct TileInfo (passable=false, blocksLOS=true)", () => {
      const t = tileQuery(-1, 0);
      expect(t.passable).toBe(false);
      expect(t.blocksLOS).toBe(true);
      expect(t.providesCover).toBe(false);
    });
  });

  describe("trainingYard map (no pillars)", () => {
    const tileQuery = mapDefToTileQuery(yardMap);

    it("entrance is floor", () => {
      expect(tileQuery(0, 3).type).toBe("floor");
    });

    it("border tiles are walls", () => {
      expect(tileQuery(0, 0).type).toBe("wall");
      expect(tileQuery(7, 5).type).toBe("wall");
    });

    it("interior tiles are floor", () => {
      for (let wx = 1; wx <= 6; wx++) {
        for (let wy = 1; wy <= 4; wy++) {
          expect(tileQuery(wx, wy).type).toBe("floor");
        }
      }
    });

    it("no tile returns pillar (map has no pillars)", () => {
      for (let wx = 0; wx < yardMap.width; wx++) {
        for (let wy = 0; wy < yardMap.height; wy++) {
          expect(tileQuery(wx, wy).type).not.toBe("pillar");
        }
      }
    });
  });

  describe("grandHall map (16 pillars at 8-tile intervals)", () => {
    const hallMap = MAP_DEFS.grandHall;
    const tileQuery = mapDefToTileQuery(hallMap);

    it("known pillar positions return pillar", () => {
      const expectedPillars = [
        [8, 8], [8, 16], [8, 24], [8, 32],
        [16, 8], [16, 16], [16, 24], [16, 32],
      ];
      for (const [wx, wy] of expectedPillars) {
        const t = tileQuery(wx, wy);
        expect(t.type).toBe("pillar");
      }
    });

    it("entrance at (0, 20) is floor", () => {
      expect(tileQuery(0, 20).type).toBe("floor");
    });

    it("large map border tiles are walls", () => {
      expect(tileQuery(0, 0).type).toBe("wall");
      expect(tileQuery(39, 20).type).toBe("wall");
      expect(tileQuery(20, 0).type).toBe("wall");
      expect(tileQuery(20, 39).type).toBe("wall");
    });
  });

  it("Set-based lookup is consistent with repeated calls (pure function)", () => {
    // The returned function must be a pure snapshot — same inputs same outputs.
    const tileQuery = mapDefToTileQuery(cryptMap);
    const results1 = [
      tileQuery(0, 3),   // entrance
      tileQuery(3, 2),   // pillar
      tileQuery(0, 0),   // wall
      tileQuery(-1, 0),  // void
      tileQuery(2, 2),   // floor
    ];
    const results2 = [
      tileQuery(0, 3),
      tileQuery(3, 2),
      tileQuery(0, 0),
      tileQuery(-1, 0),
      tileQuery(2, 2),
    ];
    expect(results1).toEqual(results2);
  });
});

// ---------------------------------------------------------------------------
// 14. ChunkStore — async streaming (Phase F increment 2)
// ---------------------------------------------------------------------------

// Helper: build a fake ChunkGeneratorFn whose call count can be inspected.
function makeCounting(
  base: typeof generateChunk = generateChunk,
): { fn: ChunkGeneratorFn; calls: number[] } {
  const record: number[] = [];
  return {
    fn: (cx, cy, worldSeed, version?) => {
      record.push(cx * 1000 + cy); // cheap fingerprint for which chunk was generated
      return base(cx, cy, worldSeed, version);
    },
    calls: record,
  };
}

// Helper: create a generator that always throws.
function failingGenerator(): ChunkGeneratorFn {
  return () => { throw new Error("Simulated generation failure"); };
}

// Helper: create a generator that fails N times then succeeds.
function failNTimes(n: number): ChunkGeneratorFn {
  let remaining = n;
  return (cx, cy, worldSeed, version?) => {
    if (remaining-- > 0) throw new Error("Simulated failure");
    return generateChunk(cx, cy, worldSeed, version);
  };
}

describe("ChunkStore — async streaming (ensureResident)", () => {
  const worldSeed = 55555;

  // ── LOADING state lifecycle ──────────────────────────────────────────────

  it("residency is LOADING after ensureResident() returns but before await", async () => {
    const store = new ChunkStore();
    const promise = store.ensureResident(0, 0, worldSeed);
    // Before the microtask queue drains, the chunk must be LOADING.
    expect(store.residency(0, 0)).toBe("LOADING");
    await promise;
    // After settling, it is RESIDENT.
    expect(store.residency(0, 0)).toBe("RESIDENT");
  });

  it("UNLOADED → LOADING → RESIDENT full lifecycle via ensureResident()", async () => {
    const store = new ChunkStore();
    expect(store.residency(0, 0)).toBe("UNLOADED");

    const p = store.ensureResident(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("LOADING");

    await p;
    expect(store.residency(0, 0)).toBe("RESIDENT");
    expect(store.getGeometry(0, 0)).toBeDefined();
  });

  it("geometry is deterministic: ensureResident produces same tiles as generateChunk directly", async () => {
    const store = new ChunkStore();
    await store.ensureResident(3, 7, worldSeed);
    const asyncGeo = store.getGeometry(3, 7)!;
    const directGeo = generateChunk(3, 7, worldSeed, 0);

    expect(asyncGeo.cx).toBe(directGeo.cx);
    expect(asyncGeo.cy).toBe(directGeo.cy);
    expect(asyncGeo.tiles.size).toBe(directGeo.tiles.size);
    for (const [k, v] of directGeo.tiles) {
      expect(asyncGeo.tiles.get(k)).toEqual(v);
    }
  });

  it("ensureResident is a no-op when chunk is already RESIDENT", async () => {
    const { fn, calls } = makeCounting();
    const store = new ChunkStore(fn);
    await store.ensureResident(0, 0, worldSeed); // first load
    const lenAfterFirst = calls.length;
    await store.ensureResident(0, 0, worldSeed); // should be no-op
    expect(calls.length).toBe(lenAfterFirst);    // no additional generation
    expect(store.residency(0, 0)).toBe("RESIDENT");
  });

  it("ensureResident is a no-op when chunk is PINNED", async () => {
    const { fn, calls } = makeCounting();
    const store = new ChunkStore(fn);
    await store.ensureResident(0, 0, worldSeed);
    store.pin(0, 0);
    const lenAfterPin = calls.length;
    await store.ensureResident(0, 0, worldSeed); // no-op
    expect(calls.length).toBe(lenAfterPin);
    expect(store.residency(0, 0)).toBe("PINNED");
  });

  // ── Concurrent-load deduplication ────────────────────────────────────────

  it("concurrent ensureResident() for the same chunk shares one generation", async () => {
    const { fn, calls } = makeCounting();
    const store = new ChunkStore(fn);

    // Launch both calls before either has settled.
    const p1 = store.ensureResident(0, 0, worldSeed);
    const p2 = store.ensureResident(0, 0, worldSeed); // must deduplicate

    // They must be the same Promise object.
    expect(p1).toBe(p2);

    await Promise.all([p1, p2]);

    // Only one generation call was made.
    expect(calls.filter(c => c === 0 * 1000 + 0).length).toBe(1);
    expect(store.residency(0, 0)).toBe("RESIDENT");
  });

  it("concurrent ensureResident() for DIFFERENT chunks are independent", async () => {
    const { fn, calls } = makeCounting();
    const store = new ChunkStore(fn);

    const p1 = store.ensureResident(0, 0, worldSeed);
    const p2 = store.ensureResident(1, 0, worldSeed);
    const p3 = store.ensureResident(0, 1, worldSeed);

    // All three are distinct Promises.
    expect(p1).not.toBe(p2);
    expect(p1).not.toBe(p3);
    expect(p2).not.toBe(p3);

    await Promise.all([p1, p2, p3]);

    // Each chunk generated independently — three calls.
    expect(calls.length).toBe(3);
    expect(store.residency(0, 0)).toBe("RESIDENT");
    expect(store.residency(1, 0)).toBe("RESIDENT");
    expect(store.residency(0, 1)).toBe("RESIDENT");
  });

  it("three concurrent calls to ensureResident for same chunk still only one generation", async () => {
    const { fn, calls } = makeCounting();
    const store = new ChunkStore(fn);

    const p1 = store.ensureResident(5, 5, worldSeed);
    const p2 = store.ensureResident(5, 5, worldSeed);
    const p3 = store.ensureResident(5, 5, worldSeed);

    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    await Promise.all([p1, p2, p3]);
    expect(calls.length).toBe(1);
  });

  // ── Failure handling ──────────────────────────────────────────────────────

  it("LOADING → UNLOADED on generation failure", async () => {
    const store = new ChunkStore(failingGenerator());

    const promise = store.ensureResident(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("LOADING");

    await expect(promise).rejects.toThrow("Simulated generation failure");

    // After failure: chunk is UNLOADED (no entry, no inflight).
    expect(store.residency(0, 0)).toBe("UNLOADED");
    expect(store.getGeometry(0, 0)).toBeUndefined();
  });

  it("failed load does not expose partial geometry", async () => {
    const store = new ChunkStore(failingGenerator());
    await expect(store.ensureResident(0, 0, worldSeed)).rejects.toThrow();
    expect(store.getGeometry(0, 0)).toBeUndefined();
  });

  it("retry after failure: a subsequent ensureResident() succeeds", async () => {
    // Fail twice, then succeed.
    const store = new ChunkStore(failNTimes(2));

    await expect(store.ensureResident(0, 0, worldSeed)).rejects.toThrow();
    expect(store.residency(0, 0)).toBe("UNLOADED");

    await expect(store.ensureResident(0, 0, worldSeed)).rejects.toThrow();
    expect(store.residency(0, 0)).toBe("UNLOADED");

    // Third attempt: failNTimes counter is exhausted → succeeds.
    await store.ensureResident(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("RESIDENT");
    expect(store.getGeometry(0, 0)).toBeDefined();
  });

  it("concurrent callers both see the failure when load fails", async () => {
    const store = new ChunkStore(failingGenerator());

    const p1 = store.ensureResident(0, 0, worldSeed);
    const p2 = store.ensureResident(0, 0, worldSeed); // same promise

    const results = await Promise.allSettled([p1, p2]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    expect(store.residency(0, 0)).toBe("UNLOADED");
  });

  // ── Eviction safety ───────────────────────────────────────────────────────

  it("evict() returns false for a LOADING chunk (cannot evict)", async () => {
    const store = new ChunkStore();
    const promise = store.ensureResident(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("LOADING");

    const result = store.evict(0, 0);
    expect(result).toBe(false);
    expect(store.residency(0, 0)).toBe("LOADING"); // still loading

    await promise;
    expect(store.residency(0, 0)).toBe("RESIDENT");
  });

  it("chunk that was blocked from eviction (LOADING) can be evicted after RESIDENT", async () => {
    const store = new ChunkStore();
    const promise = store.ensureResident(0, 0, worldSeed);
    store.evict(0, 0); // blocked — returns false, no effect
    await promise;

    // Now RESIDENT — eviction succeeds.
    expect(store.evict(0, 0)).toBe(true);
    expect(store.residency(0, 0)).toBe("UNLOADED");
  });

  // ── ensureResidentAndPin (atomic load + pin) ──────────────────────────────

  it("ensureResidentAndPin: chunk is PINNED after awaiting", async () => {
    const store = new ChunkStore();
    await store.ensureResidentAndPin(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("PINNED");
    expect(store.getGeometry(0, 0)).toBeDefined();
  });

  it("ensureResidentAndPin: PINNED chunk cannot be evicted", async () => {
    const store = new ChunkStore();
    await store.ensureResidentAndPin(2, 3, worldSeed);
    expect(store.evict(2, 3)).toBe(false);
    expect(store.residency(2, 3)).toBe("PINNED");
  });

  it("ensureResidentAndPin on already-RESIDENT chunk: upgrades to PINNED", async () => {
    const { fn, calls } = makeCounting();
    const store = new ChunkStore(fn);
    await store.ensureResident(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("RESIDENT");
    const lenBefore = calls.length;

    // ensureResidentAndPin on an already-resident chunk: no re-generation.
    await store.ensureResidentAndPin(0, 0, worldSeed);
    expect(calls.length).toBe(lenBefore); // no additional generation
    expect(store.residency(0, 0)).toBe("PINNED");
  });

  it("ensureResidentAndPin on already-PINNED chunk: stays PINNED, no re-generation", async () => {
    const { fn, calls } = makeCounting();
    const store = new ChunkStore(fn);
    await store.ensureResidentAndPin(0, 0, worldSeed);
    const lenAfterFirst = calls.length;
    await store.ensureResidentAndPin(0, 0, worldSeed);
    expect(calls.length).toBe(lenAfterFirst);
    expect(store.residency(0, 0)).toBe("PINNED");
  });

  it("ensureResidentAndPin: pin/load race cannot produce an evictable state", async () => {
    // Verify that between ensureResident resolving and pin() being called,
    // no eviction window exists (JS single-threaded guarantee).
    // We prove this structurally: ensureResidentAndPin() calls pin()
    // synchronously in the same continuation after await. No other code can
    // interleave because JS has no preemption.
    const store = new ChunkStore();
    const p = store.ensureResidentAndPin(0, 0, worldSeed);

    // While loading: cannot evict (LOADING).
    expect(store.evict(0, 0)).toBe(false);

    await p;
    // After settling: PINNED — still cannot evict.
    expect(store.evict(0, 0)).toBe(false);
    expect(store.residency(0, 0)).toBe("PINNED");
  });

  it("ensureResidentAndPin: throws if generation fails, chunk stays UNLOADED", async () => {
    const store = new ChunkStore(failingGenerator());
    await expect(store.ensureResidentAndPin(0, 0, worldSeed)).rejects.toThrow();
    expect(store.residency(0, 0)).toBe("UNLOADED");
  });

  // ── createSnapshot safety ─────────────────────────────────────────────────

  it("createSnapshot throws for a LOADING chunk", async () => {
    const store = new ChunkStore();
    const promise = store.ensureResident(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("LOADING");

    expect(() =>
      store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }]),
    ).toThrow(/LOADING/);

    await promise; // let it settle
  });

  it("createSnapshot succeeds after LOADING → RESIDENT transition", async () => {
    const store = new ChunkStore();
    await store.ensureResident(0, 0, worldSeed);
    // No throw now.
    const snap = store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }]);
    expect(snap.chunks.has("0,0")).toBe(true);
  });

  it("createSnapshot via ensureResidentAndPin: safe to call immediately after", async () => {
    const store = new ChunkStore();
    await store.ensureResidentAndPin(0, 0, worldSeed);
    const snap = store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }]);
    const tileQuery = snapshotToTileQuery(snap);
    // All tile queries on the snapshotted chunk return non-void results.
    expect(tileQuery(0, 0).type).not.toBe("void");
  });

  // ── Snapshot stability after async events ────────────────────────────────

  it("snapshot TileQuery is stable after a subsequent async load of another chunk", async () => {
    const store = new ChunkStore();
    await store.ensureResident(0, 0, worldSeed);
    const snap = store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }]);
    const tileQuery = snapshotToTileQuery(snap);
    const tileBefore = tileQuery(0, 0);

    // Load another chunk asynchronously.
    await store.ensureResident(1, 0, worldSeed);
    await store.ensureResident(0, 1, worldSeed);

    // Snapshot is unaffected.
    expect(tileQuery(0, 0)).toEqual(tileBefore);
  });

  it("snapshot TileQuery is stable after async eviction attempt of a snapshotted chunk", async () => {
    const store = new ChunkStore();
    await store.ensureResident(0, 0, worldSeed);
    const snap = store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }]);
    const tileQuery = snapshotToTileQuery(snap);
    const tileBefore = tileQuery(0, 0);

    // Evict the chunk from the live store.
    store.evict(0, 0);
    expect(store.residency(0, 0)).toBe("UNLOADED");

    // Start a new async load (different generation cycle) for the same chunk.
    await store.ensureResident(0, 0, worldSeed);

    // The original snapshot is untouched.
    expect(tileQuery(0, 0)).toEqual(tileBefore);
  });

  it("snapshot TileQuery returns void for chunks not in the snapshot, even if they load later", async () => {
    const store = new ChunkStore();
    await store.ensureResident(0, 0, worldSeed);
    const snap = store.createSnapshot("w1", worldSeed, [{ cx: 0, cy: 0 }]);
    const tileQuery = snapshotToTileQuery(snap);

    // Chunk (1,0) not in snapshot — void.
    expect(tileQuery(16, 0).type).toBe("void");

    // Load it later — snapshot still returns void for that chunk.
    await store.ensureResident(1, 0, worldSeed);
    expect(tileQuery(16, 0).type).toBe("void");
  });

  it("pin/unpin/re-pin cycle with ensureResident", async () => {
    const store = new ChunkStore();
    await store.ensureResident(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("RESIDENT");

    store.pin(0, 0);
    expect(store.residency(0, 0)).toBe("PINNED");
    expect(store.evict(0, 0)).toBe(false);

    store.unpin(0, 0);
    expect(store.residency(0, 0)).toBe("RESIDENT");

    store.pin(0, 0);
    expect(store.residency(0, 0)).toBe("PINNED");

    store.unpin(0, 0);
    expect(store.evict(0, 0)).toBe(true);
    expect(store.residency(0, 0)).toBe("UNLOADED");
  });

  // ── Determinism: load order does not affect geometry ─────────────────────

  it("async load order does not affect generated geometry", async () => {
    const storeAB = new ChunkStore();
    await storeAB.ensureResident(0, 0, worldSeed); // load A first
    await storeAB.ensureResident(1, 0, worldSeed); // then B
    const geoA_AB = storeAB.getGeometry(0, 0)!;
    const geoB_AB = storeAB.getGeometry(1, 0)!;

    const storeBA = new ChunkStore();
    await storeBA.ensureResident(1, 0, worldSeed); // load B first
    await storeBA.ensureResident(0, 0, worldSeed); // then A
    const geoA_BA = storeBA.getGeometry(0, 0)!;
    const geoB_BA = storeBA.getGeometry(1, 0)!;

    // Chunk A geometry is the same regardless of load order.
    expect(geoA_AB.tiles.size).toBe(geoA_BA.tiles.size);
    for (const [k, v] of geoA_AB.tiles) {
      expect(geoA_BA.tiles.get(k)).toEqual(v);
    }
    // Chunk B geometry is the same regardless of load order.
    expect(geoB_AB.tiles.size).toBe(geoB_BA.tiles.size);
    for (const [k, v] of geoB_AB.tiles) {
      expect(geoB_BA.tiles.get(k)).toEqual(v);
    }
  });

  it("concurrent async loads of different chunks produce deterministic geometry", async () => {
    // Concurrent loads via Promise.all.
    const storeConc = new ChunkStore();
    await Promise.all([
      storeConc.ensureResident(0, 0, worldSeed),
      storeConc.ensureResident(1, 0, worldSeed),
      storeConc.ensureResident(0, 1, worldSeed),
    ]);

    // Sequential loads.
    const storeSeq = new ChunkStore();
    await storeSeq.ensureResident(0, 0, worldSeed);
    await storeSeq.ensureResident(1, 0, worldSeed);
    await storeSeq.ensureResident(0, 1, worldSeed);

    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1]]) {
      const concGeo = storeConc.getGeometry(cx, cy)!;
      const seqGeo  = storeSeq.getGeometry(cx, cy)!;
      expect(concGeo.tiles.size).toBe(seqGeo.tiles.size);
      for (const [k, v] of seqGeo.tiles) {
        expect(concGeo.tiles.get(k)).toEqual(v);
      }
    }
  });

  // ── RNG isolation ─────────────────────────────────────────────────────────

  it("async ensureResident() does not alter an external gameplay RNG sequence", async () => {
    const seed = 98765;

    // Draw N values from gameplay RNG A, then do async loads, then draw more.
    const rngA = mulberry32(seed);
    const beforeA = Array.from({ length: 15 }, () => rngA());

    await Promise.all([
      new ChunkStore().ensureResident( 0,  0, seed),
      new ChunkStore().ensureResident(-1,  5, seed),
      new ChunkStore().ensureResident(10, 20, seed),
    ]);

    const afterA = Array.from({ length: 10 }, () => rngA());

    // Reference: same seed, same counts, no chunk loading.
    const rngB = mulberry32(seed);
    const beforeB = Array.from({ length: 15 }, () => rngB());
    const afterB  = Array.from({ length: 10 }, () => rngB());

    expect(beforeA).toEqual(beforeB);
    expect(afterA).toEqual(afterB);
  });

  it("async ensureResidentAndPin() does not alter an external gameplay RNG sequence", async () => {
    const seed = 11111;
    const rngA = mulberry32(seed);
    const v1 = rngA();

    const store = new ChunkStore();
    await store.ensureResidentAndPin(7, 3, seed);

    const v2 = rngA();

    const rngRef = mulberry32(seed);
    rngRef(); // v1
    const expectedV2 = rngRef();

    expect(v2).toBe(expectedV2);
  });

  // ── load() backward compat with inflight ──────────────────────────────────

  it("synchronous load() is a no-op when chunk is LOADING", async () => {
    const { fn, calls } = makeCounting();
    const store = new ChunkStore(fn);

    const promise = store.ensureResident(0, 0, worldSeed);
    expect(store.residency(0, 0)).toBe("LOADING");

    // Synchronous load() should not duplicate the work.
    store.load(0, 0, worldSeed);
    expect(calls.filter(c => c === 0).length).toBe(0); // ensureResident hasn't run yet
    expect(store.residency(0, 0)).toBe("LOADING");

    await promise;
    // load() did not add a second entry — still RESIDENT with one geometry.
    expect(store.residency(0, 0)).toBe("RESIDENT");
  });

  it("synchronous load() still works independently of ensureResident()", async () => {
    const { fn, calls } = makeCounting();
    const store = new ChunkStore(fn);

    // load() for chunk A (sync), ensureResident for chunk B (async).
    store.load(0, 0, worldSeed);
    const p = store.ensureResident(1, 0, worldSeed);

    expect(store.residency(0, 0)).toBe("RESIDENT"); // already done
    expect(store.residency(1, 0)).toBe("LOADING");  // in-flight

    await p;
    expect(store.residency(1, 0)).toBe("RESIDENT");
    expect(calls.length).toBe(2); // one for each chunk
  });
});
