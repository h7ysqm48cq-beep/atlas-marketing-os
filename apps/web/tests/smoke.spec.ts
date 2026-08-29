import { test, expect } from "@playwright/test";

test("Atlas homepage loads", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).toBeVisible();
});

test("Atlas system health page loads", async ({ page }) => {
  await page.goto("/system-health");

  await page.waitForLoadState("networkidle");

  console.log(
    "SYSTEM HEALTH URL:",
    page.url(),
  );

  console.log(
    "SYSTEM HEALTH BODY:",
    (await page.locator("body").innerText()).slice(0, 500),
  );

  await expect(
    page.locator("h1"),
  ).toBeVisible();

  await expect(
    page.getByTestId("system-health-check-button"),
  ).toBeVisible();
});

test("Atlas API root proxy forwards the root request", async ({ page }) => {
  const response = await page.request.get("/api/atlas/");

  expect(response.status()).toBe(200);
});
