"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { PriceChart, type IndicatorToggles } from "@/components/trading/price-chart";
import { OrderTicket } from "@/components/trading/order-ticket";
import { useCandles, type Timeframe } from "@/hooks/useCandles";
import { useQuote } from "@/hooks/useQuote";
import { formatCurrency, formatPercent } from "@/lib/format";

function ChartsInner() {
  const params = useSearchParams();
  const [symbol, setSymbol] = React.useState(params.get("symbol") ?? "AAPL");
  const [symbolInput, setSymbolInput] = React.useState(symbol);
  const [timeframe, setTimeframe] = React.useState<Timeframe>("D1");
  const [indicators, setIndicators] = React.useState<IndicatorToggles>({
    sma20: true,
    ema50: false,
    vwap: false,
    rsi: false,
  });

  const { data, isLoading, error } = useCandles(symbol, timeframe);
  const { data: quote } = useQuote(symbol);

  function toggle(key: keyof IndicatorToggles) {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function onSymbolSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (symbolInput.trim()) setSymbol(symbolInput.trim().toUpperCase());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <form onSubmit={onSymbolSubmit} className="flex gap-2">
          <Input
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            className="w-32"
          />
        </form>
        <Select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value as Timeframe)}
          className="w-28"
        >
          <option value="M1">1 min</option>
          <option value="M5">5 min</option>
          <option value="M15">15 min</option>
          <option value="H1">1 hour</option>
          <option value="D1">Daily</option>
        </Select>

        <div className="flex flex-wrap gap-3 text-xs text-slate-300">
          {(
            [
              ["sma20", "SMA 20"],
              ["ema50", "EMA 50"],
              ["vwap", "VWAP"],
              ["rsi", "RSI 14"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1">
              <input type="checkbox" checked={indicators[key]} onChange={() => toggle(key)} />
              {label}
            </label>
          ))}
        </div>

        {quote && (
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="font-semibold">{formatCurrency(quote.last)}</span>
            <span className={quote.changeAbs >= 0 ? "text-green-400" : "text-red-400"}>
              {formatPercent(quote.changePct)}
            </span>
            {!quote.isMarketOpen && (
              <span className="rounded bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300">
                Market closed — simulated
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>
                {symbol} — {timeframe}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-sm text-slate-400">Loading chart…</p>
              ) : error ? (
                <p className="text-sm text-red-400">Could not load data for {symbol}.</p>
              ) : data && data.candles.length > 0 ? (
                <PriceChart candles={data.candles} indicators={indicators} />
              ) : (
                <p className="text-sm text-slate-500">No data available.</p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Source: simulated market data. Not real-time, not investment advice.
              </p>
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardHeader>
              <CardTitle>Order ticket</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderTicket key={symbol} defaultSymbol={symbol} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function ChartsPage() {
  return (
    <React.Suspense fallback={<p className="text-sm text-slate-400">Loading…</p>}>
      <ChartsInner />
    </React.Suspense>
  );
}
