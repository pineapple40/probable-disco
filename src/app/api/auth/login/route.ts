import type { NextRequest } from "next/server";
import { loginSchema } from "@/server/auth/schemas";
import { login, AuthError } from "@/server/auth/service";
import { setSessionCookie } from "@/server/auth/session";
import { checkFixedWindowRateLimit } from "@/server/auth/rateLimit";
import { getClientIp, getUserAgent } from "@/server/http/request";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rateLimit = await checkFixedWindowRateLimit(`login:${ip}`, 20, 5 * 60);
  if (!rateLimit.allowed) {
    return jsonError(429, "rate_limited", "Too many login attempts. Try again later.");
  }

  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  try {
    const { rawToken, user } = await login(parsed.data, {
      ipAddress: ip,
      userAgent: getUserAgent(req),
    });
    await setSessionCookie(rawToken);
    return jsonOk({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role.key,
      emailVerified: Boolean(user.emailVerifiedAt),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "mfa_required" ? 401 : 401;
      return jsonError(status, err.code, err.message);
    }
    throw err;
  }
}
