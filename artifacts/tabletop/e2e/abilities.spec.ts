import { test, expect } from "@playwright/test";

/**
 * Ability targeting — Fire Bolt (harmful/red) and Healing Touch (beneficial/blue)
 *
 * Uses the "Ability Test" fixture (?e2e required):
 *   PC:    testWizard "Sable", dexMod 15 → always wins initiative
 *   Enemy: Target Dummy, dexMod -10 → always loses initiative
 *
 *   Layout: wizard at (1,3), dummy at (4,3).
 *     Fire Bolt  — range 4, distance 3, LOS clear (trainingYard: no pillars) ✓
 *     Healing Touch — range 1; wizard self-targets at distance 0 ≤ 1 ✓
 *
 * Initiative guarantee: min wizard total (1+15=16) > max dummy total (20-10=10).
 * The wizard ALWAYS acts first — the encounter is fully deterministic.
 *
 * Verified:
 *  Fire Bolt (harmful):
 *    - Button click → red/hostile targeting strip "↳ Click an enemy for Fire Bolt"
 *    - Clicking enemy executes ability and shows damage readout
 *    - Button is disabled after use
 *  Healing Touch (beneficial):
 *    - Button click → blue/beneficial targeting strip "↳ Click a target for Healing Touch"
 *    - Clicking enemy does NOT execute ability (enemy ≠ valid ally target)
 *    - Clicking own board token self-targets and shows healing readout
 *    - Button is disabled after use
 */

// ── Fire Bolt ─────────────────────────────────────────────────────────────────

test.describe("Harmful abilities — Fire Bolt", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?e2e&experience=rpg");
    await page.getByRole("button", { name: "Ability Test" }).click();
    // testWizard always goes first — Fire Bolt button is immediately visible.
    await expect(page.getByRole("button", { name: "Fire Bolt" })).toBeVisible({ timeout: 5_000 });
  });

  test("Fire Bolt button shows the red/hostile targeting strip", async ({ page }) => {
    await page.getByRole("button", { name: "Fire Bolt" }).click();
    await expect(page.getByText("↳ Click an enemy for Fire Bolt")).toBeVisible();
  });

  test("Fire Bolt uses hostile (red) language — not the beneficial (blue) phrase", async ({ page }) => {
    // The targeting phrase type is derived from ability.targeting === 'enemy',
    // not from the ability name. This test locks the data-driven association.
    await page.getByRole("button", { name: "Fire Bolt" }).click();
    await expect(page.getByText("↳ Click an enemy for Fire Bolt")).toBeVisible();
    // Must NOT show the beneficial "Click a target for" phrase.
    await expect(page.getByText(/↳ Click a target for Fire Bolt/)).not.toBeVisible();
  });

  test("clicking the enemy in Fire Bolt mode executes the ability and clears targeting", async ({ page }) => {
    await page.getByRole("button", { name: "Fire Bolt" }).click();
    const dummy = page.locator('[title="Target Dummy"]');
    await dummy.click();
    // Targeting hint clears — ability was processed.
    await expect(page.getByText("↳ Click an enemy for Fire Bolt")).not.toBeVisible({ timeout: 3_000 });
    // Damage readout appears.
    // The readout format is "casts Fire Bolt at Target Dummy: roll X → Y damage".
    // The game log uses "Damage Roll: X + mod = Y" — the → arrow only appears in the readout.
    await expect(page.getByText(/casts Fire Bolt.*→/)).toBeVisible({ timeout: 3_000 });
  });

  test("Fire Bolt button is disabled after the ability is used", async ({ page }) => {
    await page.getByRole("button", { name: "Fire Bolt" }).click();
    await page.locator('[title="Target Dummy"]').click();
    await expect(page.getByText("↳ Click an enemy for Fire Bolt")).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Fire Bolt" })).toBeDisabled();
  });

  test("clicking Fire Bolt twice cancels targeting (toggle-off)", async ({ page }) => {
    await page.getByRole("button", { name: "Fire Bolt" }).click();
    await expect(page.getByText("↳ Click an enemy for Fire Bolt")).toBeVisible();
    await page.getByRole("button", { name: "Fire Bolt" }).click();
    await expect(page.getByText("↳ Click an enemy for Fire Bolt")).not.toBeVisible();
  });
});

// ── Healing Touch ─────────────────────────────────────────────────────────────

test.describe("Beneficial abilities — Healing Touch", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?e2e&experience=rpg");
    await page.getByRole("button", { name: "Ability Test" }).click();
    await expect(page.getByRole("button", { name: "Healing Touch" })).toBeVisible({ timeout: 5_000 });
  });

  test("Healing Touch button shows the blue/beneficial targeting strip", async ({ page }) => {
    await page.getByRole("button", { name: "Healing Touch" }).click();
    await expect(page.getByText("↳ Click a target for Healing Touch")).toBeVisible();
  });

  test("Healing Touch uses beneficial (blue) language — not the hostile (red) phrase", async ({ page }) => {
    // targeting: 'ally' → blue phrase. This locks the data-driven association.
    await page.getByRole("button", { name: "Healing Touch" }).click();
    await expect(page.getByText("↳ Click a target for Healing Touch")).toBeVisible();
    // Must NOT show the hostile "Click an enemy for" phrase.
    await expect(page.getByText(/↳ Click an enemy for Healing Touch/)).not.toBeVisible();
  });

  test("clicking enemy in Healing Touch mode does NOT execute the ability", async ({ page }) => {
    // The enemy is type 'enemy'; Healing Touch targets 'ally' (same type as caster).
    // validateAbility rejects the target; pendingAction stays 'ability:healingTouch'.
    await page.getByRole("button", { name: "Healing Touch" }).click();
    await expect(page.getByText("↳ Click a target for Healing Touch")).toBeVisible();

    await page.locator('[title="Target Dummy"]').click();

    // Targeting hint must remain — ability did NOT execute.
    await expect(
      page.getByText("↳ Click a target for Healing Touch")
    ).toBeVisible({ timeout: 2_000 });
    // No heal readout.
    await expect(page.getByText(/uses Healing Touch/i)).not.toBeVisible({ timeout: 1_000 });
  });

  test("clicking own board token in Healing Touch mode self-targets and executes", async ({ page }) => {
    // distance(wizard, wizard) = 0 ≤ range 1; same type → valid target.
    await page.getByRole("button", { name: "Healing Touch" }).click();
    // The wizard's board token has title="Sable".
    await page.locator('[title="Sable"]').click();
    // Hint clears — ability executed.
    await expect(
      page.getByText("↳ Click a target for Healing Touch")
    ).not.toBeVisible({ timeout: 3_000 });
    // Healing readout appears.
    // The readout format is "uses Healing Touch on Sable: roll X → +Y HP".
    // The game log uses "Healing Roll: X + mod = Y" — the → arrow only appears in the readout.
    await expect(page.getByText(/uses Healing Touch.*→/)).toBeVisible({ timeout: 3_000 });
  });

  test("Healing Touch button is disabled after the ability is used", async ({ page }) => {
    await page.getByRole("button", { name: "Healing Touch" }).click();
    await page.locator('[title="Sable"]').click();
    await expect(
      page.getByText("↳ Click a target for Healing Touch")
    ).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Healing Touch" })).toBeDisabled();
  });

  test("clicking Healing Touch twice cancels targeting (toggle-off)", async ({ page }) => {
    await page.getByRole("button", { name: "Healing Touch" }).click();
    await expect(page.getByText("↳ Click a target for Healing Touch")).toBeVisible();
    await page.getByRole("button", { name: "Healing Touch" }).click();
    await expect(page.getByText("↳ Click a target for Healing Touch")).not.toBeVisible();
  });
});
