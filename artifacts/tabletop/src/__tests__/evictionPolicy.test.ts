// ---------------------------------------------------------------------------
// Phase 3 Milestone M2 — Chunk eviction policy + entity survival.
//
// Proves the missing chunk-lifecycle behavior:
//   • distance-based eviction with PREFETCH_MARGIN + 1 hysteresis (Chebyshev)
//   • PINNED / LOADING immunity
//   • geometry regenerates deterministically after eviction
//   • entities in WorldEntityRegistry survive eviction untouched
//   • encounter pinning protects encounter chunks from viewport movement
//   • resident set stays bounded after eviction settles
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  ChunkStore,
  generateChunk,
  chunkKey,
  type ChunkGeometryData,
} from "../engine/chunk";
import {
  EVICTION_THRESHOLD_CHUNKS,
  chunkDistanceToRect,
  getVisibleChunkRect,
  selectChunksToEvict,
  evictDistantChunks,
} from "../engine/evictionPolicy";
import { PREFETCH_MARGIN, getChunksForViewport } from "../engine/viewportStreaming";
import type { ViewportState } from "../engine/viewport";
import { WorldState } from "../engine/world";
import {
  createExplorationSession,
  explorationTileInfo,
  EXPLORE_SPAWN,
  HOSTILE_SPAWN,
} from "../engine/exploration";

const SEED = 12345;

/** 12×10 viewport with its origin at world (wx, wy). */
function vp(wx: number, wy: number): ViewportState {
  return { originWx: wx, originWy: wy, tileW: 12, tileH: 10 };
}

/** Serializable geometry fingerprint (sorted sparse tiles). */
function geometryHash(g: ChunkGeometryData): string {
  return [...g.tiles.entries()].map(([k, t]) => `${k}:${t.type}`).sort().join("|");
}

/** Loads every chunk in the list synchronously as RESIDENT. */
function loadAll(store: ChunkStore, coords: { cx: number; cy: number }[]) {
  for (const { cx, cy } of coords) store.load(cx, cy, SEED);
}

describe("M2 eviction policy — threshold & geometry", () => {
  it("uses the canonical hysteresis threshold PREFETCH_MARGIN + 1", () => {
    expect(EVICTION_THRESHOLD_CHUNKS).toBe(PREFETCH_MARGIN + 1);
  });

  it("computes Chebyshev distance to the visible chunk rect", () => {
    const rect = getVisibleChunkRect(vp(0, 0)); // wx 0..11, wy 0..9 → chunk (0,0)
    expect(rect).toEqual({ minCx: 0, maxCx: 0, minCy: 0, maxCy: 0 });
    expect(chunkDistanceToRect(0, 0, rect)).toBe(0);
    expect(chunkDistanceToRect(1, 0, rect)).toBe(1);
    expect(chunkDistanceToRect(-2, 1, rect)).toBe(2);
    expect(chunkDistanceToRect(3, -3, rect)).toBe(3);
  });

  it("spanning viewports produce multi-chunk rects (negative coords included)", () => {
    const rect = getVisibleChunkRect(vp(-5, 12)); // wx -5..6 → cx -1..0; wy 12..21 → cy 0..1
    expect(rect).toEqual({ minCx: -1, maxCx: 0, minCy: 0, maxCy: 1 });
  });
});

describe("M2 eviction selection", () => {
  it("retains near + prefetch-margin chunks, selects only distant RESIDENT chunks", () => {
    const held = [
      { cx: 0, cy: 0, residency: "RESIDENT" as const },  // visible — keep
      { cx: 1, cy: 1, residency: "RESIDENT" as const },  // margin (d=1) — keep
      { cx: 2, cy: 0, residency: "RESIDENT" as const },  // hysteresis (d=2) — keep
      { cx: 3, cy: 0, residency: "RESIDENT" as const },  // d=3 — evict
      { cx: -4, cy: -4, residency: "RESIDENT" as const }, // d=4 — evict
    ];
    expect(selectChunksToEvict(held, vp(0, 0))).toEqual([
      { cx: 3, cy: 0 },
      { cx: -4, cy: -4 },
    ]);
  });

  it("PINNED chunks are immune regardless of distance", () => {
    const held = [
      { cx: 9, cy: 9, residency: "PINNED" as const },
      { cx: 9, cy: 8, residency: "RESIDENT" as const },
    ];
    expect(selectChunksToEvict(held, vp(0, 0))).toEqual([{ cx: 9, cy: 8 }]);
  });

  it("LOADING chunks are immune (never enumerated; evict() also refuses them)", async () => {
    const store = new ChunkStore();
    const p = store.ensureResident(9, 9, SEED); // LOADING until awaited
    expect(store.residency(9, 9)).toBe("LOADING");
    // Not a candidate: listChunks() only holds RESIDENT/PINNED geometry.
    expect(store.listChunks()).toEqual([]);
    // Direct evict during LOADING is refused by the store.
    expect(store.evict(9, 9)).toBe(false);
    await p;
    expect(store.residency(9, 9)).toBe("RESIDENT");
  });

  it("already-unloaded chunks are ignored and selection is deterministic", () => {
    const held = [
      { cx: 8, cy: 0, residency: "RESIDENT" as const },
      { cx: 0, cy: 8, residency: "RESIDENT" as const },
    ];
    const a = selectChunksToEvict(held, vp(0, 0));
    const b = selectChunksToEvict(held, vp(0, 0));
    expect(a).toEqual(b); // pure + order-preserving
    expect(a).toEqual([{ cx: 8, cy: 0 }, { cx: 0, cy: 8 }]);
    // Executing against a store where those chunks are UNLOADED: nothing held,
    // nothing evicted, no error.
    const store = new ChunkStore();
    expect(evictDistantChunks(store, vp(0, 0))).toEqual([]);
  });

  it("evictDistantChunks removes distant RESIDENT chunks from a live store", () => {
    const store = new ChunkStore();
    loadAll(store, [
      { cx: 0, cy: 0 }, { cx: 1, cy: 0 }, { cx: 2, cy: 0 },
      { cx: 5, cy: 5 }, { cx: 0, cy: 7 },
    ]);
    const evicted = evictDistantChunks(store, vp(0, 0));
    expect(evicted).toEqual([{ cx: 5, cy: 5 }, { cx: 0, cy: 7 }]);
    expect(store.residency(5, 5)).toBe("UNLOADED");
    expect(store.residency(0, 7)).toBe("UNLOADED");
    expect(store.residency(0, 0)).toBe("RESIDENT");
    expect(store.residency(1, 0)).toBe("RESIDENT");
    expect(store.residency(2, 0)).toBe("RESIDENT");
  });
});

describe("M2 deterministic regeneration after eviction", () => {
  it("evicted chunk regenerates equivalent geometry when re-resident", async () => {
    const store = new ChunkStore();
    store.load(7, 3, SEED);
    const before = geometryHash(store.getGeometry(7, 3)!);
    expect(store.evict(7, 3)).toBe(true);
    expect(store.residency(7, 3)).toBe("UNLOADED");
    expect(store.getGeometry(7, 3)).toBeUndefined();

    await store.ensureResident(7, 3, SEED);
    const after = geometryHash(store.getGeometry(7, 3)!);
    expect(after).toBe(before);
    // And matches a fresh isolated generation from the same tuple.
    expect(geometryHash(generateChunk(7, 3, SEED))).toBe(before);
  });

  it("regeneration is independent of eviction order and interleaved loads", async () => {
    const a = new ChunkStore();
    const b = new ChunkStore();
    a.load(2, 2, SEED);
    // Store b generates other chunks first, in a different order.
    b.load(9, 9, SEED);
    b.load(2, 3, SEED);
    b.load(2, 2, SEED);
    const hashA = geometryHash(a.getGeometry(2, 2)!);
    expect(geometryHash(b.getGeometry(2, 2)!)).toBe(hashA);
    // Evict from b, thrash some other loads, re-resident: still identical.
    b.evict(2, 2);
    b.load(0, 0, SEED);
    await b.ensureResident(2, 2, SEED);
    expect(geometryHash(b.getGeometry(2, 2)!)).toBe(hashA);
  });
});

describe("M2 entity survival across eviction", () => {
  it("entities in WorldEntityRegistry are untouched by chunk eviction", async () => {
    const ws = new WorldState("survival-world", SEED);
    // Entity lives in chunk (5,5) — world (85, 85).
    ws.entities.register({
      worldId: "goblin_1", defId: "goblin", wx: 85, wy: 85,
      hp: 11, maxHp: 12, alive: true, state: { grudge: "party" },
    });
    ws.chunkStore.load(5, 5, SEED);
    const geomBefore = geometryHash(ws.chunkStore.getGeometry(5, 5)!);

    // Viewport far away — chunk (5,5) is evicted.
    const evicted = evictDistantChunks(ws.chunkStore, vp(0, 0));
    expect(evicted).toEqual([{ cx: 5, cy: 5 }]);
    expect(ws.chunkStore.residency(5, 5)).toBe("UNLOADED");

    // Entity survives with identical identity and authoritative state.
    const e = ws.entities.get("goblin_1")!;
    expect(e).toBeDefined();
    expect(e.wx).toBe(85);
    expect(e.wy).toBe(85);
    expect(e.hp).toBe(11);
    expect(e.alive).toBe(true);
    expect(e.state).toEqual({ grudge: "party" });

    // Authoritative mutations while the chunk is evicted work normally.
    ws.entities.setHp("goblin_1", 7);
    ws.entities.move("goblin_1", 86, 85);

    // Re-resident the chunk: geometry regenerates identically; the registry
    // supplies the (updated) authoritative entity state — no reset, no clone.
    await ws.chunkStore.ensureResident(5, 5, SEED);
    expect(geometryHash(ws.chunkStore.getGeometry(5, 5)!)).toBe(geomBefore);
    const same = ws.entities.get("goblin_1")!;
    expect(same).toBe(e); // exact same registry object — identity preserved
    expect(same.hp).toBe(7);
    expect(same.wx).toBe(86);
    expect(ws.entities.getAll().filter((x) => x.worldId === "goblin_1")).toHaveLength(1);
  });
});

describe("M2 encounter pinning protection", () => {
  it("viewport movement never evicts encounter-pinned chunks; endEncounter releases them", async () => {
    const ws = new WorldState("pin-world", SEED);
    const orc = {
      worldId: "orc_1", defId: "orc", wx: 85, wy: 85,
      hp: 15, maxHp: 15, alive: true, state: {},
    };
    ws.entities.register(orc);
    const prepared = await ws.beginEncounter([orc]);
    // Pin set = 3×3 around chunk (5,5), all PINNED.
    for (const { cx, cy } of prepared.pinnedChunks) {
      expect(ws.chunkStore.residency(cx, cy)).toBe("PINNED");
    }

    // Viewport far away: eviction policy runs, pinned chunks all survive.
    const evicted = evictDistantChunks(ws.chunkStore, vp(0, 0));
    expect(evicted).toEqual([]);
    for (const { cx, cy } of prepared.pinnedChunks) {
      expect(ws.chunkStore.residency(cx, cy)).toBe("PINNED");
    }
    // The encounter snapshot remains valid even if unrelated chunks are evicted.
    ws.chunkStore.load(9, 0, SEED);
    evictDistantChunks(ws.chunkStore, vp(0, 0));
    expect(prepared.snapshot.chunks.get(chunkKey(5, 5))).toBeDefined();

    // endEncounter releases pins via the existing mechanism → now evictable.
    const fakeGameState = { combatants: {} } as never;
    ws.endEncounter(fakeGameState, prepared.pinnedChunks);
    const evictedAfter = evictDistantChunks(ws.chunkStore, vp(0, 0));
    expect(evictedAfter.length).toBe(prepared.pinnedChunks.length);
  });
});

describe("M2 completion-gate E2E fixture anchor", () => {
  // Mirrors WALK_PATH in e2e/eviction.spec.ts. If deterministic generation
  // ever changes, this test fails FIRST with a clear message instead of the
  // E2E timing out on a blocked tile.
  const WALK_PATH: [number, number][] = [
    [9, 7], [10, 8], [11, 9], [12, 10], [13, 11], [14, 12], [15, 13], [16, 14],
    [17, 15], [18, 16], [19, 17], [20, 18], [21, 19], [22, 20], [23, 21],
    [24, 22], [25, 23], [26, 24], [27, 25], [28, 26], [29, 27], [30, 28],
    [30, 29], [31, 30], [32, 31], [33, 32], [34, 33], [35, 34], [36, 35],
    [37, 36], [38, 37], [39, 38], [40, 39], [41, 40], [42, 41], [42, 42],
    [43, 43], [44, 44], [45, 45], [46, 46], [47, 47], [48, 48], [49, 49],
    [50, 50], [51, 51], [52, 52], [53, 53], [54, 54], [55, 55], [56, 56],
    [57, 57], [58, 58],
  ];

  it("the E2E walk path is entirely passable, Chebyshev-contiguous, and hostile-free", () => {
    const session = createExplorationSession();
    for (let cx = 0; cx < 4; cx++) {
      for (let cy = 0; cy < 4; cy++) session.worldState.chunkStore.load(cx, cy, session.worldState.seed);
    }
    let prev: [number, number] = [EXPLORE_SPAWN.wx, EXPLORE_SPAWN.wy];
    for (const [wx, wy] of WALK_PATH) {
      expect(Math.max(Math.abs(wx - prev[0]), Math.abs(wy - prev[1])), `step ${prev} -> ${wx},${wy}`).toBe(1);
      expect(explorationTileInfo(session, wx, wy).passable, `tile (${wx}, ${wy}) must be floor`).toBe(true);
      expect(wx === HOSTILE_SPAWN.wx && wy === HOSTILE_SPAWN.wy, `path must not cross the hostile at (${wx}, ${wy})`).toBe(false);
      prev = [wx, wy];
    }
    expect(prev).toEqual([58, 58]);
  });
});

describe("M2 resident set bound & no thrash", () => {
  it("after prefetch + eviction settle, resident set is bounded by the hysteresis ring plus pins", async () => {
    const store = new ChunkStore();
    // Simulate a long eastward exploration: viewport slides across 10 chunks,
    // prefetching at each step, evicting after each settle.
    for (let step = 0; step < 10; step++) {
      const viewport = vp(step * 16, 0);
      await Promise.all(
        getChunksForViewport(viewport, PREFETCH_MARGIN).map(({ cx, cy }) =>
          store.ensureResident(cx, cy, SEED),
        ),
      );
      evictDistantChunks(store, viewport);
    }
    const finalViewport = vp(9 * 16, 0);
    const rect = getVisibleChunkRect(finalViewport);
    const held = store.listChunks();
    // Every held chunk is within the eviction threshold (nothing unbounded).
    for (const { cx, cy } of held) {
      expect(chunkDistanceToRect(cx, cy, rect)).toBeLessThanOrEqual(EVICTION_THRESHOLD_CHUNKS);
    }
    // Hard numeric bound: (rect + threshold ring) chunk count.
    const w = rect.maxCx - rect.minCx + 1 + 2 * EVICTION_THRESHOLD_CHUNKS;
    const h = rect.maxCy - rect.minCy + 1 + 2 * EVICTION_THRESHOLD_CHUNKS;
    expect(held.length).toBeLessThanOrEqual(w * h);
    expect(held.length).toBeGreaterThan(0);
  });

  it("oscillating across a chunk boundary does not load/evict-thrash", async () => {
    let generations = 0;
    const store = new ChunkStore((cx, cy, seed, v) => {
      generations++;
      return generateChunk(cx, cy, seed, v);
    });
    // Oscillate the viewport by one chunk repeatedly.
    for (let i = 0; i < 6; i++) {
      const viewport = vp(i % 2 === 0 ? 0 : 16, 0);
      await Promise.all(
        getChunksForViewport(viewport, PREFETCH_MARGIN).map(({ cx, cy }) =>
          store.ensureResident(cx, cy, SEED),
        ),
      );
      evictDistantChunks(store, viewport);
    }
    const settled = generations;
    // Two more full oscillations: hysteresis keeps every needed chunk resident,
    // so ZERO additional generations occur.
    for (let i = 0; i < 4; i++) {
      const viewport = vp(i % 2 === 0 ? 0 : 16, 0);
      await Promise.all(
        getChunksForViewport(viewport, PREFETCH_MARGIN).map(({ cx, cy }) =>
          store.ensureResident(cx, cy, SEED),
        ),
      );
      evictDistantChunks(store, viewport);
    }
    expect(generations).toBe(settled);
  });
});
