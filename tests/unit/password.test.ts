import { describe, expect, it } from "vitest";
import { assessPasswordStrength } from "@/lib/password";

describe("assessPasswordStrength", () => {
  it("accepts a strong password", () => {
    const result = assessPasswordStrength("Str0ng!Passw0rd");
    expect(result.valid).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("rejects a password that is too short", () => {
    const result = assessPasswordStrength("Ab1!");
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("10 characters"))).toBe(true);
  });

  it("rejects a password missing a digit", () => {
    const result = assessPasswordStrength("NoDigitsHere!");
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("digit"))).toBe(true);
  });

  it("rejects a password missing a symbol", () => {
    const result = assessPasswordStrength("NoSymbolsHere1");
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("symbol"))).toBe(true);
  });

  it("rejects an all-lowercase password", () => {
    const result = assessPasswordStrength("alllowercase1!");
    expect(result.valid).toBe(false);
    expect(result.reasons.some((r) => r.includes("uppercase"))).toBe(true);
  });
});
