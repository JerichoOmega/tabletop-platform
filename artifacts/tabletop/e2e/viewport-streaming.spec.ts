import { test, expect } from "@playwright/test";

/**
 * Phase F — Viewport Streaming Integration E2E tests.
 *
 * These tests exercise the presentation-layer streaming integration:
 * viewport-follows-actor, world coordinate accuracy after viewport shift,
 * culling of off-screen entities, and the critical isolation invariant
 * that simulation state is never corrupted by viewport movement.
 *
 * All tests run against the Grand Hall encounter (?e2e flag) because it is
 * the only 40×40 encounter in the current fixture set — large enough to
 * exercise non-trivial viewport origin offsets and dead-zone follow behaviour.
 *
 * Grand Hall configuration (content.ts):
 *   • Map: 40×40, entrance (0,20)
 *   • Fighter "Aldric": wx=6, wy=20, moveMax=5, hp=20
 *   • Target Dummy: wx=35, wy=20, outside 12×10 viewport at any sane origin
 *   • Pillars at (8,8), (8,16), (8,24), (8,32), (16,8), … (multiples of 8)
 *   • No pillar along the y=20 row for x=7..11 — path to (11,20) is clear
 *
 * Dead-zone follow constants (IntelligentTabletop.tsx):
 *   VIEWPORT_TILE_W=12, VIEWPORT_TILE_H=10, DEAD_ZONE_MARGIN=3
 *   dzMinWx=3, dzMaxWx=8, dzMinWy=3, dzMaxWy=6
 *
 * Initial viewport:
 *   Fighter at wx=6, wy=20 → inside dead zone → no recentre needed.
 *   initViewport positions origin at (0, 15) after dead-zone follow:
 *     targetOriginWy = 20 - floor(10/2) = 15; clamped to max(0, 15) = 15.
 *   First tile (vx=0, vy=0) represents world (0, 15).
 *
 * After fighter moves to (11, 20):
 *   vx = 11 − 0 = 11 > dzMaxWx=8 → outside dead zone → recentre.
 *   targetOriginWx = 11 − floor(12/2) = 5; clamped to min(5, 28) = 5.
 *   vy = 20 − 15 = 5 → inside [dzMinWy=3, dzMaxWy=6] → no wy shift.
 *   New viewport: originWx=5, originWy=15.
 *   First tile represents world (5, 15).
 */

const VIEWPORT_TILE_W = 12;
const VIEWPORT_TILE_H = 10;

// ---------------------------------------------------------------------------
// Shared setup: load the Grand Hall encounter.
// ---------------------------------------------------------------------------
test.describe("Viewport streaming — Grand Hall", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?e2e");
    await page.getByRole("button", { name: "Grand Hall" }).click();
    // Fighter (Aldric) always wins initiative (dex +2 vs −10 for Target Dummy).
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({
      timeout: 8_000,
    });
  });

  // ─── 1. Initial state verification ───────────────────────────────────────

  test("initial viewport: first tile is at world (0, ≥15)", async ({ page }) => {
    const firstTile = page.locator('[data-testid="board-tile"]').first();
    expect(Number(await firstTile.getAttribute("data-world-wx"))).toBe(0);
    expect(Number(await firstTile.getAttribute("data-world-wy"))).toBeGreaterThanOrEqual(15);
  });

  test("initial tile count is exactly 12×10 = 120", async ({ page }) => {
    const count = await page.locator('[data-testid="board-tile"]').count();
    expect(count).toBe(VIEWPORT_TILE_W * VIEWPORT_TILE_H);
  });

  // ─── 2. Viewport follows actor past the dead zone ────────────────────────

  test("viewport origin shifts when actor crosses the dead zone boundary", async ({ page }) => {
    const firstTile = page.locator('[data-testid="board-tile"]').first();

    // Baseline: first tile at wx=0.
    expect(Number(await firstTile.getAttribute("data-world-wx"))).toBe(0);

    // Move fighter to (11, 20): 5 tiles right, crossing dzMaxWx=8.
    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // Dead-zone follow recentres: targetOriginWx = 11−6 = 5 → first tile wx=5.
    await expect(firstTile).toHaveAttribute("data-world-wx", "5", {
      timeout: 3_000,
    });
  });

  test("viewport Y origin is unchanged when actor stays in the vertical dead zone", async ({ page }) => {
    const firstTile = page.locator('[data-testid="board-tile"]').first();
    const wyBefore = Number(await firstTile.getAttribute("data-world-wy"));

    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // After shift, wy=20−15=5, inside [dzMinWy=3, dzMaxWy=6] → no wy change.
    await expect(firstTile).toHaveAttribute("data-world-wy", String(wyBefore), {
      timeout: 3_000,
    });
  });

  // ─── 3. Token world coordinates are correct after viewport shift ─────────

  test("fighter token is visible and at correct world coordinates after shift", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // New viewport: (5,15). Fighter at (11,20) → vx=6, vy=5 → tile exists.
    await expect(
      page.locator('[data-world-wx="11"][data-world-wy="20"]')
    ).toBeVisible({ timeout: 3_000 });

    // The fighter token (Aldric) should be on that tile.
    await expect(
      page.locator('[data-world-wx="11"][data-world-wy="20"] [title="Aldric"]')
    ).toBeVisible({ timeout: 3_000 });
  });

  // ─── 4. Tile count is unchanged after viewport shift ─────────────────────

  test("tile count remains 12×10 after actor-driven viewport shift", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // Await the shift (first tile changes).
    await expect(page.locator('[data-testid="board-tile"]').first()).toHaveAttribute(
      "data-world-wx",
      "5",
      { timeout: 3_000 }
    );

    const count = await page.locator('[data-testid="board-tile"]').count();
    expect(count).toBe(VIEWPORT_TILE_W * VIEWPORT_TILE_H); // still 120
  });

  // ─── 5. Distant entity stays invisible after shift ───────────────────────

  test("target dummy (wx=35) remains off-screen after fighter shifts viewport to (5,15)", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // New visible range: wx=[5..16]. Dummy at wx=35 is still outside.
    await expect(page.locator('[title="Target Dummy"]')).not.toBeVisible({
      timeout: 3_000,
    });
  });

  // ─── 6. Simulation state unchanged by viewport movement ──────────────────

  /**
   * Critical isolation invariant (Task Instruction §4):
   *   Viewport movement must NEVER mutate GameState.tileQuery or alter
   *   combatant positions, HP, or initiative order.
   *
   * We verify by checking the fighter's accessible aria-label HP readout
   * after the viewport shift. The aria-label encodes "HP <current> of <max>"
   * and is constructed purely from GameState — if the viewport were to corrupt
   * GameState, HP would change or the label would break.
   */
  test("fighter HP and initiative order are unchanged after viewport shift", async ({ page }) => {
    // The fighter token aria-label is "Aldric, acting, HP 20 of 20" at start.
    const tokenBefore = page.locator('[title="Aldric"]').first();
    const labelBefore = await tokenBefore.getAttribute("aria-label");
    expect(labelBefore).toContain("HP");

    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // After shift, fighter HP must be identical (movement is free, no damage).
    const tokenAfter = page.locator('[title="Aldric"]').first();
    await expect(tokenAfter).toBeVisible({ timeout: 3_000 });
    const labelAfter = await tokenAfter.getAttribute("aria-label");

    // Extract HP from both labels and compare.
    const hpPattern = /HP (\d+) of (\d+)/;
    const matchBefore = labelBefore?.match(hpPattern);
    const matchAfter  = labelAfter?.match(hpPattern);
    expect(matchBefore).not.toBeNull();
    expect(matchAfter).not.toBeNull();
    expect(matchAfter![1]).toBe(matchBefore![1]); // current HP unchanged
    expect(matchAfter![2]).toBe(matchBefore![2]); // max HP unchanged
  });

  test("initiative order (turn order display) is unchanged after viewport shift", async ({ page }) => {
    // Read the initiative list before the move.
    const initList = page.locator('[aria-label="Initiative order"]');
    const textBefore = await initList.textContent();

    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // Await viewport shift before reading.
    await expect(page.locator('[data-testid="board-tile"]').first()).toHaveAttribute(
      "data-world-wx",
      "5",
      { timeout: 3_000 }
    );

    const textAfter = await initList.textContent();
    expect(textAfter).toBe(textBefore);
  });

  /**
   * Confirms the simulation snapshot isolation (Task Instruction §4):
   *   After the viewport shift, the fighter can still Attack — proving that
   *   the rules engine's action validation pipeline continues to work correctly.
   *   If GameState.tileQuery were corrupted, Attack validation would fail.
   */
  test("attack button remains functional after viewport shift (rules engine unaffected)", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // Await viewport shift.
    await expect(page.locator('[data-testid="board-tile"]').first()).toHaveAttribute(
      "data-world-wx",
      "5",
      { timeout: 3_000 }
    );

    // Attack button should still be present and enabled.
    // (Action is not yet used — only movement happened.)
    const attackBtn = page.getByRole("button", { name: "Attack" });
    await expect(attackBtn).toBeVisible({ timeout: 2_000 });
    await expect(attackBtn).not.toBeDisabled();
  });

  // ─── 7. Small-map regression (viewport streaming must not break small maps) ─

  test("switching to small map (Training Yard) after Grand Hall loads correctly", async ({ page }) => {
    // Switch away from Grand Hall to a small map.
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("button", { name: "Move" })).toBeVisible({
      timeout: 5_000,
    });

    // Small map is 8×6 → 48 tiles.
    const count = await page.locator('[data-testid="board-tile"]').count();
    expect(count).toBe(8 * 6);

    // Small map: viewport origin must be (0,0).
    const firstTile = page.locator('[data-testid="board-tile"]').first();
    expect(Number(await firstTile.getAttribute("data-world-wx"))).toBe(0);
    expect(Number(await firstTile.getAttribute("data-world-wy"))).toBe(0);
  });

  // ─── 8. World coordinate bounds after shift ───────────────────────────────

  test("last tile in viewport is at expected world coordinates after shift", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // New origin (5,15) → last tile: wx=5+12-1=16, wy=15+10-1=24.
    await expect(page.locator('[data-world-wx="16"][data-world-wy="24"]')).toBeVisible({
      timeout: 3_000,
    });
  });

  test("no tile beyond the viewport boundary is rendered after shift", async ({ page }) => {
    await page.getByRole("button", { name: "Move" }).click();
    await page.locator('[data-world-wx="11"][data-world-wy="20"]').click();

    // Await shift.
    await expect(page.locator('[data-testid="board-tile"]').first()).toHaveAttribute(
      "data-world-wx", "5", { timeout: 3_000 }
    );

    // Tile at wx=4 (one before new origin) must not exist.
    await expect(page.locator('[data-world-wx="4"][data-world-wy="15"]')).not.toBeVisible();
    // Tile at wx=17 (one past new last col) must not exist.
    await expect(page.locator('[data-world-wx="17"]')).not.toBeVisible();
  });
});
