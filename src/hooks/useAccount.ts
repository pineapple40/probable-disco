"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/api-client";

export interface AccountSummary {
  id: string;
  label: string;
  currency: string;
  cash: number;
  equity: number;
  buyingPower: number;
  isPaper: boolean;
  broker: { provider: string; isPaper: boolean };
  dailyRealizedPnl: number;
  dailyUnrealizedPnl: number;
  isTradingLocked: boolean;
  tradingLockReason: string | null;
}

export function useAccount() {
  return useQuery({
    queryKey: ["account"],
    queryFn: () => getJson<AccountSummary>("/api/accounts"),
    refetchInterval: 6000,
  });
}
