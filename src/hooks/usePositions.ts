"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api-client";

export interface PositionRow {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  avgEntryPrice: number;
  realizedPnl: number;
  lastPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  openedAt: string;
}

export function usePositions() {
  return useQuery({
    queryKey: ["positions"],
    queryFn: () => getJson<PositionRow[]>("/api/positions"),
    refetchInterval: 5000,
  });
}
