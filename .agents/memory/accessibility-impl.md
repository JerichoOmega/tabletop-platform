---
name: Accessibility implementation
description: ARIA roles, keyboard nav, focus styles added in the accessibility pass; board token aria-label collision trap to avoid.
---

## Key decisions

**Board token aria-label phrasing — collision trap**
When attack targeting is active, board tokens get a phrase indicating they can be attacked.
The phrase must NOT contain the word "attack" (case-insensitive substring). Playwright's
`getByRole("button", { name: "Attack" })` does substring matching, so any token whose
aria-label contains "attack" becomes a false match, breaking existing E2E tests that
click the Attack button a second time (toggle-off tests).

Safe phrasing used:
- Attack mode, valid enemy → `"can be hit"` (not "valid attack target")
- Ability mode, valid target → `"can be targeted"` (not "valid ability target")
- Ability mode, invalid target → `"out of range"` (not "not a valid ability target")

**Why:** Pre-existing tests `attack.spec.ts:29` and `targeting-transitions.spec.ts:55`
use `getByRole("button", { name: "Attack" }).click()` which strict-mode-fails if any
other role=button element has "attack" in its accessible name.

**How to apply:** Any future state communicated via board token aria-label must not
use the word "attack", "move", or any other exact button name in the UI, as a substring.

---

## What was added (commit aafb5a9)

**RESPONSIVE_CSS additions:**
- `:focus-visible` — 2px gold ring (`#c9a227`) on buttons, [role="button"], inputs, [tabindex="0"]
- `.sr-only` — visually-hidden utility class
- `@media (prefers-reduced-motion: reduce)` — suppresses all transitions/animations within `.it-root`

**IntelligentTabletop.tsx structural changes:**
- `buildTokenAriaLabel(tok)` function (inside component, before GRID RENDERING HELPERS)
  — rich aria-label: name + acting/selected + targeting state + HP
- `role="alert"` on transient banner and victory/defeat banner
- `role="heading" aria-level={1}` on encounter name div
- `aria-live="polite" aria-atomic="true"` on round/turn subtitle
- `role="heading" aria-level={2}` on PARTY, ENEMIES, INITIATIVE, SESSION LOG labels
- `aria-label="Initiative order"` on initiative container
- `aria-pressed` on mode buttons, encounter switcher buttons, Move, Attack, ability buttons
- `aria-label` with reason on disabled Attack and ability buttons
- Persistent `role="status" className="sr-only"` live region inside action bar
  — announces targeting mode changes (content: empty string when no mode active)
- Board tokens: `tabIndex={tok.alive ? 0 : -1}`, `onKeyDown` (Enter/Space = click logic)
- Session log: `role="log" aria-live="polite" aria-atomic="false" aria-label="Session log"`
- Assisted mode input: `aria-label="Describe your action in plain language"`
- Proposal/query/inspect cards: `role="region"` with descriptive `aria-label`

**E2E spec:** `e2e/accessibility.spec.ts` — 41 tests.
Board token queries in this spec are scoped to `.it-board-col` to avoid matching
the CharacterPanel sidebar buttons (which also expose role=button with combatant names).

**Known gaps (documented in PROJECT_STATUS.md):**
- Board tiles not keyboard-navigable for move selection (deferred)
- Token divs use `role="button"` rather than native `<button>` (future refactor)
- Proposal/query/inspect cards don't auto-focus on appearance (intentional)
