import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";

const createOrderMock = vi.hoisted(() => vi.fn());
const getOrderMock = vi.hoisted(() => vi.fn());
const cancelOrderMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/broker/alpaca/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/broker/alpaca/client")>();
  return { ...actual, createOrder: createOrderMock, getOrder: getOrderMock, cancelOrder: cancelOrderMock };
});

import { submitLocalOrderToAlpaca, cancelAlpacaOrder } from "@/server/broker/alpaca/orchestration";
import { syncAlpacaFills } from "@/server/broker/alpaca/sync";
import { AlpacaApiError } from "@/server/broker/alpaca/client";

let userId: string;
let accountId: string;
let instrumentId: string;

beforeAll(async () => {
  const traderRole = await prisma.role.findUniqueOrThrow({ where: { key: "trader" } });
  const email = `test-alpaca-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("Test!Password123"),
      displayName: "Alpaca Test User",
      roleId: traderRole.id,
      emailVerifiedAt: new Date(),
    },
  });
  userId = user.id;

  const broker = await prisma.brokerConnection.create({
    data: { userId, provider: "ALPACA", label: "Test Alpaca broker", isPaper: true, status: "connected" },
  });
  const account = await prisma.account.create({
    data: {
      userId,
      brokerConnectionId: broker.id,
      label: "Test Alpaca account",
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

afterEach(() => {
  createOrderMock.mockReset();
  getOrderMock.mockReset();
  cancelOrderMock.mockReset();
});

interface OrderOverrides {
  status?: "PENDING_NEW" | "NEW" | "FILLED" | "CANCELED";
  externalOrderId?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

async function createLocalOrder(overrides: OrderOverrides = {}) {
  return prisma.order.create({
    data: {
      accountId,
      instrumentId,
      side: "BUY",
      type: "MARKET",
      duration: "DAY",
      quantity: 5,
      status: "PENDING_NEW",
      idempotencyKey: randomUUID(),
      ...overrides,
    },
  });
}

describe("submitLocalOrderToAlpaca", () => {
  it("stores the returned external order id and maps the accepted status", async () => {
    createOrderMock.mockResolvedValue({ id: "alpaca-order-1", status: "accepted" });
    const order = await createLocalOrder();

    await submitLocalOrderToAlpaca(order.id);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.externalOrderId).toBe("alpaca-order-1");
    expect(updated.status).toBe("NEW");

    const events = await prisma.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events.some((e) => e.type === "accepted")).toBe(true);
  });

  it("rejects the local order locally when Alpaca rejects it, without leaking the raw error as a crash", async () => {
    createOrderMock.mockRejectedValue(new AlpacaApiError(422, '{"code":40010001,"message":"insufficient buying power"}'));
    const order = await createLocalOrder();

    await submitLocalOrderToAlpaca(order.id);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("REJECTED");
    expect(updated.rejectReason).toContain("insufficient buying power");
  });

  it("is a no-op if the order is no longer PENDING_NEW/NEW (e.g. already replayed)", async () => {
    const order = await createLocalOrder({ status: "CANCELED" });
    await submitLocalOrderToAlpaca(order.id);
    expect(createOrderMock).not.toHaveBeenCalled();
  });
});

describe("syncAlpacaFills", () => {
  it("reconciles a fully filled order into an Execution and a Position", async () => {
    const order = await createLocalOrder({ externalOrderId: `alpaca-${randomUUID()}`, status: "NEW" });
    getOrderMock.mockResolvedValue({
      id: order.externalOrderId,
      status: "filled",
      filled_qty: "5",
      filled_avg_price: "150.25",
      legs: null,
    });

    const changed = await syncAlpacaFills();
    expect(changed).toBeGreaterThanOrEqual(1);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("FILLED");
    expect(Number(updated.filledQuantity)).toBe(5);

    const execution = await prisma.execution.findFirst({ where: { orderId: order.id } });
    expect(execution).not.toBeNull();
    expect(Number(execution!.price)).toBe(150.25);

    const position = await prisma.position.findUnique({
      where: { accountId_instrumentId: { accountId, instrumentId } },
    });
    expect(Number(position!.quantity)).toBeGreaterThanOrEqual(5);
  });

  it("does not double-book an execution on a second sync pass with no new fill", async () => {
    const order = await createLocalOrder({ externalOrderId: `alpaca-${randomUUID()}`, status: "NEW" });
    getOrderMock.mockResolvedValue({
      id: order.externalOrderId,
      status: "filled",
      filled_qty: "5",
      filled_avg_price: "10",
      legs: null,
    });

    await syncAlpacaFills();
    const firstCount = await prisma.execution.count({ where: { orderId: order.id } });
    expect(firstCount).toBe(1);

    // A FILLED order is no longer in the polled status set, so a second
    // sync pass must not touch it again.
    await syncAlpacaFills();
    const secondCount = await prisma.execution.count({ where: { orderId: order.id } });
    expect(secondCount).toBe(1);
  });

  it("creates local mirror rows for bracket legs and reconciles their fills too", async () => {
    const order = await createLocalOrder({
      externalOrderId: `alpaca-${randomUUID()}`,
      status: "NEW",
      stopLossPrice: 90,
      takeProfitPrice: 120,
    });
    const takeProfitLegId = `leg-tp-${randomUUID()}`;
    const stopLossLegId = `leg-sl-${randomUUID()}`;

    getOrderMock.mockResolvedValue({
      id: order.externalOrderId,
      status: "filled",
      filled_qty: "5",
      filled_avg_price: "100",
      legs: [
        {
          id: takeProfitLegId,
          symbol: "AAPL",
          side: "sell",
          type: "limit",
          status: "filled",
          qty: "5",
          filled_qty: "5",
          filled_avg_price: "120",
          limit_price: "120",
          stop_price: null,
        },
        {
          id: stopLossLegId,
          symbol: "AAPL",
          side: "sell",
          type: "stop",
          status: "canceled",
          qty: "5",
          filled_qty: "0",
          filled_avg_price: null,
          limit_price: null,
          stop_price: "90",
        },
      ],
    });

    await syncAlpacaFills();

    const takeProfitChild = await prisma.order.findUnique({ where: { externalOrderId: takeProfitLegId } });
    const stopLossChild = await prisma.order.findUnique({ where: { externalOrderId: stopLossLegId } });
    expect(takeProfitChild).not.toBeNull();
    expect(takeProfitChild!.status).toBe("FILLED");
    expect(takeProfitChild!.parentOrderId).toBe(order.id);
    expect(stopLossChild).not.toBeNull();
    expect(stopLossChild!.status).toBe("CANCELED");
  });
});

describe("cancelAlpacaOrder", () => {
  it("forwards the cancel to Alpaca and marks the local order CANCELED", async () => {
    cancelOrderMock.mockResolvedValue(undefined);
    const order = await createLocalOrder({ externalOrderId: `alpaca-${randomUUID()}`, status: "NEW" });

    const result = await cancelAlpacaOrder(order.id, order.externalOrderId!);
    expect(result.status).toBe("CANCELED");
    expect(cancelOrderMock).toHaveBeenCalledWith(order.externalOrderId);
  });

  it("still marks CANCELED locally if Alpaca returns 404 (already gone)", async () => {
    cancelOrderMock.mockRejectedValue(new AlpacaApiError(404, "order not found"));
    const order = await createLocalOrder({ externalOrderId: `alpaca-${randomUUID()}`, status: "NEW" });

    const result = await cancelAlpacaOrder(order.id, order.externalOrderId!);
    expect(result.status).toBe("CANCELED");
  });

  it("rejects canceling an order that is already FILLED", async () => {
    const order = await createLocalOrder({ externalOrderId: `alpaca-${randomUUID()}`, status: "FILLED" });
    await expect(cancelAlpacaOrder(order.id, order.externalOrderId!)).rejects.toThrow(/cannot be canceled/);
    expect(cancelOrderMock).not.toHaveBeenCalled();
  });
});
