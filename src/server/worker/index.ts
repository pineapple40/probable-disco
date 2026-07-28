import "dotenv/config";
import { logger } from "@/lib/logger";
import { tickStrategyRuns } from "@/server/worker/strategyRunner";
import { evaluateAlerts } from "@/server/alerts/evaluator";

const TICK_INTERVAL_MS = 60_000;
let stopping = false;

async function tick() {
  if (stopping) return;
  try {
    const { processed } = await tickStrategyRuns();
    if (processed > 0) logger.info({ processed }, "Strategy runner tick complete");
  } catch (err) {
    logger.error({ err }, "Strategy runner tick failed");
  }

  try {
    const { triggered } = await evaluateAlerts();
    if (triggered > 0) logger.info({ triggered }, "Alert evaluation tick complete");
  } catch (err) {
    logger.error({ err }, "Alert evaluation tick failed");
  }
}

async function main() {
  logger.info({ intervalMs: TICK_INTERVAL_MS }, "Background worker starting (strategy runner + alerts)");
  await tick();
  const interval = setInterval(tick, TICK_INTERVAL_MS);

  const shutdown = () => {
    stopping = true;
    clearInterval(interval);
    logger.info("Background worker stopped");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "Background worker crashed");
  process.exit(1);
});
