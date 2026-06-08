// Stripe subscriptions: Checkout (start Pro), Billing Portal (manage/cancel),
// and webhook handling that flips users.plan based on subscription state.
import type { Express, Request, Response } from "express";
import Stripe from "stripe";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { log } from "./log";

const SECRET = process.env.STRIPE_SECRET_KEY ?? "";
const PRICE_PRO = process.env.STRIPE_PRICE_PRO ?? "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const APP_URL = process.env.APP_URL ?? "http://localhost:5050";

// Lazily constructed so the app still boots if Stripe isn't configured.
let stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripe) {
    if (!SECRET) throw new Error("STRIPE_SECRET_KEY not set");
    stripe = new Stripe(SECRET);
  }
  return stripe;
}

export const billingConfigured = Boolean(SECRET && PRICE_PRO);

export function registerBillingRoutes(app: Express) {
  // Start a Pro subscription. Returns a Checkout URL to redirect to.
  app.post("/api/billing/checkout", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!billingConfigured) {
        return res.status(503).json({ error: "Billing is not configured" });
      }
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      // Reuse an existing Stripe customer or create one tied to this user.
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await getStripe().customers.create({
          email: user.email ?? undefined,
          metadata: { userId: user.id, username: user.username },
        });
        customerId = customer.id;
        await storage.updateUser(user.id, { stripeCustomerId: customerId });
      }

      const checkout = await getStripe().checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: PRICE_PRO, quantity: 1 }],
        success_url: `${APP_URL}/builder?upgraded=1`,
        cancel_url: `${APP_URL}/builder?canceled=1`,
        client_reference_id: user.id,
        metadata: { userId: user.id },
      });

      return res.json({ url: checkout.url });
    } catch (error: any) {
      log(`Checkout error: ${error.message}`);
      return res.status(500).json({ error: "Could not start checkout" });
    }
  });

  // Open the Stripe Billing Portal so users can cancel/update payment.
  app.post("/api/billing/portal", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.stripeCustomerId) {
        return res.status(400).json({ error: "No billing account yet" });
      }
      const portal = await getStripe().billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${APP_URL}/builder`,
      });
      return res.json({ url: portal.url });
    } catch (error: any) {
      log(`Portal error: ${error.message}`);
      return res.status(500).json({ error: "Could not open billing portal" });
    }
  });
}

// Webhook handler. Registered separately in index.ts with a raw-body parser
// so Stripe's signature can be verified.
export async function handleStripeWebhook(req: Request, res: Response) {
  let event: Stripe.Event;
  try {
    const sig = req.headers["stripe-signature"] as string;
    if (WEBHOOK_SECRET) {
      event = getStripe().webhooks.constructEvent(
        req.body as Buffer,
        sig,
        WEBHOOK_SECRET,
      );
    } else {
      // No secret configured (e.g. local dev) — parse without verification.
      event = JSON.parse((req.body as Buffer).toString());
    }
  } catch (err: any) {
    log(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId || session.client_reference_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        if (userId) {
          await storage.updateUser(userId, {
            plan: "pro",
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
          });
          log(`User ${userId} upgraded to pro`);
        }
        break;
      }
      case "customer.subscription.deleted":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        const user = await storage.getUserByStripeCustomerId(customerId);
        if (user) {
          // active/trialing → pro; anything else (canceled, past_due, unpaid) → free.
          const isActive = sub.status === "active" || sub.status === "trialing";
          await storage.updateUser(user.id, {
            plan: isActive ? "pro" : "free",
            stripeSubscriptionId: isActive ? sub.id : null,
          });
          log(`User ${user.id} subscription ${sub.status} → plan ${isActive ? "pro" : "free"}`);
        }
        break;
      }
      default:
        break;
    }
    return res.json({ received: true });
  } catch (error: any) {
    log(`Webhook handler error: ${error.message}`);
    return res.status(500).json({ error: "Webhook handler failed" });
  }
}
