---
name: Ages of Empire mode
description: Architecture and design decisions for the AoE territory-conquest rules engine
---

Separate rules domain at `src/engine/agesOfEmpire/` (types, content, rules, combat) — never imports from or modifies the tactical engine; only shares `mulberry32` from `engine/content`.

**Key decisions:**
- All numeric balance values live in `AOE_BALANCE` (types.ts), including unit costs/movement and faction passive magnitudes; content.ts reads from it. Any new tunable number must go there, not inline.
- Pure/immutable outcomes: every action clones state (`cloneState` must deep-copy nested arrays — battle round dice arrays were once aliased; keep clone in lockstep with state shape). `getGameView` returns defensive copies.
- Determinism: RNG position persisted in `state.rngState`; combat restores/saves mulberry32 around dice. No Math.random anywhere.
- Age timer is external: caller calls `markAgeTimerExpired()`; age advances only at round completion; modern-age end → `finalizeGame`.
- All external inputs validated via `isValidArmyStack`/`isValidCount` (finite non-negative integers, known unit ids) — NaN/fractions would silently corrupt armies otherwise.
- While a battle is active, unit-moving actions (air redeploy/strike, emergency-defense on battle territories) are barred — committed stacks are not reserved, so movement mid-battle corrupts casualties/garrisons.
- Initiative rotates by round; elimination adjusts `turnIndex` when the eliminated player sat earlier in order. Tests that force `round` must account for rotation (WRONG_PLAYER trap).
- UI intentionally absent: engine exposes `getGameView`/`listValidAttacks`/`listValidMoves` view model only.
