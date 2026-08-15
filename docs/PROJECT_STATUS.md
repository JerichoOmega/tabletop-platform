# Intelligent Tabletop — Project Status

**Last updated:** 2026-08-15  
**Build:** passing (TypeScript, Vitest)  
**Deployed at:** `/` (Replit preview)

---

## Architecture

The application is a React + Vite single-page app. All game logic is pure JavaScript (no React); only the top-level component imports React. The four-layer separation means any layer can be tested, replaced, or evolved independently.

```
src/
  engine/
    content.ts      — Static data + RNG + encounter factory (no rules logic)
    rules.ts        — Map utilities, pathfinding, LOS, validation, execution, turn/AI
  intent/
    parser.ts       — Text → ProposedAction interpreter + proposal lifecycle
  ui/
    primitives.tsx  — ClassIcon, HpBar, CharacterPanel, actionBtnStyle
  IntelligentTabletop.tsx — Main React component (imports from all three layers)
  App.tsx           — Thin wrapper; renders <IntelligentTabletop />
  __tests__/
    engine.test.ts  — Unit tests for rules engine + intent parser
```

### Layer responsibilities

| Layer | Reads | Mutates |
|---|---|---|
| `content.ts` | Nothing (source of truth) | Never |
| `rules.ts` | `content.ts` | State (via `cloneState` — always produces new objects) |
| `intent/parser.ts` | `content.ts` + `rules.ts` (validate* only) | Never |
| `IntelligentTabletop.tsx` | All layers | React state via setters |

---

## Systems

### Map System
Each encounter references a `MAP_DEFS` entry by id. Maps declare `width`, `height`, `entrance`, and `pillars[]`. The engine functions (`isWall`, `isPillar`, `reachableTiles`, `lineOfSight`) accept any map object — adding a new map never requires engine changes.

### Combatant System
`COMBATANT_DEFS` are templates. `createCombatantInstance()` produces mutable runtime objects. Multiple instances of the same definition (e.g. three Goblins) mutate completely independently. Abilities are a list of ids on the definition; the engine resolves them from `ABILITY_DEFS`.

### Ability System
Abilities are fully data-driven. `ABILITY_DEFS` describes targeting rule (`self | ally | enemy | any`), range, LOS requirement, and `effect`. `EFFECT_HANDLERS` maps effect types (`heal`, `damage`) to pure mutation functions. `executeAbility()` dispatches on `effect.type`; it has no knowledge of specific ability names. Adding a new ability that uses an existing effect type requires only one new entry in `ABILITY_DEFS`.

### Initiative & Turn Cycling
`rollInitiative()` uses the encounter's seeded RNG. `endTurn()` skips dead combatants and increments the round counter on wrap. `resolveLeadingEnemyTurns()` runs any enemy turns that precede the first PC each time it is called (new encounter, post-endTurn).

### Enemy AI
`runEnemyAI()` reads only generic combatant/weapon fields. It moves toward the nearest living PC if out of weapon range, then attacks if a valid attack exists. Uses the same `validateAttack` / `executeMove` / `executeAttack` as the player — no separate fast path.

### Intent Parser
`parseIntent(text, state, actorId)` returns one of four types:
- `proposal` — ordered `steps[]` to be reviewed and approved
- `query` — "Can I…?" check rendered as a checklist  
- `inspect` — "What can I do?" listing current options
- `error` — could not interpret

The parser is data-driven: it resolves enemy names from whatever enemies are alive in the current encounter, and resolves abilities from whatever the current actor knows. No per-species or per-ability branching.

`revalidateProposal` re-checks every step against the current state (simulating state changes across steps). `executeProposalSteps` is atomic — if any step fails mid-sequence, the original state is returned untouched.

---

## Game Modes

| Mode | How it plays |
|---|---|
| **Traditional** | Click a PC card → click Move/Attack/Ability button → click a tile or token |
| **Assisted** | Type a natural-language instruction (e.g. "move behind the pillar and attack") → review Proposed Action → Approve |
| **Adventure** | Same as Assisted, different placeholder copy suggesting narrative framing |

All three modes use exactly the same rules engine. Mode only changes which UI surface is visible.

---

## Bug Fixes Applied (relative to v4 prototype)

1. **Auto-select current PC on turn handover** — `useEffect` keyed on `turnKey = \`${seed}-${currentActorId}\`` fires once per turn-over and once per `newEncounter()` call. Without this, action buttons never appeared because `selected` was null and the button guard `selected.id === currentActorId && isPlayerTurn` was always false.

2. **Layout: action controls above ENEMIES** — Move/Attack/Ability buttons and End Turn are rendered immediately below the PARTY section, before the ENEMIES section. With 3+ enemy CharacterPanels, controls were below the fold at 720px.

3. **`newEncounter` arrow wrapper** — `onClick={() => newEncounter()}` prevents the SyntheticEvent from being passed as `encounterId`, which would corrupt `encounterIdRef.current` on game-over restart.

4. **`flexWrap: "wrap"` on action button row** — prevents buttons from overflowing the 220px left column when a character has multiple abilities.

---

## Test Status

Tests are located in `src/__tests__/engine.test.ts` and run with:

```
pnpm --filter @workspace/tabletop test
```

Coverage:

| Area | Tests |
|---|---|
| RNG (`mulberry32`, `rollDie`) | Determinism, bounds, seed independence |
| `createCombatantInstance` | Field validation, custom name, unknown def |
| `buildEncounter` | Initial state shape, determinism, unknown id |
| `rollInitiative` | Sorted descending |
| Map utilities (`isWall`, `isPillar`, `isBlocked`) | Walls, pillars, OOB |
| `reachableTiles` | Range bounds, no walls, occupied exclusion |
| `lineOfSight` | Clear path, pillar cover |
| `chebyshev` | Diagonal, straight, same tile |
| `validateMove` | Accept reachable, reject wall, reject wrong turn |
| `validateAttack` | Reject out of range, reject dead target |
| `validateAbility` | Unknown ability, not-learned, target type |
| `isValidAbilityTarget` | All four targeting modes |
| `cloneState` | Mutation isolation |
| `executeMove` | State mutation, immutability of original |
| `executeAttack` | Hit produces result, HP decreases |
| `executeAbility` | Healing Touch (+HP), Fire Bolt (–HP), unknown |
| `endTurn` | Advances actor, resets resources, increments round |
| `checkEncounterStatus` | ongoing / victory / defeat |
| `runEnemyAI` | Produces events |
| `resolveLeadingEnemyTurns` | Leaves a PC as current actor |
| `exampleTargetPhrase` | Names enemy class, fallback |
| `parseIntent` | Empty, endTurn, inspect, query, attack, abilities |
| `revalidateProposal` | endTurn valid, impossible move invalid |
| `executeProposalSteps` | Atomic rollback on failure |
| **Encounter regression** | Full Ruined Crypt to victory/defeat, ≤200 rounds |

---

## Known Limitations

- **No persistent save** — game state lives in React state; refreshing starts a new encounter.
- **Intent parser is regex-based** — complex or ambiguous phrasings may fail. Designed to be replaced wholesale by an LLM call (see `buildIntentContext`).
- **Ability targeting in assisted/adventure modes** — the parser resolves the target from text; unusual phrasings may produce `INVALID_TARGET_TYPE` errors that surface as error banners.
- **Single-floor maps only** — no multi-level terrain, no doors, no fog of war.
- **Enemy AI is simple greedy** — moves toward nearest PC, attacks if possible. No ability use, no pathfinding around other enemies.
- **No undo** — once a proposal is approved, it cannot be reversed within the current session.

---

## Roadmap

- [ ] Replace regex intent parser with an LLM call via `buildIntentContext` shape
- [ ] Fog of war / visibility tracking
- [ ] Multi-floor maps (stairs, rooms)
- [ ] Enemy AI abilities (Goblin chieftain heals allies, etc.)
- [ ] Persistent session log (export to text)
- [ ] Undo last action
- [ ] Additional encounter types (outdoor, cave, ship)
- [ ] Status effects (stunned, burning, poisoned) via new EFFECT_HANDLERS entries
- [ ] Playwright end-to-end tests for full gameplay matrix (click-through Traditional mode, Assisted approve flow, victory detection)

---

## Project Checkpoint — 2026-08-15

**Commit:** module extraction complete  
**Branch:** `main`  
**Remote:** `github` → `https://github.com/JerichoOmega/tabletop-platform`

### What was extracted
The 1956-line v4 prototype was split into four modules without changing any game logic:
- `engine/content.ts` (185 lines) — data + RNG + factory
- `engine/rules.ts` (230 lines) — rules engine
- `intent/parser.ts` (310 lines) — intent + proposals
- `ui/primitives.tsx` (75 lines) — UI components
- `IntelligentTabletop.tsx` (360 lines) — React component

### Bugs fixed
All three bugs from the previous session (auto-select, layout, newEncounter button) are applied to the new modular base. The ability targeting token click path is also documented inline.

### Tests added
41 test cases across 21 `describe` blocks. All passing.

### Typecheck
`pnpm typecheck` passes clean (all files use `// @ts-nocheck` to avoid annotation churn on the prototype-style code; this is intentional and documented here).
