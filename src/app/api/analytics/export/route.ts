import { getCurrentUser } from "@/server/auth/session";
import { getPerformanceReport, tradesToCsv } from "@/server/analytics/service";
import { recordAuditEvent } from "@/server/audit/log";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const report = await getPerformanceReport(user.id, {});
  const csv = tradesToCsv(report.trades);
  await recordAuditEvent({ userId: user.id, category: "data", action: "analytics_export" });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": "attachment; filename=trade-history.csv",
    },
  });
}
