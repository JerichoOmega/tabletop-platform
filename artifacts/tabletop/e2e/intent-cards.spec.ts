import { test, expect } from "@playwright/test";

/**
 * Intent cards — PROPOSED ACTION / Query / Inspect remain distinct
 *
 * Training Yard, Assisted mode: Aldric vs Orc.
 *
 * The three card types are rendered by different branches driven by the parsed
 * intent type — never by matching specific text strings in the query. This test
 * suite locks the semantic distinctness of each card:
 *
 *  PROPOSED ACTION (proposal)
 *    - Header: "PROPOSED ACTION"
 *    - Buttons: Approve + Cancel (NOT Dismiss)
 *    - Cancel dismisses without executing
 *
 *  Query ("can I...?")
 *    - Header: data-driven (NOT "PROPOSED ACTION")
 *    - Buttons: Dismiss (NOT Approve)
 *
 *  Inspect ("what can I do?")
 *    - Header: "OPTIONS FROM HERE"
 *    - Buttons: Dismiss (NOT Approve)
 */
test.describe("Intent cards — proposal / query / inspect", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Assisted" }).click();
    await expect(page.getByRole("button", { name: "Interpret" })).toBeVisible();
  });

  // ── Proposal card ──────────────────────────────────────────────────────────

  test("proposal card has PROPOSED ACTION header, Approve, and Cancel buttons", async ({ page }) => {
    await page.locator("input").fill("attack the Orc");
    await page.getByRole("button", { name: "Interpret" }).click();
    await expect(page.getByText("PROPOSED ACTION")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  test("proposal card does not have a Dismiss button", async ({ page }) => {
    await page.locator("input").fill("attack the Orc");
    await page.getByRole("button", { name: "Interpret" }).click();
    await expect(page.getByText("PROPOSED ACTION")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Dismiss" })).not.toBeVisible();
  });

  test("canceling a proposal removes it without executing any action", async ({ page }) => {
    await page.locator("input").fill("attack the Orc");
    await page.getByRole("button", { name: "Interpret" }).click();
    await expect(page.getByText("PROPOSED ACTION")).toBeVisible({ timeout: 3_000 });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("PROPOSED ACTION")).not.toBeVisible({ timeout: 2_000 });
    // No attack readout — canceling must not execute the proposal.
    await expect(page.getByText(/vs.*d20|d20.*vs/i)).not.toBeVisible();
  });

  // ── Query card ─────────────────────────────────────────────────────────────

  test("query card has Dismiss but no Approve — never a proposal", async ({ page }) => {
    await page.locator("input").fill("can I attack the Orc?");
    await page.getByRole("button", { name: "Interpret" }).click();
    // Query produces infoResult.type === 'query', not a proposal.
    // No "PROPOSED ACTION" header, no Approve button.
    await expect(page.getByText("PROPOSED ACTION")).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Approve" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible({ timeout: 3_000 });
  });

  test("dismissing a query removes it cleanly", async ({ page }) => {
    await page.locator("input").fill("can I attack the Orc?");
    await page.getByRole("button", { name: "Interpret" }).click();
    await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible({ timeout: 3_000 });
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByRole("button", { name: "Dismiss" })).not.toBeVisible();
  });

  // ── Inspect card ───────────────────────────────────────────────────────────

  test("inspect card shows OPTIONS FROM HERE header with Dismiss — no Approve", async ({ page }) => {
    await page.locator("input").fill("what can I do?");
    await page.getByRole("button", { name: "Interpret" }).click();
    await expect(page.getByText("OPTIONS FROM HERE")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "Dismiss" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).not.toBeVisible();
  });

  test("inspect card does not show PROPOSED ACTION header", async ({ page }) => {
    await page.locator("input").fill("what can I do?");
    await page.getByRole("button", { name: "Interpret" }).click();
    await expect(page.getByText("OPTIONS FROM HERE")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("PROPOSED ACTION")).not.toBeVisible();
  });

  test("dismissing an inspect card removes it cleanly", async ({ page }) => {
    await page.locator("input").fill("what can I do?");
    await page.getByRole("button", { name: "Interpret" }).click();
    await expect(page.getByText("OPTIONS FROM HERE")).toBeVisible({ timeout: 3_000 });
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByText("OPTIONS FROM HERE")).not.toBeVisible();
  });
});
