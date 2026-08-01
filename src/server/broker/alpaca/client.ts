import { env } from "@/lib/env";

/**
 * Thin, typed wrapper around Alpaca's Trading API (order placement/
 * cancellation, scoped to the paper base URL) and Market Data API (quotes/
 * bars). Never logs or embeds the API key/secret in thrown errors - only the
 * response body/status, which Alpaca does not echo credentials back in.
 */
export class AlpacaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Alpaca API error ${status}: ${body}`);
  }
}

export interface AlpacaOrderLeg {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  status: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price: string | null;
  stop_price: string | null;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  status: string;
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  legs: AlpacaOrderLeg[] | null;
}

export interface AlpacaQuote {
  symbol: string;
  quote: {
    ap: number; // ask price
    as: number; // ask size
    bp: number; // bid price
    bs: number; // bid size
    t: string; // timestamp
  };
}

export interface AlpacaTrade {
  symbol: string;
  trade: {
    p: number; // price
    s: number; // size
    t: string;
  };
}

export interface AlpacaBar {
  t: string; // RFC3339 timestamp
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface CreateAlpacaOrderInput {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop" | "stop_limit";
  qty: string;
  time_in_force: "day" | "gtc";
  limit_price?: string;
  stop_price?: string;
  extended_hours?: boolean;
  client_order_id: string;
  order_class?: "simple" | "bracket" | "oto";
  take_profit?: { limit_price: string };
  stop_loss?: { stop_price: string };
}

async function alpacaFetch<T>(baseUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": env.ALPACA_API_KEY,
      "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AlpacaApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function tradingFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return alpacaFetch<T>(env.ALPACA_PAPER_BASE_URL, path, init);
}

function dataFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return alpacaFetch<T>(env.ALPACA_DATA_BASE_URL, path, init);
}

export function createOrder(input: CreateAlpacaOrderInput): Promise<AlpacaOrder> {
  return tradingFetch<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getOrder(alpacaOrderId: string): Promise<AlpacaOrder> {
  return tradingFetch<AlpacaOrder>(`/v2/orders/${encodeURIComponent(alpacaOrderId)}?nested=true`);
}

export async function cancelOrder(alpacaOrderId: string): Promise<void> {
  await tradingFetch<void>(`/v2/orders/${encodeURIComponent(alpacaOrderId)}`, { method: "DELETE" });
}

export function getLatestQuote(symbol: string): Promise<AlpacaQuote> {
  return dataFetch<AlpacaQuote>(`/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`);
}

export function getLatestTrade(symbol: string): Promise<AlpacaTrade> {
  return dataFetch<AlpacaTrade>(`/v2/stocks/${encodeURIComponent(symbol)}/trades/latest`);
}

export async function getBars(
  symbol: string,
  timeframe: string,
  start: Date,
  end: Date,
): Promise<AlpacaBar[]> {
  const params = new URLSearchParams({
    timeframe,
    start: start.toISOString(),
    end: end.toISOString(),
    limit: "10000",
    adjustment: "raw",
  });
  const bars: AlpacaBar[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) params.set("page_token", pageToken);
    const res = await dataFetch<{ bars: AlpacaBar[]; next_page_token: string | null }>(
      `/v2/stocks/${encodeURIComponent(symbol)}/bars?${params.toString()}`,
    );
    bars.push(...res.bars);
    pageToken = res.next_page_token ?? undefined;
  } while (pageToken);
  return bars;
}
