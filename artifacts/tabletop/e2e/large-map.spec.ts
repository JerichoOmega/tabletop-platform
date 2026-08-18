import { test, expect } from "@playwright/test";

/**
 * Phase D — Large-area world validation
 *
 * Verifies that the 40×40 "Grand Hall" encounter demonstrates correct viewport
 * behaviour when world dimensions substantially exceed the fixed 12×10 tabletop
 * surface.
 *
 * Key invariants exercised:
 *   1. Encounter loads via the ?e2e test-only picker.
 *   2. Rendered tile count = 12 × 10 = 120 (NOT 40 × 40 = 1600).
 *   3. Viewport origin is non-zero in Y: top-left tile shows wy ≥ 15 (the
 *      follow policy centred the fighter at world (6, 20) on load).
 *   4. Fighter token (Aldric) is visible — world (6,20) is inside the viewport.
 *   5. Target Dummy is NOT rendered — world (35,20) is off-screen (vx=35 ≥
 *      tileW=12), so its tile is never generated and the token is absent.
 *   6. Small-map encounters (Ruined Crypt, Training Yard) load without regression.
 */

const VIEWPORT_TILE_W = 12;
const VIEWPORT_TILE_H = 10;

test.describe("Large-map viewport", () => {
  test.beforeEach(async ({ page }) => {
    // ?e2e enables the test-only "Grand Hall" encounter in the switcher.
    await page.goto("/?e2e&experience=rpg");
    await page.getByRole("button", { name: "Grand Hall" }).click();
    // Wait until the fighter's action controls appear (fighter always wins
    // initiative over Target Dummy, dexMod 2 vs −10).
    await expect(
      page.getByRole("button", { name: "Move" })
    ).toBeVisible({ timeout: 8_000 });
  });

  test("rendered tile count is exactly VIEWPORT_TILE_W × VIEWPORT_TILE_H (not world size)", async ({ page }) => {
    const tileCount = await page.locator('[data-testid="board-tile"]').count();
    expect(tileCount).toBe(VIEWPORT_TILE_W * VIEWPORT_TILE_H); // 120
    // Explicitly prove it is NOT the full world
    expect(tileCount).not.toBe(40 * 40);
  });

  test("viewport Y origin is non-zero — first tile has wy ≥ 15 (follow policy centred on fighter)", async ({ page }) => {
    // The dead-zone follow policy centres the fighter (wy=20) in the 12×10
    // viewport: targetOriginWy = 20 - floor(10/2) = 15.  The top-left tile
    // (vx=0, vy=0) therefore represents world (0, 15), not world (0, 0).
    const firstTile = page.locator('[data-testid="board-tile"]').first();
    const wy = Number(await firstTile.getAttribute("data-world-wy"));
    expect(wy).toBeGreaterThanOrEqual(15);
    // And the world X origin starts at 0 (fighter is near left edge → clamped)
    const firstWx = Number(await firstTile.getAttribute("data-world-wx"));
    expect(firstWx).toBe(0);
  });

  test("fighter token (Aldric) is visible — world (6,20) is inside the viewport", async ({ page }) => {
    // Fighter at (6,20) with viewport origin (0,15): vx=6, vy=5 — inside 12×10.
    await expect(page.locator('[title="Aldric"]')).toBeVisible({ timeout: 3_000 });
  });

  test("target dummy token is NOT rendered — world (35,20) is outside the 12×10 viewport", async ({ page }) => {
    // Dummy at wx=35; viewport shows wx=[0..11]. The tile (35,20) is not in
    // getVisibleTiles(), so the dummy token div is never created in the DOM.
    await expect(page.locator('[title="Target Dummy"]')).not.toBeVisible();
  });

  test("small-map encounter (Training Yard) still loads without regression", async ({ page }) => {
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(
      page.getByRole("button", { name: "Move" })
    ).toBeVisible({ timeout: 5_000 });

    // Training Yard is 8×6: initViewport clamps 12×10 to 8×6 → 48 tiles.
    const tileCount = await page.locator('[data-testid="board-tile"]').count();
    expect(tileCount).toBe(8 * 6); // 48

    // Small-map invariant: viewport starts at (0,0)
    const firstTile = page.locator('[data-testid="board-tile"]').first();
    expect(Number(await firstTile.getAttribute("data-world-wx"))).toBe(0);
    expect(Number(await firstTile.getAttribute("data-world-wy"))).toBe(0);
  });

  test("small-map encounter (Ruined Crypt) still loads without regression", async ({ page }) => {
    await page.getByRole("button", { name: "Ruined Crypt" }).click();
    await expect(
      page.getByRole("button", { name: "Move" })
    ).toBeVisible({ timeout: 5_000 });

    // Crypt is 8×6 → 48 tiles.
    const tileCount = await page.locator('[data-testid="board-tile"]').count();
    expect(tileCount).toBe(8 * 6);
  });
});
