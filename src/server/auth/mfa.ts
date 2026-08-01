import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { recordAuditEvent } from "@/server/audit/log";

const ISSUER = "Probable Disco";

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => randomBytes(5).toString("hex"));
}

export class MfaAlreadyEnabledError extends Error {
  constructor() {
    super("MFA is already enabled for this account. Disable it before starting a new enrollment.");
  }
}

export async function beginMfaEnrollment(userId: string, email: string) {
  const existing = await prisma.mfaConfig.findUnique({ where: { userId } });
  // Re-enrolling while MFA is already active must never silently replace the
  // active secret and flip enabled to false - that would let anyone holding
  // a valid session (e.g. a hijacked one) defeat the second factor without
  // ever proving possession of the current authenticator.
  if (existing?.enabled) throw new MfaAlreadyEnabledError();

  const secret = generateSecret();
  const otpauthUrl = generateURI({ issuer: ISSUER, label: email, secret });
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  await prisma.mfaConfig.upsert({
    where: { userId },
    update: { secret: encryptSecret(secret), enabled: false, recoveryCodes: [] },
    create: { userId, secret: encryptSecret(secret), enabled: false, recoveryCodes: [] },
  });

  return { secret, otpauthUrl, qrDataUrl };
}

export async function confirmMfaEnrollment(userId: string, code: string) {
  const config = await prisma.mfaConfig.findUnique({ where: { userId } });
  if (!config) throw new Error("MFA enrollment has not been started.");
  const secret = decryptSecret(config.secret);
  const result = await verify({ secret, token: code });
  if (!result.valid) throw new Error("Invalid authenticator code.");

  const recoveryCodes = generateRecoveryCodes();
  await prisma.mfaConfig.update({
    where: { userId },
    data: { enabled: true, recoveryCodes: recoveryCodes.map(hashRecoveryCode) },
  });
  await recordAuditEvent({ userId, category: "security", action: "mfa_enabled" });
  return { recoveryCodes };
}

export async function disableMfa(userId: string) {
  await prisma.mfaConfig.deleteMany({ where: { userId } });
  await recordAuditEvent({ userId, category: "security", action: "mfa_disabled" });
}

export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const config = await prisma.mfaConfig.findUnique({ where: { userId } });
  if (!config?.enabled) return false;
  const secret = decryptSecret(config.secret);
  const result = await verify({ secret, token: code });
  return result.valid;
}

export async function verifyRecoveryCode(userId: string, code: string): Promise<boolean> {
  const config = await prisma.mfaConfig.findUnique({ where: { userId } });
  if (!config?.enabled) return false;
  const hashed = hashRecoveryCode(code);
  const idx = config.recoveryCodes.indexOf(hashed);
  if (idx === -1) return false;
  const remaining = config.recoveryCodes.filter((_, i) => i !== idx);
  await prisma.mfaConfig.update({ where: { userId }, data: { recoveryCodes: remaining } });
  await recordAuditEvent({ userId, category: "security", action: "mfa_recovery_code_used" });
  return true;
}
