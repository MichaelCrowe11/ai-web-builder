// API keys — the credential that lets a HUMAN pay for MCP calls.
//
// Why this exists: the MCP server was gated on x402 alone, which means the only
// caller able to complete a purchase is one holding USDC on Base and willing to
// sign an EIP-3009 authorization by hand. ChatGPT and Claude have no wallet, so
// every human who installed the connector hit a wall. A key ties an MCP session
// to an account, and the account is billed through Stripe, which already works.
//
// x402 is NOT replaced. The two rails answer different callers: a wallet-bearing
// autonomous agent pays per call, a person pays through their subscription.
//
// Storage follows the claim-token rule: the raw key is shown exactly once, and
// only its sha256 hash is persisted, so a database read never yields a usable
// credential.
import { randomBytes } from "crypto";
import { hashToken } from "./agent/claim-tokens";

// A recognisable, greppable prefix. Secret scanners key off fixed prefixes, and
// it makes a leaked key obvious in a log or a paste rather than anonymous hex.
export const API_KEY_PREFIX = "aiwb_sk_";

/** Mint a new key. Returns the raw key (shown once) and the hash to store. */
export function mintApiKey(): { key: string; hash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  return { key, hash: hashToken(key) };
}

/** Shape check before touching the database — avoids a lookup on junk input. */
export function looksLikeApiKey(value: string | undefined): value is string {
  return typeof value === "string" && new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{48}$`).test(value);
}

/**
 * Extract a key from a request's Authorization header.
 *
 * Accepts `Bearer <key>` and a bare key. MCP clients differ in how they let a
 * user supply credentials — some send a Bearer token, some pass a raw header
 * value — and rejecting the bare form would fail for a user who did everything
 * their client asked of them.
 */
export function apiKeyFromHeader(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const raw = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : authorization.trim();
  return looksLikeApiKey(raw) ? raw : undefined;
}

/** The last 4 characters, for showing which key is which after creation. */
export function keyPreview(key: string): string {
  return `${API_KEY_PREFIX}…${key.slice(-4)}`;
}
