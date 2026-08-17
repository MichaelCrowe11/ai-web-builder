import { describe, it, expect } from "vitest";
import { mintApiKey, looksLikeApiKey, apiKeyFromHeader, keyPreview, API_KEY_PREFIX } from "./api-keys";
import { hashToken } from "./agent/claim-tokens";

describe("mintApiKey", () => {
  it("returns a prefixed key and the hash that should be stored", () => {
    const { key, hash } = mintApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(hash).toBe(hashToken(key));
    // The raw key must never be derivable from what we persist.
    expect(hash).not.toContain(key);
  });

  it("does not repeat", () => {
    const keys = new Set(Array.from({ length: 50 }, () => mintApiKey().key));
    expect(keys.size).toBe(50);
  });
});

describe("looksLikeApiKey", () => {
  it("accepts a freshly minted key", () => {
    expect(looksLikeApiKey(mintApiKey().key)).toBe(true);
  });

  it("rejects anything else, so junk never reaches a database lookup", () => {
    for (const v of [undefined, "", "hello", API_KEY_PREFIX, `${API_KEY_PREFIX}xyz`, "sk_live_123", `${API_KEY_PREFIX}${"a".repeat(47)}`]) {
      expect(looksLikeApiKey(v as any), String(v)).toBe(false);
    }
  });
});

describe("apiKeyFromHeader", () => {
  const { key } = mintApiKey();

  it("reads a Bearer token", () => {
    expect(apiKeyFromHeader(`Bearer ${key}`)).toBe(key);
  });

  // MCP clients differ in how they let a user supply credentials; a bare value
  // is what several of them send, and rejecting it would fail a user who did
  // exactly what their client asked.
  it("reads a bare key", () => {
    expect(apiKeyFromHeader(key)).toBe(key);
  });

  it("returns undefined for a missing or malformed header", () => {
    expect(apiKeyFromHeader(undefined)).toBeUndefined();
    expect(apiKeyFromHeader("Bearer not-a-key")).toBeUndefined();
    expect(apiKeyFromHeader("Basic dXNlcjpwYXNz")).toBeUndefined();
  });
});

describe("keyPreview", () => {
  it("shows only the last 4 characters", () => {
    const { key } = mintApiKey();
    const preview = keyPreview(key);
    expect(preview.endsWith(key.slice(-4))).toBe(true);
    expect(preview).not.toContain(key.slice(0, 20));
  });
});
