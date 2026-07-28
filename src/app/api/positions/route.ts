import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { getMarketDataProvider } from "@/server/market-data/provider";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const account = await prisma.account.findFirst({ where: { userId: user.id } });
  if (!account) return jsonOk([]);

  const positions = await prisma.position.findMany({
    where: { accountId: account.id, quantity: { gt: 0 } },
    include: { instrument: true },
    orderBy: { openedAt: "desc" },
  });

  const provider = getMarketDataProvider();
  const data = await Promise.all(
    positions.map(async (p) => {
      const quote = await provider.getQuote(p.instrumentId, p.instrument.symbol);
      const quantity = Number(p.quantity);
      const avgEntryPrice = Number(p.avgEntryPrice);
      const marketValue = quantity * quote.last;
      const unrealizedPnl = (quote.last - avgEntryPrice) * quantity;
      return {
        id: p.id,
        symbol: p.instrument.symbol,
        side: p.side,
        quantity,
        avgEntryPrice,
        realizedPnl: Number(p.realizedPnl),
        lastPrice: quote.last,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPct: avgEntryPrice > 0 ? (unrealizedPnl / (avgEntryPrice * quantity)) * 100 : 0,
        openedAt: p.openedAt.toISOString(),
      };
    }),
  );

  return jsonOk(data);
}
