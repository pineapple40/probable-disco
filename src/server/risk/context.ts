import "server-only";
import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/server/market-data/provider";
import type { RiskCheckContext } from "@/server/risk/types";

function startOfDayUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function startOfWeekUtc(d: Date) {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  return startOfDayUtc(new Date(d.getTime() - diff * 24 * 60 * 60 * 1000));
}

export async function buildRiskCheckContext(
  accountId: string,
  instrumentId: string,
  symbol: string,
): Promise<RiskCheckContext> {
  const [account, riskProfile, emergencyLock, position, otherPositions, quote] = await Promise.all([
    prisma.account.findUniqueOrThrow({ where: { id: accountId } }),
    prisma.riskProfile.findUniqueOrThrow({ where: { accountId } }),
    prisma.emergencyTradingLock.findUnique({ where: { accountId } }),
    prisma.position.findUnique({ where: { accountId_instrumentId: { accountId, instrumentId } } }),
    prisma.position.findMany({
      where: { accountId, quantity: { gt: 0 }, NOT: { instrumentId } },
      include: { instrument: true },
    }),
    getMarketDataProvider().getQuote(instrumentId, symbol),
  ]);

  const now = new Date();
  const dayStart = startOfDayUtc(now);
  const weekStart = startOfWeekUtc(now);

  const [openPositionsCount, closedToday, closedThisWeek, recentClosedForSymbol] = await Promise.all([
    prisma.position.count({ where: { accountId, quantity: { gt: 0 } } }),
    prisma.position.aggregate({
      where: { accountId, closedAt: { gte: dayStart } },
      _sum: { realizedPnl: true },
    }),
    prisma.position.aggregate({
      where: { accountId, closedAt: { gte: weekStart } },
      _sum: { realizedPnl: true },
    }),
    prisma.position.findFirst({
      where: { accountId, instrumentId, closedAt: { not: null } },
      orderBy: { closedAt: "desc" },
    }),
  ]);

  const recentClosedPositions = await prisma.position.findMany({
    where: { accountId, closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    take: 20,
  });
  let consecutiveLosingTrades = 0;
  for (const p of recentClosedPositions) {
    if (Number(p.realizedPnl) < 0) consecutiveLosingTrades++;
    else break;
  }

  const riskProfileDb = riskProfile;
  const cooldownMs = riskProfileDb.cooldownAfterStopMinutes * 60 * 1000;
  const recentStopCooldownActiveForSymbol = Boolean(
    recentClosedForSymbol &&
      Number(recentClosedForSymbol.realizedPnl) < 0 &&
      recentClosedForSymbol.closedAt &&
      now.getTime() - recentClosedForSymbol.closedAt.getTime() < cooldownMs,
  );

  const grossExposureExcludingSymbolNotional = await computeGrossExposure(otherPositions);

  return {
    emergencyLocked: emergencyLock?.isLocked ?? false,
    requireStopLoss: riskProfileDb.requireStopLoss,
    minRewardToRiskRatio: Number(riskProfileDb.minRewardToRiskRatio),
    maxRiskPerTradeUsd: Number(riskProfileDb.maxRiskPerTradeUsd),
    maxRiskPerTradePct: Number(riskProfileDb.maxRiskPerTradePct),
    maxDailyLossUsd: Number(riskProfileDb.maxDailyLossUsd),
    maxWeeklyLossUsd: Number(riskProfileDb.maxWeeklyLossUsd),
    maxOpenPositions: riskProfileDb.maxOpenPositions,
    maxExposurePerSymbolUsd: Number(riskProfileDb.maxExposurePerSymbolUsd),
    maxGrossExposureUsd: Number(riskProfileDb.maxGrossExposureUsd),
    maxPositionSizeUsd: Number(riskProfileDb.maxPositionSizeUsd),
    maxOrderNotionalUsd: Number(riskProfileDb.maxOrderNotionalUsd),
    maxConsecutiveLosses: riskProfileDb.maxConsecutiveLosses,
    maxSpreadPct: Number(riskProfileDb.maxSpreadPct),
    maxStaleQuoteSeconds: riskProfileDb.maxStaleQuoteSeconds,
    cooldownAfterStopMinutes: riskProfileDb.cooldownAfterStopMinutes,
    restrictedHoursOnly: riskProfileDb.restrictedHoursOnly,

    accountEquity: Number(account.equity),
    buyingPower: Number(account.buyingPower),
    isNewSymbolForAccount: !position || Number(position.quantity) === 0,
    currentOpenPositionsCount: openPositionsCount,
    existingPositionQuantity: position ? Number(position.quantity) : 0,
    existingSymbolExposureNotional: position ? Number(position.quantity) * quote.last : 0,
    grossExposureExcludingSymbolNotional,
    todaysRealizedPlusUnrealizedPnl: Number(closedToday._sum.realizedPnl ?? 0),
    weekRealizedPlusUnrealizedPnl: Number(closedThisWeek._sum.realizedPnl ?? 0),
    consecutiveLosingTrades,
    recentStopCooldownActiveForSymbol,

    // The simulated provider always computes a fresh quote on demand, so
    // there is no independent staleness signal beyond "market is closed"
    // (handled separately via isMarketOpen/restrictedHoursOnly below). A
    // real provider adapter would set this from actual feed lag.
    quote: {
      bid: quote.bid,
      ask: quote.ask,
      last: quote.last,
      isMarketOpen: quote.isMarketOpen,
      isStale: false,
    },
  };
}

async function computeGrossExposure(
  positions: Array<{ quantity: unknown; instrumentId: string; instrument: { symbol: string } }>,
): Promise<number> {
  const provider = getMarketDataProvider();
  let total = 0;
  for (const p of positions) {
    const quote = await provider.getQuote(p.instrumentId, p.instrument.symbol);
    total += Number(p.quantity) * quote.last;
  }
  return total;
}
