"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getJson, postJson } from "@/lib/api-client";

export interface WatchlistSymbolRow {
  id: string;
  symbol: string;
  name: string;
  notes: string | null;
  tags: string[];
  sortOrder: number;
}

export interface WatchlistRow {
  id: string;
  name: string;
  symbols: WatchlistSymbolRow[];
}

export function useWatchlists() {
  return useQuery({
    queryKey: ["watchlists"],
    queryFn: () => getJson<WatchlistRow[]>("/api/watchlists"),
  });
}

export function useCreateWatchlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => postJson("/api/watchlists", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlists"] }),
  });
}

export function useAddSymbol() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ watchlistId, symbol }: { watchlistId: string; symbol: string }) =>
      postJson(`/api/watchlists/${watchlistId}/symbols`, { symbol }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlists"] }),
  });
}

export function useRemoveSymbol() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ watchlistId, symbolId }: { watchlistId: string; symbolId: string }) => {
      const res = await fetch(`/api/watchlists/${watchlistId}/symbols/${symbolId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove symbol.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlists"] }),
  });
}
