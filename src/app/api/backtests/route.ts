import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { runAndStoreBacktest } from "@/server/backtesting/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const createSchema = z.object({
  strategyId: z.string(),
  strategyVersionId: z.string(),
  symbols: z.array(z.string().min(1).max(10)).min(1).max(10),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  initialCapital: z.coerce.number().positive().default(100000),
  commissionPerTrade: z.coerce.number().min(0).default(0),
  slippageBps: z.coerce.number().min(0).max(500).default(5),
  spreadBps: z.coerce.number().min(0).max(500).default(2),
  maxPositions: z.coerce.number().int().min(1).max(10).default(3),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");
  const backtests = await prisma.backtest.findMany({
    where: { strategy: { userId: user.id } },
    include: { strategy: true },
    orderBy: { createdAt: "desc" },
  });
  return jsonOk(
    backtests.map((b) => ({
      id: b.id,
      strategyName: b.strategy.name,
      symbols: b.symbols,
      startDate: b.startDate,
      endDate: b.endDate,
      status: b.status,
      resultSummary: b.resultSummary,
      createdAt: b.createdAt,
    })),
  );
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  try {
    const backtest = await runAndStoreBacktest(user.id, {
      ...parsed.data,
      symbols: parsed.data.symbols.map((s) => s.toUpperCase()),
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
    });
    return jsonOk(backtest, 201);
  } catch (err) {
    return jsonError(400, "backtest_failed", err instanceof Error ? err.message : "Failed.");
  }
}
