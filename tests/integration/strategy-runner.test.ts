import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { startOfUtcDay } from "@/server/market-data/calendar";
import { tickStrategyRuns, loadBars } from "@/server/worker/strategyRunner";

let userId: string;
let accountId: string;

async function makeStrategy(userId: string, definition: unknown) {
  const strategy = await prisma.strategy.create({ data: { userId, name: `Strategy ${randomUUID()}` } });
  const version = await prisma.strategyVersion.create({
    data: { strategyId: strategy.id, version: 1, definition: definition as never, isValid: true },
  });
  return { strategy, version };
}

beforeAll(async () => {
  const traderRole = await prisma.role.findUniqueOrThrow({ where: { key: "trader" } });
  const email = `test-strategy-runner-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("Test!Password123"),
      displayName: "Strategy Runner Test User",
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

  await prisma.riskProfile.create({ data: { userId, accountId, restrictedHoursOnly: false } });
  await prisma.emergencyTradingLock.create({ data: { userId, accountId } });
}, 30_000);

afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
});

describe("loadBars", () => {
  it("never includes today's still-in-progress trading day (look-ahead)", async () => {
    const bars = await loadBars("AAPL");
    expect(bars.length).toBeGreaterThan(1);
    const todayStart = startOfUtcDay(new Date()).getTime();
    for (const bar of bars) {
      expect(bar.ts.getTime()).toBeLessThan(todayStart);
    }
  });
});

describe("tickStrategyRuns", () => {
  it("exits only the quantity the run entered with, not the whole account position", async () => {
    const instrument = await prisma.instrument.findUniqueOrThrow({ where: { symbol: "NFLX" } });
    // Pre-existing account position of 20 shares, only 8 of which "belong" to
    // this run (the rest were bought manually / by another run).
    await prisma.position.create({
      data: { accountId, instrumentId: instrument.id, side: "LONG", quantity: 20, avgEntryPrice: 100 },
    });

    const { strategy, version } = await makeStrategy(userId, {
      symbols: ["NFLX"],
      maxTradesPerDay: 5,
      positionSizing: { method: "fixed_quantity", value: 1 },
      entryRules: [{ type: "price_above", value: 1_000_000 }], // never true
      exitRules: [{ type: "price_below", value: 1_000_000 }], // always true
    });

    const run = await prisma.strategyRun.create({
      data: {
        strategyId: strategy.id,
        strategyVersionId: version.id,
        accountId,
        status: "running",
        state: { openPositions: { NFLX: 8 }, consecutiveErrorsBySymbol: {} },
        lastHeartbeatAt: new Date(),
      },
    });

    await tickStrategyRuns();

    const position = await prisma.position.findUniqueOrThrow({
      where: { accountId_instrumentId: { accountId, instrumentId: instrument.id } },
    });
    expect(Number(position.quantity)).toBe(12); // 20 - 8, not 0

    const updatedRun = await prisma.strategyRun.findUniqueOrThrow({ where: { id: run.id } });
    const state = updatedRun.state as { openPositions?: Record<string, number> };
    expect(state.openPositions?.NFLX ?? 0).toBe(0);

    const exitOrder = await prisma.order.findFirst({
      where: { strategyRunId: run.id, side: "SELL", instrument: { symbol: "NFLX" } },
    });
    expect(exitOrder).not.toBeNull();
    expect(Number(exitOrder!.filledQuantity)).toBe(8);
  });

  it("tracks consecutive errors per symbol, so one persistently broken symbol pauses the run even if others keep succeeding", async () => {
    const { strategy, version } = await makeStrategy(userId, {
      symbols: ["NOT-A-REAL-SYMBOL", "AAPL"],
      maxTradesPerDay: 5,
      positionSizing: { method: "fixed_quantity", value: 1 },
      entryRules: [{ type: "price_above", value: 1_000_000 }], // never true, AAPL never trades
      exitRules: [],
    });

    const run = await prisma.strategyRun.create({
      data: {
        strategyId: strategy.id,
        strategyVersionId: version.id,
        accountId,
        status: "running",
        state: { openPositions: {}, consecutiveErrorsBySymbol: {} },
        lastHeartbeatAt: new Date(),
      },
    });

    for (let i = 0; i < 5; i++) {
      await tickStrategyRuns();
    }

    const updatedRun = await prisma.strategyRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(updatedRun.status).toBe("error");

    const state = updatedRun.state as { consecutiveErrorsBySymbol?: Record<string, number> };
    expect(state.consecutiveErrorsBySymbol?.["NOT-A-REAL-SYMBOL"]).toBeGreaterThanOrEqual(5);
    expect(state.consecutiveErrorsBySymbol?.["AAPL"]).toBe(0);
  });
});
