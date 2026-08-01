import { redis } from "@/lib/redis";

/**
 * Fixed-window counter used to slow down brute-force login attempts per IP,
 * independent of the per-account lockout tracked on the User row.
 */
export async function checkFixedWindowRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const redisKey = `ratelimit:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, windowSeconds);
  }
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}
