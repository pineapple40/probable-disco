import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { buildRiskCheckContext } from "@/server/risk/context";
import { evaluateOrderRisk } from "@/server/risk/engine";

let userId: string;
let accountId: string;

beforeAll(async () => {
  const traderRole = await prisma.role.findUniqueOrThrow({ where: { key: "trader" } });
  const email = `test-risk-context-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("Test!Password123"),
      displayName: "Risk Context Test User",
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

  // maxDailyLossUsd defaults to $1000; restrictedHoursOnly disabled so the
  // test is time-of-day independent.
  await prisma.riskProfile.create({ data: { userId, accountId, restrictedHoursOnly: false } });
  await prisma.emergencyTradingLock.create({ data: { userId, accountId } });
}, 30_000);

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

describe("buildRiskCheckContext", () => {
  it("counts a large unrealized loss on an open position toward the daily loss lockout", async () => {
    // An entry price far above any realistic simulated quote guarantees a
    // large unrealized loss regardless of the instrument's actual price.
    const heldInstrument = await prisma.instrument.findUniqueOrThrow({ where: { symbol: "AAPL" } });
    await prisma.position.create({
      data: {
        accountId,
        instrumentId: heldInstrument.id,
        side: "LONG",
        quantity: 100,
        avgEntryPrice: 100_000,
      },
    });

    // Attempt a fresh, unrelated buy - no closed trades today, so the old
    // (buggy) behavior would have allowed this since it only summed realized
    // P&L from closed positions.
    const newInstrument = await prisma.instrument.findUniqueOrThrow({ where: { symbol: "MSFT" } });
    const ctx = await buildRiskCheckContext(accountId, newInstrument.id, "MSFT");

    expect(ctx.todaysRealizedPlusUnrealizedPnl).toBeLessThanOrEqual(-1000);
    expect(ctx.weekRealizedPlusUnrealizedPnl).toBeLessThanOrEqual(-1000);

    const decision = evaluateOrderRisk(
      {
        side: "BUY",
        type: "MARKET",
        quantity: 1,
        stopLossPrice: 1,
        isExtendedHours: false,
      },
      ctx,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.ruleKey).toBe("max_daily_loss");
  });
});
