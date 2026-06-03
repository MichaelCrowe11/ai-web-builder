# Agent-Native ai-webbuilder — Design

**Date:** 2026-06-02
**Branch:** `feat/agent-native` (off `feat/launch-hardening`, which carries the `gen-limiter` this design reuses)
**Status:** Approved design, pre-plan.

## Thesis

The customer is becoming a program with a wallet. Humans don't scale — their attention
is the bottleneck of every SaaS funnel. Agents scale to billions of instances, each
transacting many times a day, none willing to fill a signup form, watch onboarding, or
click a hosted checkout page. An agent-native product exposes **capability, identity,
payment, and result as machine interfaces**, with no human in the loop required to
discover, pay for, or consume the service.

This spec makes **ai-webbuilder** the first end-to-end agent-native Crowe product: an
agent anywhere can discover it, pay per call with its own wallet, and get a live website
back — additively, alongside the existing human product, which is untouched.

## Locked decisions

1. **Target:** ai-webbuilder, end-to-end agent-native. Additive to the human product
   (sessions, Stripe Pro, builder UI), NOT a replacement.
2. **Payment rail:** **x402** — HTTP `402 Payment Required` settled in USDC inside the
   request round-trip. Permissionless: an agent that has never created an account can
   pay-per-call.
3. **Core interface:** a **402-native HTTP API** mounted at `/v1/agent/*`. (This is what
   x402 wraps.)
4. **Site ownership:** **claimable** — a build returns a live URL plus a one-time claim
   token, bindable later to a Crowe ID identity for editing/management.
5. **Architecture:** **additive parallel layer** — a new isolated `server/agent/` module
   reusing the hardened core (`document-gen`, `shared/renderer`, `publish.ts`,
   `gen-limiter`, lead capture). No refactor of the live monetized human path.

## Non-goals (YAGNI / scope boundaries)

- **MCP server is deferred to a fast-follow.** x402's HTTP-round-trip payment does not map
  cleanly onto MCP tool calls yet. v1 ships HTTP + x402 + discovery manifests; an MCP
  wrapper (with a funded-key or payment-link path) comes after, as its own spec.
- **Full agent-identity minting stays in the Crowe ID project.** This spec only *binds* a
  claimed site to an existing Crowe ID at claim time; it does not mint agent identities.
- **No new fiat/Stripe path for agents.** The human product keeps Stripe; the agent path
  is x402-only in v1. (A layered Stripe-for-agents path is a future decision, not this one.)
- **No multi-page sites, in-browser agent editing, or bundled email** beyond what the
  existing core already does.

## Components

A new isolated layer under `server/agent/`:

### `server/agent/routes.ts` — the 402-native API (`/v1/agent/*`, no sessions, no quota)

- `POST /v1/agent/sites` — body `{ prompt, options? }`. Builds **and** publishes in one
  paid call. Returns `{ siteUrl, slug, claimToken, document }`. (Agents want a result, not
  a wizard; build+publish is atomic.)
- `POST /v1/agent/sites/:id/refine` — paid scoped edit; reuses `editSection`.
- `POST /v1/agent/sites/:id/claim` — `{ token, identity }`; binds ownership to a Crowe ID
  (transfers the synthetic agent owner to the real principal).
- `GET /v1/agent/sites/:id` — read status/document. Free.
- `GET /v1/agent/sites/:id/leads` — leads inbox for a claimed site; reuses
  `form_submissions`. Requires proof of ownership (claimed identity).

### `server/agent/x402.ts` — payment-gate middleware (behind an interface)

The genuinely new infrastructure. Written against a small `PaymentVerifier` interface so
the concrete x402 SDK / facilitator (Coinbase hosted facilitator or self-hosted Base
verifier) is swappable and confirmed during planning, not baked into route logic.

**Verify → do work → settle-on-success** (the core safety design — see below):

- `verify(req)` — confirm a payment proof is present, valid, and funded for the route's
  price. Does NOT capture. Absent/invalid → respond `402` with price, pay-to address, and
  nonce in the x402-standard shape.
- `settle(proof)` — capture the USDC. Called ONLY after the work succeeds.

Per-route pricing comes from env (see Pricing).

### `server/agent/claim-tokens.ts` + table `agent_claim_tokens`

- Schema: `token_hash` (hashed at rest), `project_id` (FK → `projects`), `created_at`,
  `claimed_by` (nullable identity ref), `claimed_at` (nullable).
- Mint: high-entropy random token, returned to caller once, only its hash stored.
- Claim: single-use; binds the site's owner column from the synthetic agent sentinel to
  the claiming identity; double-claim rejected.
- Migration applied as additive `CREATE TABLE IF NOT EXISTS` via psql against the prod DB.
  NEVER `drizzle-kit push` (it wants to DROP `user_sessions`). Mem + Postgres storage
  implementations, mirroring existing tables.

### Discovery surfaces (so agents find it with no human)

- `client/public/llms.txt` (or served route) — markdown: what the service does, the
  `/v1/agent/*` endpoints, pricing, and how to pay via x402.
- `GET /openapi.json` — OpenAPI 3 spec of the agent surface.
- `GET /.well-known/x402` — x402-standard discovery manifest: priced endpoints, prices,
  pay-to address — so x402 directories/aggregators auto-list the service.
- `GET /.well-known/agent.json` — capability manifest (name, description, capabilities,
  auth model, pricing pointer).
- Registration in the x402 ecosystem directory ("Bazaar") is a manual follow-up step
  (cannot be fully automated); noted, not built.

### Reused core (unchanged)

`document-gen.ts` (generate/fill), `shared/renderer.ts`, `publish.ts` (slug + host serve),
`gen-limiter.ts` (the agent path goes through `runLimited` too — agents are bursty, so this
matters more, not less), lead capture (`form_submissions`).

## The critical payment-safety design

x402 settles money inside the HTTP round-trip, so payment capture MUST be tied to
successful delivery — otherwise a spike or generation failure charges an agent for nothing.

1. Middleware **verifies** the proof is valid + funded (no capture).
2. Route acquires a `gen-limiter` permit and generates.
3. On success → **settle** (capture USDC) → return the site.
4. On at-capacity or generation failure → **do NOT settle**; return `503 at_capacity` +
   `Retry-After` (or 5xx). The agent retries without being charged.

This is the same invariant as the human path's quota-safety (Task 2 of launch-hardening):
*never consume the unit of value on a failure.* There the unit was the human's daily quota
(`consumeGeneration` moved after the Azure call); here it is the agent's money (`settle`
moved after successful delivery). Same seam, two currencies — which is why the parallel-layer
architecture is coherent.

## Data flow (build)

1. Agent → `POST /v1/agent/sites { prompt }` (no auth).
2. x402 middleware: no proof → `402` + price + pay-to + nonce.
3. Agent wallet settles USDC via facilitator, retries with payment-proof header.
4. Middleware **verifies** (not capture) → next().
5. Route: `runLimited(() => generateDocument(prompt))` → render → `publish` to a generated
   slug → create `projects` row (owner = synthetic agent sentinel) → mint claim token.
6. **Settle** the payment.
7. Respond `200 { siteUrl, slug, claimToken, document }`.
8. Later: agent or human → claim. Human path is a web URL `/claim?token=…` that binds the
   synthetic owner to their account; agent path is `POST /v1/agent/sites/:id/claim`.

## Error handling

- **At capacity** → reuse `503 at_capacity` + `Retry-After`; do not settle. Agents obey
  `Retry-After` deterministically.
- **Generation failure after verify** → do not settle; 5xx; agent retries free.
- **Invalid/insufficient payment** → `402` again with a clear reason code.
- **Double-claim / invalid token** → `409`/`404` as appropriate; never rebind an already
  claimed site.

## Security

- Claim tokens: high entropy, hashed at rest, single-use.
- Synthetic agent owner: a sentinel owner id for unclaimed agent-built sites so they never
  collide with human accounts and are filterable.
- Anti-grief: x402 payment is the natural rate limiter (pay-per-call), but still cap
  concurrency via `gen-limiter` and add a cheap per-source sanity cap on *unpaid* 402
  issuance to avoid the 402 endpoint being hammered.
- No PII surface beyond the existing lead-capture design (already mailto/DB-safe).
- Leads inbox read requires proof of the claimed identity.

## Pricing (env-tunable)

- `AGENT_PRICE_BUILD_USDC` — build+publish, starting ~$1.00 (covers Azure generation cost +
  margin).
- `AGENT_PRICE_REFINE_USDC` — scoped refine, cheaper.
- Reads and claim — free.

## Testing (TDD)

- **x402 middleware** (fake `PaymentVerifier` injected): unpaid → `402` with correct
  price/headers; valid proof → `verify` passes → next; invalid/underfunded → `402`;
  **no `settle` when the downstream handler throws or returns at-capacity.**
- **claim-tokens:** mint is unique/high-entropy; only the hash is stored; claim binds
  owner; second claim rejected.
- **agent routes:** build happy-path (mocked `generateDocument`) → `{ siteUrl, claimToken,
  document }`; at-capacity → `503` and `settle` NOT called; claim transfers ownership;
  leads read gated on claimed identity.
- **discovery manifests:** `llms.txt`, `/openapi.json`, `/.well-known/x402`,
  `/.well-known/agent.json` serve valid, well-formed content.
- Reuse existing renderer/publish/limiter tests; no changes to the human path's tests.

## Manual gate (one human setup step, like the Stripe keys were)

A **USDC receiving wallet on Base + an x402 facilitator** (Coinbase hosted facilitator or
self-hosted verifier), configured via env (`X402_PAY_TO_ADDRESS`, `X402_FACILITATOR_URL`,
plus any facilitator credentials). The middleware's `PaymentVerifier` interface isolates
this so the exact SDK/facilitator is confirmed during the planning phase and remains
swappable.

## Deployment

Same as the rest of ai-webbuilder: `railway up --service web` (builds remotely; deploys
the linked worktree, not `main`). New env vars set on the `web` service. Additive table
created via psql (`CREATE TABLE IF NOT EXISTS`), never `drizzle-kit push`.
