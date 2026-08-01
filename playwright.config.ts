import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// This repo's local sandbox environment pre-installs Chromium at a fixed
// path (see the environment notes) to avoid re-downloading it. CI and other
// environments won't have that path, so fall back to Playwright's own
// managed browser (installed via `npx playwright install --with-deps
// chromium`) whenever it isn't present.
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const executablePath = fs.existsSync(SANDBOX_CHROMIUM_PATH) ? SANDBOX_CHROMIUM_PATH : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath,
          args: ["--no-sandbox"],
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/auth/session",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
