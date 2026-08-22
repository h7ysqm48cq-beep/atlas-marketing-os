import { chromium } from "@playwright/test";
import path from "path";

export default async function globalSetup() {
  const browser = await chromium.launch({
    channel: "chrome",
  });

  const context = await browser.newContext({
    storageState: undefined,
  });

  const page = await context.newPage();

  const baseURL =
    process.env.PLAYWRIGHT_BASE_URL ??
    "http://localhost:3000";

  await page.goto(`${baseURL}/login`);

  await page.waitForTimeout(3000);

  await page.locator('input[name="email"]').fill(
    process.env.E2E_EMAIL || "",
  );

  await page.locator('input[name="password"]').fill(
    process.env.E2E_PASSWORD || "",
  );

  
await page.getByRole("button", {
    name: /^Sign in$/i,
  }).click();

  await page.waitForTimeout(5000);

  console.log(
    "LOGIN RESULT URL:",
    page.url(),
  );

  const body = await page.locator("body").innerText();

  console.log(
    "LOGIN RESULT BODY:",
    body.slice(0,300),
  );

  if (
    page.url().includes("/login") &&
    body.includes("Welcome back to Atlas")
  ) {
    throw new Error(
      "Login failed: still on login page",
    );
  }

  await page.waitForTimeout(1000);

  console.log(
    "AFTER LOGIN URL:",
    page.url(),
  );

  console.log("AFTER LOGIN URL:", page.url());
  const storage = await context.storageState();

  console.log(
    "STORAGE ORIGINS:",
    storage.origins.length
  );

  await context.storageState({
    path: path.resolve(
      "tests/.auth/user.json",
    ),
  });

  await browser.close();
}
