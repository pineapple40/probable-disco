import "server-only";
import type { Order, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/server/market-data/provider";
import { applyExecutionToPortfolio, recomputeAccountEquity } from "@/server/portfolio/accounting";
import { recordAuditEvent } from "@/server/audit/log";

const MARKET_ORDER_SLIPPAGE_BPS = 2;
const SIMULATED_FEE_PER_ORDER = 0; // commission-free paper trading, matching most modern US retail brokers

async function recordOrderEvent(
  tx: Prisma.TransactionClient,
  orderId: string,
  type: string,
  detail?: Record<string, unknown>,
) {
  await tx.orderEvent.create({ data: { orderId, type, detail: detail as never } });
}

/** Executes a full fill for the order's remaining quantity at the given price. */
async function fillOrder(
  tx: Prisma.TransactionClient,
  order: Order,
  symbol: string,
  fillPrice: number,
) {
  const remaining = Number(order.quantity) - Number(order.filledQuantity);
  const fee = SIMULATED_FEE_PER_ORDER;

  await applyExecutionToPortfolio(tx, {
    accountId: order.accountId,
    instrumentId: order.instrumentId,
    side: order.side,
    quantity: remaining,
    price: fillPrice,
    fee,
  });

  await tx.execution.create({
    data: { orderId: order.id, quantity: remaining, price: fillPrice, fee, liquidity: "simulated" },
  });

  const updated = await tx.order.update({
    where: { id: order.id },
    data: { status: "FILLED", filledQuantity: Number(order.quantity) },
  });

  await recordOrderEvent(tx, order.id, "filled", { price: fillPrice, quantity: remaining, symbol });
  return updated;
}

/**
 * Attempts to fill a newly-submitted order immediately. MARKET orders always
 * fill (subject to simulated slippage). LIMIT/STOP/STOP_LIMIT orders only
 * fill here if already marketable at submission time; otherwise they are
 * left open for matchOpenOrders() to pick up as quotes move.
 */
export async function attemptImmediateFill(orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { instrument: true },
    });
    if (order.status !== "PENDING_NEW" && order.status !== "NEW") return;

    const provider = getMarketDataProvider();
    const quote = await provider.getQuote(order.instrumentId, order.instrument.symbol);

    if (order.type === "MARKET") {
      const slippage = 1 + (order.side === "BUY" ? 1 : -1) * (MARKET_ORDER_SLIPPAGE_BPS / 10_000);
      const referencePrice = order.side === "BUY" ? quote.ask : quote.bid;
      await fillOrder(tx, order, order.instrument.symbol, referencePrice * slippage);
      return;
    }

    const triggerPrice = evaluateTrigger(order, quote.bid, quote.ask, quote.last);
    if (triggerPrice !== null) {
      await fillOrder(tx, order, order.instrument.symbol, triggerPrice);
    } else {
      await tx.order.update({ where: { id: order.id }, data: { status: "NEW" } });
      await recordOrderEvent(tx, order.id, "accepted", { quote });
    }
  });

  await recomputeAccountEquity(
    (await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).accountId,
  );
}

/**
 * Returns the fill price if the order's trigger condition is satisfied
 * against the current quote, or null if it should remain open. STOP_LIMIT
 * is simplified to require both the stop and limit conditions to hold
 * simultaneously (documented limitation - see PROJECT_STATUS.md).
 */
function evaluateTrigger(order: Order, bid: number, ask: number, last: number): number | null {
  const limitPrice = order.limitPrice ? Number(order.limitPrice) : null;
  const stopPrice = order.stopPrice ? Number(order.stopPrice) : null;

  if (order.type === "LIMIT" && limitPrice !== null) {
    if (order.side === "BUY" && ask <= limitPrice) return Math.min(ask, limitPrice);
    if (order.side === "SELL" && bid >= limitPrice) return Math.max(bid, limitPrice);
    return null;
  }

  if (order.type === "STOP" && stopPrice !== null) {
    if (order.side === "BUY" && last >= stopPrice) return ask;
    if (order.side === "SELL" && last <= stopPrice) return bid;
    return null;
  }

  if (order.type === "STOP_LIMIT" && stopPrice !== null && limitPrice !== null) {
    const stopTriggered = order.side === "BUY" ? last >= stopPrice : last <= stopPrice;
    if (!stopTriggered) return null;
    if (order.side === "BUY" && ask <= limitPrice) return Math.min(ask, limitPrice);
    if (order.side === "SELL" && bid >= limitPrice) return Math.max(bid, limitPrice);
    return null;
  }

  return null;
}

/**
 * Scans all open (NEW) resting orders and fills any whose trigger condition
 * is now satisfied against current simulated quotes. Intended to be called
 * on an interval by a background worker (see src/server/worker).
 */
export async function matchOpenOrders(): Promise<number> {
  const openOrders = await prisma.order.findMany({
    where: { status: "NEW", type: { in: ["LIMIT", "STOP", "STOP_LIMIT"] } },
    include: { instrument: true },
  });

  const provider = getMarketDataProvider();
  const affectedAccounts = new Set<string>();
  let filledCount = 0;

  for (const order of openOrders) {
    const quote = await provider.getQuote(order.instrumentId, order.instrument.symbol);
    const triggerPrice = evaluateTrigger(order, quote.bid, quote.ask, quote.last);
    if (triggerPrice === null) continue;

    try {
      await prisma.$transaction(async (tx) => {
        const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        if (fresh.status !== "NEW") return;
        await fillOrder(tx, fresh, order.instrument.symbol, triggerPrice);
      });
      affectedAccounts.add(order.accountId);
      filledCount++;
    } catch (err) {
      await recordAuditEvent({
        category: "order",
        action: "match_engine_fill_failed",
        targetType: "order",
        targetId: order.id,
        detail: { error: (err as Error).message },
      });
    }
  }

  for (const accountId of affectedAccounts) {
    await recomputeAccountEquity(accountId);
  }

  return filledCount;
}

export async function cancelOrder(orderId: string): Promise<Order> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== "NEW" && order.status !== "PENDING_NEW" && order.status !== "PARTIALLY_FILLED") {
      throw new Error(`Order cannot be canceled from status ${order.status}.`);
    }
    const updated = await tx.order.update({ where: { id: orderId }, data: { status: "CANCELED" } });
    await recordOrderEvent(tx, orderId, "canceled");
    return updated;
  });
}
