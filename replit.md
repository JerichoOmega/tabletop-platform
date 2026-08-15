# Intelligent Tabletop

A turn-based tactical combat game with a natural-language intent engine, built as a React + Vite SPA on a pnpm monorepo. Supports Traditional (click-to-play), Assisted (natural-language with proposal review), and Adventure (narrative) modes — all running the same rules engine with no duplicate combat logic.

## Run & Operate

- `pnpm --filter @workspace/tabletop run dev` — start the tabletop UI (reads $PORT)
- `pnpm --filter @workspace/tabletop run typecheck` — TypeScript check
- `pnpm --filter @workspace/tabletop test` — run unit tests (vitest)
- `pnpm run typecheck` — full workspace typecheck

## Stack

- pnpm workspaces, Node.js, TypeScript 5
- React 18 + Vite 7
- lucide-react (icons), Cinzel + EB Garamond fonts
- Vitest (unit tests, node environment)
- No external backend; all state lives in React

## Where things live

```
artifacts/tabletop/src/
  engine/
    content.ts      — MAP_DEFS, WEAPON_DEFS, COMBATANT_DEFS, ABILITY_DEFS,
                      EFFECT_HANDLERS, ENCOUNTER_DEFS, RNG, factory functions
    rules.ts        — isWall, pathfinding, LOS, validation, execution, turn/AI
  intent/
    parser.ts       — parseIntent, revalidateProposal, executeProposalSteps
  ui/
    primitives.tsx  — ClassIcon, HpBar, CharacterPanel, actionBtnStyle
  IntelligentTabletop.tsx  — main React component
  App.tsx                  — thin wrapper
  __tests__/
    engine.test.ts  — 70 unit tests (engine + parser)
docs/
  PROJECT_STATUS.md — architecture, systems, test status, known limitations
```

## Architecture decisions

- **Pure rules engine** — validation functions never mutate; execution functions always return new state via `cloneState`. The UI cannot accidentally produce partial-mutation bugs.
- **Data-driven abilities** — `ABILITY_DEFS` + `EFFECT_HANDLERS` dispatch; `executeAbility()` has no knowledge of specific ability names. Adding a new heal/damage ability requires only one ABILITY_DEFS entry.
- **Intent parser is replaceable** — `parseIntent(text, state, actorId)` has a well-defined return shape (`proposal | query | inspect | error`). A future LLM call replaces the regex-based implementation without touching any downstream code.
- **Turn cycling + enemy AI shared** — `endTurn()` and `resolveLeadingEnemyTurns()` call the same `runEnemyAI` / `executeAttack` as the player. No duplicate combat path.
- **Seeded deterministic RNG** — `mulberry32(seed)` ensures test reproducibility and lets the game produce the same encounter from the same seed.

## User preferences

- Keep `// @ts-nocheck` on engine/intent modules (prototype-style untyped code; intentional for now).
- Do not add many tiny files just for modularity — the current 4-layer split (content / rules / intent / ui) is the right level.
- GitHub remote is named `github` (not `origin`), pointing to `JerichoOmega/tabletop-platform`.
