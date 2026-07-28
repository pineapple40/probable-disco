import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { listJournalEntries, createJournalEntry } from "@/server/journal/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  symbol: z.string().max(10).optional(),
  orderId: z.string().optional(),
  setupType: z.string().max(100).optional(),
  strategyName: z.string().max(100).optional(),
  confidence: z.coerce.number().min(1).max(5).optional(),
  mistakes: z.string().max(4000).optional(),
  lessons: z.string().max(4000).optional(),
  emotionalState: z.string().max(100).optional(),
  prePlan: z.string().max(4000).optional(),
  postReview: z.string().max(4000).optional(),
  tags: z.array(z.string().max(40)).default([]),
});

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const symbol = req.nextUrl.searchParams.get("symbol") ?? undefined;
  const tag = req.nextUrl.searchParams.get("tag") ?? undefined;
  const entries = await listJournalEntries(user.id, { symbol, tag });
  return jsonOk(entries);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const entry = await createJournalEntry(user.id, parsed.data);
  return jsonOk(entry, 201);
}
