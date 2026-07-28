import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  registerUser,
  login,
  AuthError,
  MAX_FAILED_LOGINS,
} from "@/server/auth/service";

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
