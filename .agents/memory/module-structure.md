---
name: Module structure
description: The four-module extraction of the tabletop monolith and import dependencies between layers.
---

## Current file layout

```
artifacts/tabletop/src/
  engine/
    content.ts      — MAP_DEFS, WEAPON_DEFS, COMBATANT_DEFS, ABILITY_DEFS,
                      EFFECT_HANDLERS, ENCOUNTER_DEFS, mulberry32, rollDie,
                      createCombatantInstance, rollInitiative, buildEncounter
    rules.ts        — isWall, isPillar, isBlocked, key, reachableTiles,
                      lineTiles, lineOfSight, chebyshev, occupiedSet,
                      validateMove, validateAttack, isValidAbilityTarget,
                      validateAbility, cloneState, executeMove, executeAttack,
                      executeAbility, endTurn, checkEncounterStatus,
                      runEnemyAI, resolveLeadingEnemyTurns
  intent/
    parser.ts       — parseIntent (exported), revalidateProposal (exported),
                      executeProposalSteps (exported), exampleTargetPhrase (exported)
  ui/
    primitives.tsx  — ClassIcon, HpBar, CharacterPanel, actionBtnStyle, FONT_IMPORT
  IntelligentTabletop.tsx  — main React component (imports from all layers)
  App.tsx                  — renders <IntelligentTabletop /> from @/IntelligentTabletop
  __tests__/
    engine.test.ts  — 70 unit tests
```

## Dependency graph

- `content.ts` → nothing
- `rules.ts` → `content.ts` (ABILITY_DEFS, EFFECT_HANDLERS, rollDie)
- `intent/parser.ts` → `content.ts` (ABILITY_DEFS) + `rules.ts` (validate*, execute*, pathfinding)
- `ui/primitives.tsx` → lucide-react only
- `IntelligentTabletop.tsx` → all three engine layers + primitives

## Why

Spec required CONTENT / ENGINE / INTENT / UI separation for testability (engine is pure JS, no React) and replaceability (parseIntent can be swapped for an LLM call without touching anything downstream).
