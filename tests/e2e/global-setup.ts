import fs from "node:fs";
import { execSync } from "node:child_process";
import { chromium, type FullConfig } from "@playwright/test";

const STORAGE_STATE_PATH = "tests/e2e/.auth/demo.json";
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";

export default async function globalSetup(config: FullConfig) {
  // Repeated local/CI runs share the same loopback address, so clear the
  // login rate-limit bucket first - otherwise a burst of prior runs can
  // exhaust it and every subsequent login in the suite fails with 429.
  try {
    execSync(
      `docker exec probable-disco-redis redis-cli EVAL "for _,k in ipairs(redis.call('keys','ratelimit:login:*')) do redis.call('del', k) end" 0`,
      { stdio: "pipe" },
    );
  } catch {
    // Best-effort; if Redis isn't reachable here the login below will surface it clearly.
  }

  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3000";
  const browser = await chromium.launch({
    executablePath: fs.existsSync(SANDBOX_CHROMIUM_PATH) ? SANDBOX_CHROMIUM_PATH : undefined,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ baseURL });
  await page.goto("/login");
  await page.fill("#email", "demo@probable-disco.local");
  await page.fill("#password", "Demo!Trader123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await page.context().storageState({ path: STORAGE_STATE_PATH });
  await browser.close();
}
