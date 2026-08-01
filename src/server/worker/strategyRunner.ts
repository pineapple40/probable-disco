import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getMarketDataProvider } from "@/server/market-data/provider";
import { startOfUtcDay } from "@/server/market-data/calendar";
import { evaluateEntry, evaluateExit, type StrategyBar } from "@/server/strategy/evaluator";
import type { StrategyDefinition } from "@/server/strategy/types";
import { placeOrder } from "@/server/orders/service";
import { recordAuditEvent } from "@/server/audit/log";
import { createNotificationDeduped } from "@/server/alerts/service";

const WARMUP_DAYS = 90;
const MAX_CONSECUTIVE_ERRORS = 5;

interface RunState {
  openPositions?: Record<string, number>; // symbol -> quantity this run entered with
  consecutiveErrorsBySymbol?: Record<string, number>;
}

/**
 * Loads completed daily bars only. The simulated provider generates a full
 * (deterministic) daily candle for "today" the instant it's asked for one,
 * regardless of the actual time of day - so including it here would let the
 * strategy react to today's already-decided end-of-day close before the
 * trading day is actually over (look-ahead). Only bars strictly before today
 * are used to decide; any resulting order still fills at the current live
 * quote.
 */
export async function loadBars(symbol: string): Promise<StrategyBar[]> {
  const instrument = await prisma.instrument.findUniqueOrThrow({ where: { symbol } });
  const provider = getMarketDataProvider();
  const to = new Date();
  const from = new Date(to.getTime() - WARMUP_DAYS * 24 * 60 * 60 * 1000);
  const candles = await provider.getCandles(instrument.id, symbol, "D1", from, to);
  const todayStart = startOfUtcDay(to).getTime();
  return candles
    .filter((c) => c.ts.getTime() < todayStart)
    .map((c) => ({
      ts: c.ts,
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
      volume: Number(c.volume),
    }));
}

async function logRun(runId: string, level: "info" | "warn" | "error", message: string, detail?: unknown) {
  await prisma.strategyRunLog.create({ data: { strategyRunId: runId, level, message, detail: detail as never } });
}

async function tickRun(run: {
  id: string;
  accountId: string;
  strategyVersionId: string;
  state: unknown;
}) {
  const account = await prisma.account.findUnique({ where: { id: run.accountId } });
  const version = await prisma.strategyVersion.findUnique({ where: { id: run.strategyVersionId } });
  if (!account || !version) {
    await prisma.strategyRun.update({
      where: { id: run.id },
      data: { status: "error" },
    });
    await logRun(run.id, "error", "Missing account or strategy version; run stopped.");
    return;
  }

  const definition = version.definition as unknown as StrategyDefinition;
  const state = (run.state as RunState | null) ?? {};
  const openPositions: Record<string, number> = { ...(state.openPositions ?? {}) };
  const consecutiveErrorsBySymbol: Record<string, number> = { ...(state.consecutiveErrorsBySymbol ?? {}) };
  const todayKey = new Date().toISOString().slice(0, 10);

  for (const symbol of definition.symbols) {
    try {
      const bars = await loadBars(symbol);
      if (bars.length < 2) continue;
      const lastIndex = bars.length - 1;

      const ownedQuantity = openPositions[symbol] ?? 0;
      if (ownedQuantity > 0) {
        const position = await prisma.position.findFirst({
          where: { accountId: run.accountId, instrument: { symbol }, quantity: { gt: 0 } },
        });
        if (!position) {
          // Position was closed outside the runner (e.g. manually); reconcile state.
          delete openPositions[symbol];
          continue;
        }
        const exitEval = evaluateExit(definition, bars, lastIndex, {
          entryPrice: Number(position.avgEntryPrice),
          entryIndex: 0,
        });
        if (exitEval.shouldExit) {
          // Only sell the quantity this run actually entered with - never
          // liquidate shares of the same symbol held outside this run (a
          // manual purchase, or another strategy run sharing the account).
          const sellQuantity = Math.min(ownedQuantity, Number(position.quantity));
          if (sellQuantity > 0) {
            const result = await placeOrder(account.userId, {
              symbol,
              side: "SELL",
              type: "MARKET",
              quantity: sellQuantity,
              duration: "DAY",
              isExtendedHours: false,
              idempotencyKey: `strategyRun:${run.id}:${symbol}:${todayKey}:exit`,
            });

            await prisma.order.updateMany({
              where: { id: result.order.id },
              data: { strategyRunId: run.id },
            });

            if (result.order.status === "FILLED") {
              delete openPositions[symbol];
              await logRun(run.id, "info", `Exited ${symbol}`, { reason: exitEval.reason, quantity: sellQuantity });
            } else if (result.order.status === "REJECTED") {
              await logRun(run.id, "warn", `Exit order for ${symbol} rejected`, {
                reason: result.order.rejectReason,
              });
            }
          }
        }
      } else {
        const entryCountToday = await prisma.order.count({
          where: {
            strategyRunId: run.id,
            instrument: { symbol },
            side: "BUY",
            submittedAt: { gte: new Date(`${todayKey}T00:00:00.000Z`) },
          },
        });
        if (entryCountToday >= definition.maxTradesPerDay) continue;

        if (evaluateEntry(definition, bars, lastIndex)) {
          const lastClose = bars[lastIndex]!.close;
          const quantity =
            definition.positionSizing.method === "fixed_quantity"
              ? definition.positionSizing.value
              : Math.floor(definition.positionSizing.value / lastClose);
          if (quantity <= 0) continue;

          const stopLossPrice = definition.stopLossPct
            ? lastClose * (1 - definition.stopLossPct / 100)
            : undefined;
          const takeProfitPrice = definition.takeProfitPct
            ? lastClose * (1 + definition.takeProfitPct / 100)
            : undefined;

          const result = await placeOrder(account.userId, {
            symbol,
            side: "BUY",
            type: "MARKET",
            quantity,
            duration: "DAY",
            isExtendedHours: false,
            stopLossPrice,
            takeProfitPrice,
            idempotencyKey: `strategyRun:${run.id}:${symbol}:${todayKey}:entry`,
          });

          await prisma.order.updateMany({
            where: { id: result.order.id },
            data: { strategyRunId: run.id },
          });

          if (result.order.status === "FILLED") {
            openPositions[symbol] = Number(result.order.filledQuantity);
            await logRun(run.id, "info", `Entered ${symbol}`, { quantity, lastClose });
          } else if (result.order.status === "REJECTED") {
            await logRun(run.id, "warn", `Entry order for ${symbol} rejected`, {
              reason: result.order.rejectReason,
            });
          }
        }
      }
      consecutiveErrorsBySymbol[symbol] = 0;
    } catch (err) {
      consecutiveErrorsBySymbol[symbol] = (consecutiveErrorsBySymbol[symbol] ?? 0) + 1;
      logger.error({ err, runId: run.id, symbol }, "Strategy runner tick failed for symbol");
      await logRun(run.id, "error", `Error evaluating ${symbol}: ${(err as Error).message}`);
    }
  }

  // Pause the run if any single symbol has failed repeatedly - tracking this
  // per-symbol (rather than one shared counter across all symbols) means a
  // persistently broken symbol can't hide behind other symbols succeeding on
  // the same tick.
  const maxConsecutiveErrors = Math.max(0, ...Object.values(consecutiveErrorsBySymbol));
  const newStatus = maxConsecutiveErrors >= MAX_CONSECUTIVE_ERRORS ? "error" : "running";
  await prisma.strategyRun.update({
    where: { id: run.id },
    data: {
      state: { openPositions, consecutiveErrorsBySymbol } as never,
      lastHeartbeatAt: new Date(),
      status: newStatus,
    },
  });

  if (newStatus === "error") {
    await logRun(run.id, "error", "Run paused after repeated errors (safety pause).");
    await recordAuditEvent({
      category: "strategy",
      action: "strategy_run_auto_paused",
      targetId: run.id,
    });
    await createNotificationDeduped({
      userId: account.userId,
      category: "strategy",
      title: "Strategy run auto-paused",
      body: `A strategy run hit repeated errors and was automatically paused for safety.`,
      dedupeKey: `strategy_run:${run.id}:auto_paused`,
      cooldownMinutes: 60,
    });
  }
}

/** Processes every currently-running strategy run once. Safe to call on an interval. */
export async function tickStrategyRuns(): Promise<{ processed: number }> {
  const runs = await prisma.strategyRun.findMany({ where: { status: "running" } });
  for (const run of runs) {
    try {
      await tickRun(run);
    } catch (err) {
      logger.error({ err, runId: run.id }, "Unhandled error processing strategy run");
    }
  }
  return { processed: runs.length };
}
