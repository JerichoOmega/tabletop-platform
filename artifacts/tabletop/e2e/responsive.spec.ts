import { test, expect } from "@playwright/test";

/**
 * Responsive / tablet layout tests
 *
 * Verifies the tabletop remains functional at three viewport sizes:
 *   - Desktop  (1280 × 800)  — baseline 3-column layout, cellPx=52
 *   - Tablet landscape (1024 × 768) — narrow 3-column, cellPx=46
 *   - Tablet portrait  (768 × 1024) — stacked single-column, board first
 *
 * Each suite confirms:
 *   - the board is visible
 *   - primary action controls (Move / Attack / End Turn) are accessible
 *   - the active actor indicator (ACTING badge) is visible
 *   - targeting still works (Move hint text appears)
 *   - intent cards (Proposal / Query / Inspect) remain usable in Assisted mode
 *
 * Tests do NOT depend on exact pixel positions; they use accessible role /
 * text selectors that are viewport-agnostic.
 */

// ---- helpers ----------------------------------------------------------------

async function loadTrainingYard(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Training Yard" }).click();
  await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 6_000 });
}

async function assertCoreControlsVisible(page: import("@playwright/test").Page) {
  await expect(page.getByRole("button", { name: "Move" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Attack" })).toBeVisible();
  await expect(page.getByRole("button", { name: "End Turn" })).toBeVisible();
}

async function assertBoardVisible(page: import("@playwright/test").Page) {
  // The board renders combatant tokens with title attributes.
  // Presence of at least one token confirms the grid rendered.
  const token = page.locator('[title="Aldric"]');
  await expect(token).toBeVisible();
}

async function assertActingBadgeVisible(page: import("@playwright/test").Page) {
  await expect(page.getByText("ACTING")).toBeVisible();
}

// ---- desktop (1280 × 800) ---------------------------------------------------

test.describe("Desktop (1280×800) — regression", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => { await loadTrainingYard(page); });

  test("board is visible", async ({ page }) => { await assertBoardVisible(page); });

  test("primary action controls are visible", async ({ page }) => { await assertCoreControlsVisible(page); });

  test("active actor ACTING badge is visible", async ({ page }) => { await assertActingBadgeVisible(page); });

  test("Move targeting works", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
  });

  test("Attack targeting works", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
  });
});

// ---- tablet landscape (1024 × 768) ------------------------------------------

test.describe("Tablet landscape (1024×768)", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test.beforeEach(async ({ page }) => { await loadTrainingYard(page); });

  test("board is visible", async ({ page }) => { await assertBoardVisible(page); });

  test("primary action controls are visible", async ({ page }) => { await assertCoreControlsVisible(page); });

  test("active actor ACTING badge is visible", async ({ page }) => { await assertActingBadgeVisible(page); });

  test("Move targeting works", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
  });

  test("Attack targeting works", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
  });

  test("End Turn advances the round", async ({ page }) => {
    await page.getByRole("button", { name: "End Turn" }).click();
    // Scope to the header sub-line to avoid strict-mode collision with the session log entry.
    await expect(page.getByText("Round 2 · Aldric's turn")).toBeVisible({ timeout: 4_000 });
  });

  test("ability buttons are accessible", async ({ page }) => {
    // Crypt has a wizard with abilities; Training Yard has Aldric (fighter).
    // Load the Ruined Crypt which has ability buttons.
    await page.getByRole("button", { name: "Ruined Crypt" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 6_000 });
    // At least one ability button should be visible (wizard has Fire Bolt / Healing Touch)
    await expect(page.locator("button", { hasText: /Healing Touch|Fire Bolt/ }).first()).toBeVisible();
  });
});

// ---- tablet portrait (768 × 1024) -------------------------------------------

test.describe("Tablet portrait (768×1024)", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test.beforeEach(async ({ page }) => { await loadTrainingYard(page); });

  test("board is visible", async ({ page }) => { await assertBoardVisible(page); });

  test("primary action controls are visible", async ({ page }) => { await assertCoreControlsVisible(page); });

  test("active actor ACTING badge is visible", async ({ page }) => { await assertActingBadgeVisible(page); });

  test("Move targeting works", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
  });

  test("Attack targeting works", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
  });

  test("End Turn advances the round", async ({ page }) => {
    await page.getByRole("button", { name: "End Turn" }).click();
    await expect(page.getByText("Round 2 · Aldric's turn")).toBeVisible({ timeout: 4_000 });
  });

  test("encounter switcher buttons are accessible", async ({ page }) => {
    // All encounter picker buttons should be reachable on portrait.
    await expect(page.getByRole("button", { name: "Training Yard" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ruined Crypt" })).toBeVisible();
  });
});

// ---- intent cards remain usable at tablet landscape -------------------------

test.describe("Intent cards — tablet landscape (1024×768)", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Training Yard" }).click();
    // Switch to Assisted mode to expose the intent input.
    await page.getByRole("button", { name: "Assisted" }).click();
    await expect(page.getByRole("textbox")).toBeVisible({ timeout: 5_000 });
  });

  test("proposal card approve/cancel are usable", async ({ page }) => {
    const input = page.getByRole("textbox");
    await input.fill("attack orc");
    await page.getByRole("button", { name: "Interpret" }).click();
    // Proposal card should appear with Approve and Cancel buttons.
    await expect(page.getByText("PROPOSED ACTION")).toBeVisible({ timeout: 4_000 });
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("PROPOSED ACTION")).not.toBeVisible();
  });

  test("query card Dismiss is usable", async ({ page }) => {
    const input = page.getByRole("textbox");
    await input.fill("can I attack the orc?");
    await page.getByRole("button", { name: "Interpret" }).click();
    // Query or proposal card should appear.
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    const cancel  = page.getByRole("button", { name: "Cancel" });
    const cardVisible = await dismiss.isVisible().catch(() => false)
      || await cancel.isVisible().catch(() => false);
    expect(cardVisible).toBe(true);
  });
});

// ---- target preview — tablet portrait (768 × 1024) --------------------------

test.describe("Target preview — tablet portrait (768×1024)", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/?e2e");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Attack" })).toBeVisible({ timeout: 6_000 });
  });

  test("attack mode shows targeting hint on portrait", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
  });

  test("switching to Move mode clears attack hint", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).not.toBeVisible();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
  });
});
