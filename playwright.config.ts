import { defineConfig, devices } from "@playwright/test";

// PLAYWRIGHT_PORT lets a second checkout run e2e next to another dev server.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3000);
// PLAYWRIGHT_CHANNEL=chrome runs on the installed Google Chrome when the
// Playwright browser build is not downloaded (CI installs chromium).
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) },
    },
  ],
  webServer: {
    command: `npm run dev -- -p ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
