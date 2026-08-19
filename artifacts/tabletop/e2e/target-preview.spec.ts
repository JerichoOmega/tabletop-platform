import { test, expect } from "@playwright/test";

/**
 * Hover / Target Preview — visual feedback during targeting modes.
 *
 * The preview is a transient UI layer on top of the rules engine.
 * No gameplay state changes on hover — only visual indicators update.
 *
 * Encounters used:
 *   Training Yard  (?e2e not required):
 *     PC:    Aldric (fighter, longbow range 6) at (1,3)
 *     Enemy: Orc at (5,2) — chebyshev 4 ≤ 6 → always in range
 *
 *   Ability Test  (?e2e required):
 *     PC:    Sable (testWizard, dexMod 15) at (1,3) — always wins initiative
 *     Enemy: Target Dummy at (4,3) — chebyshev 3 ≤ Fire Bolt range 4 → in range
 *
 *   Range Test  (?e2e required):
 *     PC:    Aldric (fighter, longbow range 6) at (0,3)
 *     Enemy: Target Dummy at (7,3) — chebyshev 7 > range 6 → OUT_OF_RANGE
 *
 * Verified:
 *   Attack mode:
 *     1.  Hovering a valid enemy shows a valid (⊕) preview in the strip.
 *     2.  Hovering a friendly PC shows an invalid (⊘) preview.
 *     3.  Hovering an out-of-range enemy shows "out of range" in the preview.
 *     4.  Moving the pointer away removes the preview element.
 *     5.  Hovering does NOT execute the attack.
 *
 *   Ability mode:
 *     6.  Fire Bolt hover on valid enemy → valid preview.
 *     7.  Fire Bolt hover on friendly PC → invalid preview.
 *     8.  Healing Touch hover on self/ally → valid preview.
 *     9.  Healing Touch hover on enemy → invalid preview.
 *     10. Hovering invalid target does not execute the ability.
 *
 *   Mode transitions:
 *     11. Switching mode clears an active preview.
 *     12. Toggling mode off clears an active preview.
 *     13. End Turn clears an active preview.
 */

// ── Attack mode ───────────────────────────────────────────────────────────────

test.describe("Target preview — Attack mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?practice&experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible({ timeout: 5_000 });
  });

  test("hovering a valid enemy shows the valid-target preview", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Orc"]').hover();

    const preview = page.getByTestId("target-preview");
    await expect(preview).toBeVisible({ timeout: 2_000 });
    await expect(preview).toContainText("⊕");
    await expect(preview).toContainText("Orc");
  });

  test("hovering a friendly PC in attack mode shows the invalid-target preview", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Aldric"]').hover();

    const preview = page.getByTestId("target-preview");
    await expect(preview).toBeVisible({ timeout: 2_000 });
    await expect(preview).toContainText("⊘");
    await expect(preview).toContainText("Aldric");
  });

  test("hovering an out-of-range enemy shows 'out of range' in the preview", async ({ page }) => {
    await page.goto("/?e2e&experience=rpg");
    await page.getByRole("button", { name: "Range Test" }).click();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Target Dummy"]').hover();

    const preview = page.getByTestId("target-preview");
    await expect(preview).toBeVisible({ timeout: 2_000 });
    await expect(preview).toContainText("⊘");
    await expect(preview).toContainText("out of range");
  });

  test("moving the pointer away from an enemy clears the preview", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Orc"]').hover();
    await expect(page.getByTestId("target-preview")).toBeVisible({ timeout: 2_000 });

    // Move pointer to an inert label — leaves the token.
    await page.locator("text=ENEMIES").hover();
    await expect(page.getByTestId("target-preview")).not.toBeVisible({ timeout: 1_500 });
  });

  test("hovering a valid enemy does NOT execute the attack", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Orc"]').hover();
    await expect(page.getByTestId("target-preview")).toBeVisible({ timeout: 2_000 });

    // Targeting strip must remain — the attack has not fired.
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
    // No attack roll readout should be present.
    await expect(page.getByText(/Orc.*d20|d20.*Orc/i)).not.toBeVisible({ timeout: 1_000 });
  });
});

// ── Ability mode ──────────────────────────────────────────────────────────────

test.describe("Target preview — Ability mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?e2e&experience=rpg");
    await page.getByRole("button", { name: "Ability Test" }).click();
    await expect(page.getByRole("button", { name: "Fire Bolt" })).toBeVisible({ timeout: 5_000 });
  });

  test("Fire Bolt: hovering a valid enemy shows the valid-target preview", async ({ page }) => {
    await page.getByRole("button", { name: "Fire Bolt" }).click();
    await page.locator('[title="Target Dummy"]').hover();

    const preview = page.getByTestId("target-preview");
    await expect(preview).toBeVisible({ timeout: 2_000 });
    await expect(preview).toContainText("⊕");
    await expect(preview).toContainText("Target Dummy");
  });

  test("Fire Bolt: hovering a friendly PC shows the invalid-target preview", async ({ page }) => {
    await page.getByRole("button", { name: "Fire Bolt" }).click();
    await page.locator('[title="Sable"]').hover();

    const preview = page.getByTestId("target-preview");
    await expect(preview).toBeVisible({ timeout: 2_000 });
    await expect(preview).toContainText("⊘");
    await expect(preview).toContainText("Sable");
  });

  test("Healing Touch: hovering self/ally shows the valid-target preview", async ({ page }) => {
    await page.getByRole("button", { name: "Healing Touch" }).click();
    await page.locator('[title="Sable"]').hover();

    const preview = page.getByTestId("target-preview");
    await expect(preview).toBeVisible({ timeout: 2_000 });
    await expect(preview).toContainText("⊕");
    await expect(preview).toContainText("Sable");
  });

  test("Healing Touch: hovering the enemy shows the invalid-target preview", async ({ page }) => {
    await page.getByRole("button", { name: "Healing Touch" }).click();
    await page.locator('[title="Target Dummy"]').hover();

    const preview = page.getByTestId("target-preview");
    await expect(preview).toBeVisible({ timeout: 2_000 });
    await expect(preview).toContainText("⊘");
    await expect(preview).toContainText("Target Dummy");
  });

  test("hovering an invalid target does NOT execute the ability", async ({ page }) => {
    await page.getByRole("button", { name: "Healing Touch" }).click();
    await page.locator('[title="Target Dummy"]').hover();
    await expect(page.getByTestId("target-preview")).toBeVisible({ timeout: 2_000 });

    // Targeting strip must remain — ability did not fire.
    await expect(page.getByText("↳ Click a target for Healing Touch")).toBeVisible();
    // No heal readout.
    await expect(page.getByText(/uses Healing Touch/i)).not.toBeVisible({ timeout: 1_000 });
  });
});

// ── Mode transitions ──────────────────────────────────────────────────────────

test.describe("Target preview — mode transitions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?practice&experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible({ timeout: 5_000 });
  });

  test("switching from Attack to Move clears an active preview", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Orc"]').hover();
    await expect(page.getByTestId("target-preview")).toBeVisible({ timeout: 2_000 });

    // Switch to Move — preview must disappear.
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByTestId("target-preview")).not.toBeVisible({ timeout: 1_500 });
  });

  test("toggling Attack mode off clears an active preview", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Orc"]').hover();
    await expect(page.getByTestId("target-preview")).toBeVisible({ timeout: 2_000 });

    await page.getByRole("button", { name: "Attack" }).click(); // toggle off
    await expect(page.getByTestId("target-preview")).not.toBeVisible({ timeout: 1_500 });
  });

  test("End Turn clears an active preview", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await page.locator('[title="Orc"]').hover();
    await expect(page.getByTestId("target-preview")).toBeVisible({ timeout: 2_000 });

    await page.getByRole("button", { name: "End Turn" }).click();
    await expect(page.getByTestId("target-preview")).not.toBeVisible({ timeout: 2_000 });
  });
});
