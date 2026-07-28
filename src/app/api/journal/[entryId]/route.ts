import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { updateJournalEntry, deleteJournalEntry } from "@/server/journal/service";
import { jsonError, jsonOk, jsonValidationError } from "@/server/http/respond";

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  symbol: z.string().max(10).optional(),
  setupType: z.string().max(100).optional(),
  strategyName: z.string().max(100).optional(),
  confidence: z.coerce.number().min(1).max(5).optional(),
  mistakes: z.string().max(4000).optional(),
  lessons: z.string().max(4000).optional(),
  emotionalState: z.string().max(100).optional(),
  prePlan: z.string().max(4000).optional(),
  postReview: z.string().max(4000).optional(),
  tags: z.array(z.string().max(40)).optional(),
});

export async function PATCH(req: NextRequest, context: { params: Promise<{ entryId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return jsonValidationError(parsed.error);

  const { entryId } = await context.params;
  try {
    const entry = await updateJournalEntry(user.id, entryId, parsed.data);
    return jsonOk(entry);
  } catch (err) {
    return jsonError(404, "not_found", err instanceof Error ? err.message : "Not found.");
  }
}

export async function DELETE(_req: Request, context: { params: Promise<{ entryId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "unauthenticated", "You must be signed in.");

  const { entryId } = await context.params;
  try {
    await deleteJournalEntry(user.id, entryId);
    return jsonOk({ deleted: true });
  } catch (err) {
    return jsonError(404, "not_found", err instanceof Error ? err.message : "Not found.");
  }
}
