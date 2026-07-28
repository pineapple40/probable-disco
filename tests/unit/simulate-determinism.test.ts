import { describe, expect, it } from "vitest";
import { generateDailyCandles, generateIntradayCandlesForDay } from "@/server/market-data/simulate";

describe("generateDailyCandles determinism", () => {
  const epoch = new Date(Date.UTC(2023, 0, 2));
  const through = new Date(Date.UTC(2023, 2, 1));

  it("produces an identical path for the same symbol across repeated calls", () => {
    const a = generateDailyCandles("AAPL", epoch, through);
    const b = generateDailyCandles("AAPL", epoch, through);
    expect(a).toEqual(b);
  });

  it("produces a different path for a different symbol", () => {
    const aapl = generateDailyCandles("AAPL", epoch, through);
    const msft = generateDailyCandles("MSFT", epoch, through);
    expect(aapl).not.toEqual(msft);
  });

  it("only generates bars on weekdays", () => {
    const candles = generateDailyCandles("AAPL", epoch, through);
    for (const c of candles) {
      const day = c.ts.getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it("produces strictly increasing timestamps", () => {
    const candles = generateDailyCandles("AAPL", epoch, through);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.ts.getTime()).toBeGreaterThan(candles[i - 1]!.ts.getTime());
    }
  });

  it("keeps high as the max and low as the min of open/close for every bar", () => {
    const candles = generateDailyCandles("AAPL", epoch, through);
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
  });
});

describe("generateIntradayCandlesForDay", () => {
  it("is a Brownian bridge that starts at the day's open and ends exactly at the day's close", () => {
    const day = new Date(Date.UTC(2024, 0, 3));
    const bars = generateIntradayCandlesForDay("AAPL", 5, day, 100, 110, 10_000_000);
    expect(bars[0]!.open).toBeCloseTo(100, 8);
    expect(bars[bars.length - 1]!.close).toBeCloseTo(110, 8);
  });

  it("produces the same path deterministically for the same inputs", () => {
    const day = new Date(Date.UTC(2024, 0, 3));
    const a = generateIntradayCandlesForDay("AAPL", 5, day, 100, 110, 10_000_000);
    const b = generateIntradayCandlesForDay("AAPL", 5, day, 100, 110, 10_000_000);
    expect(a).toEqual(b);
  });
});
