import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export type AuditCategory =
  | "auth"
  | "order"
  | "strategy"
  | "admin"
  | "security"
  | "data"
  | "risk"
  | "provider";

export interface AuditInput {
  userId?: string | null;
  category: AuditCategory;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Records an audit event. Failures here are logged but never thrown - an
 * audit-log outage must not block the underlying operation from completing.
 */
export async function recordAuditEvent(input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        userId: input.userId ?? null,
        category: input.category,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        detail: input.detail as never,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, audit: input }, "Failed to record audit event");
  }
}
