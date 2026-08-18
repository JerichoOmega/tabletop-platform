import { test, expect } from "@playwright/test";

/**
 * Traditional mode — gameplay interactions
 *
 * Scenario: Training Yard (1 PC: Aldric, 1 enemy: Orc) — the simplest
 * possible encounter that avoids multi-enemy complication.
 *
 * Steps verified:
 *   1. App loads and encounter buttons are visible.
 *   2. Action buttons (Move, Attack, End Turn) appear on the PC's turn.
 *   3. Clicking Move puts the UI into targeting mode (hint text appears).
 *   4. Clicking a reachable tile moves the actor (hint text clears).
 *   5. Clicking End Turn advances the round counter.
 */
test.describe("Traditional mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?experience=rpg");
    // Switch to the Training Yard — 1 PC vs 1 enemy, open map, no pillars.
    await page.getByRole("button", { name: "Training Yard" }).click();
    // resolveLeadingEnemyTurns guarantees we always land on a PC turn.
    await expect(
      page.getByRole("button", { name: "Move" })
    ).toBeVisible({ timeout: 5_000 });
  });

  test("action buttons are visible on the player turn", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible();
    await expect(page.getByRole("button", { name: "End Turn" })).toBeVisible();
  });

  test("clicking Move shows the targeting hint", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await expect(
      page.getByText("↳ Click a highlighted tile to move")
    ).toBeVisible();
  });

  test("clicking Move twice cancels targeting mode", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await expect(
      page.getByText("↳ Click a highlighted tile to move")
    ).toBeVisible();
    // Second click on Move toggles it off
    await page.getByRole("button", { name: "Move" }).click();
    await expect(
      page.getByText("↳ Click a highlighted tile to move")
    ).not.toBeVisible();
  });

  test("Move → click tile → turn advances to Round 2", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await expect(
      page.getByText("↳ Click a highlighted tile to move")
    ).toBeVisible();

    // Locate Aldric's token and click the tile one cell to its right.
    // Tile cells are 52 px wide with a 2 px gap → adjacent cell centre is 54 px away.
    const token = page.locator('[title="Aldric"]');
    const box = await token.boundingBox();
    expect(box).not.toBeNull();

    const tokenCenterX = box!.x + box!.width / 2;
    const tokenCenterY = box!.y + box!.height / 2;
    // Click the tile immediately to the right of Aldric (x+54, same y)
    await page.mouse.click(tokenCenterX + 54, tokenCenterY);

    // Move succeeded → targeting hint clears
    await expect(
      page.getByText("↳ Click a highlighted tile to move")
    ).not.toBeVisible({ timeout: 3_000 });

    // End the player turn
    await page.getByRole("button", { name: "End Turn" }).click();

    // After the enemy resolves its turn the round counter increments.
    // Match the header format "Round 2 · …" to avoid ambiguity with the log.
    await expect(page.getByText(/Round 2 ·/)).toBeVisible({ timeout: 5_000 });

    // PC's turn starts again — action buttons should reappear
    await expect(
      page.getByRole("button", { name: "Move" })
    ).toBeVisible({ timeout: 5_000 });
  });
});
