// One-time claim tokens that bind an agent-built (initially unowned) site to a
// principal later. We return the raw token to the caller exactly once and store
// only its sha256 hash, so a DB read never yields a usable token.
import { randomBytes, createHash, timingSafeEqual } from "crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintClaimToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export function tokensMatch(presentedToken: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(presentedToken), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
