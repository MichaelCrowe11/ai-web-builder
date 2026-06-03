import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { generate, generateStream, parseSite, MODEL } from "./ai";
import { generateDocument, generateOutline, fillDocument, refineDocument, REFINE_INTENTS } from "./document-gen";
import { renderDocumentBody, renderDocumentCss, renderOutlineBody, renderOutlineCss } from "./renderer";
import { resolveDocumentImages, type StockProvider } from "./stock-images";
import { addGeneratedImages } from "./azure-image";
import { startVideo, getVideoStatus, downloadVideo } from "./azure-video";
import { siteDocumentSchema, siteOutlineSchema } from "@shared/site-document";

// Resolve generated imageHints to real stock photos (best-effort; no key => the
// renderer's gradient placeholders are used). Read env at call time.
const stockOpts = () => ({
  apiKey: process.env.STOCK_IMAGE_API_KEY,
  provider: process.env.STOCK_IMAGE_PROVIDER as StockProvider | undefined,
});
import { enforceQuota, consumeGeneration } from "./quota";
import { runLimited, AtCapacityError, makeCapacityPayload } from "./gen-limiter";
import { publicUser } from "./plan";
import { hashPassword, verifyPassword, requireAuth } from "./auth";
import { registerBillingRoutes } from "./billing";
import { registerPublishRoutes, renderFullHtml } from "./publish";
import { registerGrowthRoutes } from "./growth-routes";
import { registerExportRoutes } from "./github-export";
import { log } from "./index";
import { insertUserSchema, insertProjectSchema } from "@shared/schema";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Turn an AtCapacityError into a graceful 503 the client auto-retries.
  const sendCapacity = (res: Response, err: AtCapacityError) => {
    const { retryAfterSeconds, body } = makeCapacityPayload(err);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(503).json(body);
  };

  // Billing routes (Stripe checkout + portal)
  registerBillingRoutes(app);

  // Publishing routes (publish/unpublish + /s/:slug serving)
  registerPublishRoutes(app);

  // Growth routes (telemetry sink + Mission Control API)
  registerGrowthRoutes(app);

  // Export the generated site to GitHub (transient PAT, no OAuth app).
  registerExportRoutes(app);

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
      const raw = await runLimited(() => generateDocument(prompt));
      const document = await resolveDocumentImages(raw, stockOpts());
      const quota = await consumeGeneration(req);
      return res.json({
        document,
        html: renderDocumentBody(document),
        css: renderDocumentCss(document),
        quota,
      });
    } catch (error: any) {
      if (error?.name === "AtCapacityError") return sendCapacity(res, error as AtCapacityError);
      log(`Document generation error: ${error.message}`);
      return res.status(500).json({ error: "Failed to generate site", details: error.message });
    }
  });

  // TWO-PHASE generation, phase 1: fast outline -> instant themed skeleton.
  // Gates on quota (enforceQuota) but does NOT consume; the fill consumes.
  app.post("/api/generate/outline", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      const outline = await runLimited(() => generateOutline(prompt));
      return res.json({ outline, html: renderOutlineBody(outline), css: renderOutlineCss(outline) });
    } catch (error: any) {
      if (error?.name === "AtCapacityError") return sendCapacity(res, error as AtCapacityError);
      log(`Outline error: ${error.message}`);
      return res.status(500).json({ error: "Failed to outline site", details: error.message });
    }
  });

  // Phase 2: expand the approved outline into the full document (consumes quota).
  app.post("/api/generate/fill", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { prompt, outline } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      const parsed = siteOutlineSchema.safeParse(outline);
      if (!parsed.success) {
        return res.status(400).json({ error: "Valid outline is required" });
      }
      const raw = await runLimited(() => fillDocument(parsed.data, prompt));
      const document = await resolveDocumentImages(raw, stockOpts());
      const quota = await consumeGeneration(req);
      return res.json({
        document,
        html: renderDocumentBody(document),
        css: renderDocumentCss(document),
        quota,
      });
    } catch (error: any) {
      if (error?.name === "AtCapacityError") return sendCapacity(res, error as AtCapacityError);
      log(`Fill error: ${error.message}`);
      return res.status(500).json({ error: "Failed to generate site", details: error.message });
    }
  });

  // SCOPED refine: apply an instruction to an existing document. Counts as a
  // generation against quota (it's an Azure call), but it's targeted + cheap.
  app.post("/api/refine", enforceQuota, async (req: Request, res: Response) => {
    try {
      const { document, instruction } = req.body;
      if (!instruction || typeof instruction !== "string") {
        return res.status(400).json({ error: "Instruction is required" });
      }
      const parsed = siteDocumentSchema.safeParse(document);
      if (!parsed.success) {
        return res.status(400).json({ error: "Valid document is required" });
      }
      log(`Refining document: ${instruction.substring(0, 50)}...`);
      const refined = await runLimited(() => refineDocument(parsed.data, instruction));
      const updated = await resolveDocumentImages(refined, stockOpts());
      const quota = await consumeGeneration(req);
      return res.json({
        document: updated,
        html: renderDocumentBody(updated),
        css: renderDocumentCss(updated),
        quota,
      });
    } catch (error: any) {
      if (error?.name === "AtCapacityError") return sendCapacity(res, error as AtCapacityError);
      log(`Refine error: ${error.message}`);
      return res.status(500).json({ error: "Failed to refine site", details: error.message });
    }
  });

  // PRO image generation (async, after the text site is shown). Generates real
  // topical images (gpt-image-1) for hero + about. Free tier keeps gradients.
  app.post("/api/generate/images", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || user.plan !== "pro") {
        return res.status(403).json({ error: "Image generation is a Pro feature.", requiresUpgrade: true });
      }
      const parsed = siteDocumentSchema.safeParse(req.body?.document);
      if (!parsed.success) {
        return res.status(400).json({ error: "Valid document is required" });
      }
      const document = await addGeneratedImages(parsed.data);
      return res.json({
        document,
        html: renderDocumentBody(document),
        css: renderDocumentCss(document),
      });
    } catch (error: any) {
      log(`Image gen error: ${error.message}`);
      return res.status(500).json({ error: "Failed to generate images", details: error.message });
    }
  });

  // PRO hero video (Sora 2). Start a render job; client polls status; the
  // finished mp4 streams from /api/video/:id and becomes the hero background.
  app.post("/api/generate/video/start", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || user.plan !== "pro") {
        return res.status(403).json({ error: "Video generation is a Pro feature.", requiresUpgrade: true });
      }
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt is required" });
      }
      const videoId = await startVideo(prompt);
      if (!videoId) return res.status(502).json({ error: "Could not start video generation." });
      return res.json({ videoId });
    } catch (error: any) {
      log(`Video start error: ${error.message}`);
      return res.status(500).json({ error: "Failed to start video", details: error.message });
    }
  });

  app.get("/api/generate/video/status/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || user.plan !== "pro") return res.status(403).json({ error: "Pro feature" });
      const st = await getVideoStatus(req.params.id);
      if (!st) return res.status(502).json({ error: "Could not get video status" });
      return res.json(st);
    } catch (error: any) {
      return res.status(500).json({ error: "Status check failed", details: error.message });
    }
  });

  // Public: stream the finished mp4. Durable: serves the stored copy if present,
  // else downloads from Azure ONCE, stores it, and serves it - so published hero
  // videos survive even after the upstream (Azure) copy expires.
  app.get("/api/video/:id", async (req: Request, res: Response) => {
    try {
      const stored = await storage.getMedia(req.params.id);
      if (stored) {
        res.setHeader("Content-Type", stored.mime);
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        return res.send(stored.data);
      }
      const buf = await downloadVideo(req.params.id);
      if (!buf) return res.status(404).send("not found");
      await storage.saveMedia(req.params.id, "video/mp4", buf).catch(() => {}); // persist durable copy
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.send(buf);
    } catch {
      return res.status(502).send("error");
    }
  });

  // LEAD CAPTURE: a published site's contact/booking form posts here (public).
  // Honeypot + field/size caps; stores the submission for the owner's inbox.
  app.post("/api/forms/:projectId/submit", async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Site not found" });
      const body = req.body ?? {};
      if (body.website || body._hp) return res.json({ ok: true }); // honeypot: silently accept, drop
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(body)) {
        if (typeof v === "string" && k.length < 60) data[k] = v.slice(0, 5000);
      }
      if (Object.keys(data).length === 0) return res.status(400).json({ error: "Empty submission" });
      await storage.saveSubmission(req.params.projectId, data);
      return res.json({ ok: true });
    } catch (error: any) {
      log(`Form submit error: ${error.message}`);
      return res.status(500).json({ error: "Could not submit" });
    }
  });

  // CMS: persist an owner's edited document (re-renders + saves both the doc
  // version and the project html/css so every serve path reflects the edit).
  app.put("/api/projects/:id/document", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: "Not found" });
      if (project.userId && project.userId !== req.session.userId) {
        return res.status(403).json({ error: "Not your project" });
      }
      const parsed = siteDocumentSchema.safeParse(req.body?.document);
      if (!parsed.success) return res.status(400).json({ error: "Valid document is required" });
      const document = parsed.data;
      const html = renderDocumentBody(document);
      const css = renderDocumentCss(document);
      await storage.saveDocumentVersion(req.params.id, document);
      await storage.updateProject(req.params.id, { html, css, name: document.meta.name });
      return res.json({ ok: true, html, css });
    } catch (error: any) {
      log(`Document save error: ${error.message}`);
      return res.status(500).json({ error: "Save failed", details: error.message });
    }
  });

  // OWNER INBOX: list a project's submissions (auth + ownership).
  app.get("/api/projects/:projectId/submissions", requireAuth, async (req: Request, res: Response) => {
    try {
      const project = await storage.getProject(req.params.projectId);
      if (!project) return res.status(404).json({ error: "Not found" });
      if (project.userId && project.userId !== req.session.userId) {
        return res.status(403).json({ error: "Not your project" });
      }
      const submissions = await storage.listSubmissions(req.params.projectId);
      return res.json({ submissions });
    } catch (error: any) {
      return res.status(500).json({ error: "Failed to load submissions" });
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

      const text = await runLimited(() => generate(prompt));
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
      if (error?.name === "AtCapacityError") return sendCapacity(res, error as AtCapacityError);
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
