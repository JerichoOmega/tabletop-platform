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
