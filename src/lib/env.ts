import { z } from "zod";

/**
 * `z.coerce.boolean()` runs `Boolean(value)`, so any non-empty string -
 * including the literal "false" - coerces to `true`. Parse explicit
 * "true"/"false" text instead so `FEATURE_X=false` actually disables it.
 */
function booleanFlag(defaultValue: boolean) {
  return z
    .enum(["true", "false"])
    .default(defaultValue ? "true" : "false")
    .transform((v) => v === "true");
}

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

  FEATURE_LIVE_TRADING_ENABLED: booleanFlag(false),
  FEATURE_MFA_ENABLED: booleanFlag(true),
  FEATURE_SIGNUP_ENABLED: booleanFlag(true),

  MARKET_DATA_PROVIDER: z.enum(["simulated", "alpaca"]).default("simulated"),
  BROKER_PROVIDER: z.enum(["simulated", "alpaca"]).default("simulated"),
  ALPACA_API_KEY: z.string().optional().default(""),
  ALPACA_API_SECRET: z.string().optional().default(""),
  ALPACA_PAPER_BASE_URL: z.string().optional().default("https://paper-api.alpaca.markets"),
  ALPACA_DATA_BASE_URL: z.string().optional().default("https://data.alpaca.markets"),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.string().optional().default(""),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASSWORD: z.string().optional().default(""),
  SMTP_FROM: z.string().optional().default("Probable Disco <no-reply@example.com>"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  // X-Forwarded-For is client-controllable and must never be trusted unless
  // a reverse proxy in front of this app is known to overwrite/append to it.
  // 0 (default) means "no trusted proxy" - the header is ignored entirely.
  // N means the app is reachable only through N trusted proxy hops, so the
  // real client IP is the Nth entry from the right of the header.
  TRUSTED_PROXY_COUNT: z.coerce.number().int().min(0).default(0),
}).superRefine((data, ctx) => {
  // Alpaca is opt-in per env var; only require its credentials when a
  // provider actually selects it, so the simulated-only default install
  // never needs an Alpaca account.
  const needsAlpaca = data.BROKER_PROVIDER === "alpaca" || data.MARKET_DATA_PROVIDER === "alpaca";
  if (needsAlpaca && !data.ALPACA_API_KEY) {
    ctx.addIssue({ code: "custom", path: ["ALPACA_API_KEY"], message: "ALPACA_API_KEY is required when BROKER_PROVIDER or MARKET_DATA_PROVIDER is \"alpaca\"." });
  }
  if (needsAlpaca && !data.ALPACA_API_SECRET) {
    ctx.addIssue({ code: "custom", path: ["ALPACA_API_SECRET"], message: "ALPACA_API_SECRET is required when BROKER_PROVIDER or MARKET_DATA_PROVIDER is \"alpaca\"." });
  }
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
