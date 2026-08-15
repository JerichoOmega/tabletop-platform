---
name: Bug fixes applied to tabletop
description: The three UI/logic bugs fixed in the tabletop component and how they were fixed.
---

## Bug 1 — No auto-select of current PC (action buttons never appeared)

**Root cause:** `selectedId` initialised to `null`; action buttons require `selected && selected.id === currentActorId && isPlayerTurn` — all silently false until manual click.

**Fix:** `useEffect` keyed on `turnKey = \`${gameState.seed}-${currentActorId}\`` sets `selectedId` to `currentActorId` on every PC turn. Seed changes on `newEncounter()` so the effect fires even if the same PC wins initiative again.

## Bug 2 — Action controls below the fold

**Root cause:** Move/Attack/Ability buttons and End Turn rendered after all enemy CharacterPanels in the left column.

**Fix:** Moved the action button block and End Turn to immediately below the PARTY section CharacterPanels, above the ENEMIES heading. Also added `flexWrap: "wrap"` to the button row.

## Bug 3 — `onClick={newEncounter}` passes SyntheticEvent as encounterId

**Root cause:** `onClick={newEncounter}` on the "New Encounter" button passed the SyntheticEvent as the first argument, which is truthy, so `encounterIdRef.current = event` — corrupting the encounter id on game-over restart.

**Fix:** `onClick={() => newEncounter()}` — arrow wrapper discards the event.

## Why these must be re-applied whenever the base component is replaced

These bugs exist in the upstream v4 prototype. If the prototype is updated and the component is replaced, all three fixes must be re-applied manually.
