import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import { MemStorage } from "../storage";
import { FakeVerifier } from "./payments";
import { registerAgentRoutes } from "./routes";
import type { SiteDocument } from "@shared/site-document";

const fakeDoc = {
  version: 1,
  meta: { name: "Acme" },
  theme: { preset: "modern-minimal", radius: "medium" },
  sections: [{ type: "hero", layout: "centered", headline: "Welcome to Acme" }],
} as unknown as SiteDocument;

function appWith(storage: MemStorage, verifier: FakeVerifier, generate: any, refine?: any) {
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app, { storage, verifier, generate, refine, prices: { build: 1, refine: 0.25 } });
  return app;
}

async function call(app: any, method: string, path: string, headers: Record<string,string> = {}, body?: any) {
  const { createServer } = await import("http");
  const server = createServer(app).listen(0);
  const port = (server.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  await new Promise<void>((r) => server.close(() => r()));
  return { status: res.status, json };
}

describe("agent routes", () => {
  let storage: MemStorage; let verifier: FakeVerifier; let generate: any;
  beforeEach(() => { storage = new MemStorage(); verifier = new FakeVerifier(); generate = vi.fn().mockResolvedValue(fakeDoc); });

  it("POST /v1/agent/sites unpaid -> 402", async () => {
    const r = await call(appWith(storage, verifier, generate), "POST", "/v1/agent/sites", {}, { prompt: "cafe" });
    expect(r.status).toBe(402);
    expect(verifier.settled).toBe(0);
  });

  it("POST /v1/agent/sites paid -> 200 url+token+doc, settles once", async () => {
    const r = await call(appWith(storage, verifier, generate), "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    expect(r.status).toBe(200);
    expect(r.json.siteUrl).toContain(r.json.slug);
    expect(r.json.claimToken).toMatch(/^[0-9a-f]{64}$/);
    expect(verifier.settled).toBe(1);
  });

  // A facilitator failure AFTER a successful build must not masquerade as a build
  // failure: the site is live, so the caller still needs its claim token, and we
  // need the incident visible as lost revenue rather than a generator error.
  it("settlement failure after a successful build -> 200 with site + claimToken, paymentSettled false", async () => {
    verifier.failSettle = true;
    const r = await call(appWith(storage, verifier, generate), "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    expect(r.status).toBe(200);
    expect(r.json.error).toBeUndefined();
    expect(r.json.claimToken).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json.siteUrl).toContain(r.json.slug);
    expect(r.json.paymentSettled).toBe(false);
    expect(verifier.settled).toBe(0);
  });

  it("successful build reports paymentSettled true", async () => {
    const r = await call(appWith(storage, verifier, generate), "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    expect(r.json.paymentSettled).toBe(true);
  });

  it("settlement failure on refine -> 200 with refined document, paymentSettled false", async () => {
    const app = appWith(storage, verifier, generate, vi.fn().mockResolvedValue(fakeDoc));
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    verifier.failSettle = true;
    const r = await call(app, "POST", `/v1/agent/sites/${built.json.projectId}/refine`,
      { "x-payment": "fake-ok", "x-claim-token": built.json.claimToken }, { instruction: "shorter headline" });
    expect(r.status).toBe(200);
    expect(r.json.document).toBeTruthy();
    expect(r.json.paymentSettled).toBe(false);
  });

  it("at-capacity -> 503 and DOES NOT settle", async () => {
    const { AtCapacityError } = await import("../gen-limiter");
    generate = vi.fn().mockRejectedValue(new AtCapacityError(8000));
    const r = await call(appWith(storage, verifier, generate), "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
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

  it("GET /v1/agent/sites/:id returns public status", async () => {
    const app = appWith(storage, verifier, generate);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    const r = await call(app, "GET", `/v1/agent/sites/${built.json.projectId}`);
    expect(r.status).toBe(200);
    expect(r.json.isPublished).toBe(true);
  });

  it("GET /v1/agent/sites/:id/leads with valid token -> 200 leads array", async () => {
    const app = appWith(storage, verifier, generate);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    const id = built.json.projectId;
    const token = built.json.claimToken;
    const r = await call(app, "GET", `/v1/agent/sites/${id}/leads`, { "x-claim-token": token });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json.leads)).toBe(true);
  });

  it("GET /v1/agent/sites/:id/leads without token -> 403", async () => {
    const app = appWith(storage, verifier, generate);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    const id = built.json.projectId;
    const r = await call(app, "GET", `/v1/agent/sites/${id}/leads`);
    expect(r.status).toBe(403);
  });

  it("GET /v1/agent/sites/:id/leads with wrong token -> 403", async () => {
    const app = appWith(storage, verifier, generate);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    const id = built.json.projectId;
    const r = await call(app, "GET", `/v1/agent/sites/${id}/leads`, { "x-claim-token": "a".repeat(64) });
    expect(r.status).toBe(403);
  });

  // ── refine tests ─────────────────────────────────────────────────────────────

  it("refine happy path: built+paid site -> 200 document returned, settles once more", async () => {
    const fakeRefine = vi.fn().mockResolvedValue(fakeDoc);
    const app = appWith(storage, verifier, generate, fakeRefine);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    expect(built.status).toBe(200);
    const id = built.json.projectId;
    const claimToken = built.json.claimToken;
    const r = await call(app, "POST", `/v1/agent/sites/${id}/refine`, { "x-payment": "fake-ok", "x-claim-token": claimToken }, { instruction: "make it bold" });
    expect(r.status).toBe(200);
    expect(r.json.document).toBeDefined();
    expect(r.json.projectId).toBe(id);
    // settled once for build + once for refine
    expect(verifier.settled).toBe(2);
  });

  it("refine unpaid -> 402, no settle", async () => {
    const fakeRefine = vi.fn().mockResolvedValue(fakeDoc);
    const app = appWith(storage, verifier, generate, fakeRefine);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    const id = built.json.projectId;
    const claimToken = built.json.claimToken;
    const settledAfterBuild = verifier.settled;
    // correct token but no payment → ownership passes, payment gate fires
    const r = await call(app, "POST", `/v1/agent/sites/${id}/refine`, { "x-claim-token": claimToken }, { instruction: "make it bold" });
    expect(r.status).toBe(402);
    expect(verifier.settled).toBe(settledAfterBuild);
  });

  it("refine on unknown site (no claim token row) -> 404, no settle", async () => {
    const fakeRefine = vi.fn().mockResolvedValue(fakeDoc);
    const app = appWith(storage, verifier, generate, fakeRefine);
    const r = await call(app, "POST", "/v1/agent/sites/nonexistent-id/refine", { "x-payment": "fake-ok", "x-claim-token": "a".repeat(64) }, { instruction: "make it bold" });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("site_not_found");
    expect(verifier.settled).toBe(0);
  });

  it("refine at-capacity -> 503, no settle", async () => {
    const { AtCapacityError } = await import("../gen-limiter");
    const fakeRefine = vi.fn().mockRejectedValue(new AtCapacityError(8000));
    const app = appWith(storage, verifier, generate, fakeRefine);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    const id = built.json.projectId;
    const claimToken = built.json.claimToken;
    const settledAfterBuild = verifier.settled;
    const r = await call(app, "POST", `/v1/agent/sites/${id}/refine`, { "x-payment": "fake-ok", "x-claim-token": claimToken }, { instruction: "make it bold" });
    expect(r.status).toBe(503);
    expect(r.json.error).toBe("at_capacity");
    expect(verifier.settled).toBe(settledAfterBuild);
  });

  // ── refine ownership gate tests ───────────────────────────────────────────────

  it("refine WITHOUT X-Claim-Token -> 403 bad_token, verifier not settled", async () => {
    const fakeRefine = vi.fn().mockResolvedValue(fakeDoc);
    const app = appWith(storage, verifier, generate, fakeRefine);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    const id = built.json.projectId;
    const settledAfterBuild = verifier.settled;
    const r = await call(app, "POST", `/v1/agent/sites/${id}/refine`, { "x-payment": "fake-ok" }, { instruction: "make it bold" });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("bad_token");
    expect(verifier.settled).toBe(settledAfterBuild);
  });

  it("refine WITH wrong X-Claim-Token -> 403 bad_token, verifier not settled", async () => {
    const fakeRefine = vi.fn().mockResolvedValue(fakeDoc);
    const app = appWith(storage, verifier, generate, fakeRefine);
    const built = await call(app, "POST", "/v1/agent/sites", { "x-payment": "fake-ok" }, { prompt: "cafe" });
    const id = built.json.projectId;
    const settledAfterBuild = verifier.settled;
    const r = await call(app, "POST", `/v1/agent/sites/${id}/refine`, { "x-payment": "fake-ok", "x-claim-token": "b".repeat(64) }, { instruction: "make it bold" });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe("bad_token");
    expect(verifier.settled).toBe(settledAfterBuild);
  });

  it("refine on unknown project id (no token row) -> 404 site_not_found", async () => {
    const fakeRefine = vi.fn().mockResolvedValue(fakeDoc);
    const app = appWith(storage, verifier, generate, fakeRefine);
    const r = await call(app, "POST", "/v1/agent/sites/no-such-project/refine", { "x-payment": "fake-ok", "x-claim-token": "c".repeat(64) }, { instruction: "make it bold" });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("site_not_found");
    expect(verifier.settled).toBe(0);
  });
});
