# Living Sites — Phase 1 follow-ups (from final code review, 2026-06-02)

The feature is implemented and all tests pass (38). The autonomous loop is **dormant**:
it only runs when `GROWTH_AGENT_ENABLED=1` AND the new tables have been applied via `npm run db:push`.
Neither is true yet. The items below are **"must-fix before enabling the agent"** — they don't
affect the content-safety envelope (which is airtight: agent output is `sectionSchema`-validated
before it can reach the trusted, escaping renderer) and they're not live-exploitable.

## Fixed already
- **C1 (security):** auth + ownership added to the four Mission Control routes (`/goal`,
  `/experiments/:id/:action`, `/rollback/:version`, `GET /growth`); `/api/t` stays public. Commit `82963ef`.
- **I1:** Mission Control now surfaces proposed-or-running experiments (`getActionableExperiment`),
  so the default `suggest` mode is actionable. Commit `82963ef`.

## Open — wire before enabling the agent

### C2 — the conversion signal is never emitted (the loop can't conclude on real traffic)
The beacon (`server/serve-document.ts`) only pushes a `conversion` event when a clicked element has a
`data-conversion` attribute, but **no renderer template emits `data-conversion`**. On a real published
site, every variant's conversions stay 0, both rates are 0, and `decide()` returns "not significant"
forever. The end-to-end test passes only because it injects synthetic `conversion` events directly.
> Spec Risk #3 already flagged conversion-event wiring as a known integration seam.
**Fix:** emit `data-conversion` on the CTA whose `action` corresponds to `goal.conversionEvent`
(e.g. the primary hero/cta button), or, for Phase 1, treat a `cta_click` on the target section as the
conversion. Add a test that drives conversion *through* a beacon-shaped event, not a hand-injected one.

### I2 — exposure over-counting biases the z-test denominator
`storage.variantStats(experimentId)` counts **every** `section_view` tagged with a variantId as an
exposure, but the beacon tags *all* sections on the page with the visitor's variantId — so one
assignment can register many exposures. Conversions are per-visitor, so numerator and denominator are
on different scales (deflates measured rate, weakens the test).
**Fix:** count an exposure only for `section_view` where `sectionId === experiment.targetSectionId`
(look up the experiment in `variantStats`, or pass the target section key), or define exposure as
distinct `visitorId` per variant. The needed `sectionId` is already on the row.

### I3 — the guardrail is a structural no-op
`evaluateAndMaybePromote` computes `baseline` from the *current* funnel report and `checkGuardrail`
compares the *same* report's `nextStep` against it — `after` and `baseline` come from one report, so
`delta ≈ 0` always and the guardrail never blocks. It provides no real pre/post protection (acceptable
only because promotion is reversible via `/rollback`).
**Fix:** capture a true pre-experiment baseline at launch time (store the target section's
`nextStep`/rate on the experiment row) and compare the post-conclusion value against that stored
baseline — or remove the guardrail call so it doesn't imply protection it doesn't provide.

## Minor (optional)
- **M1:** section identity is index-based (`"<index>:<type>"`); safe in Phase 1 (promotes in place, no
  reorder) but a future `refine` that reorders sections could mis-target a same-type section. Consider a
  stable per-section `id` on `sectionSchema` in Phase 2.
- **M4:** `cryptoId()` in `growth-agent.ts` uses `Math.random()`; prefer `crypto.randomUUID()`.

## Operational gates (not code)
- **`npm run db:push`** must be run against the database to create the 5 new tables
  (`site_documents`, `site_goals`, `telemetry_events`, `experiments`, `decision_log`). This targets the
  **production** Postgres — additive only (new tables), but should be a deliberate, owner-approved step.
- The growth scheduler stays **off** until `GROWTH_AGENT_ENABLED=1` is set.
