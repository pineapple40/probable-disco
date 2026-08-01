import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { recomputeAccountEquity } from "@/server/portfolio/accounting";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const account = await prisma.account.findFirst({
    where: { userId: user.id },
    include: { brokerConnection: true },
  });
  if (!account) return jsonError(404, "not_found", "No account found.");

  const { equity, unrealizedPnl } = await recomputeAccountEquity(account.id);

  const [emergencyLock, todayRealized] = await Promise.all([
    prisma.emergencyTradingLock.findUnique({ where: { accountId: account.id } }),
    prisma.position.aggregate({
      where: {
        accountId: account.id,
        closedAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) },
      },
      _sum: { realizedPnl: true },
    }),
  ]);

  return jsonOk({
    id: account.id,
    label: account.label,
    currency: account.currency,
    cash: Number(account.cash),
    equity,
    buyingPower: Number(account.buyingPower),
    isPaper: account.isPaper,
    broker: { provider: account.brokerConnection.provider, isPaper: account.brokerConnection.isPaper },
    dailyRealizedPnl: Number(todayRealized._sum.realizedPnl ?? 0),
    dailyUnrealizedPnl: unrealizedPnl,
    isTradingLocked: emergencyLock?.isLocked ?? false,
    tradingLockReason: emergencyLock?.reason ?? null,
  });
}
