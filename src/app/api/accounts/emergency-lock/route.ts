import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { recordAuditEvent } from "@/server/audit/log";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const schema = z.object({ locked: z.boolean(), reason: z.string().max(500).optional() });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const account = await prisma.account.findFirst({ where: { userId: user.id } });
  if (!account) return jsonError(404, "not_found", "No account found.");

  const lock = await prisma.emergencyTradingLock.upsert({
    where: { accountId: account.id },
    update: {
      isLocked: parsed.data.locked,
      reason: parsed.data.locked ? (parsed.data.reason ?? "Manually locked by user") : null,
      lockedAt: parsed.data.locked ? new Date() : null,
      lockedBy: parsed.data.locked ? user.id : null,
    },
    create: {
      userId: user.id,
      accountId: account.id,
      isLocked: parsed.data.locked,
      reason: parsed.data.locked ? (parsed.data.reason ?? "Manually locked by user") : null,
      lockedAt: parsed.data.locked ? new Date() : null,
      lockedBy: parsed.data.locked ? user.id : null,
    },
  });

  await recordAuditEvent({
    userId: user.id,
    category: "risk",
    action: parsed.data.locked ? "emergency_lock_engaged" : "emergency_lock_released",
    targetType: "account",
    targetId: account.id,
  });

  return jsonOk({ isLocked: lock.isLocked, reason: lock.reason });
}
