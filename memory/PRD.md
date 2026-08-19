# Intelligent Tabletop — PRD / Working Memory

## Original problem statement
Redesign the player-facing navigation and presentation of the RPG Experience so
the RPG feels like ONE continuous tabletop adventure (world-first), not a set of
developer screens/tabs. Preserve all engine systems. Do not rebuild.

Mental model: Platform → Tabletop RPG → Current Adventure → World → Exploration →
Encounter → Combat → back to Exploration. **The world is the navigation system.**

## Stack / where it lives
- Monorepo (pnpm), app at `artifacts/tabletop` — React 19 + Vite + TypeScript.
- Requires **Node 22** and arm64 native binaries (this container is aarch64; the
  repo's `pnpm-workspace.yaml` strips arm64 rollup/esbuild/lightningcss/oxide —
  to run locally, temporarily allow the `*-linux-arm64-gnu` variants, then
  `pnpm install`; revert before committing).
- Run dev: `PORT=22382 BASE_PATH=/ pnpm --filter @workspace/tabletop run dev`.
- Build: `PORT=22382 BASE_PATH=/ pnpm build`. Typecheck: `pnpm typecheck`.
- Tests: `pnpm test` (vitest), `pnpm exec playwright test` (E2E, reuses :22382).

## Core rules (locked)
- Locations and encounters are WORLD CONTENT, not top-level RPG navigation.
- Developer/test encounter selection is SEPARATE from normal player navigation
  (gated behind `?practice` / `?e2e`).
- Interaction modes (Traditional/Assisted/Adventure) = low-weight preference.
- Engine untouched: WorldState, streaming, chunk mgmt, entity registry,
  exploration movement, encounter detection, combat rules/lifecycle,
  endEncounter, deterministic RNG, Experience Contract, Platform Shell.

## Implemented (M8 — world-first player navigation) — 2026-08-19
- Removed the permanent location-nav tab row from normal play; gated behind
  `data-testid="dev-encounter-switcher"` (practice/dev only).
- Locations → in-world POI markers (`EXPLORE_LOCATIONS`, presentation-only) with
  proximity highlight + contextual "Enter …" prompt → focused MapDef combat
  delve → auto-return to exploration on victory (click "Leave …" on defeat).
- Interaction-mode selector restyled low-weight (`data-testid="interaction-mode"`),
  available in exploration + combat; chosen mode carries into wilderness battle.
- Exploration presentation reworded world-first; world/table is dominant.

## Validation (2026-08-19)
- Unit: 701 passed (vitest). E2E: 195 passed (Playwright). TypeScript: 0 errors.
  Production build: clean (vite).

## Backlog / next
- P1: give location markers a first-class keyboard focus path (currently the
  panel "Enter …" button is the accessible action; marker is role="img").
- P2: more location kinds (Camp, Shrine) + non-combat interactions.
- P2: a discoverable in-UI Practice Mode entry (currently URL-flag only).
