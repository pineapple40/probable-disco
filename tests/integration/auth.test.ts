import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  registerUser,
  login,
  resetPassword,
  bootstrapTraderResources,
  AuthError,
  MAX_FAILED_LOGINS,
} from "@/server/auth/service";
import { beginMfaEnrollment, confirmMfaEnrollment, MfaAlreadyEnabledError } from "@/server/auth/mfa";
import { generate } from "otplib";
import { generateToken, hashToken } from "@/lib/crypto";

const createdUserEmails: string[] = [];

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
});

function uniqueEmail(): string {
  const email = `test-auth-${randomUUID()}@example.com`;
  createdUserEmails.push(email);
  return email;
}

describe("registerUser + login (integration)", () => {
  it("registers a new user and requires email verification before nothing else blocks login", async () => {
    const email = uniqueEmail();
    const result = await registerUser(
      { email, password: "Str0ng!Passw0rd", displayName: "Test User" },
      { ipAddress: "127.0.0.1" },
    );
    expect(result.requiresVerification).toBe(true);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();

    // An account, risk profile, broker connection, and watchlist should all
    // have been bootstrapped for the new trader.
    const account = await prisma.account.findFirst({ where: { userId: user.id } });
    expect(account).not.toBeNull();
    const riskProfile = await prisma.riskProfile.findUnique({ where: { userId: user.id } });
    expect(riskProfile).not.toBeNull();
  });

  it("rejects registration with a weak password", async () => {
    const email = uniqueEmail();
    await expect(
      registerUser({ email, password: "weak", displayName: "Test" }, { ipAddress: "127.0.0.1" }),
    ).rejects.toThrow(AuthError);
  });

  it("logs in successfully with correct credentials and creates a session", async () => {
    const email = uniqueEmail();
    await registerUser({ email, password: "Str0ng!Passw0rd", displayName: "Test" }, {});
    const { rawToken, user } = await login({ email, password: "Str0ng!Passw0rd" }, { ipAddress: "127.0.0.1" });
    expect(rawToken).toBeTruthy();
    expect(user.email).toBe(email);

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
  });

  it("rejects login with an incorrect password", async () => {
    const email = uniqueEmail();
    await registerUser({ email, password: "Str0ng!Passw0rd", displayName: "Test" }, {});
    await expect(login({ email, password: "WrongPassword1!" }, {})).rejects.toThrow(AuthError);
  });

  it("locks the account after repeated failed logins", async () => {
    const email = uniqueEmail();
    await registerUser({ email, password: "Str0ng!Passw0rd", displayName: "Test" }, {});

    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await login({ email, password: "WrongPassword1!" }, {}).catch(() => undefined);
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.failedLoginCount).toBeGreaterThanOrEqual(MAX_FAILED_LOGINS);
    expect(user.lockedUntil).not.toBeNull();
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Even the correct password should now be rejected while locked.
    await expect(login({ email, password: "Str0ng!Passw0rd" }, {})).rejects.toThrow(AuthError);
  });

  it("resets the failed-login counter after a successful login", async () => {
    const email = uniqueEmail();
    await registerUser({ email, password: "Str0ng!Passw0rd", displayName: "Test" }, {});
    await login({ email, password: "WrongPassword1!" }, {}).catch(() => undefined);
    await login({ email, password: "Str0ng!Passw0rd" }, {});

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.failedLoginCount).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });
});

describe("MFA enrollment (integration)", () => {
  it("rejects re-enrollment once MFA is already enabled, without touching the active config", async () => {
    const email = uniqueEmail();
    await registerUser({ email, password: "Str0ng!Passw0rd", displayName: "Test" }, {});
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    const { secret } = await beginMfaEnrollment(user.id, email);
    const code = await generate({ secret });
    await confirmMfaEnrollment(user.id, code);

    const activeConfig = await prisma.mfaConfig.findUniqueOrThrow({ where: { userId: user.id } });
    expect(activeConfig.enabled).toBe(true);

    // Calling beginMfaEnrollment again (e.g. a hijacked session replaying the
    // enroll endpoint) must not silently disable or replace the active MFA
    // secret.
    await expect(beginMfaEnrollment(user.id, email)).rejects.toThrow(MfaAlreadyEnabledError);

    const unchangedConfig = await prisma.mfaConfig.findUniqueOrThrow({ where: { userId: user.id } });
    expect(unchangedConfig.enabled).toBe(true);
    expect(unchangedConfig.secret).toBe(activeConfig.secret);
  });
});

describe("resetPassword (integration)", () => {
  it("invalidates other outstanding reset tokens once one is redeemed", async () => {
    const email = uniqueEmail();
    await registerUser({ email, password: "Str0ng!Passw0rd", displayName: "Test" }, {});
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    // Two outstanding tokens, e.g. from two separate "forgot password"
    // requests (or one intercepted from an earlier email).
    const tokenOld = generateToken(32);
    const tokenNew = generateToken(32);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(tokenOld), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(tokenNew), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    await resetPassword(tokenNew, "NewStr0ng!Passw0rd");

    // The older, still-unused token must no longer be redeemable.
    await expect(resetPassword(tokenOld, "AnotherStr0ng!Passw0rd")).rejects.toThrow(AuthError);
  });
});

describe("bootstrapTraderResources (integration)", () => {
  it("rolls back every resource it created if a later step in the bootstrap fails", async () => {
    const email = uniqueEmail();
    await registerUser({ email, password: "Str0ng!Passw0rd", displayName: "Test" }, {});
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    // This user already has a full set of bootstrap resources, including a
    // RiskProfile (unique on userId). Re-running the bootstrap for the same
    // userId must fail partway through, at the RiskProfile step.
    await expect(prisma.$transaction((tx) => bootstrapTraderResources(tx, user.id))).rejects.toThrow();

    // If the earlier steps (broker connection, market data connection,
    // account, watchlist) weren't rolled back along with the failed step,
    // this user would now have a second, orphaned copy of each.
    const brokerConnections = await prisma.brokerConnection.findMany({ where: { userId: user.id } });
    expect(brokerConnections).toHaveLength(1);
    const accounts = await prisma.account.findMany({ where: { userId: user.id } });
    expect(accounts).toHaveLength(1);
    const watchlists = await prisma.watchlist.findMany({ where: { userId: user.id } });
    expect(watchlists).toHaveLength(1);
  });
});
