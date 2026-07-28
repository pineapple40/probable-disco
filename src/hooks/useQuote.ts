"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api-client";

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  prevClose: number;
  volume: number;
  changeAbs: number;
  changePct: number;
  sourceType: "SIMULATED";
  isStale: boolean;
  isMarketOpen: boolean;
  asOf: string;
}

export function useQuote(symbol: string | null) {
  return useQuery({
    queryKey: ["quote", symbol],
    queryFn: () => getJson<Quote>(`/api/market-data/quote?symbol=${symbol}`),
    enabled: Boolean(symbol),
    refetchInterval: 4000,
  });
}

export function useQuotes(symbols: string[]) {
  return useQuery({
    queryKey: ["quotes", symbols.join(",")],
    queryFn: async () => {
      const results = await Promise.all(
        symbols.map((s) => getJson<Quote>(`/api/market-data/quote?symbol=${s}`)),
      );
      return results;
    },
    enabled: symbols.length > 0,
    refetchInterval: 4000,
  });
}
