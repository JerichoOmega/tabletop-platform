# Intelligent Tabletop — Project Status

_Last updated: accessibility pass commit (post tablet-responsive baseline)_

## Baseline (latest committed state)

| Metric | Value |
|---|---|
| Commit | `a10c634` — Import tablet-first responsive UX |
| Unit tests | 93 passing |
| E2E tests | 133 passing (92 pre-existing + 41 accessibility) |
| TypeScript | Clean (0 errors, `--noEmit`) |
| Build | Vite production build clean |

---

## Roadmap milestone status

See `docs/ROADMAP.md` for the full phase breakdown and governance rules.

| § | Milestone | Status |
|---|---|---|
| 1 | Project scaffold & monorepo | ✅ Done |
| 2 | Game engine — content layer | ✅ Done |
| 3 | Game engine — rules layer | ✅ Done |
| 4 | Intent parser | ✅ Done |
| 5 | Asset registry seam | ✅ Done |
| 6 | UI primitives | ✅ Done |
| 7 | Main component (Traditional mode) | ✅ Done |
| 8 | Assisted mode + intent cards | ✅ Done |
| 9 | Adventure mode stub | ✅ Done |
| 10 | Session log | ✅ Done |
| 11 | Full type safety (engine/rules, intent/parser, main component) | ✅ Done |
| 12 | Tablet-first responsive layout | ✅ Done |
| 13 | Keyboard navigation + ARIA roles | ✅ Done |
| 14 | Visual polish pass | ⬜ Pending |
| 15 | Accessibility — WCAG 2.1 AA | ✅ Done |
| 16 | Automated game-engine tests | ⬜ Pending |
| 17 | World-scale viewport (Phase 2) | ⬜ Future phase |

---

## §15 Accessibility — implementation notes

Completed in the accessibility pass. Changes made to `src/IntelligentTabletop.tsx`:

**Semantic structure**
- Encounter name: `role="heading" aria-level={1}`
- PARTY, ENEMIES, INITIATIVE, SESSION LOG: `role="heading" aria-level={2}`
- Initiative container: `aria-label="Initiative order"`
- Proposal, query, inspect cards: `role="region"` with descriptive `aria-label`

**Live regions**
- Transient banner: `role="alert"`
- Victory/Defeat banner: `role="alert"`
- Round/turn subtitle: `aria-live="polite" aria-atomic="true"`
- Session log: `role="log" aria-label="Session log" aria-live="polite" aria-atomic="false"`
- Persistent targeting live region: `role="status" className="sr-only"` — announces
  targeting mode changes to screen readers without visual UI change

**Action controls**
- Mode buttons (Traditional/Assisted/Adventure): `aria-pressed`
- Encounter switcher buttons: `aria-pressed`
- Move, Attack, and ability buttons: `aria-pressed`
- Attack and ability buttons when disabled: `aria-label` includes reason
  (e.g. "Attack, action already used this turn")
- Assisted mode text input: `aria-label="Describe your action in plain language"`

**Board tokens**
- Keyboard focusable: `tabIndex={tok.alive ? 0 : -1}`
- Enter/Space activates the same logic as click (`onKeyDown` handler)
- Rich `aria-label` via `buildTokenAriaLabel()`: name + acting/selected state +
  targeting validity ("valid target", "can be hit", "can be targeted", "out of range") + HP

**Focus visibility & motion**
- `:focus-visible` gold ring (`#c9a227`, 2px, offset 2px) on all interactive elements
- `.sr-only` utility class added to `RESPONSIVE_CSS`
- `@media (prefers-reduced-motion: reduce)` suppresses transitions/animations within `.it-root`

**New E2E spec**: `e2e/accessibility.spec.ts` — 41 tests covering keyboard nav,
board token roles, aria-label content, heading structure, section regions,
assisted mode input, proposal/query/inspect card keyboard operability,
session log role, and disabled button accessible state.

---

## Known gaps (acknowledged, not regressions)

- Board **tiles** are not keyboard-navigable for move selection — they lack
  `tabIndex` and `onKeyDown`. Tile keyboard nav requires significant grid-focus
  management and is deferred to a dedicated keyboard-nav hardening pass.
- `role="button"` on token `div`s is correct but `div` semantics are weaker than
  native `<button>` elements. Migrating tokens to `<button>` is a future refactor.
- Focus is not automatically moved into proposal/query/inspect cards when they
  appear — users must Tab to reach them. Auto-focus was intentionally omitted
  per the "do not steal focus" principle unless it materially improves flow.
