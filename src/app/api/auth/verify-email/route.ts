import type { NextRequest } from "next/server";
import { verifyEmailSchema } from "@/server/auth/schemas";
import { verifyEmail, AuthError } from "@/server/auth/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  try {
    await verifyEmail(parsed.data.token);
    return jsonOk({ verified: true });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(400, err.code, err.message);
    throw err;
  }
}
