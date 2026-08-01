import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/server/market-data/provider";
import type { StrategyBar } from "@/server/strategy/evaluator";
import type { StrategyDefinition } from "@/server/strategy/types";
import { runBacktest, type BacktestSettings } from "@/server/backtesting/engine";
import { recordAuditEvent } from "@/server/audit/log";

export interface RunBacktestInput {
  strategyId: string;
  strategyVersionId: string;
  symbols: string[];
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  commissionPerTrade: number;
  slippageBps: number;
  spreadBps: number;
  maxPositions: number;
}

export async function runAndStoreBacktest(userId: string, input: RunBacktestInput) {
  const strategyVersion = await prisma.strategyVersion.findUnique({
    where: { id: input.strategyVersionId },
    include: { strategy: true },
  });
  if (!strategyVersion || strategyVersion.strategy.userId !== userId) {
    throw new Error("Strategy version not found.");
  }
  if (!strategyVersion.isValid) {
    throw new Error("Cannot backtest an invalid strategy version.");
  }

  const backtest = await prisma.backtest.create({
    data: {
      // Derived from the already-ownership-checked strategyVersion, not the
      // client-supplied input.strategyId - otherwise a caller could pass a
      // strategyVersionId they own alongside an unrelated (or another
      // user's) strategyId, creating a Backtest row that misattributes whose
      // strategy it belongs to.
      strategyId: strategyVersion.strategyId,
      strategyVersionId: input.strategyVersionId,
      symbols: input.symbols,
      startDate: input.startDate,
      endDate: input.endDate,
      initialCapital: input.initialCapital,
      commissionPerTrade: input.commissionPerTrade,
      slippageBps: input.slippageBps,
      spreadBps: input.spreadBps,
      maxPositions: input.maxPositions,
      status: "running",
    },
  });

  try {
    const provider = getMarketDataProvider();
    const dataBySymbol: Record<string, StrategyBar[]> = {};

    for (const symbol of input.symbols) {
      const instrument = await prisma.instrument.findUnique({ where: { symbol } });
      if (!instrument) throw new Error(`Unknown symbol ${symbol}.`);
      const candles = await provider.getCandles(
        instrument.id,
        instrument.symbol,
        "D1",
        input.startDate,
        input.endDate,
      );
      dataBySymbol[symbol] = candles.map((c) => ({
        ts: c.ts,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      }));
    }

    const settings: BacktestSettings = {
      initialCapital: input.initialCapital,
      commissionPerTrade: input.commissionPerTrade,
      slippageBps: input.slippageBps,
      spreadBps: input.spreadBps,
      maxPositions: input.maxPositions,
    };

    const definition = strategyVersion.definition as unknown as StrategyDefinition;
    const result = runBacktest(definition, dataBySymbol, settings);

    await prisma.$transaction([
      prisma.backtestTrade.createMany({
        data: result.trades.map((t) => ({
          backtestId: backtest.id,
          symbol: t.symbol,
          side: t.side,
          quantity: t.quantity,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          entryAt: t.entryAt,
          exitAt: t.exitAt,
          pnl: t.pnl,
          commission: t.commission,
          reason: t.reason,
        })),
      }),
      prisma.backtest.update({
        where: { id: backtest.id },
        data: {
          status: "completed",
          completedAt: new Date(),
          resultSummary: { ...result.metrics, equityCurve: result.equityCurve } as never,
        },
      }),
    ]);

    await recordAuditEvent({
      userId,
      category: "strategy",
      action: "backtest_completed",
      targetId: backtest.id,
    });

    return prisma.backtest.findUniqueOrThrow({
      where: { id: backtest.id },
      include: { trades: { orderBy: { entryAt: "asc" } } },
    });
  } catch (err) {
    await prisma.backtest.update({
      where: { id: backtest.id },
      data: { status: "failed", errorMessage: (err as Error).message, completedAt: new Date() },
    });
    throw err;
  }
}
