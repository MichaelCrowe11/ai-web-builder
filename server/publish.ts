// Publishing: turn a saved project into a live, public website served at
// <slug>.ai-webbuilder.com (or /s/<slug> before wildcard DNS is live).
import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { log } from "./index";
import type { Project } from "@shared/schema";

const PUBLISH_DOMAIN = process.env.PUBLISH_DOMAIN ?? "ai-webbuilder.com";

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

// Find an available slug, appending a short suffix on collision.
async function uniqueSlug(name: string, currentSlug: string | null): Promise<string> {
  const base = slugifyBase(name);
  // Keep the existing slug if it already matches the base (re-publish).
  if (currentSlug && currentSlug.startsWith(base)) return currentSlug;
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    const existing = await storage.getProjectBySlug(candidate);
    if (!existing) return candidate;
    // deterministic-ish suffix without Math.random (varies by attempt)
    candidate = `${base}-${(i + 2).toString(36)}${base.length}`;
  }
  // Last resort: timestamp-free unique-ish using base + length marker
  return `${base}-${Date.now().toString(36)}`;
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

      const slug = await uniqueSlug(project.name, project.slug);
      const publishedUrl = `https://${slug}.${PUBLISH_DOMAIN}`;

      const updated = await storage.updateProject(project.id, {
        slug,
        isPublished: true,
        publishedUrl,
        publishedVersionId: null,
        // Claim ownership for anonymous projects on first publish.
        ...(project.userId ? {} : { userId: req.session.userId }),
      });

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

  // Deploy a specific saved version. This is the production-publish stage that
  // pairs with /api/projects/:id/versions above.
  app.post("/api/projects/:id/versions/:versionId/deploy", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (project.userId && project.userId !== req.session.userId) {
        return res.status(403).json({ error: "Not your project" });
      }

      const version = await storage.getProjectVersion(req.params.versionId);
      if (!version || version.projectId !== project.id) {
        return res.status(404).json({ error: "Version not found" });
      }

      const slug = await uniqueSlug(version.name, project.slug);
      const publishedUrl = `https://${slug}.${PUBLISH_DOMAIN}`;
      const updated = await storage.updateProject(project.id, {
        slug,
        isPublished: true,
        publishedUrl,
        publishedVersionId: version.id,
        ...(project.userId ? {} : { userId: req.session.userId }),
      });

      log(`Project ${project.id} deployed version ${version.versionNumber} at ${slug}`);
      return res.json({
        slug,
        publishedUrl,
        previewUrl: `/s/${slug}`,
        version,
        project: updated,
      });
    } catch (error: any) {
      log(`Version deploy error: ${error.message}`);
      return res.status(500).json({ error: "Failed to deploy version" });
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
  const version = project.publishedVersionId
    ? await storage.getProjectVersion(project.publishedVersionId)
    : undefined;
  const published = version ?? project;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(renderFullHtml(published));
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

    const version = project.publishedVersionId
      ? await storage.getProjectVersion(project.publishedVersionId)
      : undefined;
    const published = version ?? project;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(renderFullHtml(published));
  };
}
