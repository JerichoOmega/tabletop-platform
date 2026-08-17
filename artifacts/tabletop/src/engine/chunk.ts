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
  return (wx: number, wy: number): TileInfo => {
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
 * LOADING  — async generation/fetch in progress (future increment).
 *            Treat as UNLOADED for rules purposes until RESIDENT.
 * RESIDENT — geometry available in memory; can be evicted by the cache policy.
 * PINNED   — contains an active encounter participant; MUST NOT be evicted
 *            while the encounter is active. Applied by buildEncounter(),
 *            removed by endEncounter() (spec §11.3, Decision 24).
 */
export type ChunkResidency = "UNLOADED" | "LOADING" | "RESIDENT" | "PINNED";

/** Internal store entry — only exists for RESIDENT or PINNED chunks. */
interface ChunkEntry {
  geometry: ChunkGeometryData;
  residency: "RESIDENT" | "PINNED";
  dirty: boolean;
}

/**
 * In-memory chunk residency store.
 *
 * Owns the live mutable lifecycle state (residency, dirty flag, eviction
 * eligibility) for all loaded chunks.
 *
 * ARCHITECTURAL INVARIANT (Decision 27):
 *   ChunkStore is owned exclusively by WorldState (future Phase G).
 *   GameState NEVER receives a live ChunkStore reference.
 *   The only path from ChunkStore into GameState is:
 *
 *     store.createSnapshot() → snapshotToTileQuery() → GameState.tileQuery
 *
 *   The snapshot is a set of frozen geometry references — stable even if the
 *   live store subsequently loads, evicts, or re-generates chunks.
 *
 * Phase F foundation: synchronous only.
 *   load() generates terrain synchronously and immediately marks the chunk
 *   RESIDENT. The LOADING state is reserved for the future async increment.
 */
export class ChunkStore {
  private readonly entries = new Map<string, ChunkEntry>();

  /**
   * Returns the current residency of a chunk.
   * Returns "UNLOADED" for chunks that have never been loaded or were evicted.
   */
  residency(cx: number, cy: number): ChunkResidency {
    return this.entries.get(chunkKey(cx, cy))?.residency ?? "UNLOADED";
  }

  /**
   * Synchronously generates and loads a chunk, marking it RESIDENT.
   *
   * No-op if the chunk is already RESIDENT or PINNED — the existing geometry
   * is preserved. Call evict() first if a fresh generation is needed.
   *
   * Phase F foundation: synchronous. Future async increment will introduce
   * LOADING state and async generation/fetch.
   */
  load(cx: number, cy: number, worldSeed: number, generationVersion = 0): void {
    const k = chunkKey(cx, cy);
    if (this.entries.has(k)) return;  // already RESIDENT or PINNED — preserve it
    const geometry = generateChunk(cx, cy, worldSeed, generationVersion);
    this.entries.set(k, { geometry, residency: "RESIDENT", dirty: false });
  }

  /**
   * Pins a RESIDENT chunk, protecting it from eviction.
   *
   * PINNED chunks contain active encounter participants and MUST NOT be
   * evicted for any reason while the encounter is active (Decision 24).
   *
   * Throws if the chunk is not currently loaded (RESIDENT or PINNED).
   * Callers (buildEncounter) must load chunks before pinning.
   */
  pin(cx: number, cy: number): void {
    const k = chunkKey(cx, cy);
    const entry = this.entries.get(k);
    if (!entry) {
      throw new Error(
        `ChunkStore.pin(${cx}, ${cy}): chunk is not loaded. Call load() first.`,
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
   * Evicts a RESIDENT chunk, freeing its memory.
   *
   * Returns true  — chunk was evicted (or was already UNLOADED).
   * Returns false — chunk is PINNED and MUST NOT be evicted.
   *
   * Callers must handle false gracefully; do not retry until after unpin().
   * DIRTY chunks should be persisted before eviction (future Phase G).
   */
  evict(cx: number, cy: number): boolean {
    const k = chunkKey(cx, cy);
    const entry = this.entries.get(k);
    if (!entry) return true;                   // already UNLOADED — success
    if (entry.residency === "PINNED") return false; // protected — cannot evict
    this.entries.delete(k);
    return true;
  }

  /**
   * Returns the geometry for a RESIDENT or PINNED chunk, or undefined.
   * Does not trigger loading. Returns undefined for UNLOADED chunks.
   */
  getGeometry(cx: number, cy: number): ChunkGeometryData | undefined {
    return this.entries.get(chunkKey(cx, cy))?.geometry;
  }

  /**
   * Creates an immutable ResidentGeometrySnapshot from a set of loaded chunks.
   *
   * The snapshot stores direct references to the chunk geometry objects.
   * Since ChunkGeometryData is frozen at creation, the snapshot is stable:
   *   • store.load() for new chunks does not affect existing geometry refs.
   *   • store.evict() removes the ChunkEntry from the store, but the snapshot
   *     still holds the geometry reference — JS GC keeps it alive.
   *   • store.unpin() / store.pin() change only residency; geometry is unchanged.
   *
   * Throws if any requested chunk is not currently RESIDENT or PINNED.
   *
   * @param worldId  World identifier (stored as snapshot metadata).
   * @param seed     World seed (stored as snapshot metadata).
   * @param coords   Chunks to include. ALL must be loaded.
   */
  createSnapshot(
    worldId: string,
    seed: number,
    coords: { cx: number; cy: number }[],
  ): ResidentGeometrySnapshot {
    const chunks = new Map<string, ChunkGeometryData>();
    for (const { cx, cy } of coords) {
      const k = chunkKey(cx, cy);
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
    };
  }
}
