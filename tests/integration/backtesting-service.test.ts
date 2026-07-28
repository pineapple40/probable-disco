import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { runAndStoreBacktest } from "@/server/backtesting/service";

let userAId: string;
let userBId: string;
let userAStrategyId: string;
let userBStrategyId: string;
let userAVersionId: string;

async function makeUser(): Promise<string> {
  const traderRole = await prisma.role.findUniqueOrThrow({ where: { key: "trader" } });
  const email = `test-backtest-svc-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("Test!Password123"),
      displayName: "Backtest Service Test User",
      roleId: traderRole.id,
      emailVerifiedAt: new Date(),
    },
  });
  return user.id;
}

const definition = {
  symbols: ["AAPL"],
  maxTradesPerDay: 5,
  positionSizing: { method: "fixed_quantity", value: 1 },
  entryRules: [{ type: "price_above", value: 0 }],
  exitRules: [],
};

beforeAll(async () => {
  userAId = await makeUser();
  userBId = await makeUser();

  const strategyA = await prisma.strategy.create({ data: { userId: userAId, name: "A's strategy" } });
  userAStrategyId = strategyA.id;
  const versionA = await prisma.strategyVersion.create({
    data: { strategyId: strategyA.id, version: 1, definition: definition as never, isValid: true },
  });
  userAVersionId = versionA.id;

  const strategyB = await prisma.strategy.create({ data: { userId: userBId, name: "B's strategy" } });
  userBStrategyId = strategyB.id;
}, 30_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
});

describe("runAndStoreBacktest (integration)", () => {
  it("ignores a spoofed strategyId and derives it from the ownership-checked strategyVersion", async () => {
    const backtest = await runAndStoreBacktest(userAId, {
      strategyId: userBStrategyId, // spoofed: not the owner of userAVersionId's strategy
      strategyVersionId: userAVersionId,
      symbols: ["AAPL"],
      startDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      endDate: new Date(),
      initialCapital: 100_000,
      commissionPerTrade: 0,
      slippageBps: 5,
      spreadBps: 2,
      maxPositions: 3,
    });

    expect(backtest.strategyId).toBe(userAStrategyId);
    expect(backtest.strategyId).not.toBe(userBStrategyId);

    const stored = await prisma.backtest.findUniqueOrThrow({ where: { id: backtest.id } });
    expect(stored.strategyId).toBe(userAStrategyId);
  });
});
