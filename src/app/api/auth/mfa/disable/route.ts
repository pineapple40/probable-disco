import { getCurrentUser } from "@/server/auth/session";
import { disableMfa } from "@/server/auth/mfa";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  await disableMfa(user.id);
  return jsonOk({ disabled: true });
}
