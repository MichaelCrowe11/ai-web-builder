// Gate a route on payment. On an unpaid request, emit HTTP 402 with the x402
// "accepts" payment-requirements array. On a paid request, attach req.settlePayment
// so the ROUTE can capture funds only after the work succeeds.
import type { Request, Response, NextFunction } from "express";
import type { PaymentVerifier } from "./payments";

declare module "express-serve-static-core" {
  interface Request { settlePayment?: () => Promise<void>; }
}

export function requirePayment(priceFor: (req: Request) => number, verifier: PaymentVerifier) {
  return async function paymentGate(req: Request, res: Response, next: NextFunction) {
    const price = priceFor(req);
    const challenge = verifier.challenge(price, req.path);

    if (challenge.unavailable) {
      return res.status(503).json({ error: "payments_unavailable" });
    }

    let result;
    try {
      result = await verifier.verify(req, price);
    } catch {
      return res.status(503).json({ error: "payment_verification_unavailable" });
    }
    if (!result) {
      // x402-standard 402 body: an `accepts` array of payment requirements.
      return res.status(402).json({
        x402Version: 1,
        accepts: [{
          scheme: "exact",
          network: challenge.network ?? "base",
          asset: challenge.asset ?? "USDC",
          payTo: challenge.payTo,
          // real X402Verifier supplies challenge.maxAmountRequired in atomic units (micro-USDC); String(price) is only a dev/test fallback.
          maxAmountRequired: challenge.maxAmountRequired ?? String(price),
          resource: challenge.resource,
        }],
      });
    }

    req.settlePayment = () => verifier.settle(result);
    next();
  };
}
