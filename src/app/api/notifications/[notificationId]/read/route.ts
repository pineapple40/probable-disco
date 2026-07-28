import { getCurrentUser } from "@/server/auth/session";
import { markNotificationRead } from "@/server/alerts/service";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function POST(_req: Request, context: { params: Promise<{ notificationId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const { notificationId } = await context.params;
  try {
    const notification = await markNotificationRead(user.id, notificationId);
    return jsonOk(notification);
  } catch (err) {
    return jsonError(404, "not_found", err instanceof Error ? err.message : "Not found.");
  }
}
