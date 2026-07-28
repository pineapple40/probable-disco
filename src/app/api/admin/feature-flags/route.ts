import { prisma } from "@/lib/db";
import { requireAdminUser } from "@/server/auth/requireAdmin";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET() {
  const admin = await requireAdminUser();
  if (!admin) return jsonError(403, "forbidden", "Administrator access required.");
  const flags = await prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  return jsonOk(flags);
}
