// ---------------------------------------------------------------------------
// EXPLORATION SESSION — Phase 3 Milestone M1.
//
// Makes the streaming world infrastructure (WorldState / ChunkStore /
// WorldEntityRegistry / viewport streaming) live in a playable exploration
// session. The party has a persistent world position, moves through world
// space one tile at a time, and the viewport follows via the existing
// dead-zone contract.
//
// AUTHORITY BOUNDARY (M1 task §"State & data boundaries"):
//   • World coordinates + entity state (WorldEntityRegistry) = authoritative.
//   • Viewport + chunk residency = presentational / streaming concerns.
//   • Exploration has NO GameState — combat rules (rules.ts) are untouched.
//
// MOVEMENT MODEL:
//   Exploration movement is a single Chebyshev-adjacent step per input,
//   validated against live resident chunk geometry. A tile whose chunk is
//   not yet RESIDENT/PINNED is treated as impassable ("unmapped") — the
//   player simply waits for streaming to catch up. This deliberately does
//   NOT reuse rules.ts movement (action economy, moveRemaining, turn order
//   are combat concepts); it is the minimal exploration-specific state layer
//   the task calls for, not a parallel combat movement system.
//
// WORLD BOUNDS (M1 scope note):
//   Generic WorldBounds is Milestone M4. M1 uses an explicit finite
//   exploration region (EXPLORE_WORLD_W × EXPLORE_WORLD_H); tiles outside it
//   are VOID. This gives the existing viewport clamping a real world size
//   without building the M4 abstraction.
//
// ENCOUNTER-TRIGGER CONTRACT (M1 scope note):
//   Full exploration→encounter transition is Milestone M5. M1 exposes only
//   the minimal detection contract: detectAdjacentHostiles() returns the
//   hostile WorldEntities adjacent to the party. M5 will feed that list into
//   WorldState.beginEncounter(); M1 callers may only surface a notice.
// ---------------------------------------------------------------------------

import type { TileInfo } from "@/engine/content";
import { WorldState, type WorldEntity } from "@/engine/world";
import { CHUNK_W, CHUNK_H, localKey } from "@/engine/chunk";
import {
  createWorldBounds, isInBounds, boundsWidth, boundsHeight, type WorldBounds,
} from "@/engine/worldBounds";

/**
 * Authoritative playable-world bounds of the exploration world (M4).
 * Inclusive rectangle covering chunks (0,0)..(3,3) — the same 64×64 region
 * M1 hardcoded. This is the ONLY place the exploration world's extent is
 * defined; every other consumer derives from it (directly or via
 * session.worldState.bounds).
 */
export const EXPLORE_WORLD_BOUNDS: WorldBounds = createWorldBounds(0, 0, 63, 63);

/** Exploration world extent in tiles — DERIVED from EXPLORE_WORLD_BOUNDS. */
export const EXPLORE_WORLD_W = boundsWidth(EXPLORE_WORLD_BOUNDS);
export const EXPLORE_WORLD_H = boundsHeight(EXPLORE_WORLD_BOUNDS);

/**
 * Fixed world seed for the M1 exploration world. Deterministic terrain is
 * required so unit tests and E2E tests can rely on known walkable paths.
 * (Encounter seeds increment per newEncounter(); the exploration world must
 * NOT vary with them — a persistent world's terrain is stable by definition.)
 */
export const EXPLORE_WORLD_SEED = 20260817;

/** Stable identifier of the exploration world. */
export const EXPLORE_WORLD_ID = "overworld-01";

/** Persistent worldId of the party avatar entity. */
export const PARTY_WORLD_ID = "party_avatar";

/** Persistent worldId of the M1 demo hostile (encounter-trigger contract). */
export const HOSTILE_WORLD_ID = "overworld_orc_1";

/** Party spawn position — verified floor terrain for EXPLORE_WORLD_SEED. */
export const EXPLORE_SPAWN = Object.freeze({ wx: 8, wy: 8 });

/** Hostile spawn — floor tile east of the party for EXPLORE_WORLD_SEED. */
export const HOSTILE_SPAWN = Object.freeze({ wx: 20, wy: 8 });

// ---------------------------------------------------------------------------
// WORLD LOCATIONS (points of interest).
//
// PHILOSOPHY: locations and encounters are WORLD CONTENT, not top-level RPG
// navigation. A location is a physical place discovered by moving the party
// through the world — never a permanent navigation tab. These are PRESENTATION
// metadata ONLY: they are never registered in the WorldEntityRegistry, never
// participate in encounter detection, and never alter movement or terrain.
//
// The presentation layer highlights a location's map position and, when the
// party is Chebyshev-adjacent, offers a contextual prompt ("Enter Ruined
// Crypt"). Entering it opens the corresponding MapDef encounter as an in-world
// delve; resolving it returns the party to exploration at its world position.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// WORLD INTERACTIONS (M8).
//
// The overworld contains multiple kinds of world interactions. COMBAT IS ONE
// TYPE of interaction, not the definition of a location. A location may offer
// combat (delve), rest (heal), or discovery (a one-time blessing). The world
// system stays generic — it exposes the interaction kind and lets the RPG
// presentation layer run the appropriate behavior. This is deliberately the
// SMALLEST extensible model (no quest/buff/progression engine).
// ---------------------------------------------------------------------------
export type LocationKind = "combat" | "rest" | "discovery";

export interface ExploreLocation {
  /** Stable identifier of the location. */
  readonly id: string;
  /** Player-facing name of the place. */
  readonly name: string;
  /** Authoritative world tile the location sits on. */
  readonly wx: number;
  readonly wy: number;
  /** The kind of world interaction this location offers. */
  readonly kind: LocationKind;
  /** Contextual verb shown when the party is adjacent, e.g. "Rest at Camp". */
  readonly prompt: string;
  /** Presentation glyph key. */
  readonly icon: "crypt" | "yard" | "camp" | "shrine";
  /** MapDef encounter entered when delving a COMBAT location (combat only). */
  readonly encounterId?: string;
}

/**
 * Discoverable world locations just off the M1 exploration corridor. Row 6/7
 * are floor at these columns (verified), and sitting off the row-8 walk path
 * means a location marker never intercepts a movement click while the party is
 * still discovered as it passes by. These prove the world-interaction model:
 * a combat dungeon, a peaceful camp, and a discovery shrine coexist as places.
 */
export const EXPLORE_LOCATIONS: readonly ExploreLocation[] = Object.freeze([
  { id: "crypt",        name: "Ruined Crypt",  wx: 12, wy: 7, kind: "combat",    prompt: "Enter Ruined Crypt",  icon: "crypt",  encounterId: "crypt" },
  { id: "trainingYard", name: "Training Yard", wx: 16, wy: 7, kind: "combat",    prompt: "Enter Training Yard", icon: "yard",   encounterId: "trainingYard" },
  { id: "camp",         name: "Wayside Camp",  wx: 10, wy: 6, kind: "rest",      prompt: "Rest at Camp",        icon: "camp" },
  { id: "shrine",       name: "Old Shrine",    wx: 14, wy: 6, kind: "discovery", prompt: "Investigate Shrine",  icon: "shrine" },
]);

/** Maximum-HP granted by the Old Shrine's one-time blessing. */
export const SHRINE_MAXHP_BONUS = 5;

/**
 * Returns the location the party is currently able to interact with — the
 * first location within Chebyshev distance 1 of the party (including the tile
 * the party stands on), or null. Pure read over authoritative world position.
 */
export function nearbyLocation(session: ExplorationSession): ExploreLocation | null {
  const party = getParty(session);
  for (const loc of EXPLORE_LOCATIONS) {
    if (Math.max(Math.abs(loc.wx - party.wx), Math.abs(loc.wy - party.wy)) <= 1) return loc;
  }
  return null;
}

const VOID_TILE = Object.freeze<TileInfo>({
  passable: false, blocksLOS: true, providesCover: false, type: "void",
});
const FLOOR_TILE = Object.freeze<TileInfo>({
  passable: true, blocksLOS: false, providesCover: false, type: "floor",
});

/**
 * An active exploration session. Owns nothing new — it wraps the existing
 * WorldState (chunk geometry + entity registry) plus the party's identity.
 */
export interface ExplorationSession {
  readonly worldState: WorldState;
  readonly partyWorldId: string;
}

export interface ExplorationSessionOptions {
  /** Optional route-authored starting position for the party. */
  readonly partySpawn?: { readonly wx: number; readonly wy: number };
  /** Optional route-authored position for the demo hostile. */
  readonly hostileSpawn?: { readonly wx: number; readonly wy: number };
}

/**
 * Creates the M1 exploration session: a WorldState for the fixed exploration
 * world, with the party avatar and one demo hostile registered.
 *
 * Chunks are NOT loaded here — residency is driven by the existing viewport
 * prefetch path (getChunksForViewport → ensureResident). Callers must
 * tolerate an initial window where tiles are unmapped.
 */
export function createExplorationSession(options?: ExplorationSessionOptions): ExplorationSession {
  const worldState = new WorldState(
    EXPLORE_WORLD_ID, EXPLORE_WORLD_SEED, undefined, EXPLORE_WORLD_BOUNDS,
  );
  const partySpawn = options?.partySpawn ?? EXPLORE_SPAWN;
  const hostileSpawn = options?.hostileSpawn ?? HOSTILE_SPAWN;
  worldState.entities.register({
    worldId: PARTY_WORLD_ID,
    defId: "fighter",
    wx: partySpawn.wx,
    wy: partySpawn.wy,
    hp: 30,
    maxHp: 30,
    alive: true,
    state: {},
  });
  worldState.entities.register({
    worldId: HOSTILE_WORLD_ID,
    defId: "orc",
    wx: hostileSpawn.wx,
    wy: hostileSpawn.wy,
    hp: 15,
    maxHp: 15,
    alive: true,
    state: {},
  });
  return { worldState, partyWorldId: PARTY_WORLD_ID };
}

/**
 * Live tile lookup against the exploration world.
 *
 * NOT a GameState TileQueryFn — it intentionally reads the live ChunkStore
 * and therefore violates (and must never be used for) the GameState snapshot
 * invariant. It exists for two exploration-only purposes:
 *   1. Presentation: rendering the visible region while chunks stream in.
 *   2. Exploration movement validation (there is no GameState in exploration).
 *
 * Resolution:
 *   • Outside the world's authoritative WorldBounds (M4) → VOID.
 *   • Chunk not RESIDENT/PINNED → VOID (unmapped = impassable, safe default).
 *   • Sparse tile present → that tile (pillars); absent → implicit FLOOR.
 */
export function explorationTileInfo(
  session: ExplorationSession,
  wx: number,
  wy: number,
): TileInfo {
  const bounds = session.worldState.bounds;
  if (bounds && !isInBounds(bounds, wx, wy)) {
    return VOID_TILE;
  }
  const cx = Math.floor(wx / CHUNK_W);
  const cy = Math.floor(wy / CHUNK_H);
  const geometry = session.worldState.chunkStore.getGeometry(cx, cy);
  if (!geometry) return VOID_TILE;
  return geometry.tiles.get(localKey(wx - cx * CHUNK_W, wy - cy * CHUNK_H)) ?? FLOOR_TILE;
}

/** Result of an exploration movement attempt. */
export interface ExploreMoveResult {
  ok: boolean;
  /** Human-readable rejection reason when ok === false. */
  reason?: string;
}

/**
 * Returns the party avatar entity, throwing if the registry no longer has it
 * (which would indicate a serious identity bug — party entities are never
 * deleted).
 */
export function getParty(session: ExplorationSession): WorldEntity {
  const party = session.worldState.entities.get(session.partyWorldId);
  if (!party) {
    throw new Error(`ExplorationSession: party entity "${session.partyWorldId}" missing from registry.`);
  }
  return party;
}

/**
 * Attempts a single exploration step to world tile (wx, wy).
 *
 * Validation order (first failure wins):
 *   1. Destination must be Chebyshev-adjacent to the party (one step).
 *   2. Destination tile must be passable (resident floor; unmapped/void/pillar reject).
 *   3. Destination must not hold a living entity.
 *
 * On success the WorldEntityRegistry is mutated (authoritative position
 * change). The caller is responsible for viewport follow + re-render.
 */
export function movePartyStep(
  session: ExplorationSession,
  wx: number,
  wy: number,
): ExploreMoveResult {
  const party = getParty(session);
  const dx = Math.abs(wx - party.wx);
  const dy = Math.abs(wy - party.wy);
  if (dx === 0 && dy === 0) return { ok: false, reason: "You are already there." };
  if (dx > 1 || dy > 1) return { ok: false, reason: "Too far — move one tile at a time." };
  // M4: crossing the authoritative world boundary is rejected explicitly and
  // deterministically, BEFORE tile lookup, with a distinct reason (the tile
  // path would report it as "unmapped", which is wrong at a real world edge).
  const bounds = session.worldState.bounds;
  if (bounds && !isInBounds(bounds, wx, wy)) {
    return { ok: false, reason: "You have reached the edge of the world." };
  }
  const tile = explorationTileInfo(session, wx, wy);
  if (!tile.passable) {
    return {
      ok: false,
      reason: tile.type === "void"
        ? "That area has not been mapped yet."
        : "That tile is blocked.",
    };
  }
  for (const e of session.worldState.entities.getAlive()) {
    if (e.worldId !== party.worldId && e.wx === wx && e.wy === wy) {
      return { ok: false, reason: "Something is standing there." };
    }
  }
  session.worldState.entities.move(party.worldId, wx, wy);
  return { ok: true };
}

/**
 * M1 encounter-trigger contract (consumed by M5): returns living hostile
 * entities within Chebyshev distance 1 of the party. M1 callers may only
 * surface a notice; starting combat from this list is M5 scope.
 */
export function detectAdjacentHostiles(session: ExplorationSession): WorldEntity[] {
  const party = getParty(session);
  return session.worldState.entities.getAlive().filter(
    (e) =>
      e.worldId !== party.worldId &&
      Math.abs(e.wx - party.wx) <= 1 &&
      Math.abs(e.wy - party.wy) <= 1,
  );
}

/**
 * M5 defeat recovery: revives the party at the exploration spawn with full HP.
 *
 * Called ONLY after WorldState.endEncounter() has committed a defeat back to
 * the registry (party alive=false). This is an exploration-session operation,
 * not a combat one — the authority boundary (endEncounter is the sole combat
 * write path) is not violated because no encounter is active when it runs.
 * World consequences of the lost battle (dead allies, surviving hostiles'
 * positions/HP) are untouched: only the party avatar is restored.
 */
export function respawnPartyAtSpawn(session: ExplorationSession): void {
  const registry = session.worldState.entities;
  const party = getParty(session);
  registry.setAlive(party.worldId, true);
  registry.setHp(party.worldId, party.maxHp);
  registry.move(party.worldId, EXPLORE_SPAWN.wx, EXPLORE_SPAWN.wy);
}

/**
 * REST interaction (Camp): restores the party avatar to full HP. A world
 * operation on the authoritative registry — never a combat operation, and it
 * touches nothing but the party's current HP. Returns the restored HP total.
 */
export function restPartyAtCamp(session: ExplorationSession): number {
  const registry = session.worldState.entities;
  const party = getParty(session);
  registry.setHp(party.worldId, party.maxHp);
  return party.maxHp;
}

/**
 * DISCOVERY interaction (Shrine): a small deterministic blessing — the party's
 * maximum HP rises by SHRINE_MAXHP_BONUS and it is healed to the new maximum.
 * Deliberately NOT a general buff system; it is a one-shot world consequence
 * (the caller records "used" so it cannot be re-granted in a session). Returns
 * the max-HP bonus applied.
 */
export function blessPartyAtShrine(session: ExplorationSession): number {
  const registry = session.worldState.entities;
  const party = getParty(session);
  registry.setMaxHp(party.worldId, party.maxHp + SHRINE_MAXHP_BONUS);
  registry.setHp(party.worldId, getParty(session).maxHp);
  return SHRINE_MAXHP_BONUS;
}

/**
 * The set of tiles the party can step to right now — Chebyshev-adjacent,
 * passable, unoccupied. Presentation helper for the reachable-tile highlight.
 */
export function adjacentStepTargets(session: ExplorationSession): { wx: number; wy: number }[] {
  const party = getParty(session);
  const occupied = new Set(
    session.worldState.entities.getAlive()
      .filter((e) => e.worldId !== party.worldId)
      .map((e) => `${e.wx},${e.wy}`),
  );
  const out: { wx: number; wy: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const wx = party.wx + dx;
      const wy = party.wy + dy;
      if (!explorationTileInfo(session, wx, wy).passable) continue;
      if (occupied.has(`${wx},${wy}`)) continue;
      out.push({ wx, wy });
    }
  }
  return out;
}
