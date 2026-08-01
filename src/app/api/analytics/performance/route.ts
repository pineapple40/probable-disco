import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getPerformanceReport } from "@/server/analytics/service";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const report = await getPerformanceReport(user.id, {
    from: fromParam ? new Date(fromParam) : undefined,
    to: toParam ? new Date(toParam) : undefined,
  });
  return jsonOk(report);
}
