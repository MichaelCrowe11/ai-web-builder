# Go-live: turn on billing, the funnel, and the living site

This is the exact sequence to flip AI Web Builder from "built" to "earning."
Every step is staged so you run the account-touching parts yourself. Nothing
here creates a live Stripe object or deploys on its own.

Current state (verified in code):

- Billing rails are wired: Stripe Checkout, Billing Portal, and a webhook that
  flips `users.plan` to `pro`. Billing stays OFF until `STRIPE_SECRET_KEY` and
  `STRIPE_PRICE_PRO` are both set (`billing.ts` guards on this).
- Pricing is set in the UI at **$29.99/mo Pro** vs a free tier (5 builds/day).
- The acquisition funnel now records trial -> signup -> checkout -> Pro and is
  readable at `GET /api/admin/funnel`.
- The living-site growth agent exists but its scheduler is **gated off** by
  `GROWTH_AGENT_ENABLED` and only optimizes sites that have a goal.

---

## 1. Create the Pro price in Stripe (you run this)

Use the LIVE key on the Stripe account you want to collect into. Do not reuse
the Southwest Mushrooms or dead Crowe Mycology accounts; use the intended
AI Web Builder account.

```bash
# One product, one recurring monthly price at $29.99.
stripe products create --name "AI Web Builder Pro" \
  --description "Unlimited builds, custom domain, and a self-optimizing living site."

# Use the product id (prod_...) from the previous command:
stripe prices create \
  --product prod_XXXXXXXX \
  --unit-amount 2999 \
  --currency usd \
  --recurring interval=month
```

Copy the resulting `price_...` id. That is `STRIPE_PRICE_PRO`.

## 2. Create the webhook endpoint (you run this)

```bash
stripe webhook_endpoints create \
  --url https://ai-webbuilder.com/api/billing/webhook \
  --enabled-events checkout.session.completed \
  --enabled-events customer.subscription.updated \
  --enabled-events customer.subscription.deleted
```

Copy the signing secret (`whsec_...`). That is `STRIPE_WEBHOOK_SECRET`.

## 3. Set production env

On the host (GCP/Cloud Run or Railway), set:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_PRO=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_URL=https://ai-webbuilder.com
APP_HOSTS=ai-webbuilder.com,www.ai-webbuilder.com
ADMIN_KEY=<openssl rand -hex 24>
FUNNEL_SALT=<any stable string>
GROWTH_AGENT_ENABLED=1
```

`GROWTH_AGENT_ENABLED=1` is what makes the "living site" claim on the homepage
true. Without it the growth agent never ticks.

## 4. Verify before announcing

```bash
# Billing configured? Checkout should return a URL (signed-in user).
curl -sX POST https://ai-webbuilder.com/api/billing/checkout -b cookie.txt

# Funnel readable? (replace KEY)
curl -s "https://ai-webbuilder.com/api/admin/funnel?key=KEY&days=30" | jq

# Do a real test purchase in Stripe test mode first, confirm the webhook flips
# the account to Pro (the nav shows the Pro badge), then repeat once live.
```

## 5. Living site is turnkey (done)

Every published site now gets a default optimization goal automatically
(`publishProjectRecord` in `publish.ts`): objective `capture_lead`, optimizing
toward primary call-to-action clicks, under `suggest` autonomy so the agent
proposes changes for one-click owner approval instead of mutating a live site
unattended. Owners retune or switch to full autopilot in the growth dashboard.
An owner's existing goal is never overwritten.

So once `GROWTH_AGENT_ENABLED=1` is set (step 3), the living-site loop runs with
zero per-site setup: publish -> default goal -> the scheduler finds the weakest
section -> proposes an A/B test -> owner approves -> winner is kept.
