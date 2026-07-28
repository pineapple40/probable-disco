import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, revokeSessionByToken, clearSessionCookie } from "@/server/auth/session";
import { recordAuditEvent } from "@/server/audit/log";
import { getCurrentUser } from "@/server/auth/session";
import { jsonOk } from "@/server/http/respond";

export async function POST() {
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value;
  const user = await getCurrentUser();
  if (rawToken) {
    await revokeSessionByToken(rawToken, "user_logout");
  }
  await clearSessionCookie();
  if (user) {
    await recordAuditEvent({ userId: user.id, category: "auth", action: "logout" });
  }
  return jsonOk({ loggedOut: true });
}
