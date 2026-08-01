import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { jsonError, jsonOk } from "@/server/http/respond";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const instruments = await prisma.instrument.findMany({
    where: q
      ? {
          OR: [
            { symbol: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    orderBy: { symbol: "asc" },
    take: 25,
  });

  return jsonOk(
    instruments.map((i) => ({
      id: i.id,
      symbol: i.symbol,
      name: i.name,
      exchange: i.exchange,
      isTradable: i.isTradable,
      isFractionable: i.isFractionable,
    })),
  );
}
