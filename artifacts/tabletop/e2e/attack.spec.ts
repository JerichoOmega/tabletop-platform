import { test, expect } from "@playwright/test";

/**
 * Attack — targeting mode, targeting language, target validation, state clear
 *
 * Training Yard: Aldric (longbow range 6) at (1,3) vs Orc at (5,2).
 * Starting distance: chebyshev = max(4,1) = 4 ≤ 6 → Aldric can attack immediately.
 *
 * Verified:
 *  1. Attack mode shows the red-labeled hostile targeting strip.
 *  2. Attack twice cancels (toggle-off).
 *  3. Clicking a valid enemy executes the attack and clears targeting mode.
 *  4. Clicking a PC token in attack mode does NOT trigger an attack.
 *  5. After using the attack action the Attack button is disabled.
 *  6. No targeting strip visible in the default (non-targeting) state.
 */
test.describe("Attack", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible({ timeout: 5_000 });
  });

  test("Attack button shows the red-labeled hostile targeting strip", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
  });

  test("clicking Attack twice cancels targeting mode (toggle-off)", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).not.toBeVisible();
  });

  test("clicking a valid enemy target executes the attack", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();

    const orc = page.locator('[title="Orc"]');
    await expect(orc).toBeVisible({ timeout: 3_000 });
    await orc.click();

    // Targeting hint clears — attack was processed.
    await expect(
      page.getByText("↳ Click an enemy token to attack")
    ).not.toBeVisible({ timeout: 3_000 });
    // Attack readout appears with the target's name and roll details.
    await expect(page.getByText(/Orc.*d20|d20.*Orc/i)).toBeVisible({ timeout: 3_000 });
  });

  test("Attack button is disabled after the attack action is used", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Orc"]').click();
    await expect(
      page.getByText("↳ Click an enemy token to attack")
    ).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Attack" })).toBeDisabled();
  });

  test("clicking a PC token in attack mode does not perform an attack", async ({ page }) => {
    // In attack mode, clicking a PC token routes to handleSelectToken, which
    // clears pendingAction. No attack is triggered and no attack readout appears.
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();

    const aldricToken = page.locator('[title="Aldric"]');
    await aldricToken.click();

    // No attack readout — clicking an ally must never trigger an attack.
    await expect(page.getByText(/vs.*d20|d20.*vs/i)).not.toBeVisible({ timeout: 1_000 });
  });

  test("no attack targeting strip visible in the default state", async ({ page }) => {
    await expect(page.getByText("↳ Click an enemy token to attack")).not.toBeVisible();
  });
});
