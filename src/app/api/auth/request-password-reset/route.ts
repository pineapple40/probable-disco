import type { NextRequest } from "next/server";
import { requestPasswordResetSchema } from "@/server/auth/schemas";
import { requestPasswordReset } from "@/server/auth/service";
import { checkFixedWindowRateLimit } from "@/server/auth/rateLimit";
import { getClientIp, getUserAgent } from "@/server/http/request";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rateLimit = await checkFixedWindowRateLimit(`pwreset:${ip}`, 10, 60 * 60);
  if (!rateLimit.allowed) {
    return jsonError(429, "rate_limited", "Too many requests. Try again later.");
  }

  const body = await req.json().catch(() => null);
  const parsed = requestPasswordResetSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  await requestPasswordReset(parsed.data.email, { ipAddress: ip, userAgent: getUserAgent(req) });
  // Always return success to avoid revealing whether the email exists.
  return jsonOk({ requested: true });
}
