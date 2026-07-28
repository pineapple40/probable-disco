import "server-only";
import type { CandleTimeframe } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { getLiveQuote, type LiveQuote } from "@/server/market-data/quote";
import { getCandles } from "@/server/market-data/candles";

/**
 * Provider-neutral market-data interface. Real providers (a licensed
 * real-time or delayed feed) should implement this same interface so the
 * rest of the app never depends on a vendor's proprietary shapes.
 */
export interface MarketDataProvider {
  readonly name: string;
  readonly sourceType: "SIMULATED" | "DELAYED" | "REALTIME";
  getQuote(instrumentId: string, symbol: string): Promise<LiveQuote>;
  getCandles(
    instrumentId: string,
    symbol: string,
    timeframe: CandleTimeframe,
    from: Date,
    to: Date,
  ): ReturnType<typeof getCandles>;
}

class SimulatedMarketDataProvider implements MarketDataProvider {
  readonly name = "simulated";
  readonly sourceType = "SIMULATED" as const;

  getQuote(instrumentId: string, symbol: string) {
    return getLiveQuote(instrumentId, symbol);
  }

  getCandles(
    instrumentId: string,
    symbol: string,
    timeframe: CandleTimeframe,
    from: Date,
    to: Date,
  ) {
    return getCandles(instrumentId, symbol, timeframe, from, to);
  }
}

let cachedProvider: MarketDataProvider | null = null;

export function getMarketDataProvider(): MarketDataProvider {
  if (cachedProvider) return cachedProvider;
  switch (env.MARKET_DATA_PROVIDER) {
    case "simulated":
      cachedProvider = new SimulatedMarketDataProvider();
      return cachedProvider;
    default:
      // Real providers (e.g. a licensed delayed/real-time feed) plug in here
      // by implementing MarketDataProvider and being registered in this
      // switch - see docs/ARCHITECTURE.md.
      throw new Error(`Unsupported market data provider: ${env.MARKET_DATA_PROVIDER}`);
  }
}
