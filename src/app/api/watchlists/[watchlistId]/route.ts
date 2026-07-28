import { getCurrentUser } from "@/server/auth/session";
import { deleteWatchlist } from "@/server/watchlists/service";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function DELETE(_req: Request, context: { params: Promise<{ watchlistId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const { watchlistId } = await context.params;
  try {
    await deleteWatchlist(user.id, watchlistId);
    return jsonOk({ deleted: true });
  } catch (err) {
    return jsonError(404, "not_found", err instanceof Error ? err.message : "Not found.");
  }
}
