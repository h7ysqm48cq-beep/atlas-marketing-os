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

test("Atlas system health shows background queue counts", async ({ page }) => {
  await page.route("**/system-health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        checkedAt: "2026-08-30T00:00:00.000Z",
        queues: {
          status: "healthy",
          backgroundJobs: {
            queued: 2,
            running: 1,
            succeeded: 4,
            failed: 3,
            cancelled: 0,
            total: 10,
          },
        },
        publishing: {
          status: "critical",
          overdueEligiblePosts: 2,
          stuckPublishingPosts: 1,
          recentFailedPosts: 4,
          publishedLast24h: 2,
          latestPublishedAt: "2026-08-29T12:00:00.000Z",
          nextScheduledAt: "2026-08-30T12:00:00.000Z",
          thresholds: {
            stuckMinutes: 15,
            failureWindowHours: 24,
          },
        },
      }),
    });
  });

  await page.goto("/system-health");

  await expect(
    page.getByTestId("background-queue-card"),
  ).toContainText("3");

  await expect(
    page.getByTestId("background-queue-card"),
  ).toHaveClass(/criticalCard/);

  await expect(
    page.getByTestId("publishing-pipeline-card"),
  ).toContainText("Publishing Pipeline");

  await expect(
    page.getByTestId("publishing-pipeline-card"),
  ).toContainText("3");

  await expect(
    page.getByTestId("publishing-pipeline-card"),
  ).toContainText("4 recent failures");

  await expect(
    page.getByTestId("publishing-pipeline-card"),
  ).toContainText("2 published / 24h");

  await expect(
    page.getByTestId("publishing-pipeline-card"),
  ).toContainText("Last:");

  await expect(
    page.getByTestId("publishing-pipeline-card"),
  ).toContainText("Next:");

  await expect(
    page.getByTestId("publishing-pipeline-card"),
  ).toHaveClass(/criticalCard/);
});

test("Atlas API root proxy forwards the root request", async ({ page }) => {
  const response = await page.request.get("/api/atlas/");

  expect(response.status()).toBe(200);
});
