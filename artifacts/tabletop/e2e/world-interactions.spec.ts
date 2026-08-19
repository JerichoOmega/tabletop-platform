import { test, expect, type Page } from "@playwright/test";

/**
 * M8 — World Interactions.
 *
 * The overworld contains different kinds of locations: combat (Ruined Crypt /
 * Training Yard), rest (Wayside Camp), and discovery (Old Shrine). A location
 * is NOT automatically combat. Each is discovered by moving through the world
 * and interacted with via a contextual prompt or its keyboard-focusable marker.
 *
 * Deterministic fixture facts (EXPLORE_WORLD_SEED = 20260817):
 *   • Party spawns at (8, 8); rows 6–8 are floor across the corridor.
 *   • Wayside Camp at (10, 6); Old Shrine at (14, 6).
 */

const TILE = '[data-testid="board-tile"]';
const LOCATION = '[data-testid="exploration-location"]';
const OVERLAY = '[data-testid="interaction-overlay"]';

async function enterExploration(page: Page) {
  await page.goto("/?experience=rpg");
  await expect(page.locator(LOCATION)).toBeVisible({ timeout: 8_000 });
}

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

async function stepPath(page: Page, path: [number, number][]) {
  for (const [wx, wy] of path) await stepTo(page, wx, wy);
}

test.describe("World interactions — a location is not automatically combat", () => {
  test("Camp is a peaceful rest location: no combat, party heals, returns to exploration", async ({ page }) => {
    await enterExploration(page);
    // Approach the Wayside Camp at (10, 6) → stand at (10, 7).
    await stepPath(page, [[9, 8], [10, 8], [10, 7]]);

    const prompt = page.locator('[data-testid="enter-location"]');
    await expect(prompt).toContainText("Rest at Camp");
    await prompt.click();

    // A rest card appears — NOT a combat encounter.
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(OVERLAY)).toContainText("fully rested");
    await expect(page.getByRole("heading", { name: "INITIATIVE", exact: true })).toHaveCount(0);

    // Return to the world.
    await page.locator('[data-testid="return-from-interaction"]').click();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator(LOCATION)).toContainText("(10, 7)");
  });

  test("Shrine grants a one-time blessing and cannot be farmed in a session", async ({ page }) => {
    await enterExploration(page);
    // Approach the Old Shrine at (14, 6) → stand at (14, 7).
    await stepPath(page, [[9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 7]]);

    const prompt = page.locator('[data-testid="enter-location"]');
    await expect(prompt).toContainText("Investigate Shrine");

    // First investigation → deterministic blessing.
    await prompt.click();
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(OVERLAY)).toContainText("Blessing of Vigor");
    await expect(page.locator(OVERLAY)).toContainText("maximum HP +5");
    await page.locator('[data-testid="return-from-interaction"]').click();
    await expect(page.locator(OVERLAY)).toHaveCount(0);

    // Second investigation → already given, no repeat reward.
    await expect(prompt).toContainText("Investigate Shrine");
    await prompt.click();
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(OVERLAY)).toContainText("already been given");
    await expect(page.locator(OVERLAY)).not.toContainText("maximum HP +5");
    await page.locator('[data-testid="return-from-interaction"]').click();
    await expect(page.locator(LOCATION)).toContainText("(14, 7)");
  });

  test("location markers are keyboard-focusable and activatable", async ({ page }) => {
    await enterExploration(page);
    await stepPath(page, [[9, 8], [10, 8], [10, 7]]);

    const marker = page.locator('[data-testid="location-marker"][data-location-id="camp"]');
    await expect(marker).toBeVisible();
    // Accessible name communicates the place, its kind, and that it is in range.
    await expect(marker).toHaveAttribute("aria-label", /Wayside Camp, rest location.*in range/);

    // Focus the marker and activate it from the keyboard alone.
    await marker.focus();
    await expect(marker).toBeFocused();
    await marker.press("Enter");

    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(OVERLAY)).toContainText("fully rested");
    await page.locator('[data-testid="return-from-interaction"]').click();
    await expect(page.locator(OVERLAY)).toHaveCount(0);
  });

  test("an out-of-range marker announces its state and does not interact", async ({ page }) => {
    await enterExploration(page);
    // Stay at spawn (8, 8); the Wayside Camp at (10, 6) is visible but 2 tiles away.
    const camp = page.locator('[data-testid="location-marker"][data-location-id="camp"]');
    await expect(camp).toHaveAttribute("aria-label", /Wayside Camp, rest location.*out of range/);
    await camp.focus();
    await camp.press("Enter");
    // No interaction card — just a hint, world unchanged.
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    await expect(page.locator(LOCATION)).toBeVisible();
  });
});
