# Living Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every AI Web Builder site a resident "growth agent" that observes real visitor behavior, runs schema-safe A/B experiments against live traffic, and promotes winners toward an owner-declared business goal — all inside the typed `SiteDocument` action space so it can never break a build or go off-brand.

**Architecture:** Eight units, test-first. Pure decision math (`shared/experiment.ts`) and the weakest-link heuristic are I/O-free and exhaustively unit-tested. Persistence is additive Drizzle/Postgres tables. The Foundry call is dependency-injected so the full loop runs deterministically in tests with no network. Variant assignment + patching happen *before* the existing renderer, which stays oblivious to experiments.

**Tech Stack:** TypeScript (ESM), Express, Drizzle ORM (PostgreSQL), Zod, Vitest (new), Foundry/Azure chat via the existing `chat()` helper, React (Mission Control page).

---

## Ground-truth deviations from the spec (resolved here)

These were discovered by reading the codebase; the spec assumed otherwise. Each is resolved minimally and additively:

1. **Sections carry no `id`.** We identify a section by a deterministic **section key** `` `${index}:${type}` `` via a pure helper in `shared/site-document.ts`. `SiteGoal.constraints.lockedSectionIds`, `Experiment.targetSectionId`, etc. all hold these keys. Valid for Phase 1 because the agent only *replaces a section in place* (same index, same `type`); it never reorders. (Phase 2: real persisted section ids.)
2. **No SiteDocument persistence / versioning.** `projects` stores rendered `html`/`css`; `IStorage` has no document or version methods. We add a `site_documents` table (one row per version) + storage methods. Living-Sites-managed sites are **document-backed**: serving loads the latest stored `SiteDocument`, patches the assigned variant, and renders with the existing `renderDocumentFull(doc)`. Existing html/css publishing is untouched.
3. **No test runner.** Add Vitest (ESM-native, matches `"type": "module"`).
4. **`chat()` / `extractJson()` are module-private** in `server/document-gen.ts`. We export them so `server/growth-agent.ts` can reuse the exact Foundry pattern; the growth agent injects `chat` for testability.

All JSON columns use Postgres `jsonb`. All new tables go in `shared/schema.ts` and are applied with `npm run db:push`.

---

## File Structure

**New — shared (pure, no I/O):**
- `shared/site-goal.ts` — `SiteGoal` Zod schema + types (owner intent).
- `shared/telemetry.ts` — `TelemetryEvent` types/schema + `FunnelReport` type (the site's senses).
- `shared/experiment.ts` — `Experiment`/`Variant` types + **pure decision math** (`assignVariant`, `decide`).
- `shared/section-key.ts` — deterministic section identity helpers.

**New — server (I/O + logic):**
- `server/telemetry.ts` — `ingest()` + `funnel()`.
- `server/experiments.ts` — experiment lifecycle (`create`/`get`/`activeFor`/`conclude`).
- `server/governor.ts` — safety envelope (`assertAllowed`/`checkGuardrail`/`audit`).
- `server/growth-agent.ts` — `pickWeakestLink` (pure) + `proposeVariants` (injected Foundry) + `runGrowthCycle`/`promoteWinner`.
- `server/growth-routes.ts` — `POST /api/t` (telemetry), Mission Control API, registered from `server/routes.ts`.

**New — client:**
- `client/src/pages/growth.tsx` — Mission Control.

**Modified:**
- `shared/site-document.ts` — re-export section-key helpers (and a `patchSection` pure helper).
- `shared/schema.ts` — 5 new tables (`site_documents`, `site_goals`, `telemetry_events`, `experiments`, `decision_log`).
- `server/storage.ts` — new `IStorage` methods + Drizzle impls for the new tables.
- `server/document-gen.ts` — `export` `chat` and `extractJson`.
- `server/publish.ts` — variant-aware document serving + beacon injection for document-backed sites.
- `server/routes.ts` — call `registerGrowthRoutes(app)`.
- `package.json` — `vitest` dev dep + `test` script.

---

## Task 1: Vitest test harness

**Files:**
- Modify: `package.json` (scripts + devDependencies)
- Create: `vitest.config.ts`
- Create: `shared/__smoke__.test.ts` (temporary, deleted at end of task)

- [ ] **Step 1: Install Vitest**

```bash
cd ~/Projects/ai-web-builder
npm install -D vitest@^2
```

- [ ] **Step 2: Create `vitest.config.ts`** (resolves the `@shared`/`@` aliases so tests import like the app)

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["shared/**/*.test.ts", "server/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@": fileURLToPath(new URL("./client/src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3: Add the `test` script to `package.json`**

In the `"scripts"` block add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write a smoke test to prove the harness + alias work**

```typescript
// shared/__smoke__.test.ts
import { describe, it, expect } from "vitest";
import { siteDocumentSchema } from "@shared/site-document";

describe("harness", () => {
  it("loads vitest and the @shared alias", () => {
    expect(typeof siteDocumentSchema.parse).toBe("function");
  });
});
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npm test`
Expected: 1 passed. If the `@shared` import fails, the alias in `vitest.config.ts` is wrong — fix before continuing.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm shared/__smoke__.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest harness with @shared/@ aliases"
```

---

## Task 2: Deterministic section identity (`shared/section-key.ts`)

The agent references sections by a stable key derived from position + type, and patches a section in place. Pure, fully testable.

**Files:**
- Create: `shared/section-key.ts`
- Test: `shared/section-key.test.ts`
- Modify: `shared/site-document.ts` (re-export for ergonomics)

- [ ] **Step 1: Write the failing test**

```typescript
// shared/section-key.test.ts
import { describe, it, expect } from "vitest";
import type { SiteDocument } from "@shared/site-document";
import { sectionKey, findSectionIndex, patchSection } from "@shared/section-key";

const doc = (): SiteDocument => ({
  version: 1,
  meta: { name: "Acme" },
  theme: { preset: "minimal", radius: "medium" } as SiteDocument["theme"],
  sections: [
    { type: "hero", heading: "Old", subheading: "x", ctaLabel: "Go", ctaHref: "#" } as any,
    { type: "cta", heading: "Book", ctaLabel: "Call", ctaHref: "#" } as any,
  ],
});

describe("section-key", () => {
  it("derives a stable key from index + type", () => {
    expect(sectionKey(doc(), 0)).toBe("0:hero");
    expect(sectionKey(doc(), 1)).toBe("1:cta");
  });

  it("finds the index for a key, or -1", () => {
    expect(findSectionIndex(doc(), "1:cta")).toBe(1);
    expect(findSectionIndex(doc(), "5:hero")).toBe(-1);
    expect(findSectionIndex(doc(), "0:cta")).toBe(-1); // type must match too
  });

  it("patchSection replaces in place and returns a NEW document (no mutation)", () => {
    const d = doc();
    const replacement = { type: "hero", heading: "New", subheading: "y", ctaLabel: "Go", ctaHref: "#" } as any;
    const next = patchSection(d, "0:hero", replacement);
    expect((next.sections[0] as any).heading).toBe("New");
    expect((d.sections[0] as any).heading).toBe("Old"); // original untouched
    expect(next).not.toBe(d);
  });

  it("patchSection throws if the key does not resolve", () => {
    expect(() => patchSection(doc(), "9:hero", {} as any)).toThrow(/no section/i);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found)

Run: `npx vitest run shared/section-key.test.ts`
Expected: FAIL — cannot resolve `@shared/section-key`.

- [ ] **Step 3: Implement `shared/section-key.ts`**

```typescript
// shared/section-key.ts
import type { SiteDocument, Section } from "./site-document";

/** Stable identity for a section: its array index plus its discriminated type. */
export function sectionKey(doc: SiteDocument, index: number): string {
  return `${index}:${doc.sections[index].type}`;
}

/** Resolve a section key back to its array index, or -1 if it no longer matches. */
export function findSectionIndex(doc: SiteDocument, key: string): number {
  const [idxRaw, type] = key.split(":");
  const idx = Number(idxRaw);
  if (!Number.isInteger(idx) || idx < 0 || idx >= doc.sections.length) return -1;
  return doc.sections[idx].type === type ? idx : -1;
}

/** Return a new document with the keyed section replaced. Never mutates the input. */
export function patchSection(doc: SiteDocument, key: string, replacement: Section): SiteDocument {
  const idx = findSectionIndex(doc, key);
  if (idx === -1) throw new Error(`patchSection: no section for key "${key}"`);
  const sections = doc.sections.slice();
  sections[idx] = replacement;
  return { ...doc, sections };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run shared/section-key.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Re-export from `shared/site-document.ts`** (append at end of file)

```typescript
// shared/site-document.ts (append)
export { sectionKey, findSectionIndex, patchSection } from "./section-key";
```

- [ ] **Step 6: Commit**

```bash
git add shared/section-key.ts shared/section-key.test.ts shared/site-document.ts
git commit -m "feat: deterministic section keys + immutable patchSection"
```

---

## Task 3: Owner intent (`shared/site-goal.ts`)

**Files:**
- Create: `shared/site-goal.ts`
- Test: `shared/site-goal.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/site-goal.test.ts
import { describe, it, expect } from "vitest";
import { siteGoalSchema, defaultConstraints, type SiteGoal } from "@shared/site-goal";

describe("siteGoalSchema", () => {
  it("accepts a minimal valid goal and applies constraint defaults", () => {
    const g = siteGoalSchema.parse({
      objective: "sell_product",
      conversionEvent: "checkout_started",
      constraints: { lockedSectionIds: [] },
    });
    expect(g.constraints.autonomy).toBe("suggest");
    expect(g.constraints.minExposuresPerVariant).toBe(200);
    expect(g.constraints.lockedCopy).toBe(true);
  });

  it("rejects an unknown objective", () => {
    expect(() =>
      siteGoalSchema.parse({ objective: "go_viral", conversionEvent: "x", constraints: { lockedSectionIds: [] } }),
    ).toThrow();
  });

  it("defaultConstraints is a complete constraint object", () => {
    expect(defaultConstraints()).toMatchObject({ autonomy: "suggest", lockedCopy: true, minExposuresPerVariant: 200, lockedSectionIds: [] });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run shared/site-goal.test.ts`
Expected: FAIL — cannot resolve `@shared/site-goal`.

- [ ] **Step 3: Implement `shared/site-goal.ts`**

```typescript
// shared/site-goal.ts
import { z } from "zod";

export const objectiveEnum = z.enum([
  "sell_product", "book_call", "capture_lead", "newsletter_signup", "custom",
]);
export type Objective = z.infer<typeof objectiveEnum>;

export const autonomyEnum = z.enum(["suggest", "auto"]);
export type Autonomy = z.infer<typeof autonomyEnum>;

export const constraintsSchema = z.object({
  lockedSectionIds: z.array(z.string()).default([]),
  lockedCopy: z.boolean().default(true),
  brandVoice: z.string().optional(),
  autonomy: autonomyEnum.default("suggest"),
  minExposuresPerVariant: z.number().int().positive().default(200),
});
export type Constraints = z.infer<typeof constraintsSchema>;

export const siteGoalSchema = z.object({
  objective: objectiveEnum,
  conversionEvent: z.string().min(1),
  description: z.string().optional(),
  constraints: constraintsSchema,
});
export type SiteGoal = z.infer<typeof siteGoalSchema>;

export function defaultConstraints(): Constraints {
  return constraintsSchema.parse({ lockedSectionIds: [] });
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run shared/site-goal.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add shared/site-goal.ts shared/site-goal.test.ts
git commit -m "feat: SiteGoal schema with constraint defaults"
```

---

## Task 4: Telemetry types + funnel shape (`shared/telemetry.ts`)

**Files:**
- Create: `shared/telemetry.ts`
- Test: `shared/telemetry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/telemetry.test.ts
import { describe, it, expect } from "vitest";
import { telemetryEventSchema, telemetryBatchSchema } from "@shared/telemetry";

const base = { siteId: "s1", visitorId: "v1", sessionId: "se1", ts: 1717000000000 };

describe("telemetryEventSchema", () => {
  it("accepts a valid conversion event with experiment tags", () => {
    const e = telemetryEventSchema.parse({ ...base, type: "conversion", experimentId: "e1", variantId: "var1" });
    expect(e.type).toBe("conversion");
  });

  it("rejects an unknown event type", () => {
    expect(() => telemetryEventSchema.parse({ ...base, type: "rage_click" })).toThrow();
  });

  it("batch schema caps the array and rejects empty", () => {
    expect(() => telemetryBatchSchema.parse([])).toThrow();
    const big = Array.from({ length: 51 }, () => ({ ...base, type: "pageview" as const }));
    expect(() => telemetryBatchSchema.parse(big)).toThrow();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run shared/telemetry.test.ts`
Expected: FAIL — cannot resolve `@shared/telemetry`.

- [ ] **Step 3: Implement `shared/telemetry.ts`**

```typescript
// shared/telemetry.ts
import { z } from "zod";
import type { SectionType } from "./site-document";

export const telemetryEventTypeEnum = z.enum([
  "pageview", "section_view", "cta_click", "scroll_depth", "conversion",
]);
export type TelemetryEventType = z.infer<typeof telemetryEventTypeEnum>;

export const telemetryEventSchema = z.object({
  siteId: z.string().min(1),
  visitorId: z.string().min(1),
  sessionId: z.string().min(1),
  ts: z.number().int(),
  type: telemetryEventTypeEnum,
  sectionId: z.string().optional(),     // a section key, e.g. "0:hero"
  experimentId: z.string().optional(),
  variantId: z.string().optional(),
  meta: z.record(z.union([z.string(), z.number()])).optional(),
});
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

/** A single beacon POST carries 1..50 events. */
export const telemetryBatchSchema = z.array(telemetryEventSchema).min(1).max(50);

/** Per-section funnel stat (engagement toward the next step). */
export interface SectionStat {
  key: string;          // section key
  type: SectionType;
  views: number;        // section_view count
  nextStep: number;     // cta_click count attributed to this section
}

/** Per-variant outcome for the active experiment. */
export interface VariantStat {
  variantId: string;
  exposures: number;    // section_view of the experiment's target, tagged with this variant
  conversions: number;  // conversion events tagged with this variant
}

export interface FunnelReport {
  siteId: string;
  sections: SectionStat[];
  variants: VariantStat[]; // empty when no active experiment
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run shared/telemetry.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add shared/telemetry.ts shared/telemetry.test.ts
git commit -m "feat: telemetry event schema + funnel report types"
```

---

## Task 5: Experiment model + decision math (`shared/experiment.ts`) — the heart

Pure, no I/O. This is the most-tested unit.

**Files:**
- Create: `shared/experiment.ts`
- Test: `shared/experiment.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/experiment.test.ts
import { describe, it, expect } from "vitest";
import { assignVariant, decide, experimentSchema, type Experiment } from "@shared/experiment";
import type { VariantStat } from "@shared/telemetry";

const exp = (): Experiment => ({
  id: "e1",
  siteId: "s1",
  status: "running",
  targetSectionId: "0:hero",
  hypothesis: "headline too vague",
  conversionEvent: "checkout_started",
  variants: [
    { id: "control", label: "Control", patch: null },
    { id: "cand", label: "Candidate", patch: { type: "hero", heading: "Buy now", subheading: "x", ctaLabel: "Go", ctaHref: "#" } as any },
  ],
  createdBy: "agent",
  minExposuresPerVariant: 200,
});

describe("assignVariant", () => {
  it("is deterministic for the same visitor + experiment", () => {
    const a = assignVariant(exp(), "visitor-42");
    const b = assignVariant(exp(), "visitor-42");
    expect(a.id).toBe(b.id);
  });

  it("distributes roughly evenly across variants", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const v = assignVariant(exp(), `v${i}`);
      counts[v.id] = (counts[v.id] ?? 0) + 1;
    }
    // each arm within 40-60% of 2000
    for (const id of ["control", "cand"]) expect(counts[id]).toBeGreaterThan(800);
  });
});

describe("decide", () => {
  const stats = (c: VariantStat, k: VariantStat): VariantStat[] => [c, k];

  it("does NOT decide below the sample gate", () => {
    const r = decide(exp(), stats(
      { variantId: "control", exposures: 50, conversions: 5 },
      { variantId: "cand", exposures: 50, conversions: 25 },
    ));
    expect(r.decided).toBe(false);
    expect(r.reason).toMatch(/sample/i);
  });

  it("decides a clear winner past the gate (z-test p<0.05)", () => {
    const r = decide(exp(), stats(
      { variantId: "control", exposures: 400, conversions: 40 },  // 10%
      { variantId: "cand", exposures: 400, conversions: 88 },     // 22%
    ));
    expect(r.decided).toBe(true);
    expect(r.winnerVariantId).toBe("cand");
  });

  it("does NOT decide when arms are statistically tied past the gate", () => {
    const r = decide(exp(), stats(
      { variantId: "control", exposures: 400, conversions: 80 },  // 20%
      { variantId: "cand", exposures: 400, conversions: 84 },     // 21%
    ));
    expect(r.decided).toBe(false);
    expect(r.reason).toMatch(/significan/i);
  });

  it("experimentSchema rejects an experiment with <2 variants", () => {
    expect(() => experimentSchema.parse({ ...exp(), variants: [{ id: "x", label: "x", patch: null }] })).toThrow();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run shared/experiment.test.ts`
Expected: FAIL — cannot resolve `@shared/experiment`.

- [ ] **Step 3: Implement `shared/experiment.ts`**

```typescript
// shared/experiment.ts
import { z } from "zod";
import { sectionSchema } from "./site-document";
import type { VariantStat } from "./telemetry";

export const experimentStatusEnum = z.enum(["proposed", "running", "concluded", "rejected"]);
export type ExperimentStatus = z.infer<typeof experimentStatusEnum>;

export const variantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  patch: sectionSchema.nullable(), // null = control (the canonical section)
});
export type Variant = z.infer<typeof variantSchema>;

export const experimentSchema = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  status: experimentStatusEnum,
  targetSectionId: z.string().min(1),  // a section key
  hypothesis: z.string(),
  conversionEvent: z.string().min(1),
  variants: z.array(variantSchema).min(2),
  createdBy: z.enum(["agent", "owner"]),
  minExposuresPerVariant: z.number().int().positive(),
  winnerVariantId: z.string().optional(),
});
export type Experiment = z.infer<typeof experimentSchema>;

/** Deterministic FNV-1a hash → stable variant for a visitor. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function assignVariant(exp: Experiment, visitorId: string): Variant {
  const idx = hash(`${visitorId}:${exp.id}`) % exp.variants.length;
  return exp.variants[idx];
}

export interface DecideResult {
  decided: boolean;
  winnerVariantId?: string;
  reason: string;
}

/** Two-proportion z-test against the runner-up; gated on min exposures. */
export function decide(exp: Experiment, stats: VariantStat[]): DecideResult {
  const byId = new Map(stats.map((s) => [s.variantId, s]));
  for (const v of exp.variants) {
    const s = byId.get(v.id);
    if (!s || s.exposures < exp.minExposuresPerVariant) {
      return { decided: false, reason: `sample gate: ${v.id} has ${s?.exposures ?? 0}/${exp.minExposuresPerVariant} exposures` };
    }
  }
  const rate = (s: VariantStat) => s.conversions / s.exposures;
  const ranked = [...stats].sort((a, b) => rate(b) - rate(a));
  const leader = ranked[0];
  const runner = ranked[1];

  const p1 = rate(leader), p2 = rate(runner);
  const pPool = (leader.conversions + runner.conversions) / (leader.exposures + runner.exposures);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / leader.exposures + 1 / runner.exposures));
  const z = se === 0 ? 0 : (p1 - p2) / se;

  if (Math.abs(z) < 1.96) {
    return { decided: false, reason: `not significant (z=${z.toFixed(2)}, need |z|>1.96)` };
  }
  return { decided: true, winnerVariantId: leader.variantId, reason: `winner ${leader.variantId} at z=${z.toFixed(2)}` };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run shared/experiment.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add shared/experiment.ts shared/experiment.test.ts
git commit -m "feat: experiment model + pure assignVariant/decide math"
```

---

## Task 6: New persistence (`shared/schema.ts` + `npm run db:push`)

Add five tables. JSON columns use `jsonb`. A **partial unique index** enforces one running experiment per site.

**Files:**
- Modify: `shared/schema.ts`

- [ ] **Step 1: Add the tables** (append to `shared/schema.ts`)

Add `jsonb`, `index`, `uniqueIndex`, and `bigint` to the existing `drizzle-orm/pg-core` import, then append:

```typescript
// shared/schema.ts (append; extend the pg-core import with: jsonb, bigint, index, uniqueIndex)
import type { SiteDocument } from "./site-document";
import type { SiteGoal } from "./site-goal";
import type { Variant } from "./experiment";
import type { TelemetryEventType } from "./telemetry";

export const siteDocuments = pgTable("site_documents", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id", { length: 36 }).notNull().references(() => projects.id),
  version: integer("version").notNull(),
  document: jsonb("document").$type<SiteDocument>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  projectVersionUq: uniqueIndex("site_documents_project_version_uq").on(t.projectId, t.version),
}));
export type SiteDocumentRow = typeof siteDocuments.$inferSelect;

export const siteGoals = pgTable("site_goals", {
  projectId: varchar("project_id", { length: 36 }).primaryKey().references(() => projects.id),
  goal: jsonb("goal").$type<SiteGoal>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type SiteGoalRow = typeof siteGoals.$inferSelect;

export const telemetryEvents = pgTable("telemetry_events", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id", { length: 36 }).notNull(),
  visitorId: text("visitor_id").notNull(),
  sessionId: text("session_id").notNull(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  type: text("type").$type<TelemetryEventType>().notNull(),
  sectionId: text("section_id"),
  experimentId: varchar("experiment_id", { length: 36 }),
  variantId: text("variant_id"),
  meta: jsonb("meta"),
}, (t) => ({
  bySiteTs: index("telemetry_site_ts_idx").on(t.siteId, t.ts),
  byExpVariant: index("telemetry_exp_variant_idx").on(t.experimentId, t.variantId),
}));
export type TelemetryEventRow = typeof telemetryEvents.$inferSelect;

export const experiments = pgTable("experiments", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id", { length: 36 }).notNull(),
  status: text("status").notNull(),
  targetSectionId: text("target_section_id").notNull(),
  hypothesis: text("hypothesis").notNull().default(""),
  conversionEvent: text("conversion_event").notNull(),
  variants: jsonb("variants").$type<Variant[]>().notNull(),
  createdBy: text("created_by").notNull(),
  minExposuresPerVariant: integer("min_exposures_per_variant").notNull().default(200),
  winnerVariantId: text("winner_variant_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  // one RUNNING experiment per site (partial unique index)
  oneRunningPerSite: uniqueIndex("experiments_one_running_per_site")
    .on(t.siteId)
    .where(sql`status = 'running'`),
}));
export type ExperimentRow = typeof experiments.$inferSelect;

export const decisionLog = pgTable("decision_log", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id", { length: 36 }).notNull(),
  ts: bigint("ts", { mode: "number" }).notNull(),
  kind: text("kind").notNull(),
  detail: jsonb("detail"),
}, (t) => ({
  bySite: index("decision_log_site_idx").on(t.siteId, t.ts),
}));
export type DecisionLogRow = typeof decisionLog.$inferSelect;
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: no errors (the imported `SiteDocument`/`SiteGoal`/`Variant`/`TelemetryEventType` types resolve). If `bigint`/`jsonb`/`uniqueIndex`/`index` are reported missing, add them to the `drizzle-orm/pg-core` import line.

- [ ] **Step 3: Apply to the database**

Run: `npm run db:push`
Expected: drizzle-kit reports the 5 new tables created. (Requires `DATABASE_URL`/`DATABASE_PUBLIC_URL` in env — same as `dev`.)

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: living-sites tables (documents, goals, telemetry, experiments, decision_log)"
```

---

## Task 7: Storage methods for the new tables (`server/storage.ts`)

Centralize all DB access here (matches the existing pattern). Logic modules call these.

**Files:**
- Modify: `server/storage.ts`
- Test: `server/storage.living.test.ts`

- [ ] **Step 1: Read the current storage class structure**

Run: `sed -n '1,60p;160,260p' server/storage.ts`
Confirm: the concrete class holding `this.db` and the `export const storage = createStorage()` line. Add the methods below to the `IStorage` interface and to that class (mirror into any in-memory class if one exists).

- [ ] **Step 2: Write the failing test** (integration — uses the real DB via the exported `storage`)

```typescript
// server/storage.living.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "./storage";
import type { SiteDocument } from "@shared/site-document";

const doc = (heading: string): SiteDocument => ({
  version: 1,
  meta: { name: "Acme" },
  theme: { preset: "minimal", radius: "medium" } as SiteDocument["theme"],
  sections: [{ type: "hero", heading, subheading: "x", ctaLabel: "Go", ctaHref: "#" } as any],
});

describe("storage document versioning", () => {
  let projectId: string;
  beforeAll(async () => {
    const user = await storage.createUser({ username: `u_${Date.now()}`, password: "x" } as any);
    const p = await storage.createProject({ userId: user.id, html: "", css: "" } as any);
    projectId = p.id;
  });

  it("saves incrementing versions and returns the latest", async () => {
    const v1 = await storage.saveDocumentVersion(projectId, doc("One"));
    const v2 = await storage.saveDocumentVersion(projectId, doc("Two"));
    expect(v2.version).toBe(v1.version + 1);
    const latest = await storage.getLatestDocument(projectId);
    expect((latest!.document.sections[0] as any).heading).toBe("Two");
    expect(latest!.version).toBe(v2.version);
  });

  it("restores a prior version by writing it as a new version", async () => {
    const restored = await storage.restoreDocumentVersion(projectId, 1);
    const latest = await storage.getLatestDocument(projectId);
    expect((latest!.document.sections[0] as any).heading).toBe("One");
    expect(latest!.version).toBe(restored.version);
  });
});
```

> If this repo cannot reach a test database in CI, mark this file with `describe.skipIf(!process.env.DATABASE_URL)`. The pure-logic tasks (2–5, 8, 9) are the coverage that must always run.

- [ ] **Step 3: Run it — expect FAIL**

Run: `npx vitest run server/storage.living.test.ts`
Expected: FAIL — `storage.saveDocumentVersion is not a function`.

- [ ] **Step 4: Add to `IStorage` and implement** (in the DB-backed class)

Extend the import from `@shared/schema` with the new tables (`siteDocuments`, `siteGoals`, `telemetryEvents`, `experiments`, `decisionLog`) and their row types, then add to `IStorage`:

```typescript
// server/storage.ts — add to interface IStorage
import type { SiteDocument } from "@shared/site-document";
import type { SiteGoal } from "@shared/site-goal";
import type { Experiment } from "@shared/experiment";
import type { TelemetryEvent, VariantStat } from "@shared/telemetry";

  // Living Sites — documents + versions
  saveDocumentVersion(projectId: string, document: SiteDocument): Promise<{ version: number }>;
  getLatestDocument(projectId: string): Promise<{ version: number; document: SiteDocument } | undefined>;
  listDocumentVersions(projectId: string): Promise<number[]>;
  restoreDocumentVersion(projectId: string, version: number): Promise<{ version: number }>;
  // Goals
  getGoal(projectId: string): Promise<SiteGoal | undefined>;
  setGoal(projectId: string, goal: SiteGoal): Promise<void>;
  // Telemetry
  insertTelemetry(events: TelemetryEvent[]): Promise<void>;
  // Experiments
  insertExperiment(exp: Experiment): Promise<void>;
  getExperiment(id: string): Promise<Experiment | undefined>;
  getRunningExperiment(siteId: string): Promise<Experiment | undefined>;
  updateExperiment(id: string, patch: Partial<Pick<Experiment, "status" | "winnerVariantId">>): Promise<void>;
  variantStats(experimentId: string): Promise<VariantStat[]>;
  // Decision log
  appendDecision(siteId: string, kind: string, detail: unknown): Promise<void>;
  listDecisions(siteId: string, limit?: number): Promise<Array<{ ts: number; kind: string; detail: unknown }>>;
```

Implement in the DB class (Drizzle, mirroring `getProject`'s style):

```typescript
// server/storage.ts — DB class implementations
  async saveDocumentVersion(projectId: string, document: SiteDocument) {
    const rows = await this.db.select({ v: siteDocuments.version }).from(siteDocuments)
      .where(eq(siteDocuments.projectId, projectId));
    const version = (rows.reduce((m, r) => Math.max(m, r.v), 0)) + 1;
    await this.db.insert(siteDocuments).values({ projectId, version, document });
    return { version };
  }

  async getLatestDocument(projectId: string) {
    const rows = await this.db.select().from(siteDocuments)
      .where(eq(siteDocuments.projectId, projectId)).orderBy(desc(siteDocuments.version)).limit(1);
    return rows[0] ? { version: rows[0].version, document: rows[0].document } : undefined;
  }

  async listDocumentVersions(projectId: string) {
    const rows = await this.db.select({ v: siteDocuments.version }).from(siteDocuments)
      .where(eq(siteDocuments.projectId, projectId)).orderBy(desc(siteDocuments.version));
    return rows.map((r) => r.v);
  }

  async restoreDocumentVersion(projectId: string, version: number) {
    const rows = await this.db.select().from(siteDocuments)
      .where(and(eq(siteDocuments.projectId, projectId), eq(siteDocuments.version, version))).limit(1);
    if (!rows[0]) throw new Error(`no version ${version} for project ${projectId}`);
    return this.saveDocumentVersion(projectId, rows[0].document);
  }

  async getGoal(projectId: string) {
    const rows = await this.db.select().from(siteGoals).where(eq(siteGoals.projectId, projectId)).limit(1);
    return rows[0]?.goal;
  }
  async setGoal(projectId: string, goal: SiteGoal) {
    await this.db.insert(siteGoals).values({ projectId, goal })
      .onConflictDoUpdate({ target: siteGoals.projectId, set: { goal, updatedAt: new Date() } });
  }

  async insertTelemetry(events: TelemetryEvent[]) {
    if (events.length === 0) return;
    await this.db.insert(telemetryEvents).values(events.map((e) => ({
      siteId: e.siteId, visitorId: e.visitorId, sessionId: e.sessionId, ts: e.ts, type: e.type,
      sectionId: e.sectionId, experimentId: e.experimentId, variantId: e.variantId, meta: e.meta,
    })));
  }

  async insertExperiment(exp: Experiment) {
    await this.db.insert(experiments).values({
      id: exp.id, siteId: exp.siteId, status: exp.status, targetSectionId: exp.targetSectionId,
      hypothesis: exp.hypothesis, conversionEvent: exp.conversionEvent, variants: exp.variants,
      createdBy: exp.createdBy, minExposuresPerVariant: exp.minExposuresPerVariant, winnerVariantId: exp.winnerVariantId,
    });
  }
  async getExperiment(id: string) {
    const rows = await this.db.select().from(experiments).where(eq(experiments.id, id)).limit(1);
    return rows[0] ? rowToExperiment(rows[0]) : undefined;
  }
  async getRunningExperiment(siteId: string) {
    const rows = await this.db.select().from(experiments)
      .where(and(eq(experiments.siteId, siteId), eq(experiments.status, "running"))).limit(1);
    return rows[0] ? rowToExperiment(rows[0]) : undefined;
  }
  async updateExperiment(id: string, patch: Partial<Pick<Experiment, "status" | "winnerVariantId">>) {
    await this.db.update(experiments).set(patch).where(eq(experiments.id, id));
  }

  async variantStats(experimentId: string) {
    const rows = await this.db.select().from(telemetryEvents).where(eq(telemetryEvents.experimentId, experimentId));
    const m = new Map<string, VariantStat>();
    for (const r of rows) {
      if (!r.variantId) continue;
      const s = m.get(r.variantId) ?? { variantId: r.variantId, exposures: 0, conversions: 0 };
      if (r.type === "section_view") s.exposures++;
      if (r.type === "conversion") s.conversions++;
      m.set(r.variantId, s);
    }
    return [...m.values()];
  }

  async appendDecision(siteId: string, kind: string, detail: unknown) {
    await this.db.insert(decisionLog).values({ siteId, ts: Date.now(), kind, detail });
  }
  async listDecisions(siteId: string, limit = 50) {
    const rows = await this.db.select().from(decisionLog)
      .where(eq(decisionLog.siteId, siteId)).orderBy(desc(decisionLog.ts)).limit(limit);
    return rows.map((r) => ({ ts: r.ts, kind: r.kind, detail: r.detail }));
  }
```

Add a module-level helper near the bottom of `storage.ts` (and ensure `and`, `desc` are imported from `drizzle-orm`):

```typescript
// server/storage.ts — helper
import { eq, and, desc } from "drizzle-orm";
import { experimentSchema, type Experiment } from "@shared/experiment";
import type { ExperimentRow } from "@shared/schema";

function rowToExperiment(r: ExperimentRow): Experiment {
  return experimentSchema.parse({
    id: r.id, siteId: r.siteId, status: r.status, targetSectionId: r.targetSectionId,
    hypothesis: r.hypothesis, conversionEvent: r.conversionEvent, variants: r.variants,
    createdBy: r.createdBy, minExposuresPerVariant: r.minExposuresPerVariant,
    winnerVariantId: r.winnerVariantId ?? undefined,
  });
}
```

- [ ] **Step 5: Run it — expect PASS** (or SKIP without a DB)

Run: `npx vitest run server/storage.living.test.ts`
Expected: 2 passed (or skipped if no `DATABASE_URL`).

- [ ] **Step 6: Type-check + commit**

```bash
npm run check
git add server/storage.ts server/storage.living.test.ts
git commit -m "feat: storage methods for documents, goals, telemetry, experiments, decisions"
```

---

## Task 8: Telemetry ingestion + funnel (`server/telemetry.ts`)

**Files:**
- Create: `server/telemetry.ts`
- Test: `server/telemetry.test.ts`

- [ ] **Step 1: Write the failing test** (pure aggregation — inject a fake storage)

```typescript
// server/telemetry.test.ts
import { describe, it, expect } from "vitest";
import { buildFunnel } from "./telemetry";
import type { TelemetryEvent } from "@shared/telemetry";

const ev = (p: Partial<TelemetryEvent>): TelemetryEvent => ({
  siteId: "s1", visitorId: "v", sessionId: "se", ts: 1, type: "pageview", ...p,
});

describe("buildFunnel", () => {
  it("aggregates per-section views and cta-clicks", () => {
    const events: TelemetryEvent[] = [
      ev({ type: "section_view", sectionId: "0:hero" }),
      ev({ type: "section_view", sectionId: "0:hero" }),
      ev({ type: "cta_click", sectionId: "0:hero" }),
      ev({ type: "section_view", sectionId: "1:cta" }),
    ];
    const r = buildFunnel("s1", events, []);
    const hero = r.sections.find((s) => s.key === "0:hero")!;
    expect(hero.views).toBe(2);
    expect(hero.nextStep).toBe(1);
  });

  it("aggregates per-variant exposures and conversions for the active experiment", () => {
    const events: TelemetryEvent[] = [
      ev({ type: "section_view", experimentId: "e1", variantId: "control" }),
      ev({ type: "section_view", experimentId: "e1", variantId: "control" }),
      ev({ type: "conversion", experimentId: "e1", variantId: "control" }),
      ev({ type: "section_view", experimentId: "e1", variantId: "cand" }),
      ev({ type: "conversion", experimentId: "e1", variantId: "cand" }),
    ];
    const r = buildFunnel("s1", events, ["control", "cand"]);
    const control = r.variants.find((v) => v.variantId === "control")!;
    expect(control.exposures).toBe(2);
    expect(control.conversions).toBe(1);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run server/telemetry.test.ts`
Expected: FAIL — cannot find `./telemetry`.

- [ ] **Step 3: Implement `server/telemetry.ts`**

```typescript
// server/telemetry.ts
import { storage } from "./storage";
import { telemetryBatchSchema, type TelemetryEvent, type FunnelReport, type SectionStat, type VariantStat } from "@shared/telemetry";
import type { SiteGoal } from "@shared/site-goal";
import type { SectionType } from "@shared/site-document";

/** Validate + persist a beacon batch. Throws on invalid input (route returns 400). */
export async function ingest(raw: unknown): Promise<number> {
  const events = telemetryBatchSchema.parse(raw) as TelemetryEvent[];
  await storage.insertTelemetry(events);
  return events.length;
}

/** Pure aggregation, extracted for unit testing. */
export function buildFunnel(siteId: string, events: TelemetryEvent[], variantIds: string[]): FunnelReport {
  const sections = new Map<string, SectionStat>();
  const variants = new Map<string, VariantStat>(variantIds.map((id) => [id, { variantId: id, exposures: 0, conversions: 0 }]));

  for (const e of events) {
    if (e.sectionId && (e.type === "section_view" || e.type === "cta_click")) {
      const [, type] = e.sectionId.split(":");
      const s = sections.get(e.sectionId) ?? { key: e.sectionId, type: type as SectionType, views: 0, nextStep: 0 };
      if (e.type === "section_view") s.views++;
      if (e.type === "cta_click") s.nextStep++;
      sections.set(e.sectionId, s);
    }
    if (e.variantId && variants.has(e.variantId)) {
      const v = variants.get(e.variantId)!;
      if (e.type === "section_view") v.exposures++;
      if (e.type === "conversion") v.conversions++;
    }
  }
  return { siteId, sections: [...sections.values()], variants: [...variants.values()] };
}

/** Read path the agent + decision math use. */
export async function funnel(siteId: string, _goal: SiteGoal, variantIds: string[]): Promise<FunnelReport> {
  // For Phase 1 we read recent events for the site; storage exposes them via a thin query.
  const events = await storage.recentTelemetry(siteId);
  return buildFunnel(siteId, events, variantIds);
}
```

- [ ] **Step 4: Add the `recentTelemetry` read to storage** (interface + impl, same file as Task 7)

```typescript
// server/storage.ts — interface
  recentTelemetry(siteId: string, limit?: number): Promise<TelemetryEvent[]>;
```
```typescript
// server/storage.ts — DB impl
  async recentTelemetry(siteId: string, limit = 5000): Promise<TelemetryEvent[]> {
    const rows = await this.db.select().from(telemetryEvents)
      .where(eq(telemetryEvents.siteId, siteId)).orderBy(desc(telemetryEvents.ts)).limit(limit);
    return rows.map((r) => ({
      siteId: r.siteId, visitorId: r.visitorId, sessionId: r.sessionId, ts: r.ts, type: r.type,
      sectionId: r.sectionId ?? undefined, experimentId: r.experimentId ?? undefined,
      variantId: r.variantId ?? undefined, meta: (r.meta as any) ?? undefined,
    }));
  }
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx vitest run server/telemetry.test.ts`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
npm run check
git add server/telemetry.ts server/telemetry.test.ts server/storage.ts
git commit -m "feat: telemetry ingest + pure funnel aggregation"
```

---

## Task 9: Safety governor (`server/governor.ts`)

**Files:**
- Create: `server/governor.ts`
- Test: `server/governor.test.ts`

- [ ] **Step 1: Write the failing test** (pure guard logic)

```typescript
// server/governor.test.ts
import { describe, it, expect } from "vitest";
import { assertAllowed, checkGuardrail, GovernorError } from "./governor";
import { defaultConstraints, type SiteGoal } from "@shared/site-goal";
import type { FunnelReport } from "@shared/telemetry";

const goal = (locked: string[]): SiteGoal => ({
  objective: "book_call", conversionEvent: "call_booked",
  constraints: { ...defaultConstraints(), lockedSectionIds: locked },
});

describe("assertAllowed", () => {
  it("rejects a locked section", () => {
    expect(() => assertAllowed("0:hero", goal(["0:hero"]), null)).toThrow(GovernorError);
  });
  it("rejects when an experiment is already running", () => {
    expect(() => assertAllowed("1:cta", goal([]), { id: "e1" } as any)).toThrow(/already running/i);
  });
  it("allows an unlocked section with no active experiment", () => {
    expect(() => assertAllowed("1:cta", goal([]), null)).not.toThrow();
  });
});

describe("checkGuardrail", () => {
  const report = (winnerNextStep: number): FunnelReport => ({
    siteId: "s1",
    sections: [{ key: "0:hero", type: "hero", views: 100, nextStep: winnerNextStep }],
    variants: [],
  });
  it("blocks promotion when engagement regresses beyond threshold", () => {
    // baseline 50 nextStep; winner 30 = -40% > 20% threshold → blocked
    const r = checkGuardrail("0:hero", 50, report(30));
    expect(r.ok).toBe(false);
  });
  it("allows promotion when within threshold", () => {
    const r = checkGuardrail("0:hero", 50, report(48));
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run server/governor.test.ts`
Expected: FAIL — cannot find `./governor`.

- [ ] **Step 3: Implement `server/governor.ts`**

```typescript
// server/governor.ts
import { storage } from "./storage";
import type { SiteGoal } from "@shared/site-goal";
import type { Experiment } from "@shared/experiment";
import type { FunnelReport } from "@shared/telemetry";

export class GovernorError extends Error {}

const GUARDRAIL_MAX_REGRESSION = 0.2; // 20% drop in next-step engagement blocks auto-promotion

/** Throw if the agent may not touch this section, or an experiment is already running. */
export function assertAllowed(targetSectionId: string, goal: SiteGoal, running: Experiment | null): void {
  if (goal.constraints.lockedSectionIds.includes(targetSectionId)) {
    throw new GovernorError(`section ${targetSectionId} is locked`);
  }
  if (running) {
    throw new GovernorError(`an experiment is already running for this site (${running.id})`);
  }
}

/** Guardrail: block promotion if the winner regresses engagement beyond the threshold. */
export function checkGuardrail(targetSectionId: string, baselineNextStep: number, report: FunnelReport): { ok: boolean; reason: string } {
  const sec = report.sections.find((s) => s.key === targetSectionId);
  const after = sec?.nextStep ?? 0;
  if (baselineNextStep === 0) return { ok: true, reason: "no baseline" };
  const delta = (after - baselineNextStep) / baselineNextStep;
  if (delta < -GUARDRAIL_MAX_REGRESSION) {
    return { ok: false, reason: `engagement regressed ${(delta * 100).toFixed(0)}% (threshold -${GUARDRAIL_MAX_REGRESSION * 100}%)` };
  }
  return { ok: true, reason: `engagement delta ${(delta * 100).toFixed(0)}%` };
}

/** Append-only audit entry surfaced in Mission Control. */
export async function audit(siteId: string, kind: string, detail: unknown): Promise<void> {
  await storage.appendDecision(siteId, kind, detail);
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run server/governor.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add server/governor.ts server/governor.test.ts
git commit -m "feat: safety governor (locks, one-experiment, guardrail, audit)"
```

---

## Task 10: Growth agent (`server/growth-agent.ts`)

`pickWeakestLink` is pure. `proposeVariants` takes an injected `chat` so the loop is testable with no network.

**Files:**
- Modify: `server/document-gen.ts` (export `chat`, `extractJson`)
- Create: `server/growth-agent.ts`
- Test: `server/growth-agent.test.ts`

- [ ] **Step 1: Export the Foundry helpers** (`server/document-gen.ts`)

Change `async function chat(` → `export async function chat(` and `function extractJson(` → `export function extractJson(`.

- [ ] **Step 2: Write the failing test**

```typescript
// server/growth-agent.test.ts
import { describe, it, expect } from "vitest";
import { pickWeakestLink, proposeVariants, type ChatFn } from "./growth-agent";
import { defaultConstraints, type SiteGoal } from "@shared/site-goal";
import type { FunnelReport } from "@shared/telemetry";
import type { Section } from "@shared/site-document";

const goal: SiteGoal = {
  objective: "book_call", conversionEvent: "call_booked",
  constraints: { ...defaultConstraints(), brandVoice: "warm, expert" },
};

describe("pickWeakestLink", () => {
  it("selects the section with the worst view→next-step ratio", () => {
    const report: FunnelReport = {
      siteId: "s1",
      sections: [
        { key: "0:hero", type: "hero", views: 100, nextStep: 8 },   // 8%  ← worst
        { key: "1:cta",  type: "cta",  views: 100, nextStep: 40 },  // 40%
      ],
      variants: [],
    };
    const pick = pickWeakestLink(report, goal);
    expect(pick?.targetSectionId).toBe("0:hero");
    expect(pick?.hypothesis).toMatch(/hero/i);
  });

  it("returns null when no section has enough views", () => {
    const report: FunnelReport = { siteId: "s1", sections: [{ key: "0:hero", type: "hero", views: 3, nextStep: 0 }], variants: [] };
    expect(pickWeakestLink(report, goal)).toBeNull();
  });
});

describe("proposeVariants", () => {
  const heroSection: Section = { type: "hero", heading: "We do plumbing", subheading: "x", ctaLabel: "Call", ctaHref: "#" } as any;

  it("returns only schema-valid candidates of the same type", async () => {
    const chat: ChatFn = async () => JSON.stringify({
      type: "hero", heading: "Emergency plumbing in 60 min", subheading: "Licensed & insured", ctaLabel: "Book now", ctaHref: "#book",
    });
    const out = await proposeVariants(heroSection, goal, "headline too vague", 1, { chat });
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("hero");
    expect((out[0] as any).heading).toMatch(/emergency/i);
  });

  it("drops invalid candidates (retry once, then skip)", async () => {
    let calls = 0;
    const chat: ChatFn = async () => { calls++; return "not json at all"; };
    const out = await proposeVariants(heroSection, goal, "h", 1, { chat });
    expect(out).toHaveLength(0);
    expect(calls).toBe(2); // initial + one retry
  });
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `npx vitest run server/growth-agent.test.ts`
Expected: FAIL — cannot find `./growth-agent`.

- [ ] **Step 4: Implement `server/growth-agent.ts`**

```typescript
// server/growth-agent.ts
import { storage } from "./storage";
import { chat as realChat, extractJson } from "./document-gen";
import { funnel } from "./telemetry";
import { assertAllowed, checkGuardrail, audit } from "./governor";
import { sectionSchema, patchSection, findSectionIndex, type Section, type SiteDocument } from "@shared/site-document";
import { experimentSchema, decide, type Experiment, type Variant } from "@shared/experiment";
import type { SiteGoal } from "@shared/site-goal";
import type { FunnelReport } from "@shared/telemetry";

export type ChatFn = (messages: Array<{ role: string; content: string }>, maxTokens?: number) => Promise<string>;
export interface GrowthDeps { chat?: ChatFn; randomId?: () => string; }

const MIN_VIEWS = 20;

/** Pure: the section with the worst view→next-step ratio (enough traffic to judge). */
export function pickWeakestLink(report: FunnelReport, _goal: SiteGoal): { targetSectionId: string; hypothesis: string } | null {
  const eligible = report.sections.filter((s) => s.views >= MIN_VIEWS);
  if (eligible.length === 0) return null;
  const worst = eligible.reduce((a, b) => (b.nextStep / b.views < a.nextStep / a.views ? b : a));
  const rate = ((worst.nextStep / worst.views) * 100).toFixed(0);
  return {
    targetSectionId: worst.key,
    hypothesis: `The ${worst.type} section gets ${worst.views} views but only ${rate}% click through — its copy likely under-motivates the next step.`,
  };
}

/** Ask Foundry for N scoped, same-type candidates; keep only sectionSchema-valid ones (retry once). */
export async function proposeVariants(section: Section, goal: SiteGoal, hypothesis: string, n: number, deps: GrowthDeps = {}): Promise<Section[]> {
  const chat = deps.chat ?? realChat;
  const sys = [
    `You optimize ONE website section toward the goal: ${goal.objective} (success = "${goal.conversionEvent}").`,
    goal.constraints.brandVoice ? `Brand voice: ${goal.constraints.brandVoice}.` : "",
    `Hypothesis: ${hypothesis}`,
    `Return ONLY a JSON object for a single section of type "${section.type}", same shape as the input. No markdown, no commentary, no emoji.`,
    `Do not change prices, menu items, or product names.`,
  ].filter(Boolean).join(" ");
  const user = `Current section JSON:\n${JSON.stringify(section)}`;

  const out: Section[] = [];
  for (let i = 0; i < n; i++) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await chat([{ role: "system", content: sys }, { role: "user", content: user }], 1200);
      try {
        const cand = sectionSchema.parse(extractJson(text));
        if (cand.type === section.type) { out.push(cand); break; }
      } catch { /* invalid → retry once, then skip */ }
    }
  }
  return out;
}

/** One autonomous cycle for a site: observe → propose → launch one experiment. */
export async function runGrowthCycle(projectId: string, deps: GrowthDeps = {}): Promise<{ launched: boolean; reason: string }> {
  const goal = await storage.getGoal(projectId);
  if (!goal) return { launched: false, reason: "no goal set" };

  const running = await storage.getRunningExperiment(projectId);
  if (running) return { launched: false, reason: "experiment already running" };

  const latest = await storage.getLatestDocument(projectId);
  if (!latest) return { launched: false, reason: "no document" };

  const report = await funnel(projectId, goal, []);
  const pick = pickWeakestLink(report, goal);
  if (!pick) return { launched: false, reason: "insufficient traffic" };

  try {
    assertAllowed(pick.targetSectionId, goal, null);
  } catch (e: any) {
    return { launched: false, reason: e.message };
  }

  const idx = findSectionIndex(latest.document, pick.targetSectionId);
  if (idx === -1) return { launched: false, reason: "target section vanished" };
  const candidates = await proposeVariants(latest.document.sections[idx], goal, pick.hypothesis, 1, deps);
  if (candidates.length === 0) return { launched: false, reason: "no valid candidate" };

  const newId = (deps.randomId ?? cryptoId)();
  const exp: Experiment = experimentSchema.parse({
    id: newId, siteId: projectId, status: goal.constraints.autonomy === "auto" ? "running" : "proposed",
    targetSectionId: pick.targetSectionId, hypothesis: pick.hypothesis, conversionEvent: goal.conversionEvent,
    variants: [
      { id: "control", label: "Control", patch: null },
      { id: "cand", label: "Candidate", patch: candidates[0] },
    ] satisfies Variant[],
    createdBy: "agent", minExposuresPerVariant: goal.constraints.minExposuresPerVariant,
  });
  await storage.insertExperiment(exp);
  await audit(projectId, "experiment_launched", { id: exp.id, status: exp.status, targetSectionId: exp.targetSectionId, hypothesis: exp.hypothesis });
  return { launched: true, reason: exp.status === "running" ? "running" : "awaiting owner approval" };
}

/** Evaluate the running experiment; promote the winner into a new document version if the guardrail passes. */
export async function evaluateAndMaybePromote(projectId: string): Promise<{ promoted: boolean; reason: string }> {
  const exp = await storage.getRunningExperiment(projectId);
  if (!exp) return { promoted: false, reason: "no running experiment" };

  const stats = await storage.variantStats(exp.id);
  const result = decide(exp, stats);
  if (!result.decided) return { promoted: false, reason: result.reason };

  const winner = exp.variants.find((v) => v.id === result.winnerVariantId)!;
  await storage.updateExperiment(exp.id, { status: "concluded", winnerVariantId: winner.id });

  if (!winner.patch) {
    await audit(projectId, "experiment_concluded", { id: exp.id, winner: winner.id, note: "control won — no change" });
    return { promoted: false, reason: "control won" };
  }

  const goal = (await storage.getGoal(projectId))!;
  const report = await funnel(projectId, goal, []);
  const baseline = report.sections.find((s) => s.key === exp.targetSectionId)?.nextStep ?? 0;
  const guard = checkGuardrail(exp.targetSectionId, baseline, report);
  if (!guard.ok) {
    await audit(projectId, "promotion_blocked", { id: exp.id, reason: guard.reason });
    return { promoted: false, reason: guard.reason };
  }

  const latest = await storage.getLatestDocument(projectId);
  if (!latest) return { promoted: false, reason: "no document" };
  const next: SiteDocument = patchSection(latest.document, exp.targetSectionId, winner.patch);
  const { version } = await storage.saveDocumentVersion(projectId, next);
  await audit(projectId, "winner_promoted", { id: exp.id, winner: winner.id, version, reason: result.reason });
  return { promoted: true, reason: `promoted to v${version}` };
}

function cryptoId(): string {
  return "xxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}
```

- [ ] **Step 5: Run it — expect PASS**

Run: `npx vitest run server/growth-agent.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
npm run check
git add server/document-gen.ts server/growth-agent.ts server/growth-agent.test.ts
git commit -m "feat: growth agent — weakest-link, scoped proposals, launch + promote"
```

---

## Task 11: Variant-aware serving + telemetry beacon (`server/publish.ts`)

Document-backed sites render from the stored `SiteDocument` with the assigned variant patched in, and carry a first-party `vid` cookie + telemetry beacon. Sites without a stored document fall through to the existing html/css path unchanged.

**Files:**
- Modify: `server/publish.ts`
- Create: `server/serve-document.ts` (pure assembly: doc + experiment + visitor → html)
- Test: `server/serve-document.test.ts`

- [ ] **Step 1: Write the failing test** (pure: no DB, no network)

```typescript
// server/serve-document.test.ts
import { describe, it, expect } from "vitest";
import { assembleDocumentHtml } from "./serve-document";
import type { SiteDocument } from "@shared/site-document";
import type { Experiment } from "@shared/experiment";

const doc: SiteDocument = {
  version: 1, meta: { name: "Acme" }, theme: { preset: "minimal", radius: "medium" } as any,
  sections: [{ type: "hero", heading: "Canonical", subheading: "x", ctaLabel: "Go", ctaHref: "#" } as any],
};
const exp: Experiment = {
  id: "e1", siteId: "p1", status: "running", targetSectionId: "0:hero", hypothesis: "h",
  conversionEvent: "c", createdBy: "agent", minExposuresPerVariant: 200,
  variants: [
    { id: "control", label: "Control", patch: null },
    { id: "cand", label: "Cand", patch: { type: "hero", heading: "Variant!", subheading: "y", ctaLabel: "Go", ctaHref: "#" } as any },
  ],
};

describe("assembleDocumentHtml", () => {
  it("with no experiment, renders the canonical doc + beacon", () => {
    const html = assembleDocumentHtml(doc, "p1", null, "visitor-1");
    expect(html).toContain("Canonical");
    expect(html).toContain("/api/t");          // beacon present
    expect(html).toContain('data-section-key="0:hero"'); // section instrumented
  });

  it("patches in the candidate when the visitor is assigned to it", () => {
    // find a visitor that lands on 'cand'
    let vid = "";
    for (let i = 0; i < 50; i++) { const html = assembleDocumentHtml(doc, "p1", exp, `v${i}`); if (html.includes("Variant!")) { vid = `v${i}`; break; } }
    expect(vid).not.toBe("");
    const again = assembleDocumentHtml(doc, "p1", exp, vid);
    expect(again).toContain("Variant!");       // stable for that visitor
    expect(again).toContain('"experimentId":"e1"');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run server/serve-document.test.ts`
Expected: FAIL — cannot find `./serve-document`.

- [ ] **Step 3: Implement `server/serve-document.ts`**

```typescript
// server/serve-document.ts
import { renderDocumentFull } from "./renderer";
import { assignVariant, type Experiment } from "@shared/experiment";
import { patchSection, sectionKey, type SiteDocument } from "@shared/site-document";

/** Inject data-section-key attributes are added by instrumenting the rendered body:
 *  we wrap by re-deriving keys and tagging the beacon with experiment context. */
export function assembleDocumentHtml(doc: SiteDocument, siteId: string, exp: Experiment | null, visitorId: string): string {
  let active = doc;
  let experimentId: string | undefined;
  let variantId: string | undefined;

  if (exp && exp.status === "running") {
    const variant = assignVariant(exp, visitorId);
    experimentId = exp.id;
    variantId = variant.id;
    if (variant.patch) active = patchSection(doc, exp.targetSectionId, variant.patch);
  }

  // section-key map (index → key) so the beacon can attribute section_view/cta_click
  const keys = active.sections.map((_, i) => sectionKey(active, i));
  const html = renderDocumentFull(active);
  const ctx = JSON.stringify({ siteId, experimentId, variantId, conversionEvent: exp?.conversionEvent });
  return html.replace("</body>", `${beacon(ctx, keys)}\n</body>`);
}

/** First-party telemetry beacon. No third-party trackers, no PII. */
function beacon(ctx: string, keys: string[]): string {
  return `<script>(function(){
  var CTX = ${ctx}; var KEYS = ${JSON.stringify(keys)};
  function vid(){var m=document.cookie.match(/(?:^|; )vid=([^;]+)/);if(m)return m[1];var v='v'+Math.random().toString(36).slice(2)+Date.now().toString(36);document.cookie='vid='+v+';path=/;max-age=31536000;samesite=lax';return v;}
  var V=vid(), S='s'+Math.random().toString(36).slice(2), Q=[];
  function push(type,sectionId){Q.push({siteId:CTX.siteId,visitorId:V,sessionId:S,ts:Date.now(),type:type,sectionId:sectionId,experimentId:CTX.experimentId,variantId:CTX.variantId});}
  function flush(){if(!Q.length)return;try{navigator.sendBeacon('/api/t',JSON.stringify(Q.splice(0,Q.length)));}catch(e){}}
  push('pageview');
  var secs=document.querySelectorAll('[data-section-key]');
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){push('section_view',e.target.getAttribute('data-section-key'));io.unobserve(e.target);}});},{threshold:0.4});secs.forEach(function(s){io.observe(s);});}
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a,button');if(!a)return;var sec=a.closest('[data-section-key]');push('cta_click',sec&&sec.getAttribute('data-section-key'));if(CTX.conversionEvent&&a.getAttribute('data-conversion')){push('conversion');}flush();});
  ['visibilitychange','pagehide'].forEach(function(ev){document.addEventListener(ev,flush);});
  setInterval(flush,5000);
  })();</script>`;
}
```

> **Renderer note:** `assembleDocumentHtml` relies on each section's wrapper carrying `data-section-key="<index>:<type>"`. Add that attribute in `shared/renderer.ts`'s `renderSection(section, doc)` by computing the index from `doc.sections.indexOf(section)` and emitting `data-section-key` on the section's root element. Add a renderer unit test asserting the attribute appears for each section. (This is a 1-line attribute addition per the existing section wrappers.)

- [ ] **Step 4: Add the renderer attribute + test**

```typescript
// shared/renderer.test.ts
import { describe, it, expect } from "vitest";
import { renderDocumentBody } from "@shared/renderer";
import type { SiteDocument } from "@shared/site-document";

describe("renderDocumentBody instrumentation", () => {
  it("tags each section with its data-section-key", () => {
    const doc: SiteDocument = { version: 1, meta: { name: "A" }, theme: { preset: "minimal", radius: "medium" } as any,
      sections: [{ type: "hero", heading: "H", subheading: "x", ctaLabel: "G", ctaHref: "#" } as any] };
    expect(renderDocumentBody(doc)).toContain('data-section-key="0:hero"');
  });
});
```
Then in `shared/renderer.ts`, ensure each section's root element includes `data-section-key="${doc.sections.indexOf(section)}:${section.type}"`. Run `npx vitest run shared/renderer.test.ts` → PASS.

- [ ] **Step 5: Wire document-backed serving into `server/publish.ts`**

In `serveSlug` (and `publishedSiteMiddleware`), before falling back to `renderFullHtml(project)`:

```typescript
// server/publish.ts — inside serveSlug, after loading `project`
import { storage } from "./storage";
import { assembleDocumentHtml } from "./serve-document";

  const latest = await storage.getLatestDocument(project.id);
  if (latest) {
    const exp = await storage.getRunningExperiment(project.id);
    const vid = (req.headers.cookie?.match(/(?:^|; )vid=([^;]+)/)?.[1]) ?? `v${Date.now()}${Math.random().toString(36).slice(2)}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(assembleDocumentHtml(latest.document, project.id, exp ?? null, vid));
  }
  // else fall through to existing html/css path
```

- [ ] **Step 6: Run the pure tests — expect PASS; type-check; commit**

```bash
npx vitest run server/serve-document.test.ts shared/renderer.test.ts
npm run check
git add server/serve-document.ts server/serve-document.test.ts server/publish.ts shared/renderer.ts shared/renderer.test.ts
git commit -m "feat: variant-aware document serving + first-party telemetry beacon"
```

---

## Task 12: Routes — telemetry ingest + Mission Control API (`server/growth-routes.ts`)

**Files:**
- Create: `server/growth-routes.ts`
- Modify: `server/routes.ts` (call `registerGrowthRoutes(app)`)
- Test: `server/growth-routes.test.ts`

- [ ] **Step 1: Write the failing test** (route handlers via supertest-style direct call; use `vitest` + `express` in-test)

```typescript
// server/growth-routes.test.ts
import { describe, it, expect, vi } from "vitest";
import express from "express";
import { registerGrowthRoutes } from "./growth-routes";

// minimal in-process request helper
async function call(app: express.Express, method: "get" | "post", path: string, body?: unknown) {
  const http = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: method.toUpperCase(),
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  server.close();
  return { status: res.status, text };
}

describe("POST /api/t", () => {
  it("400s an invalid batch", async () => {
    const app = express(); app.use(express.json()); registerGrowthRoutes(app);
    const r = await call(app, "post", "/api/t", []); // empty batch invalid
    expect(r.status).toBe(400);
  });
});
```

> Telemetry storage is exercised end-to-end in the integration test (Task 13). This route test asserts validation wiring only, so it needs no DB.

- [ ] **Step 2: Run it — expect FAIL**

Run: `npx vitest run server/growth-routes.test.ts`
Expected: FAIL — cannot find `./growth-routes`.

- [ ] **Step 3: Implement `server/growth-routes.ts`**

```typescript
// server/growth-routes.ts
import type { Express, Request, Response } from "express";
import { ingest } from "./telemetry";
import { storage } from "./storage";
import { siteGoalSchema } from "@shared/site-goal";

export function registerGrowthRoutes(app: Express) {
  // First-party telemetry beacon sink.
  app.post("/api/t", async (req: Request, res: Response) => {
    try {
      const n = await ingest(req.body);
      res.status(204).end();
      void n;
    } catch {
      res.status(400).json({ error: "invalid telemetry batch" });
    }
  });

  // Mission Control: read the live state for a site.
  app.get("/api/sites/:projectId/growth", async (req, res) => {
    const { projectId } = req.params;
    const [goal, exp, decisions] = await Promise.all([
      storage.getGoal(projectId),
      storage.getRunningExperiment(projectId),
      storage.listDecisions(projectId, 50),
    ]);
    const stats = exp ? await storage.variantStats(exp.id) : [];
    res.json({ goal: goal ?? null, experiment: exp ?? null, stats, decisions });
  });

  // Set / update the goal.
  app.put("/api/sites/:projectId/goal", async (req, res) => {
    const parsed = siteGoalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    await storage.setGoal(req.params.projectId, parsed.data);
    res.json({ ok: true });
  });

  // Approve a proposed experiment → running. Reject → rejected.
  app.post("/api/sites/:projectId/experiments/:id/:action", async (req, res) => {
    const { id, action } = req.params;
    const exp = await storage.getExperiment(id);
    if (!exp) return res.status(404).json({ error: "not found" });
    if (action === "approve") await storage.updateExperiment(id, { status: "running" });
    else if (action === "reject") await storage.updateExperiment(id, { status: "rejected" });
    else return res.status(400).json({ error: "unknown action" });
    res.json({ ok: true });
  });

  // Rollback to a prior document version.
  app.post("/api/sites/:projectId/rollback/:version", async (req, res) => {
    const v = Number(req.params.version);
    if (!Number.isInteger(v)) return res.status(400).json({ error: "bad version" });
    const { version } = await storage.restoreDocumentVersion(req.params.projectId, v);
    await storage.appendDecision(req.params.projectId, "owner_rollback", { toVersion: v, newVersion: version });
    res.json({ ok: true, version });
  });
}
```

- [ ] **Step 4: Register it** in `server/routes.ts` — inside `registerRoutes`, add:

```typescript
// server/routes.ts (inside registerRoutes, before `return httpServer;`)
import { registerGrowthRoutes } from "./growth-routes";
// ...
  registerGrowthRoutes(app);
```

- [ ] **Step 5: Run it — expect PASS; type-check; commit**

```bash
npx vitest run server/growth-routes.test.ts
npm run check
git add server/growth-routes.ts server/routes.ts server/growth-routes.test.ts
git commit -m "feat: telemetry sink + Mission Control API (goal, approve, rollback)"
```

---

## Task 13: End-to-end loop integration test (mock Foundry, deterministic)

Proves the spec's core promise without network: telemetry → propose → run → conversions → decide → promote → new version + audit.

**Files:**
- Test: `server/loop.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// server/loop.integration.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { storage } from "./storage";
import { runGrowthCycle, evaluateAndMaybePromote, type ChatFn } from "./growth-agent";
import { assignVariant } from "@shared/experiment";
import { siteGoalSchema } from "@shared/site-goal";
import type { SiteDocument } from "@shared/site-document";
import type { TelemetryEvent } from "@shared/telemetry";

const hasDb = !!(process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL);

const doc: SiteDocument = {
  version: 1, meta: { name: "Acme Plumbing" }, theme: { preset: "minimal", radius: "medium" } as any,
  sections: [{ type: "hero", heading: "We do plumbing", subheading: "x", ctaLabel: "Call", ctaHref: "#" } as any],
};

const mockChat: ChatFn = async () => JSON.stringify({
  type: "hero", heading: "Emergency plumber, 60-minute arrival", subheading: "Licensed & insured", ctaLabel: "Book now", ctaHref: "#book",
});

describe.skipIf(!hasDb)("living sites — full loop", () => {
  let projectId: string;

  beforeAll(async () => {
    const user = await storage.createUser({ username: `loop_${Date.now()}`, password: "x" } as any);
    const p = await storage.createProject({ userId: user.id, html: "", css: "" } as any);
    projectId = p.id;
    await storage.saveDocumentVersion(projectId, doc);
    await storage.setGoal(projectId, siteGoalSchema.parse({
      objective: "book_call", conversionEvent: "call_booked",
      constraints: { lockedSectionIds: [], autonomy: "auto", minExposuresPerVariant: 50 },
    }));
    // seed weak engagement so pickWeakestLink fires on the hero
    const seed: TelemetryEvent[] = [];
    for (let i = 0; i < 40; i++) seed.push({ siteId: projectId, visitorId: `seed${i}`, sessionId: "s", ts: Date.now(), type: "section_view", sectionId: "0:hero" });
    await storage.insertTelemetry(seed);
  });

  it("launches an experiment, measures, decides a winner, and promotes a new version", async () => {
    const launch = await runGrowthCycle(projectId, { chat: mockChat, randomId: () => "exp-loop-1" });
    expect(launch.launched).toBe(true);

    const exp = await storage.getRunningExperiment(projectId);
    expect(exp).toBeTruthy();

    // Simulate traffic: candidate converts at 30%, control at 8%, 60 exposures each (> gate of 50).
    const events: TelemetryEvent[] = [];
    for (let i = 0; i < 200; i++) {
      const v = assignVariant(exp!, `real${i}`);
      events.push({ siteId: projectId, visitorId: `real${i}`, sessionId: "s", ts: Date.now(), type: "section_view", sectionId: "0:hero", experimentId: exp!.id, variantId: v.id });
      const convert = v.id === "cand" ? i % 10 < 3 : i % 25 < 2; // 30% vs 8%
      if (convert) events.push({ siteId: projectId, visitorId: `real${i}`, sessionId: "s", ts: Date.now(), type: "conversion", sectionId: "0:hero", experimentId: exp!.id, variantId: v.id });
    }
    await storage.insertTelemetry(events);

    const result = await evaluateAndMaybePromote(projectId);
    expect(result.promoted).toBe(true);

    const latest = await storage.getLatestDocument(projectId);
    expect((latest!.document.sections[0] as any).heading).toMatch(/emergency/i);
    expect(latest!.version).toBeGreaterThan(1);

    const decisions = await storage.listDecisions(projectId, 10);
    expect(decisions.some((d) => d.kind === "winner_promoted")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run server/loop.integration.test.ts`
Expected: PASS with a DB; SKIPPED without one. If it fails on the gate, confirm the seeded exposures exceed `minExposuresPerVariant` for **both** arms.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: all pure-logic tests pass; DB tests pass or skip.

- [ ] **Step 4: Commit**

```bash
git add server/loop.integration.test.ts
git commit -m "test: end-to-end living-sites loop (mock Foundry, deterministic)"
```

---

## Task 14: Mission Control page (`client/src/pages/growth.tsx`)

Read-mostly supervisor view. Matches the existing client routing/fetch conventions (inspect a sibling page in `client/src/pages/` first and mirror its data-fetching + routing registration).

**Files:**
- Create: `client/src/pages/growth.tsx`
- Modify: the client router (wherever pages are registered — mirror an existing page entry)

- [ ] **Step 1: Inspect conventions**

Run: `ls client/src/pages && sed -n '1,40p' client/src/pages/projects.tsx`
Mirror its imports (router, query/fetch helper, component style).

- [ ] **Step 2: Implement `client/src/pages/growth.tsx`**

```tsx
// client/src/pages/growth.tsx
import { useEffect, useState } from "react";

interface GrowthState {
  goal: any | null;
  experiment: any | null;
  stats: Array<{ variantId: string; exposures: number; conversions: number }>;
  decisions: Array<{ ts: number; kind: string; detail: any }>;
}

export default function GrowthPage({ projectId }: { projectId: string }) {
  const [state, setState] = useState<GrowthState | null>(null);
  const [err, setErr] = useState<string>("");

  async function load() {
    try {
      const r = await fetch(`/api/sites/${projectId}/growth`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState(await r.json());
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [projectId]);

  async function act(path: string, method = "POST") {
    await fetch(`/api/sites/${projectId}${path}`, { method });
    load();
  }

  if (err) return <div className="growth-error">Couldn’t load growth: {err}</div>;
  if (!state) return <div>Loading…</div>;

  const rate = (s: { conversions: number; exposures: number }) => (s.exposures ? ((s.conversions / s.exposures) * 100).toFixed(1) : "0.0");

  return (
    <main className="growth">
      <h1>Mission Control</h1>

      <section>
        <h2>Goal</h2>
        {state.goal
          ? <p>{state.goal.objective} → <strong>{state.goal.conversionEvent}</strong> · autonomy: {state.goal.constraints.autonomy}</p>
          : <p>No goal set yet.</p>}
      </section>

      <section>
        <h2>Active experiment</h2>
        {state.experiment ? (
          <div>
            <p><em>{state.experiment.hypothesis}</em></p>
            <table>
              <thead><tr><th>Variant</th><th>Exposures</th><th>Conversions</th><th>Rate</th></tr></thead>
              <tbody>
                {state.stats.map((s) => (
                  <tr key={s.variantId}><td>{s.variantId}</td><td>{s.exposures}</td><td>{s.conversions}</td><td>{rate(s)}%</td></tr>
                ))}
              </tbody>
            </table>
            {state.experiment.status === "proposed" && (
              <div className="controls">
                <button onClick={() => act(`/experiments/${state.experiment.id}/approve`)}>Approve</button>
                <button onClick={() => act(`/experiments/${state.experiment.id}/reject`)}>Reject</button>
              </div>
            )}
          </div>
        ) : <p>No experiment running. The agent will propose one when there’s enough traffic.</p>}
      </section>

      <section>
        <h2>Decision feed</h2>
        <ul>
          {state.decisions.map((d, i) => (
            <li key={i}>{new Date(d.ts).toLocaleString()} — <strong>{d.kind}</strong> {d.detail?.reason ? `· ${d.detail.reason}` : ""}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Register the route** mirroring an existing page entry in the client router (e.g. add `growth` alongside `projects`).

- [ ] **Step 4: Type-check + build the client**

```bash
npm run check
```
Expected: no type errors. (No unit test for the page in Phase 1 — it’s a thin read view; the API it depends on is covered by Task 12/13.)

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/growth.tsx
git commit -m "feat: Mission Control page (goal, live experiment, decision feed, controls)"
```

---

## Task 15: Scheduled cycle wiring (guarded interval)

The agent must run periodically. Phase 1 uses a guarded `setInterval` in the server bootstrap (cron is Phase 2 per the spec).

**Files:**
- Create: `server/growth-scheduler.ts`
- Modify: `server/index.ts` (start it after routes are registered, behind an env flag)

- [ ] **Step 1: Implement `server/growth-scheduler.ts`**

```typescript
// server/growth-scheduler.ts
import { storage } from "./storage";
import { runGrowthCycle, evaluateAndMaybePromote } from "./growth-agent";

const INTERVAL_MS = Number(process.env.GROWTH_INTERVAL_MS ?? 15 * 60 * 1000);

/** Run one tick across all sites that have a goal. Safe to call repeatedly; one experiment/site is enforced by the governor + DB index. */
export async function growthTick(): Promise<void> {
  const projectIds = await storage.projectsWithGoals();
  for (const pid of projectIds) {
    try {
      await evaluateAndMaybePromote(pid); // conclude/promote first
      await runGrowthCycle(pid);          // then maybe launch the next
    } catch (e) {
      console.error(`[growth] tick failed for ${pid}:`, (e as Error).message);
    }
  }
}

export function startGrowthScheduler(): void {
  if (process.env.GROWTH_AGENT_ENABLED !== "1") return;
  console.log(`[growth] scheduler enabled, every ${INTERVAL_MS}ms`);
  setInterval(() => { void growthTick(); }, INTERVAL_MS);
}
```

- [ ] **Step 2: Add `projectsWithGoals` to storage** (interface + impl)

```typescript
// server/storage.ts — interface
  projectsWithGoals(): Promise<string[]>;
```
```typescript
// server/storage.ts — DB impl
  async projectsWithGoals(): Promise<string[]> {
    const rows = await this.db.select({ id: siteGoals.projectId }).from(siteGoals);
    return rows.map((r) => r.id);
  }
```

- [ ] **Step 3: Start it in `server/index.ts`** (after `await registerRoutes(...)`)

```typescript
// server/index.ts
import { startGrowthScheduler } from "./growth-scheduler";
// ... after registerRoutes:
startGrowthScheduler();
```

- [ ] **Step 4: Type-check + commit**

```bash
npm run check
git add server/growth-scheduler.ts server/index.ts server/storage.ts
git commit -m "feat: guarded growth scheduler (env-gated interval tick)"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §3.1 SiteGoal → Task 3. §3.2 telemetry types → Task 4. §3.3 ingest/funnel → Task 8. §3.4 experiment model + assignVariant/decide → Task 5. §3.5 experiments lifecycle → Tasks 7 (storage) + 10 (runGrowthCycle uses create/running) + 12 (approve/reject). §3.6 growth agent → Task 10. §3.7 governor → Task 9. §3.8 serving → Task 11. §3.9 Mission Control → Task 14. §5 persistence → Task 6. §7 testing strategy → Tasks 2–13 (pure unit, governor, integration, renderer, serving). 
- **Gap surfaced + filled:** spec assumed document versioning existed in storage; it did not → Tasks 6/7 add `site_documents` + version methods, and §3.8 serving was re-rooted on the stored document (Task 11). Spec assumed section ids; none exist → Task 2 section keys.
- **Scheduling:** spec §3.6 says "guarded interval task; cron in Phase 2" → Task 15.

**Placeholder scan:** every code step contains complete code; no TBD/TODO. The two narrative notes (renderer `data-section-key` attribute in Task 11; mirroring client router conventions in Task 14) point at exact, single-line changes and are backed by their own test/inspection step.

**Type consistency:** `targetSectionId` is a section key string everywhere (Tasks 2,5,9,10,11). `assignVariant`/`decide` signatures match between Task 5 (definition) and Tasks 10/11/13 (use). `VariantStat`/`SectionStat`/`FunnelReport` defined once in Task 4 and consumed unchanged in Tasks 8,9,10. `ChatFn`/`GrowthDeps` defined in Task 10 and used in Task 13. `storage` method names are identical between definition (Tasks 7,8,12,15) and call sites.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-02-living-sites.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best here because tasks are well-isolated and the pure-logic tasks (2–5, 8–10) verify without a DB.

**2. Inline Execution** — execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
