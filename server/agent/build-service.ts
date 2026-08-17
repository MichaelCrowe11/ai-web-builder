// Orchestrates a full agent build: generate a SiteDocument, enrich it with real
// imagery (the paid tier of the human pipeline), render it, persist it as an
// UNCLAIMED project, publish it, and mint a one-time claim token.
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
import { resolveDocumentImages } from "../stock-images";
import { addGeneratedImages } from "../azure-image";
import { log } from "../log";
import type { InsertProject } from "@shared/schema";

export interface BuildDeps {
  storage: IStorage;
  generate?: (prompt: string) => Promise<SiteDocument>;
  enrichImages?: (doc: SiteDocument) => Promise<SiteDocument>;
}

export interface BuildResult {
  projectId: string;
  slug: string;
  siteUrl: string;
  claimToken: string;
  document: SiteDocument;
}

// Images an agent build ships with. Agents PAY per build, so they get the Pro
// treatment (hero + the next-ranked slots), not the free tier's single hero.
// Overridable because it is also the wall-clock knob: images are ~50s each.
function agentImagesPerBuild(): number {
  const n = Number(process.env.AGENT_IMAGES_PER_BUILD);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

// The same two-stage imagery the human product runs: resolve imageHints to
// stock photos when a stock key is configured (fast, free), then generate
// bespoke photography for whatever is still empty. Both stages are no-ops when
// unconfigured, and the whole step is best-effort — a paying agent must never
// lose a finished site to an image fault, so failures keep the text document
// (the renderer paints gradients for empty slots).
async function defaultEnrichImages(doc: SiteDocument): Promise<SiteDocument> {
  const withStock = await resolveDocumentImages(doc, {
    apiKey: process.env.STOCK_IMAGE_API_KEY,
    provider: process.env.STOCK_IMAGE_PROVIDER as "unsplash" | "pexels" | undefined,
  });
  return addGeneratedImages(withStock, agentImagesPerBuild());
}

export async function buildAndPublishSite(prompt: string, deps: BuildDeps): Promise<BuildResult> {
  const generate = deps.generate ?? ((p: string) => runLimited(() => generateDocument(p)));
  const enrich = deps.enrichImages ?? defaultEnrichImages;
  let document = await generate(prompt); // throws AtCapacityError BEFORE any DB write

  // Fill the document's image slots BEFORE render/publish so the site is
  // complete from its very first visitor — an agent's customer never sees the
  // placeholder state a human builder user watches images stream into.
  try {
    document = await enrich(document);
  } catch (err: any) {
    log(`Agent build: image enrichment failed, shipping without images — ${err.message}`);
  }

  // Render html/css for the legacy project fields (Living Sites serves the doc
  // version, but the columns are NOT NULL and empty strings are NOT safe —
  // serveSlug / publishedSiteMiddleware fall back to these columns, so a render
  // failure must abort the build, not silently publish a blank site.
  const html = renderDocumentBody(document);
  const css = renderDocumentCss(document);

  const project = await deps.storage.createProject({
    userId: null,
    name: document.meta?.name ?? "Agent Site",
    html,
    css,
    prompt,
  } as InsertProject);

  // Persist the doc so a later refine can load it (mirrors the human CMS path).
  await deps.storage.saveDocumentVersion(project.id, document);

  // Partial-state windows below: this app has no DB transactions. If publish or
  // createClaimToken throws, the project row already exists. An unpublished
  // orphan (no token) is inaccessible to anyone, so harmless; the narrow
  // worst case is a published site whose token mint failed (live but
  // unclaimable). The route settles payment only on full success, so the agent
  // is never charged for a partial build — they retry and get a fresh site.
  const { slug, publishedUrl } = await publishProjectRecord(project, deps.storage);

  const { token, hash } = mintClaimToken();
  await deps.storage.createClaimToken(hash, project.id);

  return { projectId: project.id, slug, siteUrl: publishedUrl, claimToken: token, document };
}
