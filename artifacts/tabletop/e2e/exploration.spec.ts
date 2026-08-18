import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 3 Milestone M1 — Exploration Mode E2E tests.
 *
 * Deterministic fixture facts (EXPLORE_WORLD_SEED = 20260817, verified by
 * unit test "spawn tile and the eastward walk path are floor"):
 *   • Party avatar spawns at world (8, 8).
 *   • Tiles (8..13, 8) are all floor — the eastward walk path is clear.
 *   • Demo hostile at (20, 8).
 *   • World region is 64×64; viewport fixed at 12×10.
 *
 * Expected initial viewport (VIEWPORT 12×10, DEAD_ZONE_MARGIN 3):
 *   base origin (0,0); party wy=8 > dzMaxWy=6 → recentre wy to 8−5=3.
 *   Origin (0,3); party wx=8 is at dzMaxWx=8 → inside, no wx shift.
 *
 * Walking east: at wx=9 the party crosses dzMaxWx → originWx = 9−6 = 3.
 */

const TILE = '[data-testid="board-tile"]';
const LOCATION = '[data-testid="exploration-location"]';

async function enterExploration(page: Page) {
  await page.goto("/?experience=rpg");
  await page.getByRole("button", { name: "Explore World" }).click();
  await expect(page.locator(LOCATION)).toBeVisible({ timeout: 8_000 });
}

/**
 * Steps the party onto (wx, wy), tolerating the initial chunk-streaming
 * window: while the destination chunk is still loading the click is
 * rejected ("not been mapped yet"), so we retry until the authoritative
 * location readout confirms the step.
 */
async function stepTo(page: Page, wx: number, wy: number) {
  await expect
    .poll(
      async () => {
        await page.locator(`${TILE}[data-world-wx="${wx}"][data-world-wy="${wy}"]`).click();
        return page.locator(LOCATION).textContent();
      },
      { timeout: 10_000 },
    )
    .toContain(`(${wx}, ${wy})`);
}

test.describe("Exploration mode — M1", () => {
  test.beforeEach(async ({ page }) => {
    await enterExploration(page);
  });

  test("exploration session loads with the party at spawn", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Wilderness Exploration" })).toBeVisible();
    await expect(page.locator(LOCATION)).toContainText("(8, 8)");
    await expect(page.locator('[data-testid="exploration-panel"]')).toBeVisible();
  });

  test("tabletop stays fixed at 12×10 tiles", async ({ page }) => {
    expect(await page.locator(TILE).count()).toBe(120);
  });

  test("party token is visible at its world position", async ({ page }) => {
    const spawnTile = page.locator(`${TILE}[data-world-wx="8"][data-world-wy="8"]`);
    await expect(spawnTile.getByRole("button")).toBeVisible();
  });

  test("clicking an adjacent tile moves the party (authoritative position updates)", async ({ page }) => {
    await stepTo(page, 9, 8);
    // Token renders at the new world tile; the old tile is empty.
    await expect(
      page.locator(`${TILE}[data-world-wx="9"][data-world-wy="8"]`).getByRole("button"),
    ).toBeVisible();
    await expect(
      page.locator(`${TILE}[data-world-wx="8"][data-world-wy="8"]`).getByRole("button"),
    ).toHaveCount(0);
  });

  test("viewport follows the party across the dead zone; dimensions stay fixed", async ({ page }) => {
    const firstTile = page.locator(TILE).first();
    const initialOriginWx = Number(await firstTile.getAttribute("data-world-wx"));

    // Walk east past the dead-zone boundary → the viewport origin must shift right.
    // Tiles (9..13, 8) are floor for the fixed world seed (unit-test verified).
    for (let wx = 9; wx <= 13; wx++) await stepTo(page, wx, 8);
    expect(Number(await firstTile.getAttribute("data-world-wx"))).toBeGreaterThan(initialOriginWx);

    // World ≠ viewport: the party's world position is unaffected by the shift.
    await expect(page.locator(LOCATION)).toContainText("(13, 8)");
    // Tabletop dimensions unchanged.
    expect(await page.locator(TILE).count()).toBe(120);
  });

  test("entity identity persists across movement", async ({ page }) => {
    await stepTo(page, 9, 8);
    await stepTo(page, 10, 8);
    await stepTo(page, 11, 8);
    // The same single party token exists — no duplicates, no resets.
    const tokens = page.locator(`${TILE} [role="button"]`);
    // Party + (hostile only if inside viewport; at origin shift 3..14 wx, hostile
    // at wx=20 is outside) → exactly 1 token.
    expect(await tokens.count()).toBe(1);
    await expect(page.locator(LOCATION)).toContainText("(11, 8)");
  });

  test("combat UI is hidden during exploration", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Move", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "End Turn" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "INITIATIVE", exact: true })).toHaveCount(0);
  });

  test("returning to the encounter restores combat and it still works", async ({ page }) => {
    await stepTo(page, 9, 8);
    await page.getByRole("button", { name: "Return to Encounter" }).click();
    // Encounter surface restored.
    await expect(page.getByRole("heading", { name: "Wilderness Exploration" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "INITIATIVE", exact: true })).toBeVisible();
    // Combat regression: Move mode still works end-to-end.
    await expect(page.getByRole("button", { name: "Move", exact: true })).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: "Move", exact: true }).click();
    // Reachable tiles get cursor:pointer (isReach) — combat targeting is live.
    const reachable = page.locator(`${TILE}[style*="cursor: pointer"]`);
    await expect(reachable.first()).toBeVisible();
  });

  test("switching encounters from exploration exits the session", async ({ page }) => {
    await page.getByRole("button", { name: "Training Yard" }).click();
    await expect(page.getByRole("heading", { name: "Wilderness Exploration" })).toHaveCount(0);
    await expect(page.locator(LOCATION)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "INITIATIVE", exact: true })).toBeVisible();
  });
});
