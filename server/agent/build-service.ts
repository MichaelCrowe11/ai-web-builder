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
import type { InsertProject } from "@shared/schema";

export interface BuildDeps {
  storage: IStorage;
  generate?: (prompt: string) => Promise<SiteDocument>;
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
