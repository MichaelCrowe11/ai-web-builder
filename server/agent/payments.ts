// Payment abstraction for the agent API. The middleware calls verify() to gate a
// request and settle() ONLY after the work succeeds — so a failed build never
// charges the agent. Concrete x402 lives in x402-verifier.ts behind this interface.
import type { Request } from "express";

export interface PaymentChallenge {
  priceUsdc: number;
  payTo: string;
  resource: string;
  network?: string;     // e.g. "base"
  asset?: string;       // USDC contract / symbol
  unavailable?: boolean; // DisabledVerifier => respond "payments not configured"
  maxAmountRequired?: string; // verifier-supplied wire amount (asset's smallest unit, e.g. micro-USDC). When set, the 402 body uses this instead of the raw float price.
  // Optional x402-spec paymentRequirements passthroughs. When the verifier
  // supplies them, the 402 middleware includes them so real x402 clients can
  // sign against the exact same requirements the facilitator will verify.
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, string>; // token EIP-712 domain ({ name, version })
}

export interface VerifyResult {
  proof: unknown;       // opaque proof handed back to settle(); verifier-specific
  priceUsdc: number;
}

export interface PaymentVerifier {
  challenge(priceUsdc: number, resource: string): PaymentChallenge;
  verify(req: Request, priceUsdc: number): Promise<VerifyResult | null>; // null => unpaid
  settle(result: VerifyResult): Promise<void>;
}

// TEST-ONLY verifier. Accepts the header `X-PAYMENT: fake-ok`. Never wired in prod.
export class FakeVerifier implements PaymentVerifier {
  settled = 0;
  /** Make settle() throw, to exercise the "work delivered, funds not captured" path. */
  failSettle = false;
  challenge(priceUsdc: number, resource: string): PaymentChallenge {
    return { priceUsdc, payTo: "0xFAKE", resource, network: "base", asset: "USDC" };
  }
  async verify(req: Request, priceUsdc: number): Promise<VerifyResult | null> {
    return req.header("x-payment") === "fake-ok" ? { proof: "fake", priceUsdc } : null;
  }
  async settle(_result: VerifyResult): Promise<void> {
    if (this.failSettle) throw new Error("fake settle failure");
    this.settled += 1;
  }
}

// PROD DEFAULT until a wallet/facilitator is configured: refuses every request so
// the service never gives away a free site. Replaced by X402Verifier when env is set.
export class DisabledVerifier implements PaymentVerifier {
  challenge(priceUsdc: number, resource: string): PaymentChallenge {
    return { priceUsdc, payTo: "", resource, unavailable: true };
  }
  async verify(): Promise<VerifyResult | null> { return null; }
  async settle(): Promise<void> { /* never reached */ }
}
