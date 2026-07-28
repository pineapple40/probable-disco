export interface PlaceOrderInput {
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
 * sites never depend on a specific vendor's API.
 */
export interface BrokerAdapter {
  readonly name: string;
  readonly isPaper: boolean;
  submitOrder(input: PlaceOrderInput): Promise<{ orderId: string }>;
  cancelOrder(orderId: string): Promise<void>;
}
