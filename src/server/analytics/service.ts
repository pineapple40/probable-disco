import "server-only";
import { prisma } from "@/lib/db";

export interface TradeRecord {
  symbol: string;
  side: string;
  quantity: number;
  avgEntryPrice: number;
  realizedPnl: number;
  openedAt: Date;
  closedAt: Date;
}

export interface PerformanceSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  profitFactor: number | null;
  largestWin: number;
  largestLoss: number;
  maxDrawdown: number;
  longestWinStreak: number;
  longestLossStreak: number;
}

export interface PerformanceReport {
  summary: PerformanceSummary;
  bySymbol: Array<{ symbol: string; trades: number; netPnl: number; winRatePct: number }>;
  byDayOfWeek: Array<{ day: string; trades: number; netPnl: number }>;
  equityCurve: Array<{ date: string; cumulativePnl: number }>;
  trades: TradeRecord[];
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function getPerformanceReport(
  userId: string,
  range: { from?: Date; to?: Date },
): Promise<PerformanceReport> {
  const account = await prisma.account.findFirst({ where: { userId } });
  if (!account) {
    return {
      summary: emptySummary(),
      bySymbol: [],
      byDayOfWeek: [],
      equityCurve: [],
      trades: [],
    };
  }

  const closedPositions = await prisma.position.findMany({
    where: {
      accountId: account.id,
      closedAt: {
        not: null,
        ...(range.from ? { gte: range.from } : {}),
        ...(range.to ? { lte: range.to } : {}),
      },
    },
    include: { instrument: true },
    orderBy: { closedAt: "asc" },
  });

  const trades: TradeRecord[] = closedPositions.map((p) => ({
    symbol: p.instrument.symbol,
    side: p.side,
    quantity: Number(p.quantity),
    avgEntryPrice: Number(p.avgEntryPrice),
    realizedPnl: Number(p.realizedPnl),
    openedAt: p.openedAt,
    closedAt: p.closedAt!,
  }));

  const summary = computeSummary(trades);
  const bySymbol = computeBySymbol(trades);
  const byDayOfWeek = computeByDayOfWeek(trades);
  const equityCurve = computeEquityCurve(trades);

  return { summary, bySymbol, byDayOfWeek, equityCurve, trades };
}

function emptySummary(): PerformanceSummary {
  return {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRatePct: 0,
    netPnl: 0,
    grossProfit: 0,
    grossLoss: 0,
    avgWin: 0,
    avgLoss: 0,
    expectancy: 0,
    profitFactor: null,
    largestWin: 0,
    largestLoss: 0,
    maxDrawdown: 0,
    longestWinStreak: 0,
    longestLossStreak: 0,
  };
}

function computeSummary(trades: TradeRecord[]): PerformanceSummary {
  if (trades.length === 0) return emptySummary();

  const wins = trades.filter((t) => t.realizedPnl > 0);
  const losses = trades.filter((t) => t.realizedPnl < 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.realizedPnl, 0);
  const grossLoss = losses.reduce((sum, t) => sum + t.realizedPnl, 0);
  const netPnl = trades.reduce((sum, t) => sum + t.realizedPnl, 0);

  let peak = 0;
  let cum = 0;
  let maxDrawdown = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;

  for (const t of trades) {
    cum += t.realizedPnl;
    peak = Math.max(peak, cum);
    maxDrawdown = Math.max(maxDrawdown, peak - cum);

    if (t.realizedPnl > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
    } else if (t.realizedPnl < 0) {
      currentLossStreak++;
      currentWinStreak = 0;
    }
    longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRatePct: (wins.length / trades.length) * 100,
    netPnl,
    grossProfit,
    grossLoss,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    expectancy: netPnl / trades.length,
    profitFactor: grossLoss !== 0 ? Math.abs(grossProfit / grossLoss) : null,
    largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.realizedPnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.realizedPnl)) : 0,
    maxDrawdown,
    longestWinStreak,
    longestLossStreak,
  };
}

function computeBySymbol(trades: TradeRecord[]) {
  const map = new Map<string, TradeRecord[]>();
  for (const t of trades) {
    const arr = map.get(t.symbol) ?? [];
    arr.push(t);
    map.set(t.symbol, arr);
  }
  return Array.from(map.entries())
    .map(([symbol, list]) => ({
      symbol,
      trades: list.length,
      netPnl: list.reduce((sum, t) => sum + t.realizedPnl, 0),
      winRatePct: (list.filter((t) => t.realizedPnl > 0).length / list.length) * 100,
    }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

function computeByDayOfWeek(trades: TradeRecord[]) {
  const map = new Map<number, TradeRecord[]>();
  for (const t of trades) {
    const day = t.closedAt.getUTCDay();
    const arr = map.get(day) ?? [];
    arr.push(t);
    map.set(day, arr);
  }
  return Array.from(map.entries())
    .map(([day, list]) => ({
      day: DAY_NAMES[day]!,
      trades: list.length,
      netPnl: list.reduce((sum, t) => sum + t.realizedPnl, 0),
    }))
    .sort((a, b) => DAY_NAMES.indexOf(a.day) - DAY_NAMES.indexOf(b.day));
}

function computeEquityCurve(trades: TradeRecord[]) {
  let cum = 0;
  return trades.map((t) => {
    cum += t.realizedPnl;
    return { date: t.closedAt.toISOString(), cumulativePnl: cum };
  });
}

export function tradesToCsv(trades: TradeRecord[]): string {
  const header = "symbol,side,quantity,avgEntryPrice,realizedPnl,openedAt,closedAt";
  const rows = trades.map((t) =>
    [
      t.symbol,
      t.side,
      t.quantity,
      t.avgEntryPrice.toFixed(4),
      t.realizedPnl.toFixed(4),
      t.openedAt.toISOString(),
      t.closedAt.toISOString(),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}
