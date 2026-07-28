import { z } from "zod";

export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(80),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
  mfaCode: z.string().length(6).optional(),
  recoveryCode: z.string().min(1).optional(),
});

export const requestPasswordResetSchema = z.object({
  email: z.email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10).max(200),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

export const verifyMfaSchema = z.object({
  code: z.string().length(6),
});
