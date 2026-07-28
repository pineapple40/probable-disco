import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/server/audit/log";

export interface JournalEntryInput {
  title: string;
  symbol?: string;
  orderId?: string;
  setupType?: string;
  strategyName?: string;
  confidence?: number;
  mistakes?: string;
  lessons?: string;
  emotionalState?: string;
  prePlan?: string;
  postReview?: string;
  tags: string[];
}

export async function listJournalEntries(userId: string, filters: { symbol?: string; tag?: string }) {
  return prisma.journalEntry.findMany({
    where: {
      userId,
      ...(filters.symbol ? { symbol: filters.symbol.toUpperCase() } : {}),
      ...(filters.tag ? { tags: { has: filters.tag } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createJournalEntry(userId: string, input: JournalEntryInput) {
  const entry = await prisma.journalEntry.create({
    data: {
      userId,
      title: input.title,
      symbol: input.symbol?.toUpperCase(),
      orderId: input.orderId,
      setupType: input.setupType,
      strategyName: input.strategyName,
      confidence: input.confidence,
      mistakes: input.mistakes,
      lessons: input.lessons,
      emotionalState: input.emotionalState,
      prePlan: input.prePlan,
      postReview: input.postReview,
      tags: input.tags,
    },
  });
  await recordAuditEvent({ userId, category: "data", action: "journal_entry_created", targetId: entry.id });
  return entry;
}

export async function updateJournalEntry(
  userId: string,
  entryId: string,
  input: Partial<JournalEntryInput>,
) {
  const existing = await prisma.journalEntry.findUnique({ where: { id: entryId } });
  if (!existing || existing.userId !== userId) throw new Error("Journal entry not found.");

  const entry = await prisma.journalEntry.update({
    where: { id: entryId },
    data: {
      ...input,
      symbol: input.symbol ? input.symbol.toUpperCase() : undefined,
    },
  });
  await recordAuditEvent({ userId, category: "data", action: "journal_entry_updated", targetId: entryId });
  return entry;
}

export async function deleteJournalEntry(userId: string, entryId: string) {
  const existing = await prisma.journalEntry.findUnique({ where: { id: entryId } });
  if (!existing || existing.userId !== userId) throw new Error("Journal entry not found.");
  await prisma.journalEntry.delete({ where: { id: entryId } });
  await recordAuditEvent({ userId, category: "data", action: "journal_entry_deleted", targetId: entryId });
}
