import { expect, test } from "@playwright/test";

async function mockKnowledgeApi(page: import("@playwright/test").Page) {
  let uploadRequests = 0;

  await page.route("**/api/atlas/knowledge**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname.endsWith("/knowledge/upload")) {
      uploadRequests += 1;

      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          document: {
            id: "doc-excel-test",
            title: "Excel test",
            category: "Imported Document",
            content: "Imported spreadsheet content",
            tags: ["Imported", "Reference"],
            usageCount: 0,
            createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-09-01T00:00:00.000Z",
          },
          upload: {
            originalName: "knowledge.xlsx",
            extractedCharacters: 28,
            url: "https://example.invalid/knowledge.xlsx",
          },
        }),
      });
      return;
    }

    if (url.pathname.endsWith("/knowledge")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
      return;
    }

    await route.continue();
  });

  return () => uploadRequests;
}

test(".xlsx reaches the knowledge upload endpoint", async ({ page }) => {
  const getUploadRequests = await mockKnowledgeApi(page);

  await page.goto("/knowledge");

  await page.locator('input[type="file"]').setInputFiles({
    name: "knowledge.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("xlsx-regression-fixture"),
  });

  await expect.poll(getUploadRequests).toBe(1);
});

test(".xls reaches the knowledge upload endpoint", async ({ page }) => {
  const getUploadRequests = await mockKnowledgeApi(page);

  await page.goto("/knowledge");

  await page.locator('input[type="file"]').setInputFiles({
    name: "knowledge.xls",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from("xls-regression-fixture"),
  });

  await expect.poll(getUploadRequests).toBe(1);
});

test("unsupported files remain blocked before upload", async ({ page }) => {
  const getUploadRequests = await mockKnowledgeApi(page);

  await page.goto("/knowledge");

  await page.locator('input[type="file"]').setInputFiles({
    name: "knowledge.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("a,b\n1,2"),
  });

  await page.waitForTimeout(150);

  expect(getUploadRequests()).toBe(0);
  await expect(page.locator("p").filter({ hasText: "Upload" })).toContainText(
    "files only",
  );
});
