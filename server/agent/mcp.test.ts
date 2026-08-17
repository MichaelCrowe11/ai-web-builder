import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { MemStorage } from "../storage";
import { FakeVerifier, DisabledVerifier } from "./payments";
import { registerMcpEndpoint } from "./mcp";
import type { SiteDocument } from "@shared/site-document";

const fakeDoc = {
  version: 1,
  meta: { name: "Acme" },
  theme: { preset: "modern-minimal", radius: "medium" },
  sections: [{ type: "hero", layout: "centered", headline: "Welcome to Acme" }],
} as unknown as SiteDocument;

function appWith(storage: MemStorage, verifier: FakeVerifier | DisabledVerifier) {
  const app = express();
  app.use(express.json());
  registerMcpEndpoint(app, {
    storage,
    verifier,
    generate: async () => fakeDoc,
    refine: async (doc) => ({ ...doc, meta: { ...doc.meta, name: "Refined" } }),
    prices: { build: 1, refine: 0.25 },
  });
  return app;
}

// Each MCP call is an independent JSON-RPC POST (stateless Streamable HTTP).
async function rpc(app: any, body: unknown, method = "POST", headers: Record<string, string> = {}) {
  const { createServer } = await import("http");
  const server = createServer(app).listen(0);
  const port = (server.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  server.close();
  return { status: res.status, json };
}

const callTool = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name, arguments: args },
});

// Tool results carry one JSON text block; parse it back out.
const toolJson = (rpcJson: any) => JSON.parse(rpcJson.result.content[0].text);

describe("MCP endpoint", () => {
  let s: MemStorage;
  let v: FakeVerifier;
  beforeEach(() => {
    s = new MemStorage();
    v = new FakeVerifier();
  });

  it("answers initialize with server info", async () => {
    const { status, json } = await rpc(appWith(s, v), {
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    expect(status).toBe(200);
    expect(json.result.serverInfo.name).toBe("ai-webbuilder");
  });

  it("lists all five tools", async () => {
    const { json } = await rpc(appWith(s, v), { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const names = json.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["build_site", "claim_site", "get_site", "read_leads", "refine_site"]);
  });

  // ── Account payment path ───────────────────────────────────────────────────
  // The connector's whole point is reaching people inside ChatGPT/Claude/Cursor,
  // and those clients hold no wallet. Without an account rail every human caller
  // is quoted an EIP-3009 signing ritual they cannot perform.
  async function userWithKey(storage: MemStorage, plan = "free") {
    const { mintApiKey } = await import("../api-keys");
    const user = await storage.createUser({ username: `u${Math.random()}`, password: "x", email: null } as any);
    if (plan !== "free") await storage.updateUser(user.id, { plan });
    const { key, hash } = mintApiKey();
    await storage.createApiKey(user.id, hash, "test");
    return { user, key };
  }
  const auth = (key: string) => ({ authorization: `Bearer ${key}` });

  it("build_site with a valid API key builds and bills the account, no wallet needed", async () => {
    const { key } = await userWithKey(s);
    const { json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe" }), "POST", auth(key));
    const out = toolJson(json);
    expect(json.result.isError).toBeFalsy();
    expect(out.siteUrl).toContain(out.slug);
    expect(out.claimToken).toMatch(/^[0-9a-f]{64}$/);
    expect(out.paidWith).toBe("account");
    expect(out.quota.used).toBe(1);
    expect(v.settled).toBe(0); // the crypto rail was never touched
  });

  it("rejects an unknown key outright rather than silently quoting crypto requirements", async () => {
    const { mintApiKey } = await import("../api-keys");
    const { status, json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe" }), "POST", auth(mintApiKey().key));
    expect(status).toBe(401);
    expect(json.error.message).toContain("Invalid or revoked API key");
  });

  it("stops honouring a key once it is revoked", async () => {
    const { user, key } = await userWithKey(s);
    const [row] = await s.listApiKeys(user.id);
    expect(await s.revokeApiKey(row.id, user.id)).toBe(true);
    const { status } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe" }), "POST", auth(key));
    expect(status).toBe(401);
  });

  it("refuses a build once the account's daily quota is spent, and points at plans not checkout", async () => {
    const { user, key } = await userWithKey(s);
    const { FREE_DAILY_LIMIT } = await import("@shared/schema");
    await s.updateUserGenerations(user.id, FREE_DAILY_LIMIT);
    const { json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe" }), "POST", auth(key));
    const out = toolJson(json);
    expect(json.result.isError).toBe(true);
    expect(out.error).toBe("quota_exceeded");
  });

  it("a pro account is not daily-capped", async () => {
    const { user, key } = await userWithKey(s, "pro");
    await s.updateUserGenerations(user.id, 999);
    const { json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe" }), "POST", auth(key));
    expect(toolJson(json).paidWith).toBe("account");
  });

  // Both rails must stay open: agents with wallets keep working unchanged.
  it("still accepts x402 payment when no API key is presented", async () => {
    const { json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe", x_payment: "fake-ok" }));
    const out = toolJson(json);
    expect(out.paidWith).toBe("x402");
    expect(out.paymentSettled).toBe(true);
    expect(v.settled).toBe(1);
  });

  it("the unpaid message offers the account route before the crypto one", async () => {
    const { json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe" }));
    const out = toolJson(json);
    expect(out.apiKeyUrl).toBeTruthy();
    expect(out.message.indexOf("ACCOUNT")).toBeLessThan(out.message.indexOf("x402"));
  });

  it("build_site without x_payment returns the x402 accepts requirements", async () => {
    const { json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe" }));
    const out = toolJson(json);
    expect(json.result.isError).toBe(true);
    expect(out.error).toBe("payment_required");
    expect(out.x402Version).toBe(1);
    expect(out.accepts[0].payTo).toBe("0xFAKE");
    expect(out.accepts[0].resource).toBe("/v1/agent/sites");
  });

  it("build_site with valid x_payment builds, publishes and settles", async () => {
    const { json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe", x_payment: "fake-ok" }));
    const out = toolJson(json);
    expect(json.result.isError).toBeUndefined();
    expect(out.siteUrl).toContain(out.slug);
    expect(out.claimToken).toMatch(/^[0-9a-f]{64}$/);
    expect(out.paymentSettled).toBe(true);
    expect(v.settled).toBe(1);
    const project = await s.getProject(out.projectId);
    expect(project?.isPublished).toBe(true);
  });

  it("build_site reports paymentSettled:false when settle fails, still delivers the site", async () => {
    v.failSettle = true;
    const { json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe", x_payment: "fake-ok" }));
    const out = toolJson(json);
    expect(out.siteUrl).toBeTruthy();
    expect(out.paymentSettled).toBe(false);
  });

  it("build_site with bad x_payment returns payment_required, not a build", async () => {
    const { json } = await rpc(appWith(s, v), callTool("build_site", { prompt: "a cafe", x_payment: "nope" }));
    expect(toolJson(json).error).toBe("payment_required");
    expect(v.settled).toBe(0);
  });

  it("paid tools report payments_unavailable with the DisabledVerifier", async () => {
    const { json } = await rpc(appWith(s, new DisabledVerifier()), callTool("build_site", { prompt: "x" }));
    expect(toolJson(json).error).toBe("payments_unavailable");
  });

  it("refine_site checks ownership before payment and refines with a paid call", async () => {
    const app = appWith(s, v);
    const built = toolJson((await rpc(app, callTool("build_site", { prompt: "a cafe", x_payment: "fake-ok" }))).json);

    // wrong token: rejected before any payment talk
    const bad = toolJson((await rpc(app, callTool("refine_site", {
      site_id: built.projectId, instruction: "x", claim_token: "0".repeat(64),
    }))).json);
    expect(bad.error).toBe("bad_token");

    // right token, no payment: payment_required
    const unpaid = toolJson((await rpc(app, callTool("refine_site", {
      site_id: built.projectId, instruction: "x", claim_token: built.claimToken,
    }))).json);
    expect(unpaid.error).toBe("payment_required");

    // paid: refines
    const paid = toolJson((await rpc(app, callTool("refine_site", {
      site_id: built.projectId, instruction: "rename it", claim_token: built.claimToken, x_payment: "fake-ok",
    }))).json);
    expect(paid.refined).toBe(true);
    expect((await s.getLatestDocument(built.projectId))!.document.meta.name).toBe("Refined");
  });

  it("get_site, claim_site and read_leads round-trip on a built site", async () => {
    const app = appWith(s, v);
    const built = toolJson((await rpc(app, callTool("build_site", { prompt: "a cafe", x_payment: "fake-ok" }))).json);

    const got = toolJson((await rpc(app, callTool("get_site", { site_id: built.projectId }))).json);
    expect(got.isPublished).toBe(true);

    const leads = toolJson((await rpc(app, callTool("read_leads", {
      site_id: built.projectId, claim_token: built.claimToken,
    }))).json);
    expect(leads.leads).toEqual([]);

    const claimed = toolJson((await rpc(app, callTool("claim_site", {
      site_id: built.projectId, claim_token: built.claimToken, identity: "owner@example.com",
    }))).json);
    expect(claimed.ok).toBe(true);

    const again = toolJson((await rpc(app, callTool("claim_site", {
      site_id: built.projectId, claim_token: built.claimToken, identity: "other@example.com",
    }))).json);
    expect(again.error).toBe("already_claimed");
  });

  it("rejects GET and DELETE (stateless, POST only)", async () => {
    const app = appWith(s, v);
    expect((await rpc(app, undefined, "GET")).status).toBe(405);
    expect((await rpc(app, undefined, "DELETE")).status).toBe(405);
  });
});
