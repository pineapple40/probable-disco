import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { recordAuditEvent } from "@/server/audit/log";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function POST(_req: Request, context: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const { runId } = await context.params;
  const run = await prisma.strategyRun.findUnique({ where: { id: runId }, include: { strategy: true } });
  if (!run || run.strategy.userId !== user.id) {
    return jsonError(404, "not_found", "Strategy run not found.");
  }

  await prisma.strategyRun.update({
    where: { id: runId },
    data: { status: "stopped", stoppedAt: new Date() },
  });
  await prisma.strategy.update({ where: { id: run.strategyId }, data: { status: "PAUSED" } });
  await recordAuditEvent({
    userId: user.id,
    category: "strategy",
    action: "strategy_run_killed",
    targetId: runId,
  });

  return jsonOk({ stopped: true });
}
