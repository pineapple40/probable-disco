import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";

export async function GET(req: NextRequest, context: { params: Promise<{ backtestId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { backtestId } = await context.params;
  const backtest = await prisma.backtest.findUnique({
    where: { id: backtestId },
    include: { trades: { orderBy: { entryAt: "asc" } }, strategy: true },
  });
  if (!backtest || backtest.strategy.userId !== user.id) {
    return new Response("Not found", { status: 404 });
  }

  const format = req.nextUrl.searchParams.get("format") ?? "csv";

  if (format === "json") {
    return Response.json({
      resultSummary: backtest.resultSummary,
      trades: backtest.trades,
    });
  }

  const header = "symbol,side,quantity,entryPrice,exitPrice,entryAt,exitAt,pnl,commission,reason";
  const rows = backtest.trades.map((t) =>
    [
      t.symbol,
      t.side,
      Number(t.quantity),
      Number(t.entryPrice).toFixed(4),
      Number(t.exitPrice).toFixed(4),
      t.entryAt.toISOString(),
      t.exitAt.toISOString(),
      Number(t.pnl).toFixed(4),
      Number(t.commission).toFixed(4),
      t.reason,
    ].join(","),
  );
  const csv = [header, ...rows].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename=backtest-${backtestId}.csv`,
    },
  });
}
