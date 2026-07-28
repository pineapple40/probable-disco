import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const runs = await prisma.strategyRun.findMany({
    where: { strategy: { userId: user.id } },
    include: {
      strategy: true,
      logs: { orderBy: { createdAt: "desc" }, take: 10 },
    },
    orderBy: { startedAt: "desc" },
  });

  return jsonOk(
    runs.map((r) => ({
      id: r.id,
      strategyName: r.strategy.name,
      status: r.status,
      state: r.state,
      lastHeartbeatAt: r.lastHeartbeatAt,
      startedAt: r.startedAt,
      stoppedAt: r.stoppedAt,
      logs: r.logs.map((l) => ({ level: l.level, message: l.message, createdAt: l.createdAt })),
    })),
  );
}
