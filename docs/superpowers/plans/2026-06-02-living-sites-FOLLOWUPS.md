# Living Sites — Phase 1 follow-ups (from final code review, 2026-06-02)

The feature is implemented and all tests pass (38). The autonomous loop is **dormant**:
it only runs when `GROWTH_AGENT_ENABLED=1` AND the new tables have been applied via `npm run db:push`.
Neither is true yet. The items below are **"must-fix before enabling the agent"** — they don't
affect the content-safety envelope (which is airtight: agent output is `sectionSchema`-validated
before it can reach the trusted, escaping renderer) and they're not live-exploitable.

## All review findings — FIXED

- **C1 (security):** auth + ownership added to the four Mission Control routes (`/goal`,
  `/experiments/:id/:action`, `/rollback/:version`, `GET /growth`); `/api/t` stays public. Commit `82963ef`.
- **I1:** Mission Control now surfaces proposed-or-running experiments (`getActionableExperiment`),
  so the default `suggest` mode is actionable. Commit `82963ef`.
- **C2 (conversion wired):** the renderer now emits `data-conversion="1"` on hero/cta CTA buttons, and
  the beacon's conversion push carries the section key, so real CTA clicks produce `conversion` events
  the z-test consumes. Commit `3f63d48`.
- **I2 (exposure counting):** `variantStats` now counts a `section_view` as an exposure only when its
  `sectionId === experiment.targetSectionId` (both storage classes). Commit `3f63d48`.
- **I3 (real guardrail):** `runGrowthCycle` captures `baselineConversionRate` for the target section at
  launch; `evaluateAndMaybePromote` compares the winner variant's conversion rate against it and blocks
  promotion on a >20% regression. `checkGuardrail` rewritten to a real winner-rate-vs-baseline test.
  Commit `5573901`.

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
