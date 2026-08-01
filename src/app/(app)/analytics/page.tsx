"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getJson } from "@/lib/api-client";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { PerformanceReport } from "@/server/analytics/service";

export default function AnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => getJson<PerformanceReport>("/api/analytics/performance"),
  });

  if (isLoading || !data) {
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  const { summary, bySymbol, byDayOfWeek } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Analytics</h1>
        <a href="/api/analytics/export">
          <Button variant="outline" size="sm">
            Export CSV
          </Button>
        </a>
      </div>

      {summary.totalTrades === 0 ? (
        <p className="text-sm text-slate-500">
          No closed trades yet. Analytics will populate once you close paper-trading positions.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Net P&L" value={formatCurrency(summary.netPnl)} />
            <Metric label="Win rate" value={`${summary.winRatePct.toFixed(1)}%`} />
            <Metric label="Profit factor" value={summary.profitFactor?.toFixed(2) ?? "∞"} />
            <Metric label="Expectancy / trade" value={formatCurrency(summary.expectancy)} />
            <Metric label="Avg win" value={formatCurrency(summary.avgWin)} />
            <Metric label="Avg loss" value={formatCurrency(summary.avgLoss)} />
            <Metric label="Max drawdown" value={formatCurrency(-summary.maxDrawdown)} />
            <Metric label="Total trades" value={String(summary.totalTrades)} />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Performance by symbol</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-400">
                    <tr>
                      <th className="pb-2">Symbol</th>
                      <th className="pb-2">Trades</th>
                      <th className="pb-2">Win rate</th>
                      <th className="pb-2">Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bySymbol.map((row) => (
                      <tr key={row.symbol} className="border-t border-slate-800">
                        <td className="py-2 font-medium">{row.symbol}</td>
                        <td className="py-2">{row.trades}</td>
                        <td className="py-2">{formatPercent(row.winRatePct)}</td>
                        <td className={`py-2 ${row.netPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {formatCurrency(row.netPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Performance by day of week</CardTitle>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-400">
                    <tr>
                      <th className="pb-2">Day</th>
                      <th className="pb-2">Trades</th>
                      <th className="pb-2">Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byDayOfWeek.map((row) => (
                      <tr key={row.day} className="border-t border-slate-800">
                        <td className="py-2 font-medium">{row.day}</td>
                        <td className="py-2">{row.trades}</td>
                        <td className={`py-2 ${row.netPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {formatCurrency(row.netPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <p className="text-xs text-slate-500">
        Analytics reflect actual paper-trading and imported results only. No figures are shown
        after seed/demo data is cleared unless real trades have occurred.
      </p>
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
