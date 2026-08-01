import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { addSymbolToWatchlist } from "@/server/watchlists/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const addSchema = z.object({ symbol: z.string().min(1).max(10) });

export async function POST(req: NextRequest, context: { params: Promise<{ watchlistId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { watchlistId } = await context.params;
  try {
    const entry = await addSymbolToWatchlist(user.id, watchlistId, parsed.data.symbol);
    return jsonOk({ id: entry.id }, 201);
  } catch (err) {
    return jsonError(400, "add_symbol_failed", err instanceof Error ? err.message : "Failed to add symbol.");
  }
}
