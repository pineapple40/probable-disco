import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { listWatchlists, createWatchlist } from "@/server/watchlists/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const createSchema = z.object({ name: z.string().min(1).max(80) });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");
  const watchlists = await listWatchlists(user.id);
  return jsonOk(
    watchlists.map((w) => ({
      id: w.id,
      name: w.name,
      symbols: w.symbols.map((s) => ({
        id: s.id,
        symbol: s.instrument.symbol,
        name: s.instrument.name,
        notes: s.notes,
        tags: s.tags,
        sortOrder: s.sortOrder,
      })),
    })),
  );
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const watchlist = await createWatchlist(user.id, parsed.data.name);
  return jsonOk({ id: watchlist.id, name: watchlist.name }, 201);
}
