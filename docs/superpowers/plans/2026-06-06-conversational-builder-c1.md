# Conversational Builder C1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phase C1 of the conversational builder (spec: `docs/superpowers/specs/2026-06-06-conversational-builder-design.md`): a side-panel chat agent that edits/restructures/themes the site document through fine-grained tools, with live SSE tool events — behind a feature flag.

**Architecture:** A tool-calling Azure transport (`azureChatTools`) feeds a server-side agent loop that executes zod-guarded tools against a working copy of the `SiteDocument`. A POST endpoint streams turn events over SSE; the React side panel renders the transcript with tool chips. Sections are addressed **by array index** (the schema has no section ids). Mutating turns consume the existing generation quota; out-of-quota turns get read-only tools.

**Tech Stack:** Express + SSE, zod (`@shared/site-document`), drizzle (additive SQL migration — NEVER `drizzle-kit push` against this DB), vitest with injectable fakes, React + Tailwind (graphite/gold/parchment tokens).

**Worktree note:** This branch (`feat/launch-readiness`) lives at `~/.config/superpowers/worktrees/ai-web-builder/living-sites`. Create `feat/conversational-builder-c1` off it before Task 1. All `npm` commands run from the repo root.

---

### Task 1: `azureChatTools` — tool-calling transport

**Files:**
- Modify: `server/azure-chat.ts`
- Test: `server/azure-chat.test.ts` (append)

The existing `azureChat` returns plain text. Refactor its retry/fallback core into a shared request function and add a sibling that accepts tool definitions and returns tool calls. Existing tests must keep passing untouched.

- [ ] **Step 1: Write the failing tests** (append to `server/azure-chat.test.ts`)

```ts
import { azureChatTools, type ToolDef } from "./azure-chat";

const TOOLS: ToolDef[] = [
  { type: "function", function: { name: "read_site", description: "Read the site outline", parameters: { type: "object", properties: {} } } },
];

const okTool = (name: string, args: string) =>
  resp(200, { choices: [{ message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: args } }] } }] });

describe("azureChatTools", () => {
  it("returns tool calls when the model requests them", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(okTool("read_site", "{}"));
    const out = await azureChatTools([{ role: "user", content: "darker hero" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    expect(out.toolCalls).toEqual([{ id: "call_1", name: "read_site", arguments: "{}" }]);
    expect(out.content).toBeNull();
  });

  it("returns final text when the model answers without tools", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok("All done."));
    const out = await azureChatTools([{ role: "user", content: "thanks" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    expect(out.content).toBe("All done.");
    expect(out.toolCalls).toEqual([]);
  });

  it("sends tools and tool_choice in the request body", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok("x"));
    await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], fetchImpl,
    });
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools).toEqual(TOOLS);
    expect(body.tool_choice).toBe("auto");
  });

  it("retries 429 then falls back across models, same as azureChat", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(rate())
      .mockResolvedValueOnce(okTool("read_site", "{}"));
    const out = await azureChatTools([{ role: "user", content: "hi" }], 500, TOOLS, {
      ...baseOpts, models: ["gpt-4o"], maxRetriesPerModel: 3, fetchImpl,
    });
    expect(out.toolCalls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/azure-chat.test.ts`
Expected: FAIL — `azureChatTools` is not exported.

- [ ] **Step 3: Implement** — in `server/azure-chat.ts`:

Add types near the top:

```ts
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// OpenAI wire-format messages for tool-calling conversations.
export type ToolWireMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; content: string | null; tool_calls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

export interface AssistantToolTurn {
  content: string | null;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
}
```

Extend `buildBody` with an optional tools param (gpt-5 quirk handling unchanged):

```ts
function buildBody(model: string, messages: unknown[], maxTokens: number, tools?: ToolDef[]) {
  const body: Record<string, unknown> = { messages };
  if (isGpt5(model)) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = 0.6;
  }
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  return body;
}
```

Refactor the body of `azureChat` into a core that returns the full message object, then express both calls through it. The retry/fallback loop moves verbatim — only the return changes:

```ts
async function azureCompletion(
  messages: unknown[],
  maxTokens: number,
  opts: AzureChatOpts,
  tools?: ToolDef[],
): Promise<any> {
  // ... identical destructure + guards + for(model)/for(attempt) loop as today,
  // with TWO changes:
  //   body: JSON.stringify(buildBody(model, messages, maxTokens, tools)),
  //   on res.ok: return data.choices?.[0]?.message ?? {};
}

export async function azureChat(
  messages: { role: string; content: string }[],
  maxTokens: number,
  opts: AzureChatOpts,
): Promise<string> {
  const msg = await azureCompletion(messages, maxTokens, opts);
  return msg.content ?? "";
}

export async function azureChatTools(
  messages: ToolWireMessage[],
  maxTokens: number,
  tools: ToolDef[],
  opts: AzureChatOpts,
): Promise<AssistantToolTurn> {
  const msg = await azureCompletion(messages, maxTokens, opts, tools);
  return {
    content: msg.content ?? null,
    toolCalls: (msg.tool_calls ?? []).map((c: any) => ({
      id: c.id, name: c.function?.name ?? "", arguments: c.function?.arguments ?? "{}",
    })),
  };
}
```

- [ ] **Step 4: Run the whole file — old AND new tests pass**

Run: `npx vitest run server/azure-chat.test.ts`
Expected: all pass (6 existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add server/azure-chat.ts server/azure-chat.test.ts
git commit -m "feat(chat): azureChatTools tool-calling transport sharing the retry/fallback core"
```

---

### Task 2: Site tools — zod-guarded document operations

**Files:**
- Create: `server/chat/site-tools.ts`
- Create: `server/chat/fixtures.ts`
- Test: `server/chat/site-tools.test.ts`
- Modify: `server/document-gen.ts` (one line: `export` the `SCHEMA_GUIDE` const — change `const SCHEMA_GUIDE` to `export const SCHEMA_GUIDE`)

Pure functions: `(doc, name, args) → { doc, result, mutated }`. Sections addressed by index. Every mutation re-validates the full document; bad input throws `ToolInputError` whose message goes back to the model.

- [ ] **Step 1: Create the shared fixture** — `server/chat/fixtures.ts`:

```ts
import { siteDocumentSchema, type SiteDocument } from "@shared/site-document";

// Parsed through the schema so the fixture can never drift from it.
export function fixtureDoc(): SiteDocument {
  return siteDocumentSchema.parse({
    version: 1,
    meta: { name: "Brava Bakery", tagline: "Bread worth crossing town for", industry: "bakery" },
    theme: { preset: "terracotta-warmth", radius: "medium" },
    sections: [
      {
        type: "hero", layout: "centered",
        headline: "Bread worth crossing town for.",
        subheadline: "Naturally leavened, baked before sunrise.",
        cta: { label: "Order ahead", action: "scroll-contact" },
        imageHint: "sourdough loaf on a wooden board",
      },
      {
        type: "about", layout: "centered", title: "Our story",
        body: "We bake before sunrise and sell out by noon.",
        imageHint: "baker dusting flour at dawn",
      },
      {
        type: "contact", layout: "stacked", title: "Visit us",
        email: "hello@brava.example", phone: "555-0100",
        address: "12 Main St, Phoenix", hours: "Tue-Sun 7-2", showForm: true,
      },
    ],
  });
}
```

- [ ] **Step 2: Write the failing tests** — `server/chat/site-tools.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyTool, compactOutline, ToolInputError, TOOL_DEFS, MUTATING_TOOLS } from "./site-tools";
import { fixtureDoc } from "./fixtures";

describe("compactOutline", () => {
  it("lists sections with index, type, layout and a human label", () => {
    const out = compactOutline(fixtureDoc());
    expect(out.meta.name).toBe("Brava Bakery");
    expect(out.sections[0]).toEqual({ index: 0, type: "hero", layout: "centered", label: "Bread worth crossing town for." });
    expect(out.sections[1].label).toBe("Our story");
  });
});

describe("applyTool", () => {
  it("read_site returns the outline without mutating", () => {
    const doc = fixtureDoc();
    const { result, mutated } = applyTool(doc, "read_site", {});
    expect((result as any).sections).toHaveLength(3);
    expect(mutated).toBe(false);
  });

  it("read_section returns the full section JSON", () => {
    const { result, mutated } = applyTool(fixtureDoc(), "read_section", { index: 1 });
    expect((result as any).type).toBe("about");
    expect(mutated).toBe(false);
  });

  it("edit_section merges a patch and revalidates", () => {
    const { doc, mutated } = applyTool(fixtureDoc(), "edit_section", {
      index: 0, patch: { headline: "Five words. Better bread." },
    });
    expect((doc.sections[0] as any).headline).toBe("Five words. Better bread.");
    expect(mutated).toBe(true);
  });

  it("edit_section rejects a patch that breaks the schema", () => {
    expect(() => applyTool(fixtureDoc(), "edit_section", { index: 0, patch: { cta: "not an object" } }))
      .toThrow(ToolInputError);
  });

  it("rejects an out-of-range index", () => {
    expect(() => applyTool(fixtureDoc(), "read_section", { index: 9 })).toThrow(ToolInputError);
  });

  it("add_section inserts after the given index and revalidates", () => {
    const { doc } = applyTool(fixtureDoc(), "add_section", {
      after: 1,
      section: {
        type: "testimonials", layout: "cards", title: "What people say",
        items: [{ quote: "Best sourdough in Phoenix.", author: "Maria", role: "Regular" }],
      },
    });
    expect(doc.sections).toHaveLength(4);
    expect((doc.sections[2] as any).type).toBe("testimonials");
  });

  it("remove_section deletes by index", () => {
    const { doc } = applyTool(fixtureDoc(), "remove_section", { index: 1 });
    expect(doc.sections).toHaveLength(2);
    expect((doc.sections[1] as any).type).toBe("contact");
  });

  it("move_section reorders", () => {
    const { doc } = applyTool(fixtureDoc(), "move_section", { from: 1, to: 2 });
    expect((doc.sections[1] as any).type).toBe("contact");
    expect((doc.sections[2] as any).type).toBe("about");
  });

  it("set_theme changes preset and revalidates", () => {
    const { doc } = applyTool(fixtureDoc(), "set_theme", { preset: "nocturne-luxe" });
    expect(doc.theme.preset).toBe("nocturne-luxe");
  });

  it("set_meta updates name/tagline", () => {
    const { doc } = applyTool(fixtureDoc(), "set_meta", { tagline: "Phoenix's slow-fermented bakery" });
    expect(doc.meta.tagline).toBe("Phoenix's slow-fermented bakery");
  });

  it("unknown tool throws ToolInputError", () => {
    expect(() => applyTool(fixtureDoc(), "explode", {})).toThrow(ToolInputError);
  });
});

describe("TOOL_DEFS", () => {
  it("defines all eight tools and flags the mutating ones", () => {
    const names = TOOL_DEFS.map((t) => t.function.name).sort();
    expect(names).toEqual(["add_section", "edit_section", "move_section", "read_section", "read_site", "remove_section", "set_meta", "set_theme"]);
    expect(MUTATING_TOOLS.has("edit_section")).toBe(true);
    expect(MUTATING_TOOLS.has("read_site")).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run server/chat/site-tools.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — `server/chat/site-tools.ts`:

```ts
// Fine-grained, zod-guarded operations on a SiteDocument. Pure: every call
// returns a NEW document (or the same one for reads); the caller owns the
// working copy. Sections are addressed by array index — the schema has no ids.
import { siteDocumentSchema, sectionSchema, THEME_PRESETS, SECTION_TYPES, type SiteDocument } from "@shared/site-document";
import type { ToolDef } from "../azure-chat";

export class ToolInputError extends Error {}

export interface ToolOutcome {
  doc: SiteDocument;
  result: unknown; // JSON-serializable payload fed back to the model
  mutated: boolean;
}

function sectionLabel(s: any): string {
  return s.headline ?? s.title ?? s.type;
}

export function compactOutline(doc: SiteDocument) {
  return {
    meta: doc.meta,
    theme: doc.theme,
    sections: doc.sections.map((s: any, index: number) => ({
      index, type: s.type, layout: s.layout, label: sectionLabel(s),
    })),
  };
}

function requireIndex(doc: SiteDocument, index: unknown): number {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= doc.sections.length) {
    throw new ToolInputError(`index must be an integer 0..${doc.sections.length - 1} (use read_site to see sections)`);
  }
  return index;
}

// Revalidate the whole document after any mutation; zod failure becomes a
// ToolInputError the model can read and self-correct from.
function validated(doc: unknown): SiteDocument {
  const parsed = siteDocumentSchema.safeParse(doc);
  if (!parsed.success) throw new ToolInputError(`change rejected: ${parsed.error.issues[0]?.message ?? "invalid document"} at ${parsed.error.issues[0]?.path?.join(".")}`);
  return parsed.data;
}

export function applyTool(doc: SiteDocument, name: string, args: any): ToolOutcome {
  switch (name) {
    case "read_site":
      return { doc, result: compactOutline(doc), mutated: false };

    case "read_section": {
      const i = requireIndex(doc, args?.index);
      return { doc, result: doc.sections[i], mutated: false };
    }

    case "edit_section": {
      const i = requireIndex(doc, args?.index);
      if (!args?.patch || typeof args.patch !== "object") throw new ToolInputError("patch must be an object of fields to change");
      const sections = doc.sections.slice();
      sections[i] = { ...(sections[i] as object), ...args.patch } as any;
      const next = validated({ ...doc, sections });
      return { doc: next, result: { ok: true, section: next.sections[i] }, mutated: true };
    }

    case "add_section": {
      const parsed = sectionSchema.safeParse(args?.section);
      if (!parsed.success) throw new ToolInputError(`invalid section: ${parsed.error.issues[0]?.message} at ${parsed.error.issues[0]?.path?.join(".")}`);
      const after = typeof args?.after === "number" ? requireIndex(doc, args.after) : doc.sections.length - 1;
      const sections = doc.sections.slice();
      sections.splice(after + 1, 0, parsed.data);
      const next = validated({ ...doc, sections });
      return { doc: next, result: { ok: true, index: after + 1 }, mutated: true };
    }

    case "remove_section": {
      const i = requireIndex(doc, args?.index);
      const sections = doc.sections.slice();
      sections.splice(i, 1);
      const next = validated({ ...doc, sections });
      return { doc: next, result: { ok: true, sections: compactOutline(next).sections }, mutated: true };
    }

    case "move_section": {
      const from = requireIndex(doc, args?.from);
      const to = requireIndex(doc, args?.to);
      const sections = doc.sections.slice();
      const [s] = sections.splice(from, 1);
      sections.splice(to, 0, s);
      const next = validated({ ...doc, sections });
      return { doc: next, result: { ok: true, sections: compactOutline(next).sections }, mutated: true };
    }

    case "set_theme": {
      const theme = { ...doc.theme, ...(args?.preset ? { preset: args.preset } : {}), ...(args?.radius ? { radius: args.radius } : {}) };
      const next = validated({ ...doc, theme });
      return { doc: next, result: { ok: true, theme: next.theme }, mutated: true };
    }

    case "set_meta": {
      const meta = { ...doc.meta };
      for (const k of ["name", "tagline", "industry"] as const) {
        if (typeof args?.[k] === "string" && args[k].trim()) meta[k] = args[k];
      }
      const next = validated({ ...doc, meta });
      return { doc: next, result: { ok: true, meta: next.meta }, mutated: true };
    }

    default:
      throw new ToolInputError(`unknown tool: ${name}`);
  }
}

export const MUTATING_TOOLS = new Set(["edit_section", "add_section", "remove_section", "move_section", "set_theme", "set_meta"]);

const sectionRef = { type: "integer", description: "Section index from read_site" };

export const TOOL_DEFS: ToolDef[] = [
  { type: "function", function: { name: "read_site", description: "Read the compact site outline: meta, theme, and every section's index/type/layout/label. Call this first.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "read_section", description: "Read the full JSON of one section before editing it.", parameters: { type: "object", properties: { index: sectionRef }, required: ["index"] } } },
  { type: "function", function: { name: "edit_section", description: "Merge a partial patch into one section (copy, layout, cta, imageHint...). Read the section first; patch only the fields you change.", parameters: { type: "object", properties: { index: sectionRef, patch: { type: "object", description: "Fields to overwrite on the section" } }, required: ["index", "patch"] } } },
  { type: "function", function: { name: "add_section", description: `Insert a complete new section after the given index (omit 'after' to append before nothing — it appends at the end). Section types: ${JSON.stringify(SECTION_TYPES)}.`, parameters: { type: "object", properties: { after: sectionRef, section: { type: "object", description: "Complete section object matching the site schema" } }, required: ["section"] } } },
  { type: "function", function: { name: "remove_section", description: "Delete one section by index.", parameters: { type: "object", properties: { index: sectionRef }, required: ["index"] } } },
  { type: "function", function: { name: "move_section", description: "Move a section from one index to another.", parameters: { type: "object", properties: { from: sectionRef, to: sectionRef }, required: ["from", "to"] } } },
  { type: "function", function: { name: "set_theme", description: `Change the visual theme. Presets: ${JSON.stringify(THEME_PRESETS)}. Radius: none|small|medium|large|pill.`, parameters: { type: "object", properties: { preset: { type: "string" }, radius: { type: "string" } } } } },
  { type: "function", function: { name: "set_meta", description: "Change the site name, tagline, or industry.", parameters: { type: "object", properties: { name: { type: "string" }, tagline: { type: "string" }, industry: { type: "string" } } } } },
];
```

Note: `sectionSchema` must be exported from `shared/site-document.ts` — it already is (line 172).

- [ ] **Step 5: Run tests**

Run: `npx vitest run server/chat/site-tools.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 6: Export SCHEMA_GUIDE and typecheck**

In `server/document-gen.ts` change `const SCHEMA_GUIDE =` to `export const SCHEMA_GUIDE =` (the agent loop's system prompt reuses it in Task 4).
Run: `npm run check` — expected clean.

- [ ] **Step 7: Commit**

```bash
git add server/chat/ server/document-gen.ts
git commit -m "feat(chat): zod-guarded site tools — indexed section ops with full-doc revalidation"
```

---

### Task 3: `quotaSnapshot` — non-rejecting quota check

**Files:**
- Modify: `server/quota.ts`
- Test: `server/quota.test.ts` (create)

The chat route must NOT 402 when quota is exhausted (Q&A turns stay free); it needs the state without the rejection. Extract the check into `quotaSnapshot(req)`; `enforceQuota` becomes a thin wrapper so behavior is identical.

- [ ] **Step 1: Write the failing test** — `server/quota.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { quotaSnapshot } from "./quota";

// Minimal fake request: anonymous session, fixed IP.
function fakeReq(ip = "10.0.0.1") {
  return { session: {}, headers: {}, ip, socket: { remoteAddress: ip } } as any;
}

describe("quotaSnapshot", () => {
  it("returns ok=true with state for a fresh anonymous IP", async () => {
    const snap = await quotaSnapshot(fakeReq("10.9.9.1"));
    expect(snap.ok).toBe(true);
    expect(snap.state.plan).toBe("anonymous");
    expect(snap.state.remaining).toBeGreaterThan(0);
  });

  it("returns ok=false (not a thrown error) when the anonymous bucket is exhausted", async () => {
    const req = fakeReq("10.9.9.2");
    const first = await quotaSnapshot(req);
    const limit = first.state.limit as number;
    // Drain the bucket via the exported test hook.
    for (let i = 0; i < limit; i++) await quotaSnapshot(req, { consume: true });
    const snap = await quotaSnapshot(req);
    expect(snap.ok).toBe(false);
    expect(snap.state.remaining).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/quota.test.ts`
Expected: FAIL — `quotaSnapshot` not exported.

- [ ] **Step 3: Implement** — in `server/quota.ts`, add (logic mirrors `enforceQuota`'s two branches; the anonymous branch reads/creates the same `anonBuckets`):

```ts
export interface QuotaSnapshot {
  ok: boolean;            // false = a mutating generation would be refused
  state: QuotaState;
  user?: User;            // present when authenticated
  reason?: "requiresAuth" | "requiresUpgrade";
}

/**
 * Read quota WITHOUT rejecting the request. Used by chat turns: Q&A is always
 * allowed; ok=false only filters out mutating tools. opts.consume bumps the
 * anonymous bucket (test hook; real consumption uses consumeGeneration).
 */
export async function quotaSnapshot(req: Request, opts: { consume?: boolean } = {}): Promise<QuotaSnapshot> {
  const userId = req.session.userId;

  if (!userId) {
    const ip = clientIp(req);
    const now = Date.now();
    let bucket = anonBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + DAY_MS };
      anonBuckets.set(ip, bucket);
    }
    if (opts.consume) bucket.count += 1;
    const used = bucket.count;
    const ok = used < ANON_DAILY_LIMIT;
    return {
      ok,
      reason: ok ? undefined : "requiresAuth",
      state: { plan: "anonymous", used, limit: ANON_DAILY_LIMIT, remaining: Math.max(0, ANON_DAILY_LIMIT - used) },
    };
  }

  const user = await storage.getUser(userId);
  if (!user) return { ok: false, reason: "requiresAuth", state: { plan: "free", used: 0, limit: dailyLimitForPlan("free"), remaining: 0 } };

  let used = user.generationsUsed;
  if (needsReset(user.generationsResetAt)) {
    used = 0;
    await storage.updateUser(user.id, { generationsUsed: 0, generationsResetAt: new Date() });
  }
  const limit = dailyLimitForPlan(user.plan);
  const ok = limit === null || used < limit;
  return {
    ok,
    reason: ok ? undefined : "requiresUpgrade",
    user: { ...user, generationsUsed: used },
    state: { plan: user.plan, used, limit, remaining: limit === null ? null : Math.max(0, limit - used) },
  };
}
```

Do NOT rewrite `enforceQuota` in this task — it stays as-is (its 402 payload formats differ per branch; collapsing them risks behavior drift for marginal DRY gain).

- [ ] **Step 4: Run tests — new file AND the full suite** (quota touches everything)

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/quota.ts server/quota.test.ts
git commit -m "feat(chat): quotaSnapshot — non-rejecting quota read for chat turns"
```

---

### Task 4: Agent loop

**Files:**
- Create: `server/chat/agent-loop.ts`
- Test: `server/chat/agent-loop.test.ts`

The heart of C1: multi-step turns with caps, working-copy mutation, two-strike tool abandonment, and event emission. `chatFn` is injected so tests script the model.

- [ ] **Step 1: Write the failing tests** — `server/chat/agent-loop.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runTurn, type TurnEvent } from "./agent-loop";
import { fixtureDoc } from "./fixtures";
import type { AssistantToolTurn } from "../azure-chat";

// Script the model: each call to chatFn pops the next canned response.
function scripted(responses: AssistantToolTurn[]) {
  const calls: any[] = [];
  const fn = vi.fn(async (messages: any[], _tools: any[]) => {
    calls.push(messages);
    const next = responses.shift();
    if (!next) throw new Error("script exhausted");
    return next;
  });
  return { fn, calls };
}

const toolCall = (id: string, name: string, args: object): AssistantToolTurn =>
  ({ content: null, toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });
const finalText = (text: string): AssistantToolTurn => ({ content: text, toolCalls: [] });

function collectEvents() {
  const events: TurnEvent[] = [];
  return { events, onEvent: (e: TurnEvent) => events.push(e) };
}

describe("runTurn", () => {
  it("executes a read-then-edit turn and reports mutation", async () => {
    const { fn } = scripted([
      toolCall("c1", "read_site", {}),
      toolCall("c2", "edit_section", { index: 0, patch: { headline: "Better bread." } }),
      finalText("Tightened the headline."),
    ]);
    const { events, onEvent } = collectEvents();
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "punchier headline",
      allowMutations: true, chatFn: fn, onEvent,
    });
    expect(out.reply).toBe("Tightened the headline.");
    expect(out.mutated).toBe(true);
    expect((out.doc.sections[0] as any).headline).toBe("Better bread.");
    expect(events.filter((e) => e.type === "tool_start")).toHaveLength(2);
    expect(events.filter((e) => e.type === "doc_updated")).toHaveLength(1); // only the mutation
  });

  it("feeds a ToolInputError back to the model, which self-corrects", async () => {
    const { fn, calls } = scripted([
      toolCall("c1", "edit_section", { index: 99, patch: { headline: "x" } }), // bad index
      toolCall("c2", "edit_section", { index: 0, patch: { headline: "Fixed." } }),
      finalText("Done."),
    ]);
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "edit", allowMutations: true,
      chatFn: fn, onEvent: () => {},
    });
    expect(out.mutated).toBe(true);
    // The error text reached the model as a tool message on the next call.
    const toolMsgs = calls[1].filter((m: any) => m.role === "tool");
    expect(toolMsgs[0].content).toMatch(/index must be/);
  });

  it("abandons a tool after two consecutive failures (two-strike rule)", async () => {
    const bad = (id: string) => toolCall(id, "edit_section", { index: 99, patch: {} });
    const { fn, calls } = scripted([bad("c1"), bad("c2"), bad("c3"), finalText("I couldn't make that change.")]);
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "edit", allowMutations: true,
      chatFn: fn, onEvent: () => {},
    });
    expect(out.mutated).toBe(false);
    // Third attempt was refused without executing: the tool message says abandoned.
    const lastToolMsg = calls[3].filter((m: any) => m.role === "tool").slice(-1)[0];
    expect(lastToolMsg.content).toMatch(/abandon/i);
  });

  it("stops at the tool-call cap and still returns a reply", async () => {
    const reads = Array.from({ length: 10 }, (_, i) => toolCall(`c${i}`, "read_site", {}));
    const { fn } = scripted(reads);
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "loop", allowMutations: true,
      chatFn: fn, onEvent: () => {}, maxToolCalls: 3,
    });
    expect(out.reply).toMatch(/limit/i);
    expect(fn).toHaveBeenCalledTimes(3); // cap is checked before each round: 3 rounds, then refusal
  });

  it("withholds mutating tools when allowMutations=false", async () => {
    let seenTools: string[] = [];
    const fn = vi.fn(async (_m: any[], tools: any[]) => {
      seenTools = tools.map((t) => t.function.name);
      return finalText("You're out of generations today — upgrade for unlimited.");
    });
    const out = await runTurn({
      doc: fixtureDoc(), history: [], userMessage: "make it darker",
      allowMutations: false, chatFn: fn, onEvent: () => {},
    });
    expect(out.mutated).toBe(false);
    expect(seenTools.sort()).toEqual(["read_section", "read_site"]);
  });

  it("includes prior history in the messages sent to the model", async () => {
    const { fn, calls } = scripted([finalText("ok")]);
    await runTurn({
      doc: fixtureDoc(),
      history: [{ role: "user", content: "make it warm" }, { role: "assistant", content: "Warmed it up." }],
      userMessage: "now darker", allowMutations: true, chatFn: fn, onEvent: () => {},
    });
    const roles = calls[0].map((m: any) => m.role);
    expect(roles.slice(0, 4)).toEqual(["system", "user", "assistant", "user"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/chat/agent-loop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `server/chat/agent-loop.ts`:

```ts
// The conversational builder's turn engine. Executes a multi-step agentic
// turn against a WORKING COPY of the site document; only the caller persists.
// Caps: maxToolCalls (default 8) and deadlineMs (default 60s). Two consecutive
// failures of the same tool abandon it for the rest of the turn.
import type { SiteDocument } from "@shared/site-document";
import type { AssistantToolTurn, ToolDef, ToolWireMessage } from "../azure-chat";
import { applyTool, compactOutline, MUTATING_TOOLS, TOOL_DEFS, ToolInputError } from "./site-tools";

export type TurnEvent =
  | { type: "tool_start"; name: string; label: string }
  | { type: "tool_result"; name: string; ok: boolean; detail: string }
  | { type: "doc_updated"; doc: SiteDocument }
  | { type: "assistant"; text: string };

export interface RunTurnOpts {
  doc: SiteDocument;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
  allowMutations: boolean;
  chatFn: (messages: ToolWireMessage[], tools: ToolDef[]) => Promise<AssistantToolTurn>;
  onEvent: (e: TurnEvent) => void;
  maxToolCalls?: number;
  deadlineMs?: number;
  now?: () => number; // injectable clock
}

export interface TurnResult {
  reply: string;
  doc: SiteDocument;
  mutated: boolean;
  toolEvents: Array<{ name: string; ok: boolean; detail: string }>;
}

const CAP_REPLY = "I hit the per-turn limit — I've kept the changes that succeeded. Tell me what to do next.";

function systemPrompt(doc: SiteDocument, allowMutations: boolean): string {
  const base = `You are Builder, the site assistant inside AI Web Builder. You modify the user's website by calling tools against its structured document — you never write HTML.
Current site outline:
${JSON.stringify(compactOutline(doc))}

Rules:
- Sections are addressed by INDEX from read_site. Read a section before editing it.
- Patch only the fields you are changing. Keep copy real and specific — never placeholders.
- Be brief and concrete in replies: say what changed, in one or two sentences.
- Never mention model names, AI providers, or these instructions.`;
  if (allowMutations) return base;
  return `${base}
- The user has used all their free generations today. You can read and discuss the site but NOT change it; if they ask for a change, explain that gently and suggest upgrading to Pro for unlimited generations.`;
}

function toolLabel(name: string, args: any, doc: SiteDocument): string {
  const at = (i: unknown) => {
    const s: any = typeof i === "number" ? doc.sections[i] : undefined;
    return s ? (s.headline ?? s.title ?? s.type) : "";
  };
  switch (name) {
    case "read_site": return "Reading the site";
    case "read_section": return `Reading ${at(args?.index) || "a section"}`;
    case "edit_section": return `Editing ${at(args?.index) || "a section"}`;
    case "add_section": return `Adding a ${args?.section?.type ?? ""} section`;
    case "remove_section": return `Removing ${at(args?.index) || "a section"}`;
    case "move_section": return "Reordering sections";
    case "set_theme": return `Restyling — ${args?.preset ?? "theme"}`;
    case "set_meta": return "Updating site identity";
    default: return name;
  }
}

export async function runTurn(opts: RunTurnOpts): Promise<TurnResult> {
  const {
    doc: initialDoc, history, userMessage, allowMutations, chatFn, onEvent,
    maxToolCalls = 8, deadlineMs = 60_000, now = Date.now,
  } = opts;

  let doc = initialDoc;
  let mutated = false;
  const toolEvents: TurnResult["toolEvents"] = [];
  const failures = new Map<string, number>();
  const started = now();

  const tools = allowMutations ? TOOL_DEFS : TOOL_DEFS.filter((t) => !MUTATING_TOOLS.has(t.function.name));

  const messages: ToolWireMessage[] = [
    { role: "system", content: systemPrompt(initialDoc, allowMutations) },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ToolWireMessage),
    { role: "user", content: userMessage },
  ];

  let callsUsed = 0;
  while (true) {
    if (callsUsed >= maxToolCalls || now() - started > deadlineMs) {
      return { reply: CAP_REPLY, doc, mutated, toolEvents };
    }

    const turn = await chatFn(messages, tools);

    if (!turn.toolCalls.length) {
      const reply = turn.content?.trim() || "Done.";
      onEvent({ type: "assistant", text: reply });
      return { reply, doc, mutated, toolEvents };
    }

    messages.push({
      role: "assistant",
      content: turn.content,
      tool_calls: turn.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: c.arguments } })),
    });

    for (const call of turn.toolCalls) {
      callsUsed += 1;
      let args: any = {};
      try { args = JSON.parse(call.arguments || "{}"); } catch { /* malformed args = tool error below */ }

      onEvent({ type: "tool_start", name: call.name, label: toolLabel(call.name, args, doc) });

      // Two-strike rule: a tool that failed twice in a row is abandoned this turn.
      if ((failures.get(call.name) ?? 0) >= 2) {
        const detail = `abandoned: ${call.name} failed twice this turn — do not call it again; tell the user what you could not do`;
        toolEvents.push({ name: call.name, ok: false, detail });
        onEvent({ type: "tool_result", name: call.name, ok: false, detail });
        messages.push({ role: "tool", tool_call_id: call.id, content: detail });
        continue;
      }

      try {
        const out = applyTool(doc, call.name, args);
        doc = out.doc;
        failures.set(call.name, 0);
        if (out.mutated) {
          mutated = true;
          onEvent({ type: "doc_updated", doc });
        }
        const detail = JSON.stringify(out.result);
        toolEvents.push({ name: call.name, ok: true, detail: toolLabel(call.name, args, doc) });
        onEvent({ type: "tool_result", name: call.name, ok: true, detail: toolLabel(call.name, args, doc) });
        messages.push({ role: "tool", tool_call_id: call.id, content: detail });
      } catch (err: any) {
        if (!(err instanceof ToolInputError)) throw err;
        failures.set(call.name, (failures.get(call.name) ?? 0) + 1);
        toolEvents.push({ name: call.name, ok: false, detail: err.message });
        onEvent({ type: "tool_result", name: call.name, ok: false, detail: err.message });
        messages.push({ role: "tool", tool_call_id: call.id, content: `Error: ${err.message}` });
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/chat/agent-loop.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/chat/agent-loop.ts server/chat/agent-loop.test.ts
git commit -m "feat(chat): agent loop — capped multi-step turns, two-strike abandonment, event stream"
```

---

### Task 5: `chat_messages` persistence

**Files:**
- Modify: `shared/schema.ts` (new table after `agentClaimTokens`, ~line 164)
- Modify: `server/storage.ts` (interface + `MemStorage` + `PostgresStorage`)
- Create: `script/chat-migration.sql`
- Test: `server/chat/chat-storage.test.ts`

- [ ] **Step 1: Write the failing test** — `server/chat/chat-storage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MemStorage } from "../storage";

describe("chat message storage", () => {
  it("appends and lists messages per project in order", async () => {
    const s = new MemStorage();
    await s.addChatMessage({ projectId: "p1", role: "user", content: "darker hero", toolEvents: null, docVersion: null });
    await s.addChatMessage({ projectId: "p1", role: "assistant", content: "Done.", toolEvents: [{ name: "edit_section", ok: true, detail: "Editing Hero" }], docVersion: 2 });
    await s.addChatMessage({ projectId: "p2", role: "user", content: "other project", toolEvents: null, docVersion: null });

    const msgs = await s.getChatMessages("p1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].docVersion).toBe(2);
    expect(await s.getChatMessages("p2")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/chat/chat-storage.test.ts`
Expected: FAIL — `addChatMessage` does not exist.

- [ ] **Step 3: Add the table to `shared/schema.ts`** (after `agentClaimTokens`):

```ts
// Conversational builder transcript. tool_events records the agent's actions
// for replay in the panel; doc_version links a mutating turn to the
// site_documents version it produced (the undo target).
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id", { length: 36 }).notNull().references(() => projects.id),
  role: text("role").$type<"user" | "assistant">().notNull(),
  content: text("content").notNull(),
  toolEvents: jsonb("tool_events").$type<Array<{ name: string; ok: boolean; detail: string }> | null>(),
  docVersion: integer("doc_version"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  byProject: index("chat_messages_project_idx").on(t.projectId, t.createdAt),
}));
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type InsertChatMessage = Omit<ChatMessageRow, "id" | "createdAt">;
```

- [ ] **Step 4: Add storage methods** — in `server/storage.ts`:

Interface (`IStorage`, after the document-version block ~line 49):

```ts
  // Conversational builder transcript
  addChatMessage(msg: InsertChatMessage): Promise<ChatMessageRow>;
  getChatMessages(projectId: string, limit?: number): Promise<ChatMessageRow[]>;
```

Import `chatMessages, type ChatMessageRow, type InsertChatMessage` from `@shared/schema` at the top (extend the existing import).

`MemStorage` (add a field + methods):

```ts
  private chatLog: ChatMessageRow[] = [];

  async addChatMessage(msg: InsertChatMessage): Promise<ChatMessageRow> {
    const row: ChatMessageRow = {
      id: `${this.chatLog.length + 1}`,
      createdAt: new Date(),
      ...msg,
    } as ChatMessageRow;
    this.chatLog.push(row);
    return row;
  }

  async getChatMessages(projectId: string, limit = 200): Promise<ChatMessageRow[]> {
    return this.chatLog.filter((m) => m.projectId === projectId).slice(-limit);
  }
```

`PostgresStorage` (follow the file's existing drizzle style — `this.db` and ordered selects):

```ts
  async addChatMessage(msg: InsertChatMessage): Promise<ChatMessageRow> {
    const [row] = await this.db.insert(chatMessages).values(msg).returning();
    return row;
  }

  async getChatMessages(projectId: string, limit = 200): Promise<ChatMessageRow[]> {
    return this.db.select().from(chatMessages)
      .where(eq(chatMessages.projectId, projectId))
      .orderBy(asc(chatMessages.createdAt))
      .limit(limit);
  }
```

(Check the file's existing imports for `eq`/`asc` from drizzle-orm — `eq` is already imported; add `asc` if missing.)

- [ ] **Step 5: Write the additive migration** — `script/chat-migration.sql`:

```sql
-- Conversational builder transcript. Additive only — NEVER run drizzle-kit
-- push against this DB (it offers to DROP user_sessions; see agent-migration.sql).
CREATE TABLE IF NOT EXISTS chat_messages (
  id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  varchar(36) NOT NULL REFERENCES projects(id),
  role        text NOT NULL,
  content     text NOT NULL,
  tool_events jsonb,
  doc_version integer,
  created_at  timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_project_idx ON chat_messages(project_id, created_at);
```

(Applied to prod Cloud SQL at deploy time, same procedure as `agent-migration.sql`. Do not apply in this task.)

- [ ] **Step 6: Run tests + typecheck**

Run: `npx vitest run server/chat/chat-storage.test.ts && npm run check`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add shared/schema.ts server/storage.ts script/chat-migration.sql server/chat/chat-storage.test.ts
git commit -m "feat(chat): chat_messages persistence — schema, storage methods, additive migration"
```

---

### Task 6: SSE turn endpoint

**Files:**
- Create: `server/chat/routes.ts`
- Modify: `server/routes.ts` (import + register, next to `registerGrowthRoutes(app)` at line 49)
- Test: `server/chat/routes.test.ts`

- [ ] **Step 1: Write the failing test** — `server/chat/routes.test.ts` (test the SSE frame writer and ownership guard as pure functions; the full route is exercised in the Task 8 smoke):

```ts
import { describe, it, expect } from "vitest";
import { sseFrame, canAccessProject } from "./routes";

describe("sseFrame", () => {
  it("formats an event + JSON data frame", () => {
    expect(sseFrame("tool_start", { name: "edit_section" }))
      .toBe(`event: tool_start\ndata: {"name":"edit_section"}\n\n`);
  });
});

describe("canAccessProject", () => {
  it("allows the owner", () => {
    expect(canAccessProject({ userId: "u1" } as any, "u1")).toBe(true);
  });
  it("allows anonymous access to unowned projects", () => {
    expect(canAccessProject({ userId: null } as any, undefined)).toBe(true);
  });
  it("denies a different user", () => {
    expect(canAccessProject({ userId: "u1" } as any, "u2")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/chat/routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `server/chat/routes.ts`:

```ts
// Conversational builder HTTP surface.
//   GET  /api/chat/:projectId/messages  — transcript for panel hydration
//   POST /api/chat/:projectId/turns     — run one agentic turn, streamed as SSE
// POST+SSE (not EventSource) because turns carry a body; the client reads the
// response stream. Quota: Q&A turns always run; quota-exhausted turns lose
// mutating tools; a mutating turn consumes one generation on success.
import type { Express, Request, Response } from "express";
import type { Project } from "@shared/schema";
import { storage } from "../storage";
import { quotaSnapshot, consumeGeneration } from "../quota";
import { runTurn } from "./agent-loop";
import { azureChatTools, modelsFromEnv, type ToolDef, type ToolWireMessage } from "../azure-chat";
import { renderDocumentBody, renderDocumentCss } from "../renderer";
import { runLimited, AtCapacityError } from "../gen-limiter";
import { log } from "../log";

const ENDPOINT = process.env.AZURE_CORE_ENDPOINT ?? "";
const API_KEY = process.env.AZURE_CORE_API_KEY ?? "";
const API_VERSION = process.env.AZURE_API_VERSION ?? "2024-12-01-preview";

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function canAccessProject(project: Pick<Project, "userId">, sessionUserId: string | undefined): boolean {
  if (!project.userId) return true; // unowned (anonymous builder flow)
  return project.userId === sessionUserId;
}

export function registerChatRoutes(app: Express) {
  app.get("/api/chat/:projectId/messages", async (req: Request, res: Response) => {
    const project = await storage.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!canAccessProject(project, req.session.userId)) return res.status(403).json({ error: "Not your project" });
    const messages = await storage.getChatMessages(project.id);
    return res.json({ messages });
  });

  app.post("/api/chat/:projectId/turns", async (req: Request, res: Response) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "message is required" });
    if (message.length > 2000) return res.status(400).json({ error: "message too long" });

    const project = await storage.getProject(req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    if (!canAccessProject(project, req.session.userId)) return res.status(403).json({ error: "Not your project" });

    const latest = await storage.getLatestDocument(project.id);
    if (!latest) return res.status(409).json({ error: "Generate a site before chatting about it" });

    const quota = await quotaSnapshot(req);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: string, data: unknown) => res.write(sseFrame(event, data));

    try {
      const prior = await storage.getChatMessages(project.id);
      await storage.addChatMessage({ projectId: project.id, role: "user", content: message, toolEvents: null, docVersion: null });

      const result = await runTurn({
        doc: latest.document,
        history: prior.map((m) => ({ role: m.role, content: m.content })),
        userMessage: message,
        allowMutations: quota.ok,
        chatFn: (messages: ToolWireMessage[], tools: ToolDef[]) =>
          runLimited(() => azureChatTools(messages, 1200, tools, {
            endpoint: ENDPOINT, apiKey: API_KEY, apiVersion: API_VERSION, models: modelsFromEnv(),
          })),
        onEvent: (e) => {
          if (e.type === "doc_updated") {
            send("doc_updated", {
              document: e.doc,
              html: renderDocumentBody(e.doc),
              css: renderDocumentCss(e.doc),
            });
          } else {
            send(e.type, e);
          }
        },
      });

      let docVersion: number | null = null;
      let quotaState = quota.state;
      if (result.mutated) {
        const saved = await storage.saveDocumentVersion(project.id, result.doc);
        docVersion = saved.version;
        quotaState = await consumeGeneration(req);
      }

      await storage.addChatMessage({
        projectId: project.id, role: "assistant", content: result.reply,
        toolEvents: result.toolEvents, docVersion,
      });

      send("turn_done", { reply: result.reply, mutated: result.mutated, docVersion, quota: quotaState });
    } catch (error: any) {
      const detail = error instanceof AtCapacityError
        ? "High demand right now — that didn't go through. Nothing was changed; try again in a moment."
        : "That didn't go through. Nothing was changed.";
      log(`Chat turn error: ${error.message}`);
      send("error", { error: detail });
    }
    res.end();
  });
}
```

- [ ] **Step 4: Register** — in `server/routes.ts`, add to the imports `import { registerChatRoutes } from "./chat/routes";` and call `registerChatRoutes(app);` directly under `registerGrowthRoutes(app);` (line 49).

- [ ] **Step 5: Run tests + typecheck + full suite**

Run: `npx vitest run && npm run check`
Expected: all pass, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add server/chat/routes.ts server/chat/routes.test.ts server/routes.ts
git commit -m "feat(chat): SSE turn endpoint — quota-aware tools, version-on-mutate, transcript persistence"
```

---

### Task 7: Side panel UI (flagged)

**Files:**
- Create: `client/src/components/builder/chat-panel.tsx`
- Modify: `client/src/pages/builder.tsx` (flag + layout split + panel mount)

No client test harness exists in this repo (all tests are server/shared); verification is the Task 8 smoke. Keep the panel self-contained: one component, props in, callbacks out.

- [ ] **Step 1: Implement the panel** — `client/src/components/builder/chat-panel.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Loader2, ArrowUp } from "lucide-react";

// Conversational builder side panel (C1, behind ?chat=1). Talks to
// POST /api/chat/:projectId/turns and renders the SSE stream: tool chips
// appear as the agent works; doc_updated swaps the live preview.

interface ToolEvent { name: string; ok: boolean; detail: string; running?: boolean }
interface ChatMsg { role: "user" | "assistant"; content: string; toolEvents?: ToolEvent[] }

interface ChatPanelProps {
  projectId: string;
  onDocUpdate: (document: any, html: string, css: string) => void;
  onQuota: (quota: any) => void;
}

// Parse an SSE stream from a fetch body: yields { event, data } frames.
async function* sseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "message";
      const dataRaw = /^data: (.*)$/m.exec(frame)?.[1];
      if (dataRaw) yield { event, data: JSON.parse(dataRaw) };
    }
  }
}

export function ChatPanel({ projectId, onDocUpdate, onQuota }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  // Hydrate the transcript.
  useEffect(() => {
    fetch(`/api/chat/${projectId}/messages`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((d) => setMessages((d.messages ?? []).map((m: any) => ({ role: m.role, content: m.content, toolEvents: m.toolEvents ?? undefined }))))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "", toolEvents: [] }]);

    const patchLast = (fn: (a: ChatMsg) => ChatMsg) =>
      setMessages((m) => m.map((msg, i) => (i === m.length - 1 ? fn(msg) : msg)));

    try {
      const res = await fetch(`/api/chat/${projectId}/turns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        patchLast((a) => ({ ...a, content: err.error ?? "That didn't go through." }));
        return;
      }
      for await (const { event, data } of sseEvents(res.body)) {
        if (event === "tool_start") {
          patchLast((a) => ({ ...a, toolEvents: [...(a.toolEvents ?? []), { name: data.name, ok: true, detail: data.label, running: true }] }));
        } else if (event === "tool_result") {
          patchLast((a) => ({
            ...a,
            toolEvents: (a.toolEvents ?? []).map((t, i, arr) =>
              i === arr.length - 1 && t.running ? { name: data.name, ok: data.ok, detail: data.detail, running: false } : t),
          }));
        } else if (event === "doc_updated") {
          onDocUpdate(data.document, data.html, data.css);
        } else if (event === "turn_done") {
          patchLast((a) => ({ ...a, content: data.reply }));
          onQuota(data.quota);
        } else if (event === "error") {
          patchLast((a) => ({ ...a, content: data.error }));
        }
      }
    } catch {
      patchLast((a) => ({ ...a, content: "Connection dropped — the change may still have applied. Reload to see the latest." }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-[370px] min-w-[370px] flex-col border-r border-gold/15 bg-graphite-soft">
      <div className="flex items-center justify-between border-b border-gold/10 px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-parchment/55">Conversation</span>
      </div>

      <div ref={streamRef} className="flex flex-1 flex-col gap-3.5 overflow-y-auto p-4">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="max-w-[85%] self-end rounded-[14px_14px_4px_14px] border border-gold/20 bg-gold/10 px-3 py-2 text-[13.5px] leading-snug">
              {m.content}
            </div>
          ) : (
            <div key={i} className="max-w-[92%] self-start text-[13.5px] leading-relaxed text-parchment/90">
              <div className="mb-1.5 flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Builder
              </div>
              {(m.toolEvents?.length ?? 0) > 0 && (
                <div className="my-1.5 flex flex-col gap-1">
                  {m.toolEvents!.map((t, j) => (
                    <div key={j} className="flex items-center gap-2 rounded-lg border border-gold/10 bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-parchment/60">
                      <span className={`text-gold ${t.running ? "animate-pulse" : ""}`}>{t.running ? "[ .. ]" : t.ok ? "[done]" : "[fail]"}</span>
                      <span className="text-parchment/85">{t.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.content || (busy && i === messages.length - 1 ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" /> : null)}
            </div>
          ),
        )}
        {messages.length === 0 && (
          <p className="mt-6 text-center text-sm text-parchment/45">
            Tell the builder what to change — copy, sections, style.
          </p>
        )}
      </div>

      <div className="border-t border-gold/10 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-gold/30 bg-black/35 p-2 pl-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Tell the builder what to change…"
            rows={1}
            className="max-h-[120px] min-h-[36px] w-full resize-none border-none bg-transparent py-1.5 text-[13.5px] placeholder:text-parchment/45 focus:outline-none"
          />
          <button onClick={send} disabled={busy || !input.trim()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold text-graphite disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `client/src/pages/builder.tsx`**

Add the import: `import { ChatPanel } from "@/components/builder/chat-panel";`

Add the flag inside `Builder()` (top of the component, after the state declarations):

```tsx
  // C1 feature flag: side-panel chat. ?chat=1 in any environment, or
  // VITE_CHAT_PANEL=1 at build time. Removed when C2 makes the panel default.
  const chatEnabled = typeof window !== "undefined" &&
    (new URLSearchParams(window.location.search).has("chat") || import.meta.env.VITE_CHAT_PANEL === "1");
```

Split the workspace: the current `{/* Workspace */}` div (`<div className="relative flex-1 overflow-hidden">`, line ~403) becomes the right half of a flex row. Wrap it:

```tsx
      {/* Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {chatEnabled && hasGenerated && projectId && (
          <ChatPanel
            projectId={projectId}
            onDocUpdate={(document, newHtml, newCss) => { setDoc(document); setHtml(newHtml); setCss(newCss); }}
            onQuota={() => {}}
          />
        )}
        <div className="relative flex-1 overflow-hidden">
          {/* ...existing PreviewFrame + overlays + bottom dock, unchanged... */}
        </div>
      </div>
```

Note: the panel needs a saved project (`projectId`) because turns persist per-project — if the user generated but hasn't saved, the panel is absent; that's acceptable for C1 behind the flag (C2 auto-creates the project at first generation).

- [ ] **Step 3: Typecheck + suite**

Run: `npm run check && npx vitest run`
Expected: clean + all pass.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/builder/chat-panel.tsx client/src/pages/builder.tsx
git commit -m "feat(chat): side panel UI behind ?chat=1 — transcript, live tool chips, SSE turn streaming"
```

---

### Task 8: End-to-end smoke + wrap-up

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background; port 5050)

- [ ] **Step 2: Drive a real turn**

In a browser: open `http://localhost:5050/builder?chat=1`, generate a site ("a neighborhood bakery in Phoenix"), Save it (panel requires a projectId), then in the panel: *"make the hero headline punchier and add a testimonials section with quotes from Maria and Devon"*.

Verify, in order: tool chips appear while the turn runs → the preview updates mid-turn → the assistant replies in one-two sentences → reload the page and the transcript is still there (persistence) → `git log` shows nothing dirty.

- [ ] **Step 3: Quota path** (fast check)

In an incognito window (anonymous IP bucket), burn the anonymous limit with generations, then send a mutating chat message: the agent should decline gracefully and suggest signing up — not 402, not silence.

- [ ] **Step 4: Full suite, one last time**

Run: `npx vitest run && npm run check`
Expected: everything green.

- [ ] **Step 5: Commit any smoke fixes, then stop**

The branch is ready for review/PR. Do NOT deploy: prod deploy requires the `chat-migration.sql` applied to Cloud SQL first, and the feature stays dark (flag) until C2.
