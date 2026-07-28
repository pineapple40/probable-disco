import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { getMarketDataProvider } from "@/server/market-data/provider";
import { jsonError } from "@/server/http/respond";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 2000;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const symbolsParam = req.nextUrl.searchParams.get("symbols") ?? "";
  const symbols = Array.from(
    new Set(
      symbolsParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ).slice(0, 25);

  if (symbols.length === 0) {
    return jsonError(400, "missing_symbols", "symbols query parameter is required.");
  }

  const instruments = await prisma.instrument.findMany({ where: { symbol: { in: symbols } } });
  const provider = getMarketDataProvider();

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const tick = async () => {
        if (closed) return;
        for (const instrument of instruments) {
          try {
            const quote = await provider.getQuote(instrument.id, instrument.symbol);
            send("quote", quote);
          } catch (err) {
            send("error", { symbol: instrument.symbol, message: (err as Error).message });
          }
        }
      };

      await tick();
      const interval = setInterval(tick, POLL_INTERVAL_MS);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        controller.close();
      });
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
