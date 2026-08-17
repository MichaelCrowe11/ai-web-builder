// /v1/agent/* HTTP routes. Gated by payment middleware; settles payment ONLY
// after the work succeeds — a 503 (at-capacity) or 500 (build error) never
// charges the agent. Registration uses DisabledVerifier by default; Task 8
// swaps in the real x402 verifier via makeVerifier().
import type { Express, Request, Response, NextFunction } from "express";
import type { IStorage } from "../storage";
import type { PaymentVerifier } from "./payments";
import type { SiteDocument } from "@shared/site-document";
import { requirePayment } from "./x402-middleware";
import { buildAndPublishSite } from "./build-service";
import { AtCapacityError, makeCapacityPayload, runLimited } from "../gen-limiter";
import { refineDocument } from "../document-gen";
import { renderDocumentBody, renderDocumentCss } from "../renderer";
import { tokensMatch } from "./claim-tokens";
import { log } from "../log";
import { registerDiscoveryRoutes } from "./discovery";

export interface AgentRouteDeps {
  storage: IStorage;
  verifier: PaymentVerifier;
  generate?: (prompt: string) => Promise<SiteDocument>;
  refine?: (doc: SiteDocument, instruction: string) => Promise<SiteDocument>;
  prices: { build: number; refine: number };
}

// Shared 503 helper — avoids duplicating makeCapacityPayload across paid routes.
function sendCapacity(res: Response, err: AtCapacityError): Response {
  const { retryAfterSeconds, body } = makeCapacityPayload(err);
  res.setHeader("Retry-After", String(retryAfterSeconds));
  return res.status(503).json(body);
}

// Capture funds for a request whose work has ALREADY succeeded and been published.
//
// NEVER throws. By the time this runs the site exists and the caller is owed it, so
// a facilitator failure is a revenue incident to log — not a build error to report.
// Letting it throw into the route's catch would produce three wrong outcomes at once:
// the caller gets `build_failed` for a build that worked, never receives the claim
// token for a site that is live, and the log blames the generator for a payment fault.
//
// Returns whether funds were actually captured, which the route echoes back as
// `paymentSettled` so the caller knows whether it was charged.
async function settleOrLog(req: Request, ctx: Record<string, unknown>): Promise<boolean> {
  try {
    await req.settlePayment!();
    return true;
  } catch (err: any) {
    log(`x402 SETTLEMENT FAILED — work delivered, funds NOT captured: ${JSON.stringify(ctx)} — ${err.message}`);
    return false;
  }
}

// Proof-of-ownership gate: caller must present the site's one-time claim token
// (the bearer credential returned at build) in X-Claim-Token. Used by refine + leads.
function requireClaimToken(storage: IStorage) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const row = await storage.getClaimTokenByProject(req.params.id);
    if (!row) return res.status(404).json({ error: "site_not_found" });
    const token = req.header("x-claim-token");
    if (!token || !tokensMatch(token, row.tokenHash)) return res.status(403).json({ error: "bad_token" });
    next();
  };
}

export function registerAgentRoutes(app: Express, deps: AgentRouteDeps): void {
  const { storage, verifier, prices } = deps;

  // ── POST /v1/agent/sites ────────────────────────────────────────────────────
  // Build + publish a new agent site. Payment is verified before the handler
  // runs; settled ONLY after buildAndPublishSite returns successfully.
  app.post(
    "/v1/agent/sites",
    requirePayment(() => prices.build, verifier),
    async (req: Request, res: Response) => {
      const { prompt } = req.body ?? {};
      if (!prompt || typeof prompt !== "string" || prompt.length > 8000) {
        return res.status(400).json({ error: "prompt_required" });
      }
      try {
        const result = await buildAndPublishSite(prompt, { storage, generate: deps.generate });
        const paymentSettled = await settleOrLog(req, {
          route: "build",
          projectId: result.projectId,
          slug: result.slug,
          siteUrl: result.siteUrl,
        });
        return res.json({
          projectId: result.projectId,
          slug: result.slug,
          siteUrl: result.siteUrl,
          claimToken: result.claimToken,
          document: result.document,
          paymentSettled,
        });
      } catch (err: any) {
        if (err instanceof AtCapacityError) return sendCapacity(res, err);
        log(`Agent build error: ${err.message}`);
        return res.status(500).json({ error: "build_failed" });
      }
    },
  );

  // ── POST /v1/agent/sites/:id/refine ─────────────────────────────────────────
  // Apply a scoped instruction to an existing document. Settles ONLY on success.
  // Ownership is checked BEFORE payment so a non-owner is never asked to pay.
  app.post(
    "/v1/agent/sites/:id/refine",
    requireClaimToken(storage),
    requirePayment(() => prices.refine, verifier),
    async (req: Request, res: Response) => {
      const { instruction } = req.body ?? {};
      if (!instruction || typeof instruction !== "string" || instruction.length > 8000) {
        return res.status(400).json({ error: "instruction_required" });
      }
      const latest = await storage.getLatestDocument(req.params.id);
      if (!latest) return res.status(404).json({ error: "site_not_found" });
      const refineFn = deps.refine ?? refineDocument;
      try {
        const refined = await runLimited(() => refineFn(latest.document, instruction));
        await storage.updateProject(req.params.id, {
          html: renderDocumentBody(refined),
          css: renderDocumentCss(refined),
        });
        await storage.saveDocumentVersion(req.params.id, refined);
        const paymentSettled = await settleOrLog(req, { route: "refine", projectId: req.params.id });
        return res.json({ projectId: req.params.id, document: refined, paymentSettled });
      } catch (err: any) {
        if (err instanceof AtCapacityError) return sendCapacity(res, err);
        log(`Agent refine error: ${err.message}`);
        return res.status(500).json({ error: "refine_failed" });
      }
    },
  );

  // ── POST /v1/agent/sites/:id/claim ──────────────────────────────────────────
  // Bind an agent-built (unclaimed) site to an identity using the one-time token.
  app.post("/v1/agent/sites/:id/claim", async (req: Request, res: Response) => {
    const { token, identity } = req.body ?? {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "token_required" });
    }
    if (!identity || typeof identity !== "string") {
      return res.status(400).json({ error: "identity_required" });
    }
    if (identity.length > 255) {
      return res.status(400).json({ error: "identity too long" });
    }
    const row = await storage.getClaimTokenByProject(req.params.id);
    if (!row) return res.status(404).json({ error: "no_claim_token" });
    if (!tokensMatch(token, row.tokenHash)) {
      return res.status(403).json({ error: "bad_token" });
    }
    const ok = await storage.claimToken(row.tokenHash, identity);
    if (!ok) return res.status(409).json({ error: "already_claimed" });
    // Ownership is recorded in agent_claim_tokens.claimedBy. We do NOT set
    // projects.userId here: it has an FK to users.id, and an external
    // Crowe-ID/agent identity is not necessarily a users row. Mapping a claimed
    // identity to a dashboard user is deferred to the Crowe ID integration.
    return res.json({ ok: true, projectId: req.params.id, owner: identity });
  });

  // ── GET /v1/agent/sites/:id ──────────────────────────────────────────────────
  // Public status endpoint — no payment or token required.
  app.get("/v1/agent/sites/:id", async (req: Request, res: Response) => {
    const p = await storage.getProject(req.params.id);
    if (!p) return res.status(404).json({ error: "site_not_found" });
    return res.json({
      projectId: p.id,
      slug: p.slug,
      siteUrl: p.publishedUrl,
      isPublished: p.isPublished,
    });
  });

  // ── GET /v1/agent/sites/:id/leads ────────────────────────────────────────────
  // Owner-only lead inbox, gated by the claim token in X-Claim-Token header.
  app.get("/v1/agent/sites/:id/leads", requireClaimToken(storage), async (req: Request, res: Response) => {
    const leads = await storage.listSubmissions(req.params.id);
    return res.json({ projectId: req.params.id, leads });
  });

  // ── Discovery surfaces (/llms.txt, /openapi.json, /.well-known/*) ───────────
  // Static, no-DB endpoints that let agents discover, price, and pay for the
  // service with no human in the loop. Registered inside registerAgentRoutes so
  // they are mounted before the SPA catch-all in serveStatic (index.ts calls
  // registerRoutes → registerAgentRoutes BEFORE serveStatic is set up).
  registerDiscoveryRoutes(app, prices, process.env.X402_PAY_TO_ADDRESS ?? "");
}
