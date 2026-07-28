import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { runScan } from "@/server/scanner/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const querySchema = z.object({
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  minChangePct: z.coerce.number().optional(),
  maxChangePct: z.coerce.number().optional(),
  minVolume: z.coerce.number().optional(),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return jsonValidationError(parsed.error);

  const rows = await runScan(parsed.data);
  return jsonOk(rows);
}
