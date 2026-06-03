// One-time claim tokens that bind an agent-built (initially unowned) site to a
// principal later. We return the raw token to the caller exactly once and store
// only its sha256 hash, so a DB read never yields a usable token.
import { randomBytes, createHash, timingSafeEqual } from "crypto";

/**
 * Canonical hashing entry point: returns the sha256-hex digest of a raw token.
 * This is the value that must be stored in the DB; never store the raw token.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintClaimToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export function tokensMatch(presentedToken: string, storedHash: string): boolean {
  // Guard: storedHash must be a valid sha256 hex string (64 lowercase hex chars).
  // Buffer.from(badInput, "hex") silently produces garbage; reject early instead.
  if (!/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashToken(presentedToken), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
