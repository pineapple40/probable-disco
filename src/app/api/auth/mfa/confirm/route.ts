import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { confirmMfaEnrollment } from "@/server/auth/mfa";
import { verifyMfaSchema } from "@/server/auth/schemas";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = verifyMfaSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  try {
    const { recoveryCodes } = await confirmMfaEnrollment(user.id, parsed.data.code);
    return jsonOk({ enabled: true, recoveryCodes });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enable MFA.";
    return jsonError(400, "mfa_confirm_failed", message);
  }
}
