import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { createStrategyVersion } from "@/server/strategy/service";
import { strategyDefinitionSchema } from "@/server/strategy/types";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

export async function POST(req: NextRequest, context: { params: Promise<{ strategyId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = strategyDefinitionSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { strategyId } = await context.params;
  try {
    const version = await createStrategyVersion(user.id, strategyId, parsed.data);
    return jsonOk(version, 201);
  } catch (err) {
    return jsonError(400, "version_failed", err instanceof Error ? err.message : "Failed.");
  }
}
