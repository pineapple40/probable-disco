import "server-only";
import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/server/market-data/provider";

export interface ScannerFilters {
  minPrice?: number;
  maxPrice?: number;
  minChangePct?: number;
  maxChangePct?: number;
  minVolume?: number;
}

export interface ScannerRow {
  symbol: string;
  name: string;
  last: number;
  changePct: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
}

/**
 * Scans the full (small, local) simulated instrument universe. Only fields
 * the simulated provider actually supports are exposed - no market cap,
 * relative volume, or fundamentals data is fabricated.
 */
export async function runScan(filters: ScannerFilters): Promise<ScannerRow[]> {
  const instruments = await prisma.instrument.findMany({ where: { isTradable: true } });
  const provider = getMarketDataProvider();

  const rows: ScannerRow[] = [];
  for (const instrument of instruments) {
    const quote = await provider.getQuote(instrument.id, instrument.symbol);
    if (filters.minPrice !== undefined && quote.last < filters.minPrice) continue;
    if (filters.maxPrice !== undefined && quote.last > filters.maxPrice) continue;
    if (filters.minChangePct !== undefined && quote.changePct < filters.minChangePct) continue;
    if (filters.maxChangePct !== undefined && quote.changePct > filters.maxChangePct) continue;
    if (filters.minVolume !== undefined && quote.volume < filters.minVolume) continue;

    rows.push({
      symbol: instrument.symbol,
      name: instrument.name,
      last: quote.last,
      changePct: quote.changePct,
      volume: quote.volume,
      dayHigh: quote.dayHigh,
      dayLow: quote.dayLow,
    });
  }

  return rows.sort((a, b) => b.changePct - a.changePct);
}
