import type { CandleTimeframe } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import * as alpaca from "@/server/broker/alpaca/client";
import type { AlpacaBar } from "@/server/broker/alpaca/client";
import { getMarketSessionStatus } from "@/server/market-data/calendar";
import type { LiveQuote } from "@/server/market-data/quote";
import type { MarketDataProvider } from "@/server/market-data/provider";

const TIMEFRAME_TO_ALPACA: Record<CandleTimeframe, string> = {
  M1: "1Min",
  M5: "5Min",
  M15: "15Min",
  H1: "1Hour",
  D1: "1Day",
};

function toCandleRow(instrumentId: string, timeframe: CandleTimeframe, bar: AlpacaBar) {
  return {
    instrumentId,
    timeframe,
    ts: new Date(bar.t),
    open: bar.o.toFixed(4),
    high: bar.h.toFixed(4),
    low: bar.l.toFixed(4),
    close: bar.c.toFixed(4),
    volume: BigInt(Math.round(bar.v)),
    sourceType: "REALTIME" as const,
  };
}

async function fetchAndCacheBars(
  instrumentId: string,
  symbol: string,
  timeframe: CandleTimeframe,
  from: Date,
  to: Date,
): Promise<void> {
  const bars = await alpaca.getBars(symbol, TIMEFRAME_TO_ALPACA[timeframe], from, to);
  if (bars.length === 0) return;
  await prisma.candle.createMany({
    data: bars.map((bar) => toCandleRow(instrumentId, timeframe, bar)),
    skipDuplicates: true,
  });
}

/**
 * Real market data via Alpaca's Market Data API (the same API key/secret
 * used for paper trading also grants free IEX-feed data access). Fetched
 * bars are cached into the Candle table tagged `sourceType: REALTIME`,
 * alongside (never mixed with) the simulated engine's SIMULATED-tagged rows.
 */
export class AlpacaMarketDataProvider implements MarketDataProvider {
  readonly name = "alpaca";
  readonly sourceType = "REALTIME" as const;

  async getQuote(_instrumentId: string, symbol: string): Promise<LiveQuote> {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const [quote, trade, dailyBars] = await Promise.all([
      alpaca.getLatestQuote(symbol),
      alpaca.getLatestTrade(symbol),
      alpaca.getBars(symbol, "1Day", fiveDaysAgo, new Date()),
    ]);

    const last = trade.trade.p;
    const today = dailyBars[dailyBars.length - 1];
    const prevDay = dailyBars.length >= 2 ? dailyBars[dailyBars.length - 2] : undefined;
    const prevClose = prevDay?.c ?? today?.o ?? last;
    const changeAbs = last - prevClose;
    const session = getMarketSessionStatus(new Date());

    return {
      symbol,
      bid: quote.quote.bp,
      ask: quote.quote.ap,
      last,
      dayOpen: today?.o ?? last,
      dayHigh: today?.h ?? last,
      dayLow: today?.l ?? last,
      prevClose,
      volume: today?.v ?? 0,
      changeAbs,
      changePct: prevClose > 0 ? (changeAbs / prevClose) * 100 : 0,
      sourceType: "REALTIME",
      isStale: !session.isRegularSessionOpen,
      isMarketOpen: session.isRegularSessionOpen,
      asOf: quote.quote.t,
    };
  }

  async getCandles(instrumentId: string, symbol: string, timeframe: CandleTimeframe, from: Date, to: Date) {
    await fetchAndCacheBars(instrumentId, symbol, timeframe, from, to);
    return prisma.candle.findMany({
      where: { instrumentId, timeframe, ts: { gte: from, lte: to } },
      orderBy: { ts: "asc" },
    });
  }
}
