import { defineConfig, devices } from "@playwright/test";

// UAT suites: run against the live stack. `npm run test:uat` (or pass a folder: `... tests/smoke`).
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["smoke/**/*.spec.ts", "regression/**/*.spec.ts", "exploratory/**/*.spec.ts", "destructive/**/*.spec.ts", "accessibility/**/*.spec.ts", "performance/**/*.spec.ts"],
  globalSetup: "./tests/support/global-setup.ts",
  globalTeardown: "./tests/support/global-teardown.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results/uat-results.json" }]],
  outputDir: "test-results/uat",
  use: {
    baseURL,
    viewport: { width: 1500, height: 900 },
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1500, height: 900 } } }],
});
