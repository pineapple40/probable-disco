import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { placeOrder, cancelOrder, listOrders } from "@/server/orders/service";
import { getMarketDataProvider } from "@/server/market-data/provider";
import { matchOpenOrders, cancelOrder as cancelOrderInBroker } from "@/server/broker/simulated";

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
    // The stop-loss creates one resting protective child order alongside the
    // parent buy - the idempotency replay must not create a second parent.
    const msftParentOrders = orders.filter((o) => o.instrument.symbol === "MSFT" && !o.parentOrderId);
    expect(msftParentOrders).toHaveLength(1);
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

  it("creates resting protective stop-loss and take-profit orders when a bracket buy fills", async () => {
    const stopLossPrice = await safeStopLoss("TSLA");
    const instrument = await prisma.instrument.findUniqueOrThrow({ where: { symbol: "TSLA" } });
    const quote = await getMarketDataProvider().getQuote(instrument.id, "TSLA");
    const takeProfitPrice = Math.round(quote.last * 1.2 * 100) / 100; // 20% reward vs 10% risk -> 2:1, clears the 1.5:1 minimum

    const { order } = await placeOrder(userId, {
      symbol: "TSLA",
      side: "BUY",
      type: "MARKET",
      quantity: 3,
      stopLossPrice,
      takeProfitPrice,
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey: randomUUID(),
    });
    expect(order.status).toBe("FILLED");

    const children = await prisma.order.findMany({ where: { parentOrderId: order.id } });
    expect(children).toHaveLength(2);

    const stopLoss = children.find((c) => c.type === "STOP");
    const takeProfit = children.find((c) => c.type === "LIMIT");
    expect(stopLoss).toBeDefined();
    expect(takeProfit).toBeDefined();
    expect(stopLoss!.status).toBe("NEW");
    expect(takeProfit!.status).toBe("NEW");
    expect(stopLoss!.side).toBe("SELL");
    expect(takeProfit!.side).toBe("SELL");
    expect(Number(stopLoss!.quantity)).toBe(3);
    expect(Number(takeProfit!.quantity)).toBe(3);

    // Force the take-profit leg to be immediately marketable (limitPrice far
    // below the current bid), then let the matching engine fill it.
    await prisma.order.update({ where: { id: takeProfit!.id }, data: { limitPrice: 0.01 } });
    const filledCount = await matchOpenOrders();
    expect(filledCount).toBeGreaterThanOrEqual(1);

    const filledTakeProfit = await prisma.order.findUniqueOrThrow({ where: { id: takeProfit!.id } });
    expect(filledTakeProfit.status).toBe("FILLED");

    // The sibling stop-loss must be auto-canceled (OCO) once the position it
    // was protecting is fully closed.
    const canceledStopLoss = await prisma.order.findUniqueOrThrow({ where: { id: stopLoss!.id } });
    expect(canceledStopLoss.status).toBe("CANCELED");

    const position = await prisma.position.findFirst({ where: { accountId, instrument: { symbol: "TSLA" } } });
    expect(Number(position!.quantity)).toBe(0);
  });

  it("cancels the sibling protective order when one bracket leg is manually canceled", async () => {
    const stopLossPrice = await safeStopLoss("AMD");
    const instrument = await prisma.instrument.findUniqueOrThrow({ where: { symbol: "AMD" } });
    const quote = await getMarketDataProvider().getQuote(instrument.id, "AMD");
    const takeProfitPrice = Math.round(quote.last * 1.2 * 100) / 100; // 20% reward vs 10% risk -> 2:1, clears the 1.5:1 minimum

    const { order } = await placeOrder(userId, {
      symbol: "AMD",
      side: "BUY",
      type: "MARKET",
      quantity: 2,
      stopLossPrice,
      takeProfitPrice,
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey: randomUUID(),
    });
    expect(order.status).toBe("FILLED");

    const children = await prisma.order.findMany({ where: { parentOrderId: order.id } });
    const stopLoss = children.find((c) => c.type === "STOP")!;
    const takeProfit = children.find((c) => c.type === "LIMIT")!;

    await cancelOrderInBroker(stopLoss.id);

    const canceledTakeProfit = await prisma.order.findUniqueOrThrow({ where: { id: takeProfit.id } });
    expect(canceledTakeProfit.status).toBe("CANCELED");
  });

  it("does not treat a colliding idempotency key from a different account as a replay", async () => {
    const traderRole = await prisma.role.findUniqueOrThrow({ where: { key: "trader" } });
    const otherEmail = `test-orders-other-${randomUUID()}@example.com`;
    const otherUser = await prisma.user.create({
      data: {
        email: otherEmail,
        passwordHash: await hashPassword("Test!Password123"),
        displayName: "Other Order Test User",
        roleId: traderRole.id,
        emailVerifiedAt: new Date(),
      },
    });
    const otherBroker = await prisma.brokerConnection.create({
      data: { userId: otherUser.id, provider: "SIMULATED", label: "Other broker", isPaper: true, status: "connected" },
    });
    const otherAccount = await prisma.account.create({
      data: {
        userId: otherUser.id,
        brokerConnectionId: otherBroker.id,
        label: "Other account",
        cash: 100_000,
        equity: 100_000,
        buyingPower: 200_000,
      },
    });
    await prisma.riskProfile.create({
      data: { userId: otherUser.id, accountId: otherAccount.id, restrictedHoursOnly: false },
    });
    await prisma.emergencyTradingLock.create({ data: { userId: otherUser.id, accountId: otherAccount.id } });

    const sharedIdempotencyKey = randomUUID();

    const first = await placeOrder(userId, {
      symbol: "QQQ",
      side: "BUY",
      type: "MARKET",
      quantity: 3,
      stopLossPrice: await safeStopLoss("QQQ"),
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey: sharedIdempotencyKey,
    });
    expect(first.order.status).toBe("FILLED");

    // A different account reusing the exact same idempotency key string must
    // get its own, independently-placed order - never a "replay" that
    // returns the first account's order.
    const second = await placeOrder(otherUser.id, {
      symbol: "IWM",
      side: "BUY",
      type: "MARKET",
      quantity: 7,
      stopLossPrice: await safeStopLoss("IWM"),
      duration: "DAY",
      isExtendedHours: false,
      idempotencyKey: sharedIdempotencyKey,
    });
    expect(second.replayed).toBe(false);
    expect(second.order.id).not.toBe(first.order.id);
    expect(second.order.accountId).toBe(otherAccount.id);

    const secondOrderWithInstrument = await prisma.order.findUniqueOrThrow({
      where: { id: second.order.id },
      include: { instrument: true },
    });
    expect(secondOrderWithInstrument.instrument.symbol).toBe("IWM");

    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});
