import { afterEach, describe, expect, it, vi } from "vitest";

const getLatestQuoteMock = vi.hoisted(() => vi.fn());
const getLatestTradeMock = vi.hoisted(() => vi.fn());
const getBarsMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/broker/alpaca/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/broker/alpaca/client")>();
  return {
    ...actual,
    getLatestQuote: getLatestQuoteMock,
    getLatestTrade: getLatestTradeMock,
    getBars: getBarsMock,
  };
});

// getQuote() calls prisma indirectly through no DB writes, but getCandles()
// does write through prisma - this file only unit-tests getQuote()'s
// price/session mapping, so prisma itself is never invoked here.
import { AlpacaMarketDataProvider } from "@/server/market-data/alpaca";

describe("AlpacaMarketDataProvider.getQuote", () => {
  afterEach(() => {
    getLatestQuoteMock.mockReset();
    getLatestTradeMock.mockReset();
    getBarsMock.mockReset();
  });

  it("maps bid/ask from the latest quote and last price from the latest trade", async () => {
    getLatestQuoteMock.mockResolvedValue({
      symbol: "AAPL",
      quote: { ap: 101, as: 1, bp: 100, bs: 1, t: "2026-01-05T15:00:00Z" },
    });
    getLatestTradeMock.mockResolvedValue({ symbol: "AAPL", trade: { p: 100.5, s: 1, t: "2026-01-05T15:00:00Z" } });
    getBarsMock.mockResolvedValue([
      { t: "2026-01-02T00:00:00Z", o: 95, h: 96, l: 94, c: 95.5, v: 1000 },
      { t: "2026-01-05T00:00:00Z", o: 96, h: 102, l: 95, c: 100.5, v: 2000 },
    ]);

    const provider = new AlpacaMarketDataProvider();
    const quote = await provider.getQuote("instr-1", "AAPL");

    expect(quote.bid).toBe(100);
    expect(quote.ask).toBe(101);
    expect(quote.last).toBe(100.5);
    expect(quote.dayOpen).toBe(96);
    expect(quote.dayHigh).toBe(102);
    expect(quote.dayLow).toBe(95);
    expect(quote.volume).toBe(2000);
    expect(quote.prevClose).toBe(95.5);
    expect(quote.changeAbs).toBeCloseTo(5, 5);
    expect(quote.sourceType).toBe("REALTIME");
  });

  it("falls back to today's open as prevClose when there is no prior daily bar", async () => {
    getLatestQuoteMock.mockResolvedValue({ symbol: "AAPL", quote: { ap: 51, as: 1, bp: 50, bs: 1, t: "t" } });
    getLatestTradeMock.mockResolvedValue({ symbol: "AAPL", trade: { p: 50.5, s: 1, t: "t" } });
    getBarsMock.mockResolvedValue([{ t: "2026-01-05T00:00:00Z", o: 50, h: 51, l: 49, c: 50.5, v: 500 }]);

    const provider = new AlpacaMarketDataProvider();
    const quote = await provider.getQuote("instr-1", "AAPL");

    expect(quote.prevClose).toBe(50);
    expect(quote.changeAbs).toBeCloseTo(0.5, 5);
  });
});
