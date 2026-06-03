// x402 facilitator adapter + factory.
//
// WIRE FORMAT NOTES (confirmed 2026-06-03 via CDP docs / Context7):
//
//   x402 v2 (CDP / official spec):
//     - Payment header:   PAYMENT-SIGNATURE  (v1 used X-PAYMENT)
//     - Verify endpoint:  POST /v2/x402/verify  { scheme, network, payment_data }
//                         Response: { status, message }
//     - Settle endpoint:  POST /v2/x402/settle  { scheme, network, payment_data }
//                         Response: { status, message }
//
//   THIS ADAPTER uses a GENERIC FACILITATOR contract (compatible with self-hosted
//   facilitators that are not the CDP-managed endpoint):
//     - Payment header:   X-PAYMENT           (task spec; configurable at call site)
//     - Verify endpoint:  POST {facilitatorUrl}/verify
//                         Body: { payment, paymentRequirements }
//                         Response: { isValid: boolean, ... }
//     - Settle endpoint:  POST {facilitatorUrl}/settle
//                         Body: { payment, paymentRequirements }
//                         Response: { success: boolean, ... } OR ok HTTP status
//
//   The PaymentVerifier interface fully isolates this wire contract from all
//   routes/middleware — swap out one file if you move to the CDP-managed facilitator.
//
// References:
//   https://docs.cdp.coinbase.com/x402/api-reference
//   https://docs.cdp.coinbase.com/x402/migration-guide

import type { Request } from "express";
import type { PaymentVerifier, PaymentChallenge, VerifyResult } from "./payments";
import { DisabledVerifier } from "./payments";
import { log } from "../log";

// USDC is a 6-decimal token on Base/Ethereum; wire amounts are in micro-USDC
// (the smallest representable unit, analogous to wei for ETH or satoshis for BTC).
const USDC_DECIMALS = 6;

export interface X402Config {
  payTo: string;
  facilitatorUrl: string;
  network: string;
  asset: string;
}

// Narrow fetch-alike so tests can inject a vi.fn() without needing the full
// global fetch signature. The real fetch satisfies this shape.
type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; json: () => Promise<any> }>;

export class X402Verifier implements PaymentVerifier {
  constructor(
    private cfg: X402Config,
    private fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  // challenge() MUST be synchronous and cheap — it is called on every gated
  // request before any network I/O, just to assemble the 402 response body if
  // payment is absent. No facilitator contact here.
  challenge(priceUsdc: number, resource: string): PaymentChallenge {
    // Convert to micro-USDC (integer string). E.g. 1.5 USDC -> "1500000".
    const maxAmountRequired = String(Math.round(priceUsdc * 10 ** USDC_DECIMALS));
    return {
      priceUsdc,
      payTo: this.cfg.payTo,
      resource,
      network: this.cfg.network,
      asset: this.cfg.asset,
      maxAmountRequired,
    };
  }

  // verify() reads the X-PAYMENT header. If absent, no facilitator call is made
  // (cheap fast-path for un-paided requests). If present, POST to /verify and
  // return a VerifyResult only when the facilitator says the payment is valid.
  async verify(req: Request, priceUsdc: number): Promise<VerifyResult | null> {
    const payment = req.header("x-payment");
    if (!payment) return null;

    const paymentRequirements = this.buildRequirements(priceUsdc);
    const res = await this.fetchImpl(`${this.cfg.facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment, paymentRequirements }),
    });

    const body = await res.json();
    if (!res.ok || !body.isValid) return null;

    return { proof: payment, priceUsdc };
  }

  // settle() is called ONLY after the work (site build) has succeeded, so a
  // failed build never charges the agent. Throws if the facilitator rejects,
  // which the middleware/route catches and surfaces as a 500 to the caller
  // (the work is already done at that point — this is a best-effort broadcast).
  async settle(result: VerifyResult): Promise<void> {
    const paymentRequirements = this.buildRequirements(result.priceUsdc);
    const res = await this.fetchImpl(`${this.cfg.facilitatorUrl}/settle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payment: result.proof, paymentRequirements }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `x402 settle failed: HTTP ${res.ok ? "ok" : "error"} — ${JSON.stringify(body)}`,
      );
    }
  }

  // Shared payment requirements object sent on both /verify and /settle.
  private buildRequirements(priceUsdc: number) {
    return {
      scheme: "exact",
      network: this.cfg.network,
      asset: this.cfg.asset,
      payTo: this.cfg.payTo,
      maxAmountRequired: String(Math.round(priceUsdc * 10 ** USDC_DECIMALS)),
    };
  }
}

// Factory: returns a live X402Verifier when the required env vars are set,
// otherwise returns DisabledVerifier (which responds 503 payments_unavailable
// to every request — no free sites, no broken charges).
//
// Required env:
//   X402_PAY_TO_ADDRESS    — EVM address that receives USDC (e.g. "0x...")
//   X402_FACILITATOR_URL   — Base URL of the facilitator (e.g. "https://x402.org/facilitator")
// Optional env:
//   X402_NETWORK           — chain identifier (default: "base")
//   X402_ASSET             — asset symbol (default: "USDC")
export function makeVerifier(): PaymentVerifier {
  const payTo = process.env.X402_PAY_TO_ADDRESS;
  const facilitatorUrl = process.env.X402_FACILITATOR_URL;

  if (payTo && facilitatorUrl) {
    const cfg: X402Config = {
      payTo,
      facilitatorUrl,
      network: process.env.X402_NETWORK ?? "base",
      asset: process.env.X402_ASSET ?? "USDC",
    };
    log(`x402: verifier active — payTo=${payTo} facilitator=${facilitatorUrl} network=${cfg.network}`);
    return new X402Verifier(cfg);
  }

  log("x402: X402_PAY_TO_ADDRESS or X402_FACILITATOR_URL not set — payments disabled (503 on all agent builds)");
  return new DisabledVerifier();
}
