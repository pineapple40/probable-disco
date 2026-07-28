import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { listNotifications } from "@/server/alerts/service";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");
  const unreadOnly = req.nextUrl.searchParams.get("unread") === "true";
  return jsonOk(await listNotifications(user.id, unreadOnly));
}
