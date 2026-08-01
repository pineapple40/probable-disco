import { test, expect } from "@playwright/test";

test.describe("authentication", () => {
  test("a new user can register and is prompted to verify their email", async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;
    await page.goto("/register");
    await page.fill("#displayName", "E2E Test User");
    await page.fill("#email", email);
    await page.fill("#password", "Str0ng!Passw0rd");
    await page.click('button[type="submit"]');
    await expect(page.getByText("Check your email")).toBeVisible({ timeout: 10_000 });
  });

  test("rejects login with the wrong password and shows an error", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "demo@probable-disco.local");
    await page.fill("#password", "totally-wrong-password");
    await page.click('button[type="submit"]');
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("logs in with valid demo credentials and reaches the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "demo@probable-disco.local");
    await page.fill("#password", "Demo!Trader123");
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
    await expect(page.getByText("Signed in as")).toBeVisible();
  });

  test("an unauthenticated visitor is redirected away from a protected page", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });
});
