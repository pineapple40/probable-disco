"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api-client";

export type Timeframe = "M1" | "M5" | "M15" | "H1" | "D1";

export interface CandleRow {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: string;
}

interface CandlesResponse {
  symbol: string;
  timeframe: Timeframe;
  sourceType: string;
  candles: CandleRow[];
}

export function useCandles(symbol: string | null, timeframe: Timeframe) {
  return useQuery({
    queryKey: ["candles", symbol, timeframe],
    queryFn: () =>
      getJson<CandlesResponse>(`/api/market-data/candles?symbol=${symbol}&timeframe=${timeframe}`),
    enabled: Boolean(symbol),
    refetchInterval: 15000,
  });
}
