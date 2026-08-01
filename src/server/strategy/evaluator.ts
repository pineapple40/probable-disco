import { sma, ema, rsi, vwap } from "@/lib/indicators";
import type { Condition, StrategyDefinition } from "@/server/strategy/types";

export interface StrategyBar {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PositionState {
  entryPrice: number;
  entryIndex: number;
}

/**
 * Evaluates a single condition using only bars[0..index] (never future
 * bars), so the same evaluator is safe for both backtesting and the live
 * paper strategy runner without introducing look-ahead bias.
 */
function evaluateCondition(condition: Condition, bars: StrategyBar[], index: number): boolean {
  const bar = bars[index]!;
  const closes = bars.slice(0, index + 1).map((b) => b.close);

  switch (condition.type) {
    case "price_above":
      return bar.close > condition.value;
    case "price_below":
      return bar.close < condition.value;
    case "pct_change_above": {
      // Change relative to this bar's own open (this day's change), not the
      // first bar of the whole data window - otherwise a multi-day backtest
      // or the live runner's rolling window would measure cumulative drift
      // since the window started rather than a per-bar change.
      return ((bar.close - bar.open) / bar.open) * 100 > condition.value;
    }
    case "pct_change_below": {
      return ((bar.close - bar.open) / bar.open) * 100 < condition.value;
    }
    case "sma_cross_above": {
      const values = sma(closes, condition.period);
      return crossesAbove(closes, values);
    }
    case "sma_cross_below": {
      const values = sma(closes, condition.period);
      return crossesBelow(closes, values);
    }
    case "ema_cross_above": {
      const values = ema(closes, condition.period);
      return crossesAbove(closes, values);
    }
    case "ema_cross_below": {
      const values = ema(closes, condition.period);
      return crossesBelow(closes, values);
    }
    case "rsi_above": {
      const values = rsi(closes, condition.period);
      const last = values[values.length - 1];
      return last !== null && last !== undefined && last > condition.value;
    }
    case "rsi_below": {
      const values = rsi(closes, condition.period);
      const last = values[values.length - 1];
      return last !== null && last !== undefined && last < condition.value;
    }
    case "price_above_vwap": {
      const values = vwap(bars.slice(0, index + 1));
      return bar.close > values[values.length - 1]!;
    }
    case "price_below_vwap": {
      const values = vwap(bars.slice(0, index + 1));
      return bar.close < values[values.length - 1]!;
    }
    case "time_after": {
      const minutesFromOpen = (bar.ts.getUTCHours() - 9) * 60 + (bar.ts.getUTCMinutes() - 30);
      return minutesFromOpen >= condition.minutesFromOpen;
    }
    case "time_before": {
      const minutesFromOpen = (bar.ts.getUTCHours() - 9) * 60 + (bar.ts.getUTCMinutes() - 30);
      return minutesFromOpen <= condition.minutesFromOpen;
    }
    default:
      return false;
  }
}

function crossesAbove(closes: number[], reference: Array<number | null>): boolean {
  const i = closes.length - 1;
  if (i < 1) return false;
  const prevRef = reference[i - 1];
  const currRef = reference[i];
  if (prevRef === null || prevRef === undefined || currRef === null || currRef === undefined) return false;
  return closes[i - 1]! <= prevRef && closes[i]! > currRef;
}

function crossesBelow(closes: number[], reference: Array<number | null>): boolean {
  const i = closes.length - 1;
  if (i < 1) return false;
  const prevRef = reference[i - 1];
  const currRef = reference[i];
  if (prevRef === null || prevRef === undefined || currRef === null || currRef === undefined) return false;
  return closes[i - 1]! >= prevRef && closes[i]! < currRef;
}

export function evaluateEntry(definition: StrategyDefinition, bars: StrategyBar[], index: number): boolean {
  if (index < 1) return false;
  return definition.entryRules.every((c) => evaluateCondition(c, bars, index));
}

export interface ExitEvaluation {
  shouldExit: boolean;
  reason?: "stop_loss" | "take_profit" | "signal_exit";
}

/** Stop-loss/take-profit are checked against the bar's intrabar high/low; rule-based exits use the close. */
export function evaluateExit(
  definition: StrategyDefinition,
  bars: StrategyBar[],
  index: number,
  position: PositionState,
): ExitEvaluation {
  const bar = bars[index]!;

  if (definition.stopLossPct !== undefined) {
    const stopPrice = position.entryPrice * (1 - definition.stopLossPct / 100);
    if (bar.low <= stopPrice) return { shouldExit: true, reason: "stop_loss" };
  }
  if (definition.takeProfitPct !== undefined) {
    const targetPrice = position.entryPrice * (1 + definition.takeProfitPct / 100);
    if (bar.high >= targetPrice) return { shouldExit: true, reason: "take_profit" };
  }
  if (definition.exitRules.length > 0 && definition.exitRules.some((c) => evaluateCondition(c, bars, index))) {
    return { shouldExit: true, reason: "signal_exit" };
  }
  return { shouldExit: false };
}
