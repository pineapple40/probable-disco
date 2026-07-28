import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { listStrategies, createStrategy } from "@/server/strategy/service";
import { strategyDefinitionSchema } from "@/server/strategy/types";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  definition: strategyDefinitionSchema,
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");
  const strategies = await listStrategies(user.id);
  return jsonOk(strategies);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const strategy = await createStrategy(user.id, parsed.data.name, parsed.data.description, parsed.data.definition);
  return jsonOk(strategy, 201);
}
