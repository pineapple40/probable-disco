import { prisma } from "@/lib/db";
import { getMarketDataProvider } from "@/server/market-data/provider";
import { createNotificationDeduped } from "@/server/alerts/service";

/** Evaluates every active price/volume alert against current simulated quotes. */
export async function evaluateAlerts(): Promise<{ triggered: number }> {
  const alerts = await prisma.alert.findMany({ where: { isActive: true, symbol: { not: null } } });
  const provider = getMarketDataProvider();
  let triggered = 0;

  for (const alert of alerts) {
    try {
      const instrument = await prisma.instrument.findUnique({ where: { symbol: alert.symbol! } });
      if (!instrument) continue;
      const quote = await provider.getQuote(instrument.id, instrument.symbol);
      const config = alert.config as { value: number };
      const value = config.value;

      let hit = false;
      let detail = "";
      switch (alert.conditionType) {
        case "price_above":
          hit = quote.last > value;
          detail = `${alert.symbol} last ${quote.last.toFixed(2)} > ${value}`;
          break;
        case "price_below":
          hit = quote.last < value;
          detail = `${alert.symbol} last ${quote.last.toFixed(2)} < ${value}`;
          break;
        case "pct_change_above":
          hit = quote.changePct > value;
          detail = `${alert.symbol} change ${quote.changePct.toFixed(2)}% > ${value}%`;
          break;
        case "pct_change_below":
          hit = quote.changePct < value;
          detail = `${alert.symbol} change ${quote.changePct.toFixed(2)}% < ${value}%`;
          break;
        case "volume_above":
          hit = quote.volume > value;
          detail = `${alert.symbol} volume ${quote.volume.toLocaleString()} > ${value.toLocaleString()}`;
          break;
      }

      if (hit) {
        const created = await createNotificationDeduped({
          userId: alert.userId,
          alertId: alert.id,
          category: "alert",
          title: alert.name,
          body: detail,
          dedupeKey: `alert:${alert.id}`,
          cooldownMinutes: alert.cooldownMinutes,
        });
        if (created) {
          triggered++;
          await prisma.alert.update({ where: { id: alert.id }, data: { lastTriggeredAt: new Date() } });
        }
      }
    } catch {
      // Isolate failures per alert; one bad alert must not block the others.
      continue;
    }
  }

  return { triggered };
}
