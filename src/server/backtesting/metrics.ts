export interface CompletedTrade {
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  entryAt: Date;
  exitAt: Date;
  pnl: number;
  commission: number;
  reason: string;
}

export interface EquityPoint {
  date: Date;
  equity: number;
}

export interface BacktestMetrics {
  netPnl: number;
  netReturnPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  winRatePct: number;
  lossRatePct: number;
  profitFactor: number | null;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgHoldingTimeMinutes: number;
  numberOfTrades: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
}

const TRADING_DAYS_PER_YEAR = 252;

export function computeBacktestMetrics(
  trades: CompletedTrade[],
  equityCurve: EquityPoint[],
  initialCapital: number,
): BacktestMetrics {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const netPnl = trades.reduce((sum, t) => sum + t.pnl - t.commission, 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = losses.reduce((sum, t) => sum + t.pnl, 0);

  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.max(maxDrawdown, peak - point.equity);
  }

  const holdingTimes = trades.map((t) => (t.exitAt.getTime() - t.entryAt.getTime()) / 60_000);

  const dailyReturns = computeDailyReturns(equityCurve);
  const sharpeRatio = dailyReturns.length >= 5 ? annualizedRatio(dailyReturns, false) : null;
  const sortinoRatio = dailyReturns.length >= 5 ? annualizedRatio(dailyReturns, true) : null;

  return {
    netPnl,
    netReturnPct: initialCapital > 0 ? (netPnl / initialCapital) * 100 : 0,
    maxDrawdown,
    maxDrawdownPct: peak > 0 ? (maxDrawdown / peak) * 100 : 0,
    winRatePct: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
    lossRatePct: trades.length > 0 ? (losses.length / trades.length) * 100 : 0,
    profitFactor: grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : null,
    expectancy: trades.length > 0 ? netPnl / trades.length : 0,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0,
    avgHoldingTimeMinutes:
      holdingTimes.length > 0 ? holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length : 0,
    numberOfTrades: trades.length,
    sharpeRatio,
    sortinoRatio,
  };
}

function computeDailyReturns(equityCurve: EquityPoint[]): number[] {
  const byDay = new Map<string, number>();
  for (const point of equityCurve) {
    const key = point.date.toISOString().slice(0, 10);
    byDay.set(key, point.equity);
  }
  const values = Array.from(byDay.values());
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    if (prev !== 0) returns.push((values[i]! - prev) / prev);
  }
  return returns;
}

function annualizedRatio(returns: number[], downsideOnly: boolean): number | null {
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const deviationSource = downsideOnly ? returns.filter((r) => r < 0) : returns;
  if (deviationSource.length === 0) return null;
  const variance =
    deviationSource.reduce((sum, r) => sum + r * r, 0) / deviationSource.length; // relative to 0, standard for Sortino downside deviation
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;
  return (mean / stdDev) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}
