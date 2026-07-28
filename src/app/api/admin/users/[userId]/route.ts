import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminUser } from "@/server/auth/requireAdmin";
import { revokeAllSessionsForUser } from "@/server/auth/session";
import { recordAuditEvent } from "@/server/audit/log";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(["trader", "admin"]).optional(),
});

export async function PATCH(req: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const admin = await requireAdminUser();
  if (!admin) return jsonError(403, "forbidden", "Administrator access required.");

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { userId } = await context.params;
  if (userId === admin.id && parsed.data.isActive === false) {
    return jsonError(400, "cannot_deactivate_self", "You cannot deactivate your own account.");
  }

  const data: { isActive?: boolean; roleId?: string } = {};
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  if (parsed.data.role) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: parsed.data.role } });
    data.roleId = role.id;
  }

  const updated = await prisma.user.update({ where: { id: userId }, data, include: { role: true } });

  if (parsed.data.isActive === false) {
    await revokeAllSessionsForUser(userId, "deactivated_by_admin");
  }

  await recordAuditEvent({
    userId: admin.id,
    category: "admin",
    action: "user_updated",
    targetType: "user",
    targetId: userId,
    detail: parsed.data,
  });

  return jsonOk({ id: updated.id, isActive: updated.isActive, role: updated.role.key });
}
