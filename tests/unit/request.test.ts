import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { getClientIp } from "@/server/http/request";

const envMock = vi.hoisted(() => ({ TRUSTED_PROXY_COUNT: 0 }));
vi.mock("@/lib/env", () => ({ env: envMock }));

function makeRequest(xForwardedFor: string | null): NextRequest {
  return {
    headers: { get: (key: string) => (key === "x-forwarded-for" ? xForwardedFor : null) },
  } as unknown as NextRequest;
}

describe("getClientIp", () => {
  afterEach(() => {
    envMock.TRUSTED_PROXY_COUNT = 0;
  });

  it("ignores X-Forwarded-For entirely when no trusted proxy is configured (the default)", () => {
    // Without a configured proxy, this header is pure client input - an
    // attacker could otherwise set any IP they like to dodge IP-based rate
    // limiting.
    const req = makeRequest("1.2.3.4");
    expect(getClientIp(req)).toBe("unknown");
  });

  it("takes the rightmost hop as the real client when one trusted proxy is configured", () => {
    envMock.TRUSTED_PROXY_COUNT = 1;
    // The leftmost entries are attacker-suppliable; only the entry our own
    // trusted proxy appended (the rightmost one) is authentic.
    const req = makeRequest("9.9.9.9, 8.8.8.8, 203.0.113.5");
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("skips N trusted hops from the right when multiple proxies are configured", () => {
    envMock.TRUSTED_PROXY_COUNT = 2;
    const req = makeRequest("9.9.9.9, 203.0.113.5, 198.51.100.7");
    expect(getClientIp(req)).toBe("203.0.113.5");
  });

  it("returns unknown when the header is missing", () => {
    envMock.TRUSTED_PROXY_COUNT = 1;
    const req = makeRequest(null);
    expect(getClientIp(req)).toBe("unknown");
  });
});
