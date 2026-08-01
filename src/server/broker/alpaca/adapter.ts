import { env } from "@/lib/env";
import type { BrokerAdapter, PlaceOrderInput } from "@/server/broker/types";
import * as alpaca from "@/server/broker/alpaca/client";

const ORDER_TYPE_MAP = {
  MARKET: "market",
  LIMIT: "limit",
  STOP: "stop",
  STOP_LIMIT: "stop_limit",
} as const;

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function formatQty(quantity: number): string {
  return String(quantity);
}

/**
 * Routes order placement/cancellation to Alpaca's paper trading endpoint
 * (`env.ALPACA_PAPER_BASE_URL`). Never connects to Alpaca's live-trading
 * endpoint - the base URL is entirely operator/env configured, and this
 * class has no code path that could reach a non-paper URL.
 */
export class AlpacaBrokerAdapter implements BrokerAdapter {
  readonly name = "alpaca";
  readonly isPaper = true;

  async submitOrder(input: PlaceOrderInput): Promise<{ externalOrderId: string; status: string }> {
    const hasStopLoss = input.stopLossPrice !== undefined;
    const hasTakeProfit = input.takeProfitPrice !== undefined;

    const body: alpaca.CreateAlpacaOrderInput = {
      symbol: input.symbol,
      side: input.side === "BUY" ? "buy" : "sell",
      type: ORDER_TYPE_MAP[input.type],
      qty: formatQty(input.quantity),
      time_in_force: input.duration === "GTC" ? "gtc" : "day",
      // A stable id derived from our own order row, so a retried submission
      // (e.g. after a network blip) is recognized by Alpaca as the same
      // order rather than double-submitted.
      client_order_id: `pd-${input.orderId}`,
      extended_hours: input.isExtendedHours,
    };
    if (input.limitPrice !== undefined) body.limit_price = formatPrice(input.limitPrice);
    if (input.stopPrice !== undefined) body.stop_price = formatPrice(input.stopPrice);

    // Only a BUY entry can carry protective legs (mirrors the simulated
    // engine's createProtectiveOrders(), which only attaches brackets to buys).
    if (input.side === "BUY" && (hasStopLoss || hasTakeProfit)) {
      body.order_class = hasStopLoss && hasTakeProfit ? "bracket" : "oto";
      if (hasStopLoss) body.stop_loss = { stop_price: formatPrice(input.stopLossPrice!) };
      if (hasTakeProfit) body.take_profit = { limit_price: formatPrice(input.takeProfitPrice!) };
    }

    const order = await alpaca.createOrder(body);
    return { externalOrderId: order.id, status: order.status };
  }

  async cancelOrder(externalOrderId: string): Promise<void> {
    await alpaca.cancelOrder(externalOrderId);
  }
}

let cached: AlpacaBrokerAdapter | null = null;

export function getAlpacaBrokerAdapter(): AlpacaBrokerAdapter {
  if (!cached) cached = new AlpacaBrokerAdapter();
  return cached;
}

export function isAlpacaBrokerEnabled(): boolean {
  return env.BROKER_PROVIDER === "alpaca";
}
