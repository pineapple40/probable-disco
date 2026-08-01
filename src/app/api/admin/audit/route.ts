import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminUser } from "@/server/auth/requireAdmin";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET(req: NextRequest) {
  const admin = await requireAdminUser();
  if (!admin) return jsonError(403, "forbidden", "Administrator access required.");

  const category = req.nextUrl.searchParams.get("category") ?? undefined;
  const events = await prisma.auditEvent.findMany({
    where: category ? { category } : {},
    include: { user: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return jsonOk(
    events.map((e) => ({
      id: e.id,
      userEmail: e.user?.email ?? null,
      category: e.category,
      action: e.action,
      targetType: e.targetType,
      targetId: e.targetId,
      detail: e.detail,
      ipAddress: e.ipAddress,
      createdAt: e.createdAt,
    })),
  );
}
