import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { applyExecutionToPortfolio } from "@/server/portfolio/accounting";

let userId: string;
let accountId: string;
let instrumentId: string;

beforeAll(async () => {
  const traderRole = await prisma.role.findUniqueOrThrow({ where: { key: "trader" } });
  const email = `test-accounting-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("Test!Password123"),
      displayName: "Accounting Test User",
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

  const instrument = await prisma.instrument.findUniqueOrThrow({ where: { symbol: "AAPL" } });
  instrumentId = instrument.id;
}, 30_000);

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

describe("applyExecutionToPortfolio", () => {
  it("resets realizedPnl when a fully-closed position is re-opened", async () => {
    await prisma.$transaction(async (tx) => {
      await applyExecutionToPortfolio(tx, { accountId, instrumentId, side: "BUY", quantity: 10, price: 100, fee: 0 });
      await applyExecutionToPortfolio(tx, { accountId, instrumentId, side: "SELL", quantity: 10, price: 90, fee: 0 });
    });

    const closed = await prisma.position.findUniqueOrThrow({
      where: { accountId_instrumentId: { accountId, instrumentId } },
    });
    expect(Number(closed.realizedPnl)).toBe(-100);
    expect(closed.closedAt).not.toBeNull();

    await prisma.$transaction(async (tx) => {
      await applyExecutionToPortfolio(tx, { accountId, instrumentId, side: "BUY", quantity: 5, price: 100, fee: 0 });
    });

    const reopened = await prisma.position.findUniqueOrThrow({
      where: { accountId_instrumentId: { accountId, instrumentId } },
    });
    expect(Number(reopened.quantity)).toBe(5);
    expect(reopened.closedAt).toBeNull();
    // Realized P&L from the previous, already-closed holding period must not
    // carry over into the newly re-opened position.
    expect(Number(reopened.realizedPnl)).toBe(0);
  });

  it("never loses a cash update when fills on the same account race concurrently", async () => {
    const broker = await prisma.brokerConnection.create({
      data: { userId, provider: "SIMULATED", label: "Concurrency test broker", isPaper: true, status: "connected" },
    });
    const raceAccount = await prisma.account.create({
      data: {
        userId,
        brokerConnectionId: broker.id,
        label: "Concurrency test account",
        cash: 100_000,
        equity: 100_000,
        buyingPower: 200_000,
      },
    });

    const fillCount = 20;
    const costPerFill = 10; // quantity 1 * price 10
    await Promise.all(
      Array.from({ length: fillCount }, () =>
        prisma.$transaction((tx) =>
          applyExecutionToPortfolio(tx, {
            accountId: raceAccount.id,
            instrumentId,
            side: "BUY",
            quantity: 1,
            price: costPerFill,
            fee: 0,
          }),
        ),
      ),
    );

    const settled = await prisma.account.findUniqueOrThrow({ where: { id: raceAccount.id } });
    const expectedCash = 100_000 - fillCount * costPerFill;
    expect(Number(settled.cash)).toBe(expectedCash);
    expect(Number(settled.buyingPower)).toBe(expectedCash * 2);
  });
});
