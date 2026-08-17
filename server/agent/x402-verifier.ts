// x402 facilitator adapter + factory.
//
// WIRE FORMAT (x402 v1, verified live against facilitator.payai.network 2026-08-16):
//
//   - Payment header:  X-PAYMENT — base64-encoded JSON PaymentPayload signed by
//     the buying agent: { x402Version, scheme, network, payload: { signature, authorization } }
//   - Verify endpoint: POST {facilitatorUrl}/verify
//       Body:     { x402Version: 1, paymentPayload, paymentRequirements }
//       Response: { isValid: boolean, invalidReason?, payer? }
//   - Settle endpoint: POST {facilitatorUrl}/settle
//       Body:     { x402Version: 1, paymentPayload, paymentRequirements }
//       Response: { success: boolean, errorReason?, transaction?, network? }
//
//   paymentRequirements is the full spec object (scheme, network, maxAmountRequired,
//   resource, description, mimeType, payTo, maxTimeoutSeconds, asset, extra).
//   `asset` is the ERC-20 contract ADDRESS (not a symbol) and `extra` carries the
//   token's EIP-712 domain ({ name, version }) — facilitators reject requirements
//   without it (invalid_exact_evm_missing_eip712_domain).
//
//   The exact same requirements object must be used for the 402 challenge, /verify
//   and /settle: the buyer signs typed data derived from it, so any drift between
//   challenge and verification breaks payment.
//
// References:
//   https://github.com/coinbase/x402 (spec + facilitator REST contract)
//   https://docs.cdp.coinbase.com/x402/api-reference

import type { Request } from "express";
import type { PaymentVerifier, PaymentChallenge, VerifyResult } from "./payments";
import { DisabledVerifier } from "./payments";
import { log } from "../log";

// USDC is a 6-decimal token on Base/Ethereum; wire amounts are in micro-USDC
// (the smallest representable unit, analogous to wei for ETH or satoshis for BTC).
const USDC_DECIMALS = 6;

// Per-network defaults for the payment token: contract address + EIP-712 domain.
// Base mainnet values confirmed on-chain (name() = "USD Coin", version() = "2").
const NETWORK_TOKEN_DEFAULTS: Record<
  string,
  { asset: string; assetName: string; assetVersion: string }
> = {
  base: {
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    assetName: "USD Coin",
    assetVersion: "2",
  },
  "base-sepolia": {
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    assetName: "USDC",
    assetVersion: "2",
  },
};

export interface X402Config {
  payTo: string;
  facilitatorUrl: string;
  network: string;
  /** ERC-20 contract address of the payment token. Defaults per network. */
  asset?: string;
  /** EIP-712 domain name of the token. Defaults per network. */
  assetName?: string;
  /** EIP-712 domain version of the token. Defaults per network. */
  assetVersion?: string;
  /** Absolute origin (e.g. APP_URL) used to build spec-required resource URLs. */
  baseUrl?: string;
}

// Narrow fetch-alike so tests can inject a vi.fn() without needing the full
// global fetch signature. The real fetch satisfies this shape.
type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status?: number; json: () => Promise<any> }>;

export class X402Verifier implements PaymentVerifier {
  private token: { asset: string; assetName: string; assetVersion: string };

  constructor(
    private cfg: X402Config,
    private fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {
    const defaults = NETWORK_TOKEN_DEFAULTS[cfg.network];
    this.token = {
      asset: cfg.asset ?? defaults?.asset ?? "",
      assetName: cfg.assetName ?? defaults?.assetName ?? "",
      assetVersion: cfg.assetVersion ?? defaults?.assetVersion ?? "2",
    };
  }

  // challenge() MUST be synchronous and cheap — it is called on every gated
  // request before any network I/O, just to assemble the 402 response body if
  // payment is absent. No facilitator contact here.
  challenge(priceUsdc: number, resource: string): PaymentChallenge {
    const reqs = this.buildRequirements(priceUsdc, resource);
    return {
      priceUsdc,
      payTo: reqs.payTo,
      resource: reqs.resource,
      network: reqs.network,
      asset: reqs.asset,
      maxAmountRequired: reqs.maxAmountRequired,
      description: reqs.description,
      mimeType: reqs.mimeType,
      maxTimeoutSeconds: reqs.maxTimeoutSeconds,
      extra: reqs.extra,
    };
  }

  // verify() reads the X-PAYMENT header (base64 JSON PaymentPayload). If absent
  // or undecodable, no facilitator call is made (cheap fast-path → 402). If
  // present, POST to /verify and return a VerifyResult only when the
  // facilitator says the payment is valid.
  async verify(req: Request, priceUsdc: number): Promise<VerifyResult | null> {
    const header = req.header("x-payment");
    if (!header) return null;

    const paymentPayload = decodePaymentHeader(header);
    if (!paymentPayload) return null;

    const paymentRequirements = this.buildRequirements(priceUsdc, req.path);
    const res = await this.fetchImpl(`${this.cfg.facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
    });

    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (!data?.isValid) return null;
    // Settle must replay the exact payload + requirements pair, so carry both.
    return { proof: { paymentPayload, paymentRequirements }, priceUsdc };
  }

  // settle() is called ONLY after the work (site build) has succeeded, so a
  // failed build never charges the agent. Throws if the facilitator rejects,
  // which the middleware/route catches and surfaces as a 500 to the caller
  // (the work is already done at that point — this is a best-effort broadcast).
  async settle(result: VerifyResult): Promise<void> {
    const { paymentPayload, paymentRequirements } = result.proof as {
      paymentPayload: unknown;
      paymentRequirements: unknown;
    };
    const res = await this.fetchImpl(`${this.cfg.facilitatorUrl}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements }),
    });

    const body = res.ok ? await res.json().catch(() => ({})) : {};
    if (!res.ok || body?.success === false) {
      throw new Error(
        `x402 settle failed: HTTP ${res.status ?? "?"} — ${JSON.stringify(body)}`,
      );
    }
  }

  // Convert a USDC price to a micro-USDC atomic integer string.
  // E.g. 1.5 USDC → "1500000", 0.25 USDC → "250000".
  private toAtomic(priceUsdc: number): string {
    return String(Math.round(priceUsdc * 10 ** USDC_DECIMALS));
  }

  // The single source of truth for the spec paymentRequirements object, shared
  // by challenge(), verify() and settle() so the buyer-signed typed data always
  // matches what the facilitator checks.
  private buildRequirements(priceUsdc: number, resource: string) {
    const absoluteResource = /^https?:\/\//.test(resource)
      ? resource
      : `${this.cfg.baseUrl ?? ""}${resource}`;
    return {
      scheme: "exact",
      network: this.cfg.network,
      maxAmountRequired: this.toAtomic(priceUsdc),
      resource: absoluteResource,
      description: "AI Web Builder agent API",
      mimeType: "application/json",
      payTo: this.cfg.payTo,
      maxTimeoutSeconds: 300,
      asset: this.token.asset,
      extra: { name: this.token.assetName, version: this.token.assetVersion },
    };
  }
}

// Decode the X-PAYMENT header: base64 → JSON object. Returns null (treated as
// unpaid) on any malformed input rather than throwing into the route.
function decodePaymentHeader(header: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Factory: returns a live X402Verifier when the required env vars are set,
// otherwise returns DisabledVerifier (which responds 503 payments_unavailable
// to every request — no free sites, no broken charges).
//
// Required env:
//   X402_PAY_TO_ADDRESS    — EVM address that receives USDC (e.g. "0x...")
//   X402_FACILITATOR_URL   — Base URL of the facilitator (e.g. "https://facilitator.payai.network")
// Optional env:
//   X402_NETWORK           — chain identifier (default: "base")
//   X402_ASSET             — payment token contract address (default: USDC for the network)
//   X402_ASSET_NAME        — token EIP-712 domain name (default per network)
//   X402_ASSET_VERSION     — token EIP-712 domain version (default per network)
export function makeVerifier(): PaymentVerifier {
  const payTo = process.env.X402_PAY_TO_ADDRESS;
  const facilitatorUrl = process.env.X402_FACILITATOR_URL;

  if (payTo && facilitatorUrl) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
      log(`x402: X402_PAY_TO_ADDRESS "${payTo}" is not a valid EVM address — payments disabled`);
      return new DisabledVerifier();
    }
    const cfg: X402Config = {
      payTo,
      facilitatorUrl: facilitatorUrl.replace(/\/$/, ""),
      network: process.env.X402_NETWORK ?? "base",
      asset: process.env.X402_ASSET || undefined,
      assetName: process.env.X402_ASSET_NAME || undefined,
      assetVersion: process.env.X402_ASSET_VERSION || undefined,
      baseUrl: process.env.APP_URL ?? "",
    };
    log(`x402: verifier active — payTo=${payTo} facilitator=${cfg.facilitatorUrl} network=${cfg.network}`);
    return new X402Verifier(cfg);
  }

  log("x402: X402_PAY_TO_ADDRESS or X402_FACILITATOR_URL not set — payments disabled (503 on all agent builds)");
  return new DisabledVerifier();
}
