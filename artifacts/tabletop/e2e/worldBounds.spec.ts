import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 3 Milestone M4 — E2E: WorldBounds at the real exploration edge.
 *
 * The party walks the real UI path from spawn (8, 8) to the west world edge
 * (0, 1), verifying along the way that:
 *   1. the edge can be approached,
 *   2. it cannot be crossed — no out-of-world tile is ever rendered to click,
 *      and the authoritative party position stays inside bounds,
 *   3. the viewport stays coherent (origin clamped at 0; every rendered tile
 *      is an in-bounds coordinate),
 *   4. no invalid outside-world state exists — no chunk outside chunks
 *      (0..3, 0..3) is ever generated or held (pre-M4, the prefetch margin
 *      requested cx/cy = -1 chunks at the origin corner),
 *   5. walking back inward works normally.
 *
 * Deterministic fixture facts (EXPLORE_WORLD_SEED = 20260817):
 *   • WorldBounds = [0..63] × [0..63] (chunks 0..3 × 0..3).
 *   • EDGE_WALK_PATH is a BFS-verified pillar-free Chebyshev path from spawn
 *     to (0, 1); the walk-path anchor test in worldBounds.test.ts guards it
 *     against deterministic-generation drift.
 */

const TILE = '[data-testid="board-tile"]';
const LOCATION = '[data-testid="exploration-location"]';

// Mirrors EDGE_WALK_PATH in src/__tests__/worldBounds.test.ts (anchor test).
const EDGE_WALK_PATH: [number, number][] = [
  [7, 8], [6, 7], [5, 6], [4, 5], [3, 4], [2, 3], [1, 2], [0, 1],
];

interface WorldDebugSnapshot {
  residency: string;
  geometryHash: string | null;
  heldChunks: { cx: number; cy: number; residency: string }[];
  entities: { worldId: string; defId: string; wx: number; wy: number; hp: number; maxHp: number; alive: boolean }[];
}

async function worldDebug(page: Page, cx: number, cy: number): Promise<WorldDebugSnapshot> {
  const snap = await page.evaluate(
    ([x, y]) => (window as unknown as { __worldDebug?: (cx: number, cy: number) => unknown }).__worldDebug?.(x, y) ?? null,
    [cx, cy],
  );
  expect(snap, "world debug hook should be available in exploration").not.toBeNull();
  return snap as WorldDebugSnapshot;
}

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

/** Asserts no held chunk lies outside the playable chunk range 0..3 × 0..3. */
function expectAllChunksInWorld(snap: WorldDebugSnapshot, when: string) {
  const outside = snap.heldChunks.filter(
    (c) => c.cx < 0 || c.cx > 3 || c.cy < 0 || c.cy > 3,
  );
  expect(outside, `out-of-world chunks held ${when}: ${JSON.stringify(outside)}`).toHaveLength(0);
}

test.describe("Phase 3 M4 — world edge is authoritative", () => {
  test("party can approach the west edge, cannot cross it, and returns inward", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/?e2e&experience=rpg");
    await page.getByRole("button", { name: "Explore World" }).click();
    await expect(page.locator(LOCATION)).toContainText("(8, 8)");

    // Spawn viewport touches the origin corner region — verify streaming
    // never requested chunks outside the world even with the prefetch margin.
    await expect
      .poll(async () => (await worldDebug(page, 0, 0)).residency, { timeout: 15_000 })
      .toBe("RESIDENT");
    expectAllChunksInWorld(await worldDebug(page, 0, 0), "at spawn");

    // ── 1. Approach the west edge along the verified path ──────────────────
    for (const [wx, wy] of EDGE_WALK_PATH) await stepTo(page, wx, wy);
    await expect(page.locator(LOCATION)).toContainText("(0, 1)");

    // ── 2. Cannot cross: no out-of-world tile exists to click ──────────────
    // The viewport origin clamps at 0, so wx = -1 tiles are never rendered.
    await expect(page.locator(`${TILE}[data-world-wx="-1"]`)).toHaveCount(0);
    await expect(page.locator(`${TILE}[data-world-wy="-1"]`)).toHaveCount(0);

    // ── 3. Viewport coherent: every rendered tile is an in-bounds coord ────
    const coords = await page.locator(TILE).evaluateAll((tiles) =>
      tiles.map((t) => [
        Number((t as HTMLElement).dataset.worldWx),
        Number((t as HTMLElement).dataset.worldWy),
      ]),
    );
    expect(coords.length).toBeGreaterThan(0);
    for (const [wx, wy] of coords) {
      expect(wx).toBeGreaterThanOrEqual(0);
      expect(wy).toBeGreaterThanOrEqual(0);
      expect(wx).toBeLessThanOrEqual(63);
      expect(wy).toBeLessThanOrEqual(63);
    }

    // ── 4. No invalid outside-world exploration state ───────────────────────
    // Streaming settled at the edge: still zero out-of-world chunks, and the
    // authoritative party position is exactly the edge tile.
    let snap = await worldDebug(page, 0, 0);
    expectAllChunksInWorld(snap, "at the west edge");
    let party = snap.entities.find((e) => e.worldId === "party_avatar")!;
    expect({ wx: party.wx, wy: party.wy }).toEqual({ wx: 0, wy: 1 });

    // ── 5. Returning inward works normally ─────────────────────────────────
    const back = [...EDGE_WALK_PATH].reverse().slice(1).concat([[8, 8]] as [number, number][]);
    for (const [wx, wy] of back) await stepTo(page, wx, wy);
    await expect(page.locator(LOCATION)).toContainText("(8, 8)");

    snap = await worldDebug(page, 0, 0);
    expectAllChunksInWorld(snap, "after returning inward");
    party = snap.entities.find((e) => e.worldId === "party_avatar")!;
    expect({ wx: party.wx, wy: party.wy }).toEqual({ wx: 8, wy: 8 });
    expect(party.alive).toBe(true);
  });
});
