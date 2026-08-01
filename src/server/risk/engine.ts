import type { OrderRiskInput, RiskCheckContext, RiskDecision } from "@/server/risk/types";

function reject(
  ruleKey: string,
  message: string,
  estimatedEntryPrice: number,
  estimatedNotional: number,
): RiskDecision {
  return { allowed: false, ruleKey, message, warnings: [], estimatedEntryPrice, estimatedNotional };
}

function estimateEntryPrice(order: OrderRiskInput, quote: RiskCheckContext["quote"]): number {
  if (order.type === "LIMIT" && order.limitPrice) return order.limitPrice;
  if (order.type === "STOP_LIMIT" && order.limitPrice) return order.limitPrice;
  if (order.type === "STOP" && order.stopPrice) return order.stopPrice;
  return order.side === "BUY" ? quote.ask : quote.bid;
}

/**
 * Pure, DB-free risk evaluation so it can be unit tested directly. Callers
 * are responsible for gathering RiskCheckContext from the database and for
 * persisting the resulting decision as a RiskEvent audit record.
 */
export function evaluateOrderRisk(order: OrderRiskInput, ctx: RiskCheckContext): RiskDecision {
  const estimatedEntryPrice = estimateEntryPrice(order, ctx.quote);
  const estimatedNotional = estimatedEntryPrice * order.quantity;
  const warnings: string[] = [];

  if (ctx.emergencyLocked) {
    return reject(
      "emergency_lock",
      "Trading is locked for this account (emergency stop or admin action).",
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  // Extended-hours trading isn't actually implemented anywhere in the
  // broker (no separate extended-hours matching/quote logic exists), so the
  // flag must never be used to bypass the market-closed check below -
  // otherwise a caller could get an order through purely by setting it,
  // directly contradicting the market-closed rejection message.
  if (order.isExtendedHours) {
    return reject(
      "extended_hours_unsupported",
      "Extended-hours trading is not supported in this release.",
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  if (ctx.restrictedHoursOnly && !ctx.quote.isMarketOpen) {
    return reject(
      "market_closed",
      "The simulated market is currently closed. Extended-hours trading is not supported in this release.",
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  if (ctx.quote.isStale) {
    return reject(
      "stale_quote",
      "The quote for this symbol is stale. Orders are blocked until fresh data is available.",
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  const mid = (ctx.quote.bid + ctx.quote.ask) / 2;
  const spreadPct = mid > 0 ? ((ctx.quote.ask - ctx.quote.bid) / mid) * 100 : 0;
  if (spreadPct > ctx.maxSpreadPct) {
    return reject(
      "max_spread",
      `Bid/ask spread (${spreadPct.toFixed(2)}%) exceeds the configured maximum (${ctx.maxSpreadPct}%).`,
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  if (ctx.todaysRealizedPlusUnrealizedPnl <= -ctx.maxDailyLossUsd) {
    return reject(
      "max_daily_loss",
      `Daily loss limit of $${ctx.maxDailyLossUsd.toFixed(2)} has been reached. Trading is locked for the rest of the day.`,
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  if (ctx.weekRealizedPlusUnrealizedPnl <= -ctx.maxWeeklyLossUsd) {
    return reject(
      "max_weekly_loss",
      `Weekly loss limit of $${ctx.maxWeeklyLossUsd.toFixed(2)} has been reached.`,
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  if (ctx.consecutiveLosingTrades >= ctx.maxConsecutiveLosses) {
    return reject(
      "max_consecutive_losses",
      `${ctx.consecutiveLosingTrades} consecutive losing trades reached the configured limit. Trading is paused.`,
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  if (order.side === "BUY" && ctx.recentStopCooldownActiveForSymbol) {
    return reject(
      "cooldown_active",
      "A cooldown period is active for this symbol after a recent stop-out.",
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  if (order.side === "SELL" && order.quantity > ctx.existingPositionQuantity) {
    return reject(
      "no_short_selling",
      "Sell quantity exceeds your held position. Short selling is not supported in this release.",
      estimatedEntryPrice,
      estimatedNotional,
    );
  }

  if (order.side === "BUY") {
    if (ctx.isNewSymbolForAccount && ctx.currentOpenPositionsCount >= ctx.maxOpenPositions) {
      return reject(
        "max_open_positions",
        `Maximum open positions (${ctx.maxOpenPositions}) reached.`,
        estimatedEntryPrice,
        estimatedNotional,
      );
    }

    if (estimatedNotional > ctx.maxOrderNotionalUsd) {
      return reject(
        "max_order_notional",
        `Order notional ($${estimatedNotional.toFixed(2)}) exceeds the maximum per-order notional ($${ctx.maxOrderNotionalUsd.toFixed(2)}).`,
        estimatedEntryPrice,
        estimatedNotional,
      );
    }

    const resultingSymbolExposure = ctx.existingSymbolExposureNotional + estimatedNotional;
    if (resultingSymbolExposure > ctx.maxExposurePerSymbolUsd) {
      return reject(
        "max_symbol_exposure",
        `Resulting exposure to this symbol ($${resultingSymbolExposure.toFixed(2)}) would exceed the maximum ($${ctx.maxExposurePerSymbolUsd.toFixed(2)}).`,
        estimatedEntryPrice,
        estimatedNotional,
      );
    }

    if (resultingSymbolExposure > ctx.maxPositionSizeUsd) {
      return reject(
        "max_position_size",
        `Resulting position size ($${resultingSymbolExposure.toFixed(2)}) would exceed the maximum position size ($${ctx.maxPositionSizeUsd.toFixed(2)}).`,
        estimatedEntryPrice,
        estimatedNotional,
      );
    }

    const resultingGrossExposure = ctx.grossExposureExcludingSymbolNotional + resultingSymbolExposure;
    if (resultingGrossExposure > ctx.maxGrossExposureUsd) {
      return reject(
        "max_gross_exposure",
        `Resulting gross exposure ($${resultingGrossExposure.toFixed(2)}) would exceed the maximum ($${ctx.maxGrossExposureUsd.toFixed(2)}).`,
        estimatedEntryPrice,
        estimatedNotional,
      );
    }

    if (estimatedNotional > ctx.buyingPower) {
      return reject(
        "insufficient_buying_power",
        `Order notional ($${estimatedNotional.toFixed(2)}) exceeds available buying power ($${ctx.buyingPower.toFixed(2)}).`,
        estimatedEntryPrice,
        estimatedNotional,
      );
    }

    if (ctx.requireStopLoss && !order.stopLossPrice) {
      return reject(
        "stop_loss_required",
        "A stop-loss price is required for new entries under your current risk profile.",
        estimatedEntryPrice,
        estimatedNotional,
      );
    }

    if (order.stopLossPrice) {
      const riskPerShare = Math.abs(estimatedEntryPrice - order.stopLossPrice);
      const totalRisk = riskPerShare * order.quantity;
      const totalRiskPct = ctx.accountEquity > 0 ? (totalRisk / ctx.accountEquity) * 100 : 0;

      if (totalRisk > ctx.maxRiskPerTradeUsd) {
        return reject(
          "max_risk_per_trade_usd",
          `Estimated risk ($${totalRisk.toFixed(2)}) exceeds the maximum risk per trade ($${ctx.maxRiskPerTradeUsd.toFixed(2)}).`,
          estimatedEntryPrice,
          estimatedNotional,
        );
      }
      if (totalRiskPct > ctx.maxRiskPerTradePct) {
        return reject(
          "max_risk_per_trade_pct",
          `Estimated risk (${totalRiskPct.toFixed(2)}% of equity) exceeds the maximum (${ctx.maxRiskPerTradePct}%).`,
          estimatedEntryPrice,
          estimatedNotional,
        );
      }

      if (order.takeProfitPrice) {
        const reward = Math.abs(order.takeProfitPrice - estimatedEntryPrice);
        const rewardToRisk = riskPerShare > 0 ? reward / riskPerShare : 0;
        if (rewardToRisk < ctx.minRewardToRiskRatio) {
          return reject(
            "min_reward_to_risk",
            `Reward-to-risk ratio (${rewardToRisk.toFixed(2)}) is below the required minimum (${ctx.minRewardToRiskRatio}).`,
            estimatedEntryPrice,
            estimatedNotional,
          );
        }
      } else {
        warnings.push("No take-profit price set; reward-to-risk ratio was not evaluated.");
      }
    }
  }

  if (ctx.todaysRealizedPlusUnrealizedPnl <= -ctx.maxDailyLossUsd * 0.75) {
    warnings.push("Approaching the daily loss limit.");
  }

  return {
    allowed: true,
    ruleKey: "approved",
    message: "Order passed all risk checks.",
    warnings,
    estimatedEntryPrice,
    estimatedNotional,
  };
}
