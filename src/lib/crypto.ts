import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { env } from "@/lib/env";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function deriveKey(): Buffer {
  return scryptSync(env.CREDENTIALS_ENCRYPTION_KEY, "probable-disco-credentials-salt", 32);
}

/** Encrypts a plaintext string (e.g. broker API credentials) for storage at rest. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey();
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/** Decrypts a value produced by encryptSecret. Never expose the result to the client. */
export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = buf.subarray(IV_LENGTH + 16);
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** One-way hash for opaque tokens (session tokens, email verification, password reset). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
