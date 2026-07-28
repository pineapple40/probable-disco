import type { NextRequest } from "next/server";
import { registerSchema } from "@/server/auth/schemas";
import { registerUser, AuthError } from "@/server/auth/service";
import { checkFixedWindowRateLimit } from "@/server/auth/rateLimit";
import { getClientIp, getUserAgent } from "@/server/http/request";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rateLimit = await checkFixedWindowRateLimit(`register:${ip}`, 10, 60 * 60);
  if (!rateLimit.allowed) {
    return jsonError(429, "rate_limited", "Too many registration attempts. Try again later.");
  }

  const body = await req.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  try {
    const result = await registerUser(parsed.data, { ipAddress: ip, userAgent: getUserAgent(req) });
    return jsonOk(result, 201);
  } catch (err) {
    if (err instanceof AuthError) return jsonError(400, err.code, err.message);
    throw err;
  }
}
