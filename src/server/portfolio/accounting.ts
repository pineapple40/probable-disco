import type { Prisma, OrderSide } from "@/generated/prisma/client";
import { getMarketDataProvider } from "@/server/market-data/provider";

const BUYING_POWER_MULTIPLIER = 2; // simplified reg-T-like model; real margin rules are out of scope for v1

export class InsufficientPositionError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Applies a single execution's effect on cash and the account's position for
 * that instrument. Must run inside the same transaction that writes the
 * Execution row. Long-only for v1 - selling more than the held quantity throws.
 */
export async function applyExecutionToPortfolio(
  tx: Prisma.TransactionClient,
  params: {
    accountId: string;
    instrumentId: string;
    side: OrderSide;
    quantity: number;
    price: number;
    fee: number;
  },
) {
  const { accountId, instrumentId, side, quantity, price, fee } = params;
  const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
  const position = await tx.position.findUnique({ where: { accountId_instrumentId: { accountId, instrumentId } } });

  if (side === "BUY") {
    const cost = quantity * price + fee;
    if (!position || Number(position.quantity) === 0) {
      await tx.position.upsert({
        where: { accountId_instrumentId: { accountId, instrumentId } },
        update: {
          side: "LONG",
          quantity,
          avgEntryPrice: price,
          closedAt: null,
          openedAt: new Date(),
        },
        create: { accountId, instrumentId, side: "LONG", quantity, avgEntryPrice: price },
      });
    } else {
      const existingQty = Number(position.quantity);
      const existingAvg = Number(position.avgEntryPrice);
      const newQty = existingQty + quantity;
      const newAvg = (existingQty * existingAvg + quantity * price) / newQty;
      await tx.position.update({
        where: { id: position.id },
        data: { quantity: newQty, avgEntryPrice: newAvg },
      });
    }
    await tx.account.update({
      where: { id: accountId },
      data: {
        cash: Number(account.cash) - cost,
        buyingPower: (Number(account.cash) - cost) * BUYING_POWER_MULTIPLIER,
      },
    });
  } else {
    if (!position || Number(position.quantity) < quantity) {
      throw new InsufficientPositionError(
        "Sell quantity exceeds held position. Short selling is not supported in this release.",
      );
    }
    const proceeds = quantity * price - fee;
    const realizedDelta = (price - Number(position.avgEntryPrice)) * quantity;
    const remainingQty = Number(position.quantity) - quantity;

    await tx.position.update({
      where: { id: position.id },
      data: {
        quantity: remainingQty,
        realizedPnl: Number(position.realizedPnl) + realizedDelta,
        closedAt: remainingQty === 0 ? new Date() : null,
      },
    });
    await tx.account.update({
      where: { id: accountId },
      data: {
        cash: Number(account.cash) + proceeds,
        buyingPower: (Number(account.cash) + proceeds) * BUYING_POWER_MULTIPLIER,
      },
    });
  }
}

/**
 * Recomputes account equity (cash + market value of open positions) using
 * live simulated quotes. Safe to call outside of a transaction since it only
 * reads quotes and writes a single account row.
 */
export async function recomputeAccountEquity(accountId: string, tx?: Prisma.TransactionClient) {
  const { prisma } = await import("@/lib/db");
  const client = tx ?? prisma;
  const account = await client.account.findUniqueOrThrow({ where: { id: accountId } });
  const positions = await client.position.findMany({
    where: { accountId, quantity: { gt: 0 } },
    include: { instrument: true },
  });

  const provider = getMarketDataProvider();
  let marketValue = 0;
  let unrealizedPnl = 0;
  for (const position of positions) {
    const quote = await provider.getQuote(position.instrumentId, position.instrument.symbol);
    const qty = Number(position.quantity);
    marketValue += qty * quote.last;
    unrealizedPnl += (quote.last - Number(position.avgEntryPrice)) * qty;
  }

  const equity = Number(account.cash) + marketValue;
  await client.account.update({ where: { id: accountId }, data: { equity } });
  return { equity, marketValue, unrealizedPnl, cash: Number(account.cash) };
}
