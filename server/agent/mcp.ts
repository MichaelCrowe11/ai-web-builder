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
import { tokensMatch, hashToken } from "./claim-tokens";
import { log } from "../log";
import { apiKeyFromHeader } from "../api-keys";
import { userQuota, consumeUserGeneration } from "../quota";
import { track, anonIdFromIp } from "../funnel";
import type { User } from "@shared/schema";
import type { SiteDocument } from "@shared/site-document";

export interface McpDeps {
  storage: IStorage;
  verifier: PaymentVerifier;
  generate?: (prompt: string) => Promise<SiteDocument>;
  refine?: (doc: SiteDocument, instruction: string) => Promise<SiteDocument>;
  prices: { build: number; refine: number };
}

// Who is calling, once the request's API key has been resolved. Absent for an
// unauthenticated call, which then has only the x402 rail available to it.
interface Caller {
  user: User;
  /** Funnel subject: the account when known, else a salted hash of the IP. */
  subject: { userId?: string; anonId?: string };
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

// Every tool answers with a single JSON text block — uniform for LLM callers.
const jsonResult = (data: unknown, isError = false): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  ...(isError && { isError: true }),
});

const SIGNUP_URL = `${process.env.APP_URL ?? "https://ai-webbuilder.com"}/settings/keys`;

// What a successful gate hands back, to be run only AFTER the work succeeds.
type Capture = (ctx: Record<string, unknown>) => Promise<Record<string, unknown>>;

/**
 * The MCP equivalent of the payment middleware, with TWO ways to pay.
 *
 * An API key bills the caller's account through the existing Stripe plan; an
 * `x_payment` payload settles USDC on Base. Both exist because they answer
 * different callers, and offering only the second one made the connector
 * unusable for the audience that installs it: ChatGPT and Claude have no wallet
 * and cannot sign an EIP-3009 authorization on a person's behalf, so every human
 * who added this connector previously hit an instruction they could not follow.
 *
 * The account path is checked first. When a caller has authenticated, quoting
 * them crypto payment requirements would be a strictly worse answer than
 * charging the account they just proved they own.
 */
async function payGate(
  verifier: PaymentVerifier,
  price: number,
  resource: string,
  xPayment: string | undefined,
  caller: Caller | undefined,
): Promise<{ ok: true; capture: Capture } | { ok: false; result: ToolResult }> {
  if (caller) {
    const q = await userQuota(caller.user);
    if (!q.ok) {
      return {
        ok: false,
        result: jsonResult({
          error: "quota_exceeded",
          message: `You've used your ${q.state.limit} generations for today on the ${q.state.plan} plan. Upgrade to Pro for more.`,
          plan: q.state.plan,
          upgradeUrl: `${process.env.APP_URL ?? "https://ai-webbuilder.com"}/pricing`,
        }, true),
      };
    }
    return {
      ok: true,
      capture: async () => ({
        paidWith: "account",
        plan: q.state.plan,
        quota: await consumeUserGeneration(q.user),
      }),
    };
  }

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
    if (verified) {
      return {
        ok: true,
        capture: async (ctx) => ({
          paidWith: "x402",
          paymentSettled: await settleOrLog(() => verifier.settle(verified), ctx),
        }),
      };
    }
  }
  // Unauthenticated and unpaid. Lead with the option a person can actually
  // complete — the crypto path is listed second because most callers reaching
  // this message are a human in a chat client, not an agent holding USDC.
  return {
    ok: false,
    result: jsonResult({
      error: "payment_required",
      message:
        `This tool is paid. Two ways to pay:\n` +
        `1. ACCOUNT (recommended for people): create an API key at ${SIGNUP_URL} and set it as the Authorization header of this MCP connector ("Bearer aiwb_sk_..."). Calls are then billed to your plan.\n` +
        `2. x402 (for autonomous agents with a wallet): sign an EIP-3009 authorization for the requirements below, base64-encode the x402 PaymentPayload, and call again with it in x_payment.\n` +
        `Either way, payment is captured only after your site is built and live.`,
      apiKeyUrl: SIGNUP_URL,
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

function buildServer(deps: McpDeps, caller?: Caller): McpServer {
  const { storage, verifier, prices } = deps;
  const server = new McpServer({ name: "ai-webbuilder", version: "1.0.0" });

  server.registerTool(
    "build_site",
    {
      title: "Build and publish a website",
      description:
        `Build and publish a complete, designed, live website from a prompt: structured sections, editorial theme, bespoke AI-generated photography, lead capture, and hosting on a public URL. Paid — either bill your account (set an API key from ${SIGNUP_URL} as this connector's Authorization header) or pay ${prices.build} USDC on Base via x402 (call once without x_payment to get requirements, sign, call again). Returns the live siteUrl plus a one-time claimToken (SAVE IT: it is the ownership credential for refine/leads/claim). Allow ~3 minutes; photography is generated during the build.`,
      inputSchema: {
        prompt: z.string().min(1).max(8000).describe("What the site is for: business, audience, tone, key content"),
        x_payment: z.string().optional().describe("base64 x402 PaymentPayload (the X-PAYMENT header value)"),
      },
    },
    async ({ prompt, x_payment }) => {
      const gate = await payGate(verifier, prices.build, "/v1/agent/sites", x_payment, caller);
      if (!gate.ok) {
        track("mcp_payment_required", caller?.subject ?? {});
        return gate.result;
      }
      try {
        const r = await buildAndPublishSite(prompt, { storage, generate: deps.generate });
        const payment = await gate.capture({ tool: "build_site", projectId: r.projectId, siteUrl: r.siteUrl });
        track("mcp_build", caller?.subject ?? {});
        return jsonResult({ projectId: r.projectId, slug: r.slug, siteUrl: r.siteUrl, claimToken: r.claimToken, ...payment });
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
        `Apply a scoped edit instruction to a site you built (requires its claimToken). Paid: billed to your account via API key, or ${prices.refine} USDC via x402 — same flow as build_site. Payment is captured only on success.`,
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

      const gate = await payGate(verifier, prices.refine, `/v1/agent/sites/${site_id}/refine`, x_payment, caller);
      if (!gate.ok) {
        track("mcp_payment_required", caller?.subject ?? {});
        return gate.result;
      }

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
        const payment = await gate.capture({ tool: "refine_site", projectId: site_id });
        return jsonResult({ projectId: site_id, refined: true, ...payment });
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

/** Funnel subject for an MCP request: the account when authenticated, else IP. */
function subjectOf(req: Request, user?: User): { userId?: string; anonId?: string } {
  if (user) return { userId: user.id };
  const fwd = req.headers["x-forwarded-for"];
  const ip = typeof fwd === "string" && fwd.length
    ? fwd.split(",")[0].trim()
    : req.ip ?? req.socket.remoteAddress ?? "unknown";
  return { anonId: anonIdFromIp(ip) };
}

export function registerMcpEndpoint(app: Express, deps: McpDeps): void {
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      // Resolve the caller's API key, if they supplied one.
      const presented = apiKeyFromHeader(req.header("authorization"));
      let caller: Caller | undefined;
      if (presented) {
        const hash = hashToken(presented);
        const user = await deps.storage.getUserByApiKeyHash(hash);
        if (!user) {
          // Fail loudly rather than falling through to the x402 path: a caller
          // who supplied a key expects to be billed by account, and silently
          // quoting them crypto requirements reads as "your key was ignored".
          return res.status(401).json({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Invalid or revoked API key. Create one at " + SIGNUP_URL },
            id: null,
          });
        }
        caller = { user, subject: { userId: user.id } };
        void deps.storage.touchApiKey(hash); // fire-and-forget: never delay a call
      }

      // tools/list is the closest thing to an "install" signal a stateless MCP
      // server gets — clients call it when a connector is added or refreshed.
      if (req.body?.method === "tools/list") {
        track("mcp_tools_list", subjectOf(req, caller?.user));
      }

      const server = buildServer(deps, caller);
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
