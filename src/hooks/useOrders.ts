"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson } from "@/lib/api-client";

export interface OrderRow {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  duration: "DAY" | "GTC";
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  status: string;
  rejectReason: string | null;
  submittedAt: string;
  executions: Array<{ quantity: number; price: number; executedAt: string }>;
}

export function useOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: () => getJson<OrderRow[]>("/api/orders"),
    refetchInterval: 5000,
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();
  return async (orderId: string) => {
    await postJson(`/api/orders/${orderId}/cancel`, {});
    await queryClient.invalidateQueries({ queryKey: ["orders"] });
    await queryClient.invalidateQueries({ queryKey: ["positions"] });
  };
}
