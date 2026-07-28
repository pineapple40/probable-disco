import { prisma } from "@/lib/db";
import type { PlaceOrderRequest } from "@/server/orders/schemas";
import { buildRiskCheckContext } from "@/server/risk/context";
import { evaluateOrderRisk } from "@/server/risk/engine";
import { attemptImmediateFill, cancelOrder as cancelOrderInBroker } from "@/server/broker/simulated";
import { recordAuditEvent } from "@/server/audit/log";

export class OrderValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

async function getPrimaryAccount(userId: string) {
  const account = await prisma.account.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (!account) throw new OrderValidationError("No trading account found for this user.");
  return account;
}

export async function placeOrder(userId: string, input: PlaceOrderRequest) {
  const existing = await prisma.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { executions: true, events: true },
  });
  if (existing) return { order: existing, replayed: true, riskDecision: null };

  const account = await getPrimaryAccount(userId);
  const instrument = await prisma.instrument.findUnique({ where: { symbol: input.symbol.toUpperCase() } });
  if (!instrument || !instrument.isTradable) {
    throw new OrderValidationError(`${input.symbol} is not a tradable instrument.`);
  }
  if (!instrument.isFractionable && !Number.isInteger(input.quantity)) {
    throw new OrderValidationError(`${input.symbol} does not support fractional quantities.`);
  }

  const ctx = await buildRiskCheckContext(account.id, instrument.id, instrument.symbol);
  const decision = evaluateOrderRisk(
    {
      side: input.side,
      type: input.type,
      quantity: input.quantity,
      limitPrice: input.limitPrice,
      stopPrice: input.stopPrice,
      stopLossPrice: input.stopLossPrice,
      takeProfitPrice: input.takeProfitPrice,
      isExtendedHours: input.isExtendedHours,
    },
    ctx,
  );

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        accountId: account.id,
        instrumentId: instrument.id,
        side: input.side,
        type: input.type,
        duration: input.duration,
        quantity: input.quantity,
        limitPrice: input.limitPrice,
        stopPrice: input.stopPrice,
        stopLossPrice: input.stopLossPrice,
        takeProfitPrice: input.takeProfitPrice,
        isExtendedHours: input.isExtendedHours,
        idempotencyKey: input.idempotencyKey,
        status: decision.allowed ? "PENDING_NEW" : "REJECTED",
        rejectReason: decision.allowed ? null : decision.message,
      },
    });

    await tx.riskEvent.create({
      data: {
        userId,
        orderId: created.id,
        ruleKey: decision.ruleKey,
        decision: decision.allowed ? "allowed" : "rejected",
        detail: {
          message: decision.message,
          warnings: decision.warnings,
          estimatedEntryPrice: decision.estimatedEntryPrice,
          estimatedNotional: decision.estimatedNotional,
        } as never,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId: created.id,
        type: decision.allowed ? "submitted" : "rejected",
        detail: { ruleKey: decision.ruleKey, message: decision.message } as never,
      },
    });

    return created;
  });

  await recordAuditEvent({
    userId,
    category: "order",
    action: decision.allowed ? "order_submitted" : "order_rejected",
    targetType: "order",
    targetId: order.id,
    detail: { symbol: instrument.symbol, ruleKey: decision.ruleKey },
  });

  if (decision.allowed) {
    await attemptImmediateFill(order.id);
  }

  const final = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    include: { executions: true, events: { orderBy: { createdAt: "asc" } }, instrument: true },
  });

  return { order: final, replayed: false, riskDecision: decision };
}

export async function cancelOrder(userId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { account: true } });
  if (!order || order.account.userId !== userId) {
    throw new OrderValidationError("Order not found.");
  }
  const updated = await cancelOrderInBroker(orderId);
  await recordAuditEvent({
    userId,
    category: "order",
    action: "order_canceled",
    targetType: "order",
    targetId: orderId,
  });
  return updated;
}

export async function listOrders(userId: string) {
  const account = await getPrimaryAccount(userId);
  return prisma.order.findMany({
    where: { accountId: account.id },
    include: { instrument: true, executions: true },
    orderBy: { submittedAt: "desc" },
    take: 100,
  });
}
