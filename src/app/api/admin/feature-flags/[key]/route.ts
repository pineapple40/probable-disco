import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminUser } from "@/server/auth/requireAdmin";
import { recordAuditEvent } from "@/server/audit/log";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const schema = z.object({ enabled: z.boolean() });

export async function PATCH(req: NextRequest, context: { params: Promise<{ key: string }> }) {
  const admin = await requireAdminUser();
  if (!admin) return jsonError(403, "forbidden", "Administrator access required.");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { key } = await context.params;

  if (key === "live_trading" && parsed.data.enabled) {
    return jsonError(
      403,
      "live_trading_requires_acknowledgement",
      "Live trading cannot be enabled from this toggle. It requires a separate secure server-side " +
        "configuration change and acknowledgement flow, which is not implemented in this release.",
    );
  }

  const flag = await prisma.featureFlag.update({ where: { key }, data: { enabled: parsed.data.enabled } });
  await recordAuditEvent({
    userId: admin.id,
    category: "admin",
    action: "feature_flag_updated",
    targetType: "feature_flag",
    targetId: key,
    detail: { enabled: parsed.data.enabled },
  });
  return jsonOk(flag);
}
