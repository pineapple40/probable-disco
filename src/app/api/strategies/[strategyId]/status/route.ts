import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { setStrategyStatus } from "@/server/strategy/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const schema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]) });

export async function POST(req: NextRequest, context: { params: Promise<{ strategyId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { strategyId } = await context.params;
  try {
    const strategy = await setStrategyStatus(user.id, strategyId, parsed.data.status);
    return jsonOk(strategy);
  } catch (err) {
    return jsonError(400, "status_change_failed", err instanceof Error ? err.message : "Failed.");
  }
}
