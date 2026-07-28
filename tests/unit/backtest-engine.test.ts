import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestSettings } from "@/server/backtesting/engine";
import { computeBacktestMetrics } from "@/server/backtesting/metrics";
import type { StrategyBar } from "@/server/strategy/evaluator";
import type { StrategyDefinition } from "@/server/strategy/types";

function day(n: number): Date {
  return new Date(Date.UTC(2024, 0, 2 + n));
}

const NO_COST_SETTINGS: BacktestSettings = {
  initialCapital: 100_000,
  commissionPerTrade: 0,
  slippageBps: 0,
  spreadBps: 0,
  maxPositions: 5,
};

function bar(n: number, open: number, close: number, high?: number, low?: number): StrategyBar {
  return {
    ts: day(n),
    open,
    close,
    high: high ?? Math.max(open, close),
    low: low ?? Math.min(open, close),
    volume: 1_000_000,
  };
}

describe("runBacktest", () => {
  it("never fills an entry at the same bar's close - always the next bar's open", () => {
    const definition: StrategyDefinition = {
      symbols: ["TEST"],
      maxTradesPerDay: 5,
      positionSizing: { method: "fixed_quantity", value: 10 },
      entryRules: [{ type: "price_above", value: 100 }],
      exitRules: [{ type: "price_below", value: 90 }],
    };
    const bars: StrategyBar[] = [
      bar(0, 94, 95),
      bar(1, 95, 105), // close > 100 -> signal queued here
      bar(2, 106, 106), // entry must fill at THIS bar's open (106), not bar1's close (105)
      bar(3, 107, 107),
      bar(4, 108, 85), // close < 90 -> exit signal queued here
      bar(5, 84, 84), // exit must fill at this bar's open (84)
    ];

    const { trades } = runBacktest(definition, { TEST: bars }, NO_COST_SETTINGS);
    expect(trades).toHaveLength(1);
    const trade = trades[0]!;
    expect(trade.entryPrice).toBe(106);
    expect(trade.exitPrice).toBe(84);
    expect(trade.quantity).toBe(10);
    expect(trade.pnl).toBeCloseTo((84 - 106) * 10, 8);
    expect(trade.reason).toBe("signal_exit");
    expect(trade.entryAt.getTime()).toBe(day(2).getTime());
    expect(trade.exitAt.getTime()).toBe(day(5).getTime());
  });

  it("fills a stop-loss intrabar at the clamped stop price, not the bar's close", () => {
    const definition: StrategyDefinition = {
      symbols: ["TEST"],
      maxTradesPerDay: 5,
      positionSizing: { method: "fixed_quantity", value: 10 },
      entryRules: [{ type: "price_above", value: 100 }],
      exitRules: [],
      stopLossPct: 5, // stop at entry * 0.95
    };
    const bars: StrategyBar[] = [
      bar(0, 94, 95),
      bar(1, 95, 105), // signal entry
      bar(2, 100, 100), // entry fills at open=100; stop = 95
      bar(3, 99, 98, 99, 92), // low=92 pierces the stop (95) intrabar
      bar(4, 97, 97),
    ];

    const { trades } = runBacktest(definition, { TEST: bars }, NO_COST_SETTINGS);
    expect(trades).toHaveLength(1);
    const trade = trades[0]!;
    expect(trade.entryPrice).toBe(100);
    expect(trade.reason).toBe("stop_loss");
    expect(trade.exitPrice).toBeCloseTo(95, 8); // clamped stop level, not the bar's close (98)
    expect(trade.exitAt.getTime()).toBe(day(3).getTime()); // same bar, not delayed to next open
  });

  it("fills a take-profit intrabar at the clamped target price", () => {
    const definition: StrategyDefinition = {
      symbols: ["TEST"],
      maxTradesPerDay: 5,
      positionSizing: { method: "fixed_quantity", value: 10 },
      entryRules: [{ type: "price_above", value: 100 }],
      exitRules: [],
      takeProfitPct: 10, // target at entry * 1.10
    };
    const bars: StrategyBar[] = [
      bar(0, 94, 95),
      bar(1, 95, 105),
      bar(2, 100, 100), // entry at 100, target = 110
      // high=112 pierces the target (110) intrabar; close=99 (<100) prevents
      // an immediate re-entry once the position is flat again this same bar.
      bar(3, 101, 99, 112, 95),
      bar(4, 106, 106),
    ];

    const { trades } = runBacktest(definition, { TEST: bars }, NO_COST_SETTINGS);
    expect(trades).toHaveLength(1);
    expect(trades[0]!.exitPrice).toBeCloseTo(110, 8);
    expect(trades[0]!.reason).toBe("take_profit");
  });

  it("sizes positions using fixed notional and floors to whole shares", () => {
    const definition: StrategyDefinition = {
      symbols: ["TEST"],
      maxTradesPerDay: 5,
      positionSizing: { method: "fixed_notional", value: 1000 },
      entryRules: [{ type: "price_above", value: 100 }],
      exitRules: [{ type: "price_below", value: 1 }], // never triggers; force-closed at end
    };
    const bars: StrategyBar[] = [bar(0, 94, 95), bar(1, 95, 105), bar(2, 97, 97), bar(3, 97, 97)];

    const { trades } = runBacktest(definition, { TEST: bars }, NO_COST_SETTINGS);
    expect(trades).toHaveLength(1);
    // entry fills at bar2's open (97): floor(1000 / 97) = 10 shares
    expect(trades[0]!.quantity).toBe(10);
  });

  it("force-closes any still-open position at the final bar's close", () => {
    const definition: StrategyDefinition = {
      symbols: ["TEST"],
      maxTradesPerDay: 5,
      positionSizing: { method: "fixed_quantity", value: 5 },
      entryRules: [{ type: "price_above", value: 100 }],
      exitRules: [], // no exit condition at all
    };
    const bars: StrategyBar[] = [bar(0, 94, 95), bar(1, 95, 105), bar(2, 97, 97), bar(3, 99, 99)];

    const { trades } = runBacktest(definition, { TEST: bars }, NO_COST_SETTINGS);
    expect(trades).toHaveLength(1);
    expect(trades[0]!.reason).toBe("end_of_backtest");
    expect(trades[0]!.exitPrice).toBe(99); // last bar's close
  });

  it("applies commission, slippage, and spread to fills", () => {
    const definition: StrategyDefinition = {
      symbols: ["TEST"],
      maxTradesPerDay: 5,
      positionSizing: { method: "fixed_quantity", value: 10 },
      entryRules: [{ type: "price_above", value: 100 }],
      exitRules: [],
    };
    const bars: StrategyBar[] = [bar(0, 94, 95), bar(1, 95, 105), bar(2, 100, 100), bar(3, 100, 100)];
    const settings: BacktestSettings = {
      initialCapital: 100_000,
      commissionPerTrade: 1,
      slippageBps: 100, // 1%
      spreadBps: 0,
      maxPositions: 5,
    };

    const { trades } = runBacktest(definition, { TEST: bars }, settings);
    expect(trades).toHaveLength(1);
    // Buy fill = open * (1 + 1%) = 101
    expect(trades[0]!.entryPrice).toBeCloseTo(101, 8);
    // Round-trip commission is charged (entry + exit).
    expect(trades[0]!.commission).toBeCloseTo(2, 8);
  });

  it("never opens more concurrent positions than maxPositions", () => {
    const definition: StrategyDefinition = {
      symbols: ["A", "B", "C"],
      maxTradesPerDay: 5,
      positionSizing: { method: "fixed_quantity", value: 1 },
      entryRules: [{ type: "price_above", value: 1 }],
      exitRules: [],
    };
    const bars: StrategyBar[] = [bar(0, 10, 10), bar(1, 10, 10), bar(2, 10, 10), bar(3, 10, 10)];
    const settings: BacktestSettings = { ...NO_COST_SETTINGS, maxPositions: 2 };

    const { trades } = runBacktest(
      definition,
      { A: bars, B: bars, C: bars },
      settings,
    );
    // All three symbols would want to enter simultaneously, but the cap is 2.
    const entriesAtSameTime = trades.filter((t) => t.entryAt.getTime() === bars[2]!.ts.getTime());
    expect(entriesAtSameTime.length).toBeLessThanOrEqual(2);
  });

  it("never exceeds maxTradesPerDay when multiple symbols signal on the same bar", () => {
    const definition: StrategyDefinition = {
      symbols: ["A", "B", "C"],
      maxTradesPerDay: 1,
      positionSizing: { method: "fixed_quantity", value: 1 },
      entryRules: [{ type: "price_above", value: 1 }],
      exitRules: [],
    };
    const bars: StrategyBar[] = [bar(0, 10, 10), bar(1, 10, 10), bar(2, 10, 10), bar(3, 10, 10)];
    const settings: BacktestSettings = { ...NO_COST_SETTINGS, maxPositions: 3 };

    const { trades } = runBacktest(definition, { A: bars, B: bars, C: bars }, settings);
    // All three symbols signal simultaneously and there's capacity for 3
    // concurrent positions, but maxTradesPerDay: 1 must still cap same-day
    // entries to one, even across different symbols.
    const entriesAtSameTime = trades.filter((t) => t.entryAt.getTime() === bars[2]!.ts.getTime());
    expect(entriesAtSameTime.length).toBeLessThanOrEqual(1);
  });
});

describe("computeBacktestMetrics", () => {
  it("computes win rate, profit factor, and expectancy correctly", () => {
    const trades = [
      { symbol: "T", side: "BUY" as const, quantity: 1, entryPrice: 100, exitPrice: 110, entryAt: day(0), exitAt: day(1), pnl: 100, commission: 0, reason: "signal_exit" },
      { symbol: "T", side: "BUY" as const, quantity: 1, entryPrice: 100, exitPrice: 90, entryAt: day(1), exitAt: day(2), pnl: -50, commission: 0, reason: "stop_loss" },
      { symbol: "T", side: "BUY" as const, quantity: 1, entryPrice: 100, exitPrice: 120, entryAt: day(2), exitAt: day(3), pnl: 200, commission: 0, reason: "take_profit" },
    ];
    const equityCurve = [
      { date: day(0), equity: 100_000 },
      { date: day(1), equity: 100_100 },
      { date: day(2), equity: 100_050 },
      { date: day(3), equity: 100_250 },
    ];
    const metrics = computeBacktestMetrics(trades, equityCurve, 100_000);
    expect(metrics.numberOfTrades).toBe(3);
    expect(metrics.winRatePct).toBeCloseTo((2 / 3) * 100, 8);
    expect(metrics.netPnl).toBeCloseTo(250, 8);
    expect(metrics.profitFactor).toBeCloseTo(300 / 50, 8);
    expect(metrics.expectancy).toBeCloseTo(250 / 3, 8);
    expect(metrics.largestWin).toBe(200);
    expect(metrics.largestLoss).toBe(-50);
  });

  it("returns null profit factor and Sharpe/Sortino when there is no loss/insufficient data", () => {
    const trades = [
      { symbol: "T", side: "BUY" as const, quantity: 1, entryPrice: 100, exitPrice: 110, entryAt: day(0), exitAt: day(1), pnl: 100, commission: 0, reason: "signal_exit" },
    ];
    const equityCurve = [{ date: day(0), equity: 100_000 }];
    const metrics = computeBacktestMetrics(trades, equityCurve, 100_000);
    expect(metrics.profitFactor).toBeNull();
    expect(metrics.sharpeRatio).toBeNull();
  });

  it("computes max drawdown % against the peak at the time of the drawdown, not the final peak", () => {
    const trades = [
      { symbol: "T", side: "BUY" as const, quantity: 1, entryPrice: 100, exitPrice: 50, entryAt: day(0), exitAt: day(1), pnl: -50, commission: 0, reason: "stop_loss" },
    ];
    // Equity falls from 100 to 50 (a 50% drawdown at the time), then later
    // grows to 1000 - the 50% drawdown must not be diluted to 5% just
    // because a much higher peak was reached afterward.
    const equityCurve = [
      { date: day(0), equity: 100 },
      { date: day(1), equity: 50 },
      { date: day(2), equity: 1000 },
    ];
    const metrics = computeBacktestMetrics(trades, equityCurve, 100);
    expect(metrics.maxDrawdownPct).toBeCloseTo(50, 8);
  });

  it("computes Sharpe using standard deviation around the mean, not RMS around zero", () => {
    // Daily returns alternate +5%/-5%/+5%/-5%/+5% (mean = +1%). The correct
    // Sharpe uses stdDev around that +1% mean (~3.24 annualized); the buggy
    // RMS-around-zero formula would instead produce ~3.17, since all
    // |return| values are equal it ignores the mean entirely.
    const equityCurve = [
      { date: new Date(2024, 0, 1), equity: 100_000 },
      { date: new Date(2024, 0, 2), equity: 105_000 },
      { date: new Date(2024, 0, 3), equity: 99_750 },
      { date: new Date(2024, 0, 4), equity: 104_737.5 },
      { date: new Date(2024, 0, 5), equity: 99_500.625 },
      { date: new Date(2024, 0, 6), equity: 104_475.65625 },
    ];
    const metrics = computeBacktestMetrics([], equityCurve, 100_000);
    expect(metrics.sharpeRatio).toBeCloseTo(3.2396, 1);
  });
});
