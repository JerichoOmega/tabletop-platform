import { test, expect, type Page } from "@playwright/test";

/**
 * Location discovery — locations are WORLD CONTENT, not navigation.
 *
 * A normal player enters the RPG straight into exploration, discovers a place
 * by moving the party through the world, and enters it via a contextual
 * prompt ("Enter Ruined Crypt"). The place opens as a focused in-world combat
 * delve; resolving it returns the party to exploration at its world position.
 *
 * Deterministic fixture facts (EXPLORE_WORLD_SEED = 20260817):
 *   • Party spawns at (8, 8); row 8 is floor from wx=8..21.
 *   • Ruined Crypt location sits one tile off the corridor at (12, 7); the
 *     party discovers it while walking row 8 (Chebyshev-adjacent near wx=12).
 */

const TILE = '[data-testid="board-tile"]';
const LOCATION = '[data-testid="exploration-location"]';

async function enterExploration(page: Page) {
  await page.goto("/?experience=rpg");
  await expect(page.locator(LOCATION)).toBeVisible({ timeout: 8_000 });
}

/** Steps onto (wx, wy), retrying while the destination chunk streams in. */
async function stepTo(page: Page, wx: number, wy: number) {
  await expect
    .poll(
      async () => {
        await page.locator(`${TILE}[data-world-wx="${wx}"][data-world-wy="${wy}"]`).click();
        return page.locator(LOCATION).textContent();
      },
      { timeout: 10_000 },
    )
    .toContain(`(${wx}, ${wy})`);
}

/** Walks east to (11, 8) — one tile west of the Ruined Crypt at (12, 8). */
async function approachCrypt(page: Page) {
  for (let wx = 9; wx <= 11; wx++) await stepTo(page, wx, 8);
}

test.describe("Location discovery — locations are world content", () => {
  test("locations render as world markers, not navigation tabs", async ({ page }) => {
    await enterExploration(page);
    // Marker present in the world; NOT a permanent nav row.
    await expect(page.locator('[data-testid="location-marker"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="dev-encounter-switcher"]')).toHaveCount(0);
    // No contextual prompt until the party is beside a place.
    await expect(page.locator('[data-testid="enter-location"]')).toHaveCount(0);
  });

  test("approaching a location reveals a contextual enter prompt", async ({ page }) => {
    await enterExploration(page);
    await approachCrypt(page);
    const prompt = page.locator('[data-testid="enter-location"]');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText("Enter Ruined Crypt");
  });

  test("entering a location opens a focused combat delve", async ({ page }) => {
    await enterExploration(page);
    await approachCrypt(page);
    await page.locator('[data-testid="enter-location"]').click();

    // The delve is the Ruined Crypt encounter — combat is live and focused.
    await expect(page.getByRole("heading", { name: "Ruined Crypt" })).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("heading", { name: "INITIATIVE", exact: true })).toBeVisible();
    // Combat owns the screen: no developer navigation, no world markers.
    await expect(page.locator('[data-testid="dev-encounter-switcher"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="location-marker"]')).toHaveCount(0);
    // It is a MapDef delve, not a dev practice picker.
    await expect(page.getByRole("button", { name: "New Encounter" })).toHaveCount(0);
  });

  test("resolving a location delve returns the party to exploration in place", async ({ page }) => {
    await enterExploration(page);
    await approachCrypt(page);
    await page.locator('[data-testid="enter-location"]').click();
    await expect(page.getByRole("heading", { name: "Ruined Crypt" })).toBeVisible({ timeout: 8_000 });

    // Fight to a terminal state. Victory returns to exploration automatically;
    // defeat shows a "Leave …" acknowledgement. Either way the party ends back
    // in the world at its pre-delve position — assert the shared invariant.
    for (let i = 0; i < 80; i++) {
      if (await page.locator(LOCATION).isVisible()) break; // auto victory-return
      const leave = page.locator('[data-testid="leave-location"]');
      if (await leave.isVisible()) { await leave.click(); break; }

      const attackBtn = page.getByRole("button", { name: "Attack" });
      if (await attackBtn.isVisible()) {
        await attackBtn.click();
        const goblin = page.locator('[title="Goblin"]').first();
        if (await goblin.isVisible()) await goblin.click();
        const endTurn = page.getByRole("button", { name: "End Turn" });
        if (await endTurn.isVisible()) await endTurn.click();
      } else {
        await page.waitForTimeout(200);
      }
    }

    await expect(page.locator(LOCATION)).toBeVisible({ timeout: 8_000 });
    // Party resumed at the tile it entered from (11, 8) — world position intact.
    await expect(page.locator(LOCATION)).toContainText("(11, 8)");
    // Back in the world: markers reappear, developer navigation stays absent.
    await expect(page.locator('[data-testid="location-marker"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="dev-encounter-switcher"]')).toHaveCount(0);
  });
});
