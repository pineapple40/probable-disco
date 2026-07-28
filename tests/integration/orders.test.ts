import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { placeOrder, cancelOrder, listOrders } from "@/server/orders/service";
import { getMarketDataProvider } from "@/server/market-data/provider";

let userId: string;
let accountId: string;

/** A stop-loss 10% below the current simulated price - safely under the default max risk per trade. */
async function safeStopLoss(symbol: string): Promise<number> {
  const instrument = await prisma.instrument.findUniqueOrThrow({ where: { symbol } });
  const quote = await getMarketDataProvider().getQuote(instrument.id, symbol);
  return Math.round(quote.last * 0.9 * 100) / 100;
}

beforeAll(async () => {
  const traderRole = await prisma.role.findUniqueOrThrow({ where: { key: "trader" } });
  const email = `test-orders-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("Test!Password123"),
      displayName: "Order Test User",
      roleId: traderRole.id,
      emailVerifiedAt: new Date(),
    },
  });
  userId = user.id;

  const broker = await prisma.brokerConnection.create({
    data: { userId, provider: "SIMULATED", label: "Test broker", isPaper: true, status: "connected" },
  });
  const account = await prisma.account.create({
    data: {
      userId,
      brokerConnectionId: broker.id,
      label: "Test account",
      cash: 100_000,
      equity: 100_000,
      buyingPower: 200_000,
    },
  });
  accountId = account.id;

  // Tests must be time-of-day independent, so allow trading outside regular
  // session hours (the underlying market-open/closed logic itself is
  // covered separately by the risk-engine unit tests).
  await prisma.riskProfile.create({ data: { userId, accountId, restrictedHoursOnly: false } });
  await prisma.emergencyTradingLock.create({ data: { userId, accountId } });
}, 30_000);

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

describe("placeOrder (integration)", () => {
  it("rejects a buy order with no stop-loss (risk profile requires one by default)", async () => {
    const { order, riskDecision } = await placeOrder(userId, {
      symbol: "AAPL",
      side: "BUY",
      type: "MARKET",
      quantity: 10,
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey: randomUUID(),
    });
    expect(order.status).toBe("REJECTED");
    expect(riskDecision?.ruleKey).toBe("stop_loss_required");
  });

  it("fills a valid market buy order and creates a position", async () => {
    const { order } = await placeOrder(userId, {
      symbol: "AAPL",
      side: "BUY",
      type: "MARKET",
      quantity: 5,
      stopLossPrice: await safeStopLoss("AAPL"),
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey: randomUUID(),
    });
    expect(order.status).toBe("FILLED");
    expect(Number(order.filledQuantity)).toBe(5);

    const position = await prisma.position.findFirst({
      where: { accountId, instrument: { symbol: "AAPL" } },
    });
    expect(position).not.toBeNull();
    expect(Number(position!.quantity)).toBe(5);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(Number(account.cash)).toBeLessThan(100_000);
  });

  it("replays the same order instead of double-filling when the idempotency key repeats", async () => {
    const idempotencyKey = randomUUID();
    const stopLossPrice = await safeStopLoss("MSFT");
    const first = await placeOrder(userId, {
      symbol: "MSFT",
      side: "BUY",
      type: "MARKET",
      quantity: 2,
      stopLossPrice,
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey,
    });
    const second = await placeOrder(userId, {
      symbol: "MSFT",
      side: "BUY",
      type: "MARKET",
      quantity: 2,
      stopLossPrice,
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey,
    });
    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);

    const orders = await listOrders(userId);
    const msftOrders = orders.filter((o) => o.instrument.symbol === "MSFT");
    expect(msftOrders).toHaveLength(1);
  });

  it("rejects a sell that exceeds the held position (no short selling)", async () => {
    const { order, riskDecision } = await placeOrder(userId, {
      symbol: "AAPL",
      side: "SELL",
      type: "MARKET",
      quantity: 999,
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey: randomUUID(),
    });
    expect(order.status).toBe("REJECTED");
    expect(riskDecision?.ruleKey).toBe("no_short_selling");
  });

  it("closes a position on a full sell and realizes P&L", async () => {
    const { order } = await placeOrder(userId, {
      symbol: "AAPL",
      side: "SELL",
      type: "MARKET",
      quantity: 5,
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey: randomUUID(),
    });
    expect(order.status).toBe("FILLED");

    const position = await prisma.position.findFirst({
      where: { accountId, instrument: { symbol: "AAPL" } },
    });
    expect(Number(position!.quantity)).toBe(0);
    expect(position!.closedAt).not.toBeNull();
  });

  it("cancels a resting limit order", async () => {
    // Uses a different symbol than the earlier tests: AAPL was just closed
    // above and a losing close correctly triggers this account's post-stop
    // cooldown rule, which would otherwise reject this unrelated order.
    const { order } = await placeOrder(userId, {
      symbol: "NVDA",
      side: "BUY",
      type: "LIMIT",
      limitPrice: 1, // far below market so it never fills immediately
      quantity: 1,
      stopLossPrice: 0.5,
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey: randomUUID(),
    });
    expect(order.status).toBe("NEW");

    const canceled = await cancelOrder(userId, order.id);
    expect(canceled.status).toBe("CANCELED");
  });
});
