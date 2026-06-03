import { describe, it, expect } from "vitest";
import { mintClaimToken, hashToken, tokensMatch } from "./claim-tokens";

describe("claim-tokens", () => {
  it("mints a high-entropy token plus its hash", () => {
    const { token, hash } = mintClaimToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes hex
    expect(hash).toMatch(/^[0-9a-f]{64}$/);  // sha256 hex
    expect(hash).not.toBe(token);            // store the hash, never the token
  });

  it("mints distinct tokens", () => {
    const a = mintClaimToken();
    const b = mintClaimToken();
    expect(a.token).not.toBe(b.token);
  });

  it("hashToken is stable and matches mint's hash", () => {
    const { token, hash } = mintClaimToken();
    expect(hashToken(token)).toBe(hash);
  });

  it("tokensMatch compares a presented token against a stored hash", () => {
    const { token, hash } = mintClaimToken();
    expect(tokensMatch(token, hash)).toBe(true);
    expect(tokensMatch("deadbeef", hash)).toBe(false);
  });
});
