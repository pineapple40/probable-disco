import { describe, expect, it } from "vitest";
import { evaluateOrderRisk } from "@/server/risk/engine";
import type { OrderRiskInput, RiskCheckContext } from "@/server/risk/types";

function baseContext(overrides: Partial<RiskCheckContext> = {}): RiskCheckContext {
  return {
    emergencyLocked: false,
    requireStopLoss: true,
    minRewardToRiskRatio: 1.5,
    maxRiskPerTradeUsd: 500,
    maxRiskPerTradePct: 2,
    maxDailyLossUsd: 1000,
    maxWeeklyLossUsd: 3000,
    maxOpenPositions: 5,
    maxExposurePerSymbolUsd: 10000,
    maxGrossExposureUsd: 50000,
    maxPositionSizeUsd: 10000,
    maxOrderNotionalUsd: 10000,
    maxConsecutiveLosses: 3,
    maxSpreadPct: 1,
    maxStaleQuoteSeconds: 30,
    cooldownAfterStopMinutes: 15,
    restrictedHoursOnly: true,
    accountEquity: 100000,
    buyingPower: 200000,
    isNewSymbolForAccount: true,
    currentOpenPositionsCount: 0,
    existingPositionQuantity: 0,
    grossExposureExcludingSymbolNotional: 0,
    existingSymbolExposureNotional: 0,
    todaysRealizedPlusUnrealizedPnl: 0,
    weekRealizedPlusUnrealizedPnl: 0,
    consecutiveLosingTrades: 0,
    recentStopCooldownActiveForSymbol: false,
    quote: { bid: 99.9, ask: 100.1, last: 100, isMarketOpen: true, isStale: false },
    ...overrides,
  };
}

function baseOrder(overrides: Partial<OrderRiskInput> = {}): OrderRiskInput {
  return {
    side: "BUY",
    type: "MARKET",
    quantity: 10,
    stopLossPrice: 95,
    takeProfitPrice: 108,
    isExtendedHours: false,
    ...overrides,
  };
}

describe("evaluateOrderRisk", () => {
  it("approves a well-formed order within all limits", () => {
    const decision = evaluateOrderRisk(baseOrder(), baseContext());
    expect(decision.allowed).toBe(true);
    expect(decision.ruleKey).toBe("approved");
  });

  it("rejects everything when the emergency lock is active", () => {
    const decision = evaluateOrderRisk(baseOrder(), baseContext({ emergencyLocked: true }));
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("emergency_lock");
  });

  it("rejects orders while the market is closed and extended hours are not requested", () => {
    const decision = evaluateOrderRisk(
      baseOrder(),
      baseContext({ quote: { bid: 99.9, ask: 100.1, last: 100, isMarketOpen: false, isStale: false } }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("market_closed");
  });

  it("rejects extended-hours orders even while the market is open, since it isn't actually implemented", () => {
    const decision = evaluateOrderRisk(baseOrder({ isExtendedHours: true }), baseContext());
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("extended_hours_unsupported");
  });

  it("does not let isExtendedHours bypass the market-closed rejection", () => {
    const decision = evaluateOrderRisk(
      baseOrder({ isExtendedHours: true }),
      baseContext({ quote: { bid: 99.9, ask: 100.1, last: 100, isMarketOpen: false, isStale: false } }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("extended_hours_unsupported");
  });

  it("rejects a stale quote", () => {
    const decision = evaluateOrderRisk(
      baseOrder(),
      baseContext({ quote: { bid: 99.9, ask: 100.1, last: 100, isMarketOpen: true, isStale: true } }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("stale_quote");
  });

  it("rejects when the bid/ask spread exceeds the configured maximum", () => {
    const decision = evaluateOrderRisk(
      baseOrder(),
      baseContext({ quote: { bid: 90, ask: 110, last: 100, isMarketOpen: true, isStale: false } }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_spread");
  });

  it("locks out trading once the daily loss limit is reached", () => {
    const decision = evaluateOrderRisk(baseOrder(), baseContext({ todaysRealizedPlusUnrealizedPnl: -1000 }));
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_daily_loss");
  });

  it("locks out trading once the weekly loss limit is reached", () => {
    const decision = evaluateOrderRisk(baseOrder(), baseContext({ weekRealizedPlusUnrealizedPnl: -3500 }));
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_weekly_loss");
  });

  it("pauses trading after the max consecutive losses", () => {
    const decision = evaluateOrderRisk(baseOrder(), baseContext({ consecutiveLosingTrades: 3 }));
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_consecutive_losses");
  });

  it("blocks re-entry during the post-stop cooldown", () => {
    const decision = evaluateOrderRisk(baseOrder(), baseContext({ recentStopCooldownActiveForSymbol: true }));
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("cooldown_active");
  });

  it("rejects sells that exceed the held position (no short selling)", () => {
    const decision = evaluateOrderRisk(
      baseOrder({ side: "SELL", quantity: 50 }),
      baseContext({ existingPositionQuantity: 10 }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("no_short_selling");
  });

  it("allows a sell that fully closes an existing position", () => {
    const decision = evaluateOrderRisk(
      baseOrder({ side: "SELL", quantity: 10, stopLossPrice: undefined, takeProfitPrice: undefined }),
      baseContext({ existingPositionQuantity: 10, isNewSymbolForAccount: false }),
    );
    expect(decision.allowed).toBe(true);
  });

  it("rejects a new entry once the max open positions cap is reached", () => {
    const decision = evaluateOrderRisk(
      baseOrder(),
      baseContext({ isNewSymbolForAccount: true, currentOpenPositionsCount: 5, maxOpenPositions: 5 }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_open_positions");
  });

  it("rejects an order notional above the configured maximum", () => {
    const decision = evaluateOrderRisk(
      baseOrder({ quantity: 1000 }), // 1000 * ~100 = 100,000 notional
      baseContext({ maxOrderNotionalUsd: 5000 }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_order_notional");
  });

  it("rejects when resulting symbol exposure would exceed the maximum", () => {
    const decision = evaluateOrderRisk(
      baseOrder({ quantity: 10 }),
      baseContext({ existingSymbolExposureNotional: 9500, maxExposurePerSymbolUsd: 10000 }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_symbol_exposure");
  });

  it("rejects when resulting gross exposure would exceed the maximum", () => {
    const decision = evaluateOrderRisk(
      baseOrder({ quantity: 10 }),
      baseContext({ grossExposureExcludingSymbolNotional: 49500, maxGrossExposureUsd: 50000 }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_gross_exposure");
  });

  it("rejects an order that exceeds available buying power", () => {
    const decision = evaluateOrderRisk(baseOrder({ quantity: 10 }), baseContext({ buyingPower: 500 }));
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("insufficient_buying_power");
  });

  it("requires a stop-loss for new entries when the risk profile mandates it", () => {
    const decision = evaluateOrderRisk(
      baseOrder({ stopLossPrice: undefined }),
      baseContext({ requireStopLoss: true }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("stop_loss_required");
  });

  it("rejects when the dollar risk per trade exceeds the maximum", () => {
    // entry ~100, stop 50 => risk/share 50 * 60 shares = 3000, above the $500 max,
    // while notional (~6000) and exposure stay under their own limits.
    const decision = evaluateOrderRisk(
      baseOrder({ quantity: 60, stopLossPrice: 50, takeProfitPrice: undefined }),
      baseContext(),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_risk_per_trade_usd");
  });

  it("rejects when the reward-to-risk ratio is below the configured minimum", () => {
    // risk = 100-95=5/share, reward = 96-100 -> only 1:0.2, below 1.5 minimum
    const decision = evaluateOrderRisk(
      baseOrder({ stopLossPrice: 95, takeProfitPrice: 101 }),
      baseContext({ minRewardToRiskRatio: 1.5 }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("min_reward_to_risk");
  });

  it("warns but still approves when no take-profit is set", () => {
    const decision = evaluateOrderRisk(baseOrder({ takeProfitPrice: undefined }), baseContext());
    expect(decision.allowed).toBe(true);
    expect(decision.warnings.some((w) => w.includes("take-profit"))).toBe(true);
  });
});
