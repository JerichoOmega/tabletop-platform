# Intelligent Tabletop — Project Status

_Last updated: Phase 3 Milestone M1 complete — exploration mode + world-backed session (streaming world now live in gameplay)_

## Baseline (latest committed state)

| Metric | Value |
|---|---|
| Commit | Phase 3 M1 — exploration mode + world-backed session |
| Unit tests | 513 passing |
| E2E tests | 176 passing |
| TypeScript | Clean (0 errors, `--noEmit`) |
| Build | Vite production build clean |
| Visual assets | 45 total (44 production assets + 1 foundational environment asset) |

---

## Roadmap milestone status

See `docs/ROADMAP.md` for the full phase breakdown and governance rules.
**Product/design milestones (LOCKED DESIGN — not implemented functionality):**
- Platform experience philosophy: `docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md` — Intelligent Tabletop is a multi-game tabletop platform (RPG is one Experience); Discover-style Play/Browse/Library/Create/Profile navigation, Experience Cards, persistent player profile, Destiny-style earned titles, platform vs Experience data separation. The Discover system, profile, persistence, and titles remain LOCKED DESIGN — not implemented.

**IMPLEMENTED (M5): initial platform shell**
- `App.tsx → PlatformShell → destination → Experience registry`; the RPG is registered as the first Experience and mounted unchanged. Play lists registered Experiences; Browse/Library/Create/Profile/Settings exist as explicit future-functionality placeholders. See `docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md` §11.
- Core presentation & camera design direction (locked): `docs/PRESENTATION_CAMERA_DIRECTION.md` — shared tabletop perspective, Grand Gaming Table as foundational environment, zoom as a presentation transition, static-miniature phase, and the gameplay/rendering separation every future feature must preserve.

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
| 14 | Animation / tactile feedback | ✅ Done |
| 15 | Accessibility — WCAG 2.1 AA | ✅ Done |
| 16 | Automated game-engine tests | ✅ Unit suite: 93+ tests (engine, content, parser, registry, content validation); E2E suite: 133+ tests (Playwright) |
| 17 | World-scale viewport (Phase 3) | 📋 Specified — see `artifacts/tabletop/docs/WORLD_SCALE_VIEWPORT.md` |
| 18 | Visual asset library integration | ✅ Done — 44 assets registered, see `docs/VISUAL_ASSET_LIBRARY.md` |

---

## Phase 3 — World Scale & Fixed Tabletop Viewport

**Status:** Specification complete. **No implementation has occurred.**

Full technical specification: **`artifacts/tabletop/docs/WORLD_SCALE_VIEWPORT.md`**

The spec covers all 26 required sections: coordinate systems, authoritative vs presentation state, viewport model, follow/dead-zone behavior, chunk streaming, entity persistence, exploration vs tactical modes, encounter transitions, large-environment combat, world edges, rendering architecture, AI DM integration, test strategy, and a staged 10-phase implementation plan (Phase A through Phase J).

The Phase 2 test baseline (93 unit / 148 E2E) is unchanged. Phase A and Phase B of the implementation are designed to be transparent rewrites — all existing tests must pass without modification.

---

## Visual Asset Library

**Full specification:** `artifacts/tabletop/docs/VISUAL_ASSET_LIBRARY.md`

The project maintains a canonical visual asset library separate from the runtime asset registry. Approved visual assets are **not** assumed to be registered in `src/assets/registry.ts` — that registration happens independently.

| Category | Locked canonical assets |
|---|---:|
| Miniatures | 4 |
| Floor family | 6 |
| Terrain / architecture | 13 |
| Props / environment objects | 21 |
| **Foundational environment** | **1** |
| **Total** | **45** |

**Current production checkpoint:** Paused after **Lantern V1** (prop asset #44). The Grand Gaming Table V1 is an additional foundational environment asset integrated separately from the prop production sequence.

**Next proposed asset (prop sequence):** Notice Board / Quest Board V1 — not yet generated; generation begins when the visual production workflow resumes.

All 44 prop/terrain/miniature assets follow the established stylized 3D fantasy tabletop miniature aesthetic. The Grand Gaming Table V1 follows the same stylized fantasy 3D language as a foundational stage asset. Locked assets must not be redesigned, regenerated, renamed, or reinterpreted without an explicit revision request. Full style rules, the wall-family master rule, approved variation families, and the canonical approval workflow are documented in `docs/VISUAL_ASSET_LIBRARY.md`.

---

## §14 Animation / tactile feedback — implementation notes

Completed as the final Phase 2 UX item. All animation state is purely transient
presentation state — never written into `GameState`, never consulted by the rules
engine, never gating gameplay execution.

**Architecture**
- `animClasses: Record<string, string>` state maps combatant id → CSS class name.
- `triggerAnim(id, cls, durationMs)` sets the class then clears it via `setTimeout`.
- The existing `@media (prefers-reduced-motion: reduce)` rule in `RESPONSIVE_CSS`
  collapses all animation/transition durations to `0.01ms` — no duplicate overrides
  needed in the new keyframe rules.

**CSS keyframes added to `RESPONSIVE_CSS`**

| Keyframe | Class | Target | Duration |
|---|---|---|---|
| `it-move-in` | `.it-anim-move` | Moving token (new cell) | 280 ms |
| `it-strike` | `.it-anim-strike` | Attacking token | 320 ms |
| `it-hit` | `.it-anim-hit` | Damaged token (shake) | 420 ms |
| `it-miss` | `.it-anim-miss` | Evading token (opacity flicker) | 350 ms |
| `it-heal` | `.it-anim-heal` | Healed token (green glow ring) | 650 ms |
| `it-acting-pulse` | `.it-anim-acting` | New active-turn token (gold pulse) | 650 ms |
| `it-card-in` | `.it-anim-card-in` | Proposal / Query / Inspect card | 220 ms |
| `it-banner-in` | `.it-anim-banner-in` | Victory / defeat banner | 280 ms |

**Trigger points**
- `turnKey` useEffect — acting pulse fires for every new actor (PC and enemy alike).
- `handleTileClick` success — move entrance on the actor's token in its new cell.
- `handleAttackTarget` — strike on attacker; hit-shake or miss-flicker on target.
- `handleAbilityTarget` — hit-shake (damage) or heal-glow on target.
- `approveProposal` — same strike / hit / heal triggers for proposal execution path.
- Intent cards — static `className="it-anim-card-in"` on all three card root divs.
- Victory/defeat banner — static `className="it-anim-banner-in"`.

**New E2E spec**: `e2e/animation.spec.ts` — 15 tests covering keyframe presence in
injected styles, reduced-motion rule, entrance class wiring on cards and banner,
and behavioral regression for Move / Attack / End Turn / turn transition.

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
