"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useWatchlists,
  useCreateWatchlist,
  useAddSymbol,
  useRemoveSymbol,
  type WatchlistRow,
} from "@/hooks/useWatchlists";
import { useQuotes } from "@/hooks/useQuote";
import { formatCurrency, formatPercent } from "@/lib/format";

function WatchlistCard({ watchlist }: { watchlist: WatchlistRow }) {
  const [newSymbol, setNewSymbol] = React.useState("");
  const addSymbol = useAddSymbol();
  const removeSymbol = useRemoveSymbol();
  const symbols = watchlist.symbols.map((s) => s.symbol);
  const { data: quotes } = useQuotes(symbols);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newSymbol.trim()) return;
    await addSymbol.mutateAsync({ watchlistId: watchlist.id, symbol: newSymbol.trim().toUpperCase() });
    setNewSymbol("");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{watchlist.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onAdd} className="mb-3 flex gap-2">
          <Input
            placeholder="Add symbol (e.g. AAPL)"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
          />
          <Button type="submit" disabled={addSymbol.isPending}>
            Add
          </Button>
        </form>

        {watchlist.symbols.length === 0 ? (
          <p className="text-sm text-slate-500">No symbols yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-400">
                <tr>
                  <th className="pb-2">Symbol</th>
                  <th className="pb-2">Last</th>
                  <th className="pb-2">Change</th>
                  <th className="pb-2">Bid/Ask</th>
                  <th className="pb-2">Volume</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {watchlist.symbols.map((s) => {
                  const quote = quotes?.find((q) => q.symbol === s.symbol);
                  return (
                    <tr key={s.id} className="border-t border-slate-800">
                      <td className="py-2 font-medium">
                        <Link href={`/charts?symbol=${s.symbol}`} className="hover:underline">
                          {s.symbol}
                        </Link>
                      </td>
                      <td className="py-2">{quote ? formatCurrency(quote.last) : "…"}</td>
                      <td
                        className={`py-2 ${quote && quote.changeAbs >= 0 ? "text-green-400" : "text-red-400"}`}
                      >
                        {quote ? formatPercent(quote.changePct) : "…"}
                      </td>
                      <td className="py-2 text-xs text-slate-400">
                        {quote ? `${formatCurrency(quote.bid)} / ${formatCurrency(quote.ask)}` : "…"}
                      </td>
                      <td className="py-2 text-xs text-slate-400">
                        {quote ? quote.volume.toLocaleString() : "…"}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          className="text-xs text-slate-500 hover:text-red-400"
                          onClick={() => removeSymbol.mutate({ watchlistId: watchlist.id, symbolId: s.id })}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function WatchlistsPage() {
  const { data: watchlists, isLoading } = useWatchlists();
  const createWatchlist = useCreateWatchlist();
  const [newName, setNewName] = React.useState("");

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await createWatchlist.mutateAsync(newName.trim());
    setNewName("");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Watchlists</h1>
      </div>

      <form onSubmit={onCreate} className="flex gap-2">
        <Input
          placeholder="New watchlist name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button type="submit" disabled={createWatchlist.isPending}>
          Create watchlist
        </Button>
      </form>

      {isLoading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : !watchlists || watchlists.length === 0 ? (
        <p className="text-sm text-slate-500">No watchlists yet. Create one above.</p>
      ) : (
        <div className="space-y-4">
          {watchlists.map((w) => (
            <WatchlistCard key={w.id} watchlist={w} />
          ))}
        </div>
      )}
    </div>
  );
}
