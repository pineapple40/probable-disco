"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { getJson, postJson, ApiError } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/format";

interface Strategy {
  id: string;
  name: string;
  versions: Array<{ id: string; version: number; isValid: boolean }>;
}

interface BacktestSummary {
  id: string;
  strategyName: string;
  symbols: string[];
  startDate: string;
  endDate: string;
  status: string;
  resultSummary: Record<string, unknown> | null;
  createdAt: string;
}

interface BacktestDetail extends BacktestSummary {
  errorMessage: string | null;
  trades: Array<{
    symbol: string;
    side: string;
    quantity: number;
    entryPrice: number;
    exitPrice: number;
    entryAt: string;
    exitAt: string;
    pnl: number;
    commission: number;
    reason: string;
  }>;
}

export default function BacktestsPage() {
  const queryClient = useQueryClient();
  const { data: strategies } = useQuery({
    queryKey: ["strategies"],
    queryFn: () => getJson<Strategy[]>("/api/strategies"),
  });
  const { data: backtests, isLoading } = useQuery({
    queryKey: ["backtests"],
    queryFn: () => getJson<BacktestSummary[]>("/api/backtests"),
    refetchInterval: 5000,
  });

  const [strategyId, setStrategyId] = React.useState("");
  const [versionId, setVersionId] = React.useState("");
  const [symbols, setSymbols] = React.useState("AAPL");
  const [startDate, setStartDate] = React.useState("2024-01-01");
  const [endDate, setEndDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [initialCapital, setInitialCapital] = React.useState("100000");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const runBacktest = useMutation({
    mutationFn: () =>
      postJson<{ id: string }>("/api/backtests", {
        strategyId,
        strategyVersionId: versionId,
        symbols: symbols.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
        startDate,
        endDate,
        initialCapital: Number(initialCapital),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["backtests"] });
      setSelectedId(data.id);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Backtest failed."),
  });

  const { data: detail } = useQuery({
    queryKey: ["backtest", selectedId],
    queryFn: () => getJson<BacktestDetail>(`/api/backtests/${selectedId}`),
    enabled: Boolean(selectedId),
  });

  const equityCurve = (detail?.resultSummary?.equityCurve as Array<{ date: string; equity: number }>) ?? [];
  const summary = detail?.resultSummary as Record<string, number> | undefined;

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Backtests</h1>
      <p className="text-xs text-slate-500">
        Hypothetical results based on simulated historical data and the assumptions below (commission,
        slippage, spread). Past simulated performance does not indicate future results.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Run a backtest</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <Label>Strategy</Label>
              <Select
                value={strategyId}
                onChange={(e) => {
                  setStrategyId(e.target.value);
                  const s = strategies?.find((s) => s.id === e.target.value);
                  setVersionId(s?.versions[0]?.id ?? "");
                }}
              >
                <option value="">Select…</option>
                {strategies?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Symbols</Label>
              <Input value={symbols} onChange={(e) => setSymbols(e.target.value.toUpperCase())} />
            </div>
            <div>
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label>End date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div>
              <Label>Initial capital</Label>
              <Input value={initialCapital} onChange={(e) => setInitialCapital(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button
            disabled={!strategyId || !versionId || runBacktest.isPending}
            onClick={() => {
              setError(null);
              runBacktest.mutate();
            }}
          >
            {runBacktest.isPending ? "Running…" : "Run backtest"}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : !backtests || backtests.length === 0 ? (
              <p className="text-sm text-slate-500">No backtests yet.</p>
            ) : (
              <ul className="space-y-1">
                {backtests.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => setSelectedId(b.id)}
                      className={`w-full rounded-md p-2 text-left text-sm hover:bg-slate-800 ${
                        selectedId === b.id ? "bg-slate-800" : ""
                      }`}
                    >
                      <p className="font-medium">
                        {b.strategyName} · {b.symbols.join(", ")}
                      </p>
                      <p className="text-xs text-slate-500">
                        {b.status} · {new Date(b.createdAt).toLocaleString()}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {detail && summary && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric label="Net P&L" value={formatCurrency(summary.netPnl ?? 0)} />
                <Metric label="Return" value={formatPercent(summary.netReturnPct ?? 0)} />
                <Metric label="Win rate" value={`${(summary.winRatePct ?? 0).toFixed(1)}%`} />
                <Metric
                  label="Profit factor"
                  value={summary.profitFactor != null ? summary.profitFactor.toFixed(2) : "∞"}
                />
                <Metric label="Max drawdown" value={formatCurrency(-(summary.maxDrawdown ?? 0))} />
                <Metric label="Trades" value={String(summary.numberOfTrades ?? 0)} />
                <Metric
                  label="Sharpe"
                  value={summary.sharpeRatio != null ? summary.sharpeRatio.toFixed(2) : "n/a"}
                />
                <Metric
                  label="Sortino"
                  value={summary.sortinoRatio != null ? summary.sortinoRatio.toFixed(2) : "n/a"}
                />
              </div>

              {detail.status === "failed" && (
                <p className="text-sm text-red-400">Backtest failed: {detail.errorMessage}</p>
              )}

              {equityCurve.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Equity curve</CardTitle>
                  </CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={equityCurve}>
                        <CartesianGrid stroke="#1e293b" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: "#94a3b8" }}
                          tickFormatter={(v) => new Date(v).toLocaleDateString()}
                        />
                        <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} domain={["auto", "auto"]} />
                        <Tooltip
                          contentStyle={{ background: "#1e293b", border: "none" }}
                          labelFormatter={(v) => (typeof v === "string" ? new Date(v).toLocaleDateString() : "")}
                          formatter={(v) => (typeof v === "number" ? formatCurrency(v) : String(v))}
                        />
                        <Line type="monotone" dataKey="equity" stroke="#38bdf8" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>
                    Trade ledger{" "}
                    <a href={`/api/backtests/${detail.id}/export?format=csv`} className="ml-2 text-xs text-sky-400">
                      CSV
                    </a>{" "}
                    <a href={`/api/backtests/${detail.id}/export?format=json`} className="ml-2 text-xs text-sky-400">
                      JSON
                    </a>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-900 text-left text-xs text-slate-400">
                        <tr>
                          <th className="pb-2">Symbol</th>
                          <th className="pb-2">Entry</th>
                          <th className="pb-2">Exit</th>
                          <th className="pb-2">P&amp;L</th>
                          <th className="pb-2">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.trades.map((t, i) => (
                          <tr key={i} className="border-t border-slate-800">
                            <td className="py-1.5">{t.symbol}</td>
                            <td className="py-1.5">{formatCurrency(t.entryPrice)}</td>
                            <td className="py-1.5">{formatCurrency(t.exitPrice)}</td>
                            <td className={`py-1.5 ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                              {formatCurrency(t.pnl)}
                            </td>
                            <td className="py-1.5 text-xs text-slate-400">{t.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-slate-400">{label}</p>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
