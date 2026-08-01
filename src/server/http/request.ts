import type { NextRequest } from "next/server";
import { env } from "@/lib/env";

/**
 * X-Forwarded-For is an ordinary request header - any client can set it to
 * whatever value it likes. It can only be trusted for the hops appended by
 * proxies we control, and only when we know how many of those hops sit in
 * front of us (TRUSTED_PROXY_COUNT). With that in mind:
 *  - No trusted proxy configured (the default): ignore the header entirely,
 *    since anyone could otherwise spoof rate-limit/audit-log IPs by setting
 *    it themselves. Used directly by the client, this would let an attacker
 *    bypass IP-based login rate limiting simply by rotating the header.
 *  - N trusted proxies configured: each hop appends the peer IP it saw to
 *    the right of the header, so the real client is the Nth entry from the
 *    right, not the leftmost entry (which is attacker-supplied and can
 *    contain any number of fake prefixed hops).
 */
export function getClientIp(req: NextRequest): string {
  if (env.TRUSTED_PROXY_COUNT <= 0) return "unknown";

  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";

  const hops = forwarded.split(",").map((h) => h.trim());
  const index = hops.length - env.TRUSTED_PROXY_COUNT;
  return hops[index] || "unknown";
}

export function getUserAgent(req: NextRequest): string | null {
  return req.headers.get("user-agent");
}
