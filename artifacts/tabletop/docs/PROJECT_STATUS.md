# Intelligent Tabletop — Project Status

_Last updated: Streamlined RPG equipment and consumables foundation complete (working tree; not committed)_

## Baseline (latest committed state)

| Metric | Value |
|---|---|
| Commit | Phase 3 M1 — exploration mode + world-backed session |
| Unit tests | 710 passing before this equipment work; 724 passing in current working tree |
| E2E tests | 192 passing before this equipment work; 193 passing in current working tree |
| TypeScript | Clean (0 errors, `--noEmit`) |
| Build | Vite production build clean |
| Visual assets | 45 total (44 production assets + 1 foundational environment asset) |

---

## Streamlined RPG equipment foundation

The RPG Experience now has a small, authoritative equipment model without
introducing a second persistence system or a full inventory UI.

### Canonical rules

- `EQUIPMENT_DEFS` is the single item registry for weapons, armor, accessories,
  consumables, and mission items. The legacy weapon shape is a compatibility
  projection only; combat reads canonical weapon stats through the existing
  combatant snapshot.
- A combatant carries one weapon, one armor item, one accessory, bounded
  consumable quantities, mission-item IDs, and spent-accessory IDs. There is no
  unequipped equipment backpack in this foundation; authored equipable
  acquisitions immediately replace the item in that slot.
- Consumable quantities are integer, non-negative, and validated against each
  definition's cap. Healing Potion has a maximum quantity of 3 and restores a
  fixed 6 HP.
- `executeConsumable` is the authoritative tactical-use path: it validates the
  acting turn, ownership, item category, and action availability; consumes one
  item; uses an action; and caps healing at maximum HP.
- Armor contributes a readable AC bonus. Accessories are conditional passives;
  the initial Watchful Charm grants +2 AC below half HP. The movement helper is
  available for authored armor tradeoffs, while the initial armor set has no
  movement penalty.
- Acquisition is authored by `AcquisitionSource` on each item. There is no
  procedural loot or random stat generation.
- World-backed encounters receive the RPG party loadout through an explicit
  conversion option. `WorldEntity` remains generic, and the loadout survives
  exploration → combat → exploration through the RPG session boundary.

### Explicit non-goals

Crafting, durability, weight, randomized stat soup, a large inventory or
shop screen, procedural loot generation, new persistence architecture, and
platform-wide equipment state are intentionally out of scope.

The compact in-combat presentation shows weapon, armor, accessory, movement,
effective AC, and Healing Potion quantity. The full rules foundation is unit
tested; the player-facing contract has one focused Playwright acceptance test.

---

## Roadmap milestone status

See `docs/ROADMAP.md` for the full phase breakdown and governance rules.
**Product/design milestones (LOCKED DESIGN — not implemented functionality):**
- Platform experience philosophy: `docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md` — Intelligent Tabletop is a multi-game tabletop platform (RPG is one Experience); Discover-style Play/Browse/Library/Create/Profile navigation, Experience Cards, persistent player profile, Destiny-style earned titles, platform vs Experience data separation. The Discover system, profile, persistence, and titles remain LOCKED DESIGN — not implemented.

**IMPLEMENTED (M5): initial platform shell**
- `App.tsx → PlatformShell → destination → Experience registry`; the RPG is registered as the first Experience and mounted unchanged. Play lists registered Experiences; Browse/Library/Create/Profile/Settings exist as explicit future-functionality placeholders. See `docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md` §11.

**IMPLEMENTED (M7 / Phase 3 M5): seamless exploration ↔ combat loop**
- Exploration is the primary game state: a normal RPG session launches directly into the streaming world (no encounter picker). Walking adjacent to a hostile deterministically starts a world-backed battle built from world entities at world coordinates; the existing combat engine runs it; victory commits results via `WorldState.endEncounter` and **automatically** returns the party to exploration at the battle location (banner shows ~1.4s; "Continue Exploring" skips immediately). Defeat is an explicit acknowledgement ("Awaken at Camp"): the party respawns at the exploration spawn with full HP while all other world consequences persist. The MapDef encounter picker is preserved as developer/test tooling only, reachable via "Return to Encounter" or the `?practice` URL flag (`?e2e` implies practice entry for the combat test suites).

**IMPLEMENTED (M8): world-first player navigation**
- Player-facing RPG navigation was refactored so the world *is* the navigation system (see `docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md` §12). The permanent location-navigation tab row (`Return to Encounter` / `Ruined Crypt` / `Training Yard`) no longer renders for normal players; it is gated behind the practice/dev pathway (`?practice`, or `?e2e` for combat suites) as `data-testid="dev-encounter-switcher"`. **Locations are world content:** the former Ruined Crypt / Training Yard tabs are now discoverable points of interest (`EXPLORE_LOCATIONS` in `engine/exploration.ts`) drawn as highlighted map markers; approaching one reveals a contextual "Enter …" prompt that opens the place as a focused in-world combat delve which returns to exploration on resolution. Locations are presentation metadata only — never registered in the `WorldEntityRegistry`, never seen by encounter detection, and they do not alter movement or terrain. The three interaction modes (Traditional / Assisted / Adventure) became a low-weight preference control (`data-testid="interaction-mode"`) available during exploration and combat, and the player's chosen mode now carries into a wilderness battle. Engine systems (WorldState, streaming, encounter detection, combat lifecycle, `endEncounter`, deterministic RNG, platform shell) were left intact.

**IMPLEMENTED (M8 — World Interactions): a location is not automatically combat**
- The overworld now proves the world-interaction model (`docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md` §12.1): a location carries a generic `kind` (`combat` | `rest` | `discovery`) and the RPG runs the matching behavior. Three examples ship: **Ruined Crypt / Training Yard** (combat delve), **Wayside Camp** (rest — a non-combat atmospheric card restores full HP), and **Old Shrine** (discovery — a one-time deterministic Blessing of Vigor: `+5` max HP and full heal, marked used per session so it cannot be farmed). Rest/discovery resolve as a tabletop card laid over the table (no browser modal, no combat, no `sessionMode` change); combat delves are unchanged. Discovered markers are fully keyboard-accessible (`role="button"`, focusable, Enter/Space) with range-aware accessible names; mouse/touch and the side prompt continue to work. New generic helper `WorldEntityRegistry.setMaxHp` mirrors `setHp`; combat lifecycle, encounter detection, `endEncounter`, deterministic RNG, streaming, and world bounds are untouched.

**IMPLEMENTED (M6): Experience contract & platform/Experience boundary**
- Authoritative contract: `docs/EXPERIENCE_CONTRACT.md`. Experience definitions carry validated `version`, generic hosting `capabilities`, and `players` range; the shell provides a minimal platform context (`experienceId`, `experienceVersion`, `requestExit`); Experience crashes are contained by a launch-failure boundary that returns the player to the shell. RPG conforms through registration alone — engine/renderer untouched. Second-Experience thought experiments (strategy, hidden-information card game) pass without platform changes.
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
