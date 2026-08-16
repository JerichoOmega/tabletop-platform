# Intelligent Tabletop — Project Status

**Last updated:** 2026-08-16 (hover/target preview — Phase 2 UX)
**Baseline commit:** `8e966cf`
**Build:** passing (TypeScript, Vitest, Playwright E2E)
**Deployed at:** `/` (Replit preview)
**GitHub:** `JerichoOmega/tabletop-platform` @ `main`

> **Roadmap:** See [`docs/ROADMAP.md`](ROADMAP.md) for the canonical phase-by-phase
> roadmap, the "The Table Is Fixed. The World Is Not." design principle, and
> governance rules for future agents.

---

## Architecture

The application is a React + Vite single-page app. All game logic is pure TypeScript (no React). The five-layer separation means any layer can be tested, replaced, or evolved independently.

```
src/
  engine/
    content.ts      — Static data + RNG + encounter factory. Fully typed.
    rules.ts        — Map utilities, pathfinding, LOS, validation, execution, turn/AI. Fully typed.
  intent/
    parser.ts       — Text → ProposedAction interpreter + proposal lifecycle
  assets/
    types.ts        — AssetKind, AssetDefinition (shared types)
    registry.ts     — registerAsset / resolveAsset / hasAsset / listAssets / clearRegistry
  ui/
    primitives.tsx  — ClassIcon, HpBar, CharacterPanel, actionBtnStyle
                      Resolves visual assets from the registry; falls back to icon placeholders.
  IntelligentTabletop.tsx — Main React component
  App.tsx           — Thin wrapper; renders <IntelligentTabletop />
  __tests__/
    engine.test.ts  — Unit tests: rules engine + intent parser + asset registry
e2e/
  traditional.spec.ts — Playwright: Move, Attack, Healing Touch, Fire Bolt, End Turn
  assisted.spec.ts    — Playwright: natural-language attack, heal, Fire Bolt
  victory.spec.ts     — Playwright: Quick Battle fixture → Victory banner
  defeat.spec.ts      — Playwright: Quick Defeat fixture → Defeat banner
```

### Layer responsibilities

| Layer | Reads | Mutates | Knows about visuals? |
|---|---|---|---|
| `content.ts` | Nothing (source of truth) | Never | No — only holds logical `visualAssetId` strings |
| `rules.ts` | `content.ts` | State (via `cloneState`) | No |
| `intent/parser.ts` | `content.ts` + `rules.ts` (validate* only) | Never | No |
| `assets/registry.ts` | Nothing at import time | Registry Map | Yes — this is the seam |
| `ui/primitives.tsx` | All layers + registry | Never | Yes — resolves at render |
| `IntelligentTabletop.tsx` | All layers + registry | React state via setters | Yes — resolves at render |

### Asset registry data flow

```
Game Content Definition  (content.ts)
        ↓  visualAssetId: "character.fighter"  (logical string only)
Asset Registry           (assets/registry.ts)
        ↓  resolveAsset("character.fighter") → AssetDefinition | undefined
Renderer / UI            (primitives.tsx, IntelligentTabletop.tsx)
        ↓  <img src={asset.src} />  OR  <ClassIcon />  (graceful fallback)
```

The rules engine never imports from `assets/`. The UI never hardcodes file paths.

---

## Systems

### Map System
Each encounter references a `MAP_DEFS` entry by id. Maps declare `width`, `height`, `entrance`, `pillars[]`, and now optionally `visualAssets` with logical terrain tile IDs. The engine functions (`isWall`, `isPillar`, `reachableTiles`, `lineOfSight`) never read `visualAssets`.

### Combatant System
`COMBATANT_DEFS` are templates. `createCombatantInstance()` produces mutable runtime objects. Definitions now carry an optional `visualAssetId` (e.g. `"character.fighter"`) that the UI resolves through the registry at render time. The rules engine never reads it.

### Ability System
Abilities are fully data-driven. `ABILITY_DEFS` describes targeting (`self | ally | enemy | any`), range, LOS, and `effect`. `EFFECT_HANDLERS` maps effect types to pure functions. `executeAbility()` has no knowledge of specific ability names.

### Initiative & Turn Cycling
`rollInitiative()` uses the encounter's seeded RNG. `endTurn()` skips dead combatants and increments the round counter on wrap. `resolveLeadingEnemyTurns()` runs any enemy turns that precede the first PC each time it is called.

### Enemy AI
`runEnemyAI()` reads only generic combatant/weapon fields. Uses the same `validateAttack` / `executeMove` / `executeAttack` as the player.

### Intent Parser
`parseIntent(text, state, actorId)` returns one of four types: `proposal`, `query`, `inspect`, `error`. Fully data-driven — resolves enemy/ability names from live game state.

### Asset Registry
`src/assets/registry.ts` provides a singleton Map from logical ID strings to `AssetDefinition` objects. Content definitions carry optional `visualAssetId` strings; the registry is the only place that maps those to concrete `src` URLs. No production art is registered yet — all renderers fall back to the existing icon/CSS placeholders. When art is ready, add `registerAsset(...)` calls here or in a bootstrap file; nothing else in the codebase changes.

---

## TypeScript Status

| Module | Status |
|---|---|
| `engine/content.ts` | ✅ Fully typed — `@ts-nocheck` removed |
| `engine/rules.ts` | ✅ Fully typed — `@ts-nocheck` removed |
| `assets/types.ts` | ✅ Fully typed (new) |
| `assets/registry.ts` | ✅ Fully typed (new) |
| `intent/parser.ts` | ✅ Fully typed — `@ts-nocheck` removed |
| `ui/primitives.tsx` | `@ts-nocheck` retained |
| `IntelligentTabletop.tsx` | ✅ Fully typed — `@ts-nocheck` removed |
| `__tests__/engine.test.ts` | `@ts-nocheck` retained |

`pnpm --filter @workspace/tabletop run typecheck` passes clean.

---

## Game Modes

| Mode | How it plays |
|---|---|
| **Traditional** | Click a PC card → click Move/Attack/Ability button → click a tile or token |
| **Assisted** | Type a natural-language instruction → review Proposed Action card → Approve |
| **Adventure** | Same as Assisted, different placeholder copy encouraging narrative framing |

All three modes use exactly the same rules engine.

---

## UX Implementation (per Blueprint)

| Blueprint section | Status |
|---|---|
| §2 Board token states | ✅ Selection (gold border), active-turn (warm ring), targeting glows |
| §3 Character panel | ✅ ACTING badge, HP bar, move/action readiness |
| §5 Two-tier action bar | ✅ Tier 1: Move/Attack/End Turn; Tier 2: wrapping ability row |
| §5 Disabled buttons | ✅ Visible at 38% opacity with tooltip, not hidden |
| §5 Ability tooltips | ✅ Derived from ABILITY_DEFS at runtime |
| §6 Targeting visual language | ✅ Green (move), red (attack/harmful ability), blue (beneficial ability) |
| §6 Targeting status strip | ✅ Color-matched + text-paired (colorblind safe) |
| §8 Proposal card | ✅ Amber header + sword icon, distinct from query |
| §10 Query card | ✅ Blue header + info icon, Dismiss only (no Approve) |
| §10 Inspect card | ✅ Neutral header + scroll icon |
| §12 Responsive layout | ✅ Tablet-first responsive layout (landscape + portrait) |
| §14 Animations | ⬜ Deferred |
| §15 Accessibility pass | ⬜ Deferred |

---

## Test Coverage

### Unit tests (`pnpm --filter @workspace/tabletop test`)

| Area | Tests |
|---|---|
| RNG, factory, `buildEncounter`, `rollInitiative` | Determinism, bounds, edge cases |
| Map utilities (`isWall`, `isPillar`, `isBlocked`) | Walls, pillars, OOB |
| `reachableTiles` | Range bounds, wall/occupant exclusion |
| `lineOfSight`, `chebyshev` | Clear path, pillar cover, diagonals |
| `validateMove/Attack/Ability`, `isValidAbilityTarget` | All targeting rules |
| `cloneState` | Mutation isolation |
| `executeMove/Attack/Ability` | State changes, immutability |
| `endTurn`, `checkEncounterStatus` | Turn cycling, victory/defeat detection |
| `runEnemyAI`, `resolveLeadingEnemyTurns` | AI produces events, leaves PC as actor |
| `parseIntent`, `revalidateProposal`, `executeProposalSteps` | Full intent pipeline |
| **Asset Registry** | resolve/has/list/clear, content ID coupling, fallback behavior |
| **Encounter regression** | Full Ruined Crypt runs to victory/defeat in ≤200 rounds |

### Playwright E2E (`pnpm --filter @workspace/tabletop test:e2e`)

| Spec | Covers |
|---|---|
| `traditional.spec.ts` | Move, Attack, Healing Touch, Fire Bolt, End Turn |
| `assisted.spec.ts` | Natural-language attack, heal, Fire Bolt |
| `victory.spec.ts` | Quick Battle fixture → Victory banner visible |
| `defeat.spec.ts` | Quick Defeat fixture → Defeat banner visible |
| `target-preview.spec.ts` | Hover preview — attack (valid, invalid, out-of-range, clear); ability (Fire Bolt, Healing Touch); mode-transition clearing |

**Total: 93 unit tests · 69 E2E tests** (all passing at baseline `8e966cf`).

Test fixtures (`quickBattle`, `quickDefeat`, `quickOutOfRange`) are deterministic and hidden from the normal encounter picker. They appear only when `?e2e` is present in the URL.

---

## Bug Fixes Applied (relative to v4 prototype)

1. **Auto-select current PC** — `useEffect` keyed on `${seed}-${currentActorId}` fires on every turn-over and every `newEncounter()`.
2. **Action controls above ENEMIES** — Move/Attack/Ability + End Turn render before the ENEMIES section.
3. **`newEncounter` arrow wrapper** — `onClick={() => newEncounter()}` prevents SyntheticEvent from corrupting `encounterIdRef.current`.
4. **`flexWrap: "wrap"` on ability row** — prevents button overflow in the 220px left column.

---

## Known Limitations

- **No production art** — asset registry is wired up but all IDs resolve to `undefined`; renderers fall back to icon placeholders.
- **No persistent save** — game state lives in React state.
- **Intent parser is regex-based** — designed to be replaced by an LLM call via `parseIntent`'s stable return shape.
- **Single-floor maps, no fog of war, no enemy AI abilities.**
- **No undo.**

---

## Roadmap

See **[`docs/ROADMAP.md`](ROADMAP.md)** for the full canonical roadmap including:

- Completed Phase 1 milestones
- Current Phase 2 — Core Tabletop UX work
- Planned Phase 3 — World Scale & Fixed Tabletop Viewport (the next major architectural phase)
- Planned Phases 4–6
- The "The Table Is Fixed. The World Is Not." design principle
- Governance rules for future agents
