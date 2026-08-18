import { test, expect } from "@playwright/test";

/**
 * Active actor — ACTING badge, auto-selection, and selection side-effects
 *
 * Training Yard: 1 PC (Aldric) vs 1 Orc.
 * resolveLeadingEnemyTurns() guarantees the PC acts first on load.
 *
 * Verified:
 *  1. The ACTING badge appears on the current actor's CharacterPanel on load.
 *  2. Action buttons appear automatically — the turnKey auto-select is wired.
 *  3. Selecting an enemy CharacterPanel does NOT remove the ACTING badge from
 *     the current actor (ACTING is tied to currentActorId, not selectedId).
 *  4. After End Turn the ACTING badge transitions to the new PC when their
 *     turn resumes, completing the cycle.
 */
test.describe("Active actor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    // Action buttons appearing proves the active PC was auto-selected.
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
  });

  test("ACTING badge is visible on the current actor's panel at turn start", async ({ page }) => {
    await expect(page.getByText("ACTING")).toBeVisible();
  });

  test("action buttons appear automatically without a manual panel click", async ({ page }) => {
    // The turnKey useEffect selects the active PC automatically on every turn
    // handover. This test proves it fires on initial load without user input.
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible();
    await expect(page.getByRole("button", { name: "End Turn" })).toBeVisible();
  });

  test("clicking an enemy panel does not remove the ACTING badge", async ({ page }) => {
    // ACTING is driven by currentActorId. Clicking the enemy CharacterPanel
    // changes selectedId but never changes who is acting.
    await page.getByText("Orc").first().click();
    await expect(page.getByText("ACTING")).toBeVisible();
  });

  test("ACTING badge is present on the new PC turn after End Turn + enemy AI", async ({ page }) => {
    await page.getByRole("button", { name: "End Turn" }).click();
    // After Aldric's turn ends the Orc AI acts, then Aldric is active again.
    await expect(page.getByText(/Round 2 ·/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("ACTING")).toBeVisible({ timeout: 3_000 });
  });
});
