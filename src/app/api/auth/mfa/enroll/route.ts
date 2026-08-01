import { getCurrentUser } from "@/server/auth/session";
import { beginMfaEnrollment, MfaAlreadyEnabledError } from "@/server/auth/mfa";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  try {
    const { secret, otpauthUrl, qrDataUrl } = await beginMfaEnrollment(user.id, user.email);
    return jsonOk({ secret, otpauthUrl, qrDataUrl });
  } catch (err) {
    if (err instanceof MfaAlreadyEnabledError) {
      return jsonError(409, "mfa_already_enabled", err.message);
    }
    throw err;
  }
}
