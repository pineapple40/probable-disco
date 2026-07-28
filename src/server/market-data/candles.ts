import "server-only";
import { prisma } from "@/lib/db";
import type { CandleTimeframe } from "@/generated/prisma/client";
import { generateDailyCandles, generateIntradayCandlesForDay, type SimCandle } from "@/server/market-data/simulate";
import { addUtcDays, startOfUtcDay, tradingDays, TIMEFRAME_MINUTES } from "@/server/market-data/calendar";

export const EPOCH = new Date(Date.UTC(2023, 0, 2));
const INTRADAY_WINDOW_DAYS = 30;

async function ensureDailyCandles(instrumentId: string, symbol: string, through: Date) {
  const latest = await prisma.candle.findFirst({
    where: { instrumentId, timeframe: "D1" },
    orderBy: { ts: "desc" },
  });
  if (latest && latest.ts.getTime() >= startOfUtcDay(through).getTime()) return;

  const series = generateDailyCandles(symbol, EPOCH, through);
  await prisma.candle.createMany({
    data: series.map((c) => toCandleRow(instrumentId, "D1", c)),
    skipDuplicates: true,
  });
}

async function ensureIntradayCandles(
  instrumentId: string,
  symbol: string,
  timeframe: CandleTimeframe,
  through: Date,
) {
  await ensureDailyCandles(instrumentId, symbol, through);

  const windowStart = addUtcDays(startOfUtcDay(through), -INTRADAY_WINDOW_DAYS);
  const minutes = TIMEFRAME_MINUTES[timeframe] ?? 1;

  for (const day of tradingDays(windowStart, through)) {
    const existing = await prisma.candle.findFirst({
      where: {
        instrumentId,
        timeframe,
        ts: { gte: day, lt: addUtcDays(day, 1) },
      },
    });
    if (existing) continue;

    const dailyCandle = await prisma.candle.findUnique({
      where: { instrumentId_timeframe_ts: { instrumentId, timeframe: "D1", ts: day } },
    });
    if (!dailyCandle) continue;

    const intraday = generateIntradayCandlesForDay(
      symbol,
      minutes,
      day,
      Number(dailyCandle.open),
      Number(dailyCandle.close),
      Number(dailyCandle.volume),
    );
    await prisma.candle.createMany({
      data: intraday.map((c) => toCandleRow(instrumentId, timeframe, c)),
      skipDuplicates: true,
    });
  }
}

function toCandleRow(instrumentId: string, timeframe: CandleTimeframe, c: SimCandle) {
  return {
    instrumentId,
    timeframe,
    ts: c.ts,
    open: c.open.toFixed(4),
    high: c.high.toFixed(4),
    low: c.low.toFixed(4),
    close: c.close.toFixed(4),
    volume: BigInt(c.volume),
    sourceType: "SIMULATED" as const,
  };
}

export async function getCandles(
  instrumentId: string,
  symbol: string,
  timeframe: CandleTimeframe,
  from: Date,
  to: Date,
) {
  if (timeframe === "D1") {
    await ensureDailyCandles(instrumentId, symbol, to);
  } else {
    await ensureIntradayCandles(instrumentId, symbol, timeframe, to);
  }

  return prisma.candle.findMany({
    where: { instrumentId, timeframe, ts: { gte: from, lte: to } },
    orderBy: { ts: "asc" },
  });
}

export async function getLatestDailyCandle(instrumentId: string, symbol: string, asOf: Date) {
  await ensureDailyCandles(instrumentId, symbol, asOf);
  return prisma.candle.findFirst({
    where: { instrumentId, timeframe: "D1", ts: { lte: startOfUtcDay(asOf) } },
    orderBy: { ts: "desc" },
  });
}
