import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import {
  createWatchlist,
  addSymbolToWatchlist,
  removeSymbolFromWatchlist,
} from "@/server/watchlists/service";

let userAId: string;
let userBId: string;

async function makeUser(): Promise<string> {
  const traderRole = await prisma.role.findUniqueOrThrow({ where: { key: "trader" } });
  const email = `test-watchlists-${randomUUID()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("Test!Password123"),
      displayName: "Watchlist Test User",
      roleId: traderRole.id,
      emailVerifiedAt: new Date(),
    },
  });
  return user.id;
}

beforeAll(async () => {
  userAId = await makeUser();
  userBId = await makeUser();
}, 30_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
});

describe("removeSymbolFromWatchlist (integration)", () => {
  it("does not let a user delete a symbol entry belonging to another user's watchlist (IDOR)", async () => {
    const watchlistA = await createWatchlist(userAId, "A's list");
    const entryA = await addSymbolToWatchlist(userAId, watchlistA.id, "AAPL");

    const watchlistB = await createWatchlist(userBId, "B's list");

    // User B owns watchlistB, but tries to delete user A's symbol entry by
    // guessing/reusing its id alongside their own watchlistId.
    await expect(removeSymbolFromWatchlist(userBId, watchlistB.id, entryA.id)).rejects.toThrow();

    const stillThere = await prisma.watchlistSymbol.findUnique({ where: { id: entryA.id } });
    expect(stillThere).not.toBeNull();
  });

  it("still lets the owning user remove their own symbol entry", async () => {
    const watchlist = await createWatchlist(userAId, "A's second list");
    const entry = await addSymbolToWatchlist(userAId, watchlist.id, "MSFT");

    await removeSymbolFromWatchlist(userAId, watchlist.id, entry.id);

    const gone = await prisma.watchlistSymbol.findUnique({ where: { id: entry.id } });
    expect(gone).toBeNull();
  });
});
