import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { listAlerts, createAlert } from "@/server/alerts/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  conditionType: z.enum(["price_above", "price_below", "pct_change_above", "pct_change_below", "volume_above"]),
  symbol: z.string().min(1).max(10),
  value: z.coerce.number(),
  cooldownMinutes: z.coerce.number().int().min(1).max(1440).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");
  return jsonOk(await listAlerts(user.id));
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const alert = await createAlert(user.id, parsed.data);
  return jsonOk(alert, 201);
}
