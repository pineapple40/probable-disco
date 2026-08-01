import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/server/auth/session";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  filters: z.record(z.string(), z.unknown()),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");
  const presets = await prisma.scannerPreset.findMany({ where: { userId: user.id } });
  return jsonOk(presets.map((p) => ({ id: p.id, name: p.name, filters: p.filters })));
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const preset = await prisma.scannerPreset.upsert({
    where: { userId_name: { userId: user.id, name: parsed.data.name } },
    update: { filters: parsed.data.filters as never },
    create: { userId: user.id, name: parsed.data.name, filters: parsed.data.filters as never },
  });
  return jsonOk({ id: preset.id }, 201);
}
