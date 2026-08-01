import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export function jsonOk<T>(data: T, init?: number): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export function jsonValidationError(error: ZodError): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "validation_error",
        message: "Request validation failed.",
        issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    },
    { status: 422 },
  );
}
