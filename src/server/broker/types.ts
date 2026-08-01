export interface PlaceOrderInput {
  orderId: string; // local Order.id - used to derive a stable broker client order id
  accountId: string;
  instrumentId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  duration: "DAY" | "GTC";
  isExtendedHours: boolean;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  idempotencyKey: string;
}

/**
 * Broker adapter interface. A real (paper) broker such as Alpaca implements
 * this same shape so order placement, cancellation, and replacement call
 * sites never depend on a specific vendor's API. Unlike the simulated engine
 * (which fills synchronously against local matching logic), a real adapter's
 * submitOrder only ever *accepts* the order - fills are reconciled later by
 * polling/syncing the broker's own order status.
 */
export interface BrokerAdapter {
  readonly name: string;
  readonly isPaper: boolean;
  submitOrder(input: PlaceOrderInput): Promise<{ externalOrderId: string; status: string }>;
  cancelOrder(externalOrderId: string): Promise<void>;
}
