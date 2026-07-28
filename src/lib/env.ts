import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  APP_ENV: z.string().default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(16, "CREDENTIALS_ENCRYPTION_KEY must be at least 16 characters"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().positive().default(30),
  EMAIL_VERIFICATION_TOKEN_TTL_HOURS: z.coerce.number().positive().default(24),

  FEATURE_LIVE_TRADING_ENABLED: z.coerce.boolean().default(false),
  FEATURE_MFA_ENABLED: z.coerce.boolean().default(true),
  FEATURE_SIGNUP_ENABLED: z.coerce.boolean().default(true),

  MARKET_DATA_PROVIDER: z.enum(["simulated"]).default("simulated"),
  BROKER_PROVIDER: z.enum(["simulated", "alpaca"]).default("simulated"),
  ALPACA_API_KEY: z.string().optional().default(""),
  ALPACA_API_SECRET: z.string().optional().default(""),
  ALPACA_PAPER_BASE_URL: z.string().optional().default("https://paper-api.alpaca.markets"),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.string().optional().default(""),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default("Probable Disco <no-reply@example.com>"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
