import { test, expect } from "@playwright/test";

/**
 * Assisted mode — plain-English intent → Approve flow
 *
 * Scenario: Training Yard, 1 PC (Aldric) vs 1 enemy (Orc).
 *
 * Steps verified:
 *   1. Switching to Assisted mode shows the text input and Interpret button.
 *   2. Typing "attack the Orc" and clicking Interpret shows a PROPOSED ACTION card.
 *   3. The proposal contains the Approve button and the step checks out as valid.
 *   4. Clicking Approve executes the attack and logs the result.
 */
test.describe("Assisted mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Training Yard: 1 PC (Aldric, longbow range 6) vs 1 Orc at distance 4.
    // The longbow can reach the Orc from the starting position.
    await page.getByRole("button", { name: "Training Yard" }).click();
    // resolveLeadingEnemyTurns guarantees the page opens on a PC turn.
    await expect(
      page.getByRole("button", { name: "Move" })
    ).toBeVisible({ timeout: 5_000 });

    // Switch to Assisted mode
    await page.getByRole("button", { name: "Assisted" }).click();
  });

  test("Assisted mode shows the text input and Interpret button", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Interpret" })).toBeVisible();
    // The text input is present
    const input = page.locator("input");
    await expect(input).toBeVisible();
  });

  test("typing attack intent and clicking Interpret shows the proposal card", async ({ page }) => {
    const input = page.locator("input");
    await input.fill("attack the Orc");
    await page.getByRole("button", { name: "Interpret" }).click();

    // The proposal card header should appear
    await expect(page.getByText("PROPOSED ACTION")).toBeVisible({ timeout: 3_000 });
  });

  test("Approve executes the attack and logs the result", async ({ page }) => {
    const input = page.locator("input");
    await input.fill("attack the Orc");
    await page.getByRole("button", { name: "Interpret" }).click();

    // Wait for a valid proposal (all step checks should pass for a straightforward attack)
    await expect(page.getByText("PROPOSED ACTION")).toBeVisible({ timeout: 3_000 });

    // Approve button should be enabled (no invalid steps)
    const approveBtn = page.getByRole("button", { name: "Approve" });
    await expect(approveBtn).toBeVisible();
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // After approving the proposal is dismissed
    await expect(page.getByText("PROPOSED ACTION")).not.toBeVisible({ timeout: 3_000 });

    // The attack readout should appear — it shows "vs" for attack results
    // and is rendered below the grid.  A hit or miss both produce an entry.
    await expect(page.getByText(/vs.*d20|d20.*vs/i)).toBeVisible({ timeout: 3_000 });
  });
});
