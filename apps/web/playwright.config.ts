import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",

  timeout: 30000,

  use: {
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
