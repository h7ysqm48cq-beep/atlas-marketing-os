import { test, expect } from "@playwright/test";

test("Atlas homepage loads", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toBeVisible();
});
