import { expect, test } from "@playwright/test";

test("shows the compact loadout and consumes a Healing Potion as an action", async ({ page }) => {
  await page.goto("/?practice&experience=rpg");

  const potionButton = page.getByRole("button", { name: /Use Healing Potion \(\d+\)/ });
  await expect(potionButton).toBeVisible({ timeout: 8_000 });
  const beforeLabel = await potionButton.innerText();
  const beforeQuantity = Number(beforeLabel.match(/\((\d+)\)/)?.[1]);
  expect(beforeQuantity).toBeGreaterThan(0);
  await expect(page.getByText(new RegExp(`Consumables: Healing Potion ×${beforeQuantity}`)).first()).toBeVisible();
  await expect(page.getByText(/Armor: (Trail Leathers|Warden Mail)/).first()).toBeVisible();

  await potionButton.click();

  await expect(page.getByTestId("consumable-result")).toContainText("uses Healing Potion");
  await expect(page.getByTestId("consumable-result")).toContainText("HP");
  await expect(page.getByText(new RegExp(`Consumables: Healing Potion ×${beforeQuantity - 1}`)).first()).toBeVisible();
});