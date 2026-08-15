---
name: Test setup for tabletop
description: How vitest is configured for the tabletop artifact and how to run tests.
---

## Configuration

- `artifacts/tabletop/vitest.config.ts` — `environment: "node"`, `globals: true`, `@/` alias → `./src`
- `artifacts/tabletop/package.json` scripts: `"test": "vitest run --config vitest.config.ts"`
- Test file: `artifacts/tabletop/src/__tests__/engine.test.ts`
- `tsconfig.json` already excludes `**/*.test.ts` from typecheck

## Run

```
pnpm --filter @workspace/tabletop test
```

## What is tested

70 tests covering: RNG, combatant factory, encounter building, initiative, map utilities, pathfinding, LOS, chebyshev, all validate* functions, isValidAbilityTarget, cloneState, all execute* functions, endTurn, checkEncounterStatus, runEnemyAI, resolveLeadingEnemyTurns, intent parser (parseIntent, revalidateProposal, executeProposalSteps), exampleTargetPhrase, and a full Ruined Crypt encounter regression.

## Why node environment

Engine and intent parser are pure JS with no DOM/React dependencies. Node environment is faster and sufficient.
