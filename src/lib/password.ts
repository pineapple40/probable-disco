import bcrypt from "bcryptjs";

const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

const MIN_LENGTH = 10;

export function assessPasswordStrength(password: string): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (password.length < MIN_LENGTH) reasons.push(`Must be at least ${MIN_LENGTH} characters.`);
  if (!/[a-z]/.test(password)) reasons.push("Must include a lowercase letter.");
  if (!/[A-Z]/.test(password)) reasons.push("Must include an uppercase letter.");
  if (!/[0-9]/.test(password)) reasons.push("Must include a digit.");
  if (!/[^a-zA-Z0-9]/.test(password)) reasons.push("Must include a symbol.");
  return { valid: reasons.length === 0, reasons };
}
