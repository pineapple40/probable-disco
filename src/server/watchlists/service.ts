import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/server/audit/log";

export async function listWatchlists(userId: string) {
  return prisma.watchlist.findMany({
    where: { userId },
    include: {
      symbols: {
        include: { instrument: true },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function createWatchlist(userId: string, name: string) {
  const watchlist = await prisma.watchlist.create({ data: { userId, name } });
  await recordAuditEvent({ userId, category: "data", action: "watchlist_created", targetId: watchlist.id });
  return watchlist;
}

export async function deleteWatchlist(userId: string, watchlistId: string) {
  const watchlist = await prisma.watchlist.findUnique({ where: { id: watchlistId } });
  if (!watchlist || watchlist.userId !== userId) throw new Error("Watchlist not found.");
  await prisma.watchlist.delete({ where: { id: watchlistId } });
  await recordAuditEvent({ userId, category: "data", action: "watchlist_deleted", targetId: watchlistId });
}

export async function addSymbolToWatchlist(userId: string, watchlistId: string, symbol: string) {
  const watchlist = await prisma.watchlist.findUnique({ where: { id: watchlistId } });
  if (!watchlist || watchlist.userId !== userId) throw new Error("Watchlist not found.");

  const instrument = await prisma.instrument.findUnique({ where: { symbol: symbol.toUpperCase() } });
  if (!instrument) throw new Error(`Unknown symbol ${symbol}.`);

  const count = await prisma.watchlistSymbol.count({ where: { watchlistId } });
  const entry = await prisma.watchlistSymbol.upsert({
    where: { watchlistId_instrumentId: { watchlistId, instrumentId: instrument.id } },
    update: {},
    create: { watchlistId, instrumentId: instrument.id, sortOrder: count },
  });
  await recordAuditEvent({
    userId,
    category: "data",
    action: "watchlist_symbol_added",
    targetId: watchlistId,
    detail: { symbol: instrument.symbol },
  });
  return entry;
}

export async function removeSymbolFromWatchlist(userId: string, watchlistId: string, symbolEntryId: string) {
  const watchlist = await prisma.watchlist.findUnique({ where: { id: watchlistId } });
  if (!watchlist || watchlist.userId !== userId) throw new Error("Watchlist not found.");
  await prisma.watchlistSymbol.delete({ where: { id: symbolEntryId } });
  await recordAuditEvent({
    userId,
    category: "data",
    action: "watchlist_symbol_removed",
    targetId: watchlistId,
  });
}
