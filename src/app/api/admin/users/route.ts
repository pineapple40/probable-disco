import { prisma } from "@/lib/db";
import { requireAdminUser } from "@/server/auth/requireAdmin";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET() {
  const admin = await requireAdminUser();
  if (!admin) return jsonError(403, "forbidden", "Administrator access required.");

  const users = await prisma.user.findMany({
    include: { role: true },
    orderBy: { createdAt: "asc" },
  });

  return jsonOk(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: u.role.key,
      isActive: u.isActive,
      emailVerifiedAt: u.emailVerifiedAt,
      failedLoginCount: u.failedLoginCount,
      lockedUntil: u.lockedUntil,
      createdAt: u.createdAt,
    })),
  );
}
