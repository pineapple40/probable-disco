import type { NextRequest } from "next/server";
import { resetPasswordSchema } from "@/server/auth/schemas";
import { resetPassword, AuthError } from "@/server/auth/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  try {
    await resetPassword(parsed.data.token, parsed.data.password);
    return jsonOk({ reset: true });
  } catch (err) {
    if (err instanceof AuthError) return jsonError(400, err.code, err.message);
    throw err;
  }
}
