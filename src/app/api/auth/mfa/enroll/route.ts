import { getCurrentUser } from "@/server/auth/session";
import { beginMfaEnrollment } from "@/server/auth/mfa";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const { secret, otpauthUrl, qrDataUrl } = await beginMfaEnrollment(user.id, user.email);
  return jsonOk({ secret, otpauthUrl, qrDataUrl });
}
