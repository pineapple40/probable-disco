import { prisma } from "@/lib/db";
import { redis } from "@/lib/redis";
import { jsonError, jsonOk } from "@/server/http/respond";

/** Readiness check: verifies the database and Redis are actually reachable. */
export async function GET() {
  const checks: Record<string, "ok" | "error"> = { database: "ok", redis: "ok" };

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    checks.database = "error";
  }

  try {
    await redis.ping();
  } catch {
    checks.redis = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  if (!allOk) return jsonError(503, "not_ready", "One or more dependencies are unavailable.");
  return jsonOk({ status: "ready", checks });
}
