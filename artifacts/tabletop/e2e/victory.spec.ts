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

  // Regression: after the final enemy fell, victory was detected but the turn
  // system could keep advancing (endTurn had no terminal guard). This test
  // plays the real combat flow to victory, then asserts the turn cycle STOPS.
  test("after victory the turn cycle stops and the player can continue", async ({
    page,
  }) => {
    await page.goto("/?e2e&experience=rpg");
    await page.getByRole("button", { name: "Quick Battle" }).click();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible({
      timeout: 5_000,
    });

    // Capture the turn indicator before the kill (Round N · X's turn).
    const turnIndicator = page.getByText(/Round \d+ ·/);
    await expect(turnIndicator).toBeVisible();
    const beforeKill = (await turnIndicator.textContent()) ?? "";

    // Real lifecycle: attack → final enemy dies → victory.
    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Target Dummy"]').click();
    await expect(page.getByText("Victory!", { exact: false })).toBeVisible({
      timeout: 5_000,
    });

    // 1. No further turn is generated: combat action controls are gone…
    await expect(page.getByRole("button", { name: "End Turn" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Attack" })).toHaveCount(0);

    // …and the turn/round indicator does not advance. Give any stray
    // async turn-advancement a moment to fire before re-reading.
    await page.waitForTimeout(750);
    const afterVictory = (await turnIndicator.textContent()) ?? "";
    expect(afterVictory).toBe(beforeKill);

    // 2. No duplicate completion: exactly one Victory banner.
    await expect(page.getByText(/Victory!/)).toHaveCount(1);

    // 3. The player can continue normally from the terminal state.
    await page.getByRole("button", { name: "New Encounter" }).click();
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(/Victory!/)).toHaveCount(0);
  });
});
