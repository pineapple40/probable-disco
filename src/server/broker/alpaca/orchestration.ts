import type { Order } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AlpacaApiError } from "@/server/broker/alpaca/client";
import { getAlpacaBrokerAdapter } from "@/server/broker/alpaca/adapter";
import { mapAlpacaStatus } from "@/server/broker/alpaca/sync";
import type { PlaceOrderInput } from "@/server/broker/types";

/**
 * Submits a freshly-created local order (still PENDING_NEW/NEW) to Alpaca.
 * Unlike the simulated engine's attemptImmediateFill(), this never fills the
 * order itself - it only records Alpaca's acceptance (or rejection) and
 * leaves fill reconciliation to syncAlpacaFills() (see sync.ts).
 */
export async function submitLocalOrderToAlpaca(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { instrument: true },
  });
  if (order.status !== "PENDING_NEW" && order.status !== "NEW") return;

  const input: PlaceOrderInput = {
    orderId: order.id,
    accountId: order.accountId,
    instrumentId: order.instrumentId,
    symbol: order.instrument.symbol,
    side: order.side,
    type: order.type,
    quantity: Number(order.quantity),
    limitPrice: order.limitPrice ? Number(order.limitPrice) : undefined,
    stopPrice: order.stopPrice ? Number(order.stopPrice) : undefined,
    duration: order.duration,
    isExtendedHours: order.isExtendedHours,
    stopLossPrice: order.stopLossPrice ? Number(order.stopLossPrice) : undefined,
    takeProfitPrice: order.takeProfitPrice ? Number(order.takeProfitPrice) : undefined,
    idempotencyKey: order.idempotencyKey,
  };

  try {
    const { externalOrderId, status } = await getAlpacaBrokerAdapter().submitOrder(input);
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { externalOrderId, status: mapAlpacaStatus(status) },
      });
      await tx.orderEvent.create({
        data: {
          orderId: order.id,
          type: "accepted",
          detail: { source: "alpaca", externalOrderId, remoteStatus: status } as never,
        },
      });
    });
  } catch (err) {
    const message =
      err instanceof AlpacaApiError
        ? `Alpaca rejected the order: ${err.body.slice(0, 500)}`
        : `Failed to submit order to Alpaca: ${(err as Error).message}`.slice(0, 500);
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: "REJECTED", rejectReason: message } });
      await tx.orderEvent.create({
        data: { orderId: order.id, type: "rejected", detail: { source: "alpaca", error: message } as never },
      });
    });
  }
}

/** Cancels an Alpaca-routed order: forwards the cancel to Alpaca, then marks it CANCELED locally. */
export async function cancelAlpacaOrder(localOrderId: string, externalOrderId: string): Promise<Order> {
  const current = await prisma.order.findUniqueOrThrow({ where: { id: localOrderId } });
  if (current.status !== "NEW" && current.status !== "PENDING_NEW" && current.status !== "PARTIALLY_FILLED") {
    throw new Error(`Order cannot be canceled from status ${current.status}.`);
  }

  try {
    await getAlpacaBrokerAdapter().cancelOrder(externalOrderId);
  } catch (err) {
    // 404 means Alpaca already considers it gone (e.g. it just filled or was
    // already canceled) - safe to still reflect CANCELED locally below and
    // let the next sync pass correct the status if it actually filled first.
    if (!(err instanceof AlpacaApiError && err.status === 404)) throw err;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({ where: { id: localOrderId }, data: { status: "CANCELED" } });
    await tx.orderEvent.create({
      data: { orderId: localOrderId, type: "canceled", detail: { source: "alpaca" } as never },
    });
    return updated;
  });
}
