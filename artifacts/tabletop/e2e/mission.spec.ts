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

async function walkIntoWatchtowerBattle(page: Page, firstStep = 9) {
  for (let wx = firstStep; wx <= 18; wx++) await stepTo(page, wx, 8);
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

  // The ridge choice is a longer, covered route with a real optional cache.
  await page.getByTestId("mission-approach-ridge").click();
  await expect(page.getByRole("heading", { name: "Wilderness Exploration" })).toBeVisible();
  await expect(page.getByTestId("mission-route-state")).toContainText("long / covered");

  // Take the ridge detour and interact with the cache instead of completing it
  // merely by selecting the approach.
  await stepTo(page, 9, 8);
  await stepTo(page, 10, 8);
  await stepTo(page, 11, 8);
  await stepTo(page, 11, 7);
  await expect(page.getByTestId("enter-location")).toContainText("Open Ranger Cache");
  await page.getByTestId("enter-location").click();
  await expect(page.getByTestId("interaction-overlay")).toContainText("Healing Potion +1");
  await expect(page.getByTestId("interaction-overlay")).toContainText("Tactical advantage secured");
  await page.getByTestId("return-from-interaction").click();
  await expect(page.getByTestId("mission-objectives")).toContainText("Open the ranger supply cache");
  await expect(page.getByTestId("mission-route-state")).toContainText("long / covered");

  await stepTo(page, 12, 8);
  await walkIntoWatchtowerBattle(page, 13);
  await fightToVictory(page);

  // The existing M7 automatic victory return now feeds mission resolution.
  await expect(page.getByRole("heading", { name: "Wilderness Exploration" })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("mission-resolution")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("mission-outcome")).toContainText("beacon burns again");
  await expect(page.getByTestId("mission-outcome")).toContainText("tactical opening");
  await expect(page.getByTestId("mission-return-platform")).toBeVisible();

  // Resolution → platform return → fresh RPG entry has no stale mission.
  await page.getByTestId("mission-return-platform").click();
  await expect(page.getByTestId("platform-shell")).toBeVisible();
  await page.getByTestId("experience-enter-rpg").click();
  await expect(page.getByTestId("mission-briefing")).toBeVisible();
  await expect(page.getByTestId("mission-resolution")).toHaveCount(0);
});

test("direct road is shorter, exposed, and resolves at cost", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("experience-enter-rpg").click();
  await expect(page.getByTestId("mission-briefing")).toBeVisible();
  await page.getByTestId("mission-approach-direct").click();

  await expect(page.locator(LOCATION)).toContainText("(17, 8)");
  await expect(page.getByTestId("mission-route-state")).toContainText("short / exposed");

  // The direct road starts close to the tower approach, so the same hostile
  // pressure arrives after two steps instead of the ridge detour and cache.
  await walkIntoWatchtowerBattle(page, 18);
  await fightToVictory(page);
  await expect(page.getByTestId("mission-resolution")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId("mission-outcome")).toContainText("exposed approach cost");
  await expect(page.getByRole("heading", { name: "SUCCESS AT COST" })).toBeVisible();
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