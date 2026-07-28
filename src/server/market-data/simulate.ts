import { gaussian, mulberry32, seedFromString } from "@/server/market-data/random";
import { SESSION_MINUTES, tradingDays } from "@/server/market-data/calendar";

/** Clamps rare gaussian tail draws so simulated daily moves stay plausible. */
function clampedGaussian(rng: () => number, maxAbs = 2.5): number {
  const z = gaussian(rng);
  return Math.max(-maxAbs, Math.min(maxAbs, z));
}

export interface SimCandle {
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface InstrumentSimParams {
  basePrice: number;
  annualVolatility: number;
  annualDrift: number;
  baseDailyVolume: number;
}

/** Approximate real-world starting prices so the demo data looks plausible. */
const KNOWN_PARAMS: Record<string, Partial<InstrumentSimParams>> = {
  AAPL: { basePrice: 190, annualVolatility: 0.24, baseDailyVolume: 55_000_000 },
  MSFT: { basePrice: 410, annualVolatility: 0.22, baseDailyVolume: 22_000_000 },
  GOOGL: { basePrice: 165, annualVolatility: 0.26, baseDailyVolume: 28_000_000 },
  AMZN: { basePrice: 178, annualVolatility: 0.28, baseDailyVolume: 35_000_000 },
  NVDA: { basePrice: 120, annualVolatility: 0.45, baseDailyVolume: 220_000_000 },
  META: { basePrice: 480, annualVolatility: 0.3, baseDailyVolume: 15_000_000 },
  TSLA: { basePrice: 245, annualVolatility: 0.5, baseDailyVolume: 95_000_000 },
  AMD: { basePrice: 160, annualVolatility: 0.42, baseDailyVolume: 55_000_000 },
  NFLX: { basePrice: 630, annualVolatility: 0.3, baseDailyVolume: 4_000_000 },
  JPM: { basePrice: 195, annualVolatility: 0.22, baseDailyVolume: 9_000_000 },
  BAC: { basePrice: 38, annualVolatility: 0.26, baseDailyVolume: 40_000_000 },
  XOM: { basePrice: 112, annualVolatility: 0.22, baseDailyVolume: 16_000_000 },
  DIS: { basePrice: 112, annualVolatility: 0.26, baseDailyVolume: 10_000_000 },
  INTC: { basePrice: 32, annualVolatility: 0.35, baseDailyVolume: 45_000_000 },
  CRM: { basePrice: 280, annualVolatility: 0.26, baseDailyVolume: 5_000_000 },
  SPY: { basePrice: 520, annualVolatility: 0.15, baseDailyVolume: 70_000_000 },
  QQQ: { basePrice: 440, annualVolatility: 0.18, baseDailyVolume: 40_000_000 },
  IWM: { basePrice: 200, annualVolatility: 0.2, baseDailyVolume: 25_000_000 },
};

export function instrumentSimParams(symbol: string): InstrumentSimParams {
  const rng = mulberry32(seedFromString(`${symbol}:params`));
  const known = KNOWN_PARAMS[symbol];
  return {
    basePrice: known?.basePrice ?? 10 + rng() * 200,
    annualVolatility: known?.annualVolatility ?? 0.25 + rng() * 0.25,
    annualDrift: known?.annualDrift ?? 0.05 + (rng() - 0.5) * 0.1,
    baseDailyVolume: known?.baseDailyVolume ?? Math.floor(1_000_000 + rng() * 10_000_000),
  };
}

const TRADING_DAYS_PER_YEAR = 252;

/**
 * Deterministically simulates one daily candle per trading day in [start, end]
 * via geometric Brownian motion seeded by the symbol, always walking forward
 * from a fixed epoch so the same symbol produces the same path regardless of
 * which window is requested.
 */
export function generateDailyCandles(symbol: string, epoch: Date, through: Date): SimCandle[] {
  const params = instrumentSimParams(symbol);
  const rng = mulberry32(seedFromString(`${symbol}:D1`));
  const candles: SimCandle[] = [];
  let prevClose = params.basePrice;

  for (const day of tradingDays(epoch, through)) {
    const dailyDrift = params.annualDrift / TRADING_DAYS_PER_YEAR;
    const dailyVol = params.annualVolatility / Math.sqrt(TRADING_DAYS_PER_YEAR);
    const shock = clampedGaussian(rng);
    const close = prevClose * Math.exp(dailyDrift - (dailyVol * dailyVol) / 2 + dailyVol * shock);
    const gapShock = clampedGaussian(rng) * dailyVol * 0.15;
    const open = prevClose * Math.exp(gapShock);
    const rangeFactor = Math.abs(clampedGaussian(rng)) * dailyVol * 0.3;
    const high = Math.max(open, close) * (1 + rangeFactor);
    const low = Math.min(open, close) * (1 - rangeFactor);
    const volumeNoise = Math.max(0.3, 1 + clampedGaussian(rng) * 0.35);
    const volume = Math.round(params.baseDailyVolume * volumeNoise);

    candles.push({ ts: day, open, high, low, close, volume });
    prevClose = close;
  }

  return candles;
}

/**
 * Simulates intraday bars for a single trading day as a Brownian bridge
 * between the day's open and close (taken from the already-generated daily
 * candle), so intraday and daily data stay visually consistent.
 */
export function generateIntradayCandlesForDay(
  symbol: string,
  timeframeMinutes: number,
  day: Date,
  dailyOpen: number,
  dailyClose: number,
  dailyVolume: number,
): SimCandle[] {
  const barCount = Math.max(1, Math.floor(SESSION_MINUTES / timeframeMinutes));
  const rng = mulberry32(
    seedFromString(`${symbol}:${timeframeMinutes}:${day.toISOString().slice(0, 10)}`),
  );
  const sigma = Math.abs(Math.log(dailyClose / dailyOpen)) + 0.01;
  const candles: SimCandle[] = [];
  let prevClose = dailyOpen;

  for (let i = 1; i <= barCount; i++) {
    const t = i / barCount;
    const bridgeMean = dailyOpen + (dailyClose - dailyOpen) * t;
    const bridgeNoise = Math.sqrt(Math.max(t * (1 - t), 0.001)) * sigma * dailyOpen;
    const close = i === barCount ? dailyClose : bridgeMean + clampedGaussian(rng) * bridgeNoise;
    const open = prevClose;
    const rangeFactor = Math.abs(clampedGaussian(rng)) * (sigma * 0.4 + 0.0005);
    const high = Math.max(open, close) * (1 + rangeFactor);
    const low = Math.min(open, close) * (1 - rangeFactor);
    const volumeNoise = Math.max(0.2, 1 + gaussian(rng) * 0.5);
    const volume = Math.round((dailyVolume / barCount) * volumeNoise);

    const minutesFromOpen = (i - 1) * timeframeMinutes;
    const ts = new Date(day);
    ts.setUTCMinutes(ts.getUTCMinutes() + 9 * 60 + 30 + minutesFromOpen);

    candles.push({ ts, open, high, low, close, volume });
    prevClose = close;
  }

  return candles;
}
