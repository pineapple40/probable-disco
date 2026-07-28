import { evaluateEntry, evaluateExit, type StrategyBar } from "@/server/strategy/evaluator";
import type { StrategyDefinition } from "@/server/strategy/types";
import { computeBacktestMetrics, type CompletedTrade, type EquityPoint } from "@/server/backtesting/metrics";

export interface BacktestSettings {
  initialCapital: number;
  commissionPerTrade: number;
  slippageBps: number;
  spreadBps: number;
  maxPositions: number;
}

export interface BacktestRunResult {
  trades: CompletedTrade[];
  equityCurve: EquityPoint[];
  metrics: ReturnType<typeof computeBacktestMetrics>;
}

interface OpenPosition {
  symbol: string;
  quantity: number;
  entryPrice: number;
  entryIndex: number;
  entryAt: Date;
}

interface PendingSignal {
  symbol: string;
  action: "enter" | "exit";
}

function buyFillPrice(open: number, settings: BacktestSettings): number {
  return open * (1 + settings.slippageBps / 10_000) * (1 + settings.spreadBps / 20_000);
}
function sellFillPrice(open: number, settings: BacktestSettings): number {
  return open * (1 - settings.slippageBps / 10_000) * (1 - settings.spreadBps / 20_000);
}

/**
 * Event-driven backtester. Entries and rule-based exits decided from bar i
 * are always executed at bar i+1's open (never the same bar's close) to
 * avoid look-ahead / impossible same-bar fills. Stop-loss and take-profit
 * are checked intrabar against bar i's already-completed high/low and fill
 * at the stop/target level within that bar, matching how a resting stop
 * order would have behaved in real time. Assumes all symbols share the
 * same trading-day calendar (true for this app's simulated data) and uses
 * the shortest common length across symbols.
 */
export function runBacktest(
  definition: StrategyDefinition,
  dataBySymbol: Record<string, StrategyBar[]>,
  settings: BacktestSettings,
): BacktestRunResult {
  const symbols = Object.keys(dataBySymbol);
  const n = Math.min(...symbols.map((s) => dataBySymbol[s]!.length));

  let cash = settings.initialCapital;
  const openPositions = new Map<string, OpenPosition>();
  const trades: CompletedTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  const tradesToday = new Map<string, number>(); // dateKey -> count
  let pendingSignals: PendingSignal[] = [];

  for (let i = 0; i < n; i++) {
    // 1. Execute signals queued from the previous bar at this bar's open.
    for (const signal of pendingSignals) {
      const bars = dataBySymbol[signal.symbol]!;
      const bar = bars[i]!;
      if (
        signal.action === "enter" &&
        !openPositions.has(signal.symbol) &&
        openPositions.size < settings.maxPositions
      ) {
        const fillPrice = buyFillPrice(bar.open, settings);
        const quantity = sizePosition(definition, cash, fillPrice);
        const cost = quantity * fillPrice + settings.commissionPerTrade;
        if (quantity > 0 && cost <= cash) {
          cash -= cost;
          openPositions.set(signal.symbol, {
            symbol: signal.symbol,
            quantity,
            entryPrice: fillPrice,
            entryIndex: i,
            entryAt: bar.ts,
          });
          const dateKey = bar.ts.toISOString().slice(0, 10);
          tradesToday.set(dateKey, (tradesToday.get(dateKey) ?? 0) + 1);
        }
      } else if (signal.action === "exit") {
        const position = openPositions.get(signal.symbol);
        if (position) {
          closePosition(position, bar.ts, sellFillPrice(bar.open, settings), "signal_exit", settings, trades);
          cash += position.quantity * sellFillPrice(bar.open, settings) - settings.commissionPerTrade;
          openPositions.delete(signal.symbol);
        }
      }
    }
    pendingSignals = [];

    // 2. Intrabar stop-loss / take-profit checks, then queue rule-based exits for next bar.
    for (const symbol of symbols) {
      const position = openPositions.get(symbol);
      if (!position) continue;
      const bars = dataBySymbol[symbol]!;
      const exitEval = evaluateExit(definition, bars, i, position);
      if (!exitEval.shouldExit) continue;

      if (exitEval.reason === "stop_loss" || exitEval.reason === "take_profit") {
        const bar = bars[i]!;
        const rawPrice =
          exitEval.reason === "stop_loss"
            ? position.entryPrice * (1 - (definition.stopLossPct ?? 0) / 100)
            : position.entryPrice * (1 + (definition.takeProfitPct ?? 0) / 100);
        const clamped = Math.min(Math.max(rawPrice, bar.low), bar.high);
        cash += position.quantity * clamped - settings.commissionPerTrade;
        closePosition(position, bar.ts, clamped, exitEval.reason, settings, trades);
        openPositions.delete(symbol);
      } else {
        pendingSignals.push({ symbol, action: "exit" });
      }
    }

    // 3. Queue entries for flat symbols under position/day-trade caps. Track a
    // projected open-position count so multiple symbols signaling in the same
    // tick can't collectively queue more entries than maxPositions allows.
    const dateKey = dataBySymbol[symbols[0]!]![i]!.ts.toISOString().slice(0, 10);
    const todayCount = tradesToday.get(dateKey) ?? 0;
    const pendingEntryCount = pendingSignals.filter((s) => s.action === "enter").length;
    let projectedOpenCount = openPositions.size + pendingEntryCount;
    for (const symbol of symbols) {
      if (openPositions.has(symbol)) continue;
      if (projectedOpenCount >= settings.maxPositions) continue;
      if (todayCount >= definition.maxTradesPerDay) continue;
      const bars = dataBySymbol[symbol]!;
      if (evaluateEntry(definition, bars, i)) {
        pendingSignals.push({ symbol, action: "enter" });
        projectedOpenCount++;
      }
    }

    // 4. Mark-to-market equity for this bar.
    const marketValue = Array.from(openPositions.values()).reduce((sum, p) => {
      const bars = dataBySymbol[p.symbol]!;
      return sum + p.quantity * bars[i]!.close;
    }, 0);
    equityCurve.push({ date: dataBySymbol[symbols[0]!]![i]!.ts, equity: cash + marketValue });
  }

  // Force-close any remaining open positions at the final bar's close.
  const lastIndex = n - 1;
  for (const position of openPositions.values()) {
    const bars = dataBySymbol[position.symbol]!;
    const lastBar = bars[lastIndex]!;
    cash += position.quantity * lastBar.close - settings.commissionPerTrade;
    closePosition(position, lastBar.ts, lastBar.close, "end_of_backtest", settings, trades);
  }

  const metrics = computeBacktestMetrics(trades, equityCurve, settings.initialCapital);
  return { trades, equityCurve, metrics };
}

function sizePosition(definition: StrategyDefinition, cash: number, price: number): number {
  const sizing = definition.positionSizing;
  if (sizing.method === "fixed_quantity") return Math.min(sizing.value, Math.floor(cash / price));
  return Math.floor(Math.min(sizing.value, cash) / price);
}

function closePosition(
  position: OpenPosition,
  exitAt: Date,
  exitPrice: number,
  reason: CompletedTrade["reason"],
  settings: BacktestSettings,
  trades: CompletedTrade[],
) {
  const pnl = (exitPrice - position.entryPrice) * position.quantity;
  trades.push({
    symbol: position.symbol,
    side: "BUY",
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    exitPrice,
    entryAt: position.entryAt,
    exitAt,
    pnl,
    commission: settings.commissionPerTrade * 2,
    reason,
  });
}
