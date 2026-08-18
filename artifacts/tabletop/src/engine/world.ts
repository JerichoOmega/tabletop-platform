// ---------------------------------------------------------------------------
// WORLD — Phase F: WorldState & WorldEntityRegistry Implementation.
//
// This module establishes the persistent-world layer that sits above ChunkStore.
// It implements the authority model specified in §11.9, §12, §14, and §27:
//
//   WorldState
//   ├── ChunkStore       (geometry — per §11.9)
//   └── WorldEntityRegistry  (entity identity/position — per §12.1, §25)
//
// ARCHITECTURAL BOUNDARIES (Decisions 19, 20, 25, 27):
//
//   • WorldState owns the persistent world between encounters.
//   • GameState owns combat-participant state DURING an encounter.
//   • endEncounter() is the ONLY path by which combat results re-enter WorldState.
//   • GameState NEVER receives a live ChunkStore reference.
//   • WorldEntityRegistry NEVER receives a live GameState reference.
//   • Chunk coordinates are derived from wx/wy — never stored on entities.
//
// THREE-LAYER IDENTITY MODEL (Decision 19, §2 in spec):
//
//   Combatant.id       = encounter-local key in GameState.combatants
//   Combatant.defId    = content/template identity (references COMBATANT_DEFS)
//   Combatant.worldId  = persistent-world identity (FK into WorldEntityRegistry)
//
//   For world-backed encounters, Combatant.id === Combatant.worldId (simplest choice,
//   per §14.2 decision). Combatant.id is still distinct in KIND even when equal in VALUE.
//
// Dependencies: content.ts, chunk.ts.
// ---------------------------------------------------------------------------

import type { Combatant, GameState, MapDef } from "./content";
import { createCombatantInstance, rollInitiative, mulberry32 } from "./content";
import {
  ChunkStore,
  snapshotToTileQuery,
  worldToChunkCoord,
  chunkKey,
} from "./chunk";
import type { ChunkGeneratorFn, ResidentGeometrySnapshot } from "./chunk";
import { isInBounds, filterChunksToBounds, type WorldBounds } from "./worldBounds";

// ---------------------------------------------------------------------------
// WORLD ENTITY — persistent identity (spec §12.1)
// ---------------------------------------------------------------------------

/**
 * A persistent entity in the world, with a stable worldId that survives:
 *   • chunk eviction and reload
 *   • viewport movement
 *   • encounter boundaries
 *   • save/load cycles (future Phase G)
 *
 * `worldId` is assigned when the entity is first created and is NEVER changed.
 * It is not derived from position, chunk coordinate, or any mutable runtime value.
 *
 * Fields:
 *   worldId   — immutable permanent ID (e.g. "goblin_crypt_3")
 *   defId     — references COMBATANT_DEFS; determines combat stats and template
 *   wx, wy    — authoritative world coordinates; never derived from chunk
 *   hp        — current hit points; preserved across encounters
 *   maxHp     — maximum hit points; matches COMBATANT_DEFS[defId].maxHp
 *   alive     — persistent alive state; set to false on death, never deleted
 *   state     — open extension bag: doors, chests, traps, etc. (future Phase G)
 */
export interface WorldEntity {
  /** Immutable stable identifier. Never reassigned after creation. */
  readonly worldId: string;
  /** Content template reference. Determines combat stats via COMBATANT_DEFS. */
  defId: string;
  /** Authoritative world x-coordinate. Chunk membership is DERIVED from this. */
  wx: number;
  /** Authoritative world y-coordinate. Chunk membership is DERIVED from this. */
  wy: number;
  /** Current hit points. Persisted across encounters. */
  hp: number;
  /** Maximum hit points. Copied from COMBATANT_DEFS[defId].maxHp at creation. */
  maxHp: number;
  /**
   * Persistent alive state (spec §12.3).
   * Dead entities are NOT deleted — they are preserved as dead (rendered as
   * corpse or omitted by the renderer). See endEncounter() for the commit rule.
   */
  alive: boolean;
  /**
   * Open extension bag for persistent world state: opened doors, looted chests,
   * triggered traps, etc. Rules engine never reads this. Future Phase G will
   * define specific schema for mutation types.
   */
  state: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// WORLD ENTITY REGISTRY — persistent entity collection
// ---------------------------------------------------------------------------

/**
 * Authoritative collection of all persistent WorldEntity objects.
 *
 * OWNERSHIP (Decision 25):
 *   WorldEntityRegistry owns: worldId, wx, wy, hp, alive, state.
 *   ChunkStore owns: tile geometry (terrain), residency.
 *   Entity positions are NEVER duplicated inside chunk records.
 *
 * INVARIANT: worldId is globally unique within a WorldEntityRegistry.
 *   Duplicate registration throws rather than silently overwriting.
 */
export class WorldEntityRegistry {
  private readonly entities = new Map<string, WorldEntity>();

  /**
   * Optional playable-world bounds (M4). When present, register() and move()
   * refuse positions outside the bounds. This is an INVARIANT GUARD, not the
   * primary rejection path — movement layers (exploration.ts movePartyStep,
   * combat tileQuery VOID) must reject boundary crossings first with proper
   * user-facing semantics. Reaching this throw indicates a caller bug.
   */
  private readonly bounds?: WorldBounds;

  constructor(bounds?: WorldBounds) {
    this.bounds = bounds;
  }

  /** Throws if (wx, wy) lies outside the registry's world bounds (if any). */
  private assertInBounds(op: string, worldId: string, wx: number, wy: number): void {
    if (this.bounds && !isInBounds(this.bounds, wx, wy)) {
      throw new Error(
        `WorldEntityRegistry.${op}: entity "${worldId}" position (${wx}, ${wy}) ` +
        `is outside WorldBounds [${this.bounds.minWx}..${this.bounds.maxWx}] × ` +
        `[${this.bounds.minWy}..${this.bounds.maxWy}]. Movement layers must ` +
        `reject out-of-bounds positions before mutating the registry.`,
      );
    }
  }

  /**
   * Registers a new world entity.
   * @throws If an entity with the same worldId has already been registered,
   *         or its position is outside the world bounds (when bounds exist).
   */
  register(entity: WorldEntity): void {
    if (this.entities.has(entity.worldId)) {
      throw new Error(
        `WorldEntityRegistry: duplicate worldId "${entity.worldId}". ` +
        `World IDs must be globally unique within a registry.`,
      );
    }
    this.assertInBounds("register", entity.worldId, entity.wx, entity.wy);
    this.entities.set(entity.worldId, entity);
  }

  /**
   * Returns the entity with the given worldId, or undefined if not registered.
   * Used by rules and encounter code to look up off-screen entities.
   */
  get(worldId: string): WorldEntity | undefined {
    return this.entities.get(worldId);
  }

  /** Returns true iff a entity with the given worldId is registered. */
  has(worldId: string): boolean {
    return this.entities.has(worldId);
  }

  /** Returns a snapshot array of all registered entities (alive and dead). */
  getAll(): WorldEntity[] {
    return [...this.entities.values()];
  }

  /** Returns a snapshot array of all living registered entities. */
  getAlive(): WorldEntity[] {
    return [...this.entities.values()].filter((e) => e.alive);
  }

  /**
   * Updates the world position of an entity.
   *
   * CHUNK DERIVATION RULE (Decision 13, §25):
   *   The chunk coordinate of an entity is ALWAYS derived on-demand from wx/wy.
   *   It is NEVER stored as a separate authoritative field on the entity.
   *
   * After calling move(), the entity's chunk membership is derived by
   * worldToChunkCoord(entity.wx, entity.wy) — it is not cached anywhere.
   *
   * @throws If the entity does not exist.
   */
  move(worldId: string, wx: number, wy: number): void {
    const entity = this.entities.get(worldId);
    if (!entity) {
      throw new Error(
        `WorldEntityRegistry.move: entity "${worldId}" is not registered.`,
      );
    }
    this.assertInBounds("move", worldId, wx, wy);
    entity.wx = wx;
    entity.wy = wy;
  }

  /**
   * Updates an entity's current hit points.
   * @throws If the entity does not exist.
   */
  setHp(worldId: string, hp: number): void {
    const entity = this.entities.get(worldId);
    if (!entity) {
      throw new Error(
        `WorldEntityRegistry.setHp: entity "${worldId}" is not registered.`,
      );
    }
    entity.hp = hp;
  }

  /**
   * Updates an entity's alive state.
   * Dead entities are preserved (alive=false), never deleted.
   * @throws If the entity does not exist.
   */
  setAlive(worldId: string, alive: boolean): void {
    const entity = this.entities.get(worldId);
    if (!entity) {
      throw new Error(
        `WorldEntityRegistry.setAlive: entity "${worldId}" is not registered.`,
      );
    }
    entity.alive = alive;
  }
}

// ---------------------------------------------------------------------------
// ENCOUNTER TYPES — preparation and results
// ---------------------------------------------------------------------------

/**
 * The result of WorldState.beginEncounter().
 *
 * Contains everything needed to:
 *   1. Build a GameState via buildEncounterFromEntities().
 *   2. Pass to WorldState.endEncounter() for post-combat commit and unpin.
 *
 * The snapshot is immutable — safe to pass to the rules engine.
 * The pinnedChunks list is needed by endEncounter() to unpin all chunks.
 */
export interface PreparedEncounter {
  /** Immutable geometry snapshot. Passed to snapshotToTileQuery(). */
  readonly snapshot: ResidentGeometrySnapshot;
  /**
   * Chunks that were pinned for this encounter.
   * Passed back to WorldState.endEncounter() for cleanup.
   */
  readonly pinnedChunks: readonly { cx: number; cy: number }[];
  /**
   * The world entities participating in this encounter.
   * Snapshot of participant references at beginEncounter() time.
   */
  readonly participants: readonly WorldEntity[];
}

// ---------------------------------------------------------------------------
// COORDINATE UTILITY — pin set computation
// ---------------------------------------------------------------------------

/**
 * Computes the set of chunks that must be PINNED for an encounter.
 *
 * The pin set includes all chunks containing participant positions, plus a
 * 1-chunk margin in all 8 directions. This conservative margin ensures:
 *   • Participants can reach adjacent tiles without hitting void geometry.
 *   • LOS calculations near chunk boundaries have complete terrain data.
 *   • Combatants at the edge of a chunk can see/reach the next chunk.
 *
 * Per spec §11.10 (Pin set coverage invariant):
 *   "The pin set must be generous enough (e.g. add a 1-chunk margin beyond
 *   all participant positions) to avoid snapshot misses."
 *
 * Decision 13 / §25: Chunk coordinate is derived from wx/wy; never stored.
 * This function derives chunk membership fresh from participant world positions.
 */
export function computePinSet(
  participants: readonly WorldEntity[],
  bounds?: WorldBounds,
): { cx: number; cy: number }[] {
  const seen = new Set<string>();
  const result: { cx: number; cy: number }[] = [];

  for (const entity of participants) {
    const { cx, cy } = worldToChunkCoord(entity.wx, entity.wy);
    // 1-chunk margin: 3×3 neighborhood centered on the participant's chunk.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const mcx = cx + dx;
        const mcy = cy + dy;
        const k = chunkKey(mcx, mcy);
        if (!seen.has(k)) {
          seen.add(k);
          result.push({ cx: mcx, cy: mcy });
        }
      }
    }
  }
  // M4: never pin (and therefore never generate) chunks entirely outside the
  // playable world. Chunks partially intersecting the boundary are kept —
  // their out-of-bounds tiles read VOID via snapshotToTileQuery.
  return filterChunksToBounds(result, bounds);
}

// ---------------------------------------------------------------------------
// ENTITY → COMBATANT CONVERSION (spec §14.2)
// ---------------------------------------------------------------------------

/**
 * Converts a WorldEntity to an encounter-local Combatant.
 *
 * Three-layer identity mapping (Decision 19, spec §14.2):
 *
 *   Combatant.id      = entity.worldId   (encounter key; equals worldId for world-backed)
 *   Combatant.worldId = entity.worldId   (persistent FK — preserved unchanged)
 *   Combatant.defId   = entity.defId     (content template — unchanged)
 *   Combatant.wx      = entity.wx        (world position — copied)
 *   Combatant.wy      = entity.wy        (world position — copied)
 *   Combatant.hp      = entity.hp        (persistent HP — NOT reset to maxHp)
 *   Combatant.alive   = entity.alive     (persistent alive state — NOT reset)
 *
 * Combat-local fields are initialized fresh per encounter:
 *   actionUsed = false, moveRemaining = def.moveMax
 *
 * Why id === worldId for world-backed entities (spec §14.2 decision):
 *   "Use worldId as id for world-backed entities" — simplest mapping that
 *   preserves the constraint that id is unique within a GameState.combatants
 *   record (worldIds are globally unique, so they are also encounter-unique).
 *
 * @throws If entity.defId is not found in COMBATANT_DEFS.
 */
export function worldEntityToCombatant(entity: WorldEntity): Combatant {
  // createCombatantInstance looks up COMBATANT_DEFS[defId] and populates
  // all stat fields (ac, atkMod, dexMod, moveMax, weapon, etc.).
  // It sets hp=maxHp and alive=true — we override these below.
  const base = createCombatantInstance(
    entity.defId,
    entity.worldId, // encounter-local id = worldId (spec §14.2 decision)
    entity.wx,
    entity.wy,
  );

  // Override with persistent state. An injured entity enters with hp < maxHp.
  // A dead entity (alive=false) should not be passed to buildEncounterFromEntities,
  // but if it is, the alive flag is preserved faithfully.
  return {
    ...base,
    worldId: entity.worldId, // persistent FK — never undefined for world-backed entities
    hp: entity.hp,
    alive: entity.alive,
  };
}

// ---------------------------------------------------------------------------
// ENCOUNTER BUILDER — world entities → GameState
// ---------------------------------------------------------------------------

/**
 * Minimum synthetic MapDef for world-backed encounters.
 *
 * GameState.map is retained for metadata and backward compatibility.
 * For world-backed encounters it is not used by the rules engine — the engine
 * reads only state.tileQuery (snapshotToTileQuery from the PreparedEncounter).
 *
 * Width=0, height=0: any tile query on this MapDef returns void. This is
 * intentional — the rules engine must NEVER fall through to the map-based
 * tileQuery for world-backed encounters.
 */
function makeSyntheticMap(worldId: string, encounterName: string): MapDef {
  return {
    id: worldId,
    name: encounterName,
    width: 0,
    height: 0,
    entrance: { x: 0, y: 0 },
    pillars: [],
  };
}

/**
 * Builds a GameState from a PreparedEncounter.
 *
 * This is the world-backed equivalent of buildEncounter() — it takes a
 * PreparedEncounter (with its immutable snapshot) instead of an EncounterDef.
 *
 * AUTHORITY BOUNDARY (Decision 20):
 *   After this function returns, GameState is the sole authority for
 *   combat-participant state. WorldEntityRegistry is frozen for those entities
 *   until endEncounter() is called.
 *
 * @param prepared    From WorldState.beginEncounter().
 * @param worldId     The WorldState's worldId (used for synthetic map metadata).
 * @param seed        RNG seed for initiative rolls.
 * @param encounterId Logical identifier for this encounter (used in GameState.encounterId).
 * @param encounterName Human-readable encounter name for logs and UI.
 */
export function buildEncounterFromEntities(
  prepared: PreparedEncounter,
  worldId: string,
  seed: number,
  encounterId = "world-encounter",
  encounterName = "World Encounter",
): GameState {
  const { snapshot, participants } = prepared;

  // Build the synchronous TileQueryFn from the immutable snapshot.
  // This is the only geometry path into GameState for world-backed encounters.
  const tileQuery = snapshotToTileQuery(snapshot);

  // Convert WorldEntity → Combatant. Each retains its worldId.
  const combatants: Record<string, Combatant> = {};
  for (const entity of participants) {
    const combatant = worldEntityToCombatant(entity);
    combatants[combatant.id] = combatant;
  }

  // Roll initiative — this is the only RNG usage in encounter construction.
  const rng = mulberry32(seed);
  const initiative = rollInitiative(combatants, rng);

  return {
    started: true,
    encounterId,
    encounterName,
    map: makeSyntheticMap(worldId, encounterName),
    tileQuery,
    round: 1,
    turnOrder: initiative.map((i) => i.id),
    initiativeRolls: initiative,
    turnIndex: 0,
    combatants,
    log: [
      `The encounter begins.`,
      "Initiative: " +
        initiative.map((i) => `${combatants[i.id].name} (${i.total})`).join(", "),
      `— Round 1 —`,
    ],
    seed,
  };
}

// ---------------------------------------------------------------------------
// WORLD STATE — top-level persistent world authority
// ---------------------------------------------------------------------------

/**
 * The persistent-world authority layer.
 *
 * Owns:
 *   • ChunkStore  — resident chunk geometry, residency lifecycle, pin state
 *   • WorldEntityRegistry — all persistent entities with their worldIds and positions
 *
 * Does NOT own (and must not contain):
 *   • Turn order, initiative, action economy → GameState
 *   • Viewport state → ViewportState
 *   • React state → IntelligentTabletop.tsx
 *   • Combat RNG → GameState construction
 *
 * LIFECYCLE:
 *   1. Create WorldState.
 *   2. Register WorldEntity objects via worldState.entities.register().
 *   3. Call worldState.beginEncounter(participants) → PreparedEncounter.
 *   4. Call buildEncounterFromEntities(prepared, ...) → GameState.
 *   5. Run combat in GameState (rules engine is synchronous).
 *   6. Call worldState.endEncounter(gameState, prepared.pinnedChunks).
 *   7. WorldState reflects committed results; GameState is discarded.
 *
 * AUTHORITY BOUNDARY (Decision 20, §27 Authority invariant):
 *   WorldEntityRegistry is frozen for combat participants between steps 3 and 6.
 *   The only write path back to WorldEntityRegistry during combat is endEncounter().
 */
export class WorldState {
  /** Globally stable identifier for this world (e.g. "dungeon-01"). */
  readonly worldId: string;

  /** World-level seed for deterministic chunk generation. */
  readonly seed: number;

  /**
   * Chunk geometry store. Owned exclusively by this WorldState.
   * GameState never receives a live ChunkStore reference (Decision 27).
   */
  readonly chunkStore: ChunkStore;

  /**
   * Persistent entity registry. Owns worldId, wx, wy, hp, alive for all entities.
   * ChunkStore owns terrain geometry only (Decision 25).
   */
  readonly entities: WorldEntityRegistry;

  /**
   * Authoritative playable-world bounds (M4). Undefined = unbounded world.
   * Lives on WorldState (the authoritative world/query layer) so movement,
   * streaming, and future M5 encounter transitions all read ONE contract —
   * never a renderer-local copy.
   */
  readonly bounds?: WorldBounds;

  /**
   * @param worldId      Stable world identifier.
   * @param seed         World RNG seed for chunk generation.
   * @param generateFn   Optional custom chunk generator (for testing).
   * @param bounds       Optional authoritative playable-world bounds (M4).
   */
  constructor(
    worldId: string,
    seed: number,
    generateFn?: ChunkGeneratorFn,
    bounds?: WorldBounds,
  ) {
    this.worldId = worldId;
    this.seed = seed;
    this.chunkStore = new ChunkStore(generateFn);
    this.entities = new WorldEntityRegistry(bounds);
    this.bounds = bounds;
  }

  /**
   * Prepares a set of world entities for an encounter.
   *
   * 1. Computes the pin set: all chunks containing participants plus 1-chunk margin.
   * 2. Loads and pins all required chunks (async).
   * 3. Creates an immutable ResidentGeometrySnapshot.
   * 4. Returns a PreparedEncounter for use by buildEncounterFromEntities().
   *
   * SNAPSHOT ISOLATION:
   *   After this method returns, the snapshot is frozen. Subsequent WorldState
   *   mutations — loading new chunks, moving entities, another encounter — cannot
   *   change the geometry seen by the GameState built from this PreparedEncounter.
   *
   * PIN SAFETY:
   *   All required chunks are pinned before the snapshot is created.
   *   PINNED chunks cannot be evicted while the encounter is active.
   *   Unpin happens in endEncounter().
   *
   * @param participants     WorldEntity objects that will become Combatants.
   * @param generationVersion  Chunk generation version (default 0).
   *
   * @throws If chunk geometry generation fails for any required chunk.
   */
  async beginEncounter(
    participants: WorldEntity[],
    generationVersion = 0,
  ): Promise<PreparedEncounter> {
    const pinnedChunks = computePinSet(participants, this.bounds);

    // Load and atomically pin every chunk in the encounter set.
    // Concurrent loads: each chunk loads independently and in parallel.
    // ensureResidentAndPin() is atomic: no eviction window between load and pin.
    await Promise.all(
      pinnedChunks.map(({ cx, cy }) =>
        this.chunkStore.ensureResidentAndPin(cx, cy, this.seed, generationVersion),
      ),
    );

    // Create the immutable snapshot from all pinned chunks.
    const snapshot = this.chunkStore.createSnapshot(
      this.worldId,
      this.seed,
      pinnedChunks,
      this.bounds,
    );

    return {
      snapshot,
      pinnedChunks,
      participants: [...participants],
    };
  }

  /**
   * Commits encounter results back to WorldState and unpins all encounter chunks.
   *
   * This is the ONLY path by which combat results enter WorldState (Decision 20).
   * Called exactly once per encounter, after combat resolves.
   *
   * COMMIT RULES (spec §14.3):
   *   • Surviving entities: commit wx, wy, hp from Combatant → WorldEntity.
   *   • Dead entities: set WorldEntity.alive = false (preserved, not deleted).
   *     Dead entities are rendered as corpses or omitted — never silently deleted.
   *   • Test fixtures (combatant.worldId === undefined): ignored (no persistent record).
   *
   * UNPIN: All encounter-pinned chunks are unpinned after commit. The chunks
   *   remain RESIDENT (evictable) until the cache policy evicts them.
   *
   * @param gameState     The final GameState after combat resolves.
   * @param pinnedChunks  From the PreparedEncounter that started this encounter.
   */
  endEncounter(
    gameState: GameState,
    pinnedChunks: readonly { cx: number; cy: number }[],
  ): void {
    // ── M4 pre-validation: no partial commits ──────────────────────────────
    // Every surviving combatant that maps to a registered entity must land
    // inside the world bounds. Validate ALL positions BEFORE mutating ANY
    // entity, so a malformed combat result rejects atomically (deterministic
    // throw, registry untouched, pins untouched) instead of half-committing.
    // Combat geometry cannot legitimately produce this: the snapshot tile
    // query VOIDs out-of-world tiles, so reaching here indicates a caller bug.
    if (this.bounds) {
      for (const combatant of Object.values(gameState.combatants)) {
        if (!combatant.worldId || !this.entities.has(combatant.worldId)) continue;
        if (combatant.alive && !isInBounds(this.bounds, combatant.wx, combatant.wy)) {
          throw new Error(
            `WorldState.endEncounter: combatant "${combatant.worldId}" position ` +
            `(${combatant.wx}, ${combatant.wy}) is outside WorldBounds ` +
            `[${this.bounds.minWx}..${this.bounds.maxWx}] × ` +
            `[${this.bounds.minWy}..${this.bounds.maxWy}]. No results were committed.`,
          );
        }
      }
    }

    // ── Commit combat results to persistent entity state ──────────────────
    for (const combatant of Object.values(gameState.combatants)) {
      if (!combatant.worldId) continue; // test fixture — no persistent record

      const entity = this.entities.get(combatant.worldId);
      if (!entity) continue; // entity was not in this WorldState — skip

      if (!combatant.alive) {
        // Dead entity: preserve as dead. Never delete (spec §12.3).
        entity.alive = false;
        // hp committed as-is (0 or the value when killed).
        entity.hp = combatant.hp;
      } else {
        // Surviving entity: commit world position and HP.
        entity.wx = combatant.wx;
        entity.wy = combatant.wy;
        entity.hp = combatant.hp;
        entity.alive = true;
      }
    }

    // ── Unpin encounter chunks ────────────────────────────────────────────
    // Chunks return to RESIDENT (evictable by the cache policy).
    for (const { cx, cy } of pinnedChunks) {
      this.chunkStore.unpin(cx, cy);
    }
  }
}
