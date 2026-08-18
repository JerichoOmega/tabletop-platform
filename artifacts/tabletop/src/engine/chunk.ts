// ---------------------------------------------------------------------------
// CHUNK — Phase F: Chunk/Region Streaming Foundation.
//
// This module is the Phase F data and mathematics foundation. It establishes:
//
//   1. Chunk coordinate mathematics (world ↔ chunk/local)
//   2. ChunkGeometryData — immutable tile geometry for one 16×16 chunk
//   3. Deterministic chunk generation with an isolated RNG stream
//   4. ResidentGeometrySnapshot — immutable barrier between async ChunkStore
//      and the synchronous rules engine
//   5. snapshotToTileQuery() — produces a TileQueryFn from a snapshot
//   6. ChunkStore — in-memory residency lifecycle (UNLOADED / RESIDENT / PINNED)
//
// ARCHITECTURAL INVARIANTS (spec §11.8, §11.9, Decisions 21–28):
//
//   • CHUNK_W = CHUNK_H = 16. Square chunks, power of 2. Architectural constant.
//   • Chunk coordinate math uses Math.floor ONLY. JavaScript % is PROHIBITED
//     for local-coordinate calculation — it returns negative results for
//     negative wx, giving wrong local coordinates.
//   • ResidentGeometrySnapshot contains only immutable copies — no mutable
//     references back into ChunkStore. Stable even after store.load(),
//     store.evict(), or store.unpin() on any chunk.
//   • GameState NEVER receives a live ChunkStore reference.
//     The only path from ChunkStore into GameState is:
//       store.createSnapshot() → snapshotToTileQuery() → GameState.tileQuery
//   • Generation RNG is completely isolated from gameplay RNG.
//     generateChunk() creates a fresh mulberry32 from a per-chunk seed;
//     it never reads from or writes to any external RNG stream.
//
// Dependency: content.ts (TileInfo, TileQueryFn, mulberry32).
// ---------------------------------------------------------------------------

import type { TileInfo, TileQueryFn } from "./content";
import { mulberry32 } from "./content";
// Type-only import: worldBounds.ts imports CHUNK_W/H from this module at
// runtime, so this must stay `import type` to avoid a runtime cycle.
import type { WorldBounds } from "./worldBounds";

// ---------------------------------------------------------------------------
// CHUNK DIMENSION CONSTANTS (Decision 21)
// ---------------------------------------------------------------------------

/** Tiles per chunk on the x-axis. Architectural constant — see Decision 21. */
export const CHUNK_W = 16;

/** Tiles per chunk on the y-axis. Square chunks: CHUNK_H === CHUNK_W. */
export const CHUNK_H = 16;

// ---------------------------------------------------------------------------
// COORDINATE MATHEMATICS (Decision 22)
//
// All conversions use Math.floor. DO NOT use % for local-coordinate
// computation — JavaScript % returns negative values for negative wx:
//
//   -1 % 16  ===  -1    ← WRONG (gives a negative local coordinate)
//
// The correct formula for local x is:  lx = wx - Math.floor(wx/CHUNK_W)*CHUNK_W
// which is always in [0, CHUNK_W). The helpers below encapsulate this.
// ---------------------------------------------------------------------------

/**
 * Decomposes a world x-coordinate into (chunk cx, local lx).
 *
 *   cx = Math.floor(wx / CHUNK_W)    — always correct for any integer wx
 *   lx = wx - cx * CHUNK_W           — always in [0, CHUNK_W)
 *
 * Examples:
 *   wx =  0  → cx=0,  lx=0
 *   wx = 15  → cx=0,  lx=15
 *   wx = 16  → cx=1,  lx=0
 *   wx = -1  → cx=-1, lx=15
 *   wx = -16 → cx=-1, lx=0
 *   wx = -17 → cx=-2, lx=15
 */
export function wxToChunk(wx: number): { cx: number; lx: number } {
  const cx = Math.floor(wx / CHUNK_W);
  const lx = wx - cx * CHUNK_W;
  return { cx, lx };
}

/**
 * Reconstructs a world x-coordinate from (chunk cx, local lx).
 * Inverse of wxToChunk: chunkToWx(wxToChunk(wx).cx, wxToChunk(wx).lx) === wx.
 */
export function chunkToWx(cx: number, lx: number): number {
  return cx * CHUNK_W + lx;
}

/**
 * Decomposes a world y-coordinate into (chunk cy, local ly).
 * Mirrors wxToChunk; see its documentation for the negative-coordinate rules.
 */
export function wyToChunk(wy: number): { cy: number; ly: number } {
  const cy = Math.floor(wy / CHUNK_H);
  const ly = wy - cy * CHUNK_H;
  return { cy, ly };
}

/**
 * Reconstructs a world y-coordinate from (chunk cy, local ly).
 * Inverse of wyToChunk.
 */
export function chunkToWy(cy: number, ly: number): number {
  return cy * CHUNK_H + ly;
}

/**
 * Fully decomposes a world coordinate (wx, wy) into its chunk and local parts.
 *
 * Combines wxToChunk + wyToChunk for callers that need all four values.
 * Chunk coordinate is derived from world position; it is NEVER stored on entities.
 */
export function worldToChunkCoord(
  wx: number,
  wy: number,
): { cx: number; cy: number; lx: number; ly: number } {
  const { cx, lx } = wxToChunk(wx);
  const { cy, ly } = wyToChunk(wy);
  return { cx, cy, lx, ly };
}

// ---------------------------------------------------------------------------
// COORDINATE KEY FUNCTIONS
// ---------------------------------------------------------------------------

/**
 * Deterministic string key for a chunk coordinate.
 * Handles negative chunk coords correctly (e.g. "-1,2", "-2,-1").
 *
 * Uniqueness guarantee: for all distinct integer pairs (cx1,cy1) and (cx2,cy2),
 * chunkKey(cx1,cy1) !== chunkKey(cx2,cy2).
 * Proof: integers serialized with comma separator; no ambiguity possible
 * because `${integer}` always produces a sign-and-digits string.
 */
export function chunkKey(cx: number, cy: number): string {
  return cx + "," + cy;
}

/**
 * Deterministic string key for a local tile within a chunk.
 * Local coordinates are always in [0, CHUNK_W) × [0, CHUNK_H), so they are
 * always non-negative. The format mirrors the existing worldKey convention.
 */
export function localKey(lx: number, ly: number): string {
  return lx + "," + ly;
}

// ---------------------------------------------------------------------------
// CANONICAL TILE INFO CONSTANTS (frozen singletons)
// ---------------------------------------------------------------------------

const VOID_TILE = Object.freeze<TileInfo>({
  passable: false, blocksLOS: true, providesCover: false, type: "void",
});

const FLOOR_TILE = Object.freeze<TileInfo>({
  passable: true, blocksLOS: false, providesCover: false, type: "floor",
});

const PILLAR_TILE = Object.freeze<TileInfo>({
  passable: false, blocksLOS: false, providesCover: true, type: "pillar",
});

// ---------------------------------------------------------------------------
// CHUNK GEOMETRY DATA — immutable after generation (Decision 23)
// ---------------------------------------------------------------------------

/**
 * Immutable tile geometry for a single CHUNK_W × CHUNK_H chunk.
 *
 * Storage is sparse: only non-floor tiles are stored in `tiles`.
 * Any local coordinate absent from the map is an implicit floor tile.
 * ReadonlyMap ensures no code outside generateChunk() can call `.set()`.
 *
 * Created by generateChunk(). Never mutated after creation.
 * May be shared safely across snapshot boundaries via reference.
 */
export interface ChunkGeometryData {
  /** Chunk x-index. */
  readonly cx: number;
  /** Chunk y-index. */
  readonly cy: number;
  /**
   * Sparse tile storage. Key: localKey(lx, ly).
   * Absent entries are implicitly FLOOR_TILE.
   * Stored entries are non-floor tiles (pillars, walls, etc.).
   */
  readonly tiles: ReadonlyMap<string, Readonly<TileInfo>>;
}

// ---------------------------------------------------------------------------
// RESIDENT GEOMETRY SNAPSHOT (Decision 23, spec §11.8)
// ---------------------------------------------------------------------------

/**
 * Immutable barrier between the async ChunkStore and the synchronous rules engine.
 *
 * Created once at buildEncounter() from the PINNED chunk set.
 * Contains direct references to immutable ChunkGeometryData objects.
 * Never holds live ChunkStore references.
 *
 * STABILITY GUARANTEE:
 *   The snapshot remains valid and unchanged after any of the following
 *   live-store operations:
 *     • store.load()   — adds new entries; does not affect existing chunk refs
 *     • store.evict()  — removes an entry; JS GC keeps geometry alive via snapshot
 *     • store.unpin()  — changes residency only; geometry object is unchanged
 *     • store.pin()    — changes residency only; geometry object is unchanged
 *
 * The rules engine only ever sees a TileQueryFn produced by snapshotToTileQuery().
 * It never holds a snapshot reference directly.
 */
export interface ResidentGeometrySnapshot {
  /** Chunks included in this snapshot. Key: chunkKey(cx, cy). */
  readonly chunks: ReadonlyMap<string, ChunkGeometryData>;
  /** The world identifier this snapshot was created for. */
  readonly worldId: string;
  /** The world seed. */
  readonly seed: number;
  /**
   * Authoritative playable-world bounds at snapshot time (M4), if the world
   * is bounded. snapshotToTileQuery() returns VOID for tiles outside them,
   * so encounter geometry can never imply terrain beyond the world edge —
   * even when a pinned boundary chunk extends past it.
   */
  readonly bounds?: WorldBounds;
}

// ---------------------------------------------------------------------------
// SNAPSHOT → TILE QUERY (Decision 26)
// ---------------------------------------------------------------------------

/**
 * Produces a pure, synchronous TileQueryFn from an immutable snapshot.
 *
 * The returned function:
 *   • is synchronous and pure (same inputs always produce same outputs)
 *   • closes only over immutable snapshot data — never live ChunkStore state
 *   • never awaits, never inspects viewport state, never consumes RNG
 *   • returns in O(1) per query (two Map lookups)
 *
 * Query logic:
 *   1. Compute (cx, cy) and (lx, ly) from (wx, wy).
 *   2. Look up chunk in snapshot.chunks by chunkKey(cx, cy).
 *      → Chunk absent: return VOID_TILE (safe impassable default).
 *   3. Look up tile in chunk.tiles by localKey(lx, ly).
 *      → Key absent: return FLOOR_TILE (implicit default for sparse storage).
 *      → Key present: return stored TileInfo.
 *
 * A VOID_TILE result for a tile occupied by an encounter participant is an
 * invariant violation (see Decision 26). It indicates buildEncounter() failed
 * to snapshot that participant's chunk. In production: log and return void
 * (do not crash). In tests: this state should never be reached.
 */
export function snapshotToTileQuery(snapshot: ResidentGeometrySnapshot): TileQueryFn {
  const bounds = snapshot.bounds;
  return (wx: number, wy: number): TileInfo => {
    // M4: tiles outside the playable world are VOID, regardless of whether a
    // boundary chunk happens to carry generated geometry past the edge.
    if (bounds && (wx < bounds.minWx || wx > bounds.maxWx || wy < bounds.minWy || wy > bounds.maxWy)) {
      return VOID_TILE;
    }
    // Inline the floor division (identical to wxToChunk/wyToChunk) to avoid
    // object allocation on every hot-path tile query call.
    const cx = Math.floor(wx / CHUNK_W);
    const cy = Math.floor(wy / CHUNK_H);
    const chunk = snapshot.chunks.get(chunkKey(cx, cy));
    if (!chunk) return VOID_TILE;
    const lx = wx - cx * CHUNK_W;
    const ly = wy - cy * CHUNK_H;
    return chunk.tiles.get(localKey(lx, ly)) ?? FLOOR_TILE;
  };
}

// ---------------------------------------------------------------------------
// DETERMINISTIC CHUNK GENERATION (Decision 28)
// ---------------------------------------------------------------------------

/**
 * Mixes four 32-bit integers into a single uint32 seed for the generation RNG.
 *
 * Used to derive an isolated per-chunk seed from (worldSeed, cx, cy, version).
 * Based on Wang-hash mixing: XOR → multiply → XOR-shift, repeated per input.
 * Produces well-distributed outputs; same inputs always produce same output.
 *
 * All intermediate values are kept in uint32 range via >>> 0 / Math.imul.
 */
function hashForSeed(a: number, b: number, c: number, d: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x85ebca6b)) >>> 0;
  h = (h ^ (b ^ 0x9e3779b9)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0xc2b2ae35)) >>> 0;
  h = (h ^ (c ^ 0x9e3779b9)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x85ebca6b)) >>> 0;
  h = (h ^ (d ^ 0x9e3779b9)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0xc2b2ae35)) >>> 0;
  return h;
}

/**
 * Generates immutable tile geometry for a single CHUNK_W × CHUNK_H chunk.
 *
 * DETERMINISM: same (cx, cy, worldSeed, generationVersion) ALWAYS produces
 * identical geometry. Order of generation calls is irrelevant:
 *   generate(A); generate(B); generate(A)  ===  generate(A)  (for the A result)
 *
 * RNG ISOLATION (Decision 28):
 *   A private mulberry32 instance is created, seeded from:
 *     hashForSeed(worldSeed, cx, cy, generationVersion)
 *   This RNG is NEVER shared with combat, initiative, enemy-AI, or proposal RNGs.
 *   Calling generateChunk() cannot alter any external RNG stream.
 *
 * Terrain model (foundation):
 *   ~5% of tiles are randomly pillars (obstacles that block movement, grant cover).
 *   All other tiles are floor (implicitly — not stored in the sparse map).
 *   This provides enough non-floor tiles for determinism tests without impeding
 *   traversal. Future increments will extend with walls, corridors, rooms, etc.
 *
 * @param cx                   Chunk x-index (from worldToChunkCoord).
 * @param cy                   Chunk y-index.
 * @param worldSeed            World-level seed (shared across all chunks).
 * @param generationVersion    Version for world format upgrades (default 0).
 *                             Bumping this value re-generates ALL terrain.
 */
export function generateChunk(
  cx: number,
  cy: number,
  worldSeed: number,
  generationVersion = 0,
): ChunkGeometryData {
  const seed = hashForSeed(worldSeed, cx, cy, generationVersion);
  // Fresh isolated RNG — never shared with any external caller.
  const rng = mulberry32(seed);

  const tiles = new Map<string, Readonly<TileInfo>>();
  for (let ly = 0; ly < CHUNK_H; ly++) {
    for (let lx = 0; lx < CHUNK_W; lx++) {
      // ~5% pillar probability. Floor tiles are not stored (implicit default).
      if (rng() < 0.05) {
        tiles.set(localKey(lx, ly), PILLAR_TILE);
      }
    }
  }

  // Freeze the top-level object; the ReadonlyMap type prevents .set() at the
  // type level. Together these prevent post-construction mutation.
  return Object.freeze({
    cx,
    cy,
    tiles: tiles as ReadonlyMap<string, Readonly<TileInfo>>,
  }) as ChunkGeometryData;
}

// ---------------------------------------------------------------------------
// CHUNK RESIDENCY LIFECYCLE (Decision 24, spec §11.3)
// ---------------------------------------------------------------------------

/**
 * Residency state for a chunk in the ChunkStore.
 *
 * UNLOADED — no data in memory; tile queries for this chunk return void.
 * LOADING  — async generation/fetch is in progress. The chunk will become
 *            RESIDENT on success or return to UNLOADED on failure.
 *            Treat as void for rules purposes (no geometry available yet).
 * RESIDENT — geometry is available; can be evicted by the cache policy.
 * PINNED   — contains an active encounter participant; MUST NOT be evicted
 *            while the encounter is active. Applied by buildEncounter(),
 *            removed by endEncounter() (spec §11.3, Decision 24).
 */
export type ChunkResidency = "UNLOADED" | "LOADING" | "RESIDENT" | "PINNED";

/**
 * Type for chunk geometry generators.
 *
 * Matches generateChunk(). The ChunkStore constructor accepts an alternative
 * implementation so tests can inject mock generators (e.g. ones that throw)
 * without touching production code paths.
 */
export type ChunkGeneratorFn = (
  cx: number,
  cy: number,
  worldSeed: number,
  generationVersion?: number,
) => ChunkGeometryData;

/** Internal store entry — only exists for RESIDENT or PINNED chunks. */
interface ChunkEntry {
  geometry: ChunkGeometryData;
  residency: "RESIDENT" | "PINNED";
  dirty: boolean;
}

/**
 * In-memory chunk residency store with asynchronous loading support.
 *
 * Owns the live mutable lifecycle state for all chunks: residency, in-flight
 * loads, dirty flags, and eviction eligibility.
 *
 * ─── State machine ────────────────────────────────────────────────────────
 *
 *   UNLOADED ──ensureResident()──▶ LOADING ──success──▶ RESIDENT
 *                                                │
 *                                             failure
 *                                                │
 *                                             UNLOADED   (retry is safe)
 *
 *   RESIDENT ──pin()──▶ PINNED ──unpin()──▶ RESIDENT ──evict()──▶ UNLOADED
 *
 *   load()   is a synchronous shortcut: UNLOADED → RESIDENT (no LOADING phase)
 *
 * ─── Concurrency model ────────────────────────────────────────────────────
 *
 *   JavaScript is single-threaded; only one synchronous segment runs at a
 *   time. Async operations introduce interleaving ONLY at `await` boundaries.
 *
 *   Concurrent ensureResident() calls for the SAME chunk share one in-flight
 *   Promise — only one generateChunk() call is made regardless of how many
 *   callers await it.
 *
 *   Concurrent ensureResident() calls for DIFFERENT chunks are independent
 *   and may interleave freely.
 *
 * ─── Architectural invariant (Decision 27) ────────────────────────────────
 *
 *   ChunkStore is owned exclusively by WorldState (future Phase G).
 *   GameState NEVER receives a live ChunkStore reference.
 *   The only path from ChunkStore into GameState is:
 *
 *     store.createSnapshot() → snapshotToTileQuery() → GameState.tileQuery
 *
 *   The snapshot holds frozen geometry references that are stable regardless
 *   of subsequent live-store mutations.
 */
export class ChunkStore {
  /** RESIDENT and PINNED chunks with their geometry. */
  private readonly entries = new Map<string, ChunkEntry>();

  /**
   * In-flight async loads.
   * A key is present iff the chunk is currently LOADING.
   * The Promise resolves when the chunk becomes RESIDENT, or rejects on failure.
   */
  private readonly inflight = new Map<string, Promise<void>>();

  /** The geometry generation function. Injected for testability. */
  private readonly generate: ChunkGeneratorFn;

  constructor(generateFn: ChunkGeneratorFn = generateChunk) {
    this.generate = generateFn;
  }

  // ── Inspection ────────────────────────────────────────────────────────────

  /**
   * Returns the current residency of a chunk.
   * Priority: LOADING (inflight) > RESIDENT/PINNED (entries) > UNLOADED.
   */
  residency(cx: number, cy: number): ChunkResidency {
    const k = chunkKey(cx, cy);
    if (this.inflight.has(k)) return "LOADING";
    return this.entries.get(k)?.residency ?? "UNLOADED";
  }

  /**
   * Returns the geometry for a RESIDENT or PINNED chunk, or undefined.
   * Does not trigger loading. Returns undefined for UNLOADED and LOADING chunks.
   */
  getGeometry(cx: number, cy: number): ChunkGeometryData | undefined {
    return this.entries.get(chunkKey(cx, cy))?.geometry;
  }

  // ── Synchronous loading (backward-compatible shortcut) ─────────────────

  /**
   * Synchronously generates and loads a chunk, marking it RESIDENT.
   *
   * No-op if the chunk is already RESIDENT, PINNED, or LOADING.
   * Call evict() first if a fresh synchronous generation is required.
   *
   * Prefer ensureResident() for new call sites — this method exists for
   * backward compatibility with tests and for encounter-side pre-loading
   * where the caller already knows the chunk is not in flight.
   */
  load(cx: number, cy: number, worldSeed: number, generationVersion = 0): void {
    const k = chunkKey(cx, cy);
    if (this.entries.has(k)) return;   // already RESIDENT or PINNED — preserve
    if (this.inflight.has(k)) return;  // already LOADING — do not duplicate
    const geometry = this.generate(cx, cy, worldSeed, generationVersion);
    this.entries.set(k, { geometry, residency: "RESIDENT", dirty: false });
  }

  // ── Asynchronous loading ──────────────────────────────────────────────────

  /**
   * Asynchronously ensures a chunk is RESIDENT.
   *
   * State transitions:
   *   UNLOADED → LOADING → RESIDENT   (normal path)
   *   UNLOADED → LOADING → UNLOADED   (generation failure — retry is safe)
   *   RESIDENT → (no-op, returns resolved Promise)
   *   PINNED   → (no-op, returns resolved Promise)
   *   LOADING  → deduplicated: returns the SAME in-flight Promise
   *
   * DEDUPLICATION (Promise identity):
   *   This method is a plain function (NOT async). An `async` method always
   *   wraps its return value in a fresh Promise, which would break identity:
   *     p1 = ensureResident(…); p2 = ensureResident(…); p1 !== p2  ← wrong
   *   As a plain function, `return existing` and `return promise` return the
   *   exact Promise object stored in `this.inflight`, so:
   *     p1 = ensureResident(…); p2 = ensureResident(…); p1 === p2  ← correct
   *   Both callers share one in-flight Promise; only one generation runs.
   *
   * LOADING-STATE VISIBILITY:
   *   The async IIFE starts with `await Promise.resolve()` to yield control
   *   back to the caller. This ensures:
   *     1. `this.inflight.set(k, promise)` executes before `generate()` runs.
   *     2. `residency()` returns "LOADING" for the entire generation window.
   *     3. `inflight.delete(k)` in finally correctly targets the entry we set.
   *   Without this yield, the entire IIFE body would run synchronously
   *   (generateChunk is synchronous) inside the Promise constructor, so
   *   `inflight.delete(k)` would fire before `inflight.set(k, promise)`.
   *
   * FAILURE / RETRY:
   *   If generation throws, the Promise rejects and the chunk returns to
   *   UNLOADED. A subsequent ensureResident() call starts a fresh attempt.
   *   Partial geometry is NEVER exposed to consumers.
   *
   * @throws (via rejected Promise) If geometry generation fails. Does NOT
   *   leave the chunk in LOADING state on failure.
   */
  ensureResident(
    cx: number,
    cy: number,
    worldSeed: number,
    generationVersion = 0,
  ): Promise<void> {
    const k = chunkKey(cx, cy);

    // Already RESIDENT or PINNED — return a settled Promise immediately.
    if (this.entries.has(k)) return Promise.resolve();

    // Already LOADING — deduplicate: return the identical in-flight Promise.
    // Both callers will await the same Promise; only one generation runs.
    const existing = this.inflight.get(k);
    if (existing) return existing;

    // UNLOADED → LOADING.
    //
    // `await Promise.resolve()` at the top of the IIFE yields control back
    // to ensureResident() before generate() runs. This guarantees the inflight
    // map is populated (LOADING state visible) for the full generation window.
    const promise = (async () => {
      // Yield: let ensureResident() register this promise in inflight first.
      await Promise.resolve();
      try {
        const geometry = this.generate(cx, cy, worldSeed, generationVersion);
        this.entries.set(k, { geometry, residency: "RESIDENT", dirty: false });
      } finally {
        // On success: removes LOADING entry (chunk is now RESIDENT).
        // On failure: chunk returns to UNLOADED — no entries, no inflight.
        this.inflight.delete(k);
      }
    })();

    this.inflight.set(k, promise);
    return promise;
  }

  /**
   * Asynchronously ensures a chunk is RESIDENT, then immediately pins it.
   *
   * This is the correct API for encounter setup. It eliminates the pin/load
   * race that would exist if the caller called ensureResident() + pin() in
   * two separate statements with other async code allowed to interleave.
   *
   * Race proof:
   *   After `await ensureResident()` resolves, control returns to this
   *   method's continuation. JavaScript's single-threaded model guarantees
   *   that `this.pin(cx, cy)` executes before any other async code can run
   *   — specifically before any eviction could remove the chunk.
   *
   * @throws If the underlying load fails (generation error).
   */
  async ensureResidentAndPin(
    cx: number,
    cy: number,
    worldSeed: number,
    generationVersion = 0,
  ): Promise<void> {
    await this.ensureResident(cx, cy, worldSeed, generationVersion);
    // Synchronous in the same microtask continuation — no eviction can occur
    // between the await resolution and this pin() call.
    this.pin(cx, cy);
  }

  // ── Pinning ──────────────────────────────────────────────────────────────

  /**
   * Pins a RESIDENT chunk, protecting it from eviction.
   *
   * PINNED chunks contain active encounter participants and MUST NOT be
   * evicted while the encounter is active (Decision 24).
   *
   * Throws if the chunk is not RESIDENT or PINNED.
   * Callers must load (or await ensureResident()) before pinning.
   */
  pin(cx: number, cy: number): void {
    const k = chunkKey(cx, cy);
    const entry = this.entries.get(k);
    if (!entry) {
      const state = this.inflight.has(k) ? "LOADING" : "UNLOADED";
      throw new Error(
        `ChunkStore.pin(${cx}, ${cy}): chunk is ${state}. ` +
        `Call load() or await ensureResident() before pinning.`,
      );
    }
    entry.residency = "PINNED";
  }

  /**
   * Unpins a PINNED chunk, returning it to RESIDENT (evictable) status.
   * No-op if the chunk is already RESIDENT or UNLOADED.
   *
   * Called by endEncounter() for all chunks in the encounter pin set.
   */
  unpin(cx: number, cy: number): void {
    const entry = this.entries.get(chunkKey(cx, cy));
    if (entry?.residency === "PINNED") {
      entry.residency = "RESIDENT";
    }
  }

  /**
   * Lists all chunks currently held in memory (RESIDENT or PINNED) with
   * their coordinates and residency. LOADING and UNLOADED chunks are not
   * included (they hold no geometry).
   *
   * Used by the M2 eviction policy to enumerate eviction candidates.
   * Deterministic: iteration follows Map insertion order.
   */
  listChunks(): { cx: number; cy: number; residency: "RESIDENT" | "PINNED" }[] {
    const out: { cx: number; cy: number; residency: "RESIDENT" | "PINNED" }[] = [];
    for (const [k, entry] of this.entries) {
      const [cx, cy] = k.split(",").map(Number);
      out.push({ cx, cy, residency: entry.residency });
    }
    return out;
  }

  // ── Eviction ─────────────────────────────────────────────────────────────

  /**
   * Evicts a RESIDENT chunk, freeing its memory.
   *
   * Returns true  — chunk was evicted (was RESIDENT), or was already UNLOADED.
   * Returns false — chunk is PINNED or LOADING; cannot be evicted.
   *
   * LOADING chunks are protected: cancellation is not implemented. Let the
   * load complete (RESIDENT), then evict normally.
   *
   * Callers must handle false gracefully:
   *   • PINNED: retry after unpin().
   *   • LOADING: retry after the in-flight Promise settles.
   */
  evict(cx: number, cy: number): boolean {
    const k = chunkKey(cx, cy);
    if (this.inflight.has(k)) return false; // LOADING — cannot evict
    const entry = this.entries.get(k);
    if (!entry) return true;                // already UNLOADED — success
    if (entry.residency === "PINNED") return false; // PINNED — cannot evict
    this.entries.delete(k);
    return true;
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  /**
   * Creates an immutable ResidentGeometrySnapshot from a set of loaded chunks.
   *
   * All requested chunks must be RESIDENT or PINNED — not LOADING or UNLOADED.
   * Await ensureResident() or ensureResidentAndPin() before calling this.
   *
   * STABILITY GUARANTEE (unchanged from foundation):
   *   The snapshot holds direct references to frozen ChunkGeometryData objects.
   *   Subsequent store mutations — load(), evict(), pin(), unpin(), new async
   *   loads — cannot change any TileQueryFn derived from this snapshot.
   *
   * @param worldId  World identifier (stored as snapshot metadata).
   * @param seed     World seed (stored as snapshot metadata).
   * @param coords   Chunks to include. ALL must be RESIDENT or PINNED.
   * @param bounds   Optional playable-world bounds (M4) — carried on the
   *                 snapshot so derived tile queries VOID out-of-world tiles.
   * @throws If any chunk is UNLOADED or LOADING.
   */
  createSnapshot(
    worldId: string,
    seed: number,
    coords: { cx: number; cy: number }[],
    bounds?: WorldBounds,
  ): ResidentGeometrySnapshot {
    const chunks = new Map<string, ChunkGeometryData>();
    for (const { cx, cy } of coords) {
      const k = chunkKey(cx, cy);
      if (this.inflight.has(k)) {
        throw new Error(
          `ChunkStore.createSnapshot: chunk (${cx}, ${cy}) is still LOADING. ` +
          `Await ensureResident() or ensureResidentAndPin() before creating a snapshot.`,
        );
      }
      const entry = this.entries.get(k);
      if (!entry) {
        throw new Error(
          `ChunkStore.createSnapshot: chunk (${cx}, ${cy}) is not loaded. ` +
          `Load and pin it before creating a snapshot.`,
        );
      }
      chunks.set(k, entry.geometry);
    }
    return {
      chunks: chunks as ReadonlyMap<string, ChunkGeometryData>,
      worldId,
      seed,
      bounds,
    };
  }
}
