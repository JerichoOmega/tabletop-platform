import { expect, test, type Page } from "@playwright/test";

const TILE = '[data-testid="board-tile"]';
const LOCATION = '[data-testid="exploration-location"]';

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

async function walkIntoWatchtowerBattle(page: Page) {
  for (let wx = 9; wx <= 18; wx++) await stepTo(page, wx, 8);
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

async function fightToVictory(page: Page) {
  for (let i = 0; i < 60; i++) {
    if (await page.getByText("Victory!", { exact: false }).isVisible()) return;
    if (await page.getByText("Defeat.", { exact: false }).isVisible()) {
      throw new Error("The deterministic watchtower climax ended in defeat");
    }
    const attack = page.getByRole("button", { name: "Attack" });
    if (await attack.isVisible()) {
      await attack.click();
      const orc = page.locator('[title="Orc"]');
      if (await orc.isVisible()) await orc.click();
      const endTurn = page.getByRole("button", { name: "End Turn" });
      if (await endTurn.isVisible()) await endTurn.click();
    } else {
      await page.waitForTimeout(200);
    }
  }
  throw new Error("The watchtower climax did not resolve");
}

test("completes The Ruined Watchtower from the real platform shell", async ({ page }) => {
  await page.goto("/");

  // Real player entry: Play → RPG → mission briefing.
  await page.getByTestId("experience-enter-rpg").click();
  await expect(page.getByTestId("mission-briefing")).toBeVisible();
  await expect(page.getByRole("heading", { name: "The Ruined Watchtower" })).toBeVisible();

  // The ridge choice is meaningful: it completes the optional objective and
  // therefore maps the same primary victory to SUCCESS instead of cost.
  await page.getByTestId("mission-approach-ridge").click();
  await expect(page.getByRole("heading", { name: "Wilderness Exploration" })).toBeVisible();
  await expect(page.getByTestId("mission-objectives")).toContainText("safer ridge");

  await walkIntoWatchtowerBattle(page);
  await fightToVictory(page);

  // The existing M7 automatic victory return now feeds mission resolution.
  await expect(page.getByRole("heading", { name: "Wilderness Exploration" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("mission-resolution")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("mission-outcome")).toContainText("beacon burns again");
  await expect(page.getByTestId("mission-return-platform")).toBeVisible();

  // Resolution → platform return → fresh RPG entry has no stale mission.
  await page.getByTestId("mission-return-platform").click();
  await expect(page.getByTestId("platform-shell")).toBeVisible();
  await page.getByTestId("experience-enter-rpg").click();
  await expect(page.getByTestId("mission-briefing")).toBeVisible();
  await expect(page.getByTestId("mission-resolution")).toHaveCount(0);
});

test("allows an active mission to retreat with an explicit outcome", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("experience-enter-rpg").click();
  await page.getByTestId("mission-approach-direct").click();
  await expect(page.getByTestId("mission-retreat")).toBeVisible();
  await page.getByTestId("mission-retreat").click();
  await expect(page.getByTestId("mission-resolution")).toBeVisible();
  await expect(page.getByTestId("mission-resolution")).toContainText("RETREAT");
  await page.getByTestId("mission-return-platform").click();
  await expect(page.getByTestId("platform-shell")).toBeVisible();
});