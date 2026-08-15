import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the Intelligent Tabletop e2e suite.
 *
 * The tabletop dev server is managed by the Replit workflow (port 22382).
 * `reuseExistingServer: true` means Playwright will use that running server
 * and not start a duplicate.  When no server is running (e.g. in CI) the
 * webServer block starts one automatically.
 */
export default defineConfig({
  testDir: "./e2e",
  /* Fail fast in CI; keep going locally so you see all failures at once. */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,              // tests share a running server — serialise to avoid race conditions
  reporter: "list",

  use: {
    baseURL: "http://localhost:22382",
    /* Each test gets a clean browser context. */
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "PORT=22382 BASE_PATH=/ pnpm --filter @workspace/tabletop run dev",
    url: "http://localhost:22382",
    /* Reuse the Replit workflow server if it is already running. */
    reuseExistingServer: true,
    env: {
      PORT: "22382",
      BASE_PATH: "/",
    },
    timeout: 30_000,
  },
});
