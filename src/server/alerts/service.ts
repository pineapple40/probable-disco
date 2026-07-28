import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/server/audit/log";

export interface CreateAlertInput {
  name: string;
  conditionType: "price_above" | "price_below" | "pct_change_above" | "pct_change_below" | "volume_above";
  symbol?: string;
  value: number;
  cooldownMinutes?: number;
}

export async function listAlerts(userId: string) {
  return prisma.alert.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function createAlert(userId: string, input: CreateAlertInput) {
  const alert = await prisma.alert.create({
    data: {
      userId,
      name: input.name,
      conditionType: input.conditionType,
      symbol: input.symbol?.toUpperCase(),
      config: { value: input.value },
      cooldownMinutes: input.cooldownMinutes ?? 15,
    },
  });
  await recordAuditEvent({ userId, category: "data", action: "alert_created", targetId: alert.id });
  return alert;
}

export async function deleteAlert(userId: string, alertId: string) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert || alert.userId !== userId) throw new Error("Alert not found.");
  await prisma.alert.delete({ where: { id: alertId } });
}

export async function setAlertActive(userId: string, alertId: string, isActive: boolean) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert || alert.userId !== userId) throw new Error("Alert not found.");
  return prisma.alert.update({ where: { id: alertId }, data: { isActive } });
}

export async function listNotifications(userId: string, unreadOnly = false) {
  return prisma.notification.findMany({
    where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function markNotificationRead(userId: string, notificationId: string) {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.userId !== userId) throw new Error("Notification not found.");
  return prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
}

/**
 * Creates a notification unless one with the same dedupeKey was already
 * created within the last `cooldownMinutes` - prevents alert/event spam.
 */
export async function createNotificationDeduped(params: {
  userId: string;
  alertId?: string;
  category: string;
  title: string;
  body: string;
  dedupeKey: string;
  cooldownMinutes: number;
}) {
  const since = new Date(Date.now() - params.cooldownMinutes * 60 * 1000);
  const recent = await prisma.notification.findFirst({
    where: { dedupeKey: params.dedupeKey, createdAt: { gte: since } },
  });
  if (recent) return null;

  return prisma.notification.create({
    data: {
      userId: params.userId,
      alertId: params.alertId,
      category: params.category,
      title: params.title,
      body: params.body,
      dedupeKey: params.dedupeKey,
    },
  });
}
