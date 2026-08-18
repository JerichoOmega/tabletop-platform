import { test, expect } from "@playwright/test";

/**
 * Targeting mode transitions — entering one mode replaces the previous one
 *
 * Training Yard: 1 PC (Aldric) vs 1 Orc.
 *
 * Verified:
 *  1. Entering Attack mode while in Move mode clears the Move strip.
 *  2. Entering Move mode while in Attack mode clears the Attack strip.
 *  3. No targeting strip visible when no mode is active (clean state).
 *  4. Toggling a mode off leaves no residual strip from any other mode.
 *  5. Status text is always present when a mode is active (colorblind safety).
 *     Each mode's strip text is unambiguously distinct — the same text cannot
 *     appear for two different modes simultaneously.
 */
test.describe("Targeting mode transitions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
  });

  test("no targeting strip visible in the clean (non-targeting) state", async ({ page }) => {
    await expect(page.getByText("↳ Click a highlighted tile to move")).not.toBeVisible();
    await expect(page.getByText("↳ Click an enemy token to attack")).not.toBeVisible();
  });

  test("entering Attack while in Move replaces the Move strip with the Attack strip", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();

    // Switching to Attack must atomically swap the status strip.
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
    await expect(page.getByText("↳ Click a highlighted tile to move")).not.toBeVisible();
  });

  test("entering Move while in Attack replaces the Attack strip with the Move strip", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();

    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
    await expect(page.getByText("↳ Click an enemy token to attack")).not.toBeVisible();
  });

  test("toggling Move off leaves no residual status strip", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).not.toBeVisible();
    await expect(page.getByText("↳ Click an enemy token to attack")).not.toBeVisible();
  });

  test("toggling Attack off leaves no residual status strip", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).not.toBeVisible();
    await expect(page.getByText("↳ Click a highlighted tile to move")).not.toBeVisible();
  });

  test("status text is present for Move mode (color is always paired with text)", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    // Instructional text must appear — color alone is not sufficient (blueprint §15).
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
  });

  test("status text is present for Attack mode (color is always paired with text)", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
  });
});
