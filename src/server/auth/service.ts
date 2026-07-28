import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { generateToken, hashToken } from "@/lib/crypto";
import { assessPasswordStrength, hashPassword, verifyPassword } from "@/lib/password";
import { sendEmail } from "@/server/notifications/email";
import { recordAuditEvent } from "@/server/audit/log";
import { createSession, revokeAllSessionsForUser, type SessionMeta } from "@/server/auth/session";
import { verifyMfaCode, verifyRecoveryCode } from "@/server/auth/mfa";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

// A fixed bcrypt hash used to keep the login timing profile similar whether
// or not the email exists, reducing (not eliminating) account enumeration.
const DUMMY_HASH = "$2b$12$Ci0jWi3vBn3iN1yQO2qk8OJ6Wt5r0m3sQ0h9c6kK4y9vXn2Zc3z8u";

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export async function registerUser(input: RegisterInput, meta: SessionMeta) {
  if (!env.FEATURE_SIGNUP_ENABLED) {
    throw new AuthError("signup_disabled", "Registration is currently disabled.");
  }

  const strength = assessPasswordStrength(input.password);
  if (!strength.valid) {
    throw new AuthError("weak_password", strength.reasons.join(" "));
  }

  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    // Do not reveal that the account exists; behave like a normal signup.
    await recordAuditEvent({
      category: "security",
      action: "register_attempt_existing_email",
      ipAddress: meta.ipAddress,
    });
    return { requiresVerification: true };
  }

  const traderRole = await prisma.role.findUniqueOrThrow({ where: { key: "trader" } });
  const passwordHash = await hashPassword(input.password);

  // Creating the user and bootstrapping their trader resources (broker
  // connection, account, risk profile, watchlist) must be atomic - if any
  // step failed partway with these as separate writes, the user row would
  // exist but be missing resources (e.g. no trading account), and re-running
  // registration with the same email would then just no-op (by design, to
  // avoid revealing whether an email is registered) rather than retry the
  // bootstrap, leaving the account permanently broken.
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        roleId: traderRole.id,
      },
    });
    await bootstrapTraderResources(tx, created.id);
    return created;
  });

  await issueEmailVerification(user.id, user.email);

  await recordAuditEvent({
    userId: user.id,
    category: "auth",
    action: "register",
    ipAddress: meta.ipAddress,
  });

  return { requiresVerification: true };
}

export async function bootstrapTraderResources(tx: Prisma.TransactionClient, userId: string) {
  const brokerConnection = await tx.brokerConnection.create({
    data: {
      userId,
      provider: "SIMULATED",
      label: "Simulated Paper Broker",
      isPaper: true,
      isLiveTradingReady: false,
      status: "connected",
      lastCheckedAt: new Date(),
    },
  });

  await tx.marketDataConnection.create({
    data: {
      userId,
      provider: "simulated",
      sourceType: "SIMULATED",
      status: "connected",
      lastCheckedAt: new Date(),
    },
  });

  const account = await tx.account.create({
    data: {
      userId,
      brokerConnectionId: brokerConnection.id,
      label: "Paper Trading Account",
      currency: "USD",
      cash: 100000,
      equity: 100000,
      buyingPower: 200000,
      isPaper: true,
    },
  });

  await tx.riskProfile.create({ data: { userId, accountId: account.id } });
  await tx.emergencyTradingLock.create({ data: { userId, accountId: account.id } });
  await tx.watchlist.create({ data: { userId, name: "My Watchlist" } });
}

async function issueEmailVerification(userId: string, email: string) {
  const rawToken = generateToken(32);
  const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: hashToken(rawToken), expiresAt },
  });
  const link = `${env.APP_URL}/verify-email?token=${rawToken}`;
  await sendEmail({
    to: email,
    subject: "Verify your Probable Disco account",
    text: `Welcome to Probable Disco. Verify your email by visiting:\n\n${link}\n\nThis link expires in ${env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS} hours.`,
  });
}

export async function verifyEmail(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    throw new AuthError("invalid_token", "This verification link is invalid or has expired.");
  }
  await prisma.$transaction([
    prisma.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailVerificationToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    }),
  ]);
  await recordAuditEvent({ userId: token.userId, category: "auth", action: "verify_email" });
}

export async function requestPasswordReset(email: string, meta: SessionMeta) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Always behave the same way regardless of whether the account exists.
  if (!user) {
    await recordAuditEvent({
      category: "security",
      action: "password_reset_requested_unknown_email",
      ipAddress: meta.ipAddress,
    });
    return;
  }
  const rawToken = generateToken(32);
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000);
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(rawToken), expiresAt },
  });
  const link = `${env.APP_URL}/reset-password?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your Probable Disco password",
    text: `A password reset was requested for your account. Visit:\n\n${link}\n\nThis link expires in ${env.PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
  });
  await recordAuditEvent({
    userId: user.id,
    category: "auth",
    action: "password_reset_requested",
    ipAddress: meta.ipAddress,
  });
}

export async function resetPassword(rawToken: string, newPassword: string) {
  const strength = assessPasswordStrength(newPassword);
  if (!strength.valid) {
    throw new AuthError("weak_password", strength.reasons.join(" "));
  }
  const tokenHash = hashToken(rawToken);
  const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
  if (!token || token.usedAt || token.expiresAt.getTime() < Date.now()) {
    throw new AuthError("invalid_token", "This reset link is invalid or has expired.");
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: token.userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    }),
    // Invalidate every outstanding reset token for this user, not just the
    // one just used - otherwise an older, still-valid token (e.g. from a
    // second reset request, or one intercepted from an earlier email) could
    // still be redeemed to reset the password again after this one succeeds.
    prisma.passwordResetToken.updateMany({
      where: { userId: token.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);
  await revokeAllSessionsForUser(token.userId, "password_reset");
  await recordAuditEvent({ userId: token.userId, category: "security", action: "password_reset" });
}

interface LoginInput {
  email: string;
  password: string;
  mfaCode?: string;
  recoveryCode?: string;
}

export async function login(input: LoginInput, meta: SessionMeta) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { role: true, mfaConfig: true },
  });

  const passwordOk = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.isActive) {
    await recordAuditEvent({
      category: "auth",
      action: "login_failed_unknown_user",
      ipAddress: meta.ipAddress,
      detail: { email: input.email },
    });
    throw new AuthError("invalid_credentials", "Invalid email or password.");
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordAuditEvent({
      userId: user.id,
      category: "security",
      action: "login_blocked_locked",
      ipAddress: meta.ipAddress,
    });
    throw new AuthError(
      "account_locked",
      `Account temporarily locked due to repeated failed logins. Try again after ${user.lockedUntil.toISOString()}.`,
    );
  }

  if (!passwordOk) {
    const failedLoginCount = user.failedLoginCount + 1;
    const lockedUntil =
      failedLoginCount >= MAX_FAILED_LOGINS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount, lockedUntil },
    });
    await recordAuditEvent({
      userId: user.id,
      category: "auth",
      action: "login_failed",
      ipAddress: meta.ipAddress,
      detail: { failedLoginCount },
    });
    throw new AuthError("invalid_credentials", "Invalid email or password.");
  }

  if (user.mfaConfig?.enabled) {
    let mfaOk = false;
    if (input.mfaCode) {
      mfaOk = await verifyMfaCode(user.id, input.mfaCode);
    } else if (input.recoveryCode) {
      mfaOk = await verifyRecoveryCode(user.id, input.recoveryCode);
    } else {
      throw new AuthError("mfa_required", "Multi-factor authentication code required.");
    }
    if (!mfaOk) {
      await recordAuditEvent({
        userId: user.id,
        category: "security",
        action: "mfa_failed",
        ipAddress: meta.ipAddress,
      });
      throw new AuthError("mfa_invalid", "Invalid multi-factor authentication code.");
    }
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null },
  });

  const rawToken = await createSession(user.id, meta);

  await recordAuditEvent({
    userId: user.id,
    category: "auth",
    action: "login_success",
    ipAddress: meta.ipAddress,
  });

  return { rawToken, user };
}
