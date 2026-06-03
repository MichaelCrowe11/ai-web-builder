// /v1/agent/* HTTP routes. Gated by payment middleware; settles payment ONLY
// after the work succeeds — a 503 (at-capacity) or 500 (build error) never
// charges the agent. Registration uses DisabledVerifier by default; Task 8
// swaps in the real x402 verifier via makeVerifier().
import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import type { PaymentVerifier } from "./payments";
import type { SiteDocument } from "@shared/site-document";
import { requirePayment } from "./x402-middleware";
import { buildAndPublishSite } from "./build-service";
import { AtCapacityError, makeCapacityPayload, runLimited } from "../gen-limiter";
import { refineDocument } from "../document-gen";
import { renderDocumentBody, renderDocumentCss } from "../renderer";
import { tokensMatch } from "./claim-tokens";

export interface AgentRouteDeps {
  storage: IStorage;
  verifier: PaymentVerifier;
  generate?: (prompt: string) => Promise<SiteDocument>;
  prices: { build: number; refine: number };
}

// Shared 503 helper — avoids duplicating makeCapacityPayload across paid routes.
function sendCapacity(res: Response, err: AtCapacityError): Response {
  const { retryAfterSeconds, body } = makeCapacityPayload(err);
  res.setHeader("Retry-After", String(retryAfterSeconds));
  return res.status(503).json(body);
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
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "prompt_required" });
      }
      try {
        const result = await buildAndPublishSite(prompt, { storage, generate: deps.generate });
        await req.settlePayment!();
        return res.json({
          projectId: result.projectId,
          slug: result.slug,
          siteUrl: result.siteUrl,
          claimToken: result.claimToken,
          document: result.document,
        });
      } catch (err: any) {
        if (err instanceof AtCapacityError) return sendCapacity(res, err);
        return res.status(500).json({ error: "build_failed", detail: err.message });
      }
    },
  );

  // ── POST /v1/agent/sites/:id/refine ─────────────────────────────────────────
  // Apply a scoped instruction to an existing document. Settles ONLY on success.
  app.post(
    "/v1/agent/sites/:id/refine",
    requirePayment(() => prices.refine, verifier),
    async (req: Request, res: Response) => {
      const { instruction } = req.body ?? {};
      if (!instruction || typeof instruction !== "string") {
        return res.status(400).json({ error: "instruction_required" });
      }
      const latest = await storage.getLatestDocument(req.params.id);
      if (!latest) return res.status(404).json({ error: "site_not_found" });
      try {
        const refined = await runLimited(() => refineDocument(latest.document, instruction));
        await storage.updateProject(req.params.id, {
          html: renderDocumentBody(refined),
          css: renderDocumentCss(refined),
        });
        await storage.saveDocumentVersion(req.params.id, refined);
        await req.settlePayment!();
        return res.json({ projectId: req.params.id, document: refined });
      } catch (err: any) {
        if (err instanceof AtCapacityError) return sendCapacity(res, err);
        return res.status(500).json({ error: "refine_failed", detail: err.message });
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
    const row = await storage.getClaimTokenByProject(req.params.id);
    if (!row) return res.status(404).json({ error: "no_claim_token" });
    if (!tokensMatch(token, row.tokenHash)) {
      return res.status(403).json({ error: "bad_token" });
    }
    const ok = await storage.claimToken(row.tokenHash, identity);
    if (!ok) return res.status(409).json({ error: "already_claimed" });
    await storage.updateProject(req.params.id, { userId: identity } as any);
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
  app.get("/v1/agent/sites/:id/leads", async (req: Request, res: Response) => {
    const row = await storage.getClaimTokenByProject(req.params.id);
    if (!row) return res.status(404).json({ error: "no_claim_token" });
    const token = req.header("x-claim-token");
    if (!token || !tokensMatch(token, row.tokenHash)) {
      return res.status(403).json({ error: "bad_token" });
    }
    const leads = await storage.listSubmissions(req.params.id);
    return res.json({ projectId: req.params.id, leads });
  });
}
