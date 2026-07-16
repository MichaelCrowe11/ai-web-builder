// Publishing: turn a saved project into a live, public website served at
// <slug>.ai-webbuilder.com (or /s/<slug> before wildcard DNS is live).
import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import type { IStorage } from "./storage";
import { requireAuth } from "./auth";
import { log } from "./log";
import type { Project } from "@shared/schema";
import { siteGoalSchema, defaultConstraints, type SiteGoal } from "@shared/site-goal";
import { assembleDocumentHtml } from "./serve-document";

const PUBLISH_DOMAIN = process.env.PUBLISH_DOMAIN ?? "ai-webbuilder.com";

// The goal a freshly published site gets if its owner never sets one. It makes
// the "living site" turnkey: the growth agent optimizes toward primary
// call-to-action clicks (which the renderer already marks data-conversion) and,
// under the default "suggest" autonomy, proposes changes for one-click approval
// rather than mutating a live site unattended. Owners can retune it in the
// growth dashboard, including switching to full autopilot ("auto").
export function defaultPublishGoal(): SiteGoal {
  return siteGoalSchema.parse({
    objective: "capture_lead",
    conversionEvent: "primary_cta_click",
    description:
      "Set automatically on publish. The growth agent works to increase primary call-to-action clicks. Edit this any time in the growth dashboard.",
    constraints: defaultConstraints(),
  });
}

// Assemble a standalone HTML document from a project's html + css.
// Shared by both the export download and the published-site server.
export function renderFullHtml(project: Pick<Project, "name" | "html" | "css">): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(project.name)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${project.css}
  </style>
</head>
<body>
  ${project.html}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
}

// Turn a project name into a URL-safe slug base.
function slugifyBase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "site";
}

// Find an available slug using an injectable store, appending a short suffix on collision.
async function uniqueSlugWith(store: IStorage, name: string, currentSlug: string | null): Promise<string> {
  const base = slugifyBase(name);
  // Keep the existing slug if it already matches the base (re-publish).
  if (currentSlug && currentSlug.startsWith(base)) return currentSlug;
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    const existing = await store.getProjectBySlug(candidate);
    if (!existing) return candidate;
    // deterministic-ish suffix without Math.random (varies by attempt)
    candidate = `${base}-${(i + 2).toString(36)}${base.length}`;
  }
  // Last resort: timestamp-free unique-ish using base + length marker
  return `${base}-${Date.now().toString(36)}`;
}

// Session-less publish core: assign a unique slug, mark published, return the
// public URL. Shared by the human publish route and the agent build service.
// ownerUserId: when set (anonymous claim), written in the SAME update as publish
// fields to eliminate the partial-state window where a project is claimed but
// not yet published. Agent-built sites pass no ownerUserId so userId stays null.
export async function publishProjectRecord(
  project: Project,
  store: IStorage = storage,
  ownerUserId?: string,
): Promise<{ slug: string; publishedUrl: string; project: Project }> {
  const slug = await uniqueSlugWith(store, project.name, project.slug ?? null);
  const publishedUrl = `https://${slug}.${PUBLISH_DOMAIN}`;
  const patch: Partial<Project> = { slug, isPublished: true, publishedUrl };
  if (ownerUserId) patch.userId = ownerUserId;
  const updated = await store.updateProject(project.id, patch);

  // Turnkey living site: give a newly published site a default optimization
  // goal so the growth agent has something to work on with zero owner setup.
  // Never overwrite an existing goal, and never let this fail the publish.
  try {
    const existing = await store.getGoal(project.id);
    if (!existing) await store.setGoal(project.id, defaultPublishGoal());
  } catch (e) {
    log(`default goal set failed for ${project.id}: ${(e as Error).message}`);
  }

  return { slug, publishedUrl, project: updated ?? project };
}

export function registerPublishRoutes(app: Express) {
  // Publish a project: require auth + ownership, assign slug, mark published.
  app.post("/api/projects/:id/publish", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (project.userId && project.userId !== req.session.userId) {
        return res.status(403).json({ error: "Not your project" });
      }

      // For anonymous projects, fold the ownership claim into the publish update
      // (single atomic write) so there is no partial-state window where the
      // project is claimed but not yet published.
      const claimOwner = project.userId ? undefined : req.session.userId;
      const { slug, publishedUrl, project: updated } = await publishProjectRecord(project, storage, claimOwner);

      log(`Project ${project.id} published at ${slug}`);
      return res.json({
        slug,
        publishedUrl,
        // Path fallback works before wildcard DNS is configured.
        previewUrl: `/s/${slug}`,
        project: updated,
      });
    } catch (error: any) {
      log(`Publish error: ${error.message}`);
      return res.status(500).json({ error: "Failed to publish" });
    }
  });

  // Unpublish.
  app.post("/api/projects/:id/unpublish", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (project.userId && project.userId !== req.session.userId) {
        return res.status(403).json({ error: "Not your project" });
      }
      await storage.updateProject(project.id, { isPublished: false });
      return res.json({ ok: true });
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to unpublish" });
    }
  });

  // Path-based serving of a published site (pre-DNS fallback): /s/<slug>
  app.get("/s/:slug", serveSlug);
}

// Serve a published site by slug. Used by both the /s/:slug path route and
// the subdomain host middleware.
async function serveSlug(req: Request, res: Response) {
  const slug = req.params.slug;
  const project = await storage.getProjectBySlug(slug);
  if (!project || !project.isPublished) {
    return res.status(404).send("Site not found");
  }

  // Document-backed path: serve the Living Sites renderer + telemetry beacon.
  const latest = await storage.getLatestDocument(project.id);
  if (latest) {
    const exp = await storage.getRunningExperiment(project.id);
    const vid =
      req.headers.cookie?.match(/(?:^|; )vid=([^;]+)/)?.[1] ??
      `v${Date.now()}${Math.random().toString(36).slice(2)}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(assembleDocumentHtml(latest.document, project.id, exp ?? null, vid));
  }

  // Legacy path: render from the project's raw html/css fields.
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(renderFullHtml(project));
}

// Host-based middleware: if the request Host is <slug>.ai-webbuilder.com,
// serve that published site. Mounted before the SPA so app routes still work
// on the apex/app domain.
export function publishedSiteMiddleware(appHosts: string[]) {
  const normalizedAppHosts = appHosts.map((h) => h.toLowerCase());
  return async (req: Request, res: Response, next: () => void) => {
    const host = (req.headers.host ?? "").split(":")[0].toLowerCase();

    // Not our publish domain, or it's an app host → let the app handle it.
    if (!host.endsWith(`.${PUBLISH_DOMAIN}`) || normalizedAppHosts.includes(host)) {
      return next();
    }

    const sub = host.slice(0, host.length - PUBLISH_DOMAIN.length - 1);
    // Reserved subdomains that belong to the app, not published sites.
    if (!sub || ["www", "app", "api"].includes(sub)) return next();

    const project = await storage.getProjectBySlug(sub);
    if (!project || !project.isPublished) return next();

    // Document-backed path: serve the Living Sites renderer + telemetry beacon.
    const latest = await storage.getLatestDocument(project.id);
    if (latest) {
      const exp = await storage.getRunningExperiment(project.id);
      const vid =
        req.headers.cookie?.match(/(?:^|; )vid=([^;]+)/)?.[1] ??
        `v${Date.now()}${Math.random().toString(36).slice(2)}`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(assembleDocumentHtml(latest.document, project.id, exp ?? null, vid));
    }

    // Legacy path: render from the project's raw html/css fields.
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(renderFullHtml(project));
  };
}
