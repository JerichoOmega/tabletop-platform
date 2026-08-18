import { test, expect } from "@playwright/test";

/**
 * Victory detection — scripted encounter runs to completion
 *
 * Uses the "Quick Battle" encounter: 1 Fighter vs a Target Dummy (HP 1, AC 1,
 * initiative modifier -10).  The fighter ALWAYS wins initiative and any attack
 * roll — even a natural 1 + atkMod 5 = 6 — clears the dummy's 1 HP in one
 * hit.  This makes the test fully deterministic without any RNG dependency.
 *
 * What is verified:
 *   - The Victory banner appears as soon as the last enemy is defeated.
 *   - The "New Encounter" button is present inside the banner.
 */
test.describe("Victory detection", () => {
  test("Victory banner appears once all enemies are defeated", async ({ page }) => {
    // ?e2e enables the test-only "Quick Battle" encounter in the picker.
    await page.goto("/?e2e&experience=rpg");

    // Switch to the Quick Battle encounter (deterministic 1-hit win).
    await page.getByRole("button", { name: "Quick Battle" }).click();

    // resolveLeadingEnemyTurns ensures the PC always goes first after load.
    await expect(
      page.getByRole("button", { name: "Attack" })
    ).toBeVisible({ timeout: 5_000 });

    // Enter attack-targeting mode.
    await page.getByRole("button", { name: "Attack" }).click();

    // Confirm targeting hint appears.
    await expect(
      page.getByText("↳ Click an enemy token to attack")
    ).toBeVisible({ timeout: 3_000 });

    // The Target Dummy token is on the grid — click it.
    const dummyToken = page.locator('[title="Target Dummy"]');
    await expect(dummyToken).toBeVisible({ timeout: 3_000 });
    await dummyToken.click();

    // The dummy has 1 HP and AC 1: the very first attack kills it.
    // Wait for the Victory banner — it appears as soon as the enemy falls.
    await expect(
      page.getByText("Victory!", { exact: false })
    ).toBeVisible({ timeout: 5_000 });

    // The "New Encounter" button should be present inside the victory banner.
    await expect(
      page.getByRole("button", { name: "New Encounter" })
    ).toBeVisible();
  });
});
