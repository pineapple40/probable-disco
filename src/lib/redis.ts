import Redis from "ioredis";
import { env } from "@/lib/env";

declare global {
  var __redis: Redis | undefined;
}

export const redis =
  global.__redis ??
  new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });

if (env.NODE_ENV !== "production") {
  global.__redis = redis;
}
