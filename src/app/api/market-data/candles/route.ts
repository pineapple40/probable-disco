import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { getMarketDataProvider } from "@/server/market-data/provider";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const querySchema = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase()),
  timeframe: z.enum(["M1", "M5", "M15", "H1", "D1"]).default("D1"),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { symbol, timeframe } = parsed.data;
  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const defaultLookbackDays = timeframe === "D1" ? 365 : 5;
  const from = parsed.data.from
    ? new Date(parsed.data.from)
    : new Date(to.getTime() - defaultLookbackDays * 24 * 60 * 60 * 1000);

  const instrument = await prisma.instrument.findUnique({ where: { symbol } });
  if (!instrument) return jsonError(404, "not_found", `Unknown symbol ${symbol}.`);

  const candles = await getMarketDataProvider().getCandles(
    instrument.id,
    instrument.symbol,
    timeframe,
    from,
    to,
  );

  return jsonOk({
    symbol: instrument.symbol,
    timeframe,
    sourceType: "SIMULATED",
    candles: candles.map((c) => ({
      ts: c.ts.toISOString(),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: c.volume.toString(),
    })),
  });
}
