import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { getMarketDataProvider } from "@/server/market-data/provider";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const symbol = req.nextUrl.searchParams.get("symbol")?.toUpperCase();
  if (!symbol) return jsonError(400, "missing_symbol", "symbol query parameter is required.");

  const instrument = await prisma.instrument.findUnique({ where: { symbol } });
  if (!instrument) return jsonError(404, "not_found", `Unknown symbol ${symbol}.`);

  const quote = await getMarketDataProvider().getQuote(instrument.id, instrument.symbol);
  return jsonOk(quote);
}
