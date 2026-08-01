import { getCurrentUser } from "@/server/auth/session";
import { cancelOrder, OrderValidationError } from "@/server/orders/service";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function POST(_req: Request, context: { params: Promise<{ orderId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const { orderId } = await context.params;
  try {
    const order = await cancelOrder(user.id, orderId);
    return jsonOk({ id: order.id, status: order.status });
  } catch (err) {
    if (err instanceof OrderValidationError) return jsonError(404, "not_found", err.message);
    const message = err instanceof Error ? err.message : "Failed to cancel order.";
    return jsonError(400, "cancel_failed", message);
  }
}
