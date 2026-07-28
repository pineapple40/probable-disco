import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { placeOrderSchema } from "@/server/orders/schemas";
import { placeOrder, listOrders, OrderValidationError } from "@/server/orders/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

function serializeOrder(order: Awaited<ReturnType<typeof listOrders>>[number]) {
  return {
    id: order.id,
    symbol: order.instrument.symbol,
    side: order.side,
    type: order.type,
    duration: order.duration,
    quantity: Number(order.quantity),
    filledQuantity: Number(order.filledQuantity),
    limitPrice: order.limitPrice ? Number(order.limitPrice) : null,
    stopPrice: order.stopPrice ? Number(order.stopPrice) : null,
    stopLossPrice: order.stopLossPrice ? Number(order.stopLossPrice) : null,
    takeProfitPrice: order.takeProfitPrice ? Number(order.takeProfitPrice) : null,
    status: order.status,
    rejectReason: order.rejectReason,
    submittedAt: order.submittedAt.toISOString(),
    executions: order.executions.map((e) => ({
      quantity: Number(e.quantity),
      price: Number(e.price),
      executedAt: e.executedAt.toISOString(),
    })),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");
  const orders = await listOrders(user.id);
  return jsonOk(orders.map(serializeOrder));
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = placeOrderSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  try {
    const { order, riskDecision, replayed } = await placeOrder(user.id, parsed.data);
    return jsonOk(
      {
        order: {
          id: order.id,
          status: order.status,
          rejectReason: order.rejectReason,
          filledQuantity: Number(order.filledQuantity),
        },
        riskDecision,
        replayed,
      },
      order.status === "REJECTED" ? 200 : 201,
    );
  } catch (err) {
    if (err instanceof OrderValidationError) {
      return jsonError(400, "invalid_order", err.message);
    }
    throw err;
  }
}
