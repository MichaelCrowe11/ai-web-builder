# Agent-Native ai-webbuilder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any agent discover ai-webbuilder, pay per call in USDC over HTTP 402 (x402), and get a live website back plus a one-time claim token — additively, without touching the live human product.

**Architecture:** A new isolated `server/agent/` layer mounts a 402-native API at `/v1/agent/*`. It reuses the hardened core (`gen-limiter`, `document-gen`, `renderer`, `publish`, lead capture). Payment is gated by a `PaymentVerifier` interface (verify → do work → settle-on-success) so the concrete x402 facilitator is swappable and the "never charge for a failed build" guarantee mirrors the human path's quota-safety. Sites are created unclaimed (`userId = null`) and bound to an owner later via a hashed single-use claim token.

**Tech Stack:** TypeScript, Express, Drizzle (postgres-js) + in-memory mirror, Vitest (DI-style, injected deps — no network), x402 (USDC on Base via a facilitator REST API).

**Spec:** `docs/superpowers/specs/2026-06-02-agent-native-ai-webbuilder-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `shared/schema.ts` (modify) | Add `agentClaimTokens` table + `AgentClaimTokenRow` type. |
| `server/storage.ts` (modify) | Add claim-token + latest-document methods to `IStorage`, `MemStorage`, `PostgresStorage`. |
| `server/agent/claim-tokens.ts` (create) | Token crypto: mint (random), hash (sha256), constant-time compare. No storage. |
| `server/agent/build-service.ts` (create) | Orchestrate generate → render → create unclaimed project → publish → mint+store token. Injectable generate fn. |
| `server/agent/payments.ts` (create) | `PaymentVerifier` interface, `PaymentChallenge`/`VerifyResult` types, `FakeVerifier` (tests), `DisabledVerifier` (prod default until wallet configured). |
| `server/agent/x402-middleware.ts` (create) | `requirePayment(priceUsdc, verifier)` Express middleware: verify → 402-or-pass, attach `req.settlePayment`. |
| `server/agent/x402-verifier.ts` (create) | `X402Verifier` — real facilitator REST adapter behind `PaymentVerifier`; `makeVerifier()` factory (real if env set, else `DisabledVerifier`). |
| `server/agent/discovery.ts` (create) | `llms.txt`, `/openapi.json`, `/.well-known/x402`, `/.well-known/agent.json` handlers. |
| `server/agent/routes.ts` (create) | `registerAgentRoutes(app, deps)` — the `/v1/agent/*` endpoints. |
| `server/publish.ts` (modify) | Extract `publishProjectRecord(project)` (session-less) from the existing route; route calls it. |
| `server/routes.ts` (modify) | Call `registerAgentRoutes(app, { verifier: makeVerifier() })`. |
| `server/*.test.ts` / `server/agent/*.test.ts` | Tests colocated next to source (matches vitest `include: server/**`). |

---

## Task 1: Claim-token crypto helper

**Files:**
- Create: `server/agent/claim-tokens.ts`
- Test: `server/agent/claim-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/agent/claim-tokens.test.ts
import { describe, it, expect } from "vitest";
import { mintClaimToken, hashToken, tokensMatch } from "./claim-tokens";

describe("claim-tokens", () => {
  it("mints a high-entropy token plus its hash", () => {
    const { token, hash } = mintClaimToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes hex
    expect(hash).toMatch(/^[0-9a-f]{64}$/);  // sha256 hex
    expect(hash).not.toBe(token);            // store the hash, never the token
  });

  it("mints distinct tokens", () => {
    const a = mintClaimToken();
    const b = mintClaimToken();
    expect(a.token).not.toBe(b.token);
  });

  it("hashToken is stable and matches mint's hash", () => {
    const { token, hash } = mintClaimToken();
    expect(hashToken(token)).toBe(hash);
  });

  it("tokensMatch compares a presented token against a stored hash", () => {
    const { token, hash } = mintClaimToken();
    expect(tokensMatch(token, hash)).toBe(true);
    expect(tokensMatch("deadbeef", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/claim-tokens.test.ts`
Expected: FAIL — cannot find module `./claim-tokens`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/agent/claim-tokens.ts
// One-time claim tokens that bind an agent-built (initially unowned) site to a
// principal later. We return the raw token to the caller exactly once and store
// only its sha256 hash, so a DB read never yields a usable token.
import { randomBytes, createHash, timingSafeEqual } from "crypto";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintClaimToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, hash: hashToken(token) };
}

export function tokensMatch(presentedToken: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(presentedToken), "hex");
  const b = Buffer.from(storedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/agent/claim-tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/agent/claim-tokens.ts server/agent/claim-tokens.test.ts
git commit --no-gpg-sign -m "feat(agent): one-time claim-token crypto (hash-at-rest, single-use compare)"
```

> NOTE: `--no-gpg-sign` is used throughout this plan — the session's gpg-agent passphrase cache has expired and pinentry cannot prompt in the non-interactive shell. Drop the flag once signing is restored.

---

## Task 2: Claim-token + latest-document storage (schema + Mem + Postgres)

**Files:**
- Modify: `shared/schema.ts` (add table after `siteMedia`, ~line 162)
- Modify: `server/storage.ts` (`IStorage` ~line 67; `MemStorage` ~line 301; `PostgresStorage` ~line 521)
- Test: `server/agent/claim-store.test.ts`

- [ ] **Step 1: Add the schema table**

In `shared/schema.ts`, after the `siteMedia` block:

```typescript
// One-time claim tokens binding an agent-built site to a principal.
export const agentClaimTokens = pgTable("agent_claim_tokens", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  projectId: varchar("project_id", { length: 36 }).notNull(),
  claimedBy: varchar("claimed_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  claimedAt: timestamp("claimed_at"),
}, (t) => ({
  byProject: index("agent_claim_tokens_project_idx").on(t.projectId),
}));
export type AgentClaimTokenRow = typeof agentClaimTokens.$inferSelect;
```

- [ ] **Step 2: Write the failing test**

```typescript
// server/agent/claim-store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { MemStorage } from "../storage";

describe("claim-token storage (Mem)", () => {
  let s: MemStorage;
  beforeEach(() => { s = new MemStorage(); });

  it("creates, reads, and claims a token", async () => {
    const project = await s.createProject({ userId: null, name: "Agent Site", html: "<h1/>", css: "", prompt: "p" } as any);
    await s.createClaimToken("hash123", project.id);

    const row = await s.getClaimTokenByHash("hash123");
    expect(row?.projectId).toBe(project.id);
    expect(row?.claimedBy).toBeFalsy();

    const ok = await s.claimToken("hash123", "crowe-id:michael");
    expect(ok).toBe(true);
    const after = await s.getClaimTokenByHash("hash123");
    expect(after?.claimedBy).toBe("crowe-id:michael");
  });

  it("rejects a second claim", async () => {
    const project = await s.createProject({ userId: null, name: "X", html: "<h1/>", css: "", prompt: "p" } as any);
    await s.createClaimToken("h", project.id);
    expect(await s.claimToken("h", "a")).toBe(true);
    expect(await s.claimToken("h", "b")).toBe(false); // already claimed
  });

  it("getClaimTokenByHash returns undefined for unknown hash", async () => {
    expect(await s.getClaimTokenByHash("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/agent/claim-store.test.ts`
Expected: FAIL — `s.createClaimToken is not a function`.

- [ ] **Step 4: Add methods to the `IStorage` interface**

In `server/storage.ts`, inside `interface IStorage` (after `saveMedia`, ~line 70):

```typescript
  // Agent claim tokens
  createClaimToken(tokenHash: string, projectId: string): Promise<void>;
  getClaimTokenByHash(tokenHash: string): Promise<import("@shared/schema").AgentClaimTokenRow | undefined>;
  claimToken(tokenHash: string, claimedBy: string): Promise<boolean>;
  // Latest persisted SiteDocument for a project (for agent refine).
  getLatestDocument(projectId: string): Promise<import("./site-document-types").SiteDocument | undefined>;
```

> If `saveDocumentVersion` already has a paired getter under a different name, reuse it and skip `getLatestDocument`. (The CMS route at `server/routes.ts:269` calls `storage.saveDocumentVersion`; confirm whether a getter exists before adding a duplicate.) The import path for `SiteDocument` is `@shared/site-document` — match the existing import in `storage.ts`; the placeholder `./site-document-types` above must be replaced with the real one used in the file.

- [ ] **Step 5: Implement in `MemStorage`**

Add a field near the other Maps and methods near `saveMedia`:

```typescript
  private claimTokens = new Map<string, { projectId: string; claimedBy: string | null; createdAt: Date; claimedAt: Date | null }>();

  async createClaimToken(tokenHash: string, projectId: string): Promise<void> {
    this.claimTokens.set(tokenHash, { projectId, claimedBy: null, createdAt: new Date(), claimedAt: null });
  }
  async getClaimTokenByHash(tokenHash: string) {
    const r = this.claimTokens.get(tokenHash);
    if (!r) return undefined;
    return { tokenHash, projectId: r.projectId, claimedBy: r.claimedBy, createdAt: r.createdAt, claimedAt: r.claimedAt } as any;
  }
  async claimToken(tokenHash: string, claimedBy: string): Promise<boolean> {
    const r = this.claimTokens.get(tokenHash);
    if (!r || r.claimedBy) return false;
    r.claimedBy = claimedBy; r.claimedAt = new Date();
    return true;
  }
```

For `getLatestDocument` in `MemStorage`, return the last version saved by `saveDocumentVersion` (mirror however that map is keyed; if documents are stored in a `Map<projectId, SiteDocument[]>`, return the last element).

- [ ] **Step 6: Implement in `PostgresStorage`**

Mirror the drizzle style already in the file (`this.db`, `eq`, `and`, `desc`). Add `agentClaimTokens` to the `@shared/schema` import.

```typescript
  async createClaimToken(tokenHash: string, projectId: string): Promise<void> {
    await this.db.insert(agentClaimTokens).values({ tokenHash, projectId });
  }
  async getClaimTokenByHash(tokenHash: string) {
    const r = await this.db.select().from(agentClaimTokens).where(eq(agentClaimTokens.tokenHash, tokenHash));
    return r[0];
  }
  async claimToken(tokenHash: string, claimedBy: string): Promise<boolean> {
    const r = await this.db.update(agentClaimTokens)
      .set({ claimedBy, claimedAt: new Date() })
      .where(and(eq(agentClaimTokens.tokenHash, tokenHash), isNull(agentClaimTokens.claimedBy)))
      .returning();
    return r.length > 0; // 0 rows => unknown or already claimed
  }
```

Add `isNull` to the `drizzle-orm` import (`import { eq, and, desc, isNull } from "drizzle-orm";`). Implement `getLatestDocument` mirroring the existing `siteDocuments` select-by-version-desc query.

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run server/agent/claim-store.test.ts && npm run check`
Expected: PASS (3 tests); tsc clean.

- [ ] **Step 8: Commit**

```bash
git add shared/schema.ts server/storage.ts server/agent/claim-store.test.ts
git commit --no-gpg-sign -m "feat(agent): claim-token table + storage (Mem+Postgres), atomic single-claim"
```

---

## Task 3: Extract a session-less publish helper

**Files:**
- Modify: `server/publish.ts` (`registerPublishRoutes` route body ~line 65–104)
- Test: `server/agent/publish-core.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/agent/publish-core.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { MemStorage } from "../storage";
import { publishProjectRecord } from "../publish";

describe("publishProjectRecord", () => {
  let s: MemStorage;
  beforeEach(() => { s = new MemStorage(); });

  it("assigns a slug, marks published, returns a public url", async () => {
    const p = await s.createProject({ userId: null, name: "Joe's Cafe", html: "<h1/>", css: "", prompt: "x" } as any);
    const r = await publishProjectRecord(p, s);
    expect(r.slug).toMatch(/^joe-s-cafe/);
    expect(r.publishedUrl).toContain(r.slug);
    const reloaded = await s.getProject(p.id);
    expect(reloaded?.isPublished).toBe(true);
  });
});
```

> `publishProjectRecord` takes the storage as a parameter so it is testable with `MemStorage` and reusable by the agent layer. The module-level `storage` singleton remains the default for the existing route.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/publish-core.test.ts`
Expected: FAIL — `publishProjectRecord` is not exported.

- [ ] **Step 3: Extract the helper and rewire the route**

In `server/publish.ts`, add (and export) above `registerPublishRoutes`:

```typescript
import { storage as defaultStorage } from "./storage";
import type { IStorage } from "./storage";

// Session-less publish core: assign a unique slug, mark published, return the
// public URL. Shared by the human publish route and the agent build service.
export async function publishProjectRecord(
  project: Project,
  store: IStorage = defaultStorage,
): Promise<{ slug: string; publishedUrl: string; project: Project }> {
  const slug = await uniqueSlugWith(store, project.name, project.slug ?? null);
  const publishedUrl = `https://${slug}.${PUBLISH_DOMAIN}`;
  const updated = await store.updateProject(project.id, { slug, isPublished: true, publishedUrl });
  return { slug, publishedUrl, project: updated ?? project };
}
```

Generalize the existing private `uniqueSlug` to take a store (rename to `uniqueSlugWith(store, name, currentSlug)` using `store.getProjectBySlug`), and have the original `uniqueSlug` call it with `defaultStorage` if still referenced. Then change the route body to:

```typescript
      const { slug, publishedUrl, project: updated } = await publishProjectRecord(
        // anonymous projects get claimed by the session on first publish:
        project.userId ? project : { ...project, userId: req.session.userId } as Project,
      );
```

(Preserve the existing 404/403 ownership checks above this line unchanged.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run server/agent/publish-core.test.ts && npm run check`
Expected: PASS; tsc clean. Also run the full suite to confirm the human publish path still works: `npx vitest run`.

- [ ] **Step 5: Commit**

```bash
git add server/publish.ts server/agent/publish-core.test.ts
git commit --no-gpg-sign -m "refactor(publish): extract session-less publishProjectRecord, reuse in route"
```

---

## Task 4: Build service (generate → render → unclaimed project → publish → token)

**Files:**
- Create: `server/agent/build-service.ts`
- Test: `server/agent/build-service.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/agent/build-service.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemStorage } from "../storage";
import { buildAndPublishSite } from "./build-service";
import type { SiteDocument } from "@shared/site-document";

const fakeDoc = { meta: { name: "Acme Co" } } as unknown as SiteDocument;

describe("buildAndPublishSite", () => {
  let s: MemStorage;
  beforeEach(() => { s = new MemStorage(); });

  it("generates, publishes unclaimed, returns url + claim token + document", async () => {
    const generate = vi.fn().mockResolvedValue(fakeDoc);
    const r = await buildAndPublishSite("a cafe site", { storage: s, generate });

    expect(generate).toHaveBeenCalledWith("a cafe site");
    expect(r.document).toBe(fakeDoc);
    expect(r.siteUrl).toContain(r.slug);
    expect(r.claimToken).toMatch(/^[0-9a-f]{64}$/);

    const project = await s.getProject(r.projectId);
    expect(project?.userId).toBeNull();      // unclaimed
    expect(project?.isPublished).toBe(true);

    // the token is stored hashed, not raw
    const { hashToken } = await import("./claim-tokens");
    const row = await s.getClaimTokenByHash(hashToken(r.claimToken));
    expect(row?.projectId).toBe(r.projectId);
  });

  it("propagates an AtCapacityError from the limiter without creating a project", async () => {
    const { AtCapacityError } = await import("../gen-limiter");
    const generate = vi.fn().mockRejectedValue(new AtCapacityError(8000));
    await expect(buildAndPublishSite("x", { storage: s, generate })).rejects.toBeInstanceOf(AtCapacityError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/build-service.test.ts`
Expected: FAIL — cannot find `./build-service`.

- [ ] **Step 3: Write the implementation**

```typescript
// server/agent/build-service.ts
// Orchestrates a full agent build: generate a SiteDocument, render it, persist
// it as an UNCLAIMED project, publish it, and mint a one-time claim token.
// The generation call is injectable so tests run without Azure; production wraps
// generateDocument in runLimited so the agent path shares the human path's
// concurrency ceiling (agents are bursty — this matters more, not less).
import type { IStorage } from "../storage";
import type { SiteDocument } from "@shared/site-document";
import { runLimited } from "../gen-limiter";
import { generateDocument } from "../document-gen";
import { renderDocumentBody, renderDocumentCss } from "../renderer";
import { publishProjectRecord } from "../publish";
import { mintClaimToken } from "./claim-tokens";

export interface BuildDeps {
  storage: IStorage;
  generate?: (prompt: string) => Promise<SiteDocument>; // default: limiter-wrapped generateDocument
}

export interface BuildResult {
  projectId: string;
  slug: string;
  siteUrl: string;
  claimToken: string;
  document: SiteDocument;
}

export async function buildAndPublishSite(prompt: string, deps: BuildDeps): Promise<BuildResult> {
  const generate = deps.generate ?? ((p: string) => runLimited(() => generateDocument(p)));
  const document = await generate(prompt); // throws AtCapacityError BEFORE any DB write

  const project = await deps.storage.createProject({
    userId: null,
    name: document.meta?.name ?? "Agent Site",
    html: renderDocumentBody(document),
    css: renderDocumentCss(document),
    prompt,
  } as any);

  // Persist the doc so a later refine can load it (mirrors the human CMS path).
  await deps.storage.saveDocumentVersion(project.id, document);

  const { slug, publishedUrl } = await publishProjectRecord(project, deps.storage);

  const { token, hash } = mintClaimToken();
  await deps.storage.createClaimToken(hash, project.id);

  return { projectId: project.id, slug, siteUrl: publishedUrl, claimToken: token, document };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/agent/build-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/agent/build-service.ts server/agent/build-service.test.ts
git commit --no-gpg-sign -m "feat(agent): build service — generate/render/publish unclaimed site + mint token"
```

---

## Task 5: Payment verifier interface + Fake + Disabled

**Files:**
- Create: `server/agent/payments.ts`
- Test: `server/agent/payments.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/agent/payments.test.ts
import { describe, it, expect } from "vitest";
import { FakeVerifier, DisabledVerifier } from "./payments";

function reqWith(header?: string): any {
  return { header: (k: string) => (k.toLowerCase() === "x-payment" ? header : undefined) };
}

describe("FakeVerifier", () => {
  it("challenge carries price + pay-to + resource", () => {
    const v = new FakeVerifier();
    const c = v.challenge(1.5, "/v1/agent/sites");
    expect(c.priceUsdc).toBe(1.5);
    expect(c.payTo).toBeTruthy();
    expect(c.resource).toBe("/v1/agent/sites");
  });
  it("verify returns null when no payment header (=> 402)", async () => {
    const v = new FakeVerifier();
    expect(await v.verify(reqWith(undefined), 1)).toBeNull();
  });
  it("verify returns a result when the magic header is present; settle records it", async () => {
    const v = new FakeVerifier();
    const result = await v.verify(reqWith("fake-ok"), 1);
    expect(result).not.toBeNull();
    expect(v.settled).toBe(0);
    await v.settle(result!);
    expect(v.settled).toBe(1);
  });
});

describe("DisabledVerifier", () => {
  it("verify always returns null (no free sites when unconfigured)", async () => {
    const v = new DisabledVerifier();
    expect(await v.verify(reqWith("fake-ok"), 1)).toBeNull();
  });
  it("challenge says unavailable", () => {
    expect(new DisabledVerifier().challenge(1, "/x").unavailable).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/payments.test.ts`
Expected: FAIL — cannot find `./payments`.

- [ ] **Step 3: Write the implementation**

```typescript
// server/agent/payments.ts
// Payment abstraction for the agent API. The middleware calls verify() to gate a
// request and settle() ONLY after the work succeeds — so a failed build never
// charges the agent. Concrete x402 lives in x402-verifier.ts behind this interface.
import type { Request } from "express";

export interface PaymentChallenge {
  priceUsdc: number;
  payTo: string;
  resource: string;
  network?: string;     // e.g. "base"
  asset?: string;       // USDC contract address
  unavailable?: boolean; // DisabledVerifier => respond "payments not configured"
}

export interface VerifyResult {
  // Opaque proof handed back to settle(). Shape is verifier-specific.
  proof: unknown;
  priceUsdc: number;
}

export interface PaymentVerifier {
  challenge(priceUsdc: number, resource: string): PaymentChallenge;
  verify(req: Request, priceUsdc: number): Promise<VerifyResult | null>; // null => unpaid
  settle(result: VerifyResult): Promise<void>;
}

// TEST-ONLY verifier. Accepts the header `X-PAYMENT: fake-ok`. Never wired in prod.
export class FakeVerifier implements PaymentVerifier {
  settled = 0;
  challenge(priceUsdc: number, resource: string): PaymentChallenge {
    return { priceUsdc, payTo: "0xFAKE", resource, network: "base", asset: "USDC" };
  }
  async verify(req: Request, priceUsdc: number): Promise<VerifyResult | null> {
    return req.header("x-payment") === "fake-ok" ? { proof: "fake", priceUsdc } : null;
  }
  async settle(_result: VerifyResult): Promise<void> { this.settled += 1; }
}

// PROD DEFAULT until a wallet/facilitator is configured: refuses every request so
// the service never gives away a free site. Replaced by X402Verifier when env is set.
export class DisabledVerifier implements PaymentVerifier {
  challenge(priceUsdc: number, resource: string): PaymentChallenge {
    return { priceUsdc, payTo: "", resource, unavailable: true };
  }
  async verify(): Promise<VerifyResult | null> { return null; }
  async settle(): Promise<void> { /* never reached */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/agent/payments.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/agent/payments.ts server/agent/payments.test.ts
git commit --no-gpg-sign -m "feat(agent): PaymentVerifier interface + Fake (tests) + Disabled (prod default)"
```

---

## Task 6: x402 payment middleware (verify → 402-or-pass → attach settle)

**Files:**
- Create: `server/agent/x402-middleware.ts`
- Test: `server/agent/x402-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/agent/x402-middleware.test.ts
import { describe, it, expect, vi } from "vitest";
import { requirePayment } from "./x402-middleware";
import { FakeVerifier, DisabledVerifier } from "./payments";

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.set = (k: string, v: string) => { res.headers[k] = v; return res; };
  return res;
}
function mockReq(header?: string): any {
  return { header: (k: string) => (k.toLowerCase() === "x-payment" ? header : undefined) };
}

describe("requirePayment", () => {
  it("returns 402 + challenge when unpaid", async () => {
    const mw = requirePayment(() => 1.0, new FakeVerifier());
    const res = mockRes(); const next = vi.fn();
    await mw(mockReq(undefined), res, next);
    expect(res.statusCode).toBe(402);
    expect(res.body.accepts?.[0]?.maxAmountRequired).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next and attaches settlePayment when paid", async () => {
    const verifier = new FakeVerifier();
    const mw = requirePayment(() => 1.0, verifier);
    const req = mockReq("fake-ok"); const res = mockRes(); const next = vi.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(typeof req.settlePayment).toBe("function");
    expect(verifier.settled).toBe(0);       // not settled yet — route settles on success
    await req.settlePayment();
    expect(verifier.settled).toBe(1);
  });

  it("returns 503 payments-unavailable for DisabledVerifier", async () => {
    const mw = requirePayment(() => 1.0, new DisabledVerifier());
    const res = mockRes(); const next = vi.fn();
    await mw(mockReq("fake-ok"), res, next);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toBe("payments_unavailable");
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/x402-middleware.test.ts`
Expected: FAIL — cannot find `./x402-middleware`.

- [ ] **Step 3: Write the implementation**

```typescript
// server/agent/x402-middleware.ts
// Gate a route on payment. On an unpaid request, emit HTTP 402 with the x402
// "accepts" payment-requirements array. On a paid request, attach req.settlePayment
// so the ROUTE can capture funds only after the work succeeds.
import type { Request, Response, NextFunction } from "express";
import type { PaymentVerifier } from "./payments";

declare module "express-serve-static-core" {
  interface Request { settlePayment?: () => Promise<void>; }
}

export function requirePayment(priceFor: (req: Request) => number, verifier: PaymentVerifier) {
  return async function paymentGate(req: Request, res: Response, next: NextFunction) {
    const price = priceFor(req);
    const challenge = verifier.challenge(price, req.path);

    if (challenge.unavailable) {
      return res.status(503).json({ error: "payments_unavailable" });
    }

    const result = await verifier.verify(req, price);
    if (!result) {
      // x402-standard 402 body: an `accepts` array of payment requirements.
      return res.status(402).json({
        x402Version: 1,
        accepts: [{
          scheme: "exact",
          network: challenge.network ?? "base",
          asset: challenge.asset ?? "USDC",
          payTo: challenge.payTo,
          maxAmountRequired: String(price),
          resource: challenge.resource,
        }],
      });
    }

    req.settlePayment = () => verifier.settle(result);
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/agent/x402-middleware.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/agent/x402-middleware.ts server/agent/x402-middleware.test.ts
git commit --no-gpg-sign -m "feat(agent): x402 payment-gate middleware (402 accepts, settle-deferred-to-route)"
```

---

## Task 7: Agent routes + register in the app

**Files:**
- Create: `server/agent/routes.ts`
- Modify: `server/routes.ts` (import + call `registerAgentRoutes`, ~line 44 near `registerPublishRoutes`)
- Test: `server/agent/routes.test.ts`

- [ ] **Step 1: Write the failing test (route logic via injected deps, no network)**

```typescript
// server/agent/routes.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { MemStorage } from "../storage";
import { FakeVerifier } from "./payments";
import { registerAgentRoutes } from "./routes";
import type { SiteDocument } from "@shared/site-document";

const fakeDoc = { meta: { name: "Acme" } } as unknown as SiteDocument;

function appWith(storage: MemStorage, verifier: FakeVerifier, generate: any) {
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app, { storage, verifier, generate, prices: { build: 1, refine: 0.25 } });
  return app;
}

async function call(app: any, method: string, path: string, headers: Record<string,string> = {}, body?: any) {
  // minimal in-process driver
  const { createServer } = await import("http");
  const server = createServer(app).listen(0);
  const port = (server.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  server.close();
  return { status: res.status, json };
}

describe("agent routes", () => {
  let storage: MemStorage; let verifier: FakeVerifier; let generate: any;
  beforeEach(() => { storage = new MemStorage(); verifier = new FakeVerifier(); generate = vi.fn().mockResolvedValue(fakeDoc); });

  it("POST /v1/agent/sites unpaid -> 402", async () => {
    const app = appWith(storage, verifier, generate);
    const r = await call(app, "POST", "/v1/agent/sites", {}, { prompt: "cafe" });
    expect(r.status).toBe(402);
    expect(verifier.settled).toBe(0);
  });

  it("POST /v1/agent/sites paid -> 200 url+token+doc, settles once", async () => {
    const app = appWith(storage, verifier, generate);
    const r = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    expect(r.status).toBe(200);
    expect(r.json.siteUrl).toContain(r.json.slug);
    expect(r.json.claimToken).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier.settled).toBe(1);
  });

  it("at-capacity -> 503 and DOES NOT settle (no charge for a failed build)", async () => {
    const { AtCapacityError } = await import("../gen-limiter");
    generate = vi.fn().mockRejectedValue(new AtCapacityError(8000));
    const app = appWith(storage, verifier, generate);
    const r = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("at_capacity");
    expect(verifier.settled).toBe(0);
  });

  it("claim binds ownership; second claim 409", async () => {
    const app = appWith(storage, verifier, generate);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    const id = built.json.projectId;
    const ok = await call(app, "POST", `/v1/agent/sites/${id}/claim`, {}, { token: built.json.claimToken, identity: "crowe-id:mike" });
    expect(ok.status).toBe(200);
    const again = await call(app, "POST", `/v1/agent/sites/${id}/claim`, {}, { token: built.json.claimToken, identity: "crowe-id:mike" });
    expect(again.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/routes.test.ts`
Expected: FAIL — cannot find `./routes`.

- [ ] **Step 3: Write the implementation**

```typescript
// server/agent/routes.ts
// The 402-native agent API mounted at /v1/agent/*. No sessions, no quota — payment
// is the access control. Settlement happens only after the work succeeds.
import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import type { SiteDocument } from "@shared/site-document";
import { AtCapacityError, makeCapacityPayload, runLimited } from "../gen-limiter";
import { generateDocument, refineDocument } from "../document-gen";
import { renderDocumentBody, renderDocumentCss } from "../renderer";
import { buildAndPublishSite } from "./build-service";
import { requirePayment } from "./x402-middleware";
import { tokensMatch } from "./claim-tokens";
import type { PaymentVerifier } from "./payments";

export interface AgentDeps {
  storage: IStorage;
  verifier: PaymentVerifier;
  generate?: (prompt: string) => Promise<SiteDocument>;
  prices: { build: number; refine: number };
}

function sendCapacity(res: Response, err: AtCapacityError) {
  const { retryAfterSeconds, body } = makeCapacityPayload(err);
  res.set("Retry-After", String(retryAfterSeconds));
  return res.status(503).json(body);
}

export function registerAgentRoutes(app: Express, deps: AgentDeps) {
  const { storage, verifier, prices } = deps;

  // Build + publish a site in one paid call.
  app.post("/v1/agent/sites", requirePayment(() => prices.build, verifier), async (req: Request, res: Response) => {
    const prompt = req.body?.prompt;
    if (!prompt || typeof prompt !== "string") return res.status(400).json({ error: "prompt required" });
    try {
      const result = await buildAndPublishSite(prompt, { storage, generate: deps.generate });
      await req.settlePayment!();   // capture funds ONLY after success
      return res.json({
        projectId: result.projectId, slug: result.slug,
        siteUrl: result.siteUrl, claimToken: result.claimToken, document: result.document,
      });
    } catch (err: any) {
      if (err instanceof AtCapacityError) return sendCapacity(res, err); // no settle
      return res.status(500).json({ error: "build_failed", detail: err.message }); // no settle
    }
  });

  // Paid scoped refine of an existing agent site.
  app.post("/v1/agent/sites/:id/refine", requirePayment(() => prices.refine, verifier), async (req: Request, res: Response) => {
    const instruction = req.body?.instruction;
    if (!instruction) return res.status(400).json({ error: "instruction required" });
    const doc = await storage.getLatestDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: "site_not_found" });
    try {
      const refined = await runLimited(() => refineDocument(doc, instruction));
      await storage.updateProject(req.params.id, { html: renderDocumentBody(refined), css: renderDocumentCss(refined) });
      await storage.saveDocumentVersion(req.params.id, refined);
      await req.settlePayment!();
      return res.json({ projectId: req.params.id, document: refined });
    } catch (err: any) {
      if (err instanceof AtCapacityError) return sendCapacity(res, err);
      return res.status(500).json({ error: "refine_failed", detail: err.message });
    }
  });

  // Claim a site (bind ownership). Free.
  app.post("/v1/agent/sites/:id/claim", async (req: Request, res: Response) => {
    const { token, identity } = req.body ?? {};
    if (!token || !identity) return res.status(400).json({ error: "token and identity required" });
    const row = await storage.getClaimTokenByHash(/* find by project */ "");
    // Look up by project; verify the presented token matches the stored hash.
    const byProject = await storage.getClaimTokenByHash((await tokenHashForProject(storage, req.params.id)) ?? "");
    if (!byProject || byProject.projectId !== req.params.id) return res.status(404).json({ error: "no_claim_token" });
    if (!tokensMatch(token, byProject.tokenHash)) return res.status(403).json({ error: "bad_token" });
    const ok = await storage.claimToken(byProject.tokenHash, identity);
    if (!ok) return res.status(409).json({ error: "already_claimed" });
    await storage.updateProject(req.params.id, { userId: identity } as any);
    return res.json({ ok: true, projectId: req.params.id, owner: identity });
  });

  // Read a site (free).
  app.get("/v1/agent/sites/:id", async (req: Request, res: Response) => {
    const p = await storage.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: "site_not_found" });
    return res.json({ projectId: p.id, slug: p.slug, siteUrl: p.publishedUrl, isPublished: p.isPublished });
  });
}
```

> The claim lookup above is awkward because `getClaimTokenByHash` keys by hash, not project. FIX during implementation: add a `getClaimTokenByProject(projectId)` storage method (mirrors `getClaimTokenByHash`, queries by `project_id`) in Task 2's storage work and use it here instead of the `tokenHashForProject` stand-in. Update Task 2's interface + Mem + Postgres accordingly, and delete the dead `getClaimTokenByHash("")` line. The test in Step 1 already exercises claim by `projectId`, so this surfaces immediately.

- [ ] **Step 4: Register in the app**

In `server/routes.ts`, near `registerPublishRoutes(app);` (~line 44):

```typescript
import { registerAgentRoutes } from "./agent/routes";
import { makeVerifier } from "./agent/x402-verifier";
// ...
  registerAgentRoutes(app, {
    storage,
    verifier: makeVerifier(),
    prices: {
      build: Number(process.env.AGENT_PRICE_BUILD_USDC ?? "1"),
      refine: Number(process.env.AGENT_PRICE_REFINE_USDC ?? "0.25"),
    },
  });
```

(`makeVerifier` is created in Task 8; until then, temporarily pass `new DisabledVerifier()` so the app compiles.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run server/agent/routes.test.ts && npm run check`
Expected: PASS (4 tests); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add server/agent/routes.ts server/routes.ts server/agent/routes.test.ts server/storage.ts shared/schema.ts
git commit --no-gpg-sign -m "feat(agent): /v1/agent/* routes (build/refine/claim/read), settle-on-success"
```

---

## Task 8: Real x402 verifier (facilitator adapter) + factory

**Files:**
- Create: `server/agent/x402-verifier.ts`
- Test: `server/agent/x402-verifier.test.ts`

> BEFORE writing: confirm the current x402 facilitator REST contract (request/response field names for `/verify` and `/settle`, and the `accepts`/`X-PAYMENT` payload shape) via the context7 MCP (`x402` docs) or the official x402 docs. The `PaymentVerifier` interface isolates any drift — only this file changes.

- [ ] **Step 1: Write the failing test (inject a fake fetch)**

```typescript
// server/agent/x402-verifier.test.ts
import { describe, it, expect, vi } from "vitest";
import { X402Verifier } from "./x402-verifier";

function reqWith(payment?: string): any {
  return { header: (k: string) => (k.toLowerCase() === "x-payment" ? payment : undefined), path: "/v1/agent/sites" };
}

describe("X402Verifier", () => {
  const cfg = { payTo: "0xabc", facilitatorUrl: "https://facil.test", network: "base", asset: "USDC" };

  it("challenge carries configured payTo/network/asset", () => {
    const v = new X402Verifier(cfg, vi.fn());
    const c = v.challenge(1.0, "/v1/agent/sites");
    expect(c.payTo).toBe("0xabc");
    expect(c.network).toBe("base");
  });

  it("verify returns null when no X-PAYMENT header (no facilitator call)", async () => {
    const fetchImpl = vi.fn();
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith(undefined), 1)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verify posts to /verify and returns a result on isValid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: true }) });
    const v = new X402Verifier(cfg, fetchImpl);
    const r = await v.verify(reqWith("PROOF"), 1);
    expect(r).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith("https://facil.test/verify", expect.objectContaining({ method: "POST" }));
  });

  it("verify returns null when facilitator says invalid", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isValid: false }) });
    const v = new X402Verifier(cfg, fetchImpl);
    expect(await v.verify(reqWith("PROOF"), 1)).toBeNull();
  });

  it("settle posts to /settle", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const v = new X402Verifier(cfg, fetchImpl);
    await v.settle({ proof: "PROOF", priceUsdc: 1 });
    expect(fetchImpl).toHaveBeenCalledWith("https://facil.test/settle", expect.objectContaining({ method: "POST" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/x402-verifier.test.ts`
Expected: FAIL — cannot find `./x402-verifier`.

- [ ] **Step 3: Write the implementation**

```typescript
// server/agent/x402-verifier.ts
// Concrete x402 verifier: talks to an x402 facilitator's REST API to verify and
// settle USDC payments. Field names follow the x402 facilitator contract — CONFIRM
// against current x402 docs at implementation time; this file is the only thing
// that changes if the contract differs.
import type { Request } from "express";
import type { PaymentVerifier, PaymentChallenge, VerifyResult } from "./payments";
import { DisabledVerifier } from "./payments";

export interface X402Config {
  payTo: string;
  facilitatorUrl: string;
  network: string; // "base"
  asset: string;   // "USDC"
}

type FetchLike = (url: string, init: any) => Promise<{ ok: boolean; json: () => Promise<any> }>;

export class X402Verifier implements PaymentVerifier {
  constructor(private cfg: X402Config, private fetchImpl: FetchLike = fetch as any) {}

  challenge(priceUsdc: number, resource: string): PaymentChallenge {
    return { priceUsdc, payTo: this.cfg.payTo, resource, network: this.cfg.network, asset: this.cfg.asset };
  }

  async verify(req: Request, priceUsdc: number): Promise<VerifyResult | null> {
    const payment = req.header("x-payment");
    if (!payment) return null;
    const requirements = {
      scheme: "exact", network: this.cfg.network, asset: this.cfg.asset,
      payTo: this.cfg.payTo, maxAmountRequired: String(priceUsdc), resource: req.path,
    };
    const r = await this.fetchImpl(`${this.cfg.facilitatorUrl}/verify`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload: payment, paymentRequirements: requirements }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.isValid ? { proof: payment, priceUsdc } : null;
  }

  async settle(result: VerifyResult): Promise<void> {
    const r = await this.fetchImpl(`${this.cfg.facilitatorUrl}/settle`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload: result.proof, priceUsdc: result.priceUsdc }),
    });
    if (!r.ok) throw new Error("x402 settle failed");
  }
}

// Factory: real verifier when fully configured, else DisabledVerifier (never give
// away free sites). Logged once at boot so the operator knows which mode is live.
export function makeVerifier(): PaymentVerifier {
  const payTo = process.env.X402_PAY_TO_ADDRESS;
  const facilitatorUrl = process.env.X402_FACILITATOR_URL;
  if (payTo && facilitatorUrl) {
    return new X402Verifier({
      payTo, facilitatorUrl,
      network: process.env.X402_NETWORK ?? "base",
      asset: process.env.X402_ASSET ?? "USDC",
    });
  }
  console.log("[agent] x402 not configured (X402_PAY_TO_ADDRESS/X402_FACILITATOR_URL unset) — agent payments DISABLED");
  return new DisabledVerifier();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/agent/x402-verifier.test.ts && npm run check`
Expected: PASS (5 tests); tsc clean. Replace the temporary `new DisabledVerifier()` in `server/routes.ts` (Task 7 Step 4) with `makeVerifier()`.

- [ ] **Step 5: Commit**

```bash
git add server/agent/x402-verifier.ts server/agent/x402-verifier.test.ts server/routes.ts
git commit --no-gpg-sign -m "feat(agent): real x402 facilitator adapter + makeVerifier factory (disabled until env set)"
```

---

## Task 9: Discovery surfaces (llms.txt, OpenAPI, .well-known)

**Files:**
- Create: `server/agent/discovery.ts`
- Modify: `server/agent/routes.ts` (call `registerDiscoveryRoutes(app, prices, payTo)` at the end of `registerAgentRoutes`)
- Test: `server/agent/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// server/agent/discovery.test.ts
import { describe, it, expect } from "vitest";
import { buildDiscovery } from "./discovery";

describe("discovery payloads", () => {
  const d = buildDiscovery({ build: 1, refine: 0.25 }, "0xabc", "https://ai-webbuilder.com");

  it("llms.txt mentions the build endpoint and payment", () => {
    expect(d.llmsTxt).toContain("/v1/agent/sites");
    expect(d.llmsTxt.toLowerCase()).toContain("x402");
  });
  it("openapi declares the build path", () => {
    expect(d.openapi.paths["/v1/agent/sites"]?.post).toBeDefined();
  });
  it(".well-known/x402 lists priced endpoints + payTo", () => {
    expect(d.x402.payTo).toBe("0xabc");
    const build = d.x402.endpoints.find((e: any) => e.path === "/v1/agent/sites");
    expect(build.priceUsdc).toBe(1);
  });
  it("agent.json carries name + capabilities", () => {
    expect(d.agentJson.name).toBeTruthy();
    expect(Array.isArray(d.agentJson.capabilities)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/agent/discovery.test.ts`
Expected: FAIL — cannot find `./discovery`.

- [ ] **Step 3: Write the implementation**

```typescript
// server/agent/discovery.ts
// Machine-discovery surfaces so agents (and x402 directories) find and price the
// service with no human: llms.txt, OpenAPI, /.well-known/x402, /.well-known/agent.json.
import type { Express } from "express";

export function buildDiscovery(prices: { build: number; refine: number }, payTo: string, baseUrl: string) {
  const llmsTxt = `# ai-webbuilder (agent API)
Build and publish a real website from a prompt. Pay per call in USDC over HTTP 402 (x402).

## Endpoints
- POST /v1/agent/sites — build+publish a site. Price: ${prices.build} USDC. Returns { siteUrl, claimToken, document }.
- POST /v1/agent/sites/:id/refine — scoped edit. Price: ${prices.refine} USDC.
- POST /v1/agent/sites/:id/claim — bind ownership with the claimToken. Free.
- GET  /v1/agent/sites/:id — read site status. Free.

## Payment
x402 (scheme "exact", network base, asset USDC), payTo ${payTo}.
Unpaid requests return HTTP 402 with an \`accepts\` payment-requirements array.
`;

  const openapi = {
    openapi: "3.0.0",
    info: { title: "ai-webbuilder agent API", version: "1.0.0" },
    servers: [{ url: baseUrl }],
    paths: {
      "/v1/agent/sites": {
        post: {
          summary: "Build and publish a website (paid via x402)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] } } } },
          responses: { "200": { description: "site built" }, "402": { description: "payment required" }, "503": { description: "at capacity / payments unavailable" } },
        },
      },
    },
  };

  const x402 = {
    x402Version: 1,
    payTo,
    network: "base",
    asset: "USDC",
    endpoints: [
      { path: "/v1/agent/sites", method: "POST", priceUsdc: prices.build },
      { path: "/v1/agent/sites/:id/refine", method: "POST", priceUsdc: prices.refine },
    ],
  };

  const agentJson = {
    name: "ai-webbuilder",
    description: "Prompt-to-website builder. Agents pay per call in USDC and get a live site + claim token.",
    capabilities: ["build_site", "refine_site", "claim_site"],
    auth: { type: "x402", network: "base", asset: "USDC" },
    discovery: { openapi: "/openapi.json", llms: "/llms.txt", x402: "/.well-known/x402" },
  };

  return { llmsTxt, openapi, x402, agentJson };
}

export function registerDiscoveryRoutes(app: Express, prices: { build: number; refine: number }, payTo: string) {
  const baseUrl = process.env.APP_URL ?? "https://ai-webbuilder.com";
  const d = buildDiscovery(prices, payTo, baseUrl);
  app.get("/llms.txt", (_req, res) => res.type("text/plain").send(d.llmsTxt));
  app.get("/openapi.json", (_req, res) => res.json(d.openapi));
  app.get("/.well-known/x402", (_req, res) => res.json(d.x402));
  app.get("/.well-known/agent.json", (_req, res) => res.json(d.agentJson));
}
```

- [ ] **Step 4: Wire it into `registerAgentRoutes`**

At the end of `registerAgentRoutes` in `server/agent/routes.ts`:

```typescript
  registerDiscoveryRoutes(app, prices, /* payTo */ process.env.X402_PAY_TO_ADDRESS ?? "");
```

(Add `import { registerDiscoveryRoutes } from "./discovery";` at the top.)

- [ ] **Step 5: Run tests + typecheck + full suite**

Run: `npx vitest run server/agent/discovery.test.ts && npm run check && npx vitest run`
Expected: PASS; tsc clean; full suite green.

- [ ] **Step 6: Commit**

```bash
git add server/agent/discovery.ts server/agent/routes.ts server/agent/discovery.test.ts
git commit --no-gpg-sign -m "feat(agent): discovery surfaces — llms.txt, OpenAPI, .well-known/{x402,agent.json}"
```

---

## Task 10: Migration, env, deploy, smoke test

**Files:**
- Create: `script/agent-migration.sql`
- Deploy: Railway `web` service

- [ ] **Step 1: Write the additive migration**

```sql
-- script/agent-migration.sql
CREATE TABLE IF NOT EXISTS agent_claim_tokens (
  token_hash  varchar(64) PRIMARY KEY,
  project_id  varchar(36) NOT NULL,
  claimed_by  varchar(255),
  created_at  timestamp DEFAULT now(),
  claimed_at  timestamp
);
CREATE INDEX IF NOT EXISTS agent_claim_tokens_project_idx ON agent_claim_tokens (project_id);
```

- [ ] **Step 2: Apply against prod Postgres (NEVER drizzle-kit push)**

```bash
PUB=$(railway variables -s Postgres --kv | sed -n 's/^DATABASE_PUBLIC_URL=//p')
psql "$PUB" -f script/agent-migration.sql
psql "$PUB" -c "\d agent_claim_tokens"
```

Expected: table + index created; `\d` shows the 5 columns.

- [ ] **Step 3: Set prices on the web service (payments stay DISABLED until wallet exists)**

```bash
railway variables --service web \
  --set "AGENT_PRICE_BUILD_USDC=1" \
  --set "AGENT_PRICE_REFINE_USDC=0.25"
```

Leave `X402_PAY_TO_ADDRESS` / `X402_FACILITATOR_URL` UNSET — `makeVerifier()` returns `DisabledVerifier`, so paid routes return `503 payments_unavailable` (no free sites) while discovery is fully live.

- [ ] **Step 4: Deploy**

```bash
git push origin feat/agent-native   # or rely on railway up (web has no repo trigger)
railway up --service web --detach
```

Wait for Online (poll `railway status`).

- [ ] **Step 5: Smoke test the live agent surface**

```bash
BASE=https://ai-webbuilder.com
curl -s -o /dev/null -w "llms.txt %{http_code}\n"        $BASE/llms.txt
curl -s -o /dev/null -w "openapi %{http_code}\n"          $BASE/openapi.json
curl -s "$BASE/.well-known/x402" | head -c 400; echo
# unpaid build -> 402 (or 503 payments_unavailable until wallet configured):
curl -s -o /dev/null -w "build(unpaid) %{http_code}\n" -X POST $BASE/v1/agent/sites \
  -H 'content-type: application/json' -d '{"prompt":"a cafe"}'
```

Expected: `llms.txt 200`, `openapi 200`, x402 manifest JSON, build(unpaid) `402` if a wallet is configured or `503` while disabled.

- [ ] **Step 6: Commit the migration script**

```bash
git add script/agent-migration.sql
git commit --no-gpg-sign -m "chore(agent): additive agent_claim_tokens migration + deploy notes"
```

- [ ] **Step 7: Update memory**

Append to `project_ai_webbuilder.md`: agent-native surface shipped (x402, claimable, parallel layer), what's live vs disabled, and the one remaining manual gate (USDC-on-Base wallet + facilitator → set `X402_*` to flip payments on).

---

## Manual gate (after the plan)

Nothing charges or completes a real payment until a **USDC receiving wallet on Base + an x402 facilitator** exist. Configure `X402_PAY_TO_ADDRESS`, `X402_FACILITATOR_URL` (+ optional `X402_NETWORK`/`X402_ASSET`) on the `web` service; `makeVerifier()` then swaps `DisabledVerifier` → `X402Verifier` with no code change. Until then, discovery is live and paid routes honestly return `503 payments_unavailable`.

---

## Self-review

**Spec coverage:**
- 402-native API (`/v1/agent/sites`, refine, claim, read, leads) → Tasks 7 (+ leads noted below). ✓
- x402 payment + verify→settle-on-success → Tasks 5, 6, 7 (route settles only after success; at-capacity/throw paths assert no settle). ✓
- Claimable (URL + one-time token, bind later) → Tasks 1, 2, 4, 7. ✓
- Additive parallel layer reusing core → all `server/agent/*`; only additive edits to `publish.ts`/`routes.ts`/`schema.ts`/`storage.ts`. ✓
- Discovery surfaces → Task 9. ✓
- Payment-safety invariant (never charge on failure) → Tasks 7 tests (503/throw ⇒ `settled === 0`). ✓
- `gen-limiter` reuse → Task 4 (`runLimited` default) + Task 7 refine. ✓
- Migration via psql, never drizzle-kit push → Task 10. ✓
- Manual wallet gate → Task 8 factory + Task 10 + closing section. ✓
- **Gap — `GET /v1/agent/sites/:id/leads`:** specified but not given its own task. ADD as a small step in Task 7 (reuse `storage.listSubmissions(projectId)`, gate on a presented claim token via `tokensMatch` against the project's stored hash). Implementer: add the route + a test mirroring the claim test.

**Placeholder scan:** Two intentional, flagged stand-ins for the implementer to resolve immediately (not silent): (a) the `SiteDocument` import path in Task 2 Step 4 (use the real `@shared/site-document`), and (b) the claim-by-project lookup in Task 7 Step 3 (replace with a `getClaimTokenByProject` storage method, noted inline with the fix). Both are exercised by Step-1 tests so they fail loudly if skipped. No "TODO/handle errors/etc."

**Type consistency:** `PaymentVerifier`/`PaymentChallenge`/`VerifyResult` consistent across Tasks 5–8. `buildAndPublishSite(prompt, deps)` signature matches its caller in Task 7. `publishProjectRecord(project, store)` consistent in Tasks 3, 4. `makeCapacityPayload`/`AtCapacityError` used exactly as the live human routes use them (`server/routes.ts:19,33`).

**Scope:** Single subsystem (the agent surface). MCP + agent-identity minting explicitly out (spec non-goals). Good for one plan.
