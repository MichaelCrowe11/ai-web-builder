import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage, storageMode } from "./storage";
import { generate, generateStream, parseSite, MODEL } from "./ai";
import {
  generateDocument,
  generateOutline,
  fillDocument,
  editSection,
  addSection,
  REFINE_INTENTS,
} from "./document-gen";
import { renderDocumentBody, renderDocumentCss } from "./renderer";
import { siteDocumentSchema, siteOutlineSchema, sectionTypeEnum } from "@shared/site-document";
import { enforceQuota, consumeGeneration } from "./quota";
import { publicUser } from "./plan";
import { hashPassword, verifyPassword, requireAuth } from "./auth";
import { registerBillingRoutes } from "./billing";
import { registerPublishRoutes, renderFullHtml } from "./publish";
import { log } from "./index";
import { insertUserSchema, insertProjectSchema, type Project } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Billing routes (Stripe checkout + portal)
  registerBillingRoutes(app);

  // Publishing routes (publish/unpublish + /s/:slug serving)
  registerPublishRoutes(app);

  // Health + runtime posture. `degraded` is true when running on throwaway
  // in-memory storage — the client surfaces a "demo mode" banner so users
  // aren't misled into thinking their work is being saved.
  app.get("/api/health", (_req: Request, res: Response) => {
    return res.json({
      ok: true,
      storage: storageMode,
      degraded: storageMode === "memory",
    });
  });

  // List of tappable refine intents for the UI.
  app.get("/api/refine/intents", (_req: Request, res: Response) => {
    return res.json({ intents: REFINE_INTENTS });
  });

  // STRUCTURED generation: prompt -> validated Site Document -> rendered HTML/CSS.
  // The AI never writes markup, so output can't be broken or unsafe.
  app.post("/api/generate/document", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      log(`Generating document (${MODEL}) for: ${prompt.substring(0, 50)}...`);
      const document = await generateDocument(prompt);
      const quota = await consumeGeneration(req);
      return res.json({
        document,
        html: renderDocumentBody(document),
        css: renderDocumentCss(document),
        quota,
      });
    } catch (error: any) {
      log(`Document generation error: ${error.message}`);
      return res.status(500).json({ error: "Failed to generate site", details: error.message });
    }
  });

  // PHASE 1 — Outline only. Cheap + fast so the client can paint a themed
  // skeleton immediately. Checks quota but does NOT consume it (the matching
  // /fill call completes the generation and is what counts).
  app.post("/api/generate/outline", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      log(`Outlining (${MODEL}) for: ${prompt.substring(0, 50)}...`);
      const outline = await generateOutline(prompt);
      return res.json({ outline, quota: req.quotaState });
    } catch (error: any) {
      log(`Outline error: ${error.message}`);
      return res.status(500).json({ error: "Failed to plan site", details: error.message });
    }
  });

  // PHASE 2 — Fill an approved outline with copy. Consumes one generation.
  app.post("/api/generate/fill", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt, outline } = req.body;
      const parsed = siteOutlineSchema.safeParse(outline);
      if (!parsed.success) {
        return res.status(400).json({ error: "Valid outline is required" });
      }
      log(`Filling outline (${MODEL})...`);
      const document = await fillDocument(parsed.data, typeof prompt === "string" ? prompt : "");
      const quota = await consumeGeneration(req);
      return res.json({
        document,
        html: renderDocumentBody(document),
        css: renderDocumentCss(document),
        quota,
      });
    } catch (error: any) {
      log(`Fill error: ${error.message}`);
      return res.status(500).json({ error: "Failed to write site", details: error.message });
    }
  });

  // SCOPED refine: edit or add ONE section. Sends only that section to the
  // model (not the whole document) — ~5-10x less latency/cost per tweak.
  // Theme tweaks never reach here; the client recomputes CSS locally.
  app.post("/api/refine/section", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { document, mode, target, instruction } = req.body;
      if (!instruction || typeof instruction !== "string") {
        return res.status(400).json({ error: "Instruction is required" });
      }
      const targetType = sectionTypeEnum.safeParse(target);
      if (!targetType.success) {
        return res.status(400).json({ error: "Valid target section type is required" });
      }
      const parsed = siteDocumentSchema.safeParse(document);
      if (!parsed.success) {
        return res.status(400).json({ error: "Valid document is required" });
      }
      log(`Refine ${mode} ${targetType.data}: ${instruction.substring(0, 40)}...`);
      const updated =
        mode === "add"
          ? await addSection(parsed.data, targetType.data, instruction)
          : await editSection(parsed.data, targetType.data, instruction);
      const quota = await consumeGeneration(req);
      return res.json({
        document: updated,
        html: renderDocumentBody(updated),
        css: renderDocumentCss(updated),
        quota,
      });
    } catch (error: any) {
      log(`Refine error: ${error.message}`);
      return res.status(500).json({ error: "Failed to refine site", details: error.message });
    }
  });

  // AI Generation endpoint (legacy raw HTML/CSS — kept during transition)
  app.post("/api/generate", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      log(`Generating website (${MODEL}) for prompt: ${prompt.substring(0, 50)}...`);

      const text = await generate(prompt);
      const result = parseSite(text);

      // Count this generation against the user's quota only on success.
      const quota = await consumeGeneration(req);

      log("Website generated successfully");
      return res.json({
        html: result.html,
        css: result.css,
        quota,
      });
    } catch (error: any) {
      log(`Generation error: ${error.message}`);
      return res.status(500).json({
        error: "Failed to generate website",
        details: error.message
      });
    }
  });

  // Streaming generation endpoint for real-time feedback
  app.post("/api/generate/stream", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      log(`Streaming generation (${MODEL}) for: ${prompt.substring(0, 50)}...`);

      const fullText = await generateStream(prompt, (text) => {
        res.write(`data: ${JSON.stringify({ type: "chunk", text })}\n\n`);
      });

      // Parse final result
      try {
        const result = parseSite(fullText);
        const quota = await consumeGeneration(req);
        res.write(`data: ${JSON.stringify({ type: "complete", html: result.html, css: result.css, quota })}\n\n`);
      } catch (parseError) {
        res.write(`data: ${JSON.stringify({ type: "error", message: "Failed to parse response" })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();
    } catch (error: any) {
      log(`Stream error: ${error.message}`);
      res.write(`data: ${JSON.stringify({ type: "error", message: error.message })}\n\n`);
      res.end();
    }
  });

  // ============ AUTHENTICATION ROUTES ============

  // Register new user
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const parseResult = insertUserSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: "Invalid input", details: parseResult.error.errors });
      }

      const { username, password, email } = parseResult.data;

      // Check if user exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ error: "Username already taken" });
      }

      // Create user with bcrypt-hashed password
      const user = await storage.createUser({
        username,
        password: await hashPassword(password),
        email,
      });

      req.session.userId = user.id;
      log(`User registered: ${username}`);
      return res.status(201).json(publicUser(user));
    } catch (error: any) {
      log(`Registration error: ${error.message}`);
      return res.status(500).json({ error: "Registration failed" });
    }
  });

  // Login user
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }

      const user = await storage.getUserByUsername(username);
      if (!user || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      req.session.userId = user.id;
      log(`User logged in: ${username}`);
      return res.json(publicUser(user));
    } catch (error: any) {
      log(`Login error: ${error.message}`);
      return res.status(500).json({ error: "Login failed" });
    }
  });

  // Current authenticated user (from session)
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      // Stale session pointing at a deleted user — clear it.
      req.session.destroy(() => {});
      return res.status(401).json({ error: "Not authenticated" });
    }
    return res.json(publicUser(user));
  });

  // Logout: destroy session + clear cookie
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ error: "Logout failed" });
      res.clearCookie("connect.sid");
      return res.json({ ok: true });
    });
  });

  // ============ PROJECT ROUTES ============

  async function loadProjectForSession(req: Request, res: Response): Promise<Project | undefined> {
    const project = await storage.getProject(req.params.id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return undefined;
    }
    if (project.userId && project.userId !== req.session.userId) {
      res.status(403).json({ error: "Not your project" });
      return undefined;
    }
    if (!project.userId && req.session.userId) {
      return await storage.updateProject(project.id, { userId: req.session.userId }) ?? project;
    }
    return project;
  }

  // Create a new project
  app.post("/api/projects", async (req: Request, res: Response) => {
    try {
      const { userId, name, html, css, prompt } = req.body;

      if (!html || !css) {
        return res.status(400).json({ error: "HTML and CSS are required" });
      }

      const project = await storage.createProject({
        userId: userId || null,
        name: name || "Untitled Project",
        html,
        css,
        prompt: prompt || null,
      });

      log(`Project created: ${project.id}`);
      return res.status(201).json(project);
    } catch (error: any) {
      log(`Project creation error: ${error.message}`);
      return res.status(500).json({ error: "Failed to create project" });
    }
  });

  // Get a specific project
  app.get("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }
      return res.json(project);
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to get project" });
    }
  });

  // Get all projects for a user
  app.get("/api/users/:userId/projects", async (req: Request, res: Response) => {
    try {
      const projects = await storage.getProjectsByUser(req.params.userId);
      return res.json(projects);
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to get projects" });
    }
  });

  // Update a project
  app.patch("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const { name, html, css, isPublished } = req.body;
      const project = await storage.updateProject(req.params.id, {
        ...(name && { name }),
        ...(html && { html }),
        ...(css && { css }),
        ...(isPublished !== undefined && { isPublished: Boolean(isPublished) }),
      });

      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      log(`Project updated: ${project.id}`);
      return res.json(project);
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to update project" });
    }
  });

  // List saved deployment candidates, newest first. A version is immutable:
  // save one for review, then deploy that exact snapshot.
  app.get("/api/projects/:id/versions", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await loadProjectForSession(req, res);
      if (!project) return;
      const versions = await storage.getProjectVersionsByProject(project.id);
      return res.json({ versions, publishedVersionId: project.publishedVersionId });
    } catch (error: any) {
      log(`Version list error: ${error.message}`);
      return res.status(500).json({ error: "Failed to list versions" });
    }
  });

  // Save the current project as a reviewable deployment candidate. This mirrors
  // Codex Sites' "save a version" stage before production deployment.
  app.post("/api/projects/:id/versions", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await loadProjectForSession(req, res);
      if (!project) return;
      const latest = (await storage.getProjectVersionsByProject(project.id))[0];
      const version = await storage.createProjectVersion({
        projectId: project.id,
        versionNumber: latest ? latest.versionNumber + 1 : 1,
        name: project.name,
        html: project.html,
        css: project.css,
        prompt: project.prompt,
      });
      return res.status(201).json({
        version,
        sitesModel: {
          saved: true,
          deployable: true,
          storage: { d1: null, r2: null },
        },
      });
    } catch (error: any) {
      log(`Version save error: ${error.message}`);
      return res.status(500).json({ error: "Failed to save version" });
    }
  });

  // Delete a project
  app.delete("/api/projects/:id", async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteProject(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Project not found" });
      }
      log(`Project deleted: ${req.params.id}`);
      return res.status(204).send();
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // Export project as downloadable HTML file
  app.get("/api/projects/:id/export", async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const fullHtml = renderFullHtml(project);

      res.setHeader("Content-Type", "text/html");
      res.setHeader("Content-Disposition", `attachment; filename="${project.name.replace(/[^a-z0-9]/gi, '_')}.html"`);
      return res.send(fullHtml);
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to export project" });
    }
  });

  return httpServer;
}
