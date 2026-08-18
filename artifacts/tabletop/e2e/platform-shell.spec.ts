// ─────────────────────────────────────────────────────────────────────────
// M5 — Platform shell E2E: navigation, Experience entry/exit, deep links.
// ─────────────────────────────────────────────────────────────────────────

import { expect, test } from "@playwright/test";

test.describe("Platform shell", () => {
  test("opens on the Play surface with the RPG Experience card", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("platform-shell")).toBeVisible();
    await expect(page.getByTestId("platform-view-play")).toBeVisible();
    await expect(page.getByTestId("experience-card-rpg")).toBeVisible();
    // Shell is game-agnostic — no RPG board mounted yet.
    await expect(page.locator('[data-testid="board-tile"]')).toHaveCount(0);
  });

  test("navigates all platform destinations; non-Play surfaces are marked future", async ({
    page,
  }) => {
    await page.goto("/");
    for (const dest of ["browse", "library", "create", "profile", "settings"] as const) {
      await page.getByTestId(`platform-nav-${dest}`).click();
      await expect(page.getByTestId(`platform-view-${dest}`)).toBeVisible();
      await expect(page.getByTestId("platform-future-notice")).toContainText(
        /future milestone/i,
      );
    }
    await page.getByTestId("platform-nav-play").click();
    await expect(page.getByTestId("platform-view-play")).toBeVisible();
  });

  test("enters the RPG Experience from Play and exits back to the shell", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("experience-enter-rpg").click();
    // RPG mounts (existing behavior: opens into the current encounter).
    await expect(page.locator('[data-testid="board-tile"]').first()).toBeVisible();
    await expect(page.getByTestId("platform-active-experience")).toHaveText("Tabletop RPG");
    expect(page.url()).toContain("experience=rpg");
    // Exit restores the platform surface.
    await page.getByTestId("platform-exit").click();
    await expect(page.getByTestId("platform-shell")).toBeVisible();
    await expect(page.locator('[data-testid="board-tile"]')).toHaveCount(0);
    expect(page.url()).not.toContain("experience=rpg");
  });

  test("deep link ?experience=rpg mounts the RPG directly", async ({ page }) => {
    await page.goto("/?experience=rpg");
    await expect(page.locator('[data-testid="board-tile"]').first()).toBeVisible();
  });

  test("an unknown experience ID degrades safely to the Play surface", async ({ page }) => {
    await page.goto("/?experience=not-a-game");
    await expect(page.getByTestId("platform-shell")).toBeVisible();
    await expect(page.getByTestId("platform-view-play")).toBeVisible();
  });

  test("deep link preserves unrelated params (?e2e) alongside the experience", async ({
    page,
  }) => {
    await page.goto("/?e2e&experience=rpg");
    await expect(page.locator('[data-testid="board-tile"]').first()).toBeVisible();
    expect(page.url()).toContain("e2e");
  });

  test("an Experience that fails to launch is contained; player returns to the shell", async ({
    page,
  }) => {
    // The e2e-broken fixture Experience registers only under ?e2e.
    await page.goto("/?e2e&experience=e2e-broken");
    await expect(page.getByTestId("experience-launch-failure")).toBeVisible();
    // Platform chrome is still alive (exit bar renders around the failure).
    await expect(page.getByTestId("platform-exit")).toBeVisible();
    await page.getByTestId("experience-failure-return").click();
    await expect(page.getByTestId("platform-shell")).toBeVisible();
    await expect(page.getByTestId("platform-view-play")).toBeVisible();
    // And a healthy Experience still launches afterwards.
    await page.getByTestId("experience-enter-rpg").click();
    await expect(page.locator('[data-testid="board-tile"]').first()).toBeVisible();
  });
});
