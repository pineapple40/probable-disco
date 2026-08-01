import { afterEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
  ALPACA_API_KEY: "test-key",
  ALPACA_API_SECRET: "test-secret",
  ALPACA_PAPER_BASE_URL: "https://paper-api.alpaca.markets",
  ALPACA_DATA_BASE_URL: "https://data.alpaca.markets",
}));
vi.mock("@/lib/env", () => ({ env: envMock }));

import { AlpacaApiError, createOrder, cancelOrder, getLatestQuote, getBars } from "@/server/broker/alpaca/client";

describe("alpaca client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the API key/secret as headers and never leaks them into a thrown error", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response("insufficient buying power", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const orderInput = {
      symbol: "AAPL",
      side: "buy" as const,
      type: "market" as const,
      qty: "1",
      time_in_force: "day" as const,
      client_order_id: "x",
    };

    await expect(createOrder(orderInput)).rejects.toThrow(AlpacaApiError);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://paper-api.alpaca.markets/v2/orders");
    expect(init.headers["APCA-API-KEY-ID"]).toBe("test-key");
    expect(init.headers["APCA-API-SECRET-KEY"]).toBe("test-secret");

    try {
      await createOrder(orderInput);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("test-secret");
      expect((err as Error).message).not.toContain("test-key");
      expect((err as Error).message).toContain("insufficient buying power");
    }
  });

  it("cancels an order via DELETE against the trading base URL and tolerates a 204 empty body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelOrder("abc123")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://paper-api.alpaca.markets/v2/orders/abc123");
    expect(init.method).toBe("DELETE");
  });

  it("fetches quotes from the market-data base URL, not the trading base URL", async () => {
    const body = { symbol: "AAPL", quote: { ap: 101, as: 1, bp: 100, bs: 1, t: "2026-01-01T00:00:00Z" } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const quote = await getLatestQuote("AAPL");
    expect(quote.quote.ap).toBe(101);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://data.alpaca.markets/v2/stocks/AAPL/quotes/latest");
  });

  it("follows next_page_token pagination until exhausted when fetching bars", async () => {
    const page1 = {
      bars: [{ t: "2026-01-01T00:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 100 }],
      next_page_token: "tok2",
    };
    const page2 = {
      bars: [{ t: "2026-01-02T00:00:00Z", o: 1.5, h: 2.5, l: 1, c: 2, v: 200 }],
      next_page_token: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const bars = await getBars("AAPL", "1Day", new Date("2026-01-01"), new Date("2026-01-03"));
    expect(bars).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toContain("page_token=tok2");
  });
});
