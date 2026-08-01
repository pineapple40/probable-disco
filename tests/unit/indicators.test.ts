import { describe, expect, it } from "vitest";
import { atr, bollingerBands, ema, macd, rsi, sma, vwap } from "@/lib/indicators";

describe("sma", () => {
  it("computes a simple moving average and pads with null before the period", () => {
    const result = sma([1, 2, 3, 4, 5], 3);
    expect(result).toEqual([null, null, 2, 3, 4]);
  });

  it("returns all nulls when there is not enough data", () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });
});

describe("ema", () => {
  it("seeds with an SMA and recurses forward", () => {
    // For a perfectly linear series, EMA and SMA coincide exactly.
    const result = ema([1, 2, 3, 4, 5], 3);
    expect(result).toEqual([null, null, 2, 3, 4]);
  });

  it("weights recent values more heavily than SMA on a non-linear series", () => {
    const closes = [1, 1, 1, 1, 10];
    const emaResult = ema(closes, 3);
    const smaResult = sma(closes, 3);
    expect(emaResult[4]!).toBeGreaterThan(smaResult[4]!);
  });
});

describe("rsi", () => {
  it("is 100 for a strictly increasing series (no losses)", () => {
    const closes = Array.from({ length: 20 }, (_, i) => i + 1);
    const result = rsi(closes, 14);
    expect(result[14]).toBe(100);
    expect(result[19]).toBe(100);
  });

  it("is 0 for a strictly decreasing series (no gains)", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    const result = rsi(closes, 14);
    expect(result[14]).toBe(0);
  });

  it("stays within [0, 100] for mixed data", () => {
    const closes = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17, 19];
    const result = rsi(closes, 14);
    for (const v of result) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("macd", () => {
  it("computes histogram as macd minus signal", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.5);
    const { macd: macdLine, signal, histogram } = macd(closes);
    for (let i = 0; i < closes.length; i++) {
      if (macdLine[i] !== null && signal[i] !== null) {
        expect(histogram[i]!).toBeCloseTo(macdLine[i]! - signal[i]!, 8);
      }
    }
  });
});

describe("bollingerBands", () => {
  it("centers the bands on the middle SMA with a symmetric spread", () => {
    const closes = [10, 11, 9, 12, 8, 13, 7, 14, 6, 15];
    const { upper, middle, lower } = bollingerBands(closes, 5, 2);
    for (let i = 4; i < closes.length; i++) {
      expect(middle[i]).not.toBeNull();
      const mid = middle[i]!;
      const spreadUp = upper[i]! - mid;
      const spreadDown = mid - lower[i]!;
      expect(spreadUp).toBeCloseTo(spreadDown, 8);
      expect(upper[i]!).toBeGreaterThan(lower[i]!);
    }
  });

  it("has zero-width bands when price is constant", () => {
    const closes = new Array(10).fill(50);
    const { upper, middle, lower } = bollingerBands(closes, 5, 2);
    expect(upper[9]).toBeCloseTo(50, 8);
    expect(middle[9]).toBeCloseTo(50, 8);
    expect(lower[9]).toBeCloseTo(50, 8);
  });
});

describe("atr", () => {
  it("equals the average bar range when there are no gaps", () => {
    const bars = [
      { open: 10, high: 12, low: 8, close: 10, volume: 100 },
      { open: 10, high: 12, low: 8, close: 10, volume: 100 },
      { open: 10, high: 12, low: 8, close: 10, volume: 100 },
    ];
    const result = atr(bars, 3);
    expect(result[2]).toBeCloseTo(4, 8); // high-low = 4 for every bar, no gaps
  });

  it("accounts for gaps via true range", () => {
    const bars = [
      { open: 10, high: 11, low: 9, close: 10, volume: 100 },
      { open: 10, high: 21, low: 20, close: 20, volume: 100 }, // gapped up from prev close 10
      { open: 20, high: 21, low: 19, close: 20, volume: 100 },
    ];
    const result = atr(bars, 3);
    // True range for bar 1 is max(21-20, |21-10|, |20-10|) = 11, much wider than high-low=1.
    expect(result[2]!).toBeGreaterThan(2);
  });
});

describe("vwap", () => {
  it("equals the typical price when volume is constant", () => {
    const bars = [
      { open: 10, high: 12, low: 8, close: 10, volume: 100 },
      { open: 10, high: 14, low: 6, close: 10, volume: 100 },
    ];
    const result = vwap(bars);
    // Typical price for both bars is 10, so cumulative VWAP should stay 10.
    expect(result[0]).toBeCloseTo(10, 8);
    expect(result[1]).toBeCloseTo(10, 8);
  });

  it("weights higher-volume bars more heavily", () => {
    const bars = [
      { open: 10, high: 10, low: 10, close: 10, volume: 1000 },
      { open: 20, high: 20, low: 20, close: 20, volume: 1 },
    ];
    const result = vwap(bars);
    expect(result[1]!).toBeLessThan(10.1);
  });
});
