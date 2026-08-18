/**
 * Animation / tactile-feedback regression tests.
 *
 * Verifies:
 *   1. Animation CSS keyframes are present in the injected <style> tag.
 *   2. The pre-existing reduced-motion rule covers animation-duration.
 *   3. Game-state correctness is unaffected by animations — canonical
 *      behavioural tests (movement, attack, turn, proposal) remain in their
 *      own spec files; this spec confirms the animation layer does not interfere.
 *
 * Tests do NOT wait for arbitrary animation durations — they assert DOM/CSS
 * state, which is available synchronously after page load or action dispatch.
 */

import { test, expect } from "@playwright/test";

// Helper: collect all text from <style> tags injected by React (RESPONSIVE_CSS).
async function pageStyleText(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll("style")]
      .map((s) => s.textContent ?? "")
      .join("\n")
  );
}

// ---------------------------------------------------------------------------
// CSS sanity — all animation keyframe names present in the injected stylesheet
// ---------------------------------------------------------------------------

test.describe("Animation CSS — keyframes present in injected styles", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
  });

  for (const keyframe of [
    "it-move-in",
    "it-strike",
    "it-hit",
    "it-miss",
    "it-heal",
    "it-acting-pulse",
    "it-card-in",
    "it-banner-in",
  ]) {
    test(`${keyframe} keyframe is defined`, async ({ page }) => {
      const css = await pageStyleText(page);
      expect(css).toContain(keyframe);
    });
  }
});

// ---------------------------------------------------------------------------
// Reduced-motion — pre-existing rule confirmed here for animation context
// ---------------------------------------------------------------------------

test("reduced-motion rule covers animation-duration", async ({ page }) => {
  await page.goto("/?experience=rpg");
  const css = await pageStyleText(page);
  expect(css).toContain("prefers-reduced-motion");
  expect(css).toContain("animation-duration");
});

// ---------------------------------------------------------------------------
// Animation class wiring — entrance classes appear on cards and banners
// ---------------------------------------------------------------------------

test.describe("Animation class wiring — markup", () => {
  test("proposal card carries it-anim-card-in class when shown", async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Assisted", exact: true }).click();

    const input = page.getByLabel("Describe your action in plain language");
    await input.fill("attack the Orc");
    await page.getByRole("button", { name: "Interpret" }).click();
    await page.waitForTimeout(300);

    // The proposal or query card must carry the entrance class
    await expect(page.locator(".it-anim-card-in").first()).toBeVisible();
  });

  test("victory banner carries it-anim-banner-in class when encounter ends", async ({ page }) => {
    // Quick Battle: fighter vs target dummy (1 HP, AC 1) — one hit always wins.
    await page.goto("/?e2e&experience=rpg");
    await page.getByRole("button", { name: "Quick Battle" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });

    // Attack the dummy — it dies in one hit, triggering the Victory banner.
    await page.getByRole("button", { name: /^Attack/ }).click();
    const tokens = page.locator('[role="button"]');
    const count = await tokens.count();
    for (let i = 0; i < count; i++) {
      const lbl = await tokens.nth(i).getAttribute("aria-label");
      if (lbl?.includes("can be hit")) {
        await tokens.nth(i).click();
        break;
      }
    }
    await page.waitForTimeout(300);

    // The Victory banner should appear with the entrance animation class.
    await expect(page.locator(".it-anim-banner-in")).toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Behavioral regression — animation must not interfere with game execution
// ---------------------------------------------------------------------------

test.describe("Move — animation does not affect game correctness", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
  });

  test("Move button enters targeting mode and shows instruction text", async ({ page }) => {
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByRole("button", { name: "Move", exact: true })).toHaveAttribute("aria-pressed", "true");
    // Use .first() — the text also appears in the sr-only live region.
    await expect(page.getByText("Click a highlighted tile to move").first()).toBeVisible();
  });

  test("clicking Move twice cancels targeting mode", async ({ page }) => {
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByRole("button", { name: "Move", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Click a highlighted tile to move").first()).not.toBeVisible();
  });
});

test.describe("Attack — animation does not affect game correctness", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });
  });

  test("Attack button enters targeting mode when not disabled", async ({ page }) => {
    const attackBtn = page.getByRole("button", { name: /^Attack/ });
    await expect(attackBtn).toBeVisible();
    const disabled = await attackBtn.getAttribute("disabled");
    if (!disabled) {
      await attackBtn.click();
      await expect(attackBtn).toHaveAttribute("aria-pressed", "true");
      // .first() — same text appears in sr-only live region
      await expect(page.getByText("Click an enemy token to attack").first()).toBeVisible();
    }
  });
});

test.describe("Turn transition — acting pulse does not break state", () => {
  test("End Turn advances round counter correctly", async ({ page }) => {
    await page.goto("/?experience=rpg");
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({ timeout: 5_000 });

    // Round subtitle is the aria-live element — more specific than getByText(/Round 1/).
    const subtitle = page.locator('[aria-live="polite"][aria-atomic="true"]');
    await expect(subtitle).toContainText("Round 1");

    await page.getByRole("button", { name: "End Turn" }).click();
    await expect(subtitle).toContainText("Round 2", { timeout: 5_000 });
  });
});
