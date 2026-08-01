"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useQuote } from "@/hooks/useQuote";
import { postJson, ApiError } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";

type Side = "BUY" | "SELL";
type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";

interface OrderResult {
  order: { id: string; status: string; rejectReason: string | null; filledQuantity: number };
  riskDecision: {
    allowed: boolean;
    ruleKey: string;
    message: string;
    warnings: string[];
    estimatedEntryPrice: number;
    estimatedNotional: number;
  } | null;
  replayed: boolean;
}

export function OrderTicket({ defaultSymbol = "AAPL" }: { defaultSymbol?: string }) {
  const queryClient = useQueryClient();
  const [symbol, setSymbol] = React.useState(defaultSymbol);
  const [side, setSide] = React.useState<Side>("BUY");
  const [type, setType] = React.useState<OrderType>("MARKET");
  const [quantity, setQuantity] = React.useState("10");
  const [limitPrice, setLimitPrice] = React.useState("");
  const [stopPrice, setStopPrice] = React.useState("");
  const [stopLossPrice, setStopLossPrice] = React.useState("");
  const [takeProfitPrice, setTakeProfitPrice] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [result, setResult] = React.useState<OrderResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const { data: quote } = useQuote(symbol || null);

  const quantityNum = Number(quantity) || 0;
  const referencePrice = quote ? (side === "BUY" ? quote.ask : quote.bid) : 0;
  const estimatedNotional = quantityNum * referencePrice;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const payload: Record<string, unknown> = {
        symbol,
        side,
        type,
        quantity: quantityNum,
        duration: "DAY",
        isExtendedHours: false,
        idempotencyKey,
      };
      if (type === "LIMIT" || type === "STOP_LIMIT") payload.limitPrice = Number(limitPrice);
      if (type === "STOP" || type === "STOP_LIMIT") payload.stopPrice = Number(stopPrice);
      if (stopLossPrice) payload.stopLossPrice = Number(stopLossPrice);
      if (takeProfitPrice) payload.takeProfitPrice = Number(takeProfitPrice);

      const data = await postJson<OrderResult>("/api/orders", payload);
      setResult(data);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["positions"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["account"] }),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to submit order.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="ticket-symbol">Symbol</Label>
        <Input
          id="ticket-symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="ticket-side">Side</Label>
          <Select id="ticket-side" value={side} onChange={(e) => setSide(e.target.value as Side)}>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="ticket-type">Type</Label>
          <Select id="ticket-type" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
            <option value="MARKET">Market</option>
            <option value="LIMIT">Limit</option>
            <option value="STOP">Stop</option>
            <option value="STOP_LIMIT">Stop-limit</option>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="ticket-qty">Quantity</Label>
        <Input
          id="ticket-qty"
          type="number"
          min="0"
          step="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          required
        />
      </div>

      {(type === "LIMIT" || type === "STOP_LIMIT") && (
        <div>
          <Label htmlFor="ticket-limit">Limit price</Label>
          <Input
            id="ticket-limit"
            type="number"
            step="0.01"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            required
          />
        </div>
      )}
      {(type === "STOP" || type === "STOP_LIMIT") && (
        <div>
          <Label htmlFor="ticket-stop">Stop price</Label>
          <Input
            id="ticket-stop"
            type="number"
            step="0.01"
            value={stopPrice}
            onChange={(e) => setStopPrice(e.target.value)}
            required
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="ticket-sl">Stop-loss (required to buy)</Label>
          <Input
            id="ticket-sl"
            type="number"
            step="0.01"
            value={stopLossPrice}
            onChange={(e) => setStopLossPrice(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="ticket-tp">Take-profit</Label>
          <Input
            id="ticket-tp"
            type="number"
            step="0.01"
            value={takeProfitPrice}
            onChange={(e) => setTakeProfitPrice(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-md bg-slate-800/60 p-3 text-xs text-slate-300">
        <div className="flex justify-between">
          <span>Quote (simulated)</span>
          <span>
            {quote ? `${formatCurrency(quote.bid)} / ${formatCurrency(quote.ask)}` : "—"}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Est. notional</span>
          <span>{formatCurrency(estimatedNotional)}</span>
        </div>
        {quote && !quote.isMarketOpen && (
          <p className="mt-1 text-amber-400">
            Market is closed. Only market-hours orders are supported in this release.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div
          className={
            result.order.status === "REJECTED"
              ? "rounded-md bg-red-950/50 p-3 text-sm text-red-300"
              : "rounded-md bg-green-950/50 p-3 text-sm text-green-300"
          }
        >
          <p>
            Order {result.order.id.slice(0, 8)}: <strong>{result.order.status}</strong>
          </p>
          {result.order.rejectReason && <p>{result.order.rejectReason}</p>}
          {result.riskDecision?.warnings.map((w) => (
            <p key={w} className="text-amber-300">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitting || !quantityNum}>
        {submitting ? "Submitting..." : `${side === "BUY" ? "Buy" : "Sell"} ${symbol || ""}`}
      </Button>
      <p className="text-center text-[11px] text-slate-500">
        Simulated paper order. No real money is at risk.
      </p>
    </form>
  );
}
