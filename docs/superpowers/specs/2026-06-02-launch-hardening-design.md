# Launch-Readiness Hardening — Design

**Date:** 2026-06-02
**Branch:** `feat/launch-hardening` (off `feat/quality-rebrand`)
**Goal:** De-risk a Product Hunt launch. PH is a one-shot, high-attention event that
hits the app's most fragile surface — the generation endpoint, which calls Azure and
has already thrown `429 RateLimitReached`. Make a spike survivable, give visitors
instant proof before they generate, and walk the cold-start funnel.

## Decisions (locked with the user)

1. **Overload UX = graceful wait, never fail.** Cap concurrent Azure calls in-process;
   overflow gets a calm "queued, ~Ns" state that auto-retries and almost always
   succeeds. No stranger sees a hard error. No new infra.
2. **Gallery = 6 curated, live, clickable showcase sites.** Generated through the real
   pipeline, published under reserved slugs, featured on the home page with real
   screenshot thumbnails linking to the live sites.

## Non-goals (YAGNI)

- No Redis/BullMQ job queue (single Railway instance → in-process semaphore is the
  correct unit; a queue adds infra + an async UX + one more launch-day failure mode).
- No Railway horizontal autoscaling (more replicas = more concurrent Azure calls =
  faster quota exhaustion; it fights the limiter, doesn't help).
- No dynamic "recently built" feed (only 2 thin sites exist; quality uncontrolled).
- No generated-site renderer changes; no rebrand changes.

---

## Workstream 1 — Spike resilience

### New module: `server/gen-limiter.ts`

A process-local concurrency gate around the expensive Azure generation calls.

- **Semaphore** with `MAX_CONCURRENT` permits. Env `AI_WEBBUILDER_MAX_CONCURRENT`,
  default `4`. Tunable against observed Azure behavior.
- **Bounded wait-queue.** A request without a free permit waits up to `MAX_WAIT_MS`
  (env `AI_WEBBUILDER_MAX_WAIT_MS`, default `25000`) for one. If the queue is already
  at `MAX_QUEUE` depth (env `AI_WEBBUILDER_MAX_QUEUE`, default `30`) **or** the wait
  times out → throw a typed `AtCapacityError` carrying `retryAfterMs`.
- **API:** `runLimited<T>(fn: () => Promise<T>): Promise<T>`. Acquires a permit (or
  queues), runs `fn`, **releases the permit in a `finally`** so it never leaks on
  success or throw. `AtCapacityError extends Error` with a `retryAfterMs: number`
  field and a stable `name = "AtCapacityError"`.
- **Why in-process:** prod is a single Railway service. A process-local semaphore
  hard-bounds how many concurrent calls we make to Azure — which is exactly what
  prevents the retry storm and hard quota exhaustion. If the app is ever scaled to N
  replicas, the effective cap becomes `N * MAX_CONCURRENT`; documented as a known
  limit, acceptable for launch.

### Routes (`server/routes.ts`)

Wrap the Azure generation call (only that call, not the whole handler) in `runLimited`
for the four generating routes: `/api/generate/document`, `/api/generate/outline`,
`/api/generate/fill`, and the legacy `/api/generate`. (`/api/refine` optional — same
pattern; include it since it is also an Azure call.)

```ts
// before:  const raw = await fillDocument(parsed.data, prompt);
// after:   const raw = await runLimited(() => fillDocument(parsed.data, prompt));
```

On `AtCapacityError`, respond `503` with a `Retry-After` header (seconds) and JSON
`{ error: "at_capacity", retryAfterMs }`. Every generating route's `catch` block
distinguishes the capacity case from a real failure:

```ts
} catch (error: any) {
  if (error?.name === "AtCapacityError") {
    res.setHeader("Retry-After", Math.ceil(error.retryAfterMs / 1000));
    return res.status(503).json({ error: "at_capacity", retryAfterMs: error.retryAfterMs });
  }
  log(`... error: ${error.message}`);
  return res.status(500).json({ error: "Failed to generate site", details: error.message });
}
```

**Quota safety (verified):** `consumeGeneration(req)` is called *after* the Azure call
in every route (`routes.ts:60/102/130/296`). Because `runLimited` wraps the Azure call
and `AtCapacityError` throws before the consume point, a 503 **does not** consume the
visitor's daily quota. No quota-refund logic needed — placement guarantees it. The
gen-limiter test + a route test assert this.

### Client (`client/src/pages/builder.tsx`)

The generate flow (two-phase: outline then fill, plus legacy/refine) detects a `503`
with `{ error: "at_capacity" }`:

- Show a calm inline state: **"High demand right now — your site is queued (~Ns)"**
  styled in the existing gold-on-graphite chrome (reuse the generation-overlay pill,
  not an error toast).
- **Auto-retry** after `retryAfterMs` plus jitter (±20%), up to `MAX_CLIENT_RETRIES`
  (e.g. 5). Each retry re-issues the same phase call. Because the server bounds
  concurrency, permits free as in-flight calls finish, so retries drain and the
  visitor almost always lands within a cycle or two.
- Only after exhausting retries does it fall back to a soft message ("still very busy —
  try again in a moment") — never a hard crash.

A small helper (e.g. `fetchWithCapacityRetry`) centralizes the retry so all generate
calls share it; keep it unit-testable (pure given an injected fetch + sleep).

### Composition with existing retry

`server/azure-chat.ts` keeps its per-request retry/fallback (429/408/5xx backoff +
model-chain fallback). That handles micro-blips *below* the concurrency ceiling; the
limiter handles the macro spike. They stack: limiter bounds fan-out, azure-chat absorbs
individual hiccups.

---

## Workstream 2 — Example gallery

### Generate + publish 6 showcase sites

Through the **real pipeline** so they are genuinely representative output:

| slug | industry | business (example) |
|------|----------|--------------------|
| `showcase-cafe`     | café / coffee     | Bean & Bough |
| `showcase-plumber`  | trades / plumbing | Northside Plumbing |
| `showcase-salon`    | salon / beauty    | Lumen Studio |
| `showcase-law`      | professional / law| Hart & Vale |
| `showcase-florist`  | florist / retail  | Wild Stem |
| `showcase-gym`      | fitness           | Iron Atlas |

- Owned by a dedicated **`showcase` account** (not a personal project) so they are
  durable and won't be GC'd or accidentally edited. Pro plan on the account so Pro
  images render (they should look expensive).
- Published under the reserved slugs above (`<slug>.ai-webbuilder.com`).
- Industries are a starting set; swap any per user preference.

### Thumbnails

Capture a screenshot of each live published page via a headless browser →
`client/public/showcase/<slug>.jpg` (≈1200×800, optimized). Screenshots of the *real*
site (not a mockup) keep the proof honest.

### Home gallery section

- New component `client/src/components/showcase-gallery.tsx`: a responsive grid of 6
  cards (thumbnail + industry eyebrow + business name), each an anchor to the live
  `https://<slug>.ai-webbuilder.com`. Lazy-loaded images, gold-on-graphite chrome,
  square-ish radii to match.
- Inserted into `client/src/pages/home.tsx` below the hero / above or near the feature
  grid, with a short eyebrow + heading ("Built by the prompt, live in one click" or
  similar).
- **Static client manifest** (`client/src/lib/showcase.ts`): an array of
  `{ slug, name, industry, thumb }`. No runtime API/DB call → zero added load, fully
  durable. Updating the gallery = edit the manifest + drop in a screenshot.

---

## Workstream 3 — Cold-start funnel + hygiene

### Funnel walk

Drive the cold path as an anonymous visitor and fix friction found:
land → type prompt → anon trial generate → signup wall → create account → generate
again → hit Pro paywall → test-mode Stripe checkout. Watch for broken links, confusing
CTAs, ungraceful error states, and the new at-capacity state behaving correctly.
Targeted fixes only — not a redesign.

### Merge PR #4

After the hardening work lands on `feat/launch-hardening`, decide merge order with the
user. Cleanest: merge `feat/quality-rebrand` (PR #4) to main, then this branch. The
goal is GitHub source-of-truth == deployed prod.

---

## Testing

- **`server/gen-limiter.test.ts`** (vitest, injected timers/fakes):
  - permits cap concurrency (N+1th call does not start until one releases);
  - a queued call proceeds when a permit frees;
  - over-`MAX_QUEUE` or past-`MAX_WAIT_MS` throws `AtCapacityError` with `retryAfterMs`;
  - permit released on both success and throw (run twice past the cap, no leak/deadlock).
- **Route test:** a generating route returns `503` + `Retry-After` + `at_capacity`
  body when the limiter throws, and `consumeGeneration` was not called (quota intact).
- **Client:** unit-test `fetchWithCapacityRetry` (injected fetch + sleep): retries on
  503, succeeds on a later 200, gives up after max with a soft message; passes through
  non-503 errors unchanged.
- **Live load test:** fire `MAX_CONCURRENT + a few` concurrent generate calls against
  prod (or a preview) and confirm graceful queueing (some 200s, overflow 503→retry→200),
  not a wall of failures. Confirm a 503'd anon visitor's quota is unchanged.

## Build sequence

1. `gen-limiter.ts` + tests (TDD).
2. Wire `runLimited` into the 4 (+refine) routes + the 503/Retry-After catch; route test.
3. Client `fetchWithCapacityRetry` + the calm at-capacity UX in `builder.tsx`; client test.
4. Gate (vitest + tsc + build), deploy, live load test.
5. Create `showcase` account; generate + publish the 6 sites (Pro images on).
6. Screenshot each → `client/public/showcase/`; build the manifest + gallery component;
   wire into home; gate + deploy; verify thumbnails link to live sites.
7. Cold-start funnel walk; fix friction.
8. Merge PR #4 (order TBD with user); final verify.

## Open knobs (tune, not blockers)

- `MAX_CONCURRENT` default **4** — tune against observed Azure 429 behavior under the
  live load test.
- Showcase industries — the 6 above are a default; swap per audience.
