---
name: Hardening decisions
description: Key decisions made during the architecture hardening pass (Items 1–8).
---

## Rng interface (content.ts)
`Rng` extends `() => number` with `save(): number` and `restore(state: number): void`.
`mulberry32` returns `Rng` via `Object.assign`.

**Why:** Existing call sites that type `rng: () => number` remain compatible without changes.
Only `executeProposalSteps` needed the upgrade to enable atomic rollback.

**How to apply:** Any future function that needs atomic RNG rollback should type its `rng`
parameter as `Rng`, call `rng.save()` before the step loop, and `rng.restore(snapshot)` on
any failure path. Do not change existing `executeAttack`/`executeAbility` signatures — they
are single-step and don't need snapshot/restore.

## Action consumed tracking in revalidateProposal (parser.ts)
After a successful `attack` or `ability` step in the simulation loop, sets
`sim.combatants[actorId].actionUsed = true` so subsequent steps see the correct state.

**Why:** Without this, a double-attack proposal would pass revalidation — the second step
would not see that the action was already consumed in the simulation.

## Friendly-fire prevention (rules.ts validateAttack)
Added ally check: if `actor.type === target.type` → `INVALID_TARGET_TYPE`.
The check runs after the `TARGET_DEAD` check and before the range/LOS checks.

**Why:** Engine previously had no enforcement against PC→PC or enemy→enemy attacks.
`INVALID_TARGET_TYPE` was already in the `ValidationCode` union; just unused.

## contentValidation.ts — separate from gameplay engine
`validateAllContent()` is in its own module (`src/engine/contentValidation.ts`).
It is intentionally never imported by any game-flow code — dev/CI only.

**Why:** Keeping it off the hot path avoids any startup cost in production.
The test suite calls it directly; a future CI step can import it standalone.

## testOnly encounter spawn exemption in content validation
`validateEncounterDefs` skips the `isBlocked` coordinate check when `enc.testOnly === true`.
Bounds check still applies; only the "blocked tile" check is skipped.

**Why:** The `quickOutOfRange` encounter intentionally spawns its target dummy at (7,3) on
the trainingYard map — the right-border wall — because it's the only tile with Chebyshev
distance > 6 from the entrance on an 8-wide map. The dummy never moves (`moveMax: 0`);
the attack fails `OUT_OF_RANGE` before any tile-blocking check runs. This is a deliberate
E2E test fixture, not a content bug.

## tsconfig.json includes test files
Removed `"**/*.test.ts"` from `exclude`; added `"vitest/globals"` to `types`.
Test files now type-check alongside production code.

**Why:** Keeping tests out of the tsconfig caused silent type errors in test files that
only surfaced at runtime. Including them gives tsc full visibility.

## cloneState clones turnOrder and initiativeRolls
`cloneState` in rules.ts now spreads both arrays. Previously they were shared references.

**Why:** Phase 3 (World Scale / Viewport) may mutate these arrays. Cloning them now
(cheap shallow copy) prevents accidental state sharing. The `map` object is still
intentionally shared (static terrain — never mutated during gameplay).

## GitHub remote is named "github", not "origin"
Push commands must use `git push github main`, not `git push origin main`.

---

## Phase 3 Preflight Resolutions (locked in WORLD_SCALE_VIEWPORT.md)

### TileInfo.providesCover is a hard requirement
`TileInfo` has three boolean flags: `passable`, `blocksLOS`, `providesCover`. These are distinct. Walls have `blocksLOS=true, providesCover=false`. Pillars have `blocksLOS=false, providesCover=true`. `lineOfSight()` must never conflate them. The `mapDefToTileQuery()` adapter must implement this correctly using the border/entrance/pillar logic — there is NO `MapDef.walls[]` array.

**Why:** Cover mechanics (+2 AC for targets behind pillars) silently break if the pillar/wall distinction is collapsed into a single boolean.

### MapDef wall model — there is NO walls[] array
`MapDef` has `entrance: {x,y}` and `pillars: {x,y}[]`. Walls are implicit: every border tile is a wall EXCEPT the entrance. Both current maps are 8×6 (not 8×8 or 10×8). `mapDefToTileQuery()` must implement the border+entrance+pillar logic; see §5.4 of WORLD_SCALE_VIEWPORT.md for the exact pseudocode.

**Why:** The spec §2 previously described a `walls[]` array that never existed. Anyone implementing the adapter from the old spec alone would build a broken tile query.

### TileQueryFn determinism is a hard architectural invariant
A `TileQueryFn` passed to the rules engine must be a pure, stable snapshot. It must never close over a mutable live `ChunkStore`. Rules outcomes cannot depend on chunk residency, viewport position, or React render timing.

**Why:** Proposal validation and execution must see identical geometry. The renderer's chunk-loading pipeline and the rules pipeline run concurrently; they must be fully isolated.

### Three-layer Combatant identity
- `id` = encounter-local key in `GameState.combatants`. Assigned at encounter creation, not persistent.
- `defId` = content/template identity. References `COMBATANT_DEFS`. Never changes.
- `worldId?` = persistent world identity. Foreign key into `WorldState.entityState`. Optional — test fixtures and pre-WorldState encounters leave it undefined.

**Why:** Conflating these leads to bugs where entity template lookups use instance keys or persistent records get overwritten by encounter-local updates.

### Encounter authority boundary
During an active encounter, `GameState` is the sole writer for combat-participant state. `WorldState.entityState` is frozen for those entities. `endEncounter()` is the only path that commits results back to `WorldState`. `WorldState` must not independently mutate combat-participant positions/HP while the encounter is active.

**Why:** The old spec implied `WorldState.activeEncounterState: GameState | null` (nesting), which creates a dual-write synchronization hazard. Parallel structures with a single commit boundary avoids this.
