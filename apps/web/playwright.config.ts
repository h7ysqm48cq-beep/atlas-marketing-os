import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  globalSetup: "./tests/auth.setup.ts",
  testDir: "./tests",

  timeout: 30000,

  use: {
    storageState: "tests/.auth/user.json",
    baseURL:
      process.env.PLAYWRIGHT_BASE_URL ??
      "http://localhost:3000",

    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
      },
    },
  ],
});
