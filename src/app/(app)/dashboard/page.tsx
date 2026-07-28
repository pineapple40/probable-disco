"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderTicket } from "@/components/trading/order-ticket";
import { useAccount } from "@/hooks/useAccount";
import { usePositions } from "@/hooks/usePositions";
import { useOrders, useCancelOrder } from "@/hooks/useOrders";
import { formatCurrency, formatPercent } from "@/lib/format";

function PnlText({ value }: { value: number }) {
  return (
    <span className={value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-slate-300"}>
      {value >= 0 ? "+" : ""}
      {formatCurrency(value)}
    </span>
  );
}

export default function DashboardPage() {
  const { data: account, isLoading: accountLoading, error: accountError } = useAccount();
  const { data: positions, isLoading: positionsLoading } = usePositions();
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const cancelOrder = useCancelOrder();

  const openOrders = orders?.filter((o) => o.status === "NEW" || o.status === "PENDING_NEW") ?? [];
  const recentOrders = orders?.slice(0, 8) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Dashboard</h1>

      {account?.isTradingLocked && (
        <div className="rounded-md border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
          Trading is locked for this account{account.tradingLockReason ? `: ${account.tradingLockReason}` : "."}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-400">Equity</p>
            <p className="text-lg font-semibold">
              {accountLoading ? "…" : account ? formatCurrency(account.equity) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-400">Cash</p>
            <p className="text-lg font-semibold">
              {accountLoading ? "…" : account ? formatCurrency(account.cash) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-400">Buying power</p>
            <p className="text-lg font-semibold">
              {accountLoading ? "…" : account ? formatCurrency(account.buyingPower) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-slate-400">Daily P&amp;L (realized + unrealized)</p>
            <p className="text-lg font-semibold">
              {account ? (
                <PnlText value={account.dailyRealizedPnl + account.dailyUnrealizedPnl} />
              ) : (
                "—"
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {accountError && (
        <Card>
          <CardContent className="pt-4 text-sm text-red-400">
            Could not load account data. The dashboard will keep retrying.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Open positions</CardTitle>
            </CardHeader>
            <CardContent>
              {positionsLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : !positions || positions.length === 0 ? (
                <p className="text-sm text-slate-500">No open positions.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-400">
                      <tr>
                        <th className="pb-2">Symbol</th>
                        <th className="pb-2">Qty</th>
                        <th className="pb-2">Avg entry</th>
                        <th className="pb-2">Last</th>
                        <th className="pb-2">Mkt value</th>
                        <th className="pb-2">Unrealized P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p) => (
                        <tr key={p.id} className="border-t border-slate-800">
                          <td className="py-2 font-medium">
                            <Link href={`/charts?symbol=${p.symbol}`} className="hover:underline">
                              {p.symbol}
                            </Link>
                          </td>
                          <td className="py-2">{p.quantity}</td>
                          <td className="py-2">{formatCurrency(p.avgEntryPrice)}</td>
                          <td className="py-2">{formatCurrency(p.lastPrice)}</td>
                          <td className="py-2">{formatCurrency(p.marketValue)}</td>
                          <td className="py-2">
                            <PnlText value={p.unrealizedPnl} /> ({formatPercent(p.unrealizedPnlPct)})
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Open orders</CardTitle>
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <p className="text-sm text-slate-400">Loading…</p>
              ) : openOrders.length === 0 ? (
                <p className="text-sm text-slate-500">No resting orders.</p>
              ) : (
                <div className="space-y-2">
                  {openOrders.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between rounded-md bg-slate-800/50 p-2 text-sm"
                    >
                      <span>
                        {o.side} {o.quantity} {o.symbol} {o.type}
                        {o.limitPrice ? ` @ ${formatCurrency(o.limitPrice)}` : ""}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => cancelOrder(o.id)}>
                        Cancel
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent orders</CardTitle>
            </CardHeader>
            <CardContent>
              {recentOrders.length === 0 ? (
                <p className="text-sm text-slate-500">No orders yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {recentOrders.map((o) => (
                    <li key={o.id} className="flex justify-between border-t border-slate-800 py-1.5">
                      <span>
                        {o.side} {o.quantity} {o.symbol} {o.type}
                      </span>
                      <span
                        className={
                          o.status === "FILLED"
                            ? "text-green-400"
                            : o.status === "REJECTED" || o.status === "CANCELED"
                              ? "text-red-400"
                              : "text-slate-300"
                        }
                      >
                        {o.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Order ticket</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderTicket />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
