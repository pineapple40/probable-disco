import "dotenv/config";
import { logger } from "@/lib/logger";
import { tickStrategyRuns } from "@/server/worker/strategyRunner";

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
}

async function main() {
  logger.info({ intervalMs: TICK_INTERVAL_MS }, "Paper strategy runner worker starting");
  await tick();
  const interval = setInterval(tick, TICK_INTERVAL_MS);

  const shutdown = () => {
    stopping = true;
    clearInterval(interval);
    logger.info("Paper strategy runner worker stopped");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "Paper strategy runner worker crashed");
  process.exit(1);
});
