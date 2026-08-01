export interface OhlcvBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Simple moving average. Returns null until `period` values are available. */
export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with an SMA of the first `period` values. */
export function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    const next = values[i]! * k + prev * (1 - k);
    out[i] = next;
    prev = next;
  }
  return out;
}

/** Session-cumulative VWAP (resets are the caller's responsibility per session). */
export function vwap(bars: OhlcvBar[]): number[] {
  const out: number[] = new Array(bars.length).fill(0);
  let cumPV = 0;
  let cumVol = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumPV += typicalPrice * bar.volume;
    cumVol += bar.volume;
    out[i] = cumVol > 0 ? cumPV / cumVol : typicalPrice;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFromAverages(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

function rsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: Array<number | null>;
  signal: Array<number | null>;
  histogram: Array<number | null>;
}

/** MACD(fast, slow, signal), defaulting to the standard 12/26/9. */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine: Array<number | null> = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f !== null && f !== undefined && s !== null && s !== undefined ? f - s : null;
  });

  const macdValuesOnly = macdLine.filter((v): v is number => v !== null);
  const signalOnValid = ema(macdValuesOnly, signalPeriod);

  const signal: Array<number | null> = new Array(closes.length).fill(null);
  const histogram: Array<number | null> = new Array(closes.length).fill(null);
  let validIdx = 0;
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] === null) continue;
    const sig = signalOnValid[validIdx] ?? null;
    signal[i] = sig;
    histogram[i] = sig !== null ? macdLine[i]! - sig : null;
    validIdx++;
  }

  return { macd: macdLine, signal, histogram };
}

export interface BollingerBandsResult {
  upper: Array<number | null>;
  middle: Array<number | null>;
  lower: Array<number | null>;
}

export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2,
): BollingerBandsResult {
  const middle = sma(closes, period);
  const upper: Array<number | null> = new Array(closes.length).fill(null);
  const lower: Array<number | null> = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    if (mean === null || mean === undefined) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      variance += (closes[j]! - mean) ** 2;
    }
    const stdDev = Math.sqrt(variance / period);
    upper[i] = mean + stdDevMultiplier * stdDev;
    lower[i] = mean - stdDevMultiplier * stdDev;
  }

  return { upper, middle, lower };
}

/** Average True Range (Wilder smoothing). */
export function atr(bars: OhlcvBar[], period = 14): Array<number | null> {
  const trueRanges: number[] = bars.map((bar, i) => {
    if (i === 0) return bar.high - bar.low;
    const prevClose = bars[i - 1]!.close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  });

  const out: Array<number | null> = new Array(bars.length).fill(null);
  if (bars.length < period) return out;

  let avg = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = avg;
  for (let i = period; i < bars.length; i++) {
    avg = (avg * (period - 1) + trueRanges[i]!) / period;
    out[i] = avg;
  }
  return out;
}
