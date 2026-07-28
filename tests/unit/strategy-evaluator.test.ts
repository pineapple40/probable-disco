import { describe, expect, it } from "vitest";
import { evaluateEntry, evaluateExit, type StrategyBar } from "@/server/strategy/evaluator";
import type { StrategyDefinition } from "@/server/strategy/types";

function makeBars(closes: number[]): StrategyBar[] {
  const base = new Date("2024-01-02T00:00:00.000Z");
  return closes.map((close, i) => ({
    ts: new Date(base.getTime() + i * 24 * 60 * 60 * 1000),
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: 1_000_000,
  }));
}

function baseDefinition(overrides: Partial<StrategyDefinition> = {}): StrategyDefinition {
  return {
    symbols: ["TEST"],
    maxTradesPerDay: 5,
    positionSizing: { method: "fixed_quantity", value: 10 },
    entryRules: [{ type: "price_above", value: 100 }],
    exitRules: [],
    ...overrides,
  };
}

describe("evaluateEntry", () => {
  it("never triggers on the first bar (no prior data)", () => {
    const bars = makeBars([101]);
    expect(evaluateEntry(baseDefinition(), bars, 0)).toBe(false);
  });

  it("triggers a simple price_above condition", () => {
    const bars = makeBars([90, 101]);
    expect(evaluateEntry(baseDefinition(), bars, 1)).toBe(true);
  });

  it("requires ALL entry rules to be true", () => {
    const definition = baseDefinition({
      entryRules: [
        { type: "price_above", value: 100 },
        { type: "price_below", value: 50 }, // impossible to satisfy alongside price_above 100
      ],
    });
    const bars = makeBars([90, 101]);
    expect(evaluateEntry(definition, bars, 1)).toBe(false);
  });

  it("detects an SMA crossover", () => {
    // Prices dip then spike so close crosses back above its own SMA(3).
    const bars = makeBars([100, 100, 100, 90, 130]);
    const definition = baseDefinition({ entryRules: [{ type: "sma_cross_above", period: 3 }] });
    // At index 3 (close=90), price is below SMA - no cross yet.
    expect(evaluateEntry(definition, bars, 3)).toBe(false);
    // At index 4 (close=130), price crosses back above the SMA(3).
    expect(evaluateEntry(definition, bars, 4)).toBe(true);
  });

  it("evaluates time-of-day conditions from bar timestamps", () => {
    const bars: StrategyBar[] = [
      { ts: new Date("2024-01-02T14:00:00.000Z"), open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { ts: new Date("2024-01-02T15:00:00.000Z"), open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ];
    const definition = baseDefinition({ entryRules: [{ type: "time_after", minutesFromOpen: 60 }] });
    // 14:00 UTC = 9:30 (open) + 30min -> minutesFromOpen ~30, condition (>=60) is false.
    expect(evaluateEntry(definition, bars, 0)).toBe(false);
    // 15:00 UTC -> minutesFromOpen ~90, condition true.
    expect(evaluateEntry(definition, bars, 1)).toBe(true);
  });
});

describe("evaluateExit", () => {
  it("exits on stop-loss when the bar's low touches the stop price", () => {
    const definition = baseDefinition({ stopLossPct: 5 });
    const bars = makeBars([100, 94]); // low = 93.5, stop = 100*0.95 = 95
    const result = evaluateExit(definition, bars, 1, { entryPrice: 100, entryIndex: 0 });
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("stop_loss");
  });

  it("exits on take-profit when the bar's high touches the target price", () => {
    const definition = baseDefinition({ takeProfitPct: 10 });
    const bars = makeBars([100, 112]); // high = 112.5, target = 110
    const result = evaluateExit(definition, bars, 1, { entryPrice: 100, entryIndex: 0 });
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("take_profit");
  });

  it("does not exit when price stays within stop and target", () => {
    const definition = baseDefinition({ stopLossPct: 5, takeProfitPct: 10 });
    const bars = makeBars([100, 101]);
    const result = evaluateExit(definition, bars, 1, { entryPrice: 100, entryIndex: 0 });
    expect(result.shouldExit).toBe(false);
  });

  it("exits on a rule-based exit condition", () => {
    const definition = baseDefinition({ exitRules: [{ type: "price_below", value: 95 }] });
    const bars = makeBars([100, 90]);
    const result = evaluateExit(definition, bars, 1, { entryPrice: 100, entryIndex: 0 });
    expect(result.shouldExit).toBe(true);
    expect(result.reason).toBe("signal_exit");
  });

  it("stop-loss takes priority over a rule-based exit when both would fire", () => {
    const definition = baseDefinition({
      stopLossPct: 5,
      exitRules: [{ type: "price_below", value: 95 }],
    });
    const bars = makeBars([100, 90]); // low = 89.5, stop = 95; both conditions technically true
    const result = evaluateExit(definition, bars, 1, { entryPrice: 100, entryIndex: 0 });
    expect(result.reason).toBe("stop_loss");
  });
});
