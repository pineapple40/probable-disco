import { test, expect, type Page } from "@playwright/test";

// Reuses the demo session saved by global-setup.ts instead of logging in
// per test - faster, and avoids repeatedly hitting the login rate limiter.
test.use({ storageState: "tests/e2e/.auth/demo.json" });

/** A stop-loss safely under the risk engine's default max-risk-per-trade for a small order. */
async function safeStopLoss(page: Page, symbol: string): Promise<string> {
  const quote: { last: number } = await page.evaluate(
    async (sym) => (await fetch(`/api/market-data/quote?symbol=${sym}`).then((r) => r.json())).data,
    symbol,
  );
  return (quote.last * 0.9).toFixed(2);
}

test.describe("critical trading workflows", () => {
  test("watchlist: add and remove a symbol", async ({ page }) => {
    await page.goto("/watchlists");
    await expect(page.getByText("Core Watchlist")).toBeVisible();

    await page.fill('input[placeholder="Add symbol (e.g. AAPL)"]', "META");
    await page.click('button:has-text("Add")');
    await expect(page.getByRole("cell", { name: "META", exact: true })).toBeVisible({ timeout: 10_000 });

    const row = page.locator("tr", { has: page.getByRole("cell", { name: "META", exact: true }) });
    await row.getByText("Remove").click();
    await expect(page.getByRole("cell", { name: "META", exact: true })).not.toBeVisible({ timeout: 10_000 });
  });

  test("chart: loads a real candlestick chart for a symbol", async ({ page }) => {
    await page.goto("/charts?symbol=AAPL");
    await expect(page.getByText("AAPL — D1")).toBeVisible();
    // lightweight-charts renders into a canvas inside the chart container.
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
  });

  test("order entry: a buy without a stop-loss is rejected by the risk engine", async ({ page }) => {
    await page.goto("/dashboard");
    await page.fill("#ticket-symbol", "AAPL");
    await page.fill("#ticket-qty", "5");
    await page.click('button:has-text("Buy AAPL")');
    await expect(page.getByText(/stop-loss price is required/i)).toBeVisible({ timeout: 10_000 });
  });

  test("order entry: a valid market buy fills and shows up in positions", async ({ page }) => {
    await page.goto("/dashboard");
    const stopLoss = await safeStopLoss(page, "MSFT");
    await page.fill("#ticket-symbol", "MSFT");
    await page.fill("#ticket-qty", "3");
    await page.fill("#ticket-sl", stopLoss);
    await page.click('button:has-text("Buy MSFT")');
    await expect(page.locator("strong", { hasText: "FILLED" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("cell", { name: "MSFT", exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("order entry: a resting limit order can be canceled", async ({ page }) => {
    await page.goto("/dashboard");
    await page.fill("#ticket-symbol", "NVDA");
    await page.getByLabel("Type").selectOption("LIMIT");
    await page.fill("#ticket-limit", "1");
    await page.fill("#ticket-qty", "1");
    await page.fill("#ticket-sl", "0.5");
    await page.click('button:has-text("Buy NVDA")');
    await expect(page.locator("strong", { hasText: "NEW" })).toBeVisible({ timeout: 10_000 });

    // Scope the cancel to this specific NVDA LIMIT order's row (the leaf row
    // element in the "Open orders" list, identified by its own classes - not
    // an ancestor `has`/`hasText` combinator, which would keep matching a
    // broader wrapper via the unrelated "Recent orders" list below once this
    // row is gone). A filled buy with a stop-loss now creates its own
    // resting protective stop order (a real bracket leg), which is also
    // cancelable, so asserting on a page-wide "Cancel" button count would be
    // flaky depending on what other tests ran first.
    const row = page.locator("div.flex.items-center.justify-between.rounded-md", { hasText: /NVDA LIMIT/ });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.getByRole("button", { name: "Cancel" }).click();
    await expect(row).not.toBeVisible({ timeout: 10_000 });
  });
});
