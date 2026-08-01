import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { deleteAlert, setAlertActive } from "@/server/alerts/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const patchSchema = z.object({ isActive: z.boolean() });

export async function PATCH(req: NextRequest, context: { params: Promise<{ alertId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { alertId } = await context.params;
  try {
    const alert = await setAlertActive(user.id, alertId, parsed.data.isActive);
    return jsonOk(alert);
  } catch (err) {
    return jsonError(404, "not_found", err instanceof Error ? err.message : "Not found.");
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ alertId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const { alertId } = await context.params;
  try {
    await deleteAlert(user.id, alertId);
    return jsonOk({ deleted: true });
  } catch (err) {
    return jsonError(404, "not_found", err instanceof Error ? err.message : "Not found.");
  }
}
