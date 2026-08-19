import { test, expect } from "@playwright/test";

/**
 * Movement — targeting mode, reachable tile handling, state transitions
 *
 * Training Yard: Aldric (moveMax 5) at (1,3) vs Orc at (5,2).
 * No pillars — every non-occupied tile is reachable within moveMax.
 *
 * traditional.spec.ts already covers: Move → valid tile → hint clears → round 2.
 * These tests cover the remaining interaction paths:
 *   - Toggle (Move twice cancels) — already in traditional, repeated for completeness.
 *   - Out-of-range tile click: targeting hint must stay visible (move refused).
 *   - Targeting strip always pairs color with instructional text (never color-only).
 */
test.describe("Movement", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?practice&experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
  });

  test("Move button shows the green-labeled targeting status strip", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    // Status text is always paired with color (blueprint §15 / colorblind safety).
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
  });

  test("clicking Move a second time cancels targeting mode (toggle-off)", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).not.toBeVisible();
  });

  test("clicking a tile outside movement range keeps targeting mode active", async ({ page }) => {
    // Aldric is at (1,3), moveMax 5.
    // Tile (7,5): chebyshev(1,3 → 7,5) = max(6,2) = 6 > moveMax 5 → out of range.
    // The engine refuses the move; pendingAction stays 'move'; hint stays visible.
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();

    const token = page.locator('[title="Aldric"]');
    const box = await token.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Δx = 6 cells right, Δy = 2 cells down. Each cell = 52 px tile + 2 px gap = 54 px.
    await page.mouse.click(cx + 6 * 54, cy + 2 * 54);

    // Move was rejected — targeting hint must still be present.
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible({ timeout: 2_000 });
  });

  test("clicking a valid tile clears the targeting status strip", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    const token = page.locator('[title="Aldric"]');
    const box = await token.boundingBox();
    expect(box).not.toBeNull();
    // One cell to the right of Aldric — always within moveMax 5.
    await page.mouse.click(box!.x + box!.width / 2 + 54, box!.y + box!.height / 2);
    await expect(
      page.getByText("↳ Click a highlighted tile to move")
    ).not.toBeVisible({ timeout: 3_000 });
  });

  test("no Move targeting strip visible when Move mode is not active", async ({ page }) => {
    // Initial state — no pending action.
    await expect(page.getByText("↳ Click a highlighted tile to move")).not.toBeVisible();
  });
});
