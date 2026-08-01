import { afterEach, describe, expect, it, vi } from "vitest";

const createOrderMock = vi.hoisted(() => vi.fn());
const cancelOrderMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/broker/alpaca/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/broker/alpaca/client")>();
  return { ...actual, createOrder: createOrderMock, cancelOrder: cancelOrderMock };
});

import { AlpacaBrokerAdapter } from "@/server/broker/alpaca/adapter";
import type { PlaceOrderInput } from "@/server/broker/types";

function baseInput(overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    orderId: "local-1",
    accountId: "acct-1",
    instrumentId: "instr-1",
    symbol: "AAPL",
    side: "BUY",
    type: "MARKET",
    quantity: 5,
    duration: "DAY",
    isExtendedHours: false,
    idempotencyKey: "idem-1",
    ...overrides,
  };
}

describe("AlpacaBrokerAdapter", () => {
  afterEach(() => {
    createOrderMock.mockReset();
    cancelOrderMock.mockReset();
  });

  it("submits a plain order with no order_class when there is no stop-loss/take-profit", async () => {
    createOrderMock.mockResolvedValue({ id: "alpaca-1", status: "accepted" });
    const adapter = new AlpacaBrokerAdapter();

    const result = await adapter.submitOrder(baseInput());

    expect(result).toEqual({ externalOrderId: "alpaca-1", status: "accepted" });
    const body = createOrderMock.mock.calls[0]![0];
    expect(body.order_class).toBeUndefined();
    expect(body.client_order_id).toBe("pd-local-1");
    expect(body.side).toBe("buy");
    expect(body.qty).toBe("5");
  });

  it("submits a bracket order when both stop-loss and take-profit are set on a buy", async () => {
    createOrderMock.mockResolvedValue({ id: "alpaca-2", status: "accepted" });
    const adapter = new AlpacaBrokerAdapter();

    await adapter.submitOrder(baseInput({ stopLossPrice: 90, takeProfitPrice: 120 }));

    const body = createOrderMock.mock.calls[0]![0];
    expect(body.order_class).toBe("bracket");
    expect(body.stop_loss).toEqual({ stop_price: "90.00" });
    expect(body.take_profit).toEqual({ limit_price: "120.00" });
  });

  it("submits an OTO order with only a stop-loss leg when no take-profit is given", async () => {
    createOrderMock.mockResolvedValue({ id: "alpaca-3", status: "accepted" });
    const adapter = new AlpacaBrokerAdapter();

    await adapter.submitOrder(baseInput({ stopLossPrice: 90 }));

    const body = createOrderMock.mock.calls[0]![0];
    expect(body.order_class).toBe("oto");
    expect(body.stop_loss).toEqual({ stop_price: "90.00" });
    expect(body.take_profit).toBeUndefined();
  });

  it("never attaches protective legs to a SELL order, mirroring the simulated engine", async () => {
    createOrderMock.mockResolvedValue({ id: "alpaca-4", status: "accepted" });
    const adapter = new AlpacaBrokerAdapter();

    await adapter.submitOrder(baseInput({ side: "SELL", stopLossPrice: 90, takeProfitPrice: 120 }));

    const body = createOrderMock.mock.calls[0]![0];
    expect(body.order_class).toBeUndefined();
    expect(body.stop_loss).toBeUndefined();
    expect(body.take_profit).toBeUndefined();
  });

  it("maps LIMIT orders to a limit_price field", async () => {
    createOrderMock.mockResolvedValue({ id: "alpaca-5", status: "accepted" });
    const adapter = new AlpacaBrokerAdapter();

    await adapter.submitOrder(baseInput({ type: "LIMIT", limitPrice: 123.456 }));

    const body = createOrderMock.mock.calls[0]![0];
    expect(body.type).toBe("limit");
    expect(body.limit_price).toBe("123.46");
  });

  it("forwards cancellation to the Alpaca client by external order id", async () => {
    cancelOrderMock.mockResolvedValue(undefined);
    const adapter = new AlpacaBrokerAdapter();

    await adapter.cancelOrder("alpaca-9");
    expect(cancelOrderMock).toHaveBeenCalledWith("alpaca-9");
  });
});
