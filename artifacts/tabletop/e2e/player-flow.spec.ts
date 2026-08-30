// M7 regression guard: the REAL player flow — entry through the platform
// shell (Play → RPG card, no ?experience deep link), exploration-first
// launch, world-triggered combat, deterministic victory, automatic return,
// and a second full cycle after exiting to the shell and re-entering.
// Added while investigating a "encounters no longer trigger" report; this
// suite proves the trigger path end-to-end from the true entry surface.
import { test, expect, type Page } from "@playwright/test";

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

async function walkIntoBattle(page: Page) {
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
    if (await page.getByText("Defeat.", { exact: false }).isVisible()) throw new Error("defeat");
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
      if (await orc.isVisible()) await orc.click();
      const endTurn = page.getByRole("button", { name: "End Turn" });
      if (await endTurn.isVisible()) await endTurn.click();
    } else {
      await page.waitForTimeout(250);
    }
  }
  throw new Error("no terminal state");
}

test("two full cycles: shell entry → battle → win → auto-return → exit → re-enter → battle again", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("experience-enter-rpg").click();
  await page.getByTestId("mission-approach-direct").click();
  await expect(page.locator(LOCATION)).toBeVisible({ timeout: 8_000 });
  await walkIntoBattle(page);
  await fightToVictory(page);
  await expect(page.getByRole("heading", { name: "Wilderness Exploration" })).toBeVisible({ timeout: 8_000 });
  // A mission victory now resolves the authored episode before leaving.
  await expect(page.getByTestId("mission-resolution")).toBeVisible();
  await page.getByTestId("mission-return-platform").click();
  // Leave the completed episode to the shell and come back
  await expect(page.getByTestId("platform-shell")).toBeVisible();
  await page.getByTestId("experience-enter-rpg").click();
  await page.getByTestId("mission-approach-direct").click();
  await expect(page.locator(LOCATION)).toBeVisible({ timeout: 8_000 });
  // fresh session: orc is back — trigger must fire again
  await walkIntoBattle(page);
});

test("clicking the hostile token itself while adjacent does not dead-end the loop", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("experience-enter-rpg").click();
  await page.getByTestId("mission-approach-direct").click();
  await expect(page.locator(LOCATION)).toBeVisible({ timeout: 8_000 });
  for (let wx = 9; wx <= 17; wx++) await stepTo(page, wx, 8);
  // party at (17,8), orc at (20,8): click the orc token directly (natural gesture)
  const orcTok = page.locator('[title="Orc"]');
  if (await orcTok.count()) await orcTok.click();
  // then finish the approach on tiles — battle must still trigger
  await stepTo(page, 18, 8);
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
});
