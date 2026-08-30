import { test, expect, type Page } from "@playwright/test";

/**
 * Phase 3 Milestone M5 — exploration ↔ encounter loop E2E.
 *
 * Deterministic fixture facts (EXPLORE_WORLD_SEED = 20260817):
 *   • Party spawns at (8, 8); demo hostile orc at (20, 8).
 *   • Row 8 is entirely floor from wx=8 to wx=21 (unit-test verified path
 *     check dumps; movement retries tolerate chunk streaming anyway).
 *
 * Verified loop:
 *   1. Walking adjacent to the hostile starts a world-backed encounter
 *      ("Wilderness Battle") — combat UI appears, exploration/encounter
 *      switchers are hidden until the battle resolves.
 *   2. Fighting to a terminal result shows the banner with a
 *      "Continue Exploring" (victory) or "Awaken at Camp" (defeat) button.
 *   3. Clicking it returns the party to the exploration surface, with the
 *      battle result committed to the world (a beaten orc stays dead —
 *      stepping onto its old tile does not restart combat).
 */

const TILE = '[data-testid="board-tile"]';
const LOCATION = '[data-testid="exploration-location"]';

async function enterExploration(page: Page) {
  // Mission launch is briefing → exploration; the world remains the primary
  // play surface after the player acknowledges the brief.
  // The M5 loop remains covered as isolated developer tooling; the actual
  // player-facing mission loop is covered by mission.spec.ts.
  await page.goto("/?practice&experience=rpg");
  await page.getByRole("button", { name: "Explore World" }).click();
  await expect(page.locator(LOCATION)).toBeVisible({ timeout: 8_000 });
}

/** Steps onto (wx, wy), retrying while the destination chunk streams in. */
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

/** Walks east along row 8 until adjacent to the hostile → battle begins. */
async function walkIntoBattle(page: Page) {
  for (let wx = 9; wx <= 18; wx++) await stepTo(page, wx, 8);
  // The final step lands adjacent to the hostile: the battle starts and the
  // exploration location readout unmounts, so poll for the heading instead.
  await expect
    .poll(
      async () => {
        const tile = page.locator(`${TILE}[data-world-wx="19"][data-world-wy="8"]`);
        if (await tile.count()) await tile.click();
        return page.getByRole("heading", { name: "Wilderness Battle" }).count();
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}

/**
 * Plays the battle to a terminal state: on each player turn, attack the orc
 * if possible, otherwise end the turn. Bounded loop — the fighter and orc
 * both hit often enough that a result arrives well within the cap.
 */
async function fightToResult(page: Page): Promise<"victory" | "defeat"> {
  for (let i = 0; i < 60; i++) {
    const victory = page.getByText("Victory!", { exact: false });
    const defeat = page.getByText("Defeat.", { exact: false });
    if (await victory.isVisible()) return "victory";
    if (await defeat.isVisible()) return "defeat";

    const attackBtn = page.getByRole("button", { name: "Attack" });
    if (await attackBtn.isVisible()) {
      const acting = page.getByRole("button", { name: /ACTING/ }).first();
      const actingText = await acting.innerText();
      const hp = Number(actingText.match(/HP (\d+)\//)?.[1] ?? 99);
      const potion = page.getByRole("button", { name: /Use Healing Potion/ });
      if (hp <= 8 && await potion.isVisible() && await potion.isEnabled()) {
        await potion.click();
        const endTurnAfterPotion = page.getByRole("button", { name: "End Turn" });
        if (await endTurnAfterPotion.isVisible()) await endTurnAfterPotion.click();
        continue;
      }
      await attackBtn.click();
      const orc = page.locator('[title="Orc"]');
      if (await orc.isVisible()) {
        await orc.click();
      }
      const endTurn = page.getByRole("button", { name: "End Turn" });
      if (await endTurn.isVisible()) await endTurn.click();
    } else {
      await page.waitForTimeout(250);
    }
  }
  throw new Error("battle did not reach a terminal state within the loop cap");
}

test.describe("Wilderness battle — M5 exploration ↔ encounter loop", () => {
  test("stepping next to the hostile starts a world-backed battle; switchers are locked", async ({ page }) => {
    await enterExploration(page);
    await walkIntoBattle(page);

    // Combat UI is live (world-backed GameState).
    await expect(page.getByRole("heading", { name: "INITIATIVE", exact: true })).toBeVisible();
    // The exploration toggle and encounter pills are hidden mid-battle:
    // the battle must resolve through the banner (endEncounter commit path).
    await expect(page.getByRole("button", { name: "Explore World" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Training Yard" })).toHaveCount(0);
  });

  test("battle result returns the party to exploration and commits to the world", async ({ page }) => {
    await enterExploration(page);
    await walkIntoBattle(page);

    // Seeds are fixed (combat seed 1337+n, world seed 20260817) and the
    // scripted click sequence is deterministic, so this battle ALWAYS ends
    // in victory. Requiring it keeps M7's primary acceptance criterion —
    // automatic return — from silently degrading into the defeat branch.
    const result = await fightToResult(page);
    expect(result).toBe("victory");
    // The world-backed banner never shows the dev-scaffolding "New Encounter".
    await expect(page.getByRole("button", { name: "New Encounter" })).toHaveCount(0);

    // M7: victory returns to exploration AUTOMATICALLY — no click required.
    await expect(
      page.getByRole("heading", { name: "Wilderness Exploration" })
    ).toBeVisible({ timeout: 8_000 });
    await expect(page.locator(LOCATION)).toBeVisible();
    // Party resumes at the battle location (walked to wx=19), not respawned.
    await expect(page.locator(LOCATION)).toContainText("(19, 8)");
    // Committed: the orc is dead in the world. Stepping onto its old tile
    // must succeed (corpses don't block) and must NOT restart a battle —
    // and proves the player can immediately keep moving.
    await stepTo(page, 20, 8);
    await expect(page.getByRole("heading", { name: "Wilderness Battle" })).toHaveCount(0);
  });
});
