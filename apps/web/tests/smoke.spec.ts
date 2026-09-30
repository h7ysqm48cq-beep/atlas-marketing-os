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
        sportsScheduler: {
          status: "healthy",
          enabled: true,
          timezone: "Asia/Kuala_Lumpur",
          morningTime: "09:00",
          eveningTime: "20:00",
          lastMorningRunAt: "2026-08-30T01:02:00.000Z",
          lastEveningRunAt: "2026-08-29T12:02:00.000Z",
          lastRunStatus: "SUCCESS",
          lastError: null,
          nextRunLocal: "2026-08-30 20:00 Asia/Kuala_Lumpur EVENING",
          missedRuns: [],
          graceMinutes: 15,
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

  await expect(
    page.getByTestId("sports-scheduler-card"),
  ).toContainText("Sports Scheduler");

  await expect(
    page.getByTestId("sports-scheduler-card"),
  ).toContainText("No missed runs");

  await expect(
    page.getByTestId("sports-scheduler-card"),
  ).toContainText(
    "Next: 2026-08-30 20:00 Asia/Kuala_Lumpur EVENING",
  );

  await expect(
    page.getByTestId("sports-scheduler-card"),
  ).toHaveClass(/healthyCard/);
});

test("Atlas API root proxy forwards the root request", async ({ page }) => {
  const response = await page.request.get("/api/atlas/");

  expect(response.status()).toBe(200);
});

test("Calendar retries failed posts and hides retry for non-failed posts", async ({
  page,
}) => {
  const failedAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  const posts = [
    {
      id: "failed-retry-smoke",
      brandId: "brand-1",
      channelId: "channel-1",
      platform: "FACEBOOK",
      title: "Failed retry smoke",
      content: "Failed post content",
      mediaUrls: [],
      scheduledAt: failedAt,
      timezone: "Asia/Kuala_Lumpur",
      status: "FAILED",
      channel: {
        id: "channel-1",
        name: "Smoke Channel",
      },
      campaign: null,
      externalPostId: null,
      externalPostUrl: null,
    },
    {
      id: "scheduled-no-retry-smoke",
      brandId: "brand-1",
      channelId: "channel-1",
      platform: "FACEBOOK",
      title: "Scheduled no retry smoke",
      content: "Scheduled post content",
      mediaUrls: [],
      scheduledAt,
      timezone: "Asia/Kuala_Lumpur",
      status: "SCHEDULED",
      channel: {
        id: "channel-1",
        name: "Smoke Channel",
      },
      campaign: null,
      externalPostId: null,
      externalPostUrl: null,
    },
  ];

  let retryMethod: string | null = null;
  let publishNowMethod: string | null = null;

  await page.route(
    "**/api/atlas/automation/posts/failed-retry-smoke/retry",
    async (route) => {
      retryMethod = route.request().method();

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    },
  );

  await page.route(
    "**/api/atlas/automation/posts/scheduled-no-retry-smoke/publish-now",
    async (route) => {
      publishNowMethod = route.request().method();

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    },
  );

  await page.route(
    "**/api/atlas/automation/posts/calendar**",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(posts),
      });
    },
  );

  await page.route(
    "**/api/atlas/automation/channels",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "channel-1",
            brandId: "brand-1",
            platform: "FACEBOOK",
            name: "Smoke Channel",
            status: "CONNECTED",
          },
        ]),
      });
    },
  );

  await page.route(
    "**/api/atlas/brands",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "brand-1",
            name: "Smoke Brand",
          },
        ]),
      });
    },
  );

  await page.route(
    "**/api/atlas/assets**",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    },
  );

  await page.goto("/calendar");

  const upcoming =
    page.locator("#calendar-upcoming");

  await upcoming
    .getByRole("button", {
      name: /Failed retry smoke/,
    })
    .click();

  const retryButton =
    page.getByRole("button", {
      name: /^(Retry|重试)$/,
    });

  await expect(retryButton).toBeVisible();

  await retryButton.click();

  await expect
    .poll(() => retryMethod)
    .toBe("POST");

  await upcoming
    .getByRole("button", {
      name: /Scheduled no retry smoke/,
    })
    .click();

  await expect(
    page.getByRole("button", {
      name: /^(Retry|重试)$/,
    }),
  ).toHaveCount(0);

  const publishNowButton =
    page.getByRole("button", {
      name: /^(Publish now|立即发布)$/,
    });

  await expect(
    publishNowButton,
  ).toBeVisible();

  await publishNowButton.click();

  await expect
    .poll(() => publishNowMethod)
    .toBe("POST");
});
