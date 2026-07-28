import "server-only";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/server/audit/log";
import { validateStrategyDefinition, type StrategyDefinition } from "@/server/strategy/types";

export async function listStrategies(userId: string) {
  return prisma.strategy.findMany({
    where: { userId },
    include: { versions: { orderBy: { version: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function createStrategy(
  userId: string,
  name: string,
  description: string | undefined,
  definition: StrategyDefinition,
) {
  const validation = validateStrategyDefinition(definition);
  const strategy = await prisma.strategy.create({
    data: {
      userId,
      name,
      description,
      status: "DRAFT",
      versions: {
        create: {
          version: 1,
          definition: definition as never,
          isValid: validation.valid,
          validationErrors: validation.valid ? undefined : (validation.errors as never),
        },
      },
    },
    include: { versions: true },
  });
  await recordAuditEvent({ userId, category: "strategy", action: "strategy_created", targetId: strategy.id });
  return strategy;
}

export async function createStrategyVersion(userId: string, strategyId: string, definition: StrategyDefinition) {
  const strategy = await prisma.strategy.findUnique({ where: { id: strategyId }, include: { versions: true } });
  if (!strategy || strategy.userId !== userId) throw new Error("Strategy not found.");

  const validation = validateStrategyDefinition(definition);
  const nextVersion = Math.max(...strategy.versions.map((v) => v.version)) + 1;
  const version = await prisma.strategyVersion.create({
    data: {
      strategyId,
      version: nextVersion,
      definition: definition as never,
      isValid: validation.valid,
      validationErrors: validation.valid ? undefined : (validation.errors as never),
    },
  });
  await recordAuditEvent({
    userId,
    category: "strategy",
    action: "strategy_version_created",
    targetId: strategyId,
    detail: { version: nextVersion },
  });
  return version;
}

export async function setStrategyStatus(
  userId: string,
  strategyId: string,
  status: "ACTIVE" | "PAUSED" | "ARCHIVED",
) {
  const strategy = await prisma.strategy.findUnique({
    where: { id: strategyId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!strategy || strategy.userId !== userId) throw new Error("Strategy not found.");

  if (status === "ACTIVE") {
    const latest = strategy.versions[0];
    if (!latest?.isValid) {
      throw new Error("Cannot activate an invalid strategy. Fix validation errors first.");
    }
  }

  const updated = await prisma.strategy.update({ where: { id: strategyId }, data: { status } });
  await recordAuditEvent({
    userId,
    category: "strategy",
    action: `strategy_${status.toLowerCase()}`,
    targetId: strategyId,
  });
  return updated;
}
