# Living Sites — Plan 1: Foundation (Document Persistence, Goal, Telemetry) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every site a persisted structured `SiteDocument`, a declared goal+constraints, and first-party telemetry with aggregation — the substrate the experiment engine and growth agent build on.

**Architecture:** Extend the existing Drizzle/Postgres `IStorage` seam (with `MemStorage` fallback) and the Express routes in `server/routes.ts`. No new frameworks. All logic is schema-validated; pure functions are isolated for test-first development.

**Tech Stack:** TypeScript (ESM, `tsx`), Express, Drizzle ORM (`postgres-js`), Zod, Vite. New: **vitest** as the test runner.

> **Plan decomposition (this is 1 of 4):** The Living Sites spec (`docs/superpowers/specs/2026-06-02-living-sites-design.md`) is built as a sequence, each plan shipping working, testable software:
> - **Plan 1 (this): Foundation** — vitest, persist `SiteDocument`, `SiteGoal` model, telemetry ingest + aggregation.
> - **Plan 2: Experiment engine + variant-aware serving** — `shared/experiment.ts` (pure `assignVariant`/`decide`), `experiments` table + lifecycle, serving patches the assigned variant before render.
> - **Plan 3: Growth agent + governor** — weakest-link heuristic, Foundry scoped proposals, governor locks/budgets/guardrails, promote-winner.
> - **Plan 4: Mission Control UI** — owner supervision dashboard.
>
> **Spec deviation locked here:** sections in `shared/site-document.ts` have **no stable IDs** (`sections` is a positional array). To avoid migrating the core document/renderer/generator, Phase 1 addresses sections by **array index** (`targetSectionIndex: number`, `lockedSectionIndexes: number[]`) instead of the spec's `*SectionId`. Phase 2 may add stable ids.

---

## File Structure

**Create:**
- `vitest.config.ts` — test runner config with `@shared`/`@` path aliases.
- `shared/site-goal.ts` — `SiteGoal` Zod schema (objective, conversionEvent, constraints).
- `shared/telemetry.ts` — `TelemetryEvent` + batch Zod schemas, `TelemetryEventType`.
- `server/telemetry.ts` — `ingest(events)` + `funnel(siteId, conversionEvent)` aggregation.
- `shared/site-goal.test.ts`, `shared/telemetry.test.ts`, `server/telemetry.test.ts`.

**Modify:**
- `shared/schema.ts` — add `document` jsonb column to `projects`; add `siteGoals` + `telemetryEvents` tables.
- `server/storage.ts` — extend `IStorage` + `MemStorage` (and the Postgres storage class) with goal + telemetry + document methods.
- `server/routes.ts` — persist the `SiteDocument` on generate; add `POST /api/t` (telemetry beacon), `GET/PUT /api/projects/:id/goal`.
- `package.json` — add `test` script + vitest devDependency.

---

## Task 0: Test runner (vitest)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install vitest**

Run: `cd ~/Projects/ai-web-builder && npm i -D vitest`
Expected: vitest added to devDependencies, no errors.

- [ ] **Step 2: Create `vitest.config.ts`** (mirror the `@shared`/`@` aliases the code imports use)

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node", include: ["**/*.test.ts"], exclude: ["node_modules/**", "dist/**"] },
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@": fileURLToPath(new URL("./client/src", import.meta.url)),
    },
  },
});
```

- [ ] **Step 3: Add the test script to `package.json`**

In the `"scripts"` block add: `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 4: Smoke test** — create `shared/_smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => { it("runs", () => { expect(1 + 1).toBe(2); }); });
```

- [ ] **Step 5: Run it**

Run: `npx vitest run shared/_smoke.test.ts`
Expected: PASS (1 test). Then delete the smoke file: `rm shared/_smoke.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "test: add vitest runner with @shared/@ aliases"
```

---

## Task 1: Persist the SiteDocument

The renderer (`shared/renderer.ts`: `renderDocumentFull(doc)`) needs the structured `SiteDocument`, but `projects` only stores `html`/`css`. Add a nullable `document` jsonb column and save it wherever a document is produced.

**Files:**
- Modify: `shared/schema.ts` (add column), `server/storage.ts` (MemStorage already spreads Partial; ensure type), `server/routes.ts` (save document on generate)
- Test: `server/document-persistence.test.ts`

- [ ] **Step 1: Write the failing test** (`server/document-persistence.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { MemStorage } from "./storage";
import type { SiteDocument } from "@shared/site-document";

const doc: SiteDocument = {
  version: 1,
  meta: { name: "Joe's Cafe" },
  theme: { preset: "warm-editorial", radius: "medium" },
  sections: [{ type: "hero", headline: "Fresh coffee daily" }],
};

describe("project document persistence", () => {
  it("stores and returns the SiteDocument on a project", async () => {
    const s = new MemStorage();
    const p = await s.createProject({ userId: null, name: "x", html: "<h1>x</h1>", css: "", prompt: "cafe" } as any);
    await s.updateProject(p.id, { document: doc } as any);
    const got = await s.getProject(p.id);
    expect((got as any).document).toEqual(doc);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/document-persistence.test.ts`
Expected: FAIL — `document` is not a known property / is undefined on the returned project.

- [ ] **Step 3: Add the column** in `shared/schema.ts`

Add the `jsonb` import: change the pg-core import line to include `jsonb`:
```ts
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
```
Inside `projects` (after `publishedUrl`), add:
```ts
  // Structured SiteDocument (the source of truth the renderer + growth loop use).
  // Nullable for legacy projects created before this column existed.
  document: jsonb("document").$type<import("./site-document").SiteDocument>(),
```

- [ ] **Step 4: Ensure `MemStorage.createProject` initializes `document: null`**

In `server/storage.ts`, in `MemStorage.createProject`, add `document: null` to the constructed `Project` object (so the type matches `typeof projects.$inferSelect`). `updateProject` already merges `Partial<Project>`, so no other change is needed there.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/document-persistence.test.ts`
Expected: PASS.

- [ ] **Step 6: Persist the document on generate** in `server/routes.ts`

In the `POST /api/generate/document` handler (≈ line 51), after the `SiteDocument` is produced and (if a project is being saved) when `createProject`/`updateProject` is called, include `document: <theDoc>` in the saved fields. For the inline `POST /api/generate` (line 149, which saves `html`/`css`), if it has the structured doc in scope, also pass `document`. Where only html/css exist (legacy path), leave `document` unset.

- [ ] **Step 7: Push the schema + commit**

```bash
npm run db:push   # applies the new column to Postgres (no-op for MemStorage dev)
git add shared/schema.ts server/storage.ts server/routes.ts server/document-persistence.test.ts
git commit -m "feat: persist structured SiteDocument on projects"
```

---

## Task 2: SiteGoal model + storage

**Files:**
- Create: `shared/site-goal.ts`, `shared/site-goal.test.ts`
- Modify: `shared/schema.ts` (siteGoals table), `server/storage.ts` (goal methods), `server/routes.ts` (goal endpoints)

- [ ] **Step 1: Write the failing test** (`shared/site-goal.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { siteGoalSchema } from "./site-goal";

describe("siteGoalSchema", () => {
  it("applies safe defaults for constraints", () => {
    const g = siteGoalSchema.parse({ objective: "sell_product", conversionEvent: "purchase" });
    expect(g.constraints.autonomy).toBe("suggest");      // approve-before-apply default
    expect(g.constraints.lockedCopy).toBe(false);
    expect(g.constraints.lockedSectionIndexes).toEqual([]);
    expect(g.constraints.minExposuresPerVariant).toBe(200);
  });
  it("rejects an unknown objective", () => {
    expect(() => siteGoalSchema.parse({ objective: "world_peace", conversionEvent: "x" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run shared/site-goal.test.ts`
Expected: FAIL — cannot find module `./site-goal`.

- [ ] **Step 3: Create `shared/site-goal.ts`**

```ts
import { z } from "zod";

export const OBJECTIVES = ["sell_product", "book_call", "capture_lead", "newsletter_signup", "custom"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const AUTONOMY = ["suggest", "auto"] as const;       // suggest = approve-before-apply
export type Autonomy = (typeof AUTONOMY)[number];

export const siteGoalSchema = z.object({
  objective: z.enum(OBJECTIVES),
  conversionEvent: z.string().min(1),                       // telemetry event name that counts as success
  description: z.string().optional(),
  constraints: z
    .object({
      lockedSectionIndexes: z.array(z.number().int().nonnegative()).default([]),
      lockedCopy: z.boolean().default(false),               // never alter prices / menu / product copy
      brandVoice: z.string().optional(),                    // injected into agent prompt (Plan 3)
      autonomy: z.enum(AUTONOMY).default("suggest"),
      minExposuresPerVariant: z.number().int().positive().default(200),
    })
    .default({}),
});
export type SiteGoal = z.infer<typeof siteGoalSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run shared/site-goal.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the `siteGoals` table** in `shared/schema.ts`

```ts
export const siteGoals = pgTable("site_goals", {
  projectId: varchar("project_id", { length: 36 }).primaryKey().references(() => projects.id),
  goal: jsonb("goal").$type<import("./site-goal").SiteGoal>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
export type SiteGoalRow = typeof siteGoals.$inferSelect;
```

- [ ] **Step 6: Write the failing storage test** (append to `shared/site-goal.test.ts` is wrong layer — create `server/goal-storage.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { MemStorage } from "./storage";
import { siteGoalSchema } from "@shared/site-goal";

describe("goal storage", () => {
  it("sets and gets a site goal", async () => {
    const s = new MemStorage();
    const goal = siteGoalSchema.parse({ objective: "book_call", conversionEvent: "call_booked" });
    await s.setSiteGoal("proj-1", goal);
    expect(await s.getSiteGoal("proj-1")).toEqual(goal);
  });
  it("returns undefined when no goal set", async () => {
    const s = new MemStorage();
    expect(await s.getSiteGoal("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run server/goal-storage.test.ts`
Expected: FAIL — `setSiteGoal` is not a function.

- [ ] **Step 8: Extend `IStorage` + `MemStorage`** in `server/storage.ts`

Add to the `IStorage` interface:
```ts
  getSiteGoal(projectId: string): Promise<import("@shared/site-goal").SiteGoal | undefined>;
  setSiteGoal(projectId: string, goal: import("@shared/site-goal").SiteGoal): Promise<void>;
```
In `MemStorage`, add a field `private goals = new Map<string, any>();` and:
```ts
  async getSiteGoal(projectId: string) { return this.goals.get(projectId); }
  async setSiteGoal(projectId: string, goal: any) { this.goals.set(projectId, goal); }
```
In the **Postgres storage class** (the non-Mem impl in this file), mirror these using Drizzle:
```ts
  async getSiteGoal(projectId: string) {
    const [row] = await this.db.select().from(siteGoals).where(eq(siteGoals.projectId, projectId));
    return row?.goal;
  }
  async setSiteGoal(projectId: string, goal: any) {
    await this.db.insert(siteGoals).values({ projectId, goal })
      .onConflictDoUpdate({ target: siteGoals.projectId, set: { goal, updatedAt: new Date() } });
  }
```
(Import `siteGoals` from `@shared/schema` at the top of `server/storage.ts`.)

- [ ] **Step 9: Run to verify it passes**

Run: `npx vitest run server/goal-storage.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 10: Add goal endpoints** in `server/routes.ts`

```ts
app.get("/api/projects/:id/goal", async (req, res) => {
  const goal = await storage.getSiteGoal(req.params.id);
  if (!goal) return res.status(404).json({ error: "no goal set" });
  res.json(goal);
});
app.put("/api/projects/:id/goal", async (req, res) => {
  const parsed = siteGoalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  await storage.setSiteGoal(req.params.id, parsed.data);
  res.json(parsed.data);
});
```
(Import `siteGoalSchema` from `@shared/site-goal` at top of `server/routes.ts`.)

- [ ] **Step 11: Push schema + commit**

```bash
npm run db:push
git add shared/site-goal.ts shared/site-goal.test.ts shared/schema.ts server/storage.ts server/goal-storage.test.ts server/routes.ts
git commit -m "feat: SiteGoal model, storage, and endpoints"
```

---

## Task 3: Telemetry model + ingestion

**Files:**
- Create: `shared/telemetry.ts`, `shared/telemetry.test.ts`
- Modify: `shared/schema.ts` (telemetryEvents table), `server/storage.ts` (insert/query), `server/routes.ts` (`POST /api/t`)

- [ ] **Step 1: Write the failing test** (`shared/telemetry.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { telemetryBatchSchema } from "./telemetry";

const base = { siteId: "s1", visitorId: "v1", sessionId: "sess1", ts: 1717000000000 };

describe("telemetryBatchSchema", () => {
  it("accepts a valid batch of events", () => {
    const b = telemetryBatchSchema.parse({ events: [
      { ...base, type: "pageview" },
      { ...base, type: "section_view", sectionIndex: 0 },
      { ...base, type: "cta_click", sectionIndex: 0, experimentId: "e1", variantId: "var-a" },
      { ...base, type: "conversion", meta: { value: 499 } },
    ]});
    expect(b.events).toHaveLength(4);
  });
  it("rejects an unknown event type", () => {
    expect(() => telemetryBatchSchema.parse({ events: [{ ...base, type: "rage_quit" }] })).toThrow();
  });
  it("caps batch size to prevent abuse", () => {
    const many = Array.from({ length: 101 }, () => ({ ...base, type: "pageview" as const }));
    expect(() => telemetryBatchSchema.parse({ events: many })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run shared/telemetry.test.ts`
Expected: FAIL — cannot find module `./telemetry`.

- [ ] **Step 3: Create `shared/telemetry.ts`**

```ts
import { z } from "zod";

export const TELEMETRY_EVENT_TYPES = ["pageview", "section_view", "cta_click", "scroll_depth", "conversion"] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

export const telemetryEventSchema = z.object({
  siteId: z.string().min(1),
  visitorId: z.string().min(1),
  sessionId: z.string().min(1),
  ts: z.number().int().positive(),
  type: z.enum(TELEMETRY_EVENT_TYPES),
  sectionIndex: z.number().int().nonnegative().optional(),
  experimentId: z.string().optional(),
  variantId: z.string().optional(),
  meta: z.record(z.union([z.string(), z.number()])).optional(),
});
export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

// Beacon batch — bounded so a single POST can't flood the table.
export const telemetryBatchSchema = z.object({
  events: z.array(telemetryEventSchema).min(1).max(100),
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run shared/telemetry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the `telemetryEvents` table** in `shared/schema.ts`

```ts
import { sql } from "drizzle-orm";
// (index helper) add to pg-core import: index
export const telemetryEvents = pgTable("telemetry_events", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id", { length: 36 }).notNull(),
  visitorId: text("visitor_id").notNull(),
  sessionId: text("session_id").notNull(),
  ts: timestamp("ts").notNull(),
  type: text("type").notNull(),
  sectionIndex: integer("section_index"),
  experimentId: varchar("experiment_id", { length: 36 }),
  variantId: text("variant_id"),
  meta: jsonb("meta"),
}, (t) => ({
  bySiteTs: index("telemetry_site_ts_idx").on(t.siteId, t.ts),
  byExpVar: index("telemetry_exp_var_idx").on(t.experimentId, t.variantId),
}));
export type TelemetryRow = typeof telemetryEvents.$inferSelect;
```
(Add `index` to the `drizzle-orm/pg-core` import.)

- [ ] **Step 6: Write the failing ingestion test** (`server/telemetry.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { MemStorage } from "./storage";
import { ingest } from "./telemetry";

const base = { siteId: "s1", visitorId: "v1", sessionId: "x", ts: Date.now() };

describe("telemetry ingest", () => {
  it("persists a validated batch and rejects malformed events", async () => {
    const s = new MemStorage();
    const ok = await ingest(s, { events: [{ ...base, type: "pageview" }] });
    expect(ok.inserted).toBe(1);
    await expect(ingest(s, { events: [{ ...base, type: "bogus" }] } as any)).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run to verify it fails**

Run: `npx vitest run server/telemetry.test.ts`
Expected: FAIL — cannot find module `./telemetry` (server) / `ingest` undefined.

- [ ] **Step 8: Extend storage** in `server/storage.ts`

Add to `IStorage`:
```ts
  insertTelemetry(rows: import("@shared/telemetry").TelemetryEvent[]): Promise<void>;
  queryTelemetry(siteId: string, sinceTs: number): Promise<import("@shared/telemetry").TelemetryEvent[]>;
```
`MemStorage`: add `private events: any[] = [];` and:
```ts
  async insertTelemetry(rows: any[]) { this.events.push(...rows); }
  async queryTelemetry(siteId: string, sinceTs: number) {
    return this.events.filter((e) => e.siteId === siteId && e.ts >= sinceTs);
  }
```
Postgres class: mirror with Drizzle insert (`map ts:number -> new Date(ts)`) and a `select().where(and(eq(siteId), gte(ts, new Date(sinceTs))))` returning rows mapped back to `{ ...row, ts: row.ts.getTime() }`. Import `telemetryEvents`, `and`, `gte` accordingly.

- [ ] **Step 9: Create `server/telemetry.ts`**

```ts
import type { IStorage } from "./storage";
import { telemetryBatchSchema, type TelemetryEvent } from "@shared/telemetry";

export async function ingest(storage: IStorage, body: unknown): Promise<{ inserted: number }> {
  const { events } = telemetryBatchSchema.parse(body);   // throws on malformed input
  await storage.insertTelemetry(events);
  return { inserted: events.length };
}

// Per-section engagement + conversion totals for one site over a window.
// (Plan 2 extends this with per-variant rollups.)
export interface FunnelStats {
  sections: { index: number; views: number; ctaClicks: number }[];
  totals: { pageviews: number; conversions: number };
}

export async function funnel(storage: IStorage, siteId: string, sinceTs = 0): Promise<FunnelStats> {
  const events = await storage.queryTelemetry(siteId, sinceTs);
  const sec = new Map<number, { views: number; ctaClicks: number }>();
  let pageviews = 0, conversions = 0;
  for (const e of events) {
    if (e.type === "pageview") pageviews++;
    else if (e.type === "conversion") conversions++;
    else if (e.sectionIndex != null) {
      const s = sec.get(e.sectionIndex) ?? { views: 0, ctaClicks: 0 };
      if (e.type === "section_view") s.views++;
      if (e.type === "cta_click") s.ctaClicks++;
      sec.set(e.sectionIndex, s);
    }
  }
  return {
    sections: [...sec.entries()].sort((a, b) => a[0] - b[0]).map(([index, v]) => ({ index, ...v })),
    totals: { pageviews, conversions },
  };
}
```

- [ ] **Step 10: Run to verify it passes**

Run: `npx vitest run server/telemetry.test.ts`
Expected: PASS.

- [ ] **Step 11: Write the failing funnel test** (append to `server/telemetry.test.ts`)

```ts
import { funnel } from "./telemetry";
describe("telemetry funnel", () => {
  it("aggregates section views, cta clicks, and conversions", async () => {
    const s = new MemStorage();
    await ingest(s, { events: [
      { ...base, type: "pageview" },
      { ...base, type: "section_view", sectionIndex: 0 },
      { ...base, type: "section_view", sectionIndex: 0 },
      { ...base, type: "cta_click", sectionIndex: 0 },
      { ...base, type: "conversion" },
    ]});
    const f = await funnel(s, "s1", 0);
    expect(f.totals).toEqual({ pageviews: 1, conversions: 1 });
    expect(f.sections[0]).toEqual({ index: 0, views: 2, ctaClicks: 1 });
  });
});
```

- [ ] **Step 12: Run to verify it passes**

Run: `npx vitest run server/telemetry.test.ts`
Expected: PASS (both describe blocks).

- [ ] **Step 13: Add the beacon endpoint** in `server/routes.ts`

```ts
import { ingest } from "./telemetry";
app.post("/api/t", async (req, res) => {
  try { res.json(await ingest(storage, req.body)); }
  catch { res.status(400).json({ error: "invalid telemetry" }); }   // never 500 on bad beacon data
});
```

- [ ] **Step 14: Push schema + commit**

```bash
npm run db:push
git add shared/telemetry.ts shared/telemetry.test.ts shared/schema.ts server/storage.ts server/telemetry.ts server/telemetry.test.ts server/routes.ts
git commit -m "feat: first-party telemetry ingest + funnel aggregation"
```

---

## Task 4: Telemetry beacon (client emitter)

The published renderer must emit events. Add a tiny inline script the renderer injects.

**Files:**
- Create: `shared/telemetry-beacon.ts` (returns the inline `<script>` string), `shared/telemetry-beacon.test.ts`
- Modify: `shared/renderer.ts` (`renderDocumentFull` injects the beacon)

- [ ] **Step 1: Write the failing test** (`shared/telemetry-beacon.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { beaconScript } from "./telemetry-beacon";

describe("beaconScript", () => {
  it("embeds siteId + endpoint and uses sendBeacon", () => {
    const s = beaconScript({ siteId: "abc", experimentId: "e1", variantId: "v1" });
    expect(s).toContain("abc");
    expect(s).toContain("/api/t");
    expect(s).toContain("sendBeacon");
    expect(s).toContain("IntersectionObserver");   // section_view tracking
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run shared/telemetry-beacon.test.ts`
Expected: FAIL — cannot find module `./telemetry-beacon`.

- [ ] **Step 3: Create `shared/telemetry-beacon.ts`**

```ts
export interface BeaconContext { siteId: string; experimentId?: string; variantId?: string; }

// Returns a self-contained <script> that: assigns a first-party visitor id (cookie),
// fires pageview, observes [data-section] elements for section_view, captures clicks on
// [data-cta], and exposes window.__t('conversion') for the page to call on success.
export function beaconScript(ctx: BeaconContext): string {
  const cfg = JSON.stringify(ctx);
  return `<script>(function(){
  var C=${cfg};
  function vid(){var m=document.cookie.match(/(?:^|; )vid=([^;]+)/);if(m)return m[1];
    var id=(crypto.randomUUID&&crypto.randomUUID())||String(Math.random()).slice(2);
    document.cookie="vid="+id+";path=/;max-age=31536000;samesite=lax";return id;}
  var V=vid(),S=String(Math.random()).slice(2),base={siteId:C.siteId,visitorId:V,sessionId:S,
    experimentId:C.experimentId,variantId:C.variantId};
  function send(type,extra){try{navigator.sendBeacon("/api/t",JSON.stringify(
    {events:[Object.assign({},base,{type:type,ts:Date.now()},extra||{})]}));}catch(e){}}
  window.__t=function(type,extra){send(type,extra);};
  send("pageview");
  if("IntersectionObserver"in window){var io=new IntersectionObserver(function(es){
    es.forEach(function(e){if(e.isIntersecting){send("section_view",{sectionIndex:+e.target.getAttribute("data-section")});io.unobserve(e.target);}});},{threshold:.5});
    document.querySelectorAll("[data-section]").forEach(function(el){io.observe(el);});}
  document.addEventListener("click",function(e){var t=e.target.closest&&e.target.closest("[data-cta]");
    if(t)send("cta_click",{sectionIndex:+(t.getAttribute("data-section")||0)});});
})();</script>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run shared/telemetry-beacon.test.ts`
Expected: PASS.

- [ ] **Step 5: Inject the beacon** in `shared/renderer.ts`

In `renderDocumentFull(doc)`, accept an optional 2nd arg `beacon?: BeaconContext` and, when present, append `beaconScript(beacon)` before `</body>`. Ensure each rendered section wrapper carries `data-section="<index>"` and primary CTAs carry `data-cta`. Keep the signature backward-compatible (beacon optional).

- [ ] **Step 6: Write a render test** (`shared/renderer-beacon.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { renderDocumentFull } from "./renderer";
import type { SiteDocument } from "./site-document";
const doc: SiteDocument = { version: 1, meta: { name: "X" }, theme: { preset: "modern-minimal", radius: "medium" }, sections: [{ type: "hero", headline: "Hi" }] };
describe("renderDocumentFull beacon", () => {
  it("omits beacon when no context", () => { expect(renderDocumentFull(doc)).not.toContain("/api/t"); });
  it("injects beacon + data-section when context given", () => {
    const html = renderDocumentFull(doc, { siteId: "s1" });
    expect(html).toContain("/api/t");
    expect(html).toContain('data-section="0"');
  });
});
```

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run shared/renderer-beacon.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Full suite + commit**

```bash
npx vitest run
git add shared/telemetry-beacon.ts shared/telemetry-beacon.test.ts shared/renderer.ts shared/renderer-beacon.test.ts
git commit -m "feat: telemetry beacon emitter + renderer injection"
```

---

## Final verification

- [ ] Run the whole suite: `npx vitest run` — Expected: all tests PASS.
- [ ] Type-check: `npm run check` (`tsc`) — Expected: no new type errors.
- [ ] Confirm `npm run db:push` applied `projects.document`, `site_goals`, `telemetry_events` (check via the Postgres dashboard or `\d` if available).

---

## Self-Review (against the spec)

- **Spec §3.1 SiteGoal** → Task 2 (with `lockedSectionIndexes` deviation, noted in header). ✅
- **Spec §3.2 telemetry model / §3.3 ingestion + funnel** → Tasks 3 (model+ingest+funnel) + 4 (beacon). ✅ Per-variant rollup in `funnel` is explicitly deferred to Plan 2 (noted in code comment) since experiments don't exist yet — not a gap.
- **Spec §3.8 serving "load canonical document"** → unblocked by Task 1 (document persistence), which the spec assumed existed. ✅
- **Spec §5 persistence** (`site_goals`, `telemetry_events`, `projects.document`) → Tasks 1–3. `experiments` + `decision_log` tables belong to Plans 2/3. ✅
- **Placeholder scan:** every code/test step contains real code and a real `npx vitest run <file>` command. No TBD/TODO. ✅
- **Type consistency:** `conversionEvent` used consistently (goal + telemetry event-name match); `sectionIndex` used consistently across telemetry schema, beacon, and funnel; `SiteGoal`/`TelemetryEvent`/`FunnelStats` names stable across tasks. ✅

**Not in this plan (by design — later plans):** experiment engine + `assignVariant`/`decide` + variant-aware serving (Plan 2); growth agent + governor + promote (Plan 3); Mission Control (Plan 4).
