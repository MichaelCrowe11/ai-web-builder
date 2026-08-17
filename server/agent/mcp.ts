// Remote MCP server at POST /mcp — the "ChatGPT plugin" surface, done the 2026
// way: one Model Context Protocol endpoint that ChatGPT (Apps SDK / connectors),
// Claude, Cursor, and every MCP-speaking agent framework can consume.
//
// Design:
// - STATELESS Streamable HTTP: a fresh McpServer + transport per POST, no
//   sessions. Cloud Run runs many interchangeable instances with request-based
//   billing; any instance must be able to serve any call.
// - Same money rail as REST: paid tools take an optional `x_payment` argument
//   carrying the exact same base64 x402 payload as the X-PAYMENT header. Without
//   it the tool returns the x402 `accepts` requirements (the 402 body, as JSON)
//   so wallet-equipped agents can sign and retry; payment settles ONLY after the
//   work succeeds, exactly like the HTTP routes.
// - Payers sign against the canonical REST resource (/v1/agent/sites), so one
//   authorization is valid on either surface and the facilitator sees one shape.
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IStorage } from "../storage";
import type { PaymentVerifier } from "./payments";
import { acceptsBody } from "./x402-middleware";
import { buildAndPublishSite } from "./build-service";
import { AtCapacityError, makeCapacityPayload, runLimited } from "../gen-limiter";
import { refineDocument } from "../document-gen";
import { renderDocumentBody, renderDocumentCss } from "../renderer";
import { tokensMatch } from "./claim-tokens";
import { log } from "../log";
import type { SiteDocument } from "@shared/site-document";

export interface McpDeps {
  storage: IStorage;
  verifier: PaymentVerifier;
  generate?: (prompt: string) => Promise<SiteDocument>;
  refine?: (doc: SiteDocument, instruction: string) => Promise<SiteDocument>;
  prices: { build: number; refine: number };
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

// Every tool answers with a single JSON text block — uniform for LLM callers.
const jsonResult = (data: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  ...(isError && { isError: true }),
});

// The MCP equivalent of the payment middleware. Returns either a settle handle
// (payment verified, capture after the work succeeds) or the ToolResult to send
// back (payment requirements / unavailability), never both.
async function payGate(
  verifier: PaymentVerifier,
  price: number,
  resource: string,
  xPayment: string | undefined,
): Promise<{ ok: true; settle: () => Promise<void> } | { ok: false; result: ToolResult }> {
  const challenge = verifier.challenge(price, resource);
  if (challenge.unavailable) {
    return { ok: false, result: jsonResult({ error: "payments_unavailable" }, true) };
  }
  if (xPayment) {
    // The verifier reads the X-PAYMENT header and the resource path from an
    // Express request; hand it a shim that says exactly what a paid HTTP call
    // to the canonical resource would have said.
    const shim = {
      header: (name: string) => (name.toLowerCase() === "x-payment" ? xPayment : undefined),
      path: resource,
    } as unknown as Request;
    let verified;
    try {
      verified = await verifier.verify(shim, price);
    } catch {
      return { ok: false, result: jsonResult({ error: "payment_verification_unavailable" }, true) };
    }
    if (verified) return { ok: true, settle: () => verifier.settle(verified) };
  }
  return {
    ok: false,
    result: jsonResult({
      error: "payment_required",
      message:
        "This tool is paid via x402 (USDC on Base). Sign an EIP-3009 authorization for the requirements below, base64-encode the x402 PaymentPayload, and call this tool again with it in the x_payment argument. Payment settles only after your site is built and live.",
      ...acceptsBody(challenge, price),
    }, true),
  };
}

// settle() failure after delivered work is a revenue incident, never a tool error.
async function settleOrLog(settle: () => Promise<void>, ctx: Record<string, unknown>): Promise<boolean> {
  try {
    await settle();
    return true;
  } catch (err: any) {
    log(`x402 SETTLEMENT FAILED (mcp) — work delivered, funds NOT captured: ${JSON.stringify(ctx)} — ${err.message}`);
    return false;
  }
}

const capacityResult = (err: AtCapacityError): ToolResult => {
  const { retryAfterSeconds, body } = makeCapacityPayload(err);
  return jsonResult({ ...body, retryAfterSeconds }, true);
};

function buildServer(deps: McpDeps): McpServer {
  const { storage, verifier, prices } = deps;
  const server = new McpServer({ name: "ai-webbuilder", version: "1.0.0" });

  server.registerTool(
    "build_site",
    {
      title: "Build and publish a website",
      description:
        `Build and publish a complete, designed, live website from a prompt: structured sections, editorial theme, bespoke AI-generated photography, lead capture, and hosting on a public URL. Paid: ${prices.build} USDC on Base via x402 — call once without x_payment to receive payment requirements, sign them, then call again with x_payment. Returns the live siteUrl plus a one-time claimToken (SAVE IT: it is the ownership credential for refine/leads/claim). Allow ~3 minutes; photography is generated during the build.`,
      inputSchema: {
        prompt: z.string().min(1).max(8000).describe("What the site is for: business, audience, tone, key content"),
        x_payment: z.string().optional().describe("base64 x402 PaymentPayload (the X-PAYMENT header value)"),
      },
    },
    async ({ prompt, x_payment }) => {
      const gate = await payGate(verifier, prices.build, "/v1/agent/sites", x_payment);
      if (!gate.ok) return gate.result;
      try {
        const r = await buildAndPublishSite(prompt, { storage, generate: deps.generate });
        const paymentSettled = await settleOrLog(gate.settle, { tool: "build_site", projectId: r.projectId, siteUrl: r.siteUrl });
        return jsonResult({ projectId: r.projectId, slug: r.slug, siteUrl: r.siteUrl, claimToken: r.claimToken, paymentSettled });
      } catch (err: any) {
        if (err instanceof AtCapacityError) return capacityResult(err);
        log(`MCP build error: ${err.message}`);
        return jsonResult({ error: "build_failed" }, true);
      }
    },
  );

  server.registerTool(
    "refine_site",
    {
      title: "Refine an existing site",
      description:
        `Apply a scoped edit instruction to a site you built (requires its claimToken). Paid: ${prices.refine} USDC via x402, same flow as build_site. Payment settles only on success.`,
      inputSchema: {
        site_id: z.string().min(1).describe("projectId returned by build_site"),
        instruction: z.string().min(1).max(8000).describe("The edit, e.g. 'make the hero headline about weekend workshops'"),
        claim_token: z.string().min(1).describe("The claimToken returned by build_site"),
        x_payment: z.string().optional().describe("base64 x402 PaymentPayload (the X-PAYMENT header value)"),
      },
    },
    async ({ site_id, instruction, claim_token, x_payment }) => {
      // Ownership FIRST — a non-owner is never asked to pay (mirrors the REST route).
      const row = await storage.getClaimTokenByProject(site_id);
      if (!row) return jsonResult({ error: "site_not_found" }, true);
      if (!tokensMatch(claim_token, row.tokenHash)) return jsonResult({ error: "bad_token" }, true);

      const gate = await payGate(verifier, prices.refine, `/v1/agent/sites/${site_id}/refine`, x_payment);
      if (!gate.ok) return gate.result;

      const latest = await storage.getLatestDocument(site_id);
      if (!latest) return jsonResult({ error: "site_not_found" }, true);
      const refineFn = deps.refine ?? refineDocument;
      try {
        const refined = await runLimited(() => refineFn(latest.document, instruction));
        await storage.updateProject(site_id, {
          html: renderDocumentBody(refined),
          css: renderDocumentCss(refined),
        });
        await storage.saveDocumentVersion(site_id, refined);
        const paymentSettled = await settleOrLog(gate.settle, { tool: "refine_site", projectId: site_id });
        return jsonResult({ projectId: site_id, refined: true, paymentSettled });
      } catch (err: any) {
        if (err instanceof AtCapacityError) return capacityResult(err);
        log(`MCP refine error: ${err.message}`);
        return jsonResult({ error: "refine_failed" }, true);
      }
    },
  );

  server.registerTool(
    "get_site",
    {
      title: "Get site status",
      description: "Read a site's public status (slug, live URL, published state). Free.",
      inputSchema: { site_id: z.string().min(1).describe("projectId returned by build_site") },
    },
    async ({ site_id }) => {
      const p = await storage.getProject(site_id);
      if (!p) return jsonResult({ error: "site_not_found" }, true);
      return jsonResult({ projectId: p.id, slug: p.slug, siteUrl: p.publishedUrl, isPublished: p.isPublished });
    },
  );

  server.registerTool(
    "claim_site",
    {
      title: "Claim site ownership",
      description:
        "Bind an unclaimed agent-built site to an owner identity (e.g. your human's email) using the one-time claimToken. Free. One claim per site.",
      inputSchema: {
        site_id: z.string().min(1).describe("projectId returned by build_site"),
        claim_token: z.string().min(1).describe("The claimToken returned by build_site"),
        identity: z.string().min(1).max(255).describe("Owner identity to record, e.g. an email address"),
      },
    },
    async ({ site_id, claim_token, identity }) => {
      const row = await storage.getClaimTokenByProject(site_id);
      if (!row) return jsonResult({ error: "no_claim_token" }, true);
      if (!tokensMatch(claim_token, row.tokenHash)) return jsonResult({ error: "bad_token" }, true);
      const ok = await storage.claimToken(row.tokenHash, identity);
      if (!ok) return jsonResult({ error: "already_claimed" }, true);
      return jsonResult({ ok: true, projectId: site_id, owner: identity });
    },
  );

  server.registerTool(
    "read_leads",
    {
      title: "Read the site's lead inbox",
      description:
        "List form submissions from real visitors to a site you own (requires its claimToken). Free.",
      inputSchema: {
        site_id: z.string().min(1).describe("projectId returned by build_site"),
        claim_token: z.string().min(1).describe("The claimToken returned by build_site"),
      },
    },
    async ({ site_id, claim_token }) => {
      const row = await storage.getClaimTokenByProject(site_id);
      if (!row) return jsonResult({ error: "site_not_found" }, true);
      if (!tokensMatch(claim_token, row.tokenHash)) return jsonResult({ error: "bad_token" }, true);
      const leads = await storage.listSubmissions(site_id);
      return jsonResult({ projectId: site_id, leads });
    },
  );

  return server;
}

export function registerMcpEndpoint(app: Express, deps: McpDeps): void {
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const server = buildServer(deps);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: no session to lose between Cloud Run instances
        enableJsonResponse: true,      // plain JSON responses; no SSE stream needed for tool calls
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      log(`MCP transport error: ${err.message}`);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal_error" }, id: null });
      }
    }
  });

  // Stateless server: no SSE stream to GET, no session to DELETE.
  const methodNotAllowed = (_req: Request, res: Response) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Stateless MCP server: use POST" }, id: null });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);
}
