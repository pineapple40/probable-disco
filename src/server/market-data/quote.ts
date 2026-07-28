import "server-only";
import { getLatestDailyCandle } from "@/server/market-data/candles";
import { generateIntradayCandlesForDay } from "@/server/market-data/simulate";
import { getMarketSessionStatus, startOfUtcDay, SESSION_MINUTES } from "@/server/market-data/calendar";

export interface LiveQuote {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  prevClose: number;
  volume: number;
  changeAbs: number;
  changePct: number;
  sourceType: "SIMULATED";
  isStale: boolean;
  isMarketOpen: boolean;
  asOf: string;
}

const SPREAD_BPS = 3; // 0.03% simulated bid/ask spread

/**
 * Computes a deterministic "live" quote for right now, without persisting
 * per-tick data (only OHLCV candles are cached in Postgres - see
 * docs/ARCHITECTURE.md for the retention rationale).
 */
export async function getLiveQuote(instrumentId: string, symbol: string): Promise<LiveQuote> {
  const now = new Date();
  const session = getMarketSessionStatus(now);
  const today = startOfUtcDay(now);

  const todayCandle = await getLatestDailyCandle(instrumentId, symbol, now);
  if (!todayCandle) {
    throw new Error(`No simulated data available for ${symbol}`);
  }

  const isTodayCandle = todayCandle.ts.getTime() === today.getTime();
  const prevCloseCandle = isTodayCandle
    ? await getLatestDailyCandle(instrumentId, symbol, new Date(today.getTime() - 1))
    : null;
  const prevClose = Number(prevCloseCandle?.close ?? todayCandle.open);

  let last: number;
  let dayOpen: number;
  let dayHigh: number;
  let dayLow: number;
  let volume: number;

  if (isTodayCandle && session.isTradingDay) {
    const minutesElapsed = Math.min(
      Math.max(session.minutesSinceOpen, 0),
      SESSION_MINUTES,
    );
    const barsSoFar = generateIntradayCandlesForDay(
      symbol,
      1,
      today,
      Number(todayCandle.open),
      Number(todayCandle.close),
      Number(todayCandle.volume),
    ).slice(0, Math.max(1, minutesElapsed));

    const lastBar = barsSoFar[barsSoFar.length - 1]!;
    last = session.isRegularSessionOpen ? lastBar.close : Number(todayCandle.close);
    dayOpen = Number(todayCandle.open);
    // Use the daily candle's own (already-calibrated) high/low rather than
    // the max/min across many independently-noised 1-minute bars, which
    // would otherwise skew wide via order-statistics of the per-bar noise.
    dayHigh = Math.max(Number(todayCandle.high), last, dayOpen);
    dayLow = Math.min(Number(todayCandle.low), last, dayOpen);
    volume = barsSoFar.reduce((sum, b) => sum + b.volume, 0);
  } else {
    last = Number(todayCandle.close);
    dayOpen = Number(todayCandle.open);
    dayHigh = Number(todayCandle.high);
    dayLow = Number(todayCandle.low);
    volume = Number(todayCandle.volume);
  }

  const spread = last * (SPREAD_BPS / 10_000);
  const changeAbs = last - prevClose;

  return {
    symbol,
    bid: round4(last - spread / 2),
    ask: round4(last + spread / 2),
    last: round4(last),
    dayOpen: round4(dayOpen),
    dayHigh: round4(dayHigh),
    dayLow: round4(dayLow),
    prevClose: round4(prevClose),
    volume,
    changeAbs: round4(changeAbs),
    changePct: prevClose > 0 ? round4((changeAbs / prevClose) * 100) : 0,
    sourceType: "SIMULATED",
    isStale: !session.isRegularSessionOpen,
    isMarketOpen: session.isRegularSessionOpen,
    asOf: now.toISOString(),
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
