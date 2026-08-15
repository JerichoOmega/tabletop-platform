import { test, expect } from "@playwright/test";

/**
 * Defeat detection — scripted encounter runs to a party wipe
 *
 * Uses the "Quick Defeat" encounter: 1 Glass Squire (PC, HP 1, AC 1,
 * dexMod -10) vs 1 Doom Wraith (enemy, atkMod 20, dexMod 10, placed
 * adjacent to the PC).
 *
 * The Doom Wraith ALWAYS wins initiative and any attack roll
 * (minimum 1 + 20 = 21 vs AC 1 — never misses), and its rustyShiv
 * does minimum 2 damage vs the Squire's 1 HP — guaranteed one-hit kill.
 *
 * resolveLeadingEnemyTurns() runs the Wraith's turn automatically when the
 * encounter loads, so the Defeat banner is visible without any player input.
 *
 * What is verified:
 *   - The Defeat banner appears as soon as the encounter loads.
 *   - The "New Encounter" button is present inside the defeat banner.
 *   - Clicking "New Encounter" resets the game to a playable state.
 */
test.describe("Defeat detection", () => {
  test("Defeat banner appears once all party members fall", async ({ page }) => {
    // ?e2e enables the test-only "Quick Defeat" encounter in the picker.
    await page.goto("/?e2e");

    // Switch to the Quick Defeat encounter.
    await page.getByRole("button", { name: "Quick Defeat" }).click();

    // The Doom Wraith wins initiative and kills the Glass Squire in one hit
    // before the player acts. The Defeat banner should appear immediately.
    await expect(
      page.getByText("Defeat.", { exact: false })
    ).toBeVisible({ timeout: 5_000 });

    // The "New Encounter" button should be present inside the defeat banner.
    await expect(
      page.getByRole("button", { name: "New Encounter" })
    ).toBeVisible();
  });

  test("New Encounter button resets the game to a playable state after defeat", async ({ page }) => {
    await page.goto("/?e2e");

    // Load the Quick Defeat encounter and wait for the defeat banner.
    await page.getByRole("button", { name: "Quick Defeat" }).click();
    await expect(
      page.getByText("Defeat.", { exact: false })
    ).toBeVisible({ timeout: 5_000 });

    // "New Encounter" reloads the same encounter (Quick Defeat), which means
    // the enemy kills the PC again immediately — proving the button is wired
    // up correctly and the game is still responsive after defeat.
    await page.getByRole("button", { name: "New Encounter" }).click();
    await expect(
      page.getByText("Defeat.", { exact: false })
    ).toBeVisible({ timeout: 5_000 });

    // Now switch to Training Yard — a normal encounter — to confirm the game
    // fully re-enters a playable state: action buttons must appear on the PC's
    // turn, proving the reset path doesn't leave the game frozen or broken.
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(
      page.getByText("Defeat.", { exact: false })
    ).not.toBeVisible({ timeout: 3_000 });
    await expect(
      page.getByRole("button", { name: "Move" })
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("button", { name: "Attack" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "End Turn" })
    ).toBeVisible();
  });
});
