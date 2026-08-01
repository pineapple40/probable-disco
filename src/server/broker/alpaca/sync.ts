import type { Order, OrderStatus, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import * as alpaca from "@/server/broker/alpaca/client";
import type { AlpacaOrder, AlpacaOrderLeg } from "@/server/broker/alpaca/client";
import { applyExecutionToPortfolio, recomputeAccountEquity } from "@/server/portfolio/accounting";
import { recordAuditEvent } from "@/server/audit/log";

const ALPACA_STATUS_TO_LOCAL: Record<string, OrderStatus> = {
  new: "NEW",
  accepted: "NEW",
  pending_new: "NEW",
  accepted_for_bidding: "NEW",
  done_for_day: "NEW",
  stopped: "NEW",
  suspended: "NEW",
  calculated: "NEW",
  held: "NEW",
  partially_filled: "PARTIALLY_FILLED",
  filled: "FILLED",
  canceled: "CANCELED",
  expired: "EXPIRED",
  rejected: "REJECTED",
  pending_cancel: "PENDING_CANCEL",
  pending_replace: "PENDING_CANCEL",
  replaced: "REPLACED",
};

export function mapAlpacaStatus(alpacaStatus: string): OrderStatus {
  return ALPACA_STATUS_TO_LOCAL[alpacaStatus] ?? "NEW";
}

function mapLegType(type: string): "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" {
  if (type === "limit") return "LIMIT";
  if (type === "stop") return "STOP";
  if (type === "stop_limit") return "STOP_LIMIT";
  return "MARKET";
}

/** Applies a broker-reported fill delta and status transition to one local Order row. */
async function reconcileFill(
  tx: Prisma.TransactionClient,
  local: Order,
  remote: { status: string; filled_qty: string; filled_avg_price: string | null },
): Promise<void> {
  const remoteFilledQty = Number(remote.filled_qty);
  const localFilledQty = Number(local.filledQuantity);
  const delta = remoteFilledQty - localFilledQty;
  const newStatus = mapAlpacaStatus(remote.status);

  if (delta > 1e-9 && remote.filled_avg_price) {
    const price = Number(remote.filled_avg_price);
    await applyExecutionToPortfolio(tx, {
      accountId: local.accountId,
      instrumentId: local.instrumentId,
      side: local.side,
      quantity: delta,
      price,
      fee: 0, // Alpaca's own paper-trading fills are commission-free
    });
    await tx.execution.create({
      data: { orderId: local.id, quantity: delta, price, fee: 0, liquidity: "alpaca" },
    });
  }

  if (newStatus !== local.status || delta > 1e-9) {
    await tx.order.update({
      where: { id: local.id },
      data: { status: newStatus, filledQuantity: remoteFilledQty },
    });
    await tx.orderEvent.create({
      data: {
        orderId: local.id,
        type: newStatus === "FILLED" ? "filled" : newStatus.toLowerCase(),
        detail: { source: "alpaca", remoteStatus: remote.status } as never,
      },
    });
  }
}

/** Finds (or creates, on first sight) the local mirror Order row for one Alpaca bracket leg. */
async function reconcileLeg(
  tx: Prisma.TransactionClient,
  parentLocalId: string,
  accountId: string,
  instrumentId: string,
  leg: AlpacaOrderLeg,
): Promise<void> {
  let child = await tx.order.findUnique({ where: { externalOrderId: leg.id } });
  if (!child) {
    child = await tx.order.create({
      data: {
        accountId,
        instrumentId,
        side: leg.side === "buy" ? "BUY" : "SELL",
        type: mapLegType(leg.type),
        duration: "GTC",
        quantity: Number(leg.qty),
        limitPrice: leg.limit_price ? Number(leg.limit_price) : null,
        stopPrice: leg.stop_price ? Number(leg.stop_price) : null,
        status: "NEW",
        idempotencyKey: `alpaca-leg:${leg.id}`,
        parentOrderId: parentLocalId,
        externalOrderId: leg.id,
      },
    });
    await tx.orderEvent.create({
      data: { orderId: child.id, type: "accepted", detail: { source: "alpaca", parentOrderId: parentLocalId } as never },
    });
  }
  await reconcileFill(tx, child, leg);
}

/**
 * Polls Alpaca for the current status of every locally-open, Alpaca-routed
 * order (and its bracket legs), reconciling fills into the same
 * Execution/Position accounting the simulated engine uses. Intended to be
 * called from the worker tick loop *instead of* matchOpenOrders() whenever
 * BROKER_PROVIDER=alpaca - the two engines must never run against the same
 * deployment's orders, since Alpaca's own paper fills are authoritative once
 * an order is routed there.
 */
export async function syncAlpacaFills(): Promise<number> {
  const openOrders = await prisma.order.findMany({
    where: {
      externalOrderId: { not: null },
      status: { in: ["PENDING_NEW", "NEW", "PARTIALLY_FILLED"] },
      parentOrderId: null,
    },
  });

  const affectedAccounts = new Set<string>();
  let changedCount = 0;

  for (const order of openOrders) {
    let remote: AlpacaOrder;
    try {
      remote = await alpaca.getOrder(order.externalOrderId!);
    } catch (err) {
      await recordAuditEvent({
        category: "order",
        action: "alpaca_sync_fetch_failed",
        targetType: "order",
        targetId: order.id,
        detail: { error: (err as Error).message },
      });
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        await reconcileFill(tx, fresh, remote);
        for (const leg of remote.legs ?? []) {
          await reconcileLeg(tx, order.id, order.accountId, order.instrumentId, leg);
        }
      });
      affectedAccounts.add(order.accountId);
      changedCount++;
    } catch (err) {
      await recordAuditEvent({
        category: "order",
        action: "alpaca_sync_reconcile_failed",
        targetType: "order",
        targetId: order.id,
        detail: { error: (err as Error).message },
      });
    }
  }

  for (const accountId of affectedAccounts) {
    await recomputeAccountEquity(accountId);
  }

  return changedCount;
}
