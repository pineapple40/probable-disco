import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET(_req: Request, context: { params: Promise<{ backtestId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const { backtestId } = await context.params;
  const backtest = await prisma.backtest.findUnique({
    where: { id: backtestId },
    include: { trades: { orderBy: { entryAt: "asc" } }, strategy: true },
  });
  if (!backtest || backtest.strategy.userId !== user.id) {
    return jsonError(404, "not_found", "Backtest not found.");
  }

  return jsonOk({
    id: backtest.id,
    strategyName: backtest.strategy.name,
    symbols: backtest.symbols,
    startDate: backtest.startDate,
    endDate: backtest.endDate,
    initialCapital: Number(backtest.initialCapital),
    status: backtest.status,
    errorMessage: backtest.errorMessage,
    resultSummary: backtest.resultSummary,
    trades: backtest.trades.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      quantity: Number(t.quantity),
      entryPrice: Number(t.entryPrice),
      exitPrice: Number(t.exitPrice),
      entryAt: t.entryAt,
      exitAt: t.exitAt,
      pnl: Number(t.pnl),
      commission: Number(t.commission),
      reason: t.reason,
    })),
  });
}
