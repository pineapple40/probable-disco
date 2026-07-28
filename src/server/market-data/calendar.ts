/**
 * Simplified US equity trading calendar: Monday-Friday, 09:30-16:00 America/New_York.
 * Market holidays are NOT modeled in this v1 - every weekday is treated as a
 * trading day. This is a documented limitation (see PROJECT_STATUS.md).
 */

export const SESSION_START_MINUTES = 9 * 60 + 30; // 09:30
export const SESSION_END_MINUTES = 16 * 60; // 16:00
export const SESSION_MINUTES = SESSION_END_MINUTES - SESSION_START_MINUTES; // 390

export function isTradingDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/** Yields every trading-day 00:00 UTC timestamp in [start, end] inclusive. */
export function* tradingDays(start: Date, end: Date): Generator<Date> {
  let cursor = startOfUtcDay(start);
  const last = startOfUtcDay(end);
  while (cursor.getTime() <= last.getTime()) {
    if (isTradingDay(cursor)) yield new Date(cursor);
    cursor = addUtcDays(cursor, 1);
  }
}

export interface EasternTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
  dateKey: string; // YYYY-MM-DD in America/New_York
}

const ET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  weekday: "short",
});

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Uses Intl's IANA tz database so US daylight-saving transitions are handled correctly. */
export function getEasternTimeParts(date: Date): EasternTimeParts {
  const parts = ET_FORMATTER.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(get("minute"));
  const weekday = WEEKDAY_INDEX[get("weekday")] ?? 0;
  const dateKey = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  return { year, month, day, hour, minute, weekday, dateKey };
}

export interface MarketSessionStatus {
  isRegularSessionOpen: boolean;
  isTradingDay: boolean;
  minutesSinceOpen: number;
  dateKey: string;
}

export function getMarketSessionStatus(date: Date): MarketSessionStatus {
  const et = getEasternTimeParts(date);
  const isTradingDayEt = et.weekday !== 0 && et.weekday !== 6;
  const minutesOfDay = et.hour * 60 + et.minute;
  const minutesSinceOpen = minutesOfDay - SESSION_START_MINUTES;
  const isRegularSessionOpen =
    isTradingDayEt && minutesOfDay >= SESSION_START_MINUTES && minutesOfDay < SESSION_END_MINUTES;
  return {
    isRegularSessionOpen,
    isTradingDay: isTradingDayEt,
    minutesSinceOpen,
    dateKey: et.dateKey,
  };
}

export const TIMEFRAME_MINUTES: Record<string, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  H1: 60,
  D1: SESSION_MINUTES,
};
