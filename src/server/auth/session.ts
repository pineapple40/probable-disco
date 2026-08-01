import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { generateToken, hashToken } from "@/lib/crypto";

export const SESSION_COOKIE_NAME = "session_token";

export interface SessionMeta {
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  role: { key: string; name: string; permissions: string[] };
  emailVerifiedAt: Date | null;
}

function sessionExpiry(): Date {
  return new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
}

/** Creates a DB-backed session and returns the raw token to set as a cookie. */
export async function createSession(userId: string, meta: SessionMeta = {}): Promise<string> {
  const rawToken = generateToken(32);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
      expiresAt: sessionExpiry(),
    },
  });
  return rawToken;
}

export async function setSessionCookie(rawToken: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_TTL_HOURS * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

/** Validates a raw session token and returns the session + user, or null. */
export async function resolveSession(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { role: true } } },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  if (!session.user.isActive) return null;

  // Throttle lastSeenAt writes to at most once per minute per session.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date() },
    });
  }

  return session;
}

/** Reads the current request's session cookie and resolves the authenticated user, if any. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const rawToken = store.get(SESSION_COOKIE_NAME)?.value;
  if (!rawToken) return null;
  const session = await resolveSession(rawToken);
  if (!session) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    role: {
      key: session.user.role.key,
      name: session.user.role.name,
      permissions: session.user.role.permissions,
    },
    emailVerifiedAt: session.user.emailVerifiedAt,
  };
}

export async function revokeSession(sessionId: string, reason = "user_logout"): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeSessionByToken(rawToken: string, reason = "user_logout"): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await prisma.session
    .update({
      where: { tokenHash },
      data: { revokedAt: new Date(), revokedReason: reason },
    })
    .catch(() => undefined);
}

export async function revokeAllSessionsForUser(
  userId: string,
  reason = "revoked_by_user",
): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export function hasPermission(user: AuthenticatedUser, permission: string): boolean {
  return user.role.permissions.includes(permission);
}
