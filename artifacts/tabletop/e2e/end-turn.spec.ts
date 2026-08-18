import { test, expect } from "@playwright/test";

/**
 * End Turn — turn advancement, actor transition, action state isolation
 *
 * Training Yard: 1 PC (Aldric) vs 1 Orc.
 *
 * Verified:
 *  1. End Turn is in the primary (Tier 1) action row alongside Move and Attack.
 *  2. Clicking End Turn advances the encounter (enemy AI runs, round increments).
 *  3. The new PC turn starts with ACTING state and action buttons — no manual click.
 *  4. Pending targeting mode from the previous turn does NOT carry over (state isolation).
 *  5. The Attack action resets (re-enabled) for each new turn.
 */
test.describe("End Turn", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
  });

  test("End Turn button is in the primary action row alongside Move and Attack", async ({ page }) => {
    // Blueprint §5: End Turn is always in Tier 1 — never hidden behind abilities.
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible();
    await expect(page.getByRole("button", { name: "End Turn" })).toBeVisible();
  });

  test("clicking End Turn advances the encounter to the next round", async ({ page }) => {
    await page.getByRole("button", { name: "End Turn" }).click();
    // Orc's AI turn runs, then Aldric acts again in round 2.
    await expect(page.getByText(/Round 2 ·/)).toBeVisible({ timeout: 5_000 });
  });

  test("new PC turn starts with ACTING badge and action buttons (auto-selected)", async ({ page }) => {
    await page.getByRole("button", { name: "End Turn" }).click();
    await expect(page.getByText(/Round 2 ·/)).toBeVisible({ timeout: 5_000 });
    // turnKey useEffect fires → PC auto-selected → action buttons appear.
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("ACTING")).toBeVisible({ timeout: 3_000 });
  });

  test("targeting mode from previous turn does not leak into the new turn", async ({ page }) => {
    // Enter Move mode, then end the turn WITHOUT moving.
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();

    await page.getByRole("button", { name: "End Turn" }).click();
    await expect(page.getByText(/Round 2 ·/)).toBeVisible({ timeout: 5_000 });

    // handleEndTurn calls setPendingAction(null) — the Move strip must NOT carry over.
    await expect(
      page.getByText("↳ Click a highlighted tile to move")
    ).not.toBeVisible({ timeout: 3_000 });
    await expect(
      page.getByText("↳ Click an enemy token to attack")
    ).not.toBeVisible({ timeout: 3_000 });
  });

  test("Attack action resets to enabled at the start of each new PC turn", async ({ page }) => {
    // End Turn without attacking. On the new turn actionUsed is false.
    await page.getByRole("button", { name: "End Turn" }).click();
    await expect(page.getByText(/Round 2 ·/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Attack" })).toBeEnabled({ timeout: 5_000 });
  });
});
