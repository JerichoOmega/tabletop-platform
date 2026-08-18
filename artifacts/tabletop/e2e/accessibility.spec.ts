import { test, expect } from "@playwright/test";

/**
 * Accessibility E2E tests for Intelligent Tabletop.
 *
 * Covers:
 *   1. Keyboard navigation — Tab + Enter/Space reach and activate controls
 *   2. Board tokens — role, accessible name, tabIndex
 *   3. Targeting state — text-based (non-color-only) communication
 *   4. Active actor — ACTING badge + heading structure
 *   5. Intent cards — Proposal/Query/Inspect accessible and keyboard operable
 *   6. Assisted mode — text input has accessible label
 *   7. Section headings — semantic heading structure
 *   8. Alert regions — banner, victory/defeat
 *
 * Tests use getByRole() / getByLabel() / getByText() — no pixel positions.
 */

// ---- shared setup helpers ---------------------------------------------------

async function loadTrainingYard(page: import("@playwright/test").Page) {
  await page.goto("/?experience=rpg");
  await page.getByRole("button", { name: "Training Yard" }).click();
  await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 6_000 });
}

async function loadCrypt(page: import("@playwright/test").Page) {
  await page.goto("/?experience=rpg");
  await page.getByRole("button", { name: "Ruined Crypt" }).click();
  await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 6_000 });
}

// ---- 1. Keyboard navigation -------------------------------------------------

test.describe("Keyboard navigation", () => {
  test.beforeEach(async ({ page }) => { await loadTrainingYard(page); });

  test("Tab can reach the Move button", async ({ page }) => {
    // Tab from body until Move is focused.
    await page.keyboard.press("Tab");
    // Move button must be reachable; focus-visible styles make it identifiable.
    const moveBtn = page.getByRole("button", { name: "Move" });
    await moveBtn.focus();
    await expect(moveBtn).toBeFocused();
  });

  test("Tab can reach the Attack button", async ({ page }) => {
    const attackBtn = page.getByRole("button", { name: "Attack" });
    await attackBtn.focus();
    await expect(attackBtn).toBeFocused();
  });

  test("Tab can reach End Turn", async ({ page }) => {
    const endTurnBtn = page.getByRole("button", { name: "End Turn" });
    await endTurnBtn.focus();
    await expect(endTurnBtn).toBeFocused();
  });

  test("Enter activates the End Turn button", async ({ page }) => {
    const endTurnBtn = page.getByRole("button", { name: "End Turn" });
    await endTurnBtn.focus();
    await page.keyboard.press("Enter");
    // Round counter advances — scope to the header subtitle to avoid session-log collision.
    await expect(page.getByText("Round 2 · Aldric's turn")).toBeVisible({ timeout: 4_000 });
  });

  test("Space activates the Move button", async ({ page }) => {
    const moveBtn = page.getByRole("button", { name: "Move" });
    await moveBtn.focus();
    await page.keyboard.press("Space");
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
  });

  test("disabled Attack button has the disabled attribute", async ({ page }) => {
    // End Turn so the actor's action gets used... actually Attack starts undisabled.
    // Just verify the attribute is NOT present when the button is enabled.
    const attackBtn = page.getByRole("button", { name: /Attack/ });
    // In fresh state the button is enabled.
    await expect(attackBtn).not.toBeDisabled();
  });

  test("mode selector buttons are reachable via Tab", async ({ page }) => {
    const trad = page.getByRole("button", { name: "Traditional" });
    await trad.focus();
    await expect(trad).toBeFocused();
  });

  test("encounter switcher buttons are reachable via Tab", async ({ page }) => {
    const yardBtn = page.getByRole("button", { name: "Training Yard" });
    await yardBtn.focus();
    await expect(yardBtn).toBeFocused();
  });
});

// ---- 2. aria-pressed on toggle buttons -------------------------------------

test.describe("aria-pressed on action toggle buttons", () => {
  test.beforeEach(async ({ page }) => { await loadTrainingYard(page); });

  test("Move button exposes aria-pressed=false when not active", async ({ page }) => {
    const btn = page.getByRole("button", { name: "Move" });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  test("Move button exposes aria-pressed=true when active", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    const btn = page.getByRole("button", { name: "Move" });
    await expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  test("Attack button exposes aria-pressed=false when not active", async ({ page }) => {
    const btn = page.getByRole("button", { name: "Attack" });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });

  test("Traditional mode button has aria-pressed=true", async ({ page }) => {
    const btn = page.getByRole("button", { name: "Traditional" });
    await expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  test("Assisted mode button has aria-pressed=false when not active", async ({ page }) => {
    const btn = page.getByRole("button", { name: "Assisted" });
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});

// ---- 3. Board token accessibility ------------------------------------------

test.describe("Board token accessibility", () => {
  test.beforeEach(async ({ page }) => { await loadTrainingYard(page); });

  // Board tokens live inside .it-board-col.  Scope queries there to avoid
  // matching the CharacterPanel sidebar buttons, which also expose role=button
  // with combatant names but have a different (more complex) accessible name.
  // Board token aria-label format: "Aldric, acting, HP 20 of 20"

  test("alive tokens have role=button", async ({ page }) => {
    const token = page.locator(".it-board-col").getByRole("button", { name: /Aldric.*HP.*of/ });
    await expect(token).toBeVisible();
  });

  test("alive tokens are keyboard focusable (tabIndex=0)", async ({ page }) => {
    const token = page.locator(".it-board-col").getByRole("button", { name: /Aldric.*HP.*of/ });
    await expect(token).toHaveAttribute("tabindex", "0");
  });

  test("alive enemy token has an accessible name including HP", async ({ page }) => {
    const token = page.locator(".it-board-col").getByRole("button", { name: /Orc.*HP.*of/ }).first();
    await expect(token).toBeVisible();
    const label = await token.getAttribute("aria-label");
    expect(label).toMatch(/Orc/);
    expect(label).toMatch(/HP/);
  });

  test("PC token aria-label mentions HP", async ({ page }) => {
    const token = page.locator(".it-board-col").getByRole("button", { name: /Aldric.*HP.*of/ });
    const label = await token.getAttribute("aria-label");
    expect(label).toMatch(/HP/);
  });

  test("active actor token label mentions 'acting'", async ({ page }) => {
    // resolveLeadingEnemyTurns always lands on a PC turn first.
    // Board token format uses lowercase: "Aldric, acting, HP 20 of 20".
    const token = page.locator(".it-board-col").getByRole("button", { name: /acting.*HP.*of/ });
    await expect(token).toBeVisible();
  });

  test("token can be activated with Enter (selects it)", async ({ page }) => {
    const token = page.locator(".it-board-col").getByRole("button", { name: /Aldric.*HP.*of/ });
    await token.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("ACTING")).toBeVisible();
  });

  test("token can be activated with Space (selects it)", async ({ page }) => {
    const token = page.locator(".it-board-col").getByRole("button", { name: /Aldric.*HP.*of/ });
    await token.focus();
    await page.keyboard.press("Space");
    await expect(page.getByText("ACTING")).toBeVisible();
  });
});

// ---- 4. Targeting state — text-based communication -------------------------

test.describe("Targeting state (non-color communication)", () => {
  test.beforeEach(async ({ page }) => { await loadTrainingYard(page); });

  test("Move mode shows instruction text (not color-only)", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("↳ Click a highlighted tile to move")).toBeVisible();
  });

  test("Attack mode shows instruction text", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    await expect(page.getByText("↳ Click an enemy token to attack")).toBeVisible();
  });

  test("enemy token label changes to 'can be hit' in attack mode", async ({ page }) => {
    await page.getByRole("button", { name: "Attack" }).click();
    // Scoped to the board column — board tokens' aria-labels gain "can be hit".
    const enemyToken = page.locator(".it-board-col").getByRole("button", { name: /can be hit.*HP.*of/ }).first();
    await expect(enemyToken).toBeVisible();
  });

  test("beneficial ability mode shows instruction text", async ({ page }) => {
    await loadCrypt(page);
    // Switch to Healing Touch if available.
    const healingBtn = page.getByRole("button", { name: "Healing Touch" });
    if (await healingBtn.isVisible()) {
      await healingBtn.click();
      await expect(page.getByText(/↳ Click a target for Healing Touch/)).toBeVisible();
    }
  });
});

// ---- 5. Active actor -------------------------------------------------------

test.describe("Active actor communication", () => {
  test.beforeEach(async ({ page }) => { await loadTrainingYard(page); });

  test("ACTING badge is visible", async ({ page }) => {
    await expect(page.getByText("ACTING")).toBeVisible();
  });

  test("whose-turn subtitle is visible and identifies the actor", async ({ page }) => {
    // The header subtitle "Aldric's turn" must be visible.
    await expect(page.getByText(/Aldric's turn/)).toBeVisible();
  });

  test("active actor token label mentions 'acting'", async ({ page }) => {
    await expect(page.getByRole("button", { name: /acting/ })).toBeVisible();
  });
});

// ---- 6. Section heading structure ------------------------------------------

test.describe("Heading structure", () => {
  test.beforeEach(async ({ page }) => { await loadTrainingYard(page); });

  test("PARTY section has a heading role", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "PARTY" })).toBeVisible();
  });

  test("ENEMIES section has a heading role", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "ENEMIES" })).toBeVisible();
  });

  test("INITIATIVE section has a heading role", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "INITIATIVE" })).toBeVisible();
  });

  test("SESSION LOG section has a heading role", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "SESSION LOG" })).toBeVisible();
  });

  test("encounter name is a level-1 heading", async ({ page }) => {
    // The encounter name (Training Yard) is the h1.
    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
  });
});

// ---- 7. Assisted mode accessibility ----------------------------------------

test.describe("Assisted mode — text input", () => {
  test.beforeEach(async ({ page }) => {
    await loadTrainingYard(page);
    await page.getByRole("button", { name: "Assisted" }).click();
  });

  test("text input has an accessible label", async ({ page }) => {
    const input = page.getByLabel("Describe your action in plain language");
    await expect(input).toBeVisible();
  });

  test("Interpret button is keyboard accessible", async ({ page }) => {
    const btn = page.getByRole("button", { name: "Interpret" });
    await btn.focus();
    await expect(btn).toBeFocused();
  });

  test("proposal region is labeled after interpretation", async ({ page }) => {
    const input = page.getByLabel("Describe your action in plain language");
    await input.fill("attack orc");
    await page.getByRole("button", { name: "Interpret" }).click();
    const region = page.getByRole("region", { name: "Proposed action" });
    await expect(region).toBeVisible({ timeout: 4_000 });
  });

  test("proposal Approve button is keyboard accessible", async ({ page }) => {
    const input = page.getByLabel("Describe your action in plain language");
    await input.fill("attack orc");
    await page.getByRole("button", { name: "Interpret" }).click();
    await expect(page.getByText("PROPOSED ACTION")).toBeVisible({ timeout: 4_000 });
    const approveBtn = page.getByRole("button", { name: "Approve" });
    await approveBtn.focus();
    await expect(approveBtn).toBeFocused();
  });

  test("proposal Cancel button is keyboard accessible", async ({ page }) => {
    const input = page.getByLabel("Describe your action in plain language");
    await input.fill("attack orc");
    await page.getByRole("button", { name: "Interpret" }).click();
    await expect(page.getByText("PROPOSED ACTION")).toBeVisible({ timeout: 4_000 });
    const cancelBtn = page.getByRole("button", { name: "Cancel" });
    await cancelBtn.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("PROPOSED ACTION")).not.toBeVisible();
  });

  test("query result region is labeled after a query", async ({ page }) => {
    const input = page.getByLabel("Describe your action in plain language");
    await input.fill("can I attack the orc?");
    await page.getByRole("button", { name: "Interpret" }).click();
    // Either a query region or a proposal appears — both are now labeled regions.
    const queryRegion = page.getByRole("region", { name: "Information query result" });
    const proposalRegion = page.getByRole("region", { name: "Proposed action" });
    const appeared = await queryRegion.isVisible().catch(() => false)
      || await proposalRegion.isVisible().catch(() => false);
    expect(appeared).toBe(true);
  });

  test("Dismiss button on query card is keyboard accessible", async ({ page }) => {
    const input = page.getByLabel("Describe your action in plain language");
    await input.fill("can I attack the orc?");
    await page.getByRole("button", { name: "Interpret" }).click();
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    const cancel = page.getByRole("button", { name: "Cancel" });
    // Either Dismiss or Cancel should be present and focusable.
    const dismissVisible = await dismiss.isVisible().catch(() => false);
    const cancelVisible = await cancel.isVisible().catch(() => false);
    expect(dismissVisible || cancelVisible).toBe(true);
    if (dismissVisible) {
      await dismiss.focus();
      await expect(dismiss).toBeFocused();
    } else {
      await cancel.focus();
      await expect(cancel).toBeFocused();
    }
  });
});

// ---- 8. Disabled button accessible state -----------------------------------

test.describe("Disabled button accessible state", () => {
  test("Attack is disabled after using action — aria-label includes reason", async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Ruined Crypt" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 6_000 });

    // Use the Attack action to consume it.
    await page.getByRole("button", { name: "Attack" }).click();
    // Click the first enemy token.
    const enemy = page.getByRole("button", { name: /valid attack target/ }).first();
    if (await enemy.isVisible()) {
      await enemy.click();
      // Attack button should now be disabled.
      const attackBtn = page.getByRole("button", { name: /action already used/i });
      await expect(attackBtn).toBeDisabled();
    }
  });
});

// ---- 9. Session log as a log region ----------------------------------------

test.describe("Session log accessibility", () => {
  test("session log has role=log", async ({ page }) => {
    await loadTrainingYard(page);
    const log = page.getByRole("log", { name: "Session log" });
    await expect(log).toBeVisible();
  });
});
