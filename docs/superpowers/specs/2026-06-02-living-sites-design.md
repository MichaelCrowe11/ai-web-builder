# Living Sites — Outcome-Autonomous Websites — Design Spec

**Date:** 2026-06-02
**Project:** AI Web Builder (`~/Projects/ai-web-builder`)
**Status:** Design — pending approval

> **For agentic engineers:** the implementation plan derived from this spec REQUIRES the sub-skills
> `test-driven-development` and `subagent-driven-development`. Every unit below ships test-first.

---

## 1. Thesis

Today every AI site builder — Squarespace Blueprint, Wix ADI, Durable, and AI Web Builder v1 —
stops at the same place: **the AI generates a site, then the site is frozen.** A human edits it
forever after.

Living Sites changes the unit of work from *"generate a page"* to *"converge a page toward a
business outcome."* The owner declares a **goal** ("sell the $499 bundle", "book consult calls")
and **constraints** (brand, locked prices). A resident **growth agent** then continuously observes
real visitor behavior, proposes scoped changes, runs controlled experiments against live traffic,
keeps winners, and discards losers — moving the site toward the goal on its own.

**Why this is uniquely possible here — and not for Squarespace.** AI Web Builder's
`shared/site-document.ts` makes layout a *typed, bounded action space*: the AI emits only
schema-valid JSON `Section`s; a trusted renderer owns all markup and design. An autonomous
optimizer acting on this document **physically cannot** produce a broken build, a security hole, or
off-brand output. That safety envelope is the precondition for handing a live site to an agent.
Squarespace's grid-coordinate model + free-form human edits is an *unbounded* action space — it
cannot be safely automated. This is the moat.

---

## 2. Goals & Non-Goals

### In scope (this spec — Phase 1)
- A **goal + constraints** model owners declare per site.
- **First-party telemetry**: pageview, section-view, CTA-click, scroll-depth, conversion — no
  third-party trackers, no PII.
- An **experiment engine**: one active experiment per site, 2+ variants where each variant is a
  schema-valid `Section` patch, deterministic visitor assignment, winner decision with a
  min-sample + confidence gate.
- **Variant-aware serving**: published sites render the canonical document with the assigned
  variant patched in, and emit telemetry tagged with experiment + variant.
- A **minimal autonomous growth agent**: picks the single weakest section toward the goal, asks a
  Foundry model for N scoped candidate `Section`s, validates them, and launches one experiment.
  **Default mode is `suggest` (approve-before-apply).** Full-auto is opt-in.
- A **safety governor**: enforces locked sections, budgets, and a guardrail-regression check; every
  change is a new document version, so rollback is free.
- **Mission Control**: an owner dashboard to see the goal, the agent's hypotheses, running
  experiments with live deltas, the decision feed, and controls (pause, lock, autonomy toggle,
  rollback).

### Out of scope (Phase 2, noted in §8)
- More than one concurrent experiment per site.
- Advanced allocation (Thompson sampling / multi-armed bandit) — Phase 1 uses fixed 50/50 split.
- Automatic guardrail rollback without owner confirmation.
- Image/theme experiments (Phase 1 mutates copy + section structure only).
- Multi-page sites, cross-site learning.

### Non-negotiable invariants
- Every variant is a `Section` validated by the existing `sectionSchema`. No raw HTML/CSS ever.
- The agent never mutates a locked section or locked copy (prices, menu items).
- Every autonomous change is reversible via document version history.

---

## 3. Architecture

New and reused units, each with one purpose, a typed interface, and explicit dependencies. Reuses
the existing `chat()` Azure helper pattern from `server/document-gen.ts`, the Drizzle layer in
`server/storage.ts` + `shared/schema.ts`, the renderer in `server/renderer.ts`, and the
publish/serve path in `server/publish.ts` + `server/routes.ts`.

### 3.1 `shared/site-goal.ts` (new) — owner intent
Zod schema. The contract between "what the owner wants" and "what the agent may do".
```
Objective   = "sell_product" | "book_call" | "capture_lead" | "newsletter_signup" | "custom"
Autonomy    = "suggest" | "auto"
SiteGoal = {
  objective: Objective,
  conversionEvent: string,        // telemetry event name that counts as success
  description?: string,
  constraints: {
    lockedSectionIds: string[],   // agent may not touch these
    lockedCopy: boolean,          // never alter prices / menu / product copy
    brandVoice?: string,          // injected into the agent prompt
    autonomy: Autonomy,           // default "suggest"
    minExposuresPerVariant: number,  // decision gate, default 200
  }
}
```
Depends on: nothing. Consumed by: growth-agent, governor, Mission Control.

### 3.2 `shared/telemetry.ts` (new) — the site's senses
```
TelemetryEventType = "pageview" | "section_view" | "cta_click" | "scroll_depth" | "conversion"
TelemetryEvent = {
  siteId: string, visitorId: string, sessionId: string, ts: number,
  type: TelemetryEventType,
  sectionId?: string, experimentId?: string, variantId?: string,
  meta?: Record<string, string | number>,
}
```
A `<script>` beacon (rendered by the renderer) posts batched events to `POST /api/t`. Events use
`navigator.sendBeacon` and an `IntersectionObserver` for `section_view`. First-party only.

### 3.3 `server/telemetry.ts` (new) — ingestion + aggregation
- `ingest(events: TelemetryEvent[])` — validates and writes to a Drizzle `telemetry_events` table.
- `funnel(siteId, goal)` — returns per-section exposure/engagement and per-variant
  exposures/conversions for the active experiment. This is the only read the agent and the
  decision math need.
Depends on: `shared/telemetry.ts`, `server/storage.ts`. Consumed by: growth-agent, experiments,
Mission Control.

### 3.4 `shared/experiment.ts` (new) — experiment model + decision math
```
ExperimentStatus = "proposed" | "running" | "concluded" | "rejected"
Variant = {
  id: string, label: string,
  patch: Section | null,        // null = control (the canonical section)
}
Experiment = {
  id, siteId, status: ExperimentStatus,
  targetSectionId: string,      // the one section this experiment mutates
  hypothesis: string,           // why the agent proposed it
  conversionEvent: string,      // copied from SiteGoal.conversionEvent at creation
  variants: Variant[],          // [control, candidate, ...]
  createdBy: "agent" | "owner",
  minExposuresPerVariant: number,
  winnerVariantId?: string,
}
```
Pure functions (no I/O, fully unit-testable):
- `assignVariant(experiment, visitorId)` — `hash(visitorId + experiment.id) % variants.length`;
  deterministic so returning visitors are stable.
- `decide(experiment, stats)` — returns `{ decided: boolean, winnerVariantId?, reason }`. Phase 1
  rule: each variant has ≥ `minExposuresPerVariant`, and the leader's conversion rate beats the
  runner-up at a two-proportion z-test p < 0.05. Below the sample gate → not decided.
Depends on: `shared/site-document.ts` (the `Section`/`sectionSchema` type). Consumed by: serving,
growth-agent, governor.

### 3.5 `server/experiments.ts` (new) — experiment lifecycle (I/O)
- `create(experiment)` / `get(siteId)` / `conclude(id, winnerVariantId)` against a Drizzle
  `experiments` table (variants stored as validated JSON).
- `activeFor(siteId)` — the single running experiment, or null.
Depends on: `shared/experiment.ts`, `server/storage.ts`, governor.

### 3.6 `server/growth-agent.ts` (new) — the autonomous loop
Runs on a schedule (a guarded interval task; cron in Phase 2). For one site:
1. `pickWeakestLink(funnel, goal)` → `{ targetSectionId, hypothesis }`. Heuristic: the section
   with the worst engagement-to-next-step ratio toward `conversionEvent` (e.g. hero with high view
   but low CTA-click; or the highest-exit section). Pure, testable.
2. `proposeVariants(section, goal, hypothesis)` → `Section[]`. Calls Foundry via the existing
   `chat()` pattern; the prompt is scoped to **one section of a fixed `type`**, injects
   `brandVoice`, and demands JSON. Every candidate is parsed and **validated by `sectionSchema`**;
   invalid candidates are dropped (retry once).
3. `governor.assertAllowed(targetSectionId, goal)` — abort if locked / over budget.
4. Launch one experiment (`status: "running"` if `autonomy === "auto"`, else `"proposed"` awaiting
   owner approval in Mission Control).
5. On experiment conclude (driven by serving + `decide()`): if a candidate won,
   `governor.checkGuardrail()` then **promote** — write the winning `Section` into the canonical
   document (new version via `server/storage.ts`) and append to the decision log.
Depends on: telemetry, experiments, governor, `document-gen`'s `chat()` pattern, site-document.

### 3.7 `server/governor.ts` (new) — the safety envelope
- `assertAllowed(targetSectionId, goal)` — rejects locked sections; enforces "one active
  experiment" and `lockedCopy`.
- `checkGuardrail(experiment, stats)` — blocks promotion if the winner regresses a guardrail
  (bounce / scroll-depth) beyond a threshold; flags for owner instead.
- `audit(entry)` — append-only decision log surfaced in Mission Control.
Every mutation is a document version → rollback is just restoring a prior version.

### 3.8 Serving — extend `server/renderer.ts` + `server/publish.ts` + `server/routes.ts`
On a published-site request:
1. Load canonical `SiteDocument` (existing path).
2. `experiments.activeFor(siteId)`; if running, `assignVariant(exp, visitorId)` (first-party
   cookie `vid`); if the variant has a non-null `patch`, replace the target section in the document
   with it.
3. Render (existing renderer — the patch is a valid `Section`, so nothing else changes).
4. Inject the telemetry beacon with `{ siteId, experimentId, variantId }` context.
Variant assignment and patching happen **before** render; the renderer stays oblivious to
experiments (clean boundary).

### 3.9 Mission Control — `client/src/pages/growth.tsx` (new)
Owner stays in command. Shows: the goal (editable), the agent's current hypothesis, the running
experiment (control vs candidate with live conversion deltas + sample progress), the decision feed
("Rewrote hero headline → +18% CTA-click → promoted"), and controls: **pause agent**, **lock
section**, **autonomy toggle (suggest/auto)**, **approve/reject a proposed experiment**,
**rollback** to a prior version. You supervise; you don't drag boxes.

---

## 4. Data Flow

```
visitor → published site (SSR: canonical doc + assigned variant patch, beacon injected)
        → telemetry beacon → POST /api/t → telemetry_events (Postgres)
growth-agent (scheduled) → telemetry.funnel() → pickWeakestLink()
        → proposeVariants() via Foundry → sectionSchema validate → governor.assertAllowed()
        → experiments.create()  [running if auto, else proposed → owner approves]
serving assigns variants → telemetry measures exposures + conversions
        → decide() reaches sample+confidence gate → governor.checkGuardrail()
        → promote winner into canonical doc (new version) → audit log → loop
owner ← Mission Control (supervise / pause / lock / approve / rollback)
```

---

## 5. New persistence (Drizzle — `shared/schema.ts` + migration)
- `site_goals` (siteId PK, goal JSON).
- `telemetry_events` (id, siteId, visitorId, sessionId, ts, type, sectionId, experimentId,
  variantId, meta JSON) — indexed on (siteId, ts) and (experimentId, variantId).
- `experiments` (id, siteId, status, targetSectionId, hypothesis, conversionEvent, variants JSON,
  createdBy, minExposuresPerVariant, winnerVariantId) — partial unique index enforcing **one
  running experiment per site**.
- `decision_log` (id, siteId, ts, kind, detail JSON).

---

## 6. Safety & Privacy
- **Bounded action space:** variants are `Section`s validated by `sectionSchema` — no raw markup,
  no CSS, no code. Off-brand impossible (curated theme presets unchanged).
- **Locks + budgets** enforced by the governor before any experiment launches.
- **Reversibility:** every promotion is a document version; rollback restores a prior one.
- **Default `suggest` mode:** nothing goes live without owner approval until they opt into `auto`.
- **Privacy:** first-party events only, no PII, no third-party trackers; visitor id is a random
  first-party cookie. GDPR-friendly by construction.

---

## 7. Testing Strategy (test-first)
- **Pure unit (no I/O):** `assignVariant` determinism + uniform distribution; `decide()` honors the
  sample gate and z-test; `pickWeakestLink` selects the true worst link on fixtures; `sectionSchema`
  rejects malformed agent output.
- **Governor:** locked-section rejection, one-active-experiment enforcement, guardrail block.
- **Integration (mock Foundry, seeded RNG):** full loop — fixture telemetry → agent proposes →
  experiment runs → simulated conversions drive `decide()` → winner promoted → canonical doc
  updated + audit logged. Deterministic, no network.
- **Renderer:** a patched document renders valid output identical in structure to the canonical
  (the patch is a same-`type` `Section`).
- **Serving:** returning visitor (same `vid`) gets a stable variant; telemetry carries the right
  experiment/variant tags.

---

## 8. Phase 2 (explicitly deferred)
Concurrent experiments; Thompson-sampling allocation; auto guardrail rollback; image/theme
experiments; multi-page; cross-site priors ("headlines like X convert for cafés"). None are needed
to prove outcome autonomy.

---

## 9. Risks & Open Questions
1. **Low traffic → slow decisions.** Many AI Web Builder sites get little traffic, so the sample
   gate may rarely trip. Mitigation: surface "directional, not yet significant" results in Mission
   Control and let the owner accept a leader manually; keep experiments open-ended.
2. **Agent proposal quality.** Scoped single-section prompts + schema validation + a one-shot retry
   keep cost low and output safe, but quality depends on the Foundry model. The `suggest` default
   means a human filters early proposals while we tune prompts.
3. **Conversion event definition.** For `sell_product` the conversion is a Stripe/checkout event —
   wiring that signal into telemetry for non-hosted commerce is a known integration seam (the
   storefront funnel we just shipped is the reference).
4. **Guardrail thresholds** need empirical tuning; start conservative and owner-confirmed.
```
