import pino from "pino";
import { env } from "@/lib/env";

const REDACT_PATHS = [
  "password",
  "passwordHash",
  "*.password",
  "*.passwordHash",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "encryptedCredentials",
  "*.encryptedCredentials",
  "authorization",
  "req.headers.authorization",
  "req.headers.cookie",
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  transport:
    env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } }
      : undefined,
  base: { service: "probable-disco" },
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
